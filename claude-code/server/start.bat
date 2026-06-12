@echo off
echo === Вокруг света — WebSocket сервер ===
echo.

:: Проверяем Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [!] Node.js не найден.
  echo     Скачай с https://nodejs.org и установи.
  pause
  exit /b 1
)

:: Устанавливаем зависимости если нужно
if not exist node_modules (
  echo [+] Устанавливаем зависимости...
  npm install
)

echo [+] Запускаем сервер на порту 8765...
echo     Клиент подключается к ws://localhost:8765
echo.
node server.js
pause
