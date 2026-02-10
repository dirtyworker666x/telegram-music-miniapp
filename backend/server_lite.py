"""
TGPlay Lite API — поиск VK + ffmpeg-стриминг HLS→MP3 + Telegram auth + плейлисты.
Запускай:  python3 server_lite.py

Оптимизации:
- Единая aiohttp сессия (connection pool)
- Параллельные VK-запросы через asyncio.gather
- Быстрый ffmpeg пресет для низкой задержки
- Кеширование VK audio URL (TTL 10 мин)
- Потоковая отдача MP3 — клиент играет через 1-2 сек
- Security headers
"""
from __future__ import annotations
import asyncio, hashlib, hmac, json, os, re, shutil, time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional, List, Dict
from urllib.parse import parse_qs, unquote
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

VK_TOKEN = os.getenv("VK_TOKEN", "")
VK_USER_AGENT = os.getenv("VK_USER_AGENT", "VKAndroidApp/5.52-4543")
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
PORT = int(os.getenv("APP_PORT", "8000"))

if not VK_TOKEN:
    print("❌  VK_TOKEN не указан в backend/.env!")
    exit(1)
if not BOT_TOKEN:
    print("❌  BOT_TOKEN не указан в backend/.env!")
    exit(1)

# ─── Папка для хранения плейлистов ──────────────────────────────
DATA_DIR = Path(__file__).parent / "user_data"
DATA_DIR.mkdir(exist_ok=True)

# ─── Кеш VK audio URL (track_id → (url, timestamp)) ─────────────
_url_cache: Dict[str, tuple] = {}
_URL_TTL = 1500  # 25 минут

def _cache_get(track_id: str) -> Optional[str]:
    entry = _url_cache.get(track_id)
    if entry and time.time() - entry[1] < _URL_TTL:
        return entry[0]
    _url_cache.pop(track_id, None)
    return None

def _cache_set(track_id: str, url: str):
    _url_cache[track_id] = (url, time.time())
    # Очистка старых записей (макс 500)
    if len(_url_cache) > 500:
        cutoff = time.time() - _URL_TTL
        to_del = [k for k, v in _url_cache.items() if v[1] < cutoff]
        for k in to_del:
            del _url_cache[k]

# ─── Транслитерация EN↔RU для fallback-поиска ───────────────────
_EN2RU = {
    "a": "а", "b": "б", "c": "ц", "d": "д", "e": "е", "f": "ф",
    "g": "г", "h": "х", "i": "и", "j": "дж", "k": "к", "l": "л",
    "m": "м", "n": "н", "o": "о", "p": "п", "q": "к", "r": "р",
    "s": "с", "t": "т", "u": "у", "v": "в", "w": "в", "x": "кс",
    "y": "й", "z": "з",
    "sh": "ш", "ch": "ч", "zh": "ж", "th": "т", "ph": "ф",
    "ya": "я", "yu": "ю", "yo": "ё", "ye": "е", "ey": "ей",
    "oo": "у", "ee": "и", "ts": "ц", "ck": "к",
}

def _transliterate_to_russian(text: str) -> str:
    result = text.lower()
    for lat, cyr in sorted(_EN2RU.items(), key=lambda x: -len(x[0])):
        result = result.replace(lat, cyr)
    return result

def _has_cyrillic(text: str) -> bool:
    return bool(re.search(r'[а-яёА-ЯЁ]', text))

def _has_latin(text: str) -> bool:
    return bool(re.search(r'[a-zA-Z]', text))

# Формат VK track_id: owner_id (опционально минус) + _ + id (только цифры)
TRACK_ID_RE = re.compile(r"^-?\d+_\d+$")

def _valid_track_id(track_id: str) -> bool:
    return bool(track_id and TRACK_ID_RE.match(track_id))


FFMPEG = shutil.which("ffmpeg")
if not FFMPEG:
    print("❌  ffmpeg не найден! brew install ffmpeg")
    exit(1)

import aiohttp
from fastapi import FastAPI, Query, Path as Param, Header, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, Response, RedirectResponse

# ─── Единая HTTP-сессия ──────────────────────────────────────────
_http_session: Optional[aiohttp.ClientSession] = None

@asynccontextmanager
async def _lifespan(app: FastAPI):
    yield
    global _http_session
    if _http_session and not _http_session.closed:
        await _http_session.close()

