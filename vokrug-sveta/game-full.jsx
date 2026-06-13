/* game-full.jsx — ОРКЕСТРАТОР игры (React-слой).
   Правила вынесены в чистый модуль window.VSEngine (engine.js).
   Здесь — только то, чего нет в чистом движке: React-состояние, анимации,
   тайминги, ходы ботов и RNG. Все мутации правил делегируются движку. */
const { useState, useRef, useEffect } = React;
const Board = window.VSBoard.Board;
const E = window.VSEngine;

// функция-объявление (не const) — чтобы не конфликтовать с money из panels.jsx
function money(n) { return E.money(n); }

/* ---------- ИГРОВОЙ ХУК (тонкий оркестратор) ---------- */
function useGame(count) {
  const [state, setState] = useState(() => E.init(count));
  const ref = useRef(state);
  ref.current = state;

  const timers = useRef([]);
  const after = (ms, fn) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
    return t;
  };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // set принимает либо патч-объект, либо функцию state→(полное состояние | патч)
  const set = (patch) =>
    setState(s => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }));

  // тосты и карточки гаснут сами — освобождает движок от тайм-менеджмента
  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => set({ toast: null }), 1500);
    return () => clearTimeout(t);
  }, [state.toast]);
  useEffect(() => {
    if (!state.card) return;
    const t = setTimeout(() => set({ card: null }), 2600);
    return () => clearTimeout(t);
  }, [state.card]);

  /* ---------- бросок кубиков ---------- */
  function rollDice() {
    const s = ref.current;
    if (s.phase !== 'idle' && s.phase !== 'jail') return;
    if (s.players[s.current].bankrupt) { endTurn(); return; }
    window.haptic?.('impact', 'medium');

    set({ rolling: true, phase: 'rolling', hint: 'кубики катятся…' });

    let j = 0;
    const jit = () => {
      set({ dice: [E.rollDie(), E.rollDie()] });
      if (j++ < 9) after(130, jit);
    };
    jit();

    after(1500, () => {
      const d = [E.rollDie(), E.rollDie()];
      const isDouble = d[0] === d[1];
      const st0 = ref.current;
      const cur = st0.current;
      const jailedNow = st0.players[cur].inJail;

      // --- ход из тюрьмы ---
      if (jailedNow) {
        if (isDouble) {
          set(st => ({
            dice: d, rolling: false, doubleCount: 0, lastDouble: false, phase: 'moving',
            players: st.players.map((p, i) => i === cur ? { ...p, inJail: false, jailTurns: 0 } : p),
            hint: 'Дубль! Выходишь из тюрьмы.',
          }));
          after(300, () => stepMove(cur, d[0] + d[1]));
        } else {
          const turns = (st0.players[cur].jailTurns || 0) + 1;
          const mustPay = turns >= 3;
          set(st => ({
            dice: d, rolling: false, lastDouble: false, phase: mustPay ? 'moving' : 'idle',
            players: st.players.map((p, i) =>
              i === cur
                ? (mustPay ? { ...p, inJail: false, jailTurns: 0, balance: p.balance - 50 } : { ...p, jailTurns: turns })
                : p),
            hint: mustPay ? 'Третий ход в тюрьме — платишь 50 и ходишь.' : `Не дубль. Сидишь в тюрьме (ход ${turns}/3).`,
          }));
          if (mustPay) after(300, () => stepMove(cur, d[0] + d[1]));
          else after(900, endTurn);
        }
        return;
      }

      // --- обычный ход ---
      let toJail = false;
      set(st => {
        let dc = st.doubleCount;
        if (isDouble) { dc++; if (dc >= 3) toJail = true; } else dc = 0;
        return { dice: d, rolling: false, doubleCount: toJail ? 0 : dc, lastDouble: isDouble && !toJail, phase: toJail ? 'idle' : 'moving' };
      });

      if (toJail) { jailAndEnd(cur); return; }
      after(300, () => stepMove(cur, d[0] + d[1]));
    });
  }

  /* ---------- анимация перемещения (по клетке за кадр) ---------- */
  function stepMove(pIdx, steps) {
    let left = steps;
    const hop = () => {
      set(s => ({ ...E.stepOne(s, pIdx), hoppingId: s.players[pIdx].id }));
      left--;
      if (left > 0) after(280, hop);
      else after(400, () => { set({ hoppingId: null }); land(pIdx); });
    };
    hop();
  }

  // в тюрьму + завершить ход (3 дубля / Карантин / карта)
  function jailAndEnd(pIdx) {
    set(s => E.sendToJail(s, pIdx));
    after(1200, endTurn);
  }

  /* ---------- приземление ---------- */
  function land(pIdx) {
    const s = ref.current;
    const pl = s.players[pIdx];
    const pos = pl.pos;
    const cell = VS.CELLS[pos];
    const isHuman = pIdx === 0;
    const ownerId = s.owners[pos];
    const buyable = cell.type === 'prop' || cell.type === 'air' || cell.type === 'util';
    const diceSum = s.dice[0] + s.dice[1];

    if (isHuman) {
      if (buyable && !ownerId && !s.mortgaged[pos]) {
        set({ phase: 'buy', landed: pos, hint: `${cell.name} свободен. Купить за ${money(cell.price)}?` });
      } else if (buyable && ownerId === 'you') {
        set({ phase: 'own', landed: pos, hint: `${cell.name} — твой город.` });
      } else if (buyable && ownerId) {
        const op = s.players.find(p => p.id === ownerId);
        const rentAmount = E.calcRent(s, cell, ownerId, diceSum);
        set({ phase: 'rent', landed: pos, rentDue: rentAmount, hint: `${cell.name} — ${op.name}. Аренда ${money(rentAmount)}.` });
      } else if (cell.type === 'tax') {
        set(st => E.payTax(st, pIdx, cell.amount));
        set({ phase: 'special', landed: pos, hint: `${cell.name}: списано ${money(cell.amount)}.` });
      } else if (cell.type === 'chance') {
        drawCard('chance', pIdx, true);
      } else if (cell.type === 'chest') {
        drawCard('chest', pIdx, true);
      } else if (cell.type === 'corner' && cell.kind === 'gotojail') {
        jailAndEnd(pIdx);
      } else if (cell.type === 'corner' && cell.kind === 'jail') {
        set({ phase: 'special', landed: pos, hint: 'Транзит — просто отдыхаешь, можно ехать дальше.' });
      } else {
        set({ phase: 'special', landed: pos, hint: cell.name });
      }
      return;
    }

    // БОТ / соперник — авто-логика
    if (buyable && !ownerId && !s.mortgaged[pos]) {
      if (E.botWantsToBuy(s, pIdx, pos)) {
        set(st => E.buyProperty(st, pIdx, pos));
      } else {
        // По канону: отказ → аукцион
        set(st => E.startAuction(st, pos, pIdx));
        return; // аукцион сам управляет ходом через useEffect
      }
    } else if (buyable && ownerId && ownerId !== pl.id) {
      const rentAmount = E.calcRent(s, cell, ownerId, diceSum);
      set(st => E.payRent(st, pIdx, ownerId, rentAmount, cell.name));
    } else if (cell.type === 'tax') {
      set(st => E.payTax(st, pIdx, cell.amount));
    } else if (cell.type === 'chance') {
      if (drawCard('chance', pIdx, false)) return;
    } else if (cell.type === 'chest') {
      if (drawCard('chest', pIdx, false)) return;
    } else if (cell.type === 'corner' && cell.kind === 'gotojail') {
      jailAndEnd(pIdx); return;
    }

    if (ref.current.winner) return;
    botMaybeBuild(pIdx);
    after(1350, endTurn);
  }

  /* ---------- карты ---------- */
  // движение/тюрьма по карте определяем синхронно из полей карты
  function cardControl(card) {
    if (card.jail) return { jail: true };
    if (typeof card.move === 'number') return { move: card.move, passStart: card.forceLand };
    if (typeof card.moveBy === 'number') return { moveBy: card.moveBy };
    return null;
  }

  // тянем карту; возвращает true, если карта сама доигрывает ход (перемещение/тюрьма)
  function drawCard(kind, pIdx, isHuman) {
    const deck = kind === 'chance' ? E.CHANCE_CARDS : E.CHEST_CARDS;
    const card = E.drawRandomCard(deck);
    const kcard = { ...card, kind }; // kind → цвет карточки как у колоды на доске
    set(st => E.applyCardEffect(st, card, pIdx).state); // экономический эффект
    const control = cardControl(card);

    if (control && control.jail) { if (isHuman) set({ card: kcard }); jailAndEnd(pIdx); return true; }
    if (control && typeof control.move === 'number') {
      if (isHuman) set({ card: kcard });
      set(st => E.moveTo(st, pIdx, control.move, control.passStart));
      after(260, () => land(pIdx));
      return true;
    }
    if (control && typeof control.moveBy === 'number') {
      if (isHuman) set({ card: kcard });
      if (control.moveBy > 0) stepMove(pIdx, control.moveBy);
      else { set(st => E.shiftBy(st, pIdx, control.moveBy)); after(260, () => land(pIdx)); }
      return true;
    }
    // без перемещения
    if (isHuman) set({ phase: 'special', card: kcard, hint: card.text });
    else set({ toast: card.text });
    return false;
  }

  /* ---------- завершение хода ---------- */
  function endTurn() {
    const s = ref.current;
    if (s.winner) { set({ phase: 'over' }); return; }

    if (s.lastDouble && !s.players[s.current].inJail) {
      set({ phase: 'idle', landed: null, rentDue: 0, lastDouble: false, hint: 'Дубль! Ещё ход.' });
      maybeBotRoll(s.current);
      return;
    }

    const next = E.nextActiveIdx(s, s.current);
    set(st => ({
      ...E.recordHistory(st),
      current: next, phase: 'idle', landed: null, rentDue: 0,
      doubleCount: 0, lastDouble: false, hint: `${st.players[next].name} ходит…`,
      turnNum: (st.turnNum || 0) + 1,
    }));
    maybeBotRoll(next);
  }

  // все игроки кроме 'you' (id) ходят автоматически
  function maybeBotRoll(idx) {
    const p = ref.current.players[idx];
    if (p && p.id !== 'you' && !p.bankrupt) {
      after(950, () => {
        if (ref.current.phase === 'idle' && ref.current.current === idx) {
          // ~60% chance: attempt bot trade before rolling
          if (Math.random() < 0.6) {
            const trade = E.botProposeTrade(ref.current, idx, Math.random);
            if (trade) {
              const partnerPlayer = ref.current.players[trade.partnerIdx];
              if (partnerPlayer && partnerPlayer.id === 'you') {
                // Human is the trade partner — pause and wait for consent
                set({
                  incomingTrade: {
                    fromIdx: trade.meIdx,
                    partnerIdx: trade.partnerIdx,
                    give: trade.give,
                    get: trade.get,
                    money: trade.money,
                  },
                });
                return; // не бросаем кубики — ждём ответа человека
              } else {
                // Bot-to-bot trade — apply automatically
                set(st => {
                  const next = E.applyTrade(st, trade.meIdx, trade.partnerIdx, trade.give, trade.get, trade.money);
                  return { ...next, toast: `🤝 ${st.players[trade.meIdx].name} обменялся с ${st.players[trade.partnerIdx].name}` };
                });
              }
            }
          }
          rollDice();
        }
      });
    }
  }

  // авто-ставки ботов в аукционе (useEffect запускается при смене turnIdx)
  const _auctionKey = state.phase === 'auction' ? (state.auction?.turnIdx ?? -1) : -1;
  useEffect(() => {
    if (_auctionKey < 0 || _auctionKey === 0) return; // не аукцион или ход человека
    const pl = ref.current.players[_auctionKey];
    if (!pl || pl.bankrupt) return;
    after(750, () => {
      const st = ref.current;
      if (st.phase !== 'auction' || !st.auction || st.auction.turnIdx !== _auctionKey) return;
      const result = E.botAuctionBid(st, _auctionKey, st.auction.cellIdx);
      const next = result.pass
        ? E.auctionPass(st, _auctionKey)
        : E.auctionBid(st, _auctionKey, result.bid);
      set(next);
      if (next.phase !== 'auction') after(350, endTurn);
    });
  }, [_auctionKey]);

  // бот достраивает монополии по стилю
  function botMaybeBuild(pIdx) {
    const pl = ref.current.players[pIdx];
    if (pl.id === 'you') return;
    const style = E.getStyle(pl);
    // Используем функциональный апдейт, чтобы не перезаписать изменения человека
    set(st => {
      let s2 = st;
      let guard = 0;
      while (guard++ < 30) {
        const eligible = Object.keys(s2.owners)
          .map(Number)
          .filter(idx => {
            if (s2.owners[idx] !== s2.players[pIdx].id) return false;
            if (!E.canBuild(s2, idx, s2.players[pIdx].id)) return false;
            const cost = E.houseCost(idx);
            if (s2.players[pIdx].balance - cost < style.buildBuffer) return false;
            if ((s2.houses[idx] || 0) >= style.maxHouses) return false;
            return true;
          });
        if (eligible.length === 0) break;
        eligible.sort((a, b) => (s2.houses[a] || 0) - (s2.houses[b] || 0));
        s2 = E.buildHouse(s2, eligible[0]);
      }
      return s2;
    });
  }

  /* ---------- действия человека ---------- */
  function buy() { window.haptic?.('notify', 'success'); set(st => E.buyProperty(st, 0, st.landed)); after(300, endTurn); }
  function pass() {
    // Отказ от покупки → запускаем аукцион (канон)
    set(st => E.startAuction(st, st.landed, 0));
    // Если ход сразу у бота — useEffect подхватит
  }
  function payRentDue() {
    const s = ref.current;
    const ownerId = s.owners[s.landed];
    window.haptic?.('notify', 'warning');
    set(st => E.payRent(st, 0, ownerId, st.rentDue, VS.CELLS[st.landed].name));
    after(1500, endTurn);
  }

  /* ---------- аукцион ---------- */
  function doAuctionBid(amount) {
    const s = ref.current;
    if (s.phase !== 'auction' || !s.auction || s.auction.turnIdx !== 0) return;
    if (amount <= s.auction.highBid || amount > s.players[0].balance) return;
    const next = E.auctionBid(s, 0, amount);
    set(next);
    if (next.phase !== 'auction') after(350, endTurn);
  }
  function doAuctionPass() {
    const s = ref.current;
    if (s.phase !== 'auction' || !s.auction || s.auction.turnIdx !== 0) return;
    const next = E.auctionPass(s, 0);
    set(next);
    if (next.phase !== 'auction') after(350, endTurn);
  }
  function handleBoardTap(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const xPct = ((e.clientX - rect.left) / rect.width) * 100;
    const yPct = ((e.clientY - rect.top) / rect.height) * 100;
    // находим ближайшую клетку
    let nearestCell = 0, minDist = Infinity;
    VS.CELLS.forEach(cell => {
      const c = VS.cellCenter(cell.i);
      const d = Math.hypot(c.left - xPct, c.top - yPct);
      if (d < minDist) { minDist = d; nearestCell = cell.i; }
    });
    set(st => {
      if (!st.zoom) return { zoom: true, zoomCell: nearestCell };
      if (st.zoomCell === nearestCell) return { zoom: false, zoomCell: null };
      return { zoomCell: nearestCell };
    });
  }

  /* ---------- управление собственностью (из Портфеля) ---------- */
  function buildHouse(cellIdx) { set(st => E.buildHouse(st, cellIdx)); }
  function sellHouse(cellIdx) { set(st => E.sellHouse(st, cellIdx)); set({ toast: 'Дом продан' }); }
  function mortgage(cellIdx) { set(st => E.mortgage(st, cellIdx)); }
  function redeem(cellIdx) { set(st => E.redeem(st, cellIdx)); }

  /* ---------- тюрьма: ручной выход ---------- */
  function payBail() {
    const s = ref.current;
    const idx = s.current;
    if (!s.players[idx].inJail) return;
    set(st => E.payment(st, idx, 50, null));
    set(st => ({
      players: st.players.map((p, i) => i === idx ? { ...p, inJail: false, jailTurns: 0 } : p),
      hint: 'Залог уплачен — можешь бросать кубики.',
    }));
  }
  function useBailCard() {
    const s = ref.current;
    const idx = s.current;
    if (!s.players[idx].inJail || (s.players[idx].bailCards || 0) <= 0) return;
    set(st => ({
      players: st.players.map((p, i) =>
        i === idx ? { ...p, inJail: false, jailTurns: 0, bailCards: p.bailCards - 1 } : p),
      hint: 'Карта «выход из тюрьмы» использована.',
    }));
  }

  /* ---------- обмены ---------- */
  function openTrade(withId) {
    const s = ref.current;
    if (!s.players.find(p => p.id === withId)) return;
    set({ trade: { withId, give: [], get: [], money: 0 } });
  }
  function closeTrade() { set({ trade: null }); resumeBotIfNeeded(); }

  /* Возобновляет ход бота, если он «завис» с открытым диалогом обмена.
     Бот предлагает обмен ДО своего броска (phase='idle', current=бот);
     любой выход из диалога (принять/отклонить/встречное/закрыть) обязан
     вернуть управление боту, иначе игра встаёт с «{бот} ходит…». */
  function resumeBotIfNeeded(delay = 450) {
    after(delay, () => {
      const s = ref.current;
      if (s.incomingTrade || s.trade) return;      // диалог ещё открыт
      if (s.phase !== 'idle') return;              // ход уже идёт/в другой фазе
      const cur = s.players[s.current];
      if (cur && cur.id !== 'you' && !cur.bankrupt) rollDice();
    });
  }
  function toggleTradeItem(side, cellIdx) {
    set(st => {
      if (!st.trade) return {};
      const arr = st.trade[side];
      const next = arr.includes(cellIdx) ? arr.filter(x => x !== cellIdx) : [...arr, cellIdx];
      return { trade: { ...st.trade, [side]: next } };
    });
  }
  function setTradeMoney(v) { set(st => st.trade ? { trade: { ...st.trade, money: v } } : {}); }
  function proposeTrade() {
    const s = ref.current;
    const t = s.trade;
    if (!t) return;
    const partnerIdx = s.players.findIndex(p => p.id === t.withId);
    if (partnerIdx < 0) return;
    const blocked = [...t.give, ...t.get].some(i => s.mortgaged[i] || (s.houses[i] || 0) > 0);
    if (blocked) { set({ toast: 'Нельзя менять заложенные или застроенные города' }); return; }
    if (!E.partnerAcceptsTrade(s, t, 0, partnerIdx)) {
      set({ toast: `${s.players[partnerIdx].name} отклонил обмен`, trade: null });
      resumeBotIfNeeded(); // встречное во время хода бота — вернуть управление боту
      return;
    }
    set(st => ({ ...E.applyTrade(st, 0, partnerIdx, t.give, t.get, t.money), trade: null }));
    resumeBotIfNeeded();
  }

  /* ---------- долг человека ---------- */
  function payDebt() {
    const s = ref.current;
    if (s.phase !== 'debt') return;
    const myIdx = 0;
    const owed = s.debtOwed;
    if (s.players[myIdx].balance < owed) return; // кнопка должна быть задизейблена
    const creditorIdx = s.debtCreditor === 'bank'
      ? null
      : s.players.findIndex(p => p.id === s.debtCreditor);
    set(st => {
      let ns = {
        ...st,
        players: st.players.map((p, i) => {
          if (i === myIdx) return { ...p, balance: p.balance - owed };
          if (creditorIdx != null && i === creditorIdx) return { ...p, balance: p.balance + owed };
          return p;
        }),
        phase: 'idle',
        debtOwed: 0,
        debtCreditor: null,
        hint: 'Долг погашен.',
      };
      return ns;
    });
    after(400, endTurn);
  }
  function surrenderDebt() {
    const s = ref.current;
    if (s.phase !== 'debt') return;
    const myIdx = 0;
    const creditorIdx = s.debtCreditor === 'bank'
      ? null
      : s.players.findIndex(p => p.id === s.debtCreditor);
    set(st => E.bankrupt(st, myIdx, creditorIdx));
    after(400, endTurn);
  }

  function restart() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setState(E.init(count));
  }

  /* ---------- входящий обмен (от бота к человеку) ---------- */
  function acceptIncomingTrade(extra = 0) {
    const t = ref.current.incomingTrade;
    if (!t) return;
    const finalMoney = (t.money || 0) + (extra || 0);
    set(st => {
      const next = E.applyTrade(st, t.fromIdx, t.partnerIdx, t.give, t.get, finalMoney);
      return { ...next, incomingTrade: null };
    });
    resumeBotIfNeeded();
  }
  function declineIncomingTrade() {
    set({ incomingTrade: null });
    resumeBotIfNeeded();
  }
  function counterTrade() {
    const t = ref.current.incomingTrade;
    if (!t) return;
    const botId = ref.current.players[t.fromIdx].id;
    // открываем TradeModal с перевёрнутыми условиями бота как стартовая точка
    set({ incomingTrade: null, trade: { withId: botId, give: t.get, get: t.give, money: t.money } });
  }

  return [state, {
    rollDice, buy, pass, payRentDue, endTurn, handleBoardTap,
    buildHouse, sellHouse, mortgage, redeem,
    payBail, useBailCard,
    openTrade, closeTrade, toggleTradeItem, setTradeMoney, proposeTrade,
    auctionBid: doAuctionBid, auctionPass: doAuctionPass,
    acceptIncomingTrade, declineIncomingTrade, counterTrade,
    payDebt, surrenderDebt,
    restart,
  }];
}

