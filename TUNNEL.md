# Туннель для TGPlay

Чтобы Telegram Mini App открывался по HTTPS, нужен туннель от твоего localhost к интернету.

## Быстрый запуск

```bash
npm run tunnel
```

Или вручную:

```bash
./scripts/restart-all.sh
```

Скрипт поднимет:
1. Бэкенд (порт 8787)
2. Туннель (cloudflared или localhost.run)
3. Telegram-бота

## Что нужно

### Требования

- **cloudflared** (рекомендуется): `brew install cloudflared`
- или **SSH** (для localhost.run): обычно уже есть

### Переменные в `backend/.env`

- `BOT_TOKEN` — токен от @BotFather
- `VK_TOKEN` — токен VK
- `WEBAPP_URL` — обновится автоматически, когда туннель запустится

## Результат

В терминале появится строка вида:

```
✓ Tunnel UP (cloudflared): https://xxx.trycloudflare.com (PID 12345)
```

Или для localhost.run:

```
✓ Tunnel UP (localhost): https://xxx.lhr.life (PID 12345)
```

Используй этот URL в настройках Mini App в BotFather или в меню бота.

## Принудительный выбор

- **Cloudflare** (по умолчанию, если установлен): `TUNNEL_PROVIDER=cloudflared` или не указывать
- **localhost.run**: `TUNNEL_PROVIDER=localhost ./scripts/restart-all.sh`