app = FastAPI(title="TGPlay Lite API", docs_url="/docs", redoc_url=None, lifespan=_lifespan)

async def get_session() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        timeout = aiohttp.ClientTimeout(total=30, connect=10)
        connector = aiohttp.TCPConnector(
            limit=100,                   # 100 параллельных соединений к VK
            limit_per_host=30,           # Макс 30 на один хост
            ttl_dns_cache=300,
            enable_cleanup_closed=True,
            force_close=False,
            keepalive_timeout=60,
        )
        _http_session = aiohttp.ClientSession(timeout=timeout, connector=connector)
    return _http_session


# ─── CORS ────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Length", "Content-Type", "Content-Range", "Accept-Ranges"],
)

# ─── Security middleware ─────────────────────────────────────────
from starlette.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "ALLOWALL"  # Telegram iframe
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)


# ─── Telegram WebApp Auth ────────────────────────────────────────

def validate_init_data(init_data: str, bot_token: str) -> Optional[Dict]:
    try:
        parsed = parse_qs(init_data, keep_blank_values=True)
        check_hash = parsed.get("hash", [None])[0]
        if not check_hash:
            return None

        pairs = []
        for key, values in parsed.items():
            if key == "hash":
                continue
            pairs.append(f"{key}={values[0]}")
        pairs.sort()
        data_check_string = "\n".join(pairs)

        secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
        calculated = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

        if not hmac.compare_digest(calculated, check_hash):
            return None

        auth_date = int(parsed.get("auth_date", ["0"])[0])
        if time.time() - auth_date > 86400:
            return None

        user_raw = parsed.get("user", [None])[0]
        if not user_raw:
            return None
        user = json.loads(unquote(user_raw))
        return user
    except Exception as e:
        print(f"⚠️ initData validation error: {e}")
        return None


def get_user_from_header(authorization: Optional[str]) -> Dict:
    if not authorization:
        raise HTTPException(401, "Missing Authorization header")
    parts = authorization.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "tma":
        raise HTTPException(401, "Invalid Authorization format")
    user = validate_init_data(parts[1], BOT_TOKEN)
    if not user:
        raise HTTPException(401, "Invalid or expired Telegram initData")
    return user


# ─── User playlist storage ──────────────────────────────────────

def _playlist_path(user_id: int) -> Path:
    # Защита от path traversal
    safe_id = int(user_id)
    return DATA_DIR / f"{safe_id}.json"

def load_playlist(user_id: int) -> List[Dict]:
    p = _playlist_path(user_id)
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text("utf-8"))
    except Exception:
        return []

def save_playlist(user_id: int, tracks: List[Dict]):
    p = _playlist_path(user_id)
    p.write_text(json.dumps(tracks, ensure_ascii=False, indent=2), "utf-8")


from pydantic import BaseModel

class TrackPayload(BaseModel):
    id: str
    title: str
    artist: str
    duration: int = 0
    cover_url: Optional[str] = None


# ─── VK helpers (оптимизированные) ───────────────────────────────

async def _vk_search_raw(query: str, limit: int, auto_complete: int = 0, sort: int = 0) -> List[Dict]:
    params = {
        "access_token": VK_TOKEN,
        "v": "5.131",
        "q": query,
        "count": min(limit, 300),
        "sort": sort,
        "auto_complete": auto_complete,
        "search_own": 0,
    }
    headers = {"User-Agent": VK_USER_AGENT}
    session = await get_session()
    try:
        async with session.get(
            "https://api.vk.com/method/audio.search",
            params=params, headers=headers,
        ) as resp:
            data = await resp.json()
    except Exception as e:
        print(f"⚠️ VK search error: {e}")
        return []

    if "error" in data:
        code = data["error"].get("error_code", "?")
        msg = data["error"].get("error_msg", "Unknown error")
        print(f"❌ VK API Error {code}: {msg}")
        return []

    items = data.get("response", {}).get("items", [])
    return items


def _parse_tracks(items: List[Dict]) -> List[Dict]:
    tracks = []
    seen = set()
    for item in items:
        track_id = f"{item['owner_id']}_{item['id']}"
        if track_id in seen:
            continue
        seen.add(track_id)
        cover_url = None
        album = item.get("album") or {}
        thumb = album.get("thumb") or {}
        if thumb:
            cover_url = (
                thumb.get("photo_600")
                or thumb.get("photo_300")
                or thumb.get("photo_68")
            )
        tracks.append({
            "id": track_id,
            "title": item.get("title", ""),
            "artist": item.get("artist", ""),
            "duration": item.get("duration", 0),
            "cover_url": cover_url,
        })
    return tracks