/* ---------- АВАТАР ---------- */
function Av({ p, size, ring }) {
  return (
    <div
      className={'av' + (p.photo ? ' photo' : '')}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: p.photo ? undefined : p.color,
        border: ring ? '2px solid #fff' : undefined,
      }}
    >
      {p.bot ? (
        <i className="ti ti-robot" style={{ fontSize: size * 0.5 }}></i>
      ) : p.photo ? (
        ''
      ) : (
        p.initials
      )}
    </div>
  );
}

/* ---------- ТИКЕР БАЛАНСА: число «доезжает» до нового значения + вспышка ---------- */
function BalanceTicker({ value }) {
  const [disp, setDisp] = useState(value);
  const [dir, setDir] = useState('');
  const prevRef = useRef(value);
  const rafRef = useRef();
  useEffect(() => {
    const from = prevRef.current, to = value;
    if (from === to) return;
    prevRef.current = to;
    setDir(to > from ? 'up' : 'down');
    const t0 = performance.now(), dur = 550;
    cancelAnimationFrame(rafRef.current);
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      setDisp(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const dirT = setTimeout(() => setDir(''), 1000);
    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(dirT); };
  }, [value]);
  return <span className={'baltick' + (dir ? ' ' + dir : '')}>{money(disp)}</span>;
}

