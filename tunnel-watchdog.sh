#!/usr/bin/env bash
# ─── TGPlayer Tunnel Watchdog v7 ──────────────────────────────
# Надёжный туннель localhost.run → backend:8787
# - Мгновенный перезапуск при падении
# - Keep-alive пинги каждые 15 секунд (не даёт туннелю уснуть)
# - Автоматическое обновление WEBAPP_URL в .env
# - Автоматический перезапуск бота при смене URL
# - Поддержка 50+ одновременных пользователей
set -euo pipefail

PORT=8787
CHECK_INTERVAL=20           # Проверка здоровья каждые 20 сек
KEEPALIVE_INTERVAL=15       # Keep-alive пинг каждые 15 сек
RESTART_COOLDOWN=5          # Пауза перед перезапуском
MAX_FAILURES=2              # Макс неудачных проверок до рестарта
SSH_KEY="$HOME/.ssh/id_ed25519_tunnel"
ENV_FILE="$(cd "$(dirname "$0")" && pwd)/backend/.env"
LOG_FILE="$(cd "$(dirname "$0")" && pwd)/tunnel.log"
BOT_SCRIPT="$(cd "$(dirname "$0")" && pwd)/backend/bot.py"
VENV_ACTIVATE="$(cd "$(dirname "$0")" && pwd)/backend/venv/bin/activate"

touch "$ENV_FILE"

# ─── Colors ──────────────────────────────────────────────────
CYAN='\033[0;36m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'
RED='\033[0;31m'; NC='\033[0m'
ts() { date "+%H:%M:%S"; }
log() { echo -e "${CYAN}[$(ts)] [watchdog]${NC} $*"; }
ok()  { echo -e "${GREEN}[$(ts)] ✓${NC} $*"; }
warn(){ echo -e "${YELLOW}[$(ts)] ⚠${NC} $*"; }
err() { echo -e "${RED}[$(ts)] ✗${NC} $*"; }

TUNNEL_PID=""
KEEPALIVE_PID=""
CURRENT_URL=""
BOT_PID=""