async def vk_audio_search(query: str, limit: int = 50) -> List[Dict]:
    """Оптимизированный поиск: параллельные запросы через asyncio.gather."""
    # Запускаем 2 запроса параллельно (вместо 3 последовательных)
    results = await asyncio.gather(
        _vk_search_raw(query, limit, auto_complete=0, sort=0),
        _vk_search_raw(query, limit, auto_complete=1, sort=2),
        return_exceptions=True,
    )

    all_items: List[Dict] = []
    for r in results:
        if isinstance(r, list):
            all_items += r

    # Fallback транслитерация только если совсем мало
    if len(all_items) < 3 and _has_latin(query):
        words = query.split()
        converted = []
        for w in words:
            if _has_latin(w) and not _has_cyrillic(w):
                converted.append(_transliterate_to_russian(w))
            else:
                converted.append(w)
        ru_query = " ".join(converted)
        if ru_query != query.lower():
            extra = await _vk_search_raw(ru_query, limit, auto_complete=1, sort=2)
            all_items += extra

    tracks = _parse_tracks(all_items)
    return tracks[:limit]


async def vk_get_audio_url(track_id: str) -> Optional[str]:
    # Проверяем кеш
    cached = _cache_get(track_id)
    if cached:
        return cached

    params = {
        "access_token": VK_TOKEN,
        "v": "5.131",
        "audios": track_id,
    }
    headers = {"User-Agent": VK_USER_AGENT}
    session = await get_session()
    try:
        async with session.get(
            "https://api.vk.com/method/audio.getById",
            params=params, headers=headers,
        ) as resp:
            data = await resp.json()
    except Exception as e:
        print(f"⚠️ VK getById error: {e}")
        return None

    if "error" in data:
        print(f"❌ VK getById error: {data['error']}")
        return None
    items = data.get("response", [])
    if not items:
        return None
    url = items[0].get("url")
    if url:
        _cache_set(track_id, url)
    return url


# ─── ffmpeg streaming (оптимизированный) ─────────────────────────

async def ffmpeg_stream_mp3(source_url: str):
    """
    Быстрый ffmpeg стриминг с минимальной задержкой.
    - fflags +nobuffer: без буферизации входа
    - analyzeduration/probesize: быстрый старт
    - q:a 5: VBR ~130kbps (быстрее чем CBR 192k, хорошее качество)
    - write_xing 0: не ждём конца для записи заголовка
    """
    cmd = [
        FFMPEG,
        "-hide_banner", "-loglevel", "error",
        "-fflags", "+nobuffer+fastseek",
        "-analyzeduration", "500000",   # 0.5 сек анализа вместо дефолтных 5
        "-probesize", "500000",         # 500KB пробы вместо дефолтных 5MB
        "-user_agent", VK_USER_AGENT,
        "-i", source_url,
        "-vn",
        "-acodec", "libmp3lame",
        "-q:a", "5",                    # VBR ~130kbps — быстрее, хорошее качество
        "-write_xing", "0",             # Не ждём конца файла
        "-fflags", "+flush_packets",
        "-f", "mp3",
        "pipe:1",
    ]

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    try:
        while True:
            chunk = await proc.stdout.read(16 * 1024)  # 16KB чанки для быстрого старта
            if not chunk:
                break
            yield chunk
    finally:
        if proc.returncode is None:
            proc.kill()
        await proc.wait()
        stderr_data = await proc.stderr.read()
        if proc.returncode != 0 and stderr_data:
            print(f"⚠️  ffmpeg stderr: {stderr_data.decode(errors='replace')[:300]}")


# ─── Routes ──────────────────────────────────────────────────────

@app.get("/api/status")
async def api_status():
    return {"status": "online", "message": "TGPlay Lite API"}


@app.get("/api/music/search")
async def search(
    q: str = Query(..., description="Search query"),
    limit: int = Query(50, ge=1, le=300, description="Max results"),
):
    if not q.strip():
        raise HTTPException(400, "Empty query")
    tracks = await vk_audio_search(q.strip(), limit=limit)

    # Pre-resolve audio URLs для первых 5 треков (в фоне, кешируем)
    # Клиент получит их мгновенно при клике
    if tracks:
        top_ids = [t["id"] for t in tracks[:5]]
        asyncio.ensure_future(_batch_presolve(top_ids))

    return Response(
        content=json.dumps({"items": tracks}, ensure_ascii=False),
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=60"},
    )


