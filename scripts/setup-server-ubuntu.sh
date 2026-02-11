#!/usr/bin/env bash
# TGPlay — установка на Ubuntu VPS (Oracle Cloud, Yandex Cloud и др.)
# Запуск из корня проекта: sudo bash scripts/setup-server-ubuntu.sh
# Требует: backend/.env с BOT_TOKEN, VK_TOKEN (и VK_USER_AGENT по желанию)
set -e

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Запусти скрипт с sudo: sudo bash scripts/setup-server-ubuntu.sh"
  exit 1
fi

REAL_USER="${SUDO_USER:-root}"
if [[ "$REAL_USER" == "root" ]]; then
  echo "⚠️  Запуск от root. Сервисы тоже будут от root (на многих VPS другого пользователя нет)."
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "📁 Проект: $PROJECT_ROOT"
echo "👤 Пользователь сервисов: $REAL_USER"
echo ""

# ─── Обновление и базовые пакеты ─────────────────────────────────────
echo "▶️ Обновляю пакеты..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates

# ─── Node.js 18.x ────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)" -lt 18 ]]; then
  echo "▶️ Устанавливаю Node.js 18..."
  curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
  apt-get install -y -qq nodejs
fi
echo "✅ Node $(node -v)"

# ─── Python3, venv, ffmpeg, ssh ───────────────────────────────────────
echo "▶️ Устанавливаю Python3, ffmpeg, openssh-client..."
apt-get install -y -qq python3 python3-venv python3-pip ffmpeg openssh-client

# ─── Виртуальное окружение и зависимости бэкенда ─────────────────────
echo "▶️ Настраиваю backend..."
if [[ ! -d "$PROJECT_ROOT/backend/venv" ]]; then
  sudo -u "$REAL_USER" python3 -m venv "$PROJECT_ROOT/backend/venv"
fi
sudo -u "$REAL_USER" "$PROJECT_ROOT/backend/venv/bin/pip" install -q -r "$PROJECT_ROOT/backend/requirements.txt"

# ─── Сборка фронта ───────────────────────────────────────────────────
echo "▶️ Собираю фронт..."
sudo -u "$REAL_USER" bash -c "cd '$PROJECT_ROOT' && npm run build"
echo "✅ Фронт собран"

# ─── .env ─────────────────────────────────────────────────────────────
if [[ ! -f "$PROJECT_ROOT/backend/.env" ]]; then
  cp "$PROJECT_ROOT/backend/.env.example" "$PROJECT_ROOT/backend/.env"
  chown "$REAL_USER:$REAL_USER" "$PROJECT_ROOT/backend/.env"
  echo "⚠️  Создан backend/.env из примера. Заполни BOT_TOKEN и VK_TOKEN: nano backend/.env"
fi

# ─── Systemd: бэкенд ──────────────────────────────────────────────────
echo "▶️ Создаю systemd-сервисы..."
cat > /etc/systemd/system/tgplay-backend.service << EOF
[Unit]
Description=TGPlay Backend (FastAPI)
After=network.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$PROJECT_ROOT/backend
ExecStart=$PROJECT_ROOT/backend/venv/bin/python server_lite.py
Restart=always
RestartSec=5
Environment=PATH=$PROJECT_ROOT/backend/venv/bin:/usr/bin

[Install]
WantedBy=multi-user.target
EOF

# ─── Systemd: туннель + бот (watchdog) ─────────────────────────────────
cat > /etc/systemd/system/tgplay-tunnel.service << EOF
[Unit]
Description=TGPlay Tunnel + Bot (localhost.run + watchdog)
After=network.target tgplay-backend.service
Requires=tgplay-backend.service

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$PROJECT_ROOT
ExecStart=$PROJECT_ROOT/tunnel-watchdog.sh
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# ─── Запуск (сначала бэкенд, через пару секунд туннель) ─────────────────
systemctl daemon-reload
systemctl enable tgplay-backend.service tgplay-tunnel.service

echo "▶️ Запускаю бэкенд..."
systemctl start tgplay-backend.service
sleep 5
if ! systemctl is-active -q tgplay-backend.service; then
  echo "❌ Бэкенд не поднялся. Проверь: journalctl -u tgplay-backend.service -n 50"
  exit 1
fi
echo "✅ Бэкенд запущен"

echo "▶️ Запускаю туннель и бота..."
systemctl start tgplay-tunnel.service
sleep 8
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Установка завершена."
echo ""
echo "Проверка:"
echo "  systemctl status tgplay-backend tgplay-tunnel"
echo "  journalctl -u tgplay-tunnel.service -f   # лог туннеля (там будет WEBAPP_URL)"
echo ""
echo "В backend/.env после старта туннеля появится WEBAPP_URL — по нему открывается плеер."
echo "Перезапуск сервера: сервисы поднимутся сами (systemd)."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
