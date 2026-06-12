/**
 * Сервер «Вокруг света» — WebSocket + комнаты.
 * Запуск: node server.js [port]
 * По умолчанию: порт 8765
 *
 * Протокол (JSON):
 *   Client → Server:
 *     { type:'create', name }                          — создать приват-комнату
 *     { type:'join',   code, name }                    — войти в приват-комнату
 *     { type:'start' }                                 — хост начинает игру
 *     { type:'matchmaking', name, playerCount }        — войти в очередь матчмейкинга
 *     { type:'cancelMatchmaking' }                     — покинуть очередь
 *     { type:'action', action }                        — игровое действие
 *     { type:'ping' }                                  — keepalive
 *   Server → Client:
 *     { type:'created',           code, playerId, players }
 *     { type:'joined',            code, playerId, players }
 *     { type:'player_joined',     players }
 *     { type:'started',           state }
 *     { type:'queued',            position, total }    — место в очереди
 *     { type:'matched',           code, myIdx, myId, state } — нашли игру!
 *     { type:'matchmakingCancelled' }
 *     { type:'state',             state }
 *     { type:'error',             msg }
 *     { type:'pong' }
 */

'use strict';
const http  = require('http');
const WebSocket = require('ws');
const fs    = require('fs');
const path  = require('path');

/* ═══════════ Bootstrap движка в Node.js ═══════════
   engine.js и board-data.js используют window.VS / window.VSEngine.
   Подставляем global как window, eval-им файлы. */
global.window = global;
// Ищем движок: сначала рядом (Railway, всё в корне), потом ../vokrug-sveta/ (локально)
const BASE = fs.existsSync(path.join(__dirname, 'board-data.js'))
  ? __dirname
  : path.join(__dirname, '..', 'vokrug-sveta');
eval(fs.readFileSync(path.join(BASE, 'board-data.js'), 'utf8'));   // → global.VS
eval(fs.readFileSync(path.join(BASE, 'engine.js'),     'utf8'));   // → global.VSEngine
const E  = global.VSEngine;
const VS = global.VS;
console.log('[boot] engine loaded, cells:', VS.CELLS.length);

/* ═══════════ Утилиты ═══════════ */
function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
function genToken() {
  return require('crypto').randomBytes(16).toString('hex');
}

/* ── тайминги ── */
const TURN_MS      = Number(process.env.TURN_MS || 60000);  // лимит на ход
const RECONNECT_MS = Number(process.env.RECONNECT_MS || 120000); // удержание места после обрыва
function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  room.seats.forEach(s => { if (s.ws && s.ws.readyState === WebSocket.OPEN) s.ws.send(data); });
}

// статус подключений для клиентов: [{id, name, connected}]
function seatStatus(room) {
  return room.seats.map(s => ({ id: s.id, name: s.name, connected: !!(s.ws && s.ws.readyState === WebSocket.OPEN) }));
}

// рассылка нового состояния + перезапуск таймера хода
function pushState(room, type = 'state') {
  armTurnTimer(room);
  broadcast(room, { type, state: room.state, deadline: room.deadline || null, seats: seatStatus(room) });
}

/* ═══════════ Хранилище комнат ═══════════
   room = {
     code, state: null|GameState,
     seats: [{ ws, id:'p0'..'p3', name, seatIdx }]
   }
*/
const rooms  = new Map(); // code → room
const wsRoom = new WeakMap(); // ws → room
const wsSeat = new WeakMap(); // ws → seat

/* ═══════════ Матчмейкинг ═══════════
   matchmakingQueues: Map<playerCount, [{ws, name}]>
*/
const matchmakingQueues = new Map();

function removeFromMatchmaking(ws) {
  for (const queue of matchmakingQueues.values()) {
    const idx = queue.findIndex(e => e.ws === ws);
    if (idx >= 0) { queue.splice(idx, 1); return; }
  }
}