async def _batch_presolve(track_ids: List[str]):
    """Фоновая предзагрузка audio URLs в кеш для быстрого resolve."""
    try:
        await asyncio.gather(
            *[vk_get_audio_url(tid) for tid in track_ids],
            return_exceptions=True,
        )
    except Exception:
        pass


@app.get("/api/music/resolve/{track_id}")
async def resolve_url(track_id: str = Param(...)):
    """Возвращает прямой VK CDN URL. Клиент грузит аудио напрямую — без прокси."""
    if not _valid_track_id(track_id):
        raise HTTPException(400, "Invalid track ID format")
    url = await vk_get_audio_url(track_id)
    if not url:
        raise HTTPException(404, "Track not found or restricted")
    return Response(
        content=json.dumps({"url": url, "hls": _is_hls_url(url)}),
        media_type="application/json",
        headers={"Cache-Control": "public, max-age=120"},
    )


@app.get("/api/music/download/{track_id}")
async def download(track_id: str = Param(...)):
    """302 redirect на VK CDN для прямых MP3. ffmpeg только для HLS."""
    if not _valid_track_id(track_id):
        raise HTTPException(400, "Invalid track ID format")

    url = await vk_get_audio_url(track_id)
    if not url:
        raise HTTPException(404, "Track not found or restricted")

    # Прямой MP3 → 302 redirect (аудио минует туннель полностью!)
    if not _is_hls_url(url):
        return RedirectResponse(url, status_code=302)

    # HLS → ffmpeg transcode (единственный случай когда нужен прокси)
    return StreamingResponse(
        ffmpeg_stream_mp3(url),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "public, max-age=300",
            "Accept-Ranges": "none",
            "Transfer-Encoding": "chunked",
        },
    )


# ─── Auth route ──────────────────────────────────────────────────

@app.post("/api/auth/login")
async def login(request: Request):
    body = await request.json()
    init_data = body.get("initData", "")
    if not init_data:
        raise HTTPException(400, "Missing initData")
    user = validate_init_data(init_data, BOT_TOKEN)
    if not user:
        raise HTTPException(401, "Invalid or expired Telegram initData")
    # Не возвращаем лишние данные — только id, first_name, username
    safe_user = {
        "id": user.get("id"),
        "first_name": user.get("first_name", ""),
        "username": user.get("username"),
    }
    return {"status": "ok", "user": safe_user}


# ─── Playlist routes ─────────────────────────────────────────────

@app.get("/api/playlist")
async def get_playlist(authorization: Optional[str] = Header(None)):
    user = get_user_from_header(authorization)
    tracks = load_playlist(user["id"])
    return {"items": tracks}


@app.post("/api/playlist")
async def add_to_playlist(track: TrackPayload, authorization: Optional[str] = Header(None)):
    user = get_user_from_header(authorization)
    tracks = load_playlist(user["id"])
    if len(tracks) >= 500:
        raise HTTPException(400, "Playlist limit reached (500)")
    if any(t["id"] == track.id for t in tracks):
        return {"status": "already_exists", "count": len(tracks)}
    # Санитизация
    safe_track = {
        "id": track.id[:50],
        "title": track.title[:200],
        "artist": track.artist[:200],
        "duration": min(max(track.duration, 0), 36000),
        "cover_url": (track.cover_url or "")[:500] or None,
    }
    tracks.append(safe_track)
    save_playlist(user["id"], tracks)
    return {"status": "saved", "count": len(tracks)}


@app.delete("/api/playlist/{track_id}")
async def remove_from_playlist(track_id: str, authorization: Optional[str] = Header(None)):
    if not _valid_track_id(track_id):
        raise HTTPException(400, "Invalid track ID format")
    user = get_user_from_header(authorization)
    tracks = load_playlist(user["id"])
    tracks = [t for t in tracks if t["id"] != track_id]
    save_playlist(user["id"], tracks)
    return {"status": "removed", "count": len(tracks)}


# ─── MP3 кеш на диске ────────────────────────────────────────────

