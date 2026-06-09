/* engine.js — ЧИСТЫЙ движок «Вокруг света» (без React/DOM/таймеров).
   Все функции-правила детерминированы: (state, …, rng) → новое состояние.
   Один и тот же модуль используется на клиенте (боты) и на сервере (онлайн).

   Зависимости: глобальный window.VS (board-data.js) — конфиг поля.
   Состояние ИММУТАБЕЛЬНО: каждая транзиция возвращает НОВЫЙ объект state. */
(function () {
  const VS = window.VS;

  /* ══════════════ КОНСТАНТЫ ══════════════ */
  const START_BALANCE = 1500;

  const POOL = [
    { id: 'you',     name: 'Ты',          initials: 'ТЫ', color: '#4aa3d8' },
    { id: 'anya',    name: 'Аня',          initials: 'АН', color: '#d0392f', photo: true },
    { id: 'buyer',   name: 'Скупщик',      initials: '',   color: '#b14a86', bot: true },
    { id: 'marco',   name: 'Марко',        initials: 'МА', color: '#1f9576', photo: true },
    { id: 'lina',    name: 'Лина',         initials: 'ЛИ', color: '#dd9320' },
    { id: 'builder', name: 'Строитель',    initials: '',   color: '#274d8a', bot: true },
    { id: 'careful', name: 'Осторожный',   initials: '',   color: '#8d6239', bot: true },
    { id: 'zoya',    name: 'Зоя',          initials: 'ЗО', color: '#6f63c4' },
  ];

  // 🌍 «События мира» (синяя колода) — 16 карт
  const CHANCE_CARDS = [
    { id: 'c1',  text: 'Кругосветный рейс! Летите на Старт',                     move: 0, forceLand: true },
    { id: 'c2',  text: 'Карантин закрыл границы — отправляйтесь в тюрьму',       jail: true },
    { id: 'c3',  text: 'Грант фонда путешествий: +200',                           money: 200 },
    { id: 'c4',  text: 'Туристический налог: −100',                               money: -100 },
    { id: 'c5',  text: 'Землетрясение: ремонт по 40 за каждый дом',              houseTax: 40 },
    { id: 'c6',  text: 'Попутный ветер: +3 клетки вперёд',                       moveBy: 3 },
    { id: 'c7',  text: 'Задержка рейса: −2 клетки назад',                        moveBy: -2 },
    { id: 'c8',  text: 'Выгодный курс валют: банк платит вам 150',               money: 150 },
    { id: 'c9',  text: 'Утерян багаж: штраф 75',                                  money: -75 },
    { id: 'c10', text: 'Фестиваль в вашу честь — каждый дарит вам 25',           collectEach: 25 },
    { id: 'c11', text: 'Благотворительность: раздайте каждому по 50',            payEach: 50 },
    { id: 'c12', text: 'Перелёт в Токио',                                         move: 24, forceLand: true },
    { id: 'c13', text: 'Дипломатический иммунитет: карта выхода из тюрьмы',      bail: true },
    { id: 'c14', text: 'Премия за открытие: +120',                                money: 120 },
    { id: 'c15', text: 'Пошлина на сувениры: −60',                                money: -60 },
    { id: 'c16', text: 'Скоростной экспресс: +5 клеток',                          moveBy: 5 },
  ];

  // 🎁 «Удача» (золотая колода) — 16 карт
  const CHEST_CARDS = [
    { id: 'h1',  text: 'Вы выиграли лотерею: +100',                              money: 100 },
    { id: 'h2',  text: 'Бесплатно выходите из тюрьмы (сохраните карту)',         bail: true },
    { id: 'h3',  text: 'Ошибка в налоге в вашу пользу: +20',                     money: 20 },
    { id: 'h4',  text: 'Наследство от дядюшки: +250',                             money: 250 },
    { id: 'h5',  text: 'Счёт за отель: −80',                                      money: -80 },
    { id: 'h6',  text: 'Возврат страховки: +60',                                  money: 60 },
    { id: 'h7',  text: 'Медицинская страховка: −50',                               money: -50 },
    { id: 'h8',  text: 'День рождения — каждый дарит вам 20',                     collectEach: 20 },
    { id: 'h9',  text: 'Капитальный ремонт: по 30 за каждый дом',                houseTax: 30 },
    { id: 'h10', text: 'Кэшбэк за билеты: +40',                                   money: 40 },
    { id: 'h11', text: 'Проигрались в казино: −120',                               money: -120 },
    { id: 'h12', text: 'Дивиденды по акциям: +90',                                money: 90 },
    { id: 'h13', text: 'Угощаете друзей: каждому по 30',                          payEach: 30 },
    { id: 'h14', text: 'Найден клад: +180',                                        money: 180 },
    { id: 'h15', text: 'Штраф за превышение: −40',                                money: -40 },
    { id: 'h16', text: 'Возврат переплаты: +70',                                   money: 70 },
  ];

  /* ══════════════ УТИЛИТЫ ══════════════ */
  const money = (n) => '$' + n.toLocaleString('ru-RU');
  const rollDie = (rng) => 1 + Math.floor((rng || Math.random)() * 6);

  function init(count) {
    const players = POOL.slice(0, count).map(p => ({
      ...p, pos: 0, balance: START_BALANCE,
      inJail: false, jailTurns: 0, bailCards: 0, bankrupt: false,
    }));
    return {
      players, current: 0,
      dice: [0, 0], rolling: false,
      doubleCount: 0, lastDouble: false,
      phase: 'idle', landed: null, rentDue: 0,
      owners: {}, houses: {}, mortgaged: {},
      hint: 'Брось кубики, чтобы начать',
      fly: null, toast: null, card: null,
      winner: null, trade: null, auction: null,
      logs: [],
      history: [players.map(() => START_BALANCE)],
      bank: { houses: 32, hotels: 12 },
    };
  }

  // добавить запись в журнал (иммутабельно)
  function withLog(state, event) {
    return { ...state, logs: [{ ...event, timestamp: Date.now() }, ...state.logs].slice(0, 100) };
  }

  /* ══════════════ ЗАПРОСЫ (read-only) ══════════════ */

  function isMonopoly(state, region, ownerId) {
    const cells = VS.CELLS.filter(c => c.region === region && c.type === 'prop');
    return cells.length > 0 && cells.every(c => state.owners[c.i] === ownerId);
  }

  // Количество аэропортов/коммуналок у игрока
  function countAirports(state, ownerId) {
    return VS.CELLS.filter(c => c.type === 'air' && state.owners[c.i] === ownerId).length;
  }
  function countUtils(state, ownerId) {
    return VS.CELLS.filter(c => c.type === 'util' && state.owners[c.i] === ownerId).length;
  }

  /**
   * calcRent(state, cell, ownerId, diceSum)
   * diceSum — сумма кубиков текущего броска (нужна для коммуналок).
   * Если не передан — берётся из state.dice.
   */
  function calcRent(state, cell, ownerId, diceSum) {
    if (state.mortgaged[cell.i]) return 0;
    const sum = diceSum != null ? diceSum : (state.dice[0] + state.dice[1]);

    if (cell.type === 'air') {
      const count = countAirports(state, ownerId);
      return [0, 25, 50, 100, 200][Math.min(count, 4)];
    }
    if (cell.type === 'util') {
      const count = countUtils(state, ownerId);
      const mult = count >= 2 ? 10 : 4;
      return Math.max(sum, 1) * mult;
    }
    // prop
    if (!cell.rent) return Math.round(cell.price / 10);
    const houses = state.houses[cell.i] || 0;
    if (houses >= 5) return cell.rent[5];
    if (houses > 0)  return cell.rent[Math.min(houses, 4)];
    return isMonopoly(state, cell.region, ownerId) ? cell.rent[0] * 2 : cell.rent[0];
  }

  // Стоимость одного дома: берём из REGIONS по региону клетки
  function houseCost(cellIdx) {
    const cell = VS.CELLS[cellIdx];
    if (!cell || !cell.region) return 0;
    const region = VS.REGIONS[cell.region];
    return region ? (region.houseCost || 0) : 0;
  }

  function countHouses(state, pIdx) {
    const id = state.players[pIdx].id;
    return Object.entries(state.houses).reduce((sum, [idx, h]) =>
      state.owners[idx] === id ? sum + h : sum, 0);
  }

  function ownedInRegion(state, region, playerId) {
    return VS.CELLS.filter(c => c.region === region && c.type === 'prop' && state.owners[c.i] === playerId).length;
  }

  function liquidWorth(state, pIdx) {
    const id = state.players[pIdx].id;
    let w = state.players[pIdx].balance;
    Object.entries(state.owners).forEach(([idx, oid]) => {
      if (oid !== id) return;
      const cell = VS.CELLS[idx];
      if (!state.mortgaged[idx]) w += Math.round((cell.price || 0) * 0.5);
      const h = state.houses[idx] || 0;
      if (h > 0) w += h * Math.round(houseCost(Number(idx)) * 0.5);
    });
    return w;
  }

  // Число домов на каждой prop-клетке группы (включая не принадлежащие игроку)
  function groupHouseCounts(state, region) {
    return VS.CELLS
      .filter(c => c.region === region && c.type === 'prop')
      .map(c => state.houses[c.i] || 0);
  }

  function canBuild(state, cellIdx, playerId) {
    const cell = VS.CELLS[cellIdx];
    if (!cell || cell.type !== 'prop' || state.owners[cellIdx] !== playerId) return false;
    if (!isMonopoly(state, cell.region, playerId)) return false;
    const regionCells = VS.CELLS.filter(c => c.region === cell.region && c.type === 'prop');
    if (regionCells.some(c => state.mortgaged[c.i])) return false;
    const myH = state.houses[cellIdx] || 0;
    if (myH >= 5) return false;
    // Правило равномерной стройки: строить только там, где домов столько же, сколько у наименее застроенной
    const minH = Math.min(...regionCells.map(c => state.houses[c.i] || 0));
    return myH === minH;
  }

  // Продавать можно только с самой застроенной клетки группы (равномерность)
  function canSellHouse(state, cellIdx, playerId) {
    const cell = VS.CELLS[cellIdx];
    if (!cell || cell.type !== 'prop' || state.owners[cellIdx] !== playerId) return false;
    const myH = state.houses[cellIdx] || 0;
    if (myH <= 0) return false;
    const myRegionCells = VS.CELLS.filter(c =>
      c.region === cell.region && c.type === 'prop' && state.owners[c.i] === playerId);
    const maxH = Math.max(...myRegionCells.map(c => state.houses[c.i] || 0));
    return myH === maxH;
  }

  function nextActiveIdx(state, from) {
    const n = state.players.length;
    for (let k = 1; k <= n; k++) {
      const idx = (from + k) % n;
      if (!state.players[idx].bankrupt) return idx;
    }
    return from;
  }

  // Следующий участник аукциона (не спасовавший, не банкрот), начиная с from+1
  function nextAuctionTurn(state, auction, from) {
    const n = state.players.length;
    for (let k = 1; k <= n; k++) {
      const idx = (from + k) % n;
      const pl = state.players[idx];
      if (!pl.bankrupt && !auction.passed.includes(pl.id)) return idx;
    }
    return -1; // больше некому
  }

  /* ══════════════ РЕШЕНИЯ ИИ ══════════════ */
  function botWantsToBuy(state, pIdx, cellIdx, rng) {
    const r = rng || Math.random;
    const pl = state.players[pIdx];
    const cell = VS.CELLS[cellIdx];
    if (pl.balance < cell.price + 120) return false;
    let score = 0.55;
    if (cell.type === 'prop') {
      const have = ownedInRegion(state, cell.region, pl.id);
      score += have * 0.22;
      const total = VS.CELLS.filter(c => c.region === cell.region && c.type === 'prop').length;
      if (have === total - 1) score += 0.25;
    } else {
      score += 0.15;
    }
    if (pl.balance > cell.price * 4) score += 0.15;
    return r() < Math.min(0.95, score);
  }

  function tradeValueFor(gainCells, loseCells, moneyDelta) {
    const val = (idx) => (VS.CELLS[idx].price || 0);
    const g = gainCells.reduce((s, i) => s + val(i), 0);
    const l = loseCells.reduce((s, i) => s + val(i), 0);
    return g - l + moneyDelta;
  }

  function partnerAcceptsTrade(state, trade) {
    const net = tradeValueFor(trade.give, trade.get, trade.money);
    return net >= -20;
  }

  /**
   * botAuctionBid(state, pIdx, cellIdx, rng) → { bid: number } | { pass: true }
   */
  function botAuctionBid(state, pIdx, cellIdx, rng) {
    const r = rng || Math.random;
    const pl = state.players[pIdx];
    const cell = VS.CELLS[cellIdx];
    const highBid = state.auction ? state.auction.highBid : 0;

    // Потолок желания (max willing to pay)
    let ceiling = cell.price || 0;
    if (cell.type === 'prop') {
      const have = ownedInRegion(state, cell.region, pl.id);
      const total = VS.CELLS.filter(c => c.region === cell.region && c.type === 'prop').length;
      if (have === total - 1) ceiling = Math.round(cell.price * 1.2); // почти монополия
      else if (have > 0)     ceiling = Math.round(cell.price * 1.1);
    } else if (cell.type === 'air') {
      const airs = countAirports(state, pl.id);
      ceiling = cell.price + airs * 30;
    } else if (cell.type === 'util') {
      const utils = countUtils(state, pl.id);
      ceiling = utils > 0 ? Math.round(cell.price * 1.1) : Math.round(cell.price * 0.85);
    }
    // Никогда не уходить в минус ниже порога
    ceiling = Math.min(ceiling, pl.balance - 50);

    if (ceiling <= 0 || highBid >= ceiling) return { pass: true };

    const step = Math.max(10, Math.round((cell.price || 100) * 0.1));
    const bid  = Math.min(ceiling, highBid + step);
    if (bid <= highBid) return { pass: true };
    // Лёгкая рандомизация: иногда пасуем даже при возможной ставке
    if (r() < 0.12) return { pass: true };
    return { bid };
  }

  /* ══════════════ ИЗМЕНЕНИЕ БАЛАНСА ══════════════ */
  function adjustBalance(state, pIdx, delta) {
    return { ...state, players: state.players.map((p, i) =>
      i === pIdx ? { ...p, balance: p.balance + delta } : p) };
  }

  function gain(state, pIdx, amount, logType) {
    let s = adjustBalance(state, pIdx, amount);
    if (logType) s = withLog(s, { type: logType, player: pIdx, amount });
    return s;
  }

  // авто-залог/продажа домов для покрытия суммы need; возвращает state с максимальным балансом
  function autoRaiseFunds(state, pIdx, need) {
    let s = state;
    const id = s.players[pIdx].id;
    let guard = 0;
    while (s.players[pIdx].balance < need && guard++ < 60) {
      // Продаём дома там, где canSellHouse=true
      const withHouses = Object.keys(s.houses)
        .filter(idx => s.owners[idx] === id && (s.houses[idx] || 0) > 0 && canSellHouse(s, Number(idx), id))
        .sort((a, b) => (VS.CELLS[b].price || 0) - (VS.CELLS[a].price || 0));
      if (withHouses.length) { s = sellHouse(s, Number(withHouses[0])); continue; }
      // Закладываем (только если в группе нет домов — проверка внутри mortgage)
      const mortgageable = Object.keys(s.owners)
        .filter(idx => s.owners[idx] === id && !s.mortgaged[idx] && !(s.houses[idx] > 0))
        .sort((a, b) => (VS.CELLS[a].price || 0) - (VS.CELLS[b].price || 0));
      if (mortgageable.length) { s = mortgage(s, Number(mortgageable[0])); continue; }
      break;
    }
    return s;
  }

  // платёж (в банк, если toIdx == null). Авто-залог; при нехватке — банкротство.
  function payment(state, pIdx, amount, toIdx) {
    let s = autoRaiseFunds(state, pIdx, amount);
    const have = s.players[pIdx].balance;
    const broke = have < amount;
    const paid  = broke ? Math.max(0, have) : amount;
    s = {
      ...s,
      players: s.players.map((p, i) => {
        if (i === pIdx)                return { ...p, balance: p.balance - paid };
        if (toIdx != null && i === toIdx) return { ...p, balance: p.balance + paid };
        return p;
      }),
    };
    if (broke) s = bankrupt(s, pIdx, toIdx);
    return s;
  }

  function bankrupt(state, pIdx, toIdx) {
    const loser = state.players[pIdx];
    const toId  = toIdx != null ? state.players[toIdx].id : null;
    const owners   = { ...state.owners };
    const houses   = { ...state.houses };
    const mortgaged = { ...state.mortgaged };
    Object.keys(owners).forEach(idx => {
      if (owners[idx] !== loser.id) return;
      if (toId) owners[idx] = toId; else delete owners[idx];
      delete houses[idx];
      if (!toId) delete mortgaged[idx];
    });
    let s = {
      ...state, owners, houses, mortgaged,
      players: state.players.map((p, i) => i === pIdx ? { ...p, bankrupt: true, balance: 0 } : p),
      toast: `💀 ${loser.name} разорился`,
    };
    s = withLog(s, { type: 'bankrupt', player: pIdx });
    return checkWin(s);
  }

  function checkWin(state) {
    const alive = state.players.filter(p => !p.bankrupt);
    if (alive.length === 1) {
      return { ...state, winner: alive[0].id, phase: 'over', hint: `🏆 ${alive[0].name} побеждает!` };
    }
    return state;
  }

  /* ══════════════ СОБСТВЕННОСТЬ ══════════════ */

  // Купить за произвольную цену (используется аукционом)
  function buyAt(state, pIdx, cellIdx, price) {
    const cell = VS.CELLS[cellIdx];
    const pl   = state.players[pIdx];
    let s = {
      ...state,
      players: state.players.map((p, i) => i === pIdx ? { ...p, balance: p.balance - price } : p),
      owners:  { ...state.owners, [cellIdx]: pl.id },
      hint:  `${pl.name} купил ${cell.name} за ${money(price)}`,
      toast: `🏆 ${cell.name} — ${pl.name} (${money(price)})`,
    };
    return withLog(s, { type: 'auction', player: pIdx, property: cell.name, amount: price });
  }

  function buyProperty(state, pIdx, cellIdx) {
    const cell = VS.CELLS[cellIdx];
    const pl   = state.players[pIdx];
    if (pl.balance < cell.price) return state;
    let s = {
      ...state,
      players: state.players.map((p, i) => i === pIdx ? { ...p, balance: p.balance - cell.price } : p),
      owners:  { ...state.owners, [cellIdx]: pl.id },
      hint:  `${pl.name} купил ${cell.name}`,
      toast: `${cell.name} — твой!`,
    };
    return withLog(s, { type: 'buy', player: pIdx, property: cell.name, amount: cell.price });
  }

  function buildHouse(state, cellIdx) {
    const pIdx = state.players.findIndex(p => p.id === state.owners[cellIdx]);
    if (pIdx < 0) return state;
    const id = state.players[pIdx].id;
    if (!canBuild(state, cellIdx, id)) return state;
    const cost  = houseCost(cellIdx);
    if (cost <= 0) return state;
    if (state.players[pIdx].balance < cost) return { ...state, toast: 'Недостаточно денег' };

    const prevH  = state.houses[cellIdx] || 0;
    const nextH  = prevH + 1;
    const isHotel = nextH === 5;
    const bank   = { ...(state.bank || { houses: 32, hotels: 12 }) };

    if (isHotel) {
      if (bank.hotels <= 0) return { ...state, toast: 'Отели в банке закончились' };
      bank.hotels -= 1;
      bank.houses  = Math.min(32, bank.houses + 4); // 4 дома возвращаются в банк
    } else {
      if (bank.houses <= 0) return { ...state, toast: 'Дома в банке закончились' };
      bank.houses -= 1;
    }

    let s = {
      ...state, bank,
      players: state.players.map((p, i) => i === pIdx ? { ...p, balance: p.balance - cost } : p),
      houses:  { ...state.houses, [cellIdx]: nextH },
      toast:   isHotel ? '🏨 Отель построен!' : '🏠 Дом построен',
    };
    return withLog(s, { type: 'build', player: pIdx, property: VS.CELLS[cellIdx].name, amount: cost });
  }

  function sellHouse(state, cellIdx) {
    const pIdx = state.players.findIndex(p => p.id === state.owners[cellIdx]);
    if (pIdx < 0) return state;
    const id = state.players[pIdx].id;
    if (!canSellHouse(state, cellIdx, id)) return state; // безопасная защита
    const prevH = state.houses[cellIdx] || 0;
    if (prevH <= 0) return state;

    const refund = Math.round(houseCost(cellIdx) * 0.5);
    const nextH  = prevH - 1;
    const bank   = { ...(state.bank || { houses: 32, hotels: 12 }) };

    if (prevH === 5) {
      // Отель → 4 дома: банк получает отель, отдаёт 4 дома
      bank.hotels  = Math.min(12, bank.hotels + 1);
      bank.houses  = Math.max(0,  bank.houses - 4);
    } else {
      bank.houses = Math.min(32, bank.houses + 1);
    }

    const h = { ...state.houses, [cellIdx]: nextH };
    if (h[cellIdx] <= 0) delete h[cellIdx];
    return {
      ...state, bank,
      players: state.players.map((p, i) => i === pIdx ? { ...p, balance: p.balance + refund } : p),
      houses: h,
    };
  }

  function mortgage(state, cellIdx) {
    const pIdx = state.players.findIndex(p => p.id === state.owners[cellIdx]);
    if (pIdx < 0 || state.mortgaged[cellIdx] || (state.houses[cellIdx] || 0) > 0) return state;
    // Блокируем залог, если в ЭТОЙ группе есть дома хотя бы на одной клетке
    const cell = VS.CELLS[cellIdx];
    if (cell.region) {
      const regionCells = VS.CELLS.filter(c => c.region === cell.region && c.type === 'prop');
      if (regionCells.some(c => (state.houses[c.i] || 0) > 0)) {
        return { ...state, toast: 'Сначала продайте дома в группе' };
      }
    }
    const value = Math.round((VS.CELLS[cellIdx].price || 0) * 0.5);
    let s = {
      ...state,
      players:   state.players.map((p, i) => i === pIdx ? { ...p, balance: p.balance + value } : p),
      mortgaged: { ...state.mortgaged, [cellIdx]: true },
    };
    return withLog(s, { type: 'mortgage', player: pIdx, property: VS.CELLS[cellIdx].name, amount: value });
  }

  function redeem(state, cellIdx) {
    const pIdx = state.players.findIndex(p => p.id === state.owners[cellIdx]);
    if (pIdx < 0 || !state.mortgaged[cellIdx]) return state;
    const cost = Math.round((VS.CELLS[cellIdx].price || 0) * 0.55);
    if (state.players[pIdx].balance < cost) return { ...state, toast: 'Недостаточно денег' };
    const m = { ...state.mortgaged }; delete m[cellIdx];
    return {
      ...state,
      players:   state.players.map((p, i) => i === pIdx ? { ...p, balance: p.balance - cost } : p),
      mortgaged: m,
      toast: 'Выкуплено из залога',
    };
  }

  /* ══════════════ ТЮРЬМА ══════════════ */
  function sendToJail(state, pIdx) {
    let s = {
      ...state,
      players: state.players.map((p, i) =>
        i === pIdx ? { ...p, pos: 10, inJail: true, jailTurns: 0 } : p),
      doubleCount: 0, lastDouble: false,
      hint:  `${state.players[pIdx].name} отправляется в тюрьму!`,
      toast: '🚔 В тюрьму!',
    };
    return withLog(s, { type: 'jail', player: pIdx });
  }

  /* ══════════════ ПЛАТЕЖИ ВЫСОКОГО УРОВНЯ ══════════════ */
  function payRent(state, fromIdx, toId, amount, property) {
    const toIdx = state.players.findIndex(p => p.id === toId);
    let s = { ...state, hint: `${state.players[fromIdx].name} платит аренду ${money(amount)} → ${state.players[toIdx].name}` };
    s = payment(s, fromIdx, amount, toIdx);
    return withLog(s, { type: 'rent', from: fromIdx, to: toIdx, property, amount });
  }

  function payTax(state, pIdx, amount) {
    let s = { ...state, hint: `${state.players[pIdx].name} платит налог ${money(amount)}` };
    s = payment(s, pIdx, amount, null);
    return withLog(s, { type: 'tax', player: pIdx, amount });
  }

  /* ══════════════ КАРТЫ ══════════════ */
  function applyCardEffect(state, card, pIdx) {
    let s = state;
    if (typeof card.money === 'number' && card.money !== 0) {
      s = card.money > 0 ? gain(s, pIdx, card.money, 'card') : payment(s, pIdx, -card.money, null);
    }
    if (card.houseTax) s = payment(s, pIdx, card.houseTax * countHouses(s, pIdx), null);
    if (card.collectEach) {
      s.players.forEach((p, i) => { if (i !== pIdx && !p.bankrupt) s = payment(s, i, card.collectEach, pIdx); });
    }
    if (card.payEach) {
      s.players.forEach((p, i) => { if (i !== pIdx && !p.bankrupt) s = payment(s, pIdx, card.payEach, i); });
    }
    if (card.bail) {
      s = { ...s, players: s.players.map((p, i) => i === pIdx ? { ...p, bailCards: (p.bailCards || 0) + 1 } : p) };
    }
    if (card.jail) return { state: s, control: { jail: true } };
    if (typeof card.move === 'number') return { state: s, control: { move: card.move, passStart: card.forceLand } };
    if (typeof card.moveBy === 'number') return { state: s, control: { moveBy: card.moveBy } };
    return { state: s, control: null };
  }

  function drawRandomCard(deck, rng) {
    return deck[Math.floor((rng || Math.random)() * deck.length)];
  }

  /* ══════════════ ОБМЕНЫ ══════════════ */
  function applyTrade(state, meIdx, partnerIdx, give, get, moneyDelta) {
    const owners = { ...state.owners };
    give.forEach(i => owners[i] = state.players[partnerIdx].id);
    get.forEach(i  => owners[i] = state.players[meIdx].id);
    let s = {
      ...state, owners, trade: null,
      players: state.players.map((p, i) => {
        if (i === meIdx)      return { ...p, balance: p.balance - moneyDelta };
        if (i === partnerIdx) return { ...p, balance: p.balance + moneyDelta };
        return p;
      }),
      toast: `🤝 Обмен с ${state.players[partnerIdx].name} совершён`,
    };
    return withLog(s, { type: 'trade', from: meIdx, to: partnerIdx, amount: moneyDelta });
  }

  /* ══════════════ ПЕРЕМЕЩЕНИЕ ══════════════ */
  function moveTo(state, pIdx, target, passStart) {
    const cur    = state.players[pIdx].pos;
    const passed = passStart && target < cur;
    return {
      ...state,
      players: state.players.map((p, i) =>
        i === pIdx ? { ...p, pos: target, balance: p.balance + (passed ? 200 : 0) } : p),
    };
  }

  // один шаг пешки вперёд; +200 при прохождении старта
  function stepOne(state, pIdx) {
    const cur     = state.players[pIdx].pos;
    const newPos  = (cur + 1) % 40;
    const passedStart = newPos < cur;
    let s = {
      ...state,
      players: state.players.map((p, i) =>
        i === pIdx ? { ...p, pos: newPos, balance: p.balance + (passedStart ? 200 : 0) } : p),
    };
    if (passedStart) s = withLog(s, { type: 'start', player: pIdx, amount: 200 });
    return s;
  }

  // мгновенное относительное смещение без бонуса (отрицательные шаги)
  function shiftBy(state, pIdx, steps) {
    return {
      ...state,
      players: state.players.map((p, i) =>
        i === pIdx ? { ...p, pos: (p.pos + steps + 40) % 40 } : p),
    };
  }

  function recordHistory(state) {
    return { ...state, history: [...state.history, state.players.map(p => p.balance)].slice(-60) };
  }

  /* ══════════════ АУКЦИОН ══════════════ */

  /**
   * startAuction(state, cellIdx, declinerIdx)
   * Запускает аукцион после отказа от покупки. Ход начинается у отказавшегося.
   */
  function startAuction(state, cellIdx, declinerIdx) {
    const cell   = VS.CELLS[cellIdx];
    const turnIdx = state.players[declinerIdx].bankrupt
      ? nextActiveIdx(state, declinerIdx)
      : declinerIdx;
    return {
      ...state,
      phase: 'auction',
      lastDouble: false,
      auction: {
        cellIdx,
        highBid:    0,
        highBidder: null,
        turnIdx,
        passed:     [],
        startedBy:  declinerIdx,
      },
      hint:  `Аукцион: ${cell.name} (базовая цена ${money(cell.price)})`,
      toast: `🏦 Аукцион на ${cell.name}!`,
    };
  }

  /**
   * auctionBid(state, pIdx, amount) → newState
   * Ставка. Передаёт ход следующему участнику.
   */
  function auctionBid(state, pIdx, amount) {
    const { auction } = state;
    if (!auction || state.phase !== 'auction') return state;
    if (auction.turnIdx !== pIdx) return state;
    const pl = state.players[pIdx];
    if (pl.bankrupt || auction.passed.includes(pl.id)) return state;
    if (amount <= auction.highBid)
      return { ...state, toast: 'Ставка должна быть выше текущей' };
    if (amount > pl.balance)
      return { ...state, toast: 'Недостаточно средств' };

    const newAuction = { ...auction, highBid: amount, highBidder: pl.id };
    const next = nextAuctionTurn(state, newAuction, pIdx);
    if (next === -1) {
      // Никого больше нет — немедленно разыгрываем
      return resolveAuction({ ...state, auction: newAuction });
    }
    return {
      ...state,
      auction: { ...newAuction, turnIdx: next },
      hint: `${pl.name} ставит ${money(amount)} — ход у ${state.players[next].name}`,
    };
  }

  /**
   * auctionPass(state, pIdx) → newState
   * Игрок пасует. Если активных ≤ 1 — завершаем аукцион.
   */
  function auctionPass(state, pIdx) {
    const { auction } = state;
    if (!auction || state.phase !== 'auction') return state;
    if (auction.turnIdx !== pIdx) return state;
    const pl = state.players[pIdx];

    const newPassed  = [...auction.passed, pl.id];
    const tempAuction = { ...auction, passed: newPassed };
    const active = state.players.filter(p => !p.bankrupt && !newPassed.includes(p.id));

    if (active.length <= 1) {
      if (auction.highBidder) {
        return resolveAuction({ ...state, auction: tempAuction });
      }
      return {
        ...state,
        phase:   'idle', auction: null,
        hint:    'Никто не купил — клетка осталась ничьей',
        toast:   'Никто не купил',
      };
    }

    const next = nextAuctionTurn(state, tempAuction, pIdx);
    return {
      ...state,
      auction: { ...tempAuction, turnIdx: next },
      hint: `${pl.name} пасует — ход у ${state.players[next].name}`,
    };
  }

  // Внутренняя функция — завершение аукциона с победителем
  function resolveAuction(state) {
    const { auction } = state;
    const winnerIdx = state.players.findIndex(p => p.id === auction.highBidder);
    if (winnerIdx < 0) {
      return { ...state, phase: 'idle', auction: null, toast: 'Аукцион завершён без победителя' };
    }
    let s = buyAt(state, winnerIdx, auction.cellIdx, auction.highBid);
    s = { ...s, auction: null, phase: 'idle' };
    return s;
  }

  /* ══════════════ ЭКСПОРТ ══════════════ */
  window.VSEngine = {
    // константы/конфиг
    START_BALANCE, POOL, CHANCE_CARDS, CHEST_CARDS, money,
    // setup
    init, rollDie, drawRandomCard,
    // запросы
    isMonopoly, calcRent, houseCost, countHouses, countAirports, countUtils,
    ownedInRegion, liquidWorth, groupHouseCounts,
    canBuild, canSellHouse, nextActiveIdx, tradeValueFor,
    botWantsToBuy, partnerAcceptsTrade, botAuctionBid,
    // транзиции — собственность
    gain, payment, bankrupt, checkWin,
    buyAt, buyProperty, buildHouse, sellHouse, mortgage, redeem,
    // транзиции — тюрьма, оплаты, карты, обмены
    sendToJail, payRent, payTax, applyCardEffect, applyTrade,
    // транзиции — перемещение
    moveTo, stepOne, shiftBy, recordHistory, withLog,
    // транзиции — аукцион
    startAuction, auctionBid, auctionPass,
  };
})();