function handleMatchmaking(ws, name, playerCount) {
  removeFromMatchmaking(ws); // снимаем с предыдущей очереди, если была
  const count = Math.max(2, Math.min(4, Number(playerCount) || 4));
  if (!matchmakingQueues.has(count)) matchmakingQueues.set(count, []);
  const queue = matchmakingQueues.get(count);

  queue.push({ ws, name });

  // Уведомляем всех в очереди об обновлении позиций
  queue.forEach((e, i) => send(e.ws, { type: 'queued', position: i + 1, total: count }));

  if (queue.length >= count) {
    const entries = queue.splice(0, count);
    let code;
    do { code = genCode(); } while (rooms.has(code));

    const colors = ['#4aa3d8', '#d0392f', '#1f9576', '#dd9320'];
    let st = E.init(count);
    st = {
      ...st,
      manualDebt: true, // долги решает сам игрок (фаза debt)
      players: entries.map((e, i) => ({
        ...st.players[i],
        id:       'p' + i,
        name:     e.name,
        color:    colors[i],
        initials: e.name.slice(0, 2).toUpperCase(),
        bot:      false,
      })),
    };

    const seats = entries.map((e, i) => ({ ws: e.ws, id: 'p' + i, name: e.name, seatIdx: i, token: genToken() }));
    const room  = { code, state: st, seats };
    rooms.set(code, room);

    seats.forEach((seat, i) => {
      wsRoom.set(seat.ws, room);
      wsSeat.set(seat.ws, seat);
      send(seat.ws, { type: 'matched', code, myIdx: i, myId: 'p' + i, token: seat.token, state: st, deadline: null });
    });
    armTurnTimer(room);
    broadcast(room, { type: 'deadline', deadline: room.deadline });
    console.log(`[match] room ${code} — ${count} players: ${entries.map(e => e.name).join(', ')}`);
  }
}

function roomPlayers(room) {
  return room.seats.map(s => ({ id: s.id, name: s.name, seatIdx: s.seatIdx }));
}