# ─── Cleanup ─────────────────────────────────────────────────
cleanup() {
  log "Shutting down watchdog..."
  [[ -n "$KEEPALIVE_PID" ]] && kill "$KEEPALIVE_PID" 2>/dev/null
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null
  [[ -n "$BOT_PID" ]] && kill "$BOT_PID" 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# ─── Extract URL from tunnel output ─────────────────────────
extract_url() {
  local file="$1"
  # Try JSON output first, then plain text
  if command -v python3 &>/dev/null; then
    python3 -c "
import sys, re
with open('$file', 'r', errors='ignore') as f:
    text = f.read()
urls = re.findall(r'https://[a-z0-9]+\.lhr\.life', text)
if urls:
    print(urls[-1])
" 2>/dev/null
  else
    strings "$file" 2>/dev/null | grep -oE 'https://[a-z0-9]+\.lhr\.life' | tail -1
  fi
}

# ─── Update WEBAPP_URL in .env ───────────────────────────────
set_webapp_url() {
  local url="${1%/}"
  if [[ "$url" == "$CURRENT_URL" ]]; then
    return 0
  fi
  if grep -q "^WEBAPP_URL=" "$ENV_FILE" 2>/dev/null; then
    sed -i '' "s|^WEBAPP_URL=.*|WEBAPP_URL=${url}|" "$ENV_FILE"
  else
    echo "WEBAPP_URL=${url}" >> "$ENV_FILE"
  fi
  CURRENT_URL="$url"
  ok "WEBAPP_URL = $url"
}

# ─── Restart bot (picks up new WEBAPP_URL) ───────────────────
restart_bot() {
  if [[ -n "$BOT_PID" ]]; then
    kill "$BOT_PID" 2>/dev/null
    wait "$BOT_PID" 2>/dev/null
    BOT_PID=""
  fi
  # Kill any other bot instances
  pkill -f "python.*bot.py" 2>/dev/null || true
  sleep 2
  
  if [[ -f "$BOT_SCRIPT" && -f "$VENV_ACTIVATE" ]]; then
    (
      source "$VENV_ACTIVATE"
      python3 -u "$BOT_SCRIPT" >> "$LOG_FILE" 2>&1
    ) &
    BOT_PID=$!
    ok "Bot restarted (PID $BOT_PID)"
  else
    warn "Bot script not found, skipping bot restart"
  fi
}

# ─── Keep-alive: periodic curl to prevent idle disconnect ────
start_keepalive() {
  [[ -n "$KEEPALIVE_PID" ]] && kill "$KEEPALIVE_PID" 2>/dev/null
  (
    while true; do
      sleep "$KEEPALIVE_INTERVAL"
      if [[ -n "$CURRENT_URL" ]]; then
        curl -s -o /dev/null --max-time 5 "$CURRENT_URL/api/status" 2>/dev/null || true
      fi
    done
  ) &
  KEEPALIVE_PID=$!
}

# ─── Start tunnel ────────────────────────────────────────────
start_tunnel() {
  # Kill old tunnels
  pkill -f "ssh.*localhost.run" 2>/dev/null || true
  [[ -n "$TUNNEL_PID" ]] && kill "$TUNNEL_PID" 2>/dev/null
  TUNNEL_PID=""
  sleep 2

  log "Starting tunnel → localhost:$PORT ..."
  local tmp
  tmp=$(mktemp)
  
  # SSH tunnel with aggressive keep-alive
  ssh -i "$SSH_KEY" \
      -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=10 \
      -o ServerAliveCountMax=3 \
      -o ConnectTimeout=15 \
      -o TCPKeepAlive=yes \
      -o ExitOnForwardFailure=yes \
      -R 80:localhost:$PORT \
      ssh.localhost.run \
      > "$tmp" 2>&1 &
  TUNNEL_PID=$!

  # Wait for URL (up to 25s)
  local wait=0
  while [[ $wait -lt 25 ]]; do
    # Check if process died
    if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
      err "Tunnel process died during startup"
      TUNNEL_PID=""
      rm -f "$tmp"
      return 1
    fi
    
    local url
    url=$(extract_url "$tmp")
    if [[ -n "$url" ]]; then
      set_webapp_url "$url"
      rm -f "$tmp"
      
      # Start keep-alive pinger
      start_keepalive
      
      # Restart bot with new URL
      restart_bot
      
      ok "Tunnel UP: $CURRENT_URL (PID $TUNNEL_PID)"
      return 0
    fi
    sleep 1
    ((wait++))
  done

  err "Tunnel failed to produce URL within 25s"
  kill "$TUNNEL_PID" 2>/dev/null
  TUNNEL_PID=""
  rm -f "$tmp"
  return 1
}

# ─── Health check ────────────────────────────────────────────
check_tunnel() {
  # 1. Process alive?
  if [[ -z "$TUNNEL_PID" ]] || ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    err "Tunnel process not running"
    return 1
  fi
  
  # 2. HTTP check (short timeout)
  if [[ -n "$CURRENT_URL" ]]; then
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 "$CURRENT_URL/api/status" 2>/dev/null || echo "000")
    if [[ "$code" == "200" ]]; then
      return 0
    else
      warn "Health check returned HTTP $code"
      return 1
    fi
  fi
  
  return 0
}

# ─── Main loop ───────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   TGPlayer Tunnel Watchdog v7            ║${NC}"
echo -e "${CYAN}║   Keep-alive: ${KEEPALIVE_INTERVAL}s | Check: ${CHECK_INTERVAL}s          ║${NC}"
echo -e "${CYAN}║   Max users: 50+ | Auto-restart: ON      ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════╝${NC}"
echo ""

failures=0

while true; do
  # Start tunnel if not running
  if [[ -z "$TUNNEL_PID" ]] || ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    TUNNEL_PID=""
    if start_tunnel; then
      failures=0
    else
      err "Failed to start tunnel, retrying in ${RESTART_COOLDOWN}s..."
      sleep "$RESTART_COOLDOWN"
      continue
    fi
  fi

  # Wait before health check
  sleep "$CHECK_INTERVAL"

  # Health check
  if check_tunnel; then
    failures=0
  else
    ((failures++))
    warn "Health check failed ($failures/$MAX_FAILURES)"
    
    if [[ $failures -ge $MAX_FAILURES ]]; then
      err "Max failures reached — restarting tunnel..."
      [[ -n "$KEEPALIVE_PID" ]] && kill "$KEEPALIVE_PID" 2>/dev/null
      KEEPALIVE_PID=""
      kill "$TUNNEL_PID" 2>/dev/null
      TUNNEL_PID=""
      failures=0
      sleep "$RESTART_COOLDOWN"
    fi
  fi
done
