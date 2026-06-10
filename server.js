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
function send(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg) {
  const data = JSON.stringify(msg);
  room.seats.forEach(s => { if (s.ws.readyState === WebSocket.OPEN) s.ws.send(data); });
}

/* ═══════════ Хранилище комнат ═══════════
   room = {
     code, state: null|GameState,
     seats: [{ ws, id:'p0'..'p3', name, seatIdx }]
   }
*/
const rooms = new Map(); // code → room

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
      players: entries.map((e, i) => ({
        ...st.players[i],
        id:       'p' + i,
        name:     e.name,
        color:    colors[i],
        initials: e.name.slice(0, 2).toUpperCase(),
        bot:      false,
      })),
    };

    const seats = entries.map((e, i) => ({ ws: e.ws, id: 'p' + i, name: e.name, seatIdx: i }));
    const room  = { code, state: st, seats };
    rooms.set(code, room);

    seats.forEach((seat, i) => {
      send(seat.ws, { type: 'matched', code, myIdx: i, myId: 'p' + i, state: st });
    });
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
            // принудительный выход — платит 50
            st = E.payment(st, myIdx, 50, null);
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
      st = E.buyProperty(st, myIdx, st.landed);
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
      st = doEndTurn(st);
      return st;
    }

    case 'payBail': {
      if (!st.players[myIdx].inJail || myIdx !== st.current) return null;
      st = E.payment(st, myIdx, 50, null);
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

/* doEndTurn — следующий ход */
function doEndTurn(st) {
  if (st.winner) return { ...st, phase: 'over' };
  if (st.lastDouble && !st.players[st.current].inJail) {
    return { ...st, phase: 'idle', landed: null, rentDue: 0, lastDouble: false };
  }
  const next = E.nextActiveIdx(st, st.current);
  return {
    ...E.recordHistory(st),
    current: next, phase: 'idle', landed: null, rentDue: 0,
    doubleCount: 0, lastDouble: false,
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
      const seat = { ws, id: 'p0', name, seatIdx: 0 };
      const room = { code, state: null, seats: [seat] };
      rooms.set(code, room);
      myRoom = room; mySeat = seat;
      send(ws, { type: 'created', code, playerId: 'p0', players: roomPlayers(room) });
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
      const seat  = { ws, id: 'p' + seatN, name, seatIdx: seatN };
      room.seats.push(seat);
      myRoom = room; mySeat = seat;
      send(ws, { type: 'joined', code, playerId: seat.id, players: roomPlayers(room) });
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
      let st = E.init(myRoom.seats.length);
      // Переименовываем игроков по именам участников комнаты
      st = {
        ...st,
        players: myRoom.seats.map((s, i) => ({
          ...st.players[i],
          id:       s.id,
          name:     s.name,
          color:    colors[i],
          initials: s.name.slice(0, 2).toUpperCase(),
          bot:      false,
        })),
      };
      myRoom.state = st;
      broadcast(myRoom, { type: 'started', state: st });
      return;
    }

    /* ── игровое действие ── */
    if (msg.type === 'action') {
      if (!myRoom || !mySeat || !myRoom.state) return;
      const newState = applyAction(myRoom, mySeat, msg.action);
      if (!newState) { send(ws, { type:'error', msg:'недопустимое действие' }); return; }
      myRoom.state = newState;
      broadcast(myRoom, { type: 'state', state: newState });
      return;
    }
  });

  ws.on('close', () => {
    removeFromMatchmaking(ws); // убираем из очереди, если был в ней
    if (!myRoom || !mySeat) return;
    myRoom.seats = myRoom.seats.filter(s => s !== mySeat);
    if (myRoom.seats.length === 0) {
      rooms.delete(myRoom.code);
      console.log(`[room] ${myRoom.code} closed (empty)`);
    } else {
      broadcast(myRoom, { type: 'player_joined', players: roomPlayers(myRoom) });
    }
  });

  ws.on('error', () => {});
});

server.listen(PORT, () => {
  console.log(`[ws] Вокруг света server → ws://localhost:${PORT}`);
});
