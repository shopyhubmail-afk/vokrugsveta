'use strict';
/**
 * Стресс-тест сервера Вокруг света
 * Запуск: node stress-test.js
 * Сервер должен быть запущен отдельно: node server.js
 */
const WebSocket = require('ws');

const WS_URL = 'ws://localhost:8767';
const TURN_DELAY = 80; // мс между действиями
let errors = [];
let log = [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function createClient(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const client = { ws, name, state: null, myId: null, myIdx: null, msgs: [] };
    ws.on('open', () => resolve(client));
    ws.on('error', (e) => reject(new Error(`${name}: WS error: ${e.message}`)));
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        client.msgs.push(msg);
        if (msg.type === 'started' || msg.type === 'state') {
          client.state = msg.state;
        }
        if (msg.type === 'matched') {
          client.myId  = msg.myId;
          client.myIdx = msg.myIdx;
          client.state = msg.state;
        }
        if (msg.type === 'created' || msg.type === 'joined') {
          client.myId  = msg.playerId;
          client.myIdx = parseInt(msg.playerId.replace('p',''));
        }
        if (msg.type === 'started') {
          client.myIdx = client.state.players.findIndex(p => p.id === client.myId);
        }
      } catch {}
    });
    ws.on('close', () => {});
    setTimeout(() => reject(new Error(`${name}: timeout connecting`)), 3000);
  });
}

function send(client, msg) {
  if (client.ws.readyState === WebSocket.OPEN)
    client.ws.send(JSON.stringify(msg));
}

function waitFor(client, predicate, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (predicate(client)) return resolve();
      if (Date.now() - start > timeout) return reject(new Error(`${client.name}: waitFor timeout. Last state phase=${client.state?.phase} current=${client.state?.current}`));
      setTimeout(check, 30);
    };
    check();
  });
}

function isMyTurn(client) {
  return client.state && client.state.current === client.myIdx;
}

// Делает один полный ход (бросок + все необходимые действия)
// allClients — для розыгрыша аукциона, если покупка не по карману
async function doTurn(client, turnNum, allClients) {
  const st = client.state;
  const phase = st.phase;
  const myIdx = client.myIdx;

  if (phase === 'idle' && isMyTurn(client)) {
    const diceBefore = JSON.stringify(client.state.dice);
    const stBefore   = client.state;
    send(client, { type: 'action', action: { type: 'roll' } });
    await sleep(TURN_DELAY);
    // ждём любое изменение состояния после броска (включая дубль — та же фаза/игрок)
    await waitFor(client, c =>
      JSON.stringify(c.state.dice) !== diceBefore ||
      c.state.phase !== 'idle' ||
      c.state !== stBefore
    );
    // если выпал дубль и ход снова у нас — рекурсивно делаем ещё один ход
    if (client.state.phase === 'idle' && client.state.current === myIdx) {
      await doTurn(client, turnNum);
      return;
    }
  }

  await sleep(TURN_DELAY);
  const st2 = client.state;

  if (st2.phase === 'buy' && st2.current === myIdx) {
    // покупаем если по карману, иначе пасуем (→ аукцион)
    const price = st2.hint?.match(/\$([\d\s ]+)/) ? 0 : 0; // цена в landed
    const canAfford = st2.players[myIdx].balance >= 400; // запас с гарантией
    send(client, { type: 'action', action: { type: canAfford ? 'buy' : 'pass' } });
    await waitFor(client, c => c.state.phase !== 'buy' || c.state.current !== myIdx);
    // если начался аукцион — все пасуют
    let aGuard = 0;
    while (client.state.phase === 'auction' && allClients && aGuard++ < 20) {
      const auc = client.state.auction;
      if (!auc) break;
      const bidder = allClients.find(c => c.myIdx === auc.turnIdx);
      if (!bidder) break;
      const prevTurnIdx = auc.turnIdx;
      send(bidder, { type: 'action', action: { type: 'passBid' } });
      await waitFor(client, c => c.state.phase !== 'auction' ||
        (c.state.auction && c.state.auction.turnIdx !== prevTurnIdx), 2000);
    }
  }

  if (client.state.phase === 'rent' && client.state.current === myIdx) {
    send(client, { type: 'action', action: { type: 'payRent' } });
    await waitFor(client, c => c.state.phase !== 'rent' || c.state.current !== myIdx);
  }

  if (client.state.phase === 'special' && client.state.current === myIdx) {
    send(client, { type: 'action', action: { type: 'endTurn' } });
    await waitFor(client, c => c.state.phase !== 'special' || c.state.current !== myIdx);
  }

  if (client.state.phase === 'own' && client.state.current === myIdx) {
    send(client, { type: 'action', action: { type: 'endTurn' } });
    await waitFor(client, c => c.state.phase !== 'own' || c.state.current !== myIdx);
  }
}

