"""
TGPlay Telegram Bot — один экземпляр (fcntl flock), /start → одно сообщение.
"""
from __future__ import annotations
import asyncio, os, signal, sys
from pathlib import Path
from dotenv import load_dotenv
import aiohttp

try:
    import fcntl
except ImportError:
    fcntl = None  # Windows

load_dotenv(Path(__file__).parent / ".env")

BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "")
LOCK_FILE = Path(__file__).parent / "bot.lock"
_lock_fd = None

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
                "🎵 <b>TGPlay</b> — плеер в Telegram.\n\n"
                f"▶️ <a href=\"{WEBAPP_URL}\">Открыть плеер</a>\n\n"
                "Если кнопка пишет «тоннель не работает» — отправь <b>/start</b> ещё раз: придёт новая ссылка. "
                "Или открой через кнопку меню слева от поля ввода 👇"
            ),
            parse_mode="HTML",
            reply_markup={
                "inline_keyboard": [
                    [{"text": "🎵 Открыть плеер", "web_app": {"url": WEBAPP_URL}}],
                ]
            },
        )
        print(f"📩 /start from {first_name} (chat_id={chat_id})")

    elif text == "/playlist":
        await tg_request(
            session,
            "sendMessage",
            chat_id=chat_id,
            text=f"📋 <a href=\"{WEBAPP_URL}\">Открыть плеер</a> — там плейлист.",
            parse_mode="HTML",
            reply_markup={"inline_keyboard": [[{"text": "📋 Открыть плеер", "web_app": {"url": WEBAPP_URL}}]]},
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
    print(f"🤖 TGPlay Bot starting...")
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

        # Удаляем webhook и отбрасываем старые обновления — иначе при рестарте бота
        # одни и те же /start обработают несколько экземпляров и шлют дубли
        await tg_request(session, "deleteWebhook", drop_pending_updates=True)

        # Настраиваем меню и команды
        await set_menu_button(session)
        await set_bot_commands(session)

        print("━" * 50)
        print("🎵 Бот запущен! Напиши /start в Telegram.")
        print("━" * 50)

        # Запускаем long polling
        await poll_updates(session)


def _acquire_lock() -> bool:
    """Только один экземпляр: fcntl.flock (Linux/macOS). Возвращает True если lock взят."""
    global _lock_fd
    if fcntl is None:
        return True
    try:
        _lock_fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True
    except (OSError, BlockingIOError) as e:
        if _lock_fd is not None:
            try:
                os.close(_lock_fd)
            except OSError:
                pass
            _lock_fd = None
        return False


def _release_lock() -> None:
    global _lock_fd
    if _lock_fd is not None and fcntl is not None:
        try:
            fcntl.flock(_lock_fd, fcntl.LOCK_UN)
            os.close(_lock_fd)
        except OSError:
            pass
        _lock_fd = None


def _on_signal(signum, frame):
    _release_lock()
    sys.exit(0)


if __name__ == "__main__":
    if sys.platform != "win32":
        signal.signal(signal.SIGTERM, _on_signal)
    if not _acquire_lock():
        print("❌ Уже запущен другой экземпляр бота. Останови его: pkill -f 'python.*bot.py'")
        sys.exit(1)
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Bot stopped")
    finally:
        _release_lock()
