# Вокруг света

Монополия-путешествие. Telegram Mini App.

## Структура
- `index.html` + `vokrug-sveta/` — клиент (статика, отдаётся GitHub Pages)
- `server/server.js` — WebSocket-сервер (запускается на Railway)
- `package.json` — для Railway: `npm start` → `node server/server.js`

Движок (`vokrug-sveta/engine.js`, `vokrug-sveta/board-data.js`) общий: его читают и клиент,
и сервер (через `../vokrug-sveta`). Менять в одном месте.

## Деплой
**GitHub Pages (клиент):** Settings → Pages → Branch `main`, папка `/ (root)`.
Сайт: `https://<user>.github.io/<repo>/`

**Railway (сервер):** подключить этот репозиторий. Root Directory оставить **пустым**
(корень). Railway сам поставит `ws` и запустит `node server/server.js`.

## Важно
Все файлы должны лежать в КОРНЕ репозитория (`index.html` сразу виден в списке файлов,
а не внутри подпапки), иначе Pages вернёт 404.
