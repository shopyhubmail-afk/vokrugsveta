/* app-tabs.jsx — многоэкранное приложение с вкладками для игры "Вокруг света" (полные механики) */
const { useState, useRef, useEffect } = React;

/* ── Telegram helpers ───────────────────────────────────────────── */
const TG = window.Telegram?.WebApp;

function haptic(type, style) {
  const fb = TG?.HapticFeedback;
  if (!fb) return;
  try {
    if (type === 'impact')       fb.impactOccurred(style || 'light');
    else if (type === 'notify')  fb.notificationOccurred(style || 'success');
    else if (type === 'select')  fb.selectionChanged();
  } catch(e) {}
}

function tgUserName() {
  const u = TG?.initDataUnsafe?.user;
  if (!u) return '';
  return u.last_name ? `${u.first_name} ${u.last_name}` : u.first_name || '';
}

function tgStartParam() {
  return TG?.initDataUnsafe?.start_param || '';
}

function shareRoomLink(code) {
  const bot = window.TG_BOT; const app = window.TG_APP;
  if (TG && bot && app) {
    const url  = `https://t.me/${bot}/${app}?startapp=${code}`;
    const text = `Присоединяйся к «Вокруг света»! Код: ${code}`;
    TG.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  } else {
    navigator.clipboard?.writeText(code).catch(() => {});
    alert(`Код комнаты скопирован: ${code}`);
  }
}

function useTgBackButton(onBack) {
  useEffect(() => {
    const btn = TG?.BackButton;
    if (!btn) return;
    btn.show();
    const handler = () => onBack();
    btn.onClick(handler);
    return () => { btn.offClick(handler); btn.hide(); };
  }, []);
}

/* ── общие элементы лобби ─────────────────────────────── */
const LOBBY_COLORS = ['#dd9320', '#4aa3d8', '#b14a86', '#1f9576'];

function nameInitials(name) {
  return (name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/* единый блок ошибки соединения с кнопкой «Повторить» */
function WsError({ msg, onRetry }) {
  return (
    <div className="wserr">
      <i className="ti ti-wifi-off"></i>
      <div>{msg}</div>
      {onRetry && (
        <button className="btn sec" onClick={onRetry}>
          <i className="ti ti-refresh"></i> Повторить
        </button>
      )}
    </div>
  );
}

/* ── возобновление онлайн-партии после перезапуска webview ── */
const RESUME_KEY = 'vs_resume';
const RESUME_TTL = 10 * 60 * 1000; // 10 минут
function saveResume(code, token, myName) {
  try { localStorage.setItem(RESUME_KEY, JSON.stringify({ code, token, myName, t: Date.now() })); } catch {}
}
function loadResume() {
  try {
    const r = JSON.parse(localStorage.getItem(RESUME_KEY) || 'null');
    if (r && r.code && r.token && Date.now() - r.t < RESUME_TTL) return r;
  } catch {}
  return null;
}
function clearResume() { try { localStorage.removeItem(RESUME_KEY); } catch {} }

/* ── таймер хода: чип с отсчётом ── */
function TurnTimerChip({ deadline, myTurn }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [deadline]);
  if (!deadline || left <= 0 || left > 600) return null;
  const danger = left <= 10;
  return (
    <div style={{
      position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
      display: 'flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20,
      fontSize: 11, fontWeight: 800, fontFamily: "'Manrope',sans-serif",
      background: danger ? 'rgba(208,57,47,.85)' : 'rgba(20,12,7,.65)',
      color: danger ? '#fff' : (myTurn ? '#e8c45a' : '#cdbd9d'),
      border: '1px solid ' + (danger ? '#e3584b' : 'rgba(255,235,200,.25)'),
      transition: 'background .3s',
    }}>
      <i className="ti ti-hourglass" style={{ fontSize: 12 }}></i>{left}с
    </div>
  );
}

/* ── плашка «соперник не в сети» ── */
function OfflineBanner({ seats, players }) {
  if (!seats || !players) return null;
  const offline = seats.filter(s => !s.connected &&
    players.find(p => p.id === s.id && !p.bankrupt));
  if (!offline.length) return null;
  return (
    <div style={{
      position: 'absolute', top: 32, left: '50%', transform: 'translateX(-50%)', zIndex: 30,
      fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 20,
      background: 'rgba(0,0,0,.5)', color: '#ffd0c4', border: '1px solid rgba(227,88,75,.4)',
      display: 'flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap',
    }}>
      <i className="ti ti-wifi-off" style={{ fontSize: 12 }}></i>
      {offline.map(s => s.name).join(', ')} не в сети — ждём…
    </div>
  );
}

/* ── звуки: крошечный WebAudio-синт, без файлов ── */
const SFX = (() => {
  let ctx = null;
  const on = () => { try { return localStorage.getItem('vs_sound') !== '0'; } catch { return true; } };
  function beep(freq, dur, type = 'sine', gain = 0.08, when = 0) {
    if (!on()) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(gain, ctx.currentTime + when);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + when + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.05);
    } catch {}
  }
  return {
    enabled: on,
    toggle() { try { localStorage.setItem('vs_sound', on() ? '0' : '1'); } catch {} },
    dice()  { for (let i = 0; i < 4; i++) beep(180 + Math.random() * 200, .05, 'square', .04, i * .07); },
    buy()   { beep(523, .09, 'triangle', .09); beep(784, .14, 'triangle', .09, .09); },
    cash()  { beep(880, .07, 'sine', .07); beep(1175, .1, 'sine', .07, .07); },
    bad()   { beep(220, .18, 'sawtooth', .05); beep(165, .22, 'sawtooth', .05, .12); },
    jail()  { beep(196, .15, 'square', .06); beep(147, .25, 'square', .06, .15); },
    win()   { [523, 659, 784, 1047].forEach((f, i) => beep(f, .16, 'triangle', .09, i * .13)); },
  };
})();
window.SFX = SFX;

/* следит за состоянием игры и озвучивает события + копит статистику */
function useGameSounds(gameState, myIdx) {
  const prevRef = useRef({});
  const statRef = useRef(false);
  useEffect(() => {
    if (!gameState) return;
    const prev = prevRef.current;
    if (gameState.rolling && !prev.rolling) SFX.dice();
    if (gameState.toast && gameState.toast !== prev.toast) {
      const t = gameState.toast;
      if (/купил|построен|выиграл|Выкуплено|совершён|оплатил/.test(t)) SFX.buy();
      else if (/тюрьму|разорился|покинул/.test(t)) SFX.jail();
      else if (/Недостаточно|Нельзя|Сначала/.test(t)) SFX.bad();
    }
    if (gameState.phase === 'over' && prev.phase !== 'over' && gameState.winner) {
      SFX.win();
      if (!statRef.current) { // статистика: одна запись на партию
        statRef.current = true;
        try {
          const s = JSON.parse(localStorage.getItem('vs_stats') || '{"games":0,"wins":0}');
          s.games += 1;
          const meId = gameState.players[myIdx ?? 0]?.id;
          if (gameState.winner === meId) s.wins += 1;
          localStorage.setItem('vs_stats', JSON.stringify(s));
        } catch {}
      }
    }
    prevRef.current = { rolling: gameState.rolling, toast: gameState.toast, phase: gameState.phase };
  }, [gameState?.rolling, gameState?.toast, gameState?.phase]);
}

/* кнопка вкл/выкл звука */
function SoundToggle() {
  const [, force] = useState(0);
  return (
    <button className="homebtn" style={{ top: 42 }} title="звук"
      onClick={() => { SFX.toggle(); force(x => x + 1); haptic('select'); }}>
      <i className={'ti ' + (SFX.enabled() ? 'ti-volume' : 'ti-volume-off')}></i>
    </button>
  );
}

/* ---------- ЭКРАН 1: ИГРОВОЙ (Лента) ---------- */
function GameScreen({ gameState, actions, myIdx = 0 }) {
  const GameProto = window.GameProto;
  return <GameProto state={gameState} actions={actions} variant="B" big={true} myIdx={myIdx} />;
}

/* ---------- вспомогательное: делегируем в engine ---------- */
function uiHouseCost(cellIdx) {
  return window.VSEngine ? window.VSEngine.houseCost(cellIdx) : 0;
}
function uiCanBuild(gs, cellIdx, ownerId) {
  return window.VSEngine ? window.VSEngine.canBuild(gs, cellIdx, ownerId) : false;
}
function uiCanSellHouse(gs, cellIdx, ownerId) {
  return window.VSEngine ? window.VSEngine.canSellHouse(gs, cellIdx, ownerId) : false;
}

