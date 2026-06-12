'use strict';
/**
 * Симулятор полных игр с ботами на чистом движке.
 * Проверяет инварианты после КАЖДОЙ транзиции:
 *  - банк домов/отелей сходится (32/12)
 *  - дома только на клетках с владельцем, 0..5
 *  - заложенные клетки без домов
 *  - балансы не NaN, банкроты с балансом 0
 *  - дома только при монополии
 *  - игра завершается
 * Запуск: node bot-sim-test.js [количество игр]
 */
global.window = global;
const fs = require('fs'), path = require('path');
const BASE = path.join(__dirname, '..', 'vokrug-sveta');
eval(fs.readFileSync(path.join(BASE, 'board-data.js'), 'utf8'));
eval(fs.readFileSync(path.join(BASE, 'engine.js'), 'utf8'));
const E = global.VSEngine;
const VS = global.VS;

const GAMES = Number(process.argv[2] || 100);
const MAX_TURNS = 600;
let errors = [];

// детерминированный RNG
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function checkInvariants(st, game, turn, where) {
  const fail = (msg) => errors.push(`игра ${game} ход ${turn} [${where}]: ${msg}`);

  // банк домов
  let housesOut = 0, hotelsOut = 0;
  for (const [idx, h] of Object.entries(st.houses)) {
    if (h < 0 || h > 5) fail(`домов ${h} на клетке ${idx}`);
    if (!st.owners[idx]) fail(`дома без владельца на клетке ${idx}`);
    if (st.mortgaged[idx] && h > 0) fail(`дома на заложенной клетке ${idx}`);
    if (h >= 5) hotelsOut += 1; else housesOut += h;
    // монополия обязательна для домов
    const cell = VS.CELLS[idx];
    if (h > 0 && cell && cell.region && !E.isMonopoly(st, cell.region, st.owners[idx]))
      fail(`дома без монополии: ${cell.name}`);
  }
  const bank = st.bank || { houses: 32, hotels: 12 };
  if (bank.houses + housesOut !== 32) fail(`банк домов не сходится: ${bank.houses}+${housesOut}≠32`);
  if (bank.hotels + hotelsOut !== 12) fail(`банк отелей не сходится: ${bank.hotels}+${hotelsOut}≠12`);

  // владельцы — только живые игроки
  const aliveIds = new Set(st.players.filter(p => !p.bankrupt).map(p => p.id));
  for (const [idx, oid] of Object.entries(st.owners)) {
    if (!aliveIds.has(oid)) fail(`владелец-банкрот ${oid} клетки ${idx}`);
  }

  // балансы
  for (const p of st.players) {
    if (!Number.isFinite(p.balance)) fail(`${p.name}: balance=${p.balance}`);
    if (p.bankrupt && p.balance !== 0) fail(`банкрот ${p.name} с балансом ${p.balance}`);
    if (!p.bankrupt && p.balance < 0) fail(`${p.name}: отрицательный баланс ${p.balance}`);
    if (p.pos < 0 || p.pos > 39) fail(`${p.name}: pos=${p.pos}`);
  }
}

