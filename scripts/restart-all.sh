#!/usr/bin/env bash
# Чистый перезапуск: один бэкенд, один туннель, один бот.
# Порт 8787 гарантированно освобождается перед стартом — больше не падаем из-за "address already in use".
# Запуск: ./scripts/restart-all.sh
set -e
cd "$(dirname "$0")/.."
PORT=8787

echo "🛑 Останавливаю все процессы..."
pkill -9 -f "python.*bot.py" 2>/dev/null || true
pkill -9 -f "server_lite.py" 2>/dev/null || true
pkill -9 -f "tunnel-watchdog.sh" 2>/dev/null || true
pkill -9 -f "ssh.*localhost.run" 2>/dev/null || true
pkill -9 -f "ssh.*lhr" 2>/dev/null || true
pkill -9 -f "ssh.*8787" 2>/dev/null || true
rm -f backend/bot.lock .tunnel-watchdog.lock

# Гарантированно освобождаем порт: убиваем всех, кто слушает, и ждём пока порт станет свободен
free_port() {
  local i=0
  while [[ $i -lt 15 ]]; do
    local pids
    pids=$(lsof -ti:$PORT 2>/dev/null || true)
    if [[ -z "$pids" ]]; then
      return 0
    fi
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
    ((i++))
  done
  # последняя попытка
  lsof -ti:$PORT 2>/dev/null | xargs kill -9 2>/dev/null || true
  sleep 2
  if lsof -i:$PORT >/dev/null 2>&1; then
    echo "❌ Порт $PORT всё ещё занят после освобождения. Освободи вручную: lsof -ti:$PORT | xargs kill -9"
    exit 1
  fi
}
free_port
echo "✅ Порт $PORT свободен"

echo "▶️ Запуск бэкенда на порту $PORT..."
(cd backend && source venv/bin/activate && python server_lite.py) &
BACKEND_PID=$!
sleep 4
if ! kill -0 $BACKEND_PID 2>/dev/null; then
  echo "❌ Бэкенд не запустился."
  exit 1
fi
echo "✅ Бэкенд запущен (PID $BACKEND_PID)"

echo "▶️ Запуск туннеля и бота..."
exec ./tunnel-watchdog.sh