/* ═══════════ Обработчик действий ═══════════
   action = { type, ...args }
   Возвращает новое состояние или null при ошибке.
*/
function applyAction(room, seat, action) {
  let st = room.state;
  if (!st || st.phase === 'over') return null;

  // В большинстве действий — только текущий игрок
  const myIdx = seat.seatIdx;

  switch (action.type) {

    case 'roll': {
      if (st.phase !== 'idle' && st.phase !== 'jail') return null;
      if (myIdx !== st.current) return null;
      const pl = st.players[myIdx];
      const d  = [E.rollDie(), E.rollDie()];
      const isDouble = d[0] === d[1];

      // тюрьма
      if (pl.inJail) {
        if (isDouble) {
          st = { ...st, dice: d, players: st.players.map((p,i) =>
            i === myIdx ? { ...p, inJail: false, jailTurns: 0 } : p),
            doubleCount: 0, lastDouble: false };
          st = resolveMove(st, myIdx, d[0]+d[1]);
        } else {
          const turns = (pl.jailTurns||0) + 1;
          if (turns >= 3) {
            // принудительный выход — платит 50 (без фазы долга: ход должен состояться)
            st = { ...E.payment({ ...st, manualDebt: false }, myIdx, 50, null), manualDebt: true };
            st = { ...st, dice: d, lastDouble: false };
            st = resolveMove(st, myIdx, d[0]+d[1]);
          } else {
            st = { ...st, dice: d, lastDouble: false,
              players: st.players.map((p,i) => i===myIdx ? {...p, jailTurns: turns} : p) };
            st = doEndTurn(st);
          }
        }
        return st;
      }

      // обычный ход
      let dc = st.doubleCount;
      if (isDouble) { dc++; } else { dc = 0; }
      const toJail = isDouble && dc >= 3;
      if (toJail) {
        st = { ...st, dice: d, doubleCount: 0, lastDouble: false };
        st = E.sendToJail(st, myIdx);
        st = doEndTurn(st);
      } else {
        st = { ...st, dice: d, doubleCount: toJail ? 0 : dc, lastDouble: isDouble && !toJail };
        st = resolveMove(st, myIdx, d[0]+d[1]);
      }
      return st;
    }

    case 'buy': {
      if (st.phase !== 'buy' || myIdx !== st.current) return null;
      const buyCell = VS.CELLS[st.landed];
      if (st.players[myIdx].balance < (buyCell?.price || 0)) return null; // нет денег — только pass/аукцион
      st = E.buyProperty(st, myIdx, st.landed);
      // перезаписываем тост чтобы всегда показывалось имя покупателя
      st = { ...st, toast: `${st.players[myIdx].name} купил ${buyCell?.name || ''}` };
      st = doEndTurn(st);
      return st;
    }

    case 'pass': {
      if (st.phase !== 'buy' || myIdx !== st.current) return null;
      // По канону: отказ → аукцион
      st = E.startAuction(st, st.landed, myIdx);
      return st;
    }

    case 'payRent': {
      if (st.phase !== 'rent' || myIdx !== st.current) return null;
      const cell  = VS.CELLS[st.landed];
      const owner = st.owners[st.landed];
      st = E.payRent(st, myIdx, owner, st.rentDue, cell.name);
      st = doEndTurn(st);
      return st;
    }

    case 'endTurn': {
      if (myIdx !== st.current) return null;
      if (st.phase === 'rent' || st.phase === 'buy' || st.phase === 'auction' || st.phase === 'debt') return null;
      st = doEndTurn(st);
      return st;
    }

    /* ── долг (фаза debt) ── */
    case 'payDebt': {
      if (st.phase !== 'debt' || myIdx !== st.current) return null;
      const owed = st.debtOwed || 0;
      if (st.players[myIdx].balance < owed) return null; // ещё не собрал — заложи/продай
      const credIdx = st.debtCreditor === 'bank' ? null
        : st.players.findIndex(p => p.id === st.debtCreditor);
      st = {
        ...st,
        players: st.players.map((p, i) => {
          if (i === myIdx) return { ...p, balance: p.balance - owed };
          if (credIdx != null && credIdx >= 0 && i === credIdx) return { ...p, balance: p.balance + owed };
          return p;
        }),
        phase: 'idle', debtOwed: 0, debtCreditor: null,
        toast: `${st.players[myIdx].name} оплатил долг`,
      };
      st = doEndTurn(st);
      return st;
    }

    case 'surrender': {
      if (st.phase !== 'debt' || myIdx !== st.current) return null;
      const owed = st.debtOwed || 0;
      const credIdx = st.debtCreditor === 'bank' ? null
        : st.players.findIndex(p => p.id === st.debtCreditor);
      // последняя попытка собрать деньги автоматически (как делает банк)
      let s2 = E.autoRaiseFunds({ ...st, manualDebt: false }, myIdx, owed);
      if (s2.players[myIdx].balance >= owed) {
        s2 = {
          ...s2,
          players: s2.players.map((p, i) => {
            if (i === myIdx) return { ...p, balance: p.balance - owed };
            if (credIdx != null && credIdx >= 0 && i === credIdx) return { ...p, balance: p.balance + owed };
            return p;
          }),
          phase: 'idle', debtOwed: 0, debtCreditor: null, manualDebt: true,
          toast: `${s2.players[myIdx].name} распродал имущество и оплатил долг`,
        };
        return doEndTurn(s2);
      }
      // не хватает даже после распродажи — банкротство в пользу кредитора
      s2 = { ...s2, phase: 'idle', debtOwed: 0, debtCreditor: null, manualDebt: true };
      s2 = E.bankrupt(s2, myIdx, credIdx != null && credIdx >= 0 ? credIdx : null);
      return doEndTurn(s2);
    }

    case 'payBail': {
      if (!st.players[myIdx].inJail || myIdx !== st.current) return null;
      if (st.players[myIdx].balance < 50) return null; // выкуп только живыми деньгами
      st = { ...E.payment({ ...st, manualDebt: false }, myIdx, 50, null), manualDebt: true };
      st = { ...st, players: st.players.map((p,i) =>
        i===myIdx ? {...p, inJail: false, jailTurns: 0} : p),
        phase: 'idle' };
      return st;
    }

    case 'useBailCard': {
      const pl2 = st.players[myIdx];
      if (!pl2.inJail || (pl2.bailCards||0) <= 0 || myIdx !== st.current) return null;
      st = { ...st, players: st.players.map((p,i) =>
        i===myIdx ? {...p, inJail: false, jailTurns: 0, bailCards: p.bailCards-1} : p),
        phase: 'idle' };
      return st;
    }

    case 'buildHouse': {
      if (typeof action.cellIdx !== 'number') return null;
      const owner = st.owners[action.cellIdx];
      const pl3 = seat.id;
      if (owner !== pl3) return null;
      return E.buildHouse(st, action.cellIdx);
    }

    case 'sellHouse': {
      if (typeof action.cellIdx !== 'number') return null;
      if (st.owners[action.cellIdx] !== seat.id) return null;
      return E.sellHouse(st, action.cellIdx);
    }

    case 'mortgage': {
      if (typeof action.cellIdx !== 'number') return null;
      if (st.owners[action.cellIdx] !== seat.id) return null;
      return E.mortgage(st, action.cellIdx);
    }

    case 'redeem': {
      if (typeof action.cellIdx !== 'number') return null;
      if (st.owners[action.cellIdx] !== seat.id) return null;
      return E.redeem(st, action.cellIdx);
    }

    // ── Аукцион ──
    case 'bid':
    case 'auctionBid': {
      const amount = typeof action.amount === 'number' ? action.amount
        : (action.kind === 'bid' ? action.amount : null);
      if (typeof amount !== 'number') return null;
      if (st.phase !== 'auction' || !st.auction) return null;
      if (st.auction.turnIdx !== myIdx) return null;
      const next = E.auctionBid(st, myIdx, amount);
      if (!next || next === st) return null;
      return next.phase !== 'auction' ? doEndTurn(next) : next;
    }

    case 'passBid':
    case 'auctionPass': {
      if (st.phase !== 'auction' || !st.auction) return null;
      if (st.auction.turnIdx !== myIdx) return null;
      const next = E.auctionPass(st, myIdx);
      return next.phase !== 'auction' ? doEndTurn(next) : next;
    }

    case 'proposeTrade': {
      const { withId, give = [], get = [], money = 0 } = action;
      const partnerIdx = st.players.findIndex(p => p.id === withId);
      if (partnerIdx < 0 || partnerIdx === myIdx) return null;
      // проверяем владельцев
      if (give.some(i => st.owners[i] !== seat.id)) return null;
      if (get.some(i => st.owners[i] !== withId)) return null;
      // нельзя менять заложенные или застроенные
      if ([...give, ...get].some(i => st.mortgaged[i] || (st.houses[i] || 0) > 0)) return null;
      return E.applyTrade(st, myIdx, partnerIdx, give, get, money);
    }

    default:
      // Поддержка action.kind для аукциона (клиент шлёт { kind:'bid', amount })
      if (action.kind === 'bid') {
        return applyAction(room, seat, { ...action, type: 'bid' });
      }
      if (action.kind === 'passBid') {
        return applyAction(room, seat, { ...action, type: 'passBid' });
      }
      return null;
  }
}