CACHE_DIR = Path(__file__).parent / "mp3_cache"
CACHE_DIR.mkdir(exist_ok=True)
_MAX_CACHE_FILES = 100  # макс файлов в кеше

def _cache_mp3_path(track_id: str) -> Path:
    # Только валидный формат VK — защита от path traversal
    if not _valid_track_id(track_id):
        track_id = hashlib.sha256(track_id.encode()).hexdigest()[:32]
    return CACHE_DIR / f"{track_id}.mp3"

def _cleanup_cache():
    """Удаляем самые старые файлы если кеш переполнен."""
    files = sorted(CACHE_DIR.glob("*.mp3"), key=lambda f: f.stat().st_mtime)
    while len(files) > _MAX_CACHE_FILES:
        files.pop(0).unlink(missing_ok=True)


async def _download_direct(url: str) -> Optional[bytes]:
    """Скачивает прямой MP3/аудио файл без ffmpeg."""
    session = await get_session()
    try:
        async with session.get(url, headers={"User-Agent": VK_USER_AGENT}) as resp:
            if resp.status != 200:
                return None
            ct = resp.headers.get("Content-Type", "")
            # Если HLS — нужен ffmpeg
            if "mpegurl" in ct.lower() or "m3u8" in ct.lower():
                return None
            data = await resp.read()
            # Проверяем что это аудио (не HTML ошибка)
            if len(data) < 10000:
                return None
            return data
    except Exception:
        return None


def _is_hls_url(url: str) -> bool:
    """Определяем HLS по URL."""
    return ".m3u8" in url.lower() or "/index.m3u8" in url.lower()


