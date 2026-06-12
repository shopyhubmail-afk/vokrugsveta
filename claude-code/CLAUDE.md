# Вокруг света — контекст для Claude

## Что это
Telegram mini app, монополия-игра «Вокруг света». React 18 без сборки (Babel Standalone), один `index.html`. Локальный HTTP-сервер на порту 8123.

## Запуск
```
py -3.12 -m http.server 8123 --directory C:/Users/moskv/Downloads/_vokrug_sveta_extract/claude-code
```
Открыть: http://localhost:8123

WebSocket сервер (для приват-режима):
```
cd server && npm install && node server.js
```
Слушает ws://localhost:8765

## Кэш-бастинг
При изменении .jsx/.js файлов — увеличить `?v=N` в index.html для всех скриптов.
Текущая версия: v=4

## Архитектура

### Стек
- React 18 (UMD, без сборки)
- Babel Standalone (JSX в браузере)
- Tabler Icons (иконки)
- Google Fonts: Fraunces + Manrope
- Node.js + ws (WebSocket сервер)

### Файлы
| Файл | Роль |
|------|------|
| `board-data.js` | Конфиг поля: `window.VS = { CELLS, REGIONS }`. 40 клеток, 8 регионов. |
| `engine.js` | Чистый движок `window.VSEngine`. Все правила как `(state, …) → newState`. Без React/DOM/таймеров. Работает и в браузере, и в Node.js. |
| `Board.jsx` | SVG-доска. Props: cells, regions, owners, houses, players, activeCell, zoom, boardSize, dice, rolling, hoppingId. |
| `panels.jsx` | Вспомогательные компоненты (PlayerPanel и др.) |
| `game-full.jsx` | `useGame(count)` — React-хук, тонкий оркестратор: анимации, таймеры, боты. Делегирует правила в VSEngine. `useOnlineGame` — вариант для WS. Экспортирует `GameProto`, `useGame`, `Av`. |
| `app-tabs.jsx` | `RootApp` → меню → `TabsApp` (боты) или `PrivateLobbyApp` (онлайн). 5 вкладок: Игра, Портфель, Рейтинг, Логбук, Аналитика. |
| `server/server.js` | WebSocket сервер. Комнаты в памяти. Загружает движок через eval. Протокол: create/join/start/action. |

### Состояние игры (GameState)
```js
{
  players: [{ id, name, color, initials, bot, pos, balance, inJail, jailTurns, bailCards, bankrupt }],
  current: 0,           // индекс текущего игрока
  phase: 'idle'|'rolling'|'moving'|'buy'|'rent'|'special'|'own'|'jail'|'over',
  dice: [d1, d2],
  doubleCount: 0,
  lastDouble: false,
  landed: null|cellIdx,
  rentDue: 0,
  owners: { [cellIdx]: playerId },
  houses: { [cellIdx]: 1..5 },
  mortgaged: { [cellIdx]: true },
  hint: string,
  toast: null|string,
  card: null|CardObject,
  winner: null|playerId,
  trade: null|{ withId, give: [], get: [], money },
  logs: [...],
  history: [[balances per turn]],
  zoom: bool,
}
```

### WebSocket протокол
**Client → Server:**
- `{ type:'create', name }` → создать комнату
- `{ type:'join', code, name }` → войти
- `{ type:'start' }` → хост начинает (минимум 2 игрока)
- `{ type:'action', action }` → игровое действие

**Server → Client:**
- `{ type:'created', code, playerId, players }`
- `{ type:'joined', code, playerId, players }`
- `{ type:'player_joined', players }`
- `{ type:'started', state }`
- `{ type:'state', state }`
- `{ type:'error', msg }`

**Игровые actions:** `roll`, `buy`, `pass`, `payRent`, `endTurn`, `payBail`, `useBailCard`, `buildHouse/sellHouse/mortgage/redeem` (+ `cellIdx`)

## Игроки (POOL)
`you` (человек), `anya`, `marco` (псевдо-человеки), `buyer`/`builder`/`careful` (боты с `bot:true`)

## Ключевые правила
- Старт: +$200 при прохождении клетки 0
- Тюрьма: клетка 10 (транзит), попасть → клетка 30 (`gotojail`). 3 хода сидишь или платишь $50 или дубль
- Монополия: все города региона → аренда ×2, можно строить дома
- Дома: 1–4 дома, 5 = отель. Стоимость = 50% цены города
- Залог: 50% цены → выкуп 55%
- Банкротство: авто-залог → авто-продажа домов → если всё равно не хватает → банкрот
- Победа: последний не-банкрот

## Что осталось сделать
- [ ] Этап 3: Онлайн-матчмейкинг (очередь + авто-комната)
- [ ] Этап 4: Telegram интеграция (`initData`, invite links `t.me/bot/app?startapp=CODE`)
- [ ] Деплой: Cloudflare Pages (статика) + Railway/Render free tier (WS сервер)
- [ ] Обмены в онлайн-режиме (сейчас отключены)
- [ ] Переподключение при обрыве WS