async function runPrivateRoomTest() {
  console.log('\n═══ ТЕСТ 1: Приватная комната ═══');
  const p0 = await createClient('Хост');
  const p1 = await createClient('Гость');

  // Создаём комнату
  send(p0, { type: 'create', name: 'Хост' });
  await waitFor(p0, c => c.myId !== null);
  const code = p0.msgs.find(m => m.type === 'created')?.code;
  console.log(`  Комната создана: ${code}, хост myId=${p0.myId}`);

  // Гость входит
  send(p1, { type: 'join', code, name: 'Гость' });
  await waitFor(p1, c => c.myId !== null);
  console.log(`  Гость вошёл: myId=${p1.myId}`);

  // Хост стартует
  send(p0, { type: 'start' });
  await waitFor(p0, c => c.state !== null);
  await waitFor(p1, c => c.state !== null);
  console.log(`  Игра стартовала. Игроки: ${p0.state.players.map(p=>p.name).join(', ')}`);
  console.log(`  p0.myIdx=${p0.myIdx} (${p0.state.players[p0.myIdx]?.name})`);
  console.log(`  p1.myIdx=${p1.myIdx} (${p1.state.players[p1.myIdx]?.name})`);

  // Проверяем карточку: наступаем на chest/chance и проверяем что card=null после смены хода
  let cardPersistBug = false;
  const clients = [p0, p1];

  for (let turn = 0; turn < 40; turn++) {
    const current = p0.state.current;
    const active = clients.find(c => c.myIdx === current);
    const inactive = clients.find(c => c.myIdx !== current);
    if (!active) break;

    const phaseBefore = p0.state.phase;
    const cardBefore = p0.state.card;

    try {
      await doTurn(active, turn, clients);
    } catch (e) {
      errors.push(`Ход ${turn}: ${e.message}`);
      break;
    }

    await sleep(50);

    // Синхронизируем: оба клиента должны видеть одинаковое состояние
    if (JSON.stringify(p0.state?.phase) !== JSON.stringify(p1.state?.phase)) {
      errors.push(`Ход ${turn}: РАССИНХРОН phase p0=${p0.state?.phase} p1=${p1.state?.phase}`);
    }

    // Проверяем card persistence
    const stateAfter = p0.state;
    if (cardBefore && stateAfter.card === cardBefore && stateAfter.current !== current) {
      cardPersistBug = true;
      errors.push(`Ход ${turn}: КАРТОЧКА ЗАВИСЛА — card="${stateAfter.card?.text}" остаётся после смены хода`);
    }

    // Проверяем имена в тосте
    if (stateAfter.toast && stateAfter.toast.includes('твой')) {
      errors.push(`Ход ${turn}: СТАРЫЙ ТОСТ — "${stateAfter.toast}" (должно быть имя игрока)`);
    }

    const phaseLog = `ход ${turn+1}: ${p0.state.players[current]?.name} → фаза=${p0.state.phase} current=${p0.state.current}`;
    log.push(phaseLog);

    if (p0.state.phase === 'over') {
      console.log(`  Игра завершена на ходу ${turn+1}`);
      break;
    }
  }

  // Тест обмена городами
  const ownersP0 = Object.entries(p0.state.owners).filter(([,v]) => v === p0.myId).map(([k]) => Number(k));
  const ownersP1 = Object.entries(p0.state.owners).filter(([,v]) => v === p1.myId).map(([k]) => Number(k));
  console.log(`\n  Собственность p0: ${ownersP0.length} городов, p1: ${ownersP1.length} городов`);

  if (ownersP0.length > 0 && ownersP1.length > 0) {
    // берём незастроенные незаложенные клетки
    const mortgaged = p0.state.mortgaged || {};
    const houses = p0.state.houses || {};
    const freeP0 = ownersP0.filter(i => !mortgaged[i] && !(houses[i] > 0));
    const freeP1 = ownersP1.filter(i => !mortgaged[i] && !(houses[i] > 0));
    console.log(`  p0.myId=${p0.myId}, p1.myId=${p1.myId}`);
    console.log(`  Свободных у p0: ${freeP0.length}, у p1: ${freeP1.length}`);
    if (freeP0.length > 0 && freeP1.length > 0) {
      const give = [freeP0[0]];
      const get  = [freeP1[0]];
      console.log(`  Тест обмена: p0 отдаёт клетку ${give[0]} (владелец=${p0.state.owners[give[0]]}), берёт ${get[0]} (владелец=${p0.state.owners[get[0]]})`);
      send(p0, { type: 'action', action: { type: 'proposeTrade', withId: p1.myId, give, get, money: 0 } });
      await sleep(300);
      const afterTrade = p0.state.owners;
      console.log(`  После обмена: owners[${give[0]}]=${afterTrade[give[0]]}, owners[${get[0]}]=${afterTrade[get[0]]}`);
      if (afterTrade[give[0]] === p1.myId && afterTrade[get[0]] === p0.myId) {
        console.log('  ✅ Обмен прошёл успешно');
      } else {
        errors.push('Обмен НЕ сработал — owners не изменились');
      }
    } else {
      console.log('  ⚠️  Пропуск теста обмена — нет свободных городов без домов/залога');
    }
  } else {
    console.log('  ⚠️  Пропуск теста обмена — у кого-то нет городов');
  }

  p0.ws.close();
  p1.ws.close();
  console.log('  Тест 1 завершён');
}

