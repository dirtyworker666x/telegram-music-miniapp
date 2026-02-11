# TGPlay — музыкальный Mini App для Telegram (VK)

Поиск и воспроизведение музыки из ВКонтакте в Telegram Mini App.

## Быстрый старт (локально)

```bash
# 1. Токены в backend/.env (BOT_TOKEN, VK_TOKEN)
cd backend && pip install -r requirements.txt && cp .env.example .env
# Заполни .env и выйди из backend/

# 2. Запуск всего: бэкенд + туннель + бот
npm run tunnel
# или: ./scripts/restart-all.sh
```

После запуска в терминале появится **URL туннеля** (например `https://xxx.trycloudflare.com`).  
`WEBAPP_URL` в `.env` обновится автоматически — бот будет отправлять Mini App с этим URL.

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