/* resolveMove — перемещение + приземление (без анимации, сразу) */
function resolveMove(st, pIdx, steps) {
  // двигаем по одной клетке (для +200 за старт)
  for (let i = 0; i < steps; i++) st = E.stepOne(st, pIdx);

  const pos     = st.players[pIdx].pos;
  const cell    = VS.CELLS[pos];
  const ownerId = st.owners[pos];
  const diceSum = (st.dice[0] || 0) + (st.dice[1] || 0);

  if (cell.type === 'corner' && cell.kind === 'gotojail') {
    st = E.sendToJail(st, pIdx);
    return doEndTurn(st);
  }
  if (cell.type === 'tax') {
    st = E.payTax(st, pIdx, cell.amount);
    return doEndTurn(st);
  }
  if (cell.type === 'chance' || cell.type === 'chest') {
    const deck = cell.type === 'chance' ? E.CHANCE_CARDS : E.CHEST_CARDS;
    const card = E.drawRandomCard(deck);
    const { state: s2, control } = E.applyCardEffect(st, card, pIdx);
    st = { ...s2, card };
    if (control) {
      if (control.jail) { st = E.sendToJail(st, pIdx); return doEndTurn(st); }
      if (typeof control.move === 'number') {
        st = E.moveTo(st, pIdx, control.move, control.passStart);
        return resolveMove(st, pIdx, 0);
      }
      if (typeof control.moveBy === 'number') {
        for (let i = 0; i < Math.abs(control.moveBy); i++) {
          st = control.moveBy > 0 ? E.stepOne(st, pIdx) : E.shiftBy(st, pIdx, -1);
        }
        return resolveMove(st, pIdx, 0);
      }
    }
    return doEndTurn(st);
  }

  const buyable = cell.type === 'prop' || cell.type === 'air' || cell.type === 'util';
  if (buyable && !ownerId && !st.mortgaged[pos]) {
    return { ...st, phase: 'buy', landed: pos,
      hint: `${cell.name} — ${E.money(cell.price || 0)}. Купить?` };
  }
  if (buyable && ownerId && ownerId !== st.players[pIdx].id && !st.mortgaged[pos]) {
    const rentAmount = E.calcRent(st, cell, ownerId, diceSum);
    return { ...st, phase: 'rent', landed: pos, rentDue: rentAmount,
      hint: `${cell.name} — аренда ${E.money(rentAmount)}` };
  }

  return doEndTurn(st);
}

