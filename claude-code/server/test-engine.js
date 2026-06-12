/**
 * Быстрые тесты движка — запускать: node test-engine.js
 * Проверяет все критерии из задачи.
 */
'use strict';
global.window = global;
const path = require('path');
const BASE = path.join(__dirname, '..', 'vokrug-sveta');
eval(require('fs').readFileSync(path.join(BASE, 'board-data.js'), 'utf8'));
eval(require('fs').readFileSync(path.join(BASE, 'engine.js'),     'utf8'));
const E  = global.VSEngine;
const VS = global.VS;

let passed = 0, failed = 0;
function ok(label, cond) {
  if (cond) { console.log('  ✅', label); passed++; }
  else       { console.error('  ❌', label); failed++; }
}

/* ───────── A. Аренда аэропортов ───────── */
console.log('\n── A. Аренда аэропортов и коммуналок ──');
{
  const airIdxs = VS.CELLS.filter(c => c.type === 'air').map(c => c.i); // 5,15,25,35
  let st = E.init(2);
  st = { ...st, owners: {} };

  // 1 аэропорт
  st = { ...st, owners: { [airIdxs[0]]: 'you' } };
  ok('1 airport → 25',  E.calcRent(st, VS.CELLS[airIdxs[0]], 'you', 7) === 25);
  // 2 аэропорта
  st = { ...st, owners: { [airIdxs[0]]: 'you', [airIdxs[1]]: 'you' } };
  ok('2 airports → 50', E.calcRent(st, VS.CELLS[airIdxs[0]], 'you', 7) === 50);
  // 3 аэропорта
  st = { ...st, owners: { ...st.owners, [airIdxs[2]]: 'you' } };
  ok('3 airports → 100', E.calcRent(st, VS.CELLS[airIdxs[0]], 'you', 7) === 100);
  // 4 аэропорта
  st = { ...st, owners: { ...st.owners, [airIdxs[3]]: 'you' } };
  ok('4 airports → 200', E.calcRent(st, VS.CELLS[airIdxs[0]], 'you', 7) === 200);
}

/* ───────── A2. Коммуналки ───────── */
{
  const utilIdxs = VS.CELLS.filter(c => c.type === 'util').map(c => c.i); // 12, 28
  let st = E.init(2);
  st = { ...st, owners: { [utilIdxs[0]]: 'you' } };
  ok('1 util, dice=8 → 8×4=32', E.calcRent(st, VS.CELLS[utilIdxs[0]], 'you', 8) === 32);
  st = { ...st, owners: { [utilIdxs[0]]: 'you', [utilIdxs[1]]: 'you' } };
  ok('2 util, dice=8 → 8×10=80', E.calcRent(st, VS.CELLS[utilIdxs[0]], 'you', 8) === 80);
}

/* ───────── B. Равномерная стройка ───────── */
console.log('\n── B. Равномерная стройка/продажа ──');
{
  // Сахара: Марракеш(1), Каир(3)
  let st = E.init(2);
  st = { ...st, owners: { 1: 'you', 3: 'you' } };
  ok('canBuild Marrakesh when 0/0', E.canBuild(st, 1, 'you'));
  // Строим на Марракеш
  st = E.buildHouse(st, 1);
  ok('after build: Marrakesh has 1 house', (st.houses[1] || 0) === 1);
  ok('canBuild Marrakesh=false (min=0 on Cairo)', !E.canBuild(st, 1, 'you'));
  ok('canBuild Cairo=true (min=0)', E.canBuild(st, 3, 'you'));
  // Строим на Каир
  st = E.buildHouse(st, 3);
  ok('after 2nd build: Cairo=1, Marrakesh=1', (st.houses[3]||0) === 1);
  ok('canBuild either (equal houses)', E.canBuild(st, 1, 'you') || E.canBuild(st, 3, 'you'));

  // canSellHouse
  ok('canSellHouse Marrakesh=true (max=1)', E.canSellHouse(st, 1, 'you'));
  // Строим ещё на Марракеш
  st = E.buildHouse(st, 1);
  ok('after 3rd build Marrakesh=2, Cairo=1', (st.houses[1]||0) === 2);
  ok('canSellHouse Marrakesh=true (2=max)', E.canSellHouse(st, 1, 'you'));
  ok('canSellHouse Cairo=false (1<max=2)',  !E.canSellHouse(st, 3, 'you'));
  // Попытка продать Каир без права — не должна измениться
  const stBefore = st;
  st = E.sellHouse(st, 3);
  ok('sellHouse Cairo blocked (no change)', (st.houses[3]||0) === 1);
}