/* ---------- ЭКРАН 2: ПОРТФЕЛЬ ---------- */
function PortfolioScreen({ gameState, actions }) {
  if (!gameState || !gameState.players) return null;

  const mePlayer = gameState.players[0];
  const myProperties = Object.entries(gameState.owners)
    .filter(([_, id]) => id === mePlayer.id)
    .map(([cellIdx]) => VS.CELLS[Number(cellIdx)]);

  const totalPropertyValue = myProperties.reduce((sum, cell) => sum + (cell.price || 0), 0);
  const netWorth = mePlayer.balance + totalPropertyValue;

  return (
    <div style={{ padding: '12px', color: '#efe3cd', minHeight: '100vh' }}>
      <div style={{ marginBottom: '16px' }}>
        <h3 style={{ margin: '0 0 12px', color: '#fbf2dd', fontSize: '18px' }}>Мой портфель</h3>

        {/* Баланс */}
        <div style={{
          background: 'rgba(20,12,7,.5)',
          border: '1px solid rgba(255,235,200,.16)',
          borderRadius: '13px',
          padding: '14px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '12px', color: '#d8c39e', marginBottom: '4px' }}>Текущий баланс</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#7ff0c4', fontFamily: 'Fraunces' }}>
            ${mePlayer.balance.toLocaleString('ru-RU')}
          </div>
        </div>

        {/* Активы */}
        <div style={{
          background: 'rgba(20,12,7,.5)',
          border: '1px solid rgba(255,235,200,.16)',
          borderRadius: '13px',
          padding: '14px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '12px', color: '#d8c39e', marginBottom: '4px' }}>Стоимость активов</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#e8c45a', fontFamily: 'Fraunces' }}>
            ${totalPropertyValue.toLocaleString('ru-RU')}
          </div>
          <div style={{ fontSize: '11px', color: '#bfe9d6', marginTop: '6px' }}>
            {myProperties.length} {myProperties.length === 1 ? 'город' : 'городов'}
          </div>
        </div>

        {/* Общее состояние */}
        <div style={{
          background: 'rgba(20,12,7,.5)',
          border: '1px solid rgba(255,235,200,.16)',
          borderRadius: '13px',
          padding: '14px'
        }}>
          <div style={{ fontSize: '12px', color: '#d8c39e', marginBottom: '4px' }}>Общее состояние</div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: '#4aa3d8', fontFamily: 'Fraunces' }}>
            ${netWorth.toLocaleString('ru-RU')}
          </div>
        </div>
      </div>

      {/* Список городов */}
      {myProperties.length > 0 ? (
        <div>
          <h4 style={{ margin: '16px 0 10px', color: '#fbf2dd', fontSize: '14px' }}>Мои города</h4>
          {myProperties.map((cell) => {
            const region = VS.REGIONS[cell.region];
            const houses = gameState.houses[cell.i] || 0;
            const rentBase = cell.rent ? cell.rent[0] : Math.round(cell.price / 10);
            const rentWithHouses = cell.rent ? cell.rent[Math.min(houses, 5)] : rentBase;
            const isMort = !!gameState.mortgaged[cell.i];
            const buildable  = uiCanBuild(gameState, cell.i, mePlayer.id);
            const sellable   = uiCanSellHouse(gameState, cell.i, mePlayer.id);
            const cost       = uiHouseCost(cell.i);
            const canAfford  = mePlayer.balance >= cost;

            return (
              <div key={cell.i} style={{
                background: 'rgba(20,12,7,.5)',
                border: '1px solid ' + (isMort ? 'rgba(208,57,47,.5)' : 'rgba(255,235,200,.16)'),
                borderRadius: '11px',
                padding: '12px',
                marginBottom: '8px',
                opacity: isMort ? 0.75 : 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: '700', color: '#fbf2dd' }}>{cell.name}</div>
                    <div style={{ fontSize: '10px', color: '#cdbd9d', marginTop: '2px' }}>
                      {region ? region.label : 'Спец'}
                    </div>
                    {houses > 0 && (
                      <div style={{ fontSize: '9px', color: '#bfe9d6', marginTop: '3px' }}>
                        {houses >= 5 ? '🏨 Отель' : `🏠 ${houses} ${houses === 1 ? 'дом' : 'домов'}`}
                      </div>
                    )}
                    {isMort && (
                      <div style={{ fontSize: '9px', color: '#ff9b8c', marginTop: '3px' }}>⚠️ В залоге</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#e8c45a' }}>
                      ${cell.price.toLocaleString('ru-RU')}
                    </div>
                    <div style={{ fontSize: '10px', color: '#bfe9d6', marginTop: '2px' }}>
                      аренда: ${rentWithHouses.toLocaleString('ru-RU')}
                    </div>
                  </div>
                </div>

                {/* действия */}
                {actions && (
                  <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
                    {cell.type === 'prop' && !isMort && (
                      <button className="pf-act build" disabled={!buildable || !canAfford}
                        title={!buildable && cost > 0 ? 'Сначала постройте дома на менее застроенных клетках группы' : ''}
                        onClick={() => actions.buildHouse(cell.i)}>
                        <i className="ti ti-home-plus"></i> Дом ${cost}
                      </button>
                    )}
                    {cell.type === 'prop' && houses > 0 && (
                      <button className="pf-act sell" disabled={!sellable}
                        onClick={() => actions.sellHouse(cell.i)}
                        title={!sellable ? 'Сначала снесите дома с более застроенных клеток' : ''}>
                        <i className="ti ti-home-minus"></i> Снести
                      </button>
                    )}
                    {!isMort && houses === 0 && (
                      <button className="pf-act mort" onClick={() => actions.mortgage(cell.i)}>
                        <i className="ti ti-cash"></i> Залог +${Math.round(cell.price * 0.5)}
                      </button>
                    )}
                    {isMort && (
                      <button className="pf-act redeem" onClick={() => actions.redeem(cell.i)}>
                        <i className="ti ti-cash-banknote"></i> Выкуп ${Math.round(cell.price * 0.55)}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{
          textAlign: 'center',
          padding: '24px',
          color: '#d8c39e'
        }}>
          Пока нет городов. Начни покупать!
        </div>
      )}

      {/* ---- обмен с соперниками ---- */}
      {actions && (
        <div style={{ marginTop: '18px' }}>
          <h4 style={{ margin: '0 0 10px', color: '#fbf2dd', fontSize: '14px' }}>Обмен городами</h4>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {gameState.players.slice(1).filter(p => !p.bankrupt).map(p => (
              <button key={p.id} className="pf-act" style={{ background: p.color }}
                onClick={() => actions.openTrade(p.id)}>
                <i className="ti ti-arrows-exchange"></i> {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- ЭКРАН 3: РЕЙТИНГ ---------- */
function LeaderboardScreen({ gameState }) {
  if (!gameState || !gameState.players) return null;

  const ranked = [...gameState.players].map(p => {
    const props = Object.entries(gameState.owners)
      .filter(([_, id]) => id === p.id)
      .map(([cellIdx]) => VS.CELLS[Number(cellIdx)]);
    const propValue = props.reduce((sum, cell) => sum + (cell.price || 0), 0);
    return { ...p, propValue, netWorth: p.balance + propValue };
  }).sort((a, b) => b.netWorth - a.netWorth);

  let myStats = null;
  try { myStats = JSON.parse(localStorage.getItem('vs_stats') || 'null'); } catch {}

  return (
    <div style={{ padding: '12px', color: '#efe3cd', minHeight: '100vh' }}>
      <h3 style={{ margin: '0 0 14px', color: '#fbf2dd', fontSize: '18px' }}>Таблица лидеров</h3>

      {myStats && myStats.games > 0 && (
        <div style={{
          background: 'rgba(20,12,7,.5)', border: '1px solid rgba(255,235,200,.16)',
          borderRadius: 13, padding: '10px 14px', marginBottom: 12,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12,
        }}>
          <span style={{ color: '#d8c39e' }}><i className="ti ti-chart-bar"></i> Твоя статистика</span>
          <span style={{ fontWeight: 800 }}>
            побед {myStats.wins} из {myStats.games}
            <span style={{ color: '#9c8a6c', fontWeight: 700 }}> · {Math.round(myStats.wins / myStats.games * 100)}%</span>
          </span>
        </div>
      )}

      {ranked.map((p, idx) => {
        const props = Object.entries(gameState.owners)
          .filter(([_, id]) => id === p.id)
          .map(([cellIdx]) => VS.CELLS[Number(cellIdx)]);

        const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;

        const isWinner = gameState.winner === p.id;
        return (
          <div key={p.id} style={{
            background: p.bankrupt ? 'rgba(80,20,16,.45)' : isWinner ? 'rgba(232,196,90,.16)' : 'rgba(20,12,7,.5)',
            border: '1px solid ' + (p.bankrupt ? 'rgba(208,57,47,.5)' : isWinner ? 'var(--gold)' : 'rgba(255,235,200,.16)'),
            borderRadius: '13px',
            padding: '12px',
            marginBottom: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            opacity: p.bankrupt ? 0.65 : 1,
          }}>
            <div style={{
              fontSize: '18px',
              fontWeight: '800',
              color: idx === 0 ? '#e8c45a' : idx === 1 ? '#d8c39e' : '#8a8071',
              minWidth: '28px',
              textAlign: 'center'
            }}>
              {isWinner ? '👑' : p.bankrupt ? '💀' : medal}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#fbf2dd' }}>
                {p.name} {p.id === 'you' ? '(ты)' : ''} {p.bankrupt ? '— банкрот' : ''}
              </div>
              <div style={{ fontSize: '10px', color: '#cdbd9d', marginTop: '2px' }}>
                {props.length} городов · баланс: ${p.balance.toLocaleString('ru-RU')}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '14px', fontWeight: '800', color: '#4aa3d8', fontFamily: 'Fraunces' }}>
                ${p.netWorth.toLocaleString('ru-RU')}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ---------- ЭКРАН 4: ЛОГБУК ---------- */
function LogbookScreen({ gameState }) {
  if (!gameState || !gameState.players) return null;

  const logs = gameState.logs || [];

  const TYPE = {
    buy:      { label: 'Покупка',   icon: 'ti-credit-card',   color: '#e8c45a', sign: '-' },
    rent:     { label: 'Аренда',    icon: 'ti-chart-bar',     color: '#4aa3d8', sign: null },
    tax:      { label: 'Налог',     icon: 'ti-coin',          color: '#d0392f', sign: '-' },
    start:    { label: 'Старт',     icon: 'ti-flag',          color: '#2fae86', sign: '+' },
    chance:   { label: 'Событие',   icon: 'ti-world',         color: '#dd9320', sign: null },
    chest:    { label: 'Удача',     icon: 'ti-gift',          color: '#2fae86', sign: null },
    jail:     { label: 'Тюрьма',   icon: 'ti-lock',          color: '#d0392f', sign: null },
    auction:  { label: 'Аукцион',  icon: 'ti-gavel',         color: '#e8c45a', sign: '-' },
    card:     { label: 'Карта',    icon: 'ti-cards',         color: '#dd9320', sign: null },
    build:    { label: 'Застройка', icon: 'ti-home-plus',    color: '#2fae86', sign: '-' },
    mortgage: { label: 'Залог',    icon: 'ti-home-minus',   color: '#d0392f', sign: '+' },
    bankrupt: { label: 'Банкрот',  icon: 'ti-skull',        color: '#d0392f', sign: null },
    trade:    { label: 'Обмен',    icon: 'ti-arrows-exchange', color: '#9b7fe8', sign: null },
  };

  const money = (n) => '$' + (n || 0).toLocaleString('ru-RU');

  function describeLog(log) {
    const p  = gameState.players[log.player]?.name || 'Игрок';
    const fr = gameState.players[log.from]?.name   || 'Игрок';
    const to = gameState.players[log.to]?.name     || 'Банк';
    switch (log.type) {
      case 'buy':      return `${p} купил ${log.property}`;
      case 'rent':     return `${fr} → ${to} за ${log.property}`;
      case 'tax':      return `${p} заплатил налог`;
      case 'start':    return `${p} прошёл Старт`;
      case 'chance':   return `${p} — карта событий`;
      case 'chest':    return `${p} — карта удачи`;
      case 'jail':     return `${p} отправился в тюрьму`;
      case 'auction':  return `${p} выиграл аукцион: ${log.property}`;
      case 'card':     return `${p} получил карту`;
      case 'build':    return `${p} построил дом на ${log.property}`;
      case 'mortgage': return `${p} заложил ${log.property}`;
      case 'bankrupt': return `${p} выбыл из игры`;
      case 'trade':    return `${fr} обменялся с ${to}`;
      default:         return `${p}`;
    }
  }

  function amountDisplay(log) {
    if (log.type === 'jail' || log.type === 'bankrupt' || log.type === 'chance' || log.type === 'chest' || log.type === 'card') return null;
    const t = TYPE[log.type];
    const amt = log.amount || 0;
    if (!amt) return null;
    let sign = t?.sign;
    if (log.type === 'rent') sign = log.from === 0 ? '-' : '+';
    const color = sign === '-' ? '#ff7f5c' : '#7ff0c4';
    return <span style={{ fontSize: '13px', fontWeight: '700', color, whiteSpace: 'nowrap' }}>{sign}{money(amt)}</span>;
  }

  return (
    <div style={{ padding: '12px', color: '#efe3cd', minHeight: '100vh' }}>
      <h3 style={{ margin: '0 0 14px', color: '#fbf2dd', fontSize: '18px' }}>История ходов</h3>
      {logs.length > 0 ? logs.map((log, idx) => {
        const t = TYPE[log.type] || { label: log.type, icon: 'ti-help', color: '#d8c39e' };
        return (
          <div key={idx} style={{
            background: 'rgba(20,12,7,.5)',
            border: '1px solid rgba(255,235,200,.16)',
            borderRadius: '11px', padding: '10px 12px',
            marginBottom: '8px', display: 'flex', gap: '10px', alignItems: 'center'
          }}>
            <i className={'ti ' + t.icon} style={{ fontSize: 16, color: t.color, minWidth: 20, textAlign: 'center' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: t.color }}>{t.label}</div>
              <div style={{ fontSize: '11px', color: '#cdbd9d', marginTop: '2px' }}>{describeLog(log)}</div>
            </div>
            {amountDisplay(log)}
          </div>
        );
      }) : (
        <div style={{ textAlign: 'center', padding: '24px', color: '#d8c39e' }}>История пуста</div>
      )}
    </div>
  );
}

/* ---------- ГРАФИК БАЛАНСА (SVG) ---------- */
function BalanceChart({ history, players }) {
  if (!history || history.length < 2) {
    return <div style={{ fontSize: '11px', color: '#8a8071', textAlign: 'center', padding: '18px 0' }}>
      Сыграйте несколько ходов — появится график
    </div>;
  }
  const W = 250, H = 110, pad = 6;
  const n = history.length;
  const flat = history.flat();
  const maxV = Math.max(...flat, 1);
  const minV = Math.min(...flat, 0);
  const span = maxV - minV || 1;
  const x = (i) => pad + (i / (n - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - ((v - minV) / span) * (H - 2 * pad);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="rgba(255,235,200,.15)" strokeWidth="1" />
        {players.map((p, pi) => {
          const pts = history.map((row, i) => `${x(i)},${y(row[pi] ?? 0)}`).join(' ');
          return <polyline key={p.id} points={pts} fill="none" stroke={p.color}
            strokeWidth={p.id === 'you' ? 2.4 : 1.4} strokeLinejoin="round" strokeLinecap="round"
            opacity={p.bankrupt ? 0.35 : 1} />;
        })}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
        {players.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#cdbd9d' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: p.color, display: 'inline-block' }}></span>
            {p.name}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- ЭКРАН 5: АНАЛИТИКА ---------- */
function AnalyticsScreen({ gameState }) {
  if (!gameState || !gameState.players) return null;

  const myBalance = gameState.players[0].balance;
  const avgBalance = gameState.players.reduce((sum, p) => sum + p.balance, 0) / gameState.players.length;
  const maxBalance = Math.max(...gameState.players.map(p => p.balance));
  const minBalance = Math.min(...gameState.players.map(p => p.balance));

  const myProps = Object.entries(gameState.owners).filter(([_, id]) => id === 'you').length;
  const totalProps = Object.entries(gameState.owners).length;

  const history = gameState.history || [];

  return (
    <div style={{ padding: '12px', color: '#efe3cd', minHeight: '100vh' }}>
      <h3 style={{ margin: '0 0 14px', color: '#fbf2dd', fontSize: '18px' }}>Аналитика</h3>

      {/* График баланса по ходам */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 10px', color: '#fbf2dd', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Динамика баланса
        </h4>
        <div style={{ background: 'rgba(20,12,7,.5)', border: '1px solid rgba(255,235,200,.16)', borderRadius: '13px', padding: '12px' }}>
          <BalanceChart history={history} players={gameState.players} />
        </div>
      </div>

      {/* Статистика баланса */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 10px', color: '#fbf2dd', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Баланс игроков
        </h4>
        <div style={{
          background: 'rgba(20,12,7,.5)',
          border: '1px solid rgba(255,235,200,.16)',
          borderRadius: '13px',
          padding: '14px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '11px' }}>
            <span style={{ color: '#d8c39e' }}>Максимум</span>
            <span style={{ color: '#7ff0c4', fontWeight: '700' }}>${maxBalance.toLocaleString('ru-RU')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '11px' }}>
            <span style={{ color: '#d8c39e' }}>Среднее</span>
            <span style={{ color: '#e8c45a', fontWeight: '700' }}>${Math.round(avgBalance).toLocaleString('ru-RU')}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#d8c39e' }}>Минимум</span>
            <span style={{ color: '#ff7f5c', fontWeight: '700' }}>${minBalance.toLocaleString('ru-RU')}</span>
          </div>
        </div>
      </div>

      {/* Статистика недвижимости */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 10px', color: '#fbf2dd', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          Недвижимость
        </h4>
        <div style={{
          background: 'rgba(20,12,7,.5)',
          border: '1px solid rgba(255,235,200,.16)',
          borderRadius: '13px',
          padding: '14px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', fontSize: '11px' }}>
            <span style={{ color: '#d8c39e' }}>Всего на доске</span>
            <span style={{ color: '#fbf2dd', fontWeight: '700' }}>{totalProps} городов</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px' }}>
            <span style={{ color: '#d8c39e' }}>В твоём владении</span>
            <span style={{ color: '#4aa3d8', fontWeight: '700' }}>{myProps} городов ({Math.round(myProps / 40 * 100)}%)</span>
          </div>
        </div>
      </div>

      {/* Распределение по регионам */}
      <div>
        <h4 style={{ margin: '0 0 10px', color: '#fbf2dd', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.08em' }}>
          По регионам
        </h4>
        {Object.entries(VS.REGIONS).map(([key, region]) => {
          const regionCells = VS.CELLS.filter(c => c.region === key && c.type === 'prop');
          const owned = regionCells.filter(c => gameState.owners[c.i]).length;
          const percent = (owned / regionCells.length) * 100;
          return (
            <div key={key} style={{
              background: 'rgba(20,12,7,.5)',
              border: '1px solid rgba(255,235,200,.16)',
              borderRadius: '11px',
              padding: '10px 12px',
              marginBottom: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#fbf2dd' }}>{region.label}</span>
                <span style={{ fontSize: '11px', color: '#d8c39e' }}>{owned}/{regionCells.length}</span>
              </div>
              <div style={{
                height: '6px',
                background: 'rgba(255,235,200,.08)',
                borderRadius: '3px',
                overflow: 'hidden'
              }}>
                <div style={{
                  height: '100%',
                  background: region.color,
                  width: percent + '%',
                  transition: 'width .3s ease'
                }}></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- МОДАЛКА ОБМЕНА ---------- */
function TradeModal({ gameState, actions, myIdx = 0 }) {
  const t = gameState.trade;
  if (!t) return null;
  const me = gameState.players[myIdx];
  const partner = gameState.players.find(p => p.id === t.withId);
  if (!partner) return null;

  // обмениваемые города (без заложенных/застроенных)
  const tradable = (ownerId) => Object.keys(gameState.owners)
    .filter(idx => gameState.owners[idx] === ownerId && !gameState.mortgaged[idx] && !(gameState.houses[idx] > 0))
    .map(idx => VS.CELLS[Number(idx)]);

  const myCities = tradable(me.id);
  const theirCities = tradable(partner.id);

  const Chip = ({ cell, side, active }) => {
    const rg = VS.REGIONS[cell.region];
    return (
      <button onClick={() => actions.toggleTradeItem(side, cell.i)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
          background: active ? 'rgba(232,196,90,.22)' : 'rgba(255,255,255,.05)',
          border: '1px solid ' + (active ? 'var(--gold)' : 'rgba(255,235,200,.14)'),
          borderRadius: '8px', padding: '6px 8px', marginBottom: '5px', color: '#fbf2dd', fontSize: '11px', fontWeight: '700'
        }}>
        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: rg ? rg.color : '#888', marginRight: 6 }}></span>
        {cell.name} <span style={{ color: '#cdbd9d', fontWeight: 400 }}>${cell.price}</span>
      </button>
    );
  };

  return (
    <div className="overlay" onClick={actions.closeTrade}>
      <div className="vs-modal" onClick={e => e.stopPropagation()}>
        <div className="vs-modal-head">
          <i className="ti ti-arrows-exchange lead"></i>
          <div className="vs-modal-title">Обмен с {partner.name}</div>
          <button className="vs-close" onClick={actions.closeTrade}>
            <i className="ti ti-x"></i>
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#d8c39e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Отдаёшь</div>
            {myCities.length ? myCities.map(c => <Chip key={c.i} cell={c} side="give" active={t.give.includes(c.i)} />)
              : <div style={{ fontSize: '10px', color: '#8a8071' }}>нет городов</div>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '10px', color: '#d8c39e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '.06em' }}>Получаешь</div>
            {theirCities.length ? theirCities.map(c => <Chip key={c.i} cell={c} side="get" active={t.get.includes(c.i)} />)
              : <div style={{ fontSize: '10px', color: '#8a8071' }}>нет городов</div>}
          </div>
        </div>

        <div style={{ marginTop: '10px' }}>
          <div style={{ fontSize: '10px', color: '#d8c39e', marginBottom: '4px' }}>
            Доплата от тебя: ${t.money}
          </div>
          <input type="range" min="-500" max="500" step="50" value={t.money}
            onChange={e => actions.setTradeMoney(Number(e.target.value))}
            style={{ width: '100%' }} />
          <div style={{ fontSize: '9px', color: '#8a8071' }}>← ты доплачиваешь · тебе доплачивают →</div>
        </div>

        <button className="btn primary" style={{ width: '100%', marginTop: '12px' }}
          onClick={actions.proposeTrade}>
          <i className="ti ti-check"></i> Предложить обмен
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   AuctionModal — оверлей аукциона
   myIdx — индекс «локального» игрока (0 в офлайне, N в онлайне)
   ══════════════════════════════════════════════════════ */
function AuctionModal({ gameState, actions, myIdx = 0 }) {
  const [customBid, setCustomBid] = useState('');
  if (!gameState || gameState.phase !== 'auction' || !gameState.auction) return null;

  const { auction } = gameState;
  const cell       = VS.CELLS[auction.cellIdx];
  const region     = cell.region ? VS.REGIONS[cell.region] : null;
  const highBidder = auction.highBidder
    ? gameState.players.find(p => p.id === auction.highBidder)
    : null;
  const myTurn    = auction.turnIdx === myIdx;
  const me        = gameState.players[myIdx];
  const curPlayer = gameState.players[auction.turnIdx];

  const canBidAmount = (amt) => amt > auction.highBid && amt <= me.balance;

  function quickBid(delta) {
    const amt = auction.highBid + delta;
    if (canBidAmount(amt)) actions.auctionBid(amt);
  }
  function submitCustom() {
    const amt = parseInt(customBid, 10);
    if (!isNaN(amt) && canBidAmount(amt)) { actions.auctionBid(amt); setCustomBid(''); }
  }

  return (
    <div className="overlay">
      <div className="vs-modal" onClick={e => e.stopPropagation()}>
        {/* Заголовок */}
        <div className="vs-modal-head">
          <i className="ti ti-hammer lead"></i>
          <div className="vs-modal-title">Аукцион</div>
        </div>

        {/* Клетка */}
        <div style={{
          background: 'rgba(0,0,0,.3)', borderRadius: 10, padding: '10px 12px',
          marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {region && <div style={{ width: 10, height: 40, borderRadius: 3, background: region.color, flexShrink: 0 }}></div>}
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#fbf2dd' }}>{cell.name}</div>
            <div style={{ fontSize: 10, color: '#cdbd9d' }}>{region ? region.label : cell.type} · цена {money(cell.price || 0)}</div>
          </div>
        </div>

        {/* Текущая ставка */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: '#d8c39e' }}>
            Лидер: <b style={{ color: highBidder ? highBidder.color : '#8a8071' }}>
              {highBidder ? highBidder.name : 'ставок нет'}
            </b>
          </div>
          <div style={{ fontFamily: 'Fraunces', fontSize: 20, fontWeight: 800, color: '#7ff0c4' }}>
            {auction.highBid > 0 ? money(auction.highBid) : '—'}
          </div>
        </div>

        {/* Чья очередь */}
        <div style={{ fontSize: 11, color: '#cdbd9d', marginBottom: 10, textAlign: 'center' }}>
          {myTurn
            ? <span style={{ color: '#e8c45a', fontWeight: 700 }}>Твоя очередь!</span>
            : <span><i className="ti ti-loader-2" style={{ marginRight: 4 }}></i>{curPlayer?.name} думает…</span>
          }
        </div>

        {/* Кнопки ставок (только если мой ход) */}
        {myTurn && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {[10, 50, 100].map(d => (
                <button key={d} className="btn sec"
                  disabled={!canBidAmount(auction.highBid + d)}
                  onClick={() => quickBid(d)}
                  style={{ flex: 1, fontSize: 12 }}>
                  +{d}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              <input
                type="number" min={auction.highBid + 1} max={me.balance}
                value={customBid}
                onChange={e => setCustomBid(e.target.value)}
                placeholder={`мин. ${auction.highBid + 1}`}
                style={{
                  flex: 1, padding: '7px 10px', borderRadius: 8,
                  border: '1px solid rgba(255,235,200,.2)',
                  background: 'rgba(0,0,0,.3)', color: '#fbf2dd', fontSize: 12,
                }}
              />
              <button className="btn primary" onClick={submitCustom}
                disabled={!canBidAmount(parseInt(customBid, 10))}
                style={{ flexShrink: 0 }}>
                Ставка
              </button>
            </div>
            <button className="btn sec" style={{ width: '100%', color: '#ff9b8c' }}
              onClick={actions.auctionPass}>
              <i className="ti ti-player-skip-forward"></i> Пасовать
            </button>
            <div style={{ fontSize: 9, color: '#7a6f5a', marginTop: 6, textAlign: 'center' }}>
              Твой баланс: {money(me.balance)}
            </div>
          </>
        )}

        {/* Список спасовавших */}
        {auction.passed.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 10, color: '#8a8071' }}>
            Пасовали: {auction.passed.map(id => gameState.players.find(p => p.id === id)?.name).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   ЭКРАН ПРАВИЛ
══════════════════════════════════════════════════════ */
function RulesScreen() {
  const S = {
    wrap: { padding: '12px 14px', color: '#efe3cd', minHeight: '100%' },
    h1: { fontFamily: 'Fraunces, serif', fontSize: 22, color: '#e8c45a', marginBottom: 16 },
    sh: { fontFamily: 'Fraunces, serif', fontSize: 15, color: '#e8c45a', marginBottom: 6, marginTop: 16 },
    p: { fontSize: 13, lineHeight: 1.6, color: '#d8cdb8', marginBottom: 6 },
    ul: { paddingLeft: 18, margin: '4px 0 8px', listStyle: 'disc' },
    li: { fontSize: 13, lineHeight: 1.6, color: '#d8cdb8', marginBottom: 3 },
  };

  return (
    <div style={S.wrap}>
      <div style={S.h1}>Правила игры «Вокруг света»</div>

      <div style={S.sh}>Цель</div>
      <p style={S.p}>Разорить всех соперников. Побеждает последний оставшийся не банкротом.</p>

      <div style={S.sh}>Начало</div>
      <p style={S.p}>Каждый игрок получает $1500 и ставит фишку на «Старт». Ходят по очереди.</p>

      <div style={S.sh}>Ход</div>
      <p style={S.p}>Бросаешь два кубика и двигаешь фишку вперёд на выпавшую сумму. За проход или попадание на «Старт» получаешь $200. Выпал дубль — ходишь ещё раз; три дубля подряд — отправляешься в «Карантин» (тюрьму).</p>

      <div style={S.sh}>Клетки поля</div>
      <ul style={S.ul}>
        <li style={S.li}>Города (по регионам мира) — можно купить за указанную цену.</li>
        <li style={S.li}>Аэропорты (4 штуки, цена $200) — аренда зависит от количества аэропортов у владельца: 1→$25, 2→$50, 3→$100, 4→$200.</li>
        <li style={S.li}>Энергосеть и Водоканал (цена $150) — аренда = сумма на кубиках ×4 (одна) или ×10 (обе).</li>
        <li style={S.li}>Таможня — налог $200. Сбор — налог $100. Уходит в банк.</li>
        <li style={S.li}>Событие и Удача — тянешь карту и выполняешь её.</li>
        <li style={S.li}>Старт — +$200 при прохождении. Транзит — просто стоянка. Курорт — отдых. Карантин — отправляет в тюрьму.</li>
      </ul>

      <div style={S.sh}>Покупка и аукцион</div>
      <p style={S.p}>Встал на свободный город/аэропорт/коммуналку — покупаешь по цене. Если отказываешься — клетка уходит с аукциона всем игрокам (включая тебя), с любой ставки. Кто предложил больше — тот и купил. Просто «пройти мимо» нельзя.</p>

      <div style={S.sh}>Аренда</div>
      <p style={S.p}>Встал на чужую клетку — платишь владельцу аренду по карточке. С заложенной клетки аренда не берётся.</p>

      <div style={S.sh}>Монополия и стройка</div>
      <p style={S.p}>Собрал все города одного региона — базовая аренда удваивается, и можно строить дома. Дома строятся равномерно (нельзя поставить второй дом, пока на всех клетках группы нет хотя бы одного). Цена дома по регионам: Сахара и Европа — $50, Латам и Азия — $100, Ближний Восток и Океания — $150, Север и Столицы — $200. Пятая постройка превращает 4 дома в отель. Банк: 32 дома и 12 отелей — если закончились, строить нельзя.</p>

      <div style={S.sh}>Залог</div>
      <p style={S.p}>Нужны деньги — заложи город в банк за 50% цены (нельзя, если в группе стоят дома — сначала продай их). Выкуп — 55% цены. Заложенный город не приносит аренды.</p>

      <div style={S.sh}>Тюрьма (Карантин)</div>
      <p style={S.p}>Попадаешь за три дубля подряд, за клетку «Карантин» или по карте. Чтобы выйти: брось дубль, либо заплати $50, либо используй карту «выход из тюрьмы». Если за три хода дубль не выпал — платишь $50 и ходишь. Сидя в тюрьме — получаешь аренду, можешь строить, закладывать и торговать.</p>

      <div style={S.sh}>Обмен</div>
      <p style={S.p}>С другими игроками можно меняться городами, деньгами и картами «выход из тюрьмы» в любых сочетаниях. Нельзя обменивать заложенные или застроенные города.</p>

      <div style={S.sh}>Банкротство</div>
      <p style={S.p}>Если не можешь заплатить, сначала продай дома и заложи имущество. Если денег всё равно не хватает — ты банкрот, всё имущество переходит кредитору (или уходит с аукциона, если кредитор — банк).</p>

      <div style={S.sh}>Победа</div>
      <p style={S.p}>Когда все соперники разорились, последний оставшийся выигрывает.</p>
    </div>
  );
}

/* ══ Настройки WS-сервера (меняй при деплое) ══ */
const WS_URL = window.WS_URL || 'ws://localhost:8765';

/* ---------- ЭКРАН ВЫБОРА РЕЖИМА ---------- */
function MenuScreen({ onStart }) {
  const [count, setCount] = useState(4);
  // sub: null | 'join' | 'create' | 'connecting'
  const [privateSub, setPrivateSub] = useState(null);
  const [matchSub,   setMatchSub]   = useState(false);
  const [code,    setCode]    = useState('');
  const [myName,  setMyName]  = useState(() => tgUserName());
  const [wsErr,   setWsErr]   = useState('');
  const [botStyle, setBotStyle] = useState(null); // null=разные | 'careful' | 'buyer'
  const [resume,   setResume]   = useState(() => loadResume());

  function doCreate() {
    if (!myName.trim()) { setWsErr('Введи своё имя'); return; }
    // Передаём параметры — PrivateLobbyApp сам откроет WS и создаст комнату
    onStart({ mode: 'private', action: 'create', myName: myName.trim() });
  }

  function doJoin() {
    if (!myName.trim()) { setWsErr('Введи своё имя'); return; }
    if (code.trim().length < 4) { setWsErr('Введи код комнаты (6 символов)'); return; }
    onStart({ mode: 'private', action: 'join', code: code.trim().toUpperCase(), myName: myName.trim() });
  }

  return (
    <div className="menu">
      <div className="brand">
        <div className="globewrap"><i className="ti ti-world"></i></div>
        <h1>ВОКРУГ<br /><span>СВЕТА</span></h1>
        <p>Путешествие-монополия на 2–4 игроков</p>
      </div>

      {/* Вернуться в незаконченную онлайн-партию */}
      {resume && (
        <div className="mode" style={{ borderColor: 'var(--good)', marginBottom: 11 }} role="button"
          onClick={() => {
            haptic('impact', 'light');
            onStart({ mode: 'private', action: 'rejoin', code: resume.code, token: resume.token, myName: resume.myName || tgUserName() });
          }}>
          <div className="mi" style={{ background: 'var(--good)' }}><i className="ti ti-arrow-back-up"></i></div>
          <div className="mt">
            <div className="h">Вернуться в партию</div>
            <div className="s">Комната {resume.code} — игра ждёт тебя</div>
          </div>
          <button onClick={e => { e.stopPropagation(); clearResume(); setResume(null); }}
            style={{ background: 'none', border: 0, color: '#cdbd9d', cursor: 'pointer', fontSize: 16 }}>
            <i className="ti ti-x"></i>
          </button>
        </div>
      )}

      <div className="section">Режим игры</div>
      <div className="modes">
        {/* С ботами — главный сценарий, золотая карточка */}
        <div className="mode primary" role="button" tabIndex={0}
          onClick={() => {
            haptic('impact', 'light');
            window.VS_BOT_STYLE = botStyle; // характер ботов для движка
            onStart({ mode: 'bots', count });
          }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '13px', width: '100%' }}>
            <div className="mi" style={{ background: '#3a2c0e', color: '#f1d27c' }}><i className="ti ti-robot"></i></div>
            <div className="mt">
              <div className="h">Играть с ботами</div>
              <div className="s">Соперники-ИИ — партия начнётся сразу</div>
            </div>
            <i className="ti ti-player-play chev"></i>
          </div>
          <div className="countrow" onClick={e => e.stopPropagation()}>
            <span className="countlbl">Игроки</span>
            {[2, 3, 4].map(n => (
              <div key={n} className={'countpill' + (count === n ? ' on' : '')}
                onClick={() => { haptic('select'); setCount(n); }}>{n}</div>
            ))}
          </div>
          <div className="countrow" onClick={e => e.stopPropagation()}>
            <span className="countlbl">Боты</span>
            {[[null, 'Разные'], ['careful', 'Спокойные'], ['buyer', 'Жадные']].map(([v, lbl]) => (
              <div key={lbl} className={'countpill' + (botStyle === v ? ' on' : '')}
                style={{ fontSize: 11 }}
                onClick={() => { haptic('select'); setBotStyle(v); }}>{lbl}</div>
            ))}
          </div>
        </div>

        {/* Быстрая игра (матчмейкинг) */}
        <div className={'mode' + (matchSub ? ' open' : '')}
          style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default',
            background: matchSub ? 'rgba(31,149,118,.10)' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}
            onClick={() => { if (!matchSub) { setMatchSub(true); setPrivateSub(null); setWsErr(''); } }}>
            <div className="mi" style={{ background: 'var(--no)' }}><i className="ti ti-world-bolt"></i></div>
            <div className="mt">
              <div className="h">Быстрая игра</div>
              <div className="s">Найти случайных соперников онлайн</div>
            </div>
            {!matchSub && <i className="ti ti-chevron-right chev"></i>}
            {matchSub && (
              <button onClick={e => { e.stopPropagation(); setMatchSub(false); setWsErr(''); }}
                style={{ marginLeft: 'auto', background: 'none', border: 0, color: '#cdbd9d', cursor: 'pointer', fontSize: 16 }}>
                <i className="ti ti-x"></i>
              </button>
            )}
          </div>

          {matchSub && (
            <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
              <input className="field" value={myName} onChange={e => setMyName(e.target.value)} maxLength={20}
                placeholder="Твоё имя" style={{ marginBottom: 4 }} />
              <div className="countrow">
                <span className="countlbl">Игроки</span>
                {[2, 3, 4].map(n => (
                  <div key={n} className={'countpill' + (count === n ? ' on' : '')}
                    onClick={() => { haptic('select'); setCount(n); }}>{n}</div>
                ))}
              </div>
              <button className="btn primary" style={{ width: '100%', marginTop: 10 }} onClick={() => {
                if (!myName.trim()) { setWsErr('Введи своё имя'); return; }
                onStart({ mode: 'matchmaking', playerCount: count, myName: myName.trim() });
              }}>
                <i className="ti ti-search"></i> Найти игру
              </button>
              {wsErr && <div style={{ fontSize: 11, color: '#ff9b8c', marginTop: 6 }}>{wsErr}</div>}
            </div>
          )}
        </div>

        {/* Приват по коду — рабочий */}
        <div className={'mode' + (privateSub ? ' open' : '')}
          style={{ flexDirection: 'column', alignItems: 'stretch', cursor: 'default', background: privateSub ? 'rgba(232,196,90,.10)' : undefined }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}
            onClick={() => !privateSub && setPrivateSub('menu')}>
            <div className="mi" style={{ background: 'var(--cap)' }}><i className="ti ti-key"></i></div>
            <div className="mt">
              <div className="h">Приват по коду</div>
              <div className="s">Создай комнату и позови друзей</div>
            </div>
            {!privateSub && <i className="ti ti-chevron-right chev"></i>}
            {privateSub && <button onClick={e => { e.stopPropagation(); setPrivateSub(null); setWsErr(''); }}
              style={{ marginLeft: 'auto', background: 'none', border: 0, color: '#cdbd9d', cursor: 'pointer', fontSize: 16 }}>
              <i className="ti ti-x"></i>
            </button>}
          </div>

          {privateSub && (
            <div style={{ marginTop: 10 }} onClick={e => e.stopPropagation()}>
              {/* Имя */}
              <input className="field" value={myName} onChange={e => setMyName(e.target.value)} maxLength={20}
                placeholder="Твоё имя" style={{ marginBottom: 8 }} />

              {/* Две кнопки или форма */}
              {privateSub === 'menu' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn primary" style={{ flex: 1 }}
                    onClick={() => setPrivateSub('create')}>
                    <i className="ti ti-plus"></i> Создать
                  </button>
                  <button className="btn sec" style={{ flex: 1 }}
                    onClick={() => setPrivateSub('join')}>
                    <i className="ti ti-door-enter"></i> Войти
                  </button>
                </div>
              )}

              {privateSub === 'create' && (
                <button className="btn primary" style={{ width: '100%' }}
                  onClick={doCreate}>
                  <i className="ti ti-plus"></i> Создать комнату
                </button>
              )}

              {privateSub === 'join' && (
                <div className="codebox">
                  <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6}
                    placeholder="КОД КОМНАТЫ"
                    style={{ textTransform: 'uppercase', letterSpacing: '.14em', fontWeight: 800 }} />
                  <button className="btn sec" onClick={doJoin}
                    style={{ flex: '0 0 auto' }}>
                    Войти
                  </button>
                </div>
              )}

              {wsErr && <div style={{ fontSize: 11, color: '#ff9b8c', marginTop: 6 }}>{wsErr}</div>}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

/* ══════════════════════════════════════════════════════
   MatchmakingLobbyApp — поиск случайного матча
   session = { mode:'matchmaking', playerCount:2|3|4, myName }
   ══════════════════════════════════════════════════════ */
function MatchmakingLobbyApp({ session, onHome }) {
  const { playerCount, myName } = session;
  const [status,     setStatus]     = useState('connecting'); // 'connecting'|'waiting'|'matched'
  const [position,   setPosition]   = useState(0);
  const [retryN,     setRetryN]     = useState(0);
  const [gameState,  setGameState]  = useState(null);
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [wsErr,      setWsErr]      = useState('');
  const wsRef    = useRef(null);
  const statusRef = useRef('connecting');
  const [localTrade, setLocalTrade] = useState(null);
  const [deadline,   setDeadline]   = useState(null);
  const [seatsInfo,  setSeatsInfo]  = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const tokenRef     = useRef(null);
  const codeRef      = useRef('');
  const overRef      = useRef(false);
  const reconTimerRef = useRef(null);
  const shownCardRef    = useRef(null);
  const prevPosRef      = useRef({});
  const animTimerRef    = useRef(null);
  useTgBackButton(onHome);

  function setStatusSync(s) { statusRef.current = s; setStatus(s); }

  useEffect(() => {
    if (!gameState?.toast) return;
    const t = setTimeout(() => setGameState(s => s ? { ...s, toast: null } : s), 1800);
    return () => clearTimeout(t);
  }, [gameState?.toast]);
  useEffect(() => {
    if (!gameState?.card) return;
    const t = setTimeout(() => setGameState(s => s ? { ...s, card: null } : s), 2800);
    return () => clearTimeout(t);
  }, [gameState?.card]);

  function applyOnlineState(st) {
    // card fix: don't re-show a card that's already been displayed this turn
    const cardKey = st.card ? st.card + ':' + st.turnNum : null;
    const finalSt = (st.card && shownCardRef.current === cardKey)
      ? { ...st, card: null }
      : st;
    if (st.card && shownCardRef.current !== cardKey) shownCardRef.current = cardKey;

    // animation: find which player moved and step them cell-by-cell
    let movedId = null, fromPos = -1, toPos = -1;
    if (st.players) {
      for (const p of st.players) {
        const prev = prevPosRef.current[p.id];
        if (prev !== undefined && prev !== p.pos) {
          movedId = p.id; fromPos = prev; toPos = p.pos;
          break;
        }
      }
      prevPosRef.current = Object.fromEntries(st.players.map(p => [p.id, p.pos]));
    }

    const steps = movedId ? ((toPos - fromPos + 40) % 40) : 0;
    if (steps > 0 && steps <= 14) {
      clearTimeout(animTimerRef.current);
      let step = 0;
      function doStep() {
        step++;
        const curPos = (fromPos + step) % 40;
        if (step >= steps) {
          setGameState({ ...finalSt, hoppingId: null });
        } else {
          setGameState(s => s ? {
            ...s,
            players: s.players.map(p => p.id === movedId ? { ...p, pos: curPos } : p),
            hoppingId: movedId,
          } : s);
          animTimerRef.current = setTimeout(doStep, 190);
        }
      }
      // kick off — keep current state but flag who's moving
      setGameState(s => s ? { ...s, hoppingId: movedId } : s);
      animTimerRef.current = setTimeout(doStep, 190);
    } else {
      setGameState(finalSt);
    }
  }

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.onopen = () => {
      if (tokenRef.current && codeRef.current) {
        ws.send(JSON.stringify({ type: 'rejoin', code: codeRef.current, token: tokenRef.current }));
        return;
      }
      ws.send(JSON.stringify({ type: 'matchmaking', name: myName, playerCount }));
    };
    ws.onerror   = () => { if (statusRef.current !== 'matched') setWsErr('Нет соединения с сервером'); };
    ws.onclose   = () => {
      if (statusRef.current === 'matched' && !overRef.current) {
        setReconnecting(true);
        clearTimeout(reconTimerRef.current);
        reconTimerRef.current = setTimeout(() => setRetryN(n => n + 1), 1500);
      } else if (statusRef.current !== 'matched') {
        setWsErr('Соединение потеряно');
      }
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'queued') {
        setStatusSync('waiting'); setPosition(msg.position);
      } else if (msg.type === 'matched') {
        setMyPlayerId(msg.myId);
        codeRef.current = msg.code;
        if (msg.token) { tokenRef.current = msg.token; saveResume(msg.code, msg.token, myName); }
        const st = msg.state;
        prevPosRef.current = Object.fromEntries((st.players || []).map(p => [p.id, p.pos]));
        setGameState(st);
        setStatusSync('matched');
        setDeadline(msg.deadline || null);
      } else if (msg.type === 'rejoined') {
        const st = msg.state;
        setMyPlayerId(msg.myId);
        codeRef.current = msg.code;
        tokenRef.current = msg.token;
        setReconnecting(false);
        setWsErr('');
        if (st) {
          prevPosRef.current = Object.fromEntries((st.players || []).map(p => [p.id, p.pos]));
          setGameState(st);
          setStatusSync('matched');
          setDeadline(msg.deadline || null);
        }
      } else if (msg.type === 'rejoinFailed') {
        clearResume();
        tokenRef.current = null;
        setReconnecting(false);
        setWsErr('Партия уже завершена или место потеряно');
      } else if (msg.type === 'player_status') {
        setSeatsInfo(msg.seats);
      } else if (msg.type === 'deadline') {
        setDeadline(msg.deadline || null);
      } else if (msg.type === 'state') {
        applyOnlineState(msg.state);
        setDeadline(msg.deadline || null);
        if (msg.seats) setSeatsInfo(msg.seats);
        if (msg.state && (msg.state.phase === 'over' || msg.state.winner)) {
          overRef.current = true;
          clearResume();
        }
      } else if (msg.type === 'error') {
        setWsErr(msg.msg);
      }
    };
    return () => {
      clearTimeout(reconTimerRef.current);
      ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close();
    };
  }, [retryN]);

  function cancel() {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancelMatchmaking' }));
    onHome();
  }
  function sendAction(action) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'action', action }));
  }

  // ── игра началась ──
  if (status === 'matched' && gameState) {
    const myIdxFinal = gameState.players.findIndex(p => p.id === myPlayerId);
    const actions = {
      rollDice:    () => gameState.current === myIdxFinal && sendAction({ type: 'roll' }),
      buy:         () => sendAction({ type: 'buy' }),
      pass:        () => sendAction({ type: 'pass' }),
      payRentDue:  () => sendAction({ type: 'payRent' }),
      endTurn:     () => sendAction({ type: 'endTurn' }),
      payBail:     () => sendAction({ type: 'payBail' }),
      useBailCard: () => sendAction({ type: 'useBailCard' }),
      buildHouse:  (cellIdx) => sendAction({ type: 'buildHouse', cellIdx }),
      sellHouse:   (cellIdx) => sendAction({ type: 'sellHouse', cellIdx }),
      mortgage:    (cellIdx) => sendAction({ type: 'mortgage', cellIdx }),
      redeem:      (cellIdx) => sendAction({ type: 'redeem', cellIdx }),
      toggleZoom:  () => setGameState(s => s ? { ...s, zoom: !s.zoom } : s),
      openTrade: (withId) => {
        if (!gameState.players.find(p => p.id === withId)) return;
        setLocalTrade({ withId, give: [], get: [], money: 0 });
      },
      closeTrade: () => setLocalTrade(null),
      toggleTradeItem: (side, cellIdx) => setLocalTrade(t => {
        if (!t) return null;
        const arr = t[side];
        return { ...t, [side]: arr.includes(cellIdx) ? arr.filter(x => x !== cellIdx) : [...arr, cellIdx] };
      }),
      setTradeMoney: (v) => setLocalTrade(t => t ? { ...t, money: v } : null),
      proposeTrade: () => {
        if (!localTrade) return;
        sendAction({ type: 'proposeTrade', withId: localTrade.withId, give: localTrade.give, get: localTrade.get, money: localTrade.money });
        setLocalTrade(null);
      },
      auctionBid:  (amount) => sendAction({ kind: 'bid', amount }),
      auctionPass: ()       => sendAction({ kind: 'passBid' }),
      payDebt:       () => sendAction({ type: 'payDebt' }),
      surrenderDebt: () => sendAction({ type: 'surrender' }),
      restart: onHome,
    };
    const displayState = { ...gameState, trade: localTrade };
    const portfolioState = myIdxFinal > 0
      ? { ...displayState, players: [displayState.players[myIdxFinal], ...displayState.players.filter((_, i) => i !== myIdxFinal)] }
      : displayState;
    return (
      <OnlineTabsApp gameState={displayState} portfolioState={portfolioState}
        actions={actions} myIdx={myIdxFinal} onHome={onHome}
        deadline={deadline} seatsInfo={seatsInfo} reconnecting={reconnecting} />
    );
  }

  // ── ожидание ──
  const waiting = playerCount - position;
  const found = Math.max(0, Math.min(position || 0, playerCount));
  return (
    <div className="phone big" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div className="screen lobbyscreen" style={{ alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <button className="homebtn" onClick={cancel} title="назад"><i className="ti ti-arrow-left"></i></button>

        {!wsErr && (
          <div className="globespin"><i className="ti ti-world"></i></div>
        )}

        <div className="lobbytitle" style={{ margin: '12px 0 2px' }}>Поиск игры</div>
        <div style={{ fontSize: 11, color: '#cdbd9d' }}>{myName}</div>

        {!wsErr && status === 'waiting' && (
          <>
            <div className="qcount">{found}<span>/</span>{playerCount}</div>
            <div className="slots" style={{ margin: '6px 0 8px' }}>
              {Array.from({ length: playerCount }).map((_, i) => i < found ? (
                <div key={i} className="slot">
                  <div className="savatar" style={{ background: LOBBY_COLORS[i % LOBBY_COLORS.length] }}>
                    {i === 0 ? nameInitials(myName) : <i className="ti ti-user"></i>}
                  </div>
                  <span>{i === 0 ? 'ты' : 'игрок'}</span>
                </div>
              ) : (
                <div key={i} className="slot empty">
                  <div className="savatar"><i className="ti ti-dots"></i></div>
                  <span>поиск…</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#cdbd9d', marginBottom: 18 }}>
              {waiting > 0
                ? `Ждём ещё ${waiting} ${waiting === 1 ? 'игрока' : 'игроков'}…`
                : 'Собираем игру…'}
            </div>
          </>
        )}
        {!wsErr && status === 'connecting' && (
          <div className="waitnote"><i className="ti ti-loader-2"></i> Подключение…</div>
        )}

        {wsErr && (
          <WsError msg={wsErr} onRetry={() => { setWsErr(''); setStatusSync('connecting'); setRetryN(n => n + 1); }} />
        )}

        <button className="btn ghost" style={{ marginTop: 16 }} onClick={cancel}>
          <i className="ti ti-x"></i> Отменить
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════
   PrivateLobbyApp — ожидание игроков + старт
   session = { mode:'private', action:'create'|'join', myName, code? }
   ══════════════════════════════════════════════════════ */
function PrivateLobbyApp({ session, onHome }) {
  const { action: initAction, myName, code: initCode } = session;
  useTgBackButton(onHome);

  // Всё что узнаём от сервера
  const [myPlayerId, setMyPlayerId] = useState(null); // 'p0', 'p1', ...
  const [roomCode,   setRoomCode]   = useState(initCode || '');
  const [players,    setPlayers]    = useState([]);
  const [started,    setStarted]    = useState(false);
  const [gameState,  setGameState]  = useState(null);
  const [wsErr,      setWsErr]      = useState('');
  const [localTrade, setLocalTrade] = useState(null);
  const [copied,     setCopied]     = useState(false);
  const [retryN,     setRetryN]     = useState(0);
  const [deadline,   setDeadline]   = useState(null);
  const [seatsInfo,  setSeatsInfo]  = useState(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [startBalance, setStartBalance] = useState(1500);
  const wsRef        = useRef(null);
  const tokenRef     = useRef(session.token || null);
  const codeRef      = useRef(initCode || '');
  const startedRef   = useRef(false);
  const overRef      = useRef(false);
  const reconTimerRef = useRef(null);
  const shownCardRef = useRef(null);
  const prevPosRef   = useRef({});
  const animTimerRef = useRef(null);

  // тосты / карточки гаснут сами
  useEffect(() => {
    if (!gameState?.toast) return;
    const t = setTimeout(() => setGameState(s => s ? {...s, toast: null} : s), 1800);
    return () => clearTimeout(t);
  }, [gameState?.toast]);
  useEffect(() => {
    if (!gameState?.card) return;
    const t = setTimeout(() => setGameState(s => s ? {...s, card: null} : s), 2800);
    return () => clearTimeout(t);
  }, [gameState?.card]);

  function applyOnlineState(st) {
    const cardKey = st.card ? st.card + ':' + st.turnNum : null;
    const finalSt = (st.card && shownCardRef.current === cardKey)
      ? { ...st, card: null } : st;
    if (st.card && shownCardRef.current !== cardKey) shownCardRef.current = cardKey;

    let movedId = null, fromPos = -1, toPos = -1;
    if (st.players) {
      for (const p of st.players) {
        const prev = prevPosRef.current[p.id];
        if (prev !== undefined && prev !== p.pos) {
          movedId = p.id; fromPos = prev; toPos = p.pos; break;
        }
      }
      prevPosRef.current = Object.fromEntries(st.players.map(p => [p.id, p.pos]));
    }

    const steps = movedId ? ((toPos - fromPos + 40) % 40) : 0;
    if (steps > 0 && steps <= 14) {
      clearTimeout(animTimerRef.current);
      let step = 0;
      function doStep() {
        step++;
        const curPos = (fromPos + step) % 40;
        if (step >= steps) {
          setGameState({ ...finalSt, hoppingId: null });
        } else {
          setGameState(s => s ? {
            ...s,
            players: s.players.map(p => p.id === movedId ? { ...p, pos: curPos } : p),
            hoppingId: movedId,
          } : s);
          animTimerRef.current = setTimeout(doStep, 190);
        }
      }
      setGameState(s => s ? { ...s, hoppingId: movedId } : s);
      animTimerRef.current = setTimeout(doStep, 190);
    } else {
      setGameState(finalSt);
    }
  }

  useEffect(() => {
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // есть токен (rejoin из меню или обрыв в игре) — возвращаемся на своё место
      if (tokenRef.current && codeRef.current) {
        ws.send(JSON.stringify({ type: 'rejoin', code: codeRef.current, token: tokenRef.current }));
        return;
      }
      const msg = initAction === 'create'
        ? { type: 'create', name: myName }
        : { type: 'join',   name: myName, code: initCode };
      ws.send(JSON.stringify(msg));
    };
    ws.onerror = () => { if (!startedRef.current) setWsErr('Нет соединения с сервером'); };
    ws.onclose = () => {
      if (startedRef.current && !overRef.current) {
        // игра идёт — тихо переподключаемся, сервер держит место 2 минуты
        setReconnecting(true);
        clearTimeout(reconTimerRef.current);
        reconTimerRef.current = setTimeout(() => setRetryN(n => n + 1), 1500);
      } else if (!startedRef.current) {
        setWsErr('Соединение потеряно');
      }
    };
    ws.onmessage = (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'created' || msg.type === 'joined') {
        setMyPlayerId(msg.playerId);
        setRoomCode(msg.code);
        codeRef.current = msg.code;
        if (msg.token) { tokenRef.current = msg.token; saveResume(msg.code, msg.token, myName); }
        setPlayers(msg.players);
      } else if (msg.type === 'player_joined') {
        setPlayers(msg.players);
      } else if (msg.type === 'started') {
        const st = msg.state;
        prevPosRef.current = Object.fromEntries((st.players || []).map(p => [p.id, p.pos]));
        startedRef.current = true;
        setStarted(true); setGameState(st);
        setDeadline(msg.deadline || null);
        if (msg.seats) setSeatsInfo(msg.seats);
      } else if (msg.type === 'rejoined') {
        const st = msg.state;
        setMyPlayerId(msg.myId);
        setRoomCode(msg.code);
        codeRef.current = msg.code;
        tokenRef.current = msg.token;
        setPlayers(msg.players || []);
        setReconnecting(false);
        setWsErr('');
        if (st) {
          prevPosRef.current = Object.fromEntries((st.players || []).map(p => [p.id, p.pos]));
          startedRef.current = true;
          setStarted(true); setGameState(st);
          setDeadline(msg.deadline || null);
        }
      } else if (msg.type === 'rejoinFailed') {
        clearResume();
        tokenRef.current = null;
        setReconnecting(false);
        setWsErr(startedRef.current ? 'Партия уже завершена или место потеряно' : (msg.msg || 'Не удалось вернуться'));
      } else if (msg.type === 'player_status') {
        setSeatsInfo(msg.seats);
      } else if (msg.type === 'deadline') {
        setDeadline(msg.deadline || null);
      } else if (msg.type === 'state') {
        applyOnlineState(msg.state);
        setDeadline(msg.deadline || null);
        if (msg.seats) setSeatsInfo(msg.seats);
        if (msg.state && (msg.state.phase === 'over' || msg.state.winner)) {
          overRef.current = true;
          clearResume();
        }
      } else if (msg.type === 'error') {
        setWsErr(msg.msg);
      }
    };
    return () => {
      clearTimeout(reconTimerRef.current);
      ws.onclose = null; ws.onerror = null; ws.onmessage = null; ws.close();
    };
  }, [retryN]);

  function sendRaw(obj) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  }
  function sendAction(action) { sendRaw({ type: 'action', action }); }
  function startGame()        { sendRaw({ type: 'start', startBalance }); }

  function copyCode() {
    haptic('select');
    navigator.clipboard?.writeText(roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  const isHost = myPlayerId === 'p0';

  // ── ожидание/лобби ──
  if (!started || !gameState) {
    return (
      <div className="phone big" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div className="screen lobbyscreen">
          <button className="homebtn" onClick={onHome} title="назад"><i className="ti ti-home"></i></button>

          <div className="lobbytitle">{roomCode ? 'Лобби' : 'Подключение…'}</div>

          {roomCode && (
            <div className="ticket">
              <div className="tlbl">Код комнаты</div>
              <div className="tcode">{roomCode}</div>
              <button className="tcopy" onClick={copyCode}>
                {copied
                  ? <><i className="ti ti-check"></i> Скопировано</>
                  : <><i className="ti ti-copy"></i> Копировать</>}
              </button>
            </div>
          )}

          {roomCode && (
            <button className="btn primary" style={{ width: '100%', marginTop: 12 }}
              onClick={() => { haptic('select'); shareRoomLink(roomCode); }}>
              <i className="ti ti-share"></i> Пригласить друзей
            </button>
          )}

          {(roomCode || players.length > 0) && (
            <div className="slots">
              {Array.from({ length: 4 }).map((_, i) => {
                const p = players[i];
                return p ? (
                  <div key={i} className="slot">
                    <div className="savatar" style={{ background: LOBBY_COLORS[i % LOBBY_COLORS.length] }}>
                      {nameInitials(p.name)}
                      {p.id === 'p0' && <span className="shost"><i className="ti ti-crown"></i></span>}
                    </div>
                    <span>{p.name}{p.id === myPlayerId ? ' · ты' : ''}</span>
                  </div>
                ) : (
                  <div key={i} className="slot empty">
                    <div className="savatar"><i className="ti ti-user-plus"></i></div>
                    <span>ждём…</span>
                  </div>
                );
              })}
            </div>
          )}

          {isHost && roomCode && !wsErr && (
            <div style={{ width: '100%', marginTop: 12 }}>
              <div style={{ fontSize: 10.5, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9c8a6c', fontWeight: 700, marginBottom: 6 }}>
                Стартовый капитал
              </div>
              <div className="counts">
                {[1000, 1500, 2000].map(v => (
                  <div key={v} className={'countpill' + (startBalance === v ? ' on' : '')}
                    onClick={() => { haptic('select'); setStartBalance(v); }}>
                    ${v.toLocaleString('ru-RU')}
                  </div>
                ))}
              </div>
            </div>
          )}

          {wsErr && <WsError msg={wsErr} onRetry={() => { setWsErr(''); setRetryN(n => n + 1); }} />}

          <div className="lobbyfoot">
            {isHost && !wsErr && roomCode && (
              <button className="btn primary" style={{ width: '100%' }}
                disabled={players.length < 2} onClick={startGame}>
                <i className="ti ti-player-play"></i>
                {players.length >= 2 ? ` Начать игру (${players.length})` : ' Нужно минимум 2 игрока'}
              </button>
            )}
            {!isHost && myPlayerId && !wsErr && (
              <div className="waitnote"><i className="ti ti-loader-2"></i> Ждём, когда хост начнёт игру…</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── игра ──
  const myIdxFinal = gameState.players.findIndex(p => p.id === myPlayerId);

  const actions = {
    rollDice:    () => gameState.current === myIdxFinal && sendAction({ type: 'roll' }),
    buy:         () => sendAction({ type: 'buy' }),
    pass:        () => sendAction({ type: 'pass' }),
    payRentDue:  () => sendAction({ type: 'payRent' }),
    endTurn:     () => sendAction({ type: 'endTurn' }),
    payBail:     () => sendAction({ type: 'payBail' }),
    useBailCard: () => sendAction({ type: 'useBailCard' }),
    buildHouse:  (cellIdx) => sendAction({ type: 'buildHouse', cellIdx }),
    sellHouse:   (cellIdx) => sendAction({ type: 'sellHouse', cellIdx }),
    mortgage:    (cellIdx) => sendAction({ type: 'mortgage', cellIdx }),
    redeem:      (cellIdx) => sendAction({ type: 'redeem', cellIdx }),
    toggleZoom:  () => setGameState(s => s ? { ...s, zoom: !s.zoom } : s),
    openTrade: (withId) => {
      if (!gameState.players.find(p => p.id === withId)) return;
      setLocalTrade({ withId, give: [], get: [], money: 0 });
    },
    closeTrade: () => setLocalTrade(null),
    toggleTradeItem: (side, cellIdx) => setLocalTrade(t => {
      if (!t) return null;
      const arr = t[side];
      return { ...t, [side]: arr.includes(cellIdx) ? arr.filter(x => x !== cellIdx) : [...arr, cellIdx] };
    }),
    setTradeMoney: (v) => setLocalTrade(t => t ? { ...t, money: v } : null),
    proposeTrade: () => {
      if (!localTrade) return;
      sendAction({ type: 'proposeTrade', withId: localTrade.withId, give: localTrade.give, get: localTrade.get, money: localTrade.money });
      setLocalTrade(null);
    },
    auctionBid:  (amount) => sendAction({ kind: 'bid', amount }),
    auctionPass: ()       => sendAction({ kind: 'passBid' }),
    payDebt:       () => sendAction({ type: 'payDebt' }),
    surrenderDebt: () => sendAction({ type: 'surrender' }),
    restart: onHome,
  };

  // Портфель: показываем данные myIdxFinal как будто он — индекс 0
  const displayState = { ...gameState, trade: localTrade };
  const portfolioState = myIdxFinal > 0
    ? { ...displayState, players: [displayState.players[myIdxFinal], ...displayState.players.filter((_, i) => i !== myIdxFinal)] }
    : displayState;

  return (
    <OnlineTabsApp gameState={displayState} portfolioState={portfolioState}
      actions={actions} myIdx={myIdxFinal} onHome={onHome}
      deadline={deadline} seatsInfo={seatsInfo} reconnecting={reconnecting} />
  );
}

/* OnlineTabsApp — тот же 5-экранный интерфейс, но с готовым gameState/actions */
function OnlineTabsApp({ gameState, portfolioState, actions, myIdx, onHome, deadline, seatsInfo, reconnecting }) {
  const [activeTab, setActiveTab] = useState('game');
  const onlinePortfolio = portfolioState || gameState;
  useGameSounds(gameState, myIdx);

  const tabs = [
    { id: 'game',        label: 'Игра',    icon: 'ti-cube' },
    { id: 'portfolio',   label: 'Портфель',icon: 'ti-briefcase' },
    { id: 'leaderboard', label: 'Рейтинг', icon: 'ti-trophy' },
    { id: 'logbook',     label: 'Логбук',  icon: 'ti-list' },
    { id: 'rules',       label: 'Правила', icon: 'ti-book' },
  ];

  return (
    <div className="phone big" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div className="screen" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {onHome && (
          <button className="homebtn" onClick={onHome} title="в меню">
            <i className="ti ti-home"></i>
          </button>
        )}
        <SoundToggle />
        {gameState && gameState.phase !== 'over' && (
          <TurnTimerChip deadline={deadline} myTurn={gameState.current === myIdx} />
        )}
        <OfflineBanner seats={seatsInfo} players={gameState?.players} />
        {reconnecting && (
          <div style={{
            position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 45,
            background: 'rgba(20,12,7,.9)', border: '1px solid rgba(232,196,90,.4)', borderRadius: 14,
            padding: '8px 16px', fontSize: 12, fontWeight: 700, color: '#e8c45a',
            display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap',
          }}>
            <i className="ti ti-loader-2" style={{ animation: 'vs-spin 1s linear infinite' }}></i>
            Переподключение…
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
          {activeTab === 'game'        && <GameScreen gameState={gameState} actions={actions} myIdx={myIdx} />}
          {activeTab === 'portfolio'   && <PortfolioScreen gameState={onlinePortfolio} actions={actions} />}
          {activeTab === 'leaderboard' && <LeaderboardScreen gameState={gameState} />}
          {activeTab === 'logbook'     && <LogbookScreen gameState={gameState} />}
          {activeTab === 'rules'       && <RulesScreen />}
        </div>
        <TradeModal   gameState={gameState} actions={actions} myIdx={myIdx} />
        <AuctionModal gameState={gameState} actions={actions} myIdx={myIdx} />
        <div className="tabbar">
          {tabs.map(tab => (
            <button key={tab.id} className={'tabbtn' + (activeTab === tab.id ? ' on' : '')}
              onClick={() => { haptic('select'); setActiveTab(tab.id); }}>
              <i className={'ti ' + tab.icon}></i>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- НАВИГАЦИЯ И ГЛАВНОЕ ПРИЛОЖЕНИЕ ---------- */
function TabsApp({ count, onHome }) {
  const [activeTab, setActiveTab] = useState('game');

  // Единый источник истины: один экземпляр игры на всё приложение.
  // И игровой экран, и аналитические вкладки читают ОДНО состояние.
  const useGame = window.useGame;
  const [gameState, actions] = useGame(count);
  useGameSounds(gameState, 0);

  const tabs = [
    { id: 'game', label: 'Игра', icon: 'ti-cube' },
    { id: 'portfolio', label: 'Портфель', icon: 'ti-briefcase' },
    { id: 'leaderboard', label: 'Рейтинг', icon: 'ti-trophy' },
    { id: 'logbook', label: 'Логбук', icon: 'ti-list' },
    { id: 'rules', label: 'Правила', icon: 'ti-book' },
  ];

  return (
    <div className="phone big" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
      <div className="screen" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* кнопка возврата в меню */}
        {onHome && (
          <button className="homebtn" onClick={onHome} title="в меню">
            <i className="ti ti-home"></i>
          </button>
        )}
        <SoundToggle />
        {/* Содержимое */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
          {activeTab === 'game' && <GameScreen gameState={gameState} actions={actions} />}
          {activeTab === 'portfolio' && <PortfolioScreen gameState={gameState} actions={actions} />}
          {activeTab === 'leaderboard' && <LeaderboardScreen gameState={gameState} />}
          {activeTab === 'logbook' && <LogbookScreen gameState={gameState} />}
          {activeTab === 'rules' && <RulesScreen />}
        </div>

        {/* модалки поверх любой вкладки */}
        <TradeModal   gameState={gameState} actions={actions} />
        <AuctionModal gameState={gameState} actions={actions} myIdx={0} />

        {/* Нижняя навигация (табbar) */}
        <div className="tabbar">
          {tabs.map(tab => (
            <button key={tab.id} className={'tabbtn' + (activeTab === tab.id ? ' on' : '')}
              onClick={() => { haptic('select'); setActiveTab(tab.id); }}>
              <i className={'ti ' + tab.icon}></i>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- КОРНЕВОЙ КОМПОНЕНТ: меню ↔ игра ---------- */
function RootApp({ count: defaultCount }) {
  // Если открыто по ссылке t.me/bot/app?startapp=CODE — сразу в комнату
  const [session, setSession] = useState(() => {
    const startParam = tgStartParam();
    if (startParam && /^[A-Z0-9]{4,8}$/i.test(startParam)) {
      const name = tgUserName() || 'Игрок';
      return { mode: 'private', action: 'join', code: startParam.toUpperCase(), myName: name };
    }
    return null;
  });

  if (!session) {
    return (
      <div className="phone big" style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <div className="screen" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
          <MenuScreen onStart={(opts) => setSession(opts)} />
        </div>
      </div>
    );
  }

  if (session.mode === 'private') {
    return (
      <PrivateLobbyApp key={session.action + (session.code || '') + session.myName}
        session={session} onHome={() => setSession(null)} />
    );
  }

  if (session.mode === 'matchmaking') {
    return (
      <MatchmakingLobbyApp key={session.myName + session.playerCount}
        session={session} onHome={() => setSession(null)} />
    );
  }

  // bots
  return (
    <TabsApp key={session.mode + session.count + (session.seed || 0)}
      count={session.count} onHome={() => setSession(null)} />
  );
}

window.TabsApp  = TabsApp;
window.RootApp  = RootApp;
window.haptic   = haptic;