/* ---------- ТОСТ С ТИПАМИ: success / warn / info ---------- */
function ToastView({ toast }) {
  if (!toast) return null;
  const t = typeof toast === 'string' ? { text: toast } : toast;
  if (!t.text) return null;
  const type = t.type ||
    (/^(Нельзя|Недостаточно|Сначала|Ставка)/.test(t.text) || /отклонил|💀|🚔|закончились|нет домов/.test(t.text) ? 'warn'
    : /Куплен|купил|выиграл|продан|Выкуплено|построен|совершён|🤝|🏆|🏠|🏨/.test(t.text) ? 'success'
    : 'info');
  const icon = type === 'warn' ? 'ti-alert-triangle' : type === 'success' ? 'ti-confetti' : 'ti-info-circle';
  return (
    <div className={'toast ' + type}>
      <i className={'ti ' + icon}></i>
      {t.text}
    </div>
  );
}

/* ---------- КАРТОЧКА СОБСТВЕННОСТИ (info overlay, кнопки в dock) ---------- */
function PropertyCard({ cell, state, myIdx }) {
  if (!cell) return null;
  const s = state;
  const region = cell.region ? VS.REGIONS[cell.region] : null;
  const col = region?.color || '#555';
  const ownerId = s.owners[cell.i];
  const owner = ownerId ? s.players.find(p => p.id === ownerId) : null;
  const currentHouses = s.houses[cell.i] || 0;
  const isMortgaged = s.mortgaged?.[cell.i];

  const ownerAirCount = (ownerId && cell.type === 'air')
    ? Object.entries(s.owners).filter(([ci, oid]) =>
        oid === ownerId && VS.CELLS[Number(ci)]?.type === 'air').length
    : 0;

  const R = {
    row: (hi) => ({
      display:'flex', justifyContent:'space-between', alignItems:'center',
      padding: hi ? '5px 8px' : '5px 4px',
      borderBottom:'1px solid rgba(255,235,200,.06)',
      background: hi ? 'rgba(232,196,90,.12)' : 'transparent',
      borderRadius: hi ? 6 : 0,
    }),
    lbl: { fontSize:12.5, color:'#c8bba0' },
    val: (hi) => ({ fontSize:13, fontWeight:700, color: hi ? '#e8c45a' : '#efe3cd' }),
  };

  const RENT_LABELS = ['База', '1 дом', '2 дома', '3 дома', '4 дома', 'Отель'];

  return (
    <div className="propcard-overlay">
      <div className="propcard">
        <div className="propcard-handle"></div>

        {/* шапка с цветом региона */}
        <div style={{ background: col, padding:'12px 16px 10px', position:'relative' }}>
          {region && (
            <div style={{ fontSize:10, fontWeight:800, letterSpacing:'.1em',
              textTransform:'uppercase', color:'rgba(255,255,255,.65)', marginBottom:3 }}>
              {region.label}
            </div>
          )}
          <div style={{ fontFamily:'Fraunces,serif', fontSize:21, fontWeight:700,
            color:'#fff', lineHeight:1.1 }}>{cell.name}</div>
          {cell.price != null && (
            <div style={{ fontSize:12, color:'rgba(255,255,255,.75)', marginTop:3 }}>
              Цена: <b>${cell.price}</b>
            </div>
          )}
          {isMortgaged && (
            <div style={{ position:'absolute', top:10, right:12, fontSize:10,
              background:'rgba(0,0,0,.5)', color:'#e8c45a', borderRadius:6, padding:'2px 7px',
              fontWeight:700 }}>ЗАЛОЖЕНО</div>
          )}
        </div>

        {/* тело карточки */}
        <div style={{ padding:'8px 12px 10px', overflowY:'auto', flex:1 }}>

          {cell.type === 'prop' && cell.rent && (
            <>
              <div style={{ fontSize:10, letterSpacing:'.1em', fontWeight:800,
                color:'#8a8071', marginBottom:5, marginTop:2 }}>АРЕНДА</div>
              {cell.rent.map((val, i) => {
                const hi = owner ? (i === 0 ? currentHouses === 0 : currentHouses === i) ||
                  (i === 5 && currentHouses >= 5) : false;
                return (
                  <div key={i} style={R.row(hi)}>
                    <span style={R.lbl}>{RENT_LABELS[i]}</span>
                    <span style={R.val(hi)}>${val}</span>
                  </div>
                );
              })}
              {region?.houseCost && (
                <div style={{ fontSize:11, color:'#8a8071', marginTop:7 }}>
                  Дом / отель:
                  <b style={{color:'#efe3cd', marginLeft:4}}>${region.houseCost}</b>
                </div>
              )}
            </>
          )}

          {cell.type === 'air' && (
            <>
              <div style={{ fontSize:10, letterSpacing:'.1em', fontWeight:800,
                color:'#8a8071', marginBottom:5, marginTop:2 }}>АРЕНДА — АЭРОПОРТЫ</div>
              {[[1,25,'1 аэропорт'],[2,50,'2 аэропорта'],[3,100,'3 аэропорта'],[4,200,'4 аэропорта']].map(([n, rent, lbl]) => (
                <div key={n} style={R.row(ownerAirCount === n)}>
                  <span style={R.lbl}>{lbl}</span>
                  <span style={R.val(ownerAirCount === n)}>${rent}</span>
                </div>
              ))}
            </>
          )}

          {cell.type === 'util' && (
            <>
              <div style={{ fontSize:10, letterSpacing:'.1em', fontWeight:800,
                color:'#8a8071', marginBottom:5, marginTop:2 }}>АРЕНДА — КОММУНАЛЬНЫЕ</div>
              <div style={R.row(false)}>
                <span style={R.lbl}>1 компания</span>
                <span style={R.val(false)}>кубики × 4</span>
              </div>
              <div style={R.row(false)}>
                <span style={R.lbl}>Обе компании</span>
                <span style={R.val(false)}>кубики × 10</span>
              </div>
            </>
          )}

          {owner && (
            <div style={{ marginTop:8, padding:'6px 10px', borderRadius:8,
              background: (owner.color||'#888')+'22',
              borderLeft:`3px solid ${owner.color||'#888'}`,
              fontSize:12, color:'#efe3cd', display:'flex', alignItems:'center', gap:8 }}>
              <span style={{color:'#8a8071'}}>Владелец:</span>
              <b>{owner.name}</b>
              {currentHouses > 0 && !isMortgaged && (
                <span style={{ marginLeft:'auto', fontSize:11, color:'#e8c45a', fontWeight:700 }}>
                  {currentHouses >= 5
                    ? 'Отель'
                    : `${currentHouses} ${currentHouses===1?'дом':'дома'}`}
                </span>
              )}
            </div>
          )}

          {s.phase === 'rent' && s.rentDue > 0 && (
            <div style={{ marginTop:7, padding:'6px 10px', borderRadius:8,
              background:'rgba(208,57,47,.18)', border:'1px solid rgba(208,57,47,.35)',
              fontSize:13, fontWeight:700, color:'#ff7066', textAlign:'center' }}>
              К оплате: {money(s.rentDue)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- МОДАЛКА ВХОДЯЩЕГО ПРЕДЛОЖЕНИЯ ОБМЕНА ---------- */
function TradeOfferModal({ state, actions }) {
  const t = state.incomingTrade;
  if (!t) return null;
  const fromPlayer = state.players[t.fromIdx];
  if (!fromPlayer) return null;

  function cellName(idx) {
    const c = VS.CELLS[idx];
    return c ? c.name : `#${idx}`;
  }

  const [extra, setExtra] = React.useState(0);
  const totalMoney = t.money + extra;
  const decline = actions.declineIncomingTrade || (() => {});
  const counter = actions.counterTrade || (() => {});
  const accept = () => (actions.acceptIncomingTrade || (() => {}))(extra);

  return (
    <div className="overlay" style={{ zIndex: 120 }}>
      <div className="vs-modal" onClick={e => e.stopPropagation()}>
        <div className="vs-modal-head">
          <i className="ti ti-arrows-exchange lead"></i>
          <div className="vs-modal-title">Предложение обмена</div>
        </div>
        <div style={{ fontSize: 12, color: '#d8c39e', marginBottom: 12 }}>
          <b style={{ color: fromPlayer.color || '#e8c45a' }}>{fromPlayer.name}</b> предлагает:
        </div>

        <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#cdbd9d', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Он отдаёт тебе
            </div>
            {t.give.length > 0
              ? t.give.map(idx => (
                <div key={idx} style={{
                  background: 'rgba(127,240,196,.1)', border: '1px solid rgba(127,240,196,.25)',
                  borderRadius: 8, padding: '5px 8px', marginBottom: 4,
                  fontSize: 11, fontWeight: 700, color: '#7ff0c4',
                }}>
                  {cellName(idx)}
                </div>
              ))
              : <div style={{ fontSize: 10, color: '#8a8071' }}>ничего</div>
            }
            {totalMoney > 0 && (
              <div style={{
                background: 'rgba(127,240,196,.1)', border: '1px solid rgba(127,240,196,.25)',
                borderRadius: 8, padding: '5px 8px', marginTop: 4,
                fontSize: 11, fontWeight: 700, color: '#7ff0c4',
              }}>
                + ${totalMoney}
              </div>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 10, color: '#cdbd9d', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Хочет получить
            </div>
            {t.get.length > 0
              ? t.get.map(idx => (
                <div key={idx} style={{
                  background: 'rgba(208,57,47,.1)', border: '1px solid rgba(208,57,47,.3)',
                  borderRadius: 8, padding: '5px 8px', marginBottom: 4,
                  fontSize: 11, fontWeight: 700, color: '#ff9b8c',
                }}>
                  {cellName(idx)}
                </div>
              ))
              : <div style={{ fontSize: 10, color: '#8a8071' }}>ничего</div>
            }
            {totalMoney < 0 && (
              <div style={{
                background: 'rgba(208,57,47,.1)', border: '1px solid rgba(208,57,47,.3)',
                borderRadius: 8, padding: '5px 8px', marginTop: 4,
                fontSize: 11, fontWeight: 700, color: '#ff9b8c',
              }}>
                + ${-totalMoney}
              </div>
            )}
          </div>
        </div>

        {/* торг: доплата */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
          background: 'rgba(255,235,200,.05)', borderRadius: 10, padding: '7px 10px' }}>
          <span style={{ fontSize: 11, color: '#cdbd9d', flex: 1 }}>Хочу доплату:</span>
          <button onClick={() => setExtra(e => Math.max(0, e - 50))} style={{
            background: 'rgba(255,235,200,.1)', border: '1px solid rgba(255,235,200,.2)',
            borderRadius: 7, color: '#fbf2dd', fontSize: 18, width: 30, height: 30,
            cursor: 'pointer', lineHeight: 1,
          }}>−</button>
          <span style={{ minWidth: 44, textAlign: 'center', fontSize: 13, fontWeight: 700,
            color: extra > 0 ? '#7ff0c4' : '#8a8071' }}>
            {extra > 0 ? `+$${extra}` : '$0'}
          </span>
          <button onClick={() => setExtra(e => e + 50)} style={{
            background: 'rgba(255,235,200,.1)', border: '1px solid rgba(255,235,200,.2)',
            borderRadius: 7, color: '#fbf2dd', fontSize: 18, width: 30, height: 30,
            cursor: 'pointer', lineHeight: 1,
          }}>+</button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
          <button className="btn primary" style={{ flex: 1 }} onClick={accept}>
            <i className="ti ti-check"></i> Принять
          </button>
          <button className="btn sec" style={{ flex: 1, color: '#ff9b8c' }} onClick={decline}>
            <i className="ti ti-x"></i> Отклонить
          </button>
        </div>
        <button className="btn sec" style={{ width: '100%', color: '#e8c45a' }} onClick={counter}>
          <i className="ti ti-arrows-exchange"></i> Встречное предложение
        </button>
      </div>
    </div>
  );
}

/* ---------- ОСНОВНОЙ ПРОТОТИП ИГРЫ ---------- */
function GameProto({ state, actions, variant, big, myIdx = 0 }) {
  // состояние и действия приходят сверху из TabsApp — единый источник истины.
  const s = state;
  const A = actions;
  const phase = s.phase === 'rolling' ? 'moving' : s.phase;
  const autoIdx = s.landed != null ? s.landed : s.players[myIdx]?.pos ?? s.players[0].pos;
  const focusIdx = s.zoomCell != null ? s.zoomCell : autoIdx;
  const cell = VS.CELLS[focusIdx];
  const isMyTurn     = s.current === myIdx;
  const currentIsBot = s.players[s.current]?.bot === true;
  // В онлайне (боты=false) показываем кнопки только в свой ход
  const showMyActions = isMyTurn || currentIsBot;

  // динамический размер доски по контейнеру
  const boardContainerRef = useRef();
  const [dynSize, setDynSize] = useState(null);
  useEffect(() => {
    const el = boardContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const sz = Math.floor(Math.min(width - 8, height - 8, 440));
      setDynSize(sz > 80 ? sz : null);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sizes = big
    ? { A: 300, B: 282, C: 214 }
    : { A: 250, B: 232, C: 178 };
  const boardSize = dynSize || sizes[variant];

  // «летящие деньги»: отслеживаем изменения балансов и показываем ±$ над доской
  const prevBalRef = useRef(null);
  const flyIdRef = useRef(0);
  const [flies, setFlies] = useState([]);
  useEffect(() => {
    const balances = s.players.map(p => p.balance);
    if (prevBalRef.current && prevBalRef.current.length === balances.length) {
      const fresh = [];
      balances.forEach((b, i) => {
        const d = b - prevBalRef.current[i];
        if (d !== 0) fresh.push({ id: ++flyIdRef.current, amt: d, name: s.players[i].name, me: i === myIdx });
      });
      if (fresh.length) {
        setFlies(f => [...f, ...fresh].slice(-3));
        const ids = fresh.map(x => x.id);
        setTimeout(() => setFlies(f => f.filter(x => !ids.includes(x.id))), 1200);
      }
    }
    prevBalRef.current = balances;
  }, [s.players]);

  // показывать PropertyCard для клеток-собственностей
  const BUYABLE = new Set(['prop', 'air', 'util']);
  const landedCell = s.landed != null ? VS.CELLS[s.landed] : null;
  const showPropCard = landedCell && BUYABLE.has(landedCell.type) &&
    (phase === 'buy' || phase === 'own' || phase === 'rent' ||
     (phase === 'special' && s.landed != null && BUYABLE.has(VS.CELLS[s.landed]?.type)));
  const showCenterDice = variant !== 'C';
  const logoSmall = variant === 'C';

  return (
    // встроенный игровой экран без собственной рамки телефона —
    // рамку рисует TabsApp. Заполняем доступную высоту, без скролла.
    <div className="gameview" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
        <div className="topbar">
          <span className="round">
            <i className="ti ti-refresh"></i> раунд {Math.floor((s.turnNum || 0) / s.players.length) + 1}
          </span>
          <span className="tag mode">
            <i className="ti ti-infinity"></i> полная
          </span>
          {/* угол справа отдан кнопке «домой» (рисуется в TabsApp) */}
          <span className="tools" style={{ width: 30 }}></span>
        </div>

        {phase === 'debt' && (
          <div style={{
            background: 'rgba(208,57,47,.22)', border: '1px solid rgba(208,57,47,.5)',
            borderRadius: 10, margin: '4px 10px', padding: '8px 12px',
            display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 13, fontWeight: 700, color: '#ff7066',
          }}>
            <i className="ti ti-alert-triangle" style={{ fontSize: 16 }}></i>
            Долг: {money(s.debtOwed)} — заложите имущество или заплатите
          </div>
        )}

        <div className="players">
          {s.players.map((p, i) => (
            <div
              key={p.id}
              className={
                'pchip' +
                (i === myIdx ? ' me' : '') +
                (i === s.current ? ' turn' : '')
              }
            >
              <Av p={p} size={21} />
              <div>
                <div className="nm">{p.name}</div>
                <div className="bal">
                  <span className="bills"></span>
                  <BalanceTicker value={p.balance} />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div ref={boardContainerRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 0', position: 'relative' }}>
          <Board
            cells={VS.CELLS}
            regions={VS.REGIONS}
            owners={s.owners}
            houses={s.houses}
            players={s.players}
            activeCell={focusIdx}
            zoom={s.zoom}
            boardSize={boardSize}
            dice={s.dice}
            rolling={s.rolling}
            hoppingId={s.hoppingId}
            showCenterDice={showCenterDice}
            logoSmall={logoSmall}
            activePlayerId={s.players[s.current]?.id}
            onBoardTap={A.handleBoardTap}
          />
          {flies.length > 0 && (
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 31, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '13%', gap: 4 }}>
              {flies.map(f => (
                <div key={f.id} className={'fly' + (f.amt < 0 ? ' spend' : '')} style={{ position: 'relative' }}>
                  {f.amt > 0 ? '+' : '−'}{money(Math.abs(f.amt))}
                  {!f.me && <span style={{ fontSize: 10, opacity: .85, fontWeight: 700 }}>{f.name}</span>}
                </div>
              ))}
            </div>
          )}
          {!s.zoom && variant !== 'C' && (
            <div className="zoomhint">
              <i className="ti ti-zoom-in"></i> тап — зум
            </div>
          )}
          {s.zoom && (
            <div className="zoomhint">
              <i className="ti ti-zoom-out"></i> тап — закрыть
            </div>
          )}
          {/* PropertyCard — внутри boardContainer, НЕ перекрывает dock */}
          {showPropCard && (
            <PropertyCard cell={landedCell} state={s} myIdx={myIdx} />
          )}
        </div>

        {/* dock — всегда виден, содержит ВСЕ кнопки действий */}
        <div className="dock" style={{ paddingTop: '6px', paddingBottom: '10px' }}>
          {!showPropCard && (
            <div className="hint" style={{ minHeight: '13px', marginBottom: '6px' }}>
              {s.hint && <span dangerouslySetInnerHTML={{ __html: s.hint }}></span>}
            </div>
          )}
          <div className="acts">
            {phase === 'idle' && s.players[s.current].inJail && showMyActions && (
              <div className="acts">
                <button className="btn primary" onClick={A.rollDice}>
                  <i className="ti ti-cube"></i> Дубль
                </button>
                <button className="btn sec" onClick={A.payBail}>Выйти за $50</button>
                {(s.players[s.current].bailCards || 0) > 0 && (
                  <button className="btn sec icon" onClick={A.useBailCard} title="карта выхода">
                    <i className="ti ti-ticket"></i>
                  </button>
                )}
              </div>
            )}
            {phase === 'idle' && !s.players[s.current].inJail && showMyActions && (
              <button className="btn primary" onClick={A.rollDice}>
                <i className="ti ti-cube"></i>
                {isMyTurn ? ' Бросить кубики' : ` Бросить за ${s.players[s.current].name}`}
              </button>
            )}
            {phase === 'idle' && !showMyActions && (
              <div style={{ fontSize: 12, color: '#8a8071', textAlign: 'center', padding: '6px 0' }}>
                Ход {s.players[s.current].name}…
              </div>
            )}
            {phase === 'moving' && showMyActions && (
              <button className="btn ghost" style={{ flex: 1 }} onClick={A.endTurn}>
                пропустить анимацию
              </button>
            )}
            {phase === 'buy' && showMyActions && (
              <div className="acts">
                <button className="btn primary" onClick={A.buy}>
                  Купить за {money(VS.CELLS[s.landed]?.price)}
                </button>
                <button className="btn sec" onClick={A.pass}>
                  <i className="ti ti-hammer"></i> Аукцион
                </button>
              </div>
            )}
            {s.phase === 'auction' && s.auction && s.auction.turnIdx !== myIdx && (
              <div style={{ fontSize: 12, color: '#d8c39e', textAlign: 'center', padding: '6px 0' }}>
                <i className="ti ti-hammer"></i> {s.players[s.auction.turnIdx]?.name} думает…
              </div>
            )}
            {phase === 'rent' && showMyActions && (
              <button className="btn primary" style={{ background: 'var(--bad)' }} onClick={A.payRentDue}>
                Оплатить {money(s.rentDue)}
              </button>
            )}
            {phase === 'debt' && s.current === myIdx && (
              <div className="acts">
                <button
                  className="btn primary"
                  disabled={s.players[myIdx]?.balance < s.debtOwed}
                  onClick={A.payDebt}
                  style={{ background: 'var(--bad)' }}
                >
                  <i className="ti ti-cash"></i> Заплатить {money(s.debtOwed)}
                </button>
                <button className="btn sec" style={{ color: '#ff9b8c' }} onClick={A.surrenderDebt}>
                  <i className="ti ti-skull"></i> Сдаться
                </button>
              </div>
            )}
            {phase === 'own' && showMyActions && (
              <div className="acts">
                {E.canBuild(s, s.landed, s.players[myIdx]?.id) && (
                  <button className="btn green" onClick={() => A.buildHouse(s.landed)}>
                    <i className="ti ti-home-plus"></i> Построить дом
                  </button>
                )}
                {E.canSellHouse(s, s.landed, s.players[myIdx]?.id) && (
                  <button className="btn sec" onClick={() => A.sellHouse(s.landed)}>
                    <i className="ti ti-home-minus"></i> Продать дом
                  </button>
                )}
                <button className="btn green" style={{ flex: 1, padding: '13px' }} onClick={A.endTurn}>
                  <i className="ti ti-check"></i> Дальше
                </button>
              </div>
            )}
            {phase === 'special' && showMyActions && (
              <button className="btn green" style={{ flex: 1, padding: '13px' }} onClick={A.endTurn}>
                <i className="ti ti-check"></i> Дальше
              </button>
            )}
          </div>
        </div>

        {s.toast && <ToastView toast={s.toast} />}

        {s.card && (
          <div className="cardpop">
            <div className={'cardpopInner' + (s.card.kind === 'chance' ? ' ev' : s.card.kind === 'chest' ? ' luck' : '')}>
              <div className="cardpopTag">{s.card.kind === 'chance' ? 'Событие' : s.card.kind === 'chest' ? 'Удача' : 'Карта'}</div>
              <div className="cardpopIco"><i className={'ti ' + (s.card.kind === 'chance' ? 'ti-world' : s.card.kind === 'chest' ? 'ti-gift' : 'ti-cards')}></i></div>
              <div className="cardpopText">{s.card.text || (typeof s.card === 'string' ? s.card : '')}</div>
            </div>
          </div>
        )}

        {s.winner && (
          <div className="overlay">
            <div className="winbox">
              <i className="ti ti-trophy" style={{ fontSize: 46, color: 'var(--gold)' }}></i>
              <div className="wintitle">Победа!</div>
              <div className="winname">{s.players.find(p => p.id === s.winner)?.name}</div>
              <div className="winsub">Все соперники разорились</div>
              <button className="btn primary" style={{ marginTop: 14 }} onClick={A.restart}>
                <i className="ti ti-refresh"></i> Новая игра
              </button>
            </div>
          </div>
        )}

        {s.incomingTrade && (
          <TradeOfferModal state={s} actions={A} />
        )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   useOnlineGame — хук для режима «Приват по коду».
   Подключается к WebSocket-серверу, синхронизирует состояние.
   Интерфейс совпадает с useGame, но действия отправляются на сервер.
   ══════════════════════════════════════════════════════════════ */
function useOnlineGame(wsUrl, playerId) {
  const [state, setState]   = useState(null);   // null = ещё не начали
  const [wsReady, setWsReady] = useState(false);
  const wsRef  = useRef(null);
  const stRef  = useRef(state);
  stRef.current = state;

  // мой индекс в массиве players (зависит от playerId, известен после started)
  const myIdxRef = useRef(0);

  // тосты / карточки гаснут сами
  useEffect(() => {
    if (!state?.toast) return;
    const t = setTimeout(() => setState(s => s ? { ...s, toast: null } : s), 1800);
    return () => clearTimeout(t);
  }, [state?.toast]);
  useEffect(() => {
    if (!state?.card) return;
    const t = setTimeout(() => setState(s => s ? { ...s, card: null } : s), 2800);
    return () => clearTimeout(t);
  }, [state?.card]);

  useEffect(() => {
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen    = () => setWsReady(true);
    ws.onclose   = () => setWsReady(false);
    ws.onerror   = () => {};
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'started' || msg.type === 'state') {
        const st = msg.state;
        // вычисляем свой индекс по playerId
        const idx = st.players.findIndex(p => p.id === playerId);
        myIdxRef.current = idx >= 0 ? idx : 0;
        setState(st);
      }
    };
    return () => ws.close();
  }, [wsUrl, playerId]);

  // отправить действие на сервер
  function sendAction(action) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'action', action }));
    }
  }

  // Проверяем, мой ли ход сейчас
  function isMyTurn() {
    return state && state.current === myIdxRef.current;
  }

  const actions = {
    rollDice:    () => isMyTurn() && sendAction({ type: 'roll' }),
    buy:         () => isMyTurn() && sendAction({ type: 'buy' }),
    pass:        () => isMyTurn() && sendAction({ type: 'pass' }),
    payRentDue:  () => isMyTurn() && sendAction({ type: 'payRent' }),
    endTurn:     () => isMyTurn() && sendAction({ type: 'endTurn' }),
    payBail:     () => isMyTurn() && sendAction({ type: 'payBail' }),
    useBailCard: () => isMyTurn() && sendAction({ type: 'useBailCard' }),
    buildHouse:  (cellIdx) => sendAction({ type: 'buildHouse', cellIdx }),
    sellHouse:   (cellIdx) => sendAction({ type: 'sellHouse', cellIdx }),
    mortgage:    (cellIdx) => sendAction({ type: 'mortgage', cellIdx }),
    redeem:      (cellIdx) => sendAction({ type: 'redeem', cellIdx }),
    handleBoardTap: (e) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const xPct = ((e.clientX - rect.left) / rect.width) * 100;
      const yPct = ((e.clientY - rect.top) / rect.height) * 100;
      let nearestCell = 0, minDist = Infinity;
      VS.CELLS.forEach(cell => {
        const c = VS.cellCenter(cell.i);
        const d = Math.hypot(c.left - xPct, c.top - yPct);
        if (d < minDist) { minDist = d; nearestCell = cell.i; }
      });
      setState(s => {
        if (!s) return s;
        if (!s.zoom) return { ...s, zoom: true, zoomCell: nearestCell };
        if (s.zoomCell === nearestCell) return { ...s, zoom: false, zoomCell: null };
        return { ...s, zoomCell: nearestCell };
      });
    },
    auctionBid:  (amount) => sendAction({ type: 'bid', amount }),
    auctionPass: ()       => sendAction({ type: 'passBid' }),
    // обмены — пока только локально (v2)
    openTrade:   () => {},
    closeTrade:  () => {},
    toggleTradeItem: () => {},
    setTradeMoney: () => {},
    proposeTrade: () => {},
    acceptIncomingTrade: () => {},
    declineIncomingTrade: () => {},
    payDebt: () => {},
    surrenderDebt: () => {},
    restart:     () => {},
  };

  return [state, actions, wsReady, myIdxRef];
}

Object.assign(window, { GameProto, useGame, useOnlineGame, Av });