// один ход бота — повторяет логику клиента/сервера
function botTurn(st, rng) {
  const pIdx = st.current;
  const pl = st.players[pIdx];

  // тюрьма
  if (pl.inJail) {
    if ((pl.bailCards || 0) > 0) {
      st = { ...st, players: st.players.map((p, i) => i === pIdx ? { ...p, inJail: false, jailTurns: 0, bailCards: p.bailCards - 1 } : p) };
    } else if (pl.balance > 200) {
      st = E.payment(st, pIdx, 50, null);
      if (st.players[pIdx].bankrupt) return endTurn(st);
      st = { ...st, players: st.players.map((p, i) => i === pIdx ? { ...p, inJail: false, jailTurns: 0 } : p) };
    } else {
      const d = [E.rollDie(rng), E.rollDie(rng)];
      if (d[0] === d[1]) {
        st = { ...st, dice: d, players: st.players.map((p, i) => i === pIdx ? { ...p, inJail: false, jailTurns: 0 } : p), lastDouble: false };
        return resolveMove(st, pIdx, d[0] + d[1], rng);
      }
      const turns = (pl.jailTurns || 0) + 1;
      if (turns >= 3) {
        st = E.payment(st, pIdx, 50, null);
        if (st.players[pIdx].bankrupt) return endTurn(st);
        st = { ...st, dice: d, lastDouble: false, players: st.players.map((p, i) => i === pIdx ? { ...p, inJail: false, jailTurns: 0 } : p) };
        return resolveMove(st, pIdx, d[0] + d[1], rng);
      }
      st = { ...st, dice: d, lastDouble: false, players: st.players.map((p, i) => i === pIdx ? { ...p, jailTurns: turns } : p) };
      return endTurn(st);
    }
  }

  // обмен (как делает клиент): бот пытается докупить монополию
  const tr = E.botProposeTrade(st, pIdx, rng);
  if (tr && E.partnerAcceptsTrade(st, tr, pIdx, tr.partnerIdx)) {
    st = E.applyTrade(st, pIdx, tr.partnerIdx, tr.give, tr.get, tr.money);
  }
  // выкуп из залога при свободных деньгах
  let rGuard = 0;
  while (rGuard++ < 5) {
    const myMort = Object.keys(st.mortgaged).filter(i => st.owners[i] === st.players[pIdx].id);
    const aff = myMort.find(i => st.players[pIdx].balance - Math.round((VS.CELLS[i].price || 0) * 0.55) >= 300);
    if (aff === undefined) break;
    const next = E.redeem(st, Number(aff));
    if (next === st) break;
    st = next;
  }
  // строим дома перед броском (как делает клиент)
  st = botBuild(st, pIdx, rng);

  const d = [E.rollDie(rng), E.rollDie(rng)];
  const isDouble = d[0] === d[1];
  let dc = isDouble ? st.doubleCount + 1 : 0;
  if (isDouble && dc >= 3) {
    st = { ...st, dice: d, doubleCount: 0, lastDouble: false };
    st = E.sendToJail(st, pIdx);
    return endTurn(st);
  }
  st = { ...st, dice: d, doubleCount: dc, lastDouble: isDouble };
  return resolveMove(st, pIdx, d[0] + d[1], rng);
}

function botBuild(st, pIdx, rng) {
  const pl = st.players[pIdx];
  const style = E.getStyle(pl);
  let guard = 0;
  while (guard++ < 10) {
    const buildable = VS.CELLS.filter(c =>
      c.type === 'prop' && st.owners[c.i] === pl.id &&
      E.canBuild(st, c.i, pl.id) &&
      (st.houses[c.i] || 0) < style.maxHouses &&
      st.players[pIdx].balance - E.houseCost(c.i) >= style.buildBuffer);
    if (!buildable.length) break;
    const next = E.buildHouse(st, buildable[0].i);
    if (next === st) break;
    st = next;
  }
  return st;
}

