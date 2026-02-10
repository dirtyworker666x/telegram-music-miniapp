# Стабильный деплой TGPlay — без падающих туннелей, до 100k пользователей

## Почему localhost.run падает

Бесплатные SSH-туннели (localhost.run и подобные) не рассчитаны на надёжность и нагрузку: обрывы, лимиты, один URL на сессию. **Чтобы туннель «вообще не падал» и выдерживал десятки/сотни тысяч пользователей — приложение нужно разместить на сервере.** Тогда у вас постоянный HTTPS-адрес без туннеля.

---

## Вариант 1: VPS (свой сервер) — полный контроль, масштабирование

Подходит для 100k+ пользователей при достаточных ресурсах и нескольких инстансах.

### Шаг 1: Арендуй VPS

- **DigitalOcean**, **Hetzner**, **Selectel**, **Timeweb** — от ~300 ₽/мес.
- Минимум: 1 CPU, 1 GB RAM (для старта). Для большой нагрузки: 4 CPU, 8 GB RAM и больше.

### Шаг 2: Установи Docker на сервер

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# выйди и зайди в SSH снова
```

### Шаг 3: Склонируй проект и настрой .env

```bash
git clone https://github.com/твой-логин/telegram-music-miniapp.git
cd telegram-music-miniapp
cp backend/.env.example backend/.env
# Отредактируй backend/.env: BOT_TOKEN, VK_TOKEN, WEBAPP_URL (см. ниже)
```

### Шаг 4: Укажи постоянный WEBAPP_URL

После деплоя у тебя будет адрес сервера, например `https://tgplayer.example.com` или `https://123.45.67.89`.

В `backend/.env`:

```env
WEBAPP_URL=https://tgplayer.example.com
```

(или `https://ТВОЙ_IP` если без домена, но для Telegram Mini App лучше домен с HTTPS.)

### Шаг 5: Собери и запусти через Docker

```bash
docker compose up -d --build
```

Приложение будет слушать порт 8000. Для HTTPS и домена настрой Nginx + Let's Encrypt (см. ниже) или используй Caddy.

### Шаг 6 (рекомендуется): Nginx + SSL для домена

На VPS установи Nginx и получи бесплатный сертификат:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
sudo certbot --nginx -d tgplayer.example.com
```

В Nginx настрой прокси на `http://127.0.0.1:8000` для этого домена. Тогда `WEBAPP_URL=https://tgplayer.example.com` будет постоянным и не будет «падать».

### Масштабирование до 100k пользователей

- **Один контейнер:** в `docker-compose.yml` задай `WORKERS=8` (или больше по числу ядер). В коде уже есть `limit_concurrency=500` на воркер — несколько воркеров дают тысячи одновременных запросов.
- **Несколько инстансов:** подними 2–5 реплик и поставь перед ними балансировщик (Nginx или облачный LB):
  ```bash
  docker compose up -d --scale app=3
  ```
- **Очень большая нагрузка:** используй Kubernetes или облачный PaaS (см. Вариант 2) с автоскейлингом.

---

## Вариант 2: PaaS (Railway, Render, Fly.io) — без настройки сервера

Подходит, чтобы быстро получить **постоянный URL без туннеля** и без ручной настройки VPS.

### Railway

1. Зайди на [railway.app](https://railway.app), зарегистрируйся (GitHub).
2. New Project → Deploy from GitHub → выбери репозиторий `telegram-music-miniapp`.
3. В настройках добавь переменные: `BOT_TOKEN`, `VK_TOKEN`, `VK_USER_AGENT`.  
4. В **Settings → Networking** включи **Public Networking** — Railway выдаст постоянный URL, например `https://telegram-music-miniapp-production.up.railway.app`.
5. В **Variables** добавь `WEBAPP_URL=https://твой-url.railway.app`.
6. Деплой запустится по push в GitHub. URL не меняется и не «падает» как туннель.

### Render

1. [render.com](https://render.com) → New → Web Service.
2. Подключи репозиторий, укажи: Build — Docker, Start — как в `Dockerfile` (или команду из него).
3. В Environment добавь `BOT_TOKEN`, `VK_TOKEN`, `WEBAPP_URL` (Render тоже даст постоянный URL).
4. После деплоя используй выданный HTTPS-URL в BotFather и в `WEBAPP_URL`.

На таких платформах можно включить автоскейлинг (больше инстансов при нагрузке) — это путь к 100k пользователям без ручного управления серверами.

---

## Вариант 3: Cloudflare Named Tunnel — постоянный URL с твоей машины

Если хочешь оставить приложение на своём компьютере, но получить **постоянный и стабильный URL** (без смены адреса при каждом перезапуске):

1. Зайди в [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) (бесплатный аккаунт).
2. **Networks → Tunnels → Create a tunnel** → тип **Cloudflared**.
3. Дай имя (например `tgplayer`), скопируй **TUNNEL_TOKEN**.
4. На своём ПК (где крутится бэкенд) установи cloudflared и запускай туннель так, чтобы он проксировал трафик на `http://localhost:8000`.
5. В настройках туннеля в Dashboard привяжи домен (или используй выданный `*.cfargotunnel.com`).
6. В `backend/.env` укажи `WEBAPP_URL=https://твой-поддомен.твой-домен.com` (или выданный Cloudflare URL).

Туннель привязан к аккаунту Cloudflare и к одному и тому же имени/домену — URL не меняется и стабильнее, чем у одноразовых туннелей.

Пример запуска (если используешь токен):

```bash
export CLOUDFLARE_TUNNEL_TOKEN=твой_токен
cloudflared tunnel run --token $CLOUDFLARE_TUNNEL_TOKEN
```

---

## Итог: что выбрать

| Цель | Решение |
|------|--------|
| **Туннель не должен падать, один и тот же URL** | Cloudflare Named Tunnel (Вариант 3) или деплой на VPS/PaaS (Варианты 1–2). |
| **Очень много пользователей (десятки/сотни тысяч)** | VPS с несколькими воркерами и репликами или PaaS с автоскейлингом (Варианты 1–2). |
| **Минимум настроек, быстрый старт** | Railway или Render (Вариант 2). |

После того как выберешь вариант и получишь постоянный `WEBAPP_URL`, один раз укажи его в BotFather и в `backend/.env` — к проблеме падающих туннелей возвращаться не придётся.
