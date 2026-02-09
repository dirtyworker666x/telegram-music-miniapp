#!/bin/bash
# Один раз: установка зависимостей для бэкенда и фронта
set -e
cd "$(dirname "$0")/.."

echo "=== 1. Фронт (Node) ==="
npm install
echo ""

echo "=== 2. Бэкенд (Python) ==="
cd backend
if [ ! -d "venv" ]; then
  python3 -m venv venv
  echo "Создано виртуальное окружение backend/venv"
fi
source venv/bin/activate
pip install -r requirements.txt
echo ""
echo "Готово. Дальше:"
echo "  1. Настрой backend/.env (токены Telegram и VK — см. START_HERE.md)"
echo "  2. Запусти MongoDB (если ещё не запущен)"
echo "  3. Запусти скрипты: ./scripts/start-backend.sh  и  ./scripts/start-frontend.sh"
