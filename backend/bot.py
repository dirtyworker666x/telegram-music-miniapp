"""
TGPlayer Telegram Bot — обрабатывает /start и отправляет кнопку Mini App.
Запускай:  python3 bot.py
"""
from __future__ import annotations
import asyncio, json, os, signal, sys
from pathlib import Path
from dotenv import load_dotenv
import aiohttp

load_dotenv(Path(__file__).parent / ".env")

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "")

if not BOT_TOKEN:
    print("❌  BOT_TOKEN не указан в backend/.env!")
    sys.exit(1)

if not WEBAPP_URL:
    print("❌  WEBAPP_URL не указан в backend/.env!")
    print("   Запусти cloudflared tunnel и укажи URL в .env")
    sys.exit(1)

API = f"https://api.telegram.org/bot{BOT_TOKEN}"


async def tg_request(session: aiohttp.ClientSession, method: str, **kwargs) -> dict:
    """Вызов Telegram Bot API."""
    async with session.post(f"{API}/{method}", json=kwargs) as resp:
        data = await resp.json()
    if not data.get("ok"):
        print(f"⚠️  TG API {method}: {data.get('description', data)}")
    return data


async def set_menu_button(session: aiohttp.ClientSession):
    """Устанавливает кнопку Mini App в меню бота."""
    await tg_request(
        session,
        "setChatMenuButton",
        menu_button={
            "type": "web_app",
            "text": "🎵 Открыть плеер",
            "web_app": {"url": WEBAPP_URL},
        },
    )
    print(f"✅ Menu button set → {WEBAPP_URL}")


async def set_bot_commands(session: aiohttp.ClientSession):
    """Устанавливает команды бота."""
    await tg_request(
        session,
        "setMyCommands",
        commands=[
            {"command": "start", "description": "Запустить музыкальный плеер"},
            {"command": "playlist", "description": "Мой плейлист"},
        ],
    )
    print("✅ Bot commands set")


async def handle_update(session: aiohttp.ClientSession, update: dict):
    """Обрабатывает входящее обновление."""
    message = update.get("message")
    if not message:
        return

    chat_id = message["chat"]["id"]
    text = message.get("text", "")
    first_name = message.get("from", {}).get("first_name", "друг")

    if text == "/start":
        await tg_request(
            session,
            "sendMessage",
            chat_id=chat_id,
            text=(
                f"👋 Привет, {first_name}!\n\n"
                "🎵 <b>TGPlayer</b> — музыкальный плеер прямо в Telegram.\n\n"
                "Нажми кнопку ниже, чтобы открыть плеер. "
                "Ты можешь искать треки, слушать их, "
                "сохранять в плейлист и скачивать прямо сюда в чат!\n\n"
                "Также можно открыть плеер через кнопку меню слева от поля ввода 👇"
            ),
            parse_mode="HTML",
            reply_markup={
                "inline_keyboard": [
                    [
                        {
                            "text": "🎵 Открыть TGPlayer",
                            "web_app": {"url": WEBAPP_URL},
                        }
                    ]
                ]
            },
        )
        print(f"📩 /start from {first_name} (chat_id={chat_id})")

    elif text == "/playlist":
        # Redirect to mini app with playlist tab
        await tg_request(
            session,
            "sendMessage",
            chat_id=chat_id,
            text="📋 Открой плеер, чтобы увидеть свой плейлист:",
            reply_markup={
                "inline_keyboard": [
                    [
                        {
                            "text": "📋 Мой плейлист",
                            "web_app": {"url": WEBAPP_URL},
                        }
                    ]
                ]
            },
        )
        print(f"📩 /playlist from {first_name} (chat_id={chat_id})")


async def poll_updates(session: aiohttp.ClientSession):
    """Long polling для получения обновлений."""
    offset = 0
    print("🔄 Polling for updates...")

    while True:
        try:
            data = await tg_request(
                session,
                "getUpdates",
                offset=offset,
                timeout=30,
                allowed_updates=["message"],
            )
            updates = data.get("result", [])
            for update in updates:
                offset = update["update_id"] + 1
                await handle_update(session, update)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️  Polling error: {e}")
            await asyncio.sleep(3)


async def main():
    print(f"🤖 TGPlayer Bot starting...")
    print(f"🌐 WebApp URL: {WEBAPP_URL}")

    async with aiohttp.ClientSession() as session:
        # Проверяем бота
        me = await tg_request(session, "getMe")
        if me.get("ok"):
            bot = me["result"]
            print(f"✅ Bot: @{bot.get('username', '?')} ({bot.get('first_name', '?')})")
        else:
            print("❌ Не удалось подключиться к боту!")
            return

        # Удаляем webhook (если был установлен), для long polling
        await tg_request(session, "deleteWebhook", drop_pending_updates=False)

        # Настраиваем меню и команды
        await set_menu_button(session)
        await set_bot_commands(session)

        print("━" * 50)
        print("🎵 Бот запущен! Напиши /start в Telegram.")
        print("━" * 50)

        # Запускаем long polling
        await poll_updates(session)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Bot stopped")
