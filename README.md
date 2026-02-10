# TGPlay — музыкальный Mini App для Telegram (VK)

Поиск и воспроизведение музыки из ВКонтакте в Telegram Mini App.

## Быстрый старт (локально)

```bash
# Бэкенд
cd backend && pip install -r requirements.txt && cp .env.example .env
# Заполни .env: BOT_TOKEN, VK_TOKEN, WEBAPP_URL
python server_lite.py

# Туннель (временный URL)
./tunnel-watchdog.sh
```

## Стабильный URL и 100k пользователей

**Бесплатные туннели (localhost.run) не рассчитаны на надёжность и большую нагрузку.**

Чтобы туннель не падал и ботом могли пользоваться десятки/сотни тысяч человек:

- **Разверни приложение на сервере или в облаке** — тогда у тебя постоянный HTTPS-адрес без туннеля.
- Подробные шаги: **[DEPLOY.md](DEPLOY.md)** — VPS (Docker), Railway/Render, Cloudflare Named Tunnel и масштабирование.

Кратко:
- **VPS** — `docker compose up -d`, настрой домен и Nginx.
- **Railway** — подключи репозиторий, добавь переменные, получи постоянный URL.
- **Cloudflare Named Tunnel** — постоянный URL при запуске с твоего ПК.

## Структура

- `src/` — фронт (React, Vite, TypeScript)
- `backend/` — FastAPI, VK API, Telegram Bot, плейлисты
- `DEPLOY.md` — стабильный деплой и масштабирование