async function runMatchmakingTest() {
  console.log('\n═══ ТЕСТ 2: Матчмейкинг ═══');
  const a = await createClient('Алиса');
  const b = await createClient('Боб');

  send(a, { type: 'matchmaking', name: 'Алиса', playerCount: 2 });
  send(b, { type: 'matchmaking', name: 'Боб',   playerCount: 2 });

  await waitFor(a, c => c.state !== null, 4000);
  await waitFor(b, c => c.state !== null, 4000);

  console.log(`  Matched! Алиса myIdx=${a.myIdx}, Боб myIdx=${b.myIdx}`);
  console.log(`  Игроки в стейте: ${a.state.players.map(p=>p.name).join(', ')}`);

  // Проверяем что имена правильные
  if (a.state.players[a.myIdx]?.name !== 'Алиса') {
    errors.push(`Матчмейкинг: имя Алисы неверно — ${a.state.players[a.myIdx]?.name}`);
  }
  if (a.state.players[b.myIdx]?.name !== 'Боб') {
    errors.push(`Матчмейкинг: имя Боба неверно — ${a.state.players[b.myIdx]?.name}`);
  }

  // 20 ходов
  const clients = [a, b];
  for (let turn = 0; turn < 20; turn++) {
    const current = a.state.current;
    const active = clients.find(c => c.myIdx === current);
    if (!active) break;
    try { await doTurn(active, turn, clients); } catch (e) { errors.push(`MM ход ${turn}: ${e.message}`); break; }
    if (a.state.phase === 'over') break;
  }

  a.ws.close();
  b.ws.close();
  console.log('  Тест 2 завершён');
}