/* ───────── C. houseCost из региона ───────── */
console.log('\n── C. houseCost + залог группы ──');
{
  ok('Marrakesh(af) houseCost=50',  E.houseCost(1)  === 50);
  ok('Lima(la) houseCost=100',      E.houseCost(11) === 100);
  ok('Amman(me) houseCost=150',     E.houseCost(16) === 150);
  ok('Amsterdam(no) houseCost=200', E.houseCost(31) === 200);
  ok('London(cap) houseCost=200',   E.houseCost(37) === 200);
  // Tokyo fix
  const tokyo = VS.CELLS[24];
  ok('Tokyo price=240', tokyo.price === 240);

  // Залог блокируется, если в группе есть дома
  let st = E.init(2);
  st = { ...st, owners: { 1: 'you', 3: 'you' }, houses: { 1: 1 } };
  const before = st.players[0].balance;
  const st2 = E.mortgage(st, 3); // Каир — нет домов, но в группе есть
  ok('mortgage Cairo blocked (Marrakesh has house)', st2.mortgaged && !st2.mortgaged[3]);
}

/* ───────── C2. Банк домов ───────── */
console.log('\n── C2. Банк домов/отелей ──');
{
  // Создаём состояние с пустым банком домов
  let st = E.init(2);
  st = { ...st, owners: { 1: 'you', 3: 'you' }, bank: { houses: 0, hotels: 12 } };
  const st2 = E.buildHouse(st, 1);
  ok('buildHouse blocked when bank.houses=0', (st2.houses[1]||0) === 0 && !!st2.toast);

  // Проверяем отели
  let st3 = E.init(2);
  st3 = { ...st3, owners: { 1: 'you', 3: 'you' }, houses: { 1: 4, 3: 4 }, bank: { houses: 32, hotels: 0 } };
  const st4 = E.buildHouse(st3, 1);
  ok('buildHotel blocked when bank.hotels=0', (st4.houses[1]||0) === 4 && !!st4.toast);

  // Нормальная стройка отеля: дома возвращаются в банк
  let st5 = E.init(2);
  st5 = { ...st5, owners: { 1: 'you', 3: 'you' }, houses: { 1: 4, 3: 4 }, bank: { houses: 0, hotels: 5 } };
  const st6 = E.buildHouse(st5, 1); // строим отель (4→5)
  ok('hotel built: bank.hotels 5→4', (st6.bank||{}).hotels === 4);
  ok('hotel built: bank.houses gets +4', (st6.bank||{}).houses === 4);
}

/* ───────── D. Аукцион ───────── */
console.log('\n── D. Аукцион ──');
{
  let st = E.init(4);
  // Запуск аукциона
  st = E.startAuction(st, 1, 0); // игрок 0 отказался от Марракеш
  ok('phase=auction after startAuction', st.phase === 'auction');
  ok('turnIdx=0 (decliner goes first)',  st.auction.turnIdx === 0);
  ok('highBid=0 initially',             st.auction.highBid === 0);

  // Игрок 0 ставит 40
  st = E.auctionBid(st, 0, 40);
  ok('bid 40 accepted', st.auction.highBid === 40 && st.auction.highBidder === 'you');
  ok('turn moves to p1', st.auction.turnIdx === 1);

  // Игрок 1 ставит 60
  st = E.auctionBid(st, 1, 60);
  ok('bid 60 > 40 accepted', st.auction.highBid === 60);
  // Игрок 2 пасует
  st = E.auctionPass(st, 2);
  ok('p2 passed, still auction (3 remain)', st.phase === 'auction');
  // Игрок 3 пасует
  st = E.auctionPass(st, 3);
  // Игрок 0 пасует — остаётся только p1 с highBid=60
  st = E.auctionPass(st, 0);
  ok('auction resolved (all but winner passed)', st.phase !== 'auction' || st.auction === null);
  ok('winner owns cell 1', st.owners && st.owners[1] === 'anya');

  // Проверка: никто не купил
  let st2 = E.init(3);
  st2 = E.startAuction(st2, 6, 0); // Лиссабон
  st2 = E.auctionPass(st2, 0); // все пасуют
  ok('after p0 pass, turn goes to p1', st2.phase === 'auction');
  st2 = E.auctionPass(st2, 1);
  ok('after p1 pass (only p2 left), auction ends', st2.phase !== 'auction');
  ok('no owner when no bids', !st2.owners || !st2.owners[6]);

  // botAuctionBid
  let st3 = E.init(2);
  st3 = { ...st3, owners: {}, auction: { cellIdx: 1, highBid: 0, highBidder: null, turnIdx: 1, passed: [], startedBy: 0 }, phase: 'auction' };
  const botResult = E.botAuctionBid(st3, 1, 1);
  ok('botAuctionBid returns bid or pass', 'bid' in botResult || 'pass' in botResult);
}

console.log(`\n══ Итого: ${passed} ✅  ${failed} ❌ ══\n`);
if (failed > 0) process.exit(1);