/* ═══════════ Таймер хода ═══════════
   Если игрок не действует TURN_MS — сервер делает безопасное действие за него. */
function responsibleIdx(st) {
  if (!st) return -1;
  if (st.phase === 'auction' && st.auction) return st.auction.turnIdx;
  return st.current;
}

function armTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.deadline = null;
  const st = room.state;
  if (!st || st.phase === 'over' || st.winner) return;
  room.deadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => autoAct(room), TURN_MS + 250);
}

function autoAct(room) {
  const st = room.state;
  if (!st || st.phase === 'over' || st.winner) return;
  const idx  = responsibleIdx(st);
  const seat = room.seats.find(s => s.seatIdx === idx);
  if (!seat) return;
  let action = null;
  switch (st.phase) {
    case 'idle':
    case 'jail':    action = { type: 'roll' };    break;
    case 'buy':     action = { type: 'pass' };    break; // отказ → аукцион
    case 'rent':    action = { type: 'payRent' }; break;
    case 'auction': action = { type: 'passBid' }; break;
    case 'debt':    action = { type: 'surrender' }; break; // авто-распродажа/банкротство
    default:        action = { type: 'endTurn' };
  }
  const next = applyAction(room, seat, action);
  if (next) {
    room.state = next;
    pushState(room);
  } else {
    // действие не прошло (гонка состояний) — просто перезапускаем таймер
    armTurnTimer(room);
    broadcast(room, { type: 'deadline', deadline: room.deadline });
  }
}

/* doEndTurn — следующий ход */
function doEndTurn(st) {
  if (st.phase === 'debt') return st; // игрок разбирается с долгом — ход не передаём
  if (st.winner) return { ...st, phase: 'over', card: null };
  if (st.lastDouble && !st.players[st.current].inJail) {
    return { ...st, phase: 'idle', landed: null, rentDue: 0, lastDouble: false, card: null };
  }
  const next = E.nextActiveIdx(st, st.current);
  return {
    ...E.recordHistory(st),
    current: next, phase: 'idle', landed: null, rentDue: 0,
    doubleCount: 0, lastDouble: false, card: null,
    hint: `${st.players[next].name} ходит…`,
  };
}