async function runDisconnectTest() {
  console.log('\n═══ ТЕСТ 3: Дисконнект во время игры ═══');
  const h = await createClient('Хост2');
  const g = await createClient('Гость2');

  send(h, { type: 'create', name: 'Хост2' });
  await waitFor(h, c => c.myId !== null);
  const code = h.msgs.find(m => m.type === 'created')?.code;
  send(g, { type: 'join', code, name: 'Гость2' });
  await waitFor(g, c => c.myId !== null);
  send(h, { type: 'start' });
  await waitFor(h, c => c.state !== null);
  await waitFor(g, c => c.state !== null);

  // 5 ходов, потом гость дисконнектится
  const clients = [h, g];
  for (let turn = 0; turn < 5; turn++) {
    const current = h.state.current;
    const active = clients.find(c => c.ws.readyState === WebSocket.OPEN && c.myIdx === current);
    if (!active) break; // пропускаем отключённого игрока
    try { await doTurn(active, turn, clients); } catch (e) { errors.push(`DC ход ${turn}: ${e.message}`); break; }
  }

  g.ws.close();
  await sleep(200);

  // Хост делает ход — не должно упасть
  try {
    if (h.state.phase === 'idle' && h.state.current === h.myIdx) {
      send(h, { type: 'action', action: { type: 'roll' } });
      await sleep(300);
      console.log(`  Ход после дисконнекта гостя: phase=${h.state.phase}`);
    } else {
      console.log(`  После дисконнекта: ход ${h.state.players[h.state.current]?.name}, phase=${h.state.phase}`);
    }
  } catch (e) {
    errors.push(`Дисконнект: ${e.message}`);
  }

  h.ws.close();
  console.log('  Тест 3 завершён');
}

// Ход с аукционами: при покупке иногда пасуем, все участвуют в торгах
async function doTurnWithAuctions(clients, activeClient, turnNum) {
  const myIdx = activeClient.myIdx;
  const st = activeClient.state;

  if (st.phase === 'idle' && st.current === myIdx) {
    const diceBefore = JSON.stringify(st.dice);
    const curBefore  = st.current;
    const stBefore   = activeClient.state;
    send(activeClient, { type: 'action', action: { type: 'roll' } });
    await sleep(TURN_DELAY);
    await waitFor(activeClient, c =>
      JSON.stringify(c.state.dice) !== diceBefore ||
      c.state.phase !== 'idle' || c.state.current !== curBefore ||
      c.state !== stBefore); // любой новый стейт (кубики могли совпасть)
  }
  await sleep(TURN_DELAY);

  // фаза buy: каждый 3-й раз пасуем → аукцион
  if (activeClient.state.phase === 'buy' && activeClient.state.current === myIdx) {
    const passIt = turnNum % 3 === 0;
    send(activeClient, { type: 'action', action: { type: passIt ? 'pass' : 'buy' } });
    await waitFor(activeClient, c => c.state.phase !== 'buy' || c.state.current !== myIdx);
  }

  // аукцион: все клиенты по очереди; первый делает ставку, остальные пасуют
  let aGuard = 0;
  while (activeClient.state.phase === 'auction' && aGuard++ < 30) {
    const auc = activeClient.state.auction;
    if (!auc) break;
    const bidder = clients.find(c => c.myIdx === auc.turnIdx);
    if (!bidder) break;
    const doBid = auc.highBid === 0 && bidder.state.players[bidder.myIdx].balance > 100;
    if (doBid) {
      send(bidder, { type: 'action', action: { type: 'bid', amount: auc.highBid + 20 } });
    } else {
      send(bidder, { type: 'action', action: { type: 'passBid' } });
    }
    const prevTurnIdx = auc.turnIdx, prevPhase = activeClient.state.phase;
    try {
      await waitFor(activeClient, c =>
        c.state.phase !== 'auction' ||
        (c.state.auction && c.state.auction.turnIdx !== prevTurnIdx), 2000);
    } catch { errors.push(`Аукцион завис: turnIdx=${prevTurnIdx}`); break; }
  }
  if (activeClient.state.phase === 'auction') errors.push('Аукцион не завершился за 30 шагов');

  if (activeClient.state.phase === 'rent' && activeClient.state.current === myIdx) {
    send(activeClient, { type: 'action', action: { type: 'payRent' } });
    await waitFor(activeClient, c => c.state.phase !== 'rent' || c.state.current !== myIdx);
  }
}

