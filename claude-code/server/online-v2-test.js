'use strict';
/**
 * Тест новых онлайн-механик: реконнект, таймер хода, ручной долг.
 * Сам поднимает сервер на 8768 с короткими таймингами.
 * Запуск: node online-v2-test.js
 */
const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');

const PORT = 8768;
const URL = `ws://localhost:${PORT}`;
let errors = [];
const ok = (cond, msg) => { if (cond) console.log('  ✅ ' + msg); else { console.log('  ❌ ' + msg); errors.push(msg); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function client(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const c = { ws, name, state: null, msgs: [], token: null, code: null, myId: null, deadline: null, seats: null };
    ws.on('open', () => resolve(c));
    ws.on('error', e => reject(e));
    ws.on('message', raw => {
      try {
        const m = JSON.parse(raw);
        c.msgs.push(m);
        if (m.token) c.token = m.token;
        if (m.code) c.code = m.code;
        if (m.playerId) c.myId = m.playerId;
        if (m.myId) c.myId = m.myId;
        if (m.state) c.state = m.state;
        if ('deadline' in m && m.deadline) c.deadline = m.deadline;
        if (m.seats) c.seats = m.seats;
      } catch {}
    });
    setTimeout(() => reject(new Error('connect timeout')), 3000);
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));
function waitFor(c, pred, t = 5000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (pred(c)) { clearInterval(iv); res(); }
      else if (Date.now() - t0 > t) { clearInterval(iv); rej(new Error(c.name + ': timeout')); }
    }, 40);
  });
}

/* ── юнит-тест долга (без сети) ── */
function debtUnitTest() {
  console.log('\n═══ Юнит: фаза долга ═══');
  process.env.PORT = '8799'; // чтобы require не конфликтовал портом
  const S = require('./server.js');
  const { applyAction, E } = S;

  let st = E.init(2);
  st = {
    ...st, manualDebt: true,
    players: st.players.map((p, i) => ({ ...p, id: 'p' + i, name: 'P' + i, bot: false })),
  };
  // p0 владеет Парижем (39), у p1 мало денег но есть Каир (3) под залог
  st = { ...st, owners: { 39: 'p0', 3: 'p1' }, current: 1, phase: 'rent', landed: 39, rentDue: 50,
         players: st.players.map((p, i) => i === 1 ? { ...p, balance: 20, pos: 39 } : p) };
  const room = { state: st, seats: [{ id: 'p0', seatIdx: 0 }, { id: 'p1', seatIdx: 1 }] };

  // аренда не по карману → фаза debt
  let s1 = applyAction(room, room.seats[1], { type: 'payRent' });
  ok(s1 && s1.phase === 'debt' && s1.debtOwed === 50, `аренда без денег → debt (phase=${s1?.phase}, owed=${s1?.debtOwed})`);
  room.state = s1;

  // payDebt при нехватке — отклоняется
  const s2 = applyAction(room, room.seats[1], { type: 'payDebt' });
  ok(s2 === null, 'payDebt без денег отклонён');

  // закладываем Каир (+30) → 50, payDebt проходит
  let s3 = applyAction(room, room.seats[1], { type: 'mortgage', cellIdx: 3 });
  ok(s3 && s3.players[1].balance === 50, `залог дал денег (баланс=${s3?.players[1].balance})`);
  room.state = s3;
  let s4 = applyAction(room, room.seats[1], { type: 'payDebt' });
  ok(s4 && s4.phase !== 'debt' && s4.players[0].balance === 1500 + 50, `payDebt: кредитор получил 50 (баланс p0=${s4?.players[0].balance})`);

  // сценарий «Сдаться»: долг больше всего имущества
  let st2 = { ...s1, debtOwed: 99999 };
  room.state = st2;
  let s5 = applyAction(room, room.seats[1], { type: 'surrender' });
  ok(s5 && s5.players[1].bankrupt === true, 'surrender при безнадёжном долге → банкротство');
  ok(s5 && s5.winner === 'p0', `победитель определён (${s5?.winner})`);
}

async function main() {
  debtUnitTest();

  console.log('\n═══ Сервер с TURN_MS=2000, RECONNECT_MS=3000 ═══');
  const srv = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    env: { ...process.env, PORT: String(PORT), TURN_MS: '2000', RECONNECT_MS: '3000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', () => {});
  srv.stderr.on('data', d => console.log('  [srv-err]', String(d).slice(0, 200)));
  await sleep(1200);

  try {
    /* ── Тест 1: реконнект ── */
    console.log('\n═══ ТЕСТ: Реконнект ═══');
    let a = await client('A'), b = await client('B');
    send(a, { type: 'create', name: 'A' });
    await waitFor(a, c => c.code);
    send(b, { type: 'join', code: a.code, name: 'B' });
    await waitFor(b, c => c.myId);
    ok(!!a.token && !!b.token, 'оба получили токены');
    send(a, { type: 'start' });
    await waitFor(b, c => c.state);
    ok(!!b.state.manualDebt, 'manualDebt включён в онлайн-партии');
    ok(!!a.deadline, 'дедлайн хода разослан');

    // B рвёт соединение и возвращается с токеном
    const bToken = b.token, code = a.code;
    b.ws.close();
    await waitFor(a, c => c.seats && c.seats.some(s => !s.connected), 4000);
    ok(true, 'A увидел что B отвалился (player_status)');

    const b2 = await client('B2');
    send(b2, { type: 'rejoin', code, token: bToken });
    await waitFor(b2, c => c.msgs.some(m => m.type === 'rejoined'), 4000);
    const rj = b2.msgs.find(m => m.type === 'rejoined');
    ok(rj && rj.myId === 'p1' && rj.state, `rejoin вернул место p1 и состояние`);
    await waitFor(a, c => c.seats && c.seats.every(s => s.connected), 4000);
    ok(true, 'A увидел возвращение B');

    // неверный токен
    const b3 = await client('B3');
    send(b3, { type: 'rejoin', code, token: 'фальшивка' });
    await waitFor(b3, c => c.msgs.some(m => m.type === 'rejoinFailed'), 3000);
    ok(true, 'фальшивый токен отклонён');
    b3.ws.close();

    /* ── Тест 2: таймер хода ── */
    console.log('\n═══ ТЕСТ: Таймер хода (никто не ходит) ═══');
    const turnBefore = a.state.turnNum;
    const diceBefore = JSON.stringify(a.state.dice);
    await sleep(5500); // > 2 × TURN_MS — сервер должен сам сделать ходы
    const changed = JSON.stringify(a.state.dice) !== diceBefore || a.state.turnNum !== turnBefore || a.state.phase !== 'idle';
    ok(changed, `сервер сходил за AFK-игроков (turnNum ${turnBefore}→${a.state.turnNum})`);

    /* ── Тест 3: окончательный дроп → банкротство ── */
    console.log('\n═══ ТЕСТ: Игрок не вернулся ═══');
    b2.ws.close();
    await sleep(3500 + 500); // > RECONNECT_MS
    await waitFor(a, c => c.state.players[1].bankrupt || c.state.winner, 8000);
    ok(a.state.players[1].bankrupt, 'невернувшийся игрок обанкрочен');
    ok(a.state.winner === 'p0', `A победил (${a.state.winner})`);
    a.ws.close();
  } catch (e) {
    errors.push('FATAL: ' + e.message);
    console.log('  ❌ FATAL:', e.message);
  }

  srv.kill();
  console.log('\n═══ ИТОГИ ═══');
  console.log(errors.length === 0 ? '✅ Все тесты прошли' : `❌ ${errors.length} ошибок`);
  process.exit(errors.length ? 1 : 0);
}

main();