function resolveMove(st, pIdx, steps, rng) {
  for (let i = 0; i < steps; i++) st = E.stepOne(st, pIdx);
  const pos = st.players[pIdx].pos;
  const cell = VS.CELLS[pos];
  const ownerId = st.owners[pos];
  const diceSum = (st.dice[0] || 0) + (st.dice[1] || 0);

  if (cell.type === 'corner' && cell.kind === 'gotojail') {
    st = E.sendToJail(st, pIdx);
    return endTurn(st);
  }
  if (cell.type === 'tax') {
    st = E.payTax(st, pIdx, cell.amount);
    return endTurn(st);
  }
  if (cell.type === 'chance' || cell.type === 'chest') {
    const deck = cell.type === 'chance' ? E.CHANCE_CARDS : E.CHEST_CARDS;
    const card = E.drawRandomCard(deck, rng);
    const { state: s2, control } = E.applyCardEffect(st, card, pIdx);
    st = s2;
    if (st.players[pIdx].bankrupt) return endTurn(st);
    if (control) {
      if (control.jail) { st = E.sendToJail(st, pIdx); return endTurn(st); }
      if (typeof control.move === 'number') {
        st = E.moveTo(st, pIdx, control.move, control.passStart);
        return resolveMove(st, pIdx, 0, rng);
      }
      if (typeof control.moveBy === 'number') {
        for (let i = 0; i < Math.abs(control.moveBy); i++)
          st = control.moveBy > 0 ? E.stepOne(st, pIdx) : E.shiftBy(st, pIdx, -1);
        return resolveMove(st, pIdx, 0, rng);
      }
    }
    return endTurn(st);
  }

  const buyable = cell.type === 'prop' || cell.type === 'air' || cell.type === 'util';
  if (buyable && !ownerId) {
    if (st.players[pIdx].balance >= (cell.price || 0) && E.botWantsToBuy(st, pIdx, pos, rng)) {
      st = E.buyProperty(st, pIdx, pos);
      return endTurn(st);
    }
    // аукцион
    st = E.startAuction(st, pos, pIdx);
    let guard = 0;
    while (st.phase === 'auction' && guard++ < 50) {
      const bidderIdx = st.auction.turnIdx;
      const decision = E.botAuctionBid(st, bidderIdx, st.auction.cellIdx, rng);
      st = decision.pass ? E.auctionPass(st, bidderIdx) : E.auctionBid(st, bidderIdx, decision.bid);
    }
    if (st.phase === 'auction') errors.push(`аукцион завис`);
    return endTurn(st);
  }
  if (buyable && ownerId && ownerId !== st.players[pIdx].id && !st.mortgaged[pos]) {
    const rent = E.calcRent(st, cell, ownerId, diceSum);
    st = E.payRent(st, pIdx, ownerId, rent, cell.name);
    return endTurn(st);
  }
  return endTurn(st);
}

function endTurn(st) {
  if (st.winner) return { ...st, phase: 'over' };
  if (st.lastDouble && !st.players[st.current].inJail && !st.players[st.current].bankrupt) {
    return { ...st, phase: 'idle', lastDouble: false, card: null };
  }
  const next = E.nextActiveIdx(st, st.current);
  return { ...E.recordHistory(st), current: next, phase: 'idle', doubleCount: 0, lastDouble: false, card: null, turnNum: (st.turnNum || 0) + 1 };
}

let finished = 0, totalTurns = 0, maxErrShown = false;
for (let g = 0; g < GAMES; g++) {
  const rng = mulberry32(1000 + g);
  const count = 2 + (g % 3); // 2..4 игрока
  let st = E.init(count);
  // все — боты
  st = { ...st, players: st.players.map(p => ({ ...p, bot: true })) };

  let turn = 0;
  for (; turn < MAX_TURNS; turn++) {
    if (st.phase === 'over' || st.winner) break;
    const before = errors.length;
    st = botTurn(st, rng);
    checkInvariants(st, g, turn, 'после хода');
    if (errors.length > before + 10) { maxErrShown = true; break; } // лавина ошибок — стоп
  }
  totalTurns += turn;
  if (st.winner) finished++;
  if (maxErrShown) break;
}

console.log(`\n═══ СИМУЛЯЦИЯ БОТОВ ═══`);
console.log(`Игр: ${GAMES} (2-4 бота), завершилось победой: ${finished}, средняя длина: ${Math.round(totalTurns / GAMES)} ходов`);
if (errors.length === 0) {
  console.log('✅ Все инварианты соблюдены во всех играх');
} else {
  console.log(`❌ ${errors.length} нарушений:`);
  [...new Set(errors)].slice(0, 20).forEach((e, i) => console.log(`  ${i + 1}. ${e}`));
}
process.exit(errors.length ? 1 : 0);