async function runFourPlayerAuctionTest() {
  console.log('\n═══ ТЕСТ 4: 4 игрока + аукционы + стройка + залог ═══');
  const names = ['Анна', 'Борис', 'Вера', 'Глеб'];
  const cs = [];
  for (const n of names) cs.push(await createClient(n));

  send(cs[0], { type: 'create', name: names[0] });
  await waitFor(cs[0], c => c.myId !== null);
  const code = cs[0].msgs.find(m => m.type === 'created')?.code;
  for (let i = 1; i < 4; i++) {
    send(cs[i], { type: 'join', code, name: names[i] });
    await waitFor(cs[i], c => c.myId !== null);
  }
  send(cs[0], { type: 'start' });
  for (const c of cs) await waitFor(c, x => x.state !== null);
  console.log(`  4 игрока в комнате ${code}: ${cs[0].state.players.map(p => p.name).join(', ')}`);

  for (let turn = 0; turn < 60; turn++) {
    const current = cs[0].state.current;
    const active = cs.find(c => c.myIdx === current);
    if (!active) break;
    try { await doTurnWithAuctions(cs, active, turn); }
    catch (e) { errors.push(`4P ход ${turn}: ${e.message}`); break; }

    // рассинхрон между всеми 4 клиентами
    const phases = cs.map(c => c.state?.phase);
    if (new Set(phases).size > 1) errors.push(`4P ход ${turn}: РАССИНХРОН фаз: ${phases.join(',')}`);
    if (cs[0].state.phase === 'over') { console.log(`  Игра завершена на ходу ${turn}`); break; }
  }

  // стройка: ищем у кого монополия
  const st = cs[0].state;
  let built = false;
  for (const c of cs) {
    const id = c.myId;
    const myProps = Object.entries(st.owners).filter(([, v]) => v === id).map(([k]) => Number(k));
    for (const idx of myProps) {
      send(c, { type: 'action', action: { type: 'buildHouse', cellIdx: idx } });
      await sleep(100);
      if ((cs[0].state.houses[idx] || 0) > 0) { built = true; console.log(`  🏠 ${c.name} построил дом на клетке ${idx}`); break; }
    }
    if (built) break;
  }
  if (!built) console.log('  ⚠️  Ни у кого нет монополии — стройка не проверена (ок)');

  // залог + выкуп
  const anyOwner = Object.entries(cs[0].state.owners)[0];
  if (anyOwner) {
    const [cellIdx, ownerId] = anyOwner;
    const ownerClient = cs.find(c => c.myId === ownerId);
    const balBefore = cs[0].state.players[ownerClient.myIdx].balance;
    const hasHouses = (cs[0].state.houses[cellIdx] || 0) > 0;
    if (!hasHouses) {
      send(ownerClient, { type: 'action', action: { type: 'mortgage', cellIdx: Number(cellIdx) } });
      await sleep(150);
      if (cs[0].state.mortgaged[cellIdx]) {
        console.log(`  💰 Залог клетки ${cellIdx} прошёл (+${cs[0].state.players[ownerClient.myIdx].balance - balBefore})`);
        send(ownerClient, { type: 'action', action: { type: 'redeem', cellIdx: Number(cellIdx) } });
        await sleep(150);
        if (!cs[0].state.mortgaged[cellIdx]) console.log(`  💰 Выкуп прошёл`);
        else errors.push('Выкуп из залога не сработал');
      } else errors.push('Залог не сработал');
    }
  }

  cs.forEach(c => c.ws.close());
  console.log('  Тест 4 завершён');
}

async function main() {
  console.log('🎮 Стресс-тест Вокруг света');
  console.log(`   Сервер: ${WS_URL}\n`);

  try {
    await runPrivateRoomTest();
    await runMatchmakingTest();
    await runDisconnectTest();
    await runFourPlayerAuctionTest();
  } catch (e) {
    errors.push(`FATAL: ${e.message}`);
    console.error('Фатальная ошибка:', e.message);
  }

  console.log('\n═══ ИТОГИ ═══');
  if (errors.length === 0) {
    console.log('✅ Все тесты прошли без ошибок!');
  } else {
    console.log(`❌ Найдено ${errors.length} ошибок:`);
    errors.forEach((e, i) => console.log(`  ${i+1}. ${e}`));
  }

  console.log(`\nЛог ходов (последние 20):`);
  log.slice(-20).forEach(l => console.log('  ' + l));
  process.exit(errors.length > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