async def _get_mp3_data(track_id: str, url: str) -> Optional[bytes]:
    """
    Получает MP3 данные трека. Приоритеты:
    1. Кеш на диске (мгновенно)
    2. Прямое скачивание (если не HLS) — быстро, без ffmpeg
    3. ffmpeg конвертация (HLS → MP3) — медленнее, но работает всегда
    """
    # 1. Проверяем дисковый кеш
    cache_path = _cache_mp3_path(track_id)
    if cache_path.exists():
        print(f"⚡ Cache hit: {track_id}")
        return cache_path.read_bytes()

    mp3_data = None

    # 2. Прямое скачивание (без ffmpeg) если URL не HLS
    if not _is_hls_url(url):
        print(f"⬇️  Direct download: {track_id}")
        mp3_data = await _download_direct(url)

    # 3. Fallback: ffmpeg (для HLS или если прямое скачивание не удалось)
    if not mp3_data:
        print(f"🔧 ffmpeg convert: {track_id}")
        cmd = [
            FFMPEG,
            "-hide_banner", "-loglevel", "error",
            "-fflags", "+nobuffer+fastseek",
            "-analyzeduration", "500000",
            "-probesize", "500000",
            "-user_agent", VK_USER_AGENT,
            "-i", url,
            "-vn",
            "-acodec", "libmp3lame",
            "-q:a", "7",            # VBR ~100kbps — быстрее, компактнее для Telegram
            "-write_xing", "0",
            "-f", "mp3", "pipe:1",
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        mp3_data, stderr = await proc.communicate()
        if proc.returncode != 0 or not mp3_data:
            err = stderr.decode(errors="replace")[:200] if stderr else ""
            print(f"⚠️ ffmpeg error: {err}")
            return None

    # Сохраняем в кеш
    try:
        cache_path.write_bytes(mp3_data)
        _cleanup_cache()
    except Exception:
        pass

    return mp3_data


# ─── Send track to Telegram bot chat ─────────────────────────────

async def _fetch_track_info(track_id: str) -> Dict:
    """Получает инфо о треке из VK API (корректно закрывает ответ)."""
    session = await get_session()
    try:
        async with session.get(
            "https://api.vk.com/method/audio.getById",
            params={"access_token": VK_TOKEN, "v": "5.131", "audios": track_id},
            headers={"User-Agent": VK_USER_AGENT},
        ) as resp:
            data = await resp.json()
            items = data.get("response", [])
            return items[0] if items else {}
    except Exception:
        return {}


async def _send_track_to_telegram(chat_id: int, track_id: str) -> None:
    """Фоновая задача: получает MP3 и отправляет в Telegram.
    Делается в фоне, чтобы HTTP-запрос из Mini App завершался быстро.
    """
    if not _valid_track_id(track_id):
        print(f"⚠️ [bg] Invalid track ID format: {track_id}")
        return

    # Получаем URL и инфо параллельно
    url, track_info = await asyncio.gather(
        vk_get_audio_url(track_id),
        _fetch_track_info(track_id),
        return_exceptions=True,
    )

    if isinstance(url, Exception) or not url:
        print(f"⚠️ [bg] Failed to get VK url for {track_id}: {url}")
        return
    if isinstance(track_info, Exception):
        track_info = {}

    title = track_info.get("title", "Unknown")[:100]
    artist = track_info.get("artist", "Unknown")[:100]

    print(f"📤 [bg] Send to bot {chat_id}: {artist} — {title}")

    # Получаем MP3 (кеш → прямое скачивание → ffmpeg)
    mp3_data = await _get_mp3_data(track_id, url)
    if not mp3_data:
        print(f"⚠️ [bg] Failed to get MP3 data for {track_id}")
        return

    print(f"📦 [bg] MP3 ready: {len(mp3_data) // 1024}KB, sending to Telegram...")

    # Отправляем через Telegram Bot API
    session = await get_session()
    tg_url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendAudio"
    form = aiohttp.FormData()
    form.add_field("chat_id", str(chat_id))
    form.add_field("title", title)
    form.add_field("performer", artist)
    form.add_field("audio", mp3_data, filename=f"{artist} - {title}.mp3", content_type="audio/mpeg")

    try:
        async with session.post(tg_url, data=form) as resp:
            result = await resp.json()
    except Exception as e:
        print(f"⚠️ [bg] Telegram API error: {e}")
        return

    if not result.get("ok"):
        desc = result.get("description", "Unknown error")
        print(f"⚠️ [bg] Telegram error: {desc}")
        return

    print(f"✅ [bg] Sent to chat {chat_id}")


@app.post("/api/send-to-bot/{track_id}")
async def send_to_bot(
    track_id: str,
    authorization: Optional[str] = Header(None),
    background: BackgroundTasks = None,
):
    """Эндпоинт для Mini App: быстро подтверждает запрос и
    отправляет трек в чат в фоне, чтобы ничего не «висело»."""
    user = get_user_from_header(authorization)
    chat_id = user["id"]

    if not _valid_track_id(track_id):
        raise HTTPException(400, "Invalid track ID format")

    if background is None:
        # fallback (не должен срабатывать, но на всякий случай)
        asyncio.create_task(_send_track_to_telegram(chat_id, track_id))
    else:
        background.add_task(_send_track_to_telegram, chat_id, track_id)

    return {"status": "queued", "chat_id": chat_id}


# ─── Health check ────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {"status": "ok", "cache_size": len(_url_cache)}


# ─── Статика: раздаём собранный фронтенд (dist/) напрямую ─────

from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

DIST_DIR = Path(__file__).parent.parent / "dist"
_static_dir = Path(__file__).parent / "static"
_front = DIST_DIR if DIST_DIR.is_dir() else (_static_dir if _static_dir.is_dir() else None)

# Без кэша — Telegram всегда подтягивает свежий index.html и новый дизайн
_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

if _front:
    _index = _front / "index.html"

    _assets = _front / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @app.get("/")
    async def serve_index():
        return FileResponse(str(_index), media_type="text/html", headers=_NO_CACHE_HEADERS)

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        file_path = _front / path
        if file_path.is_file() and ".." not in path:
            return FileResponse(str(file_path))
        return FileResponse(str(_index), media_type="text/html", headers=_NO_CACHE_HEADERS)

    print(f"📁 Serving frontend from {_front} (no-cache for index)")
else:
    print(f"⚠️  dist/ не найдена. Запусти: npm run build")


if __name__ == "__main__":
    import uvicorn
    print(f"🎵 TGPlay Lite API on http://0.0.0.0:{PORT}")
    print(f"📖 Docs: http://127.0.0.1:{PORT}/docs")
    print(f"👥 Max concurrent: 200 | Keep-alive: 120s")
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=PORT,
        timeout_keep_alive=120,     # Держим соединения дольше
        limit_concurrency=200,      # 200 одновременных запросов
        limit_max_requests=10000,   # Рестарт worker после 10k запросов (утечки памяти)
        backlog=256,                # Большая очередь входящих
        access_log=False,           # Отключаем access log для скорости
    )