/* ═══════════ HTTP + WebSocket сервер ═══════════ */
const PORT = Number(process.env.PORT || process.argv[2] || 8765);
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Вокруг света WS server OK\n');
});
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  let myRoom = null;
  let mySeat = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'ping') { send(ws, { type: 'pong' }); return; }

    /* ── матчмейкинг ── */
    if (msg.type === 'matchmaking') {
      if (myRoom) { send(ws, { type: 'error', msg: 'уже в комнате' }); return; }
      const name = String(msg.name || 'Игрок').slice(0, 20);
      handleMatchmaking(ws, name, msg.playerCount);
      return;
    }

    if (msg.type === 'cancelMatchmaking') {
      removeFromMatchmaking(ws);
      send(ws, { type: 'matchmakingCancelled' });
      return;
    }

    /* ── создать комнату ── */
    if (msg.type === 'create') {
      if (myRoom) { send(ws, { type:'error', msg:'уже в комнате' }); return; }
      const name = String(msg.name || 'Игрок').slice(0, 20);
      let code;
      do { code = genCode(); } while (rooms.has(code));
      const seat = { ws, id: 'p0', name, seatIdx: 0, token: genToken() };
      const room = { code, state: null, seats: [seat] };
      rooms.set(code, room);
      myRoom = room; mySeat = seat;
      send(ws, { type: 'created', code, playerId: 'p0', token: seat.token, players: roomPlayers(room) });
      return;
    }

    /* ── войти в комнату ── */
    if (msg.type === 'join') {
      if (myRoom) { send(ws, { type:'error', msg:'уже в комнате' }); return; }
      const code = String(msg.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room)                   { send(ws, { type:'error', msg:'комната не найдена' }); return; }
      if (room.state)              { send(ws, { type:'error', msg:'игра уже началась' }); return; }
      if (room.seats.length >= 4)  { send(ws, { type:'error', msg:'комната полна' }); return; }
      const name  = String(msg.name || 'Игрок').slice(0, 20);
      const seatN = room.seats.length;
      const seat  = { ws, id: 'p' + seatN, name, seatIdx: seatN, token: genToken() };
      room.seats.push(seat);
      myRoom = room; mySeat = seat;
      send(ws, { type: 'joined', code, playerId: seat.id, token: seat.token, players: roomPlayers(room) });
      // сообщить остальным
      room.seats.forEach(s => {
        if (s !== seat) send(s.ws, { type: 'player_joined', players: roomPlayers(room) });
      });
      return;
    }

    /* ── начать игру (только хост p0) ── */
    if (msg.type === 'start') {
      if (!myRoom || !mySeat) return;
      if (mySeat.id !== 'p0') { send(ws, { type:'error', msg:'только хост может начать' }); return; }
      if (myRoom.state)       { send(ws, { type:'error', msg:'уже идёт игра' }); return; }
      if (myRoom.seats.length < 2) { send(ws, { type:'error', msg:'нужно минимум 2 игрока' }); return; }

      const colors = ['#4aa3d8','#d0392f','#1f9576','#dd9320'];
      // настройки комнаты от хоста: стартовый баланс 500..5000
      const startBalance = Math.max(500, Math.min(5000, Number(msg.startBalance) || E.START_BALANCE));
      let st = E.init(myRoom.seats.length);
      // Переименовываем игроков по именам участников комнаты
      st = {
        ...st,
        manualDebt: true, // долги решает сам игрок (фаза debt)
        players: myRoom.seats.map((s, i) => ({
          ...st.players[i],
          id:       s.id,
          name:     s.name,
          color:    colors[i],
          initials: s.name.slice(0, 2).toUpperCase(),
          bot:      false,
          balance:  startBalance,
        })),
        history: [myRoom.seats.map(() => startBalance)],
      };
      myRoom.state = st;
      pushState(myRoom, 'started');
      return;
    }

    /* ── переподключение к партии ── */
    if (msg.type === 'rejoin') {
      const code = String(msg.code || '').toUpperCase();
      const room = rooms.get(code);
      if (!room) { send(ws, { type: 'rejoinFailed', msg: 'комната не найдена' }); return; }
      const seat = room.seats.find(s => s.token === msg.token);
      if (!seat) { send(ws, { type: 'rejoinFailed', msg: 'место не найдено' }); return; }
      // отвязываем старый сокет, привязываем новый
      if (seat.ws && seat.ws !== ws && seat.ws.readyState === WebSocket.OPEN) {
        try { seat.ws.close(); } catch {}
      }
      clearTimeout(seat.dropTimer);
      seat.ws = ws;
      wsRoom.set(ws, room);
      wsSeat.set(ws, seat);
      myRoom = room; mySeat = seat;
      send(ws, {
        type: 'rejoined', code, myIdx: seat.seatIdx, myId: seat.id, token: seat.token,
        state: room.state, deadline: room.deadline || null, players: roomPlayers(room),
      });
      broadcast(room, { type: 'player_status', seats: seatStatus(room) });
      console.log(`[rejoin] ${seat.name} вернулся в ${code}`);
      return;
    }

    /* ── игровое действие ── */
    if (msg.type === 'action') {
      if (!myRoom) { myRoom = wsRoom.get(ws) || null; mySeat = wsSeat.get(ws) || null; }
      if (!myRoom || !mySeat || !myRoom.state) return;
      const newState = applyAction(myRoom, mySeat, msg.action);
      if (!newState) { send(ws, { type:'error', msg:'недопустимое действие' }); return; }
      myRoom.state = newState;
      pushState(myRoom);
      return;
    }
  });

  ws.on('close', () => {
    removeFromMatchmaking(ws); // убираем из очереди, если был в ней
    if (!myRoom) { myRoom = wsRoom.get(ws) || null; mySeat = wsSeat.get(ws) || null; }
    if (!myRoom || !mySeat) return;
    const room = myRoom, seat = mySeat;
    if (seat.ws !== ws) return; // место уже занято новым сокетом (rejoin) — ничего не делаем

    if (!room.state || room.state.phase === 'over') {
      // лобби или завершённая игра — убираем сразу
      room.seats = room.seats.filter(s => s !== seat);
      if (room.seats.length === 0) {
        clearTimeout(room.turnTimer);
        rooms.delete(room.code);
        console.log(`[room] ${room.code} closed (empty)`);
      } else {
        broadcast(room, { type: 'player_joined', players: roomPlayers(room) });
      }
      return;
    }

    // идёт игра — держим место RECONNECT_MS, потом банкротим
    seat.ws = null;
    broadcast(room, { type: 'player_status', seats: seatStatus(room) });
    console.log(`[dc] ${seat.name} отвалился от ${room.code} — ждём ${RECONNECT_MS / 1000}с`);
    clearTimeout(seat.dropTimer);
    seat.dropTimer = setTimeout(() => {
      if (seat.ws) return; // успел вернуться
      const st = room.state;
      if (!st || st.phase === 'over') return;
      const pIdx = seat.seatIdx;
      if (!st.players[pIdx] || st.players[pIdx].bankrupt) return;
      let s2 = E.bankrupt({ ...st, manualDebt: false }, pIdx, null);
      s2 = { ...s2, manualDebt: true, toast: `${seat.name} покинул игру` };
      // если выбыл текущий игрок — передаём ход
      if (s2.current === pIdx && !s2.winner) {
        const next = E.nextActiveIdx(s2, pIdx);
        s2 = { ...s2, current: next, phase: 'idle', landed: null, rentDue: 0, doubleCount: 0, lastDouble: false, card: null };
      }
      if (s2.winner) s2 = { ...s2, phase: 'over' };
      room.state = s2;
      pushState(room);
      // все отключены и игра кончилась — чистим комнату
      if (room.seats.every(s => !s.ws)) {
        clearTimeout(room.turnTimer);
        rooms.delete(room.code);
        console.log(`[room] ${room.code} closed (all gone)`);
      }
    }, RECONNECT_MS);
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`[ws] Вокруг света server → ws://localhost:${PORT}`);
});

// для юнит-тестов (node)
if (typeof module !== 'undefined') {
  module.exports = { applyAction, doEndTurn, resolveMove, rooms, E, VS };
}
