import type { Track } from "../types";
import { getInitData } from "./telegram";

/**
 * API: относительные URL — запросы идут на тот же хост, с которого открыт Mini App.
 */
function getApiBase(): string {
  if (typeof window !== "undefined" && window.location?.origin) return "";
  return import.meta.env.VITE_API_BASE || "http://localhost:8000";
}
const API_BASE = getApiBase();

const pick = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim().length > 0 ? value : fallback;

const normalizeTrack = (raw: Record<string, unknown>): Track => {
  const id = String(raw.id ?? raw.trackId ?? raw._id ?? "");
  const artwork = pick(raw.cover_url ?? raw.artwork ?? raw.cover ?? raw.image, "");
  const duration =
    typeof raw.duration === "number" ? raw.duration
    : typeof raw.duration === "string" ? parseInt(raw.duration, 10)
    : undefined;
  return {
    id,
    title: pick(raw.title ?? raw.name, "Unknown title"),
    artist: pick(raw.artist ?? raw.artist_name ?? raw.author, "Unknown artist"),
    artwork: artwork || undefined,
    duration: Number.isFinite(duration) ? duration : undefined,
  };
};

/** Fetch с таймаутом и retry при 503 — не виснет при медленном VPN */
const fetchWithTimeout = async (
  url: string,
  opts: RequestInit = {},
  timeoutMs = 18000,
  retries = 2,
): Promise<Response> => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      clearTimeout(timer);
      // Retry при 503 (tunnel overload)
      if (resp.status === 503 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return resp;
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  // fallback — не должен достигаться
  throw new Error("Request failed after retries");
};

const authHeaders = (): Record<string, string> => {
  const initData = getInitData();
  if (!initData) return { Accept: "application/json" };
  return {
    Accept: "application/json",
    Authorization: `tma ${initData}`,
    "Content-Type": "application/json",
  };
};

// ─── Search ─────────────────────────────────────────────────────

export const searchTracks = async (query: string): Promise<Track[]> => {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const response = await fetchWithTimeout(
    `${API_BASE}/api/music/search?q=${encodeURIComponent(trimmed)}`,
    { method: "GET", headers: { Accept: "application/json" } },
    18000,
    2, // retry 503
  );

  if (!response.ok) throw new Error(`Search failed: ${response.status}`);

  const data = await response.json();
  const items = Array.isArray(data) ? data : (data.items ?? data.tracks ?? data.results ?? []);
  return (items as Record<string, unknown>[])
    .map(normalizeTrack)
    .filter((t) => t.id.length > 0);
};

// ─── Audio URL resolution ─────────────────────────────────────

/** Кеш resolved URL (track_id → { url, ts }) */
const _urlCache = new Map<string, { url: string; ts: number }>();
const _URL_TTL = 20 * 60_000; // 20 мин

/**
 * Получает прямой VK CDN URL через бэкенд /resolve.
 * Клиент потом грузит аудио напрямую с VK — без прокси через туннель.
 *
 * Для максимальной скорости старта:
 * - Даже если VK отдаёт HLS (.m3u8), для Mini App используем ПРЯМОЙ
 *   VK CDN URL (HTMLAudioElement в мобильных WebView умеет HLS).
 * - Прокси `/api/music/download` используем только как Fallback
 *   (см. catch в `App.tsx`), чтобы не тянуть весь аудиопоток через туннель.
 */
export const resolveAudioUrl = async (trackId: string): Promise<string> => {
  // Проверяем кеш
  const cached = _urlCache.get(trackId);
  if (cached && Date.now() - cached.ts < _URL_TTL) return cached.url;

  // Запрос к бэкенду (маленький JSON, ~200 байт через туннель)
  const resp = await fetchWithTimeout(
    `${API_BASE}/api/music/resolve/${encodeURIComponent(trackId)}`,
    { method: "GET", headers: { Accept: "application/json" } },
    12000,
    2, // retry 503
  );

  if (!resp.ok) throw new Error(`Resolve failed: ${resp.status}`);
  const data = await resp.json();
  const url: string = data.url;

  // Для Mini App всегда предпочитаем прямой VK CDN URL —
  // так старт воспроизведения максимально быстрый и не грузим туннель.
  _urlCache.set(trackId, { url, ts: Date.now() });
  return url;
};

/** Синхронно возвращает URL из кеша — мгновенный старт без запроса. */
export const getCachedAudioUrl = (trackId: string): string | null => {
  const cached = _urlCache.get(trackId);
  if (cached && Date.now() - cached.ts < _URL_TTL) return cached.url;
  return null;
};

/**
 * Предзагружает URL трека в кеш (fire & forget).
 */
export const preloadTrackUrl = (trackId: string) => {
  if (_urlCache.has(trackId)) return;
  resolveAudioUrl(trackId).catch(() => {});
};

/**
 * Предзагружает URLs пачки треков (первые N из поисковой выдачи).
 * Вызывается сразу после получения результатов поиска.
 */
export const preloadBatchUrls = (trackIds: string[]) => {
  for (const id of trackIds) {
    if (!_urlCache.has(id)) {
      resolveAudioUrl(id).catch(() => {});
    }
  }
};

/** Fallback URL через прокси (для обратной совместимости) */
export const getDownloadUrl = (id: string) =>
  `${API_BASE}/api/music/download/${encodeURIComponent(id)}`;

// ─── Auth ───────────────────────────────────────────────────────

export const loginTelegram = async () => {
  const initData = getInitData();
  if (!initData) return null;
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initData }),
    }, 8000);
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.user as { id: number; first_name: string; username?: string } | null;
  } catch {
    return null;
  }
};

// ─── Playlist ───────────────────────────────────────────────────

export const fetchPlaylist = async (): Promise<Track[]> => {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/playlist`, { headers: authHeaders() }, 8000);
    if (!resp.ok) return [];
    const data = await resp.json();
    return ((data.items ?? []) as Record<string, unknown>[])
      .map(normalizeTrack)
      .filter((t) => t.id.length > 0);
  } catch {
    return [];
  }
};

export type AddToPlaylistResult = { ok: true; status: "saved" } | { ok: true; status: "already_exists" } | { ok: false };

export const addToPlaylist = async (track: Track): Promise<AddToPlaylistResult> => {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/playlist`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        id: track.id, title: track.title, artist: track.artist,
        duration: track.duration ?? 0, cover_url: track.artwork ?? null,
      }),
    }, 8000);
    if (!resp.ok) return { ok: false };
    const data = await resp.json().catch(() => ({}));
    return { ok: true, status: data.status === "already_exists" ? "already_exists" : "saved" };
  } catch { return { ok: false }; }
};

export const removeFromPlaylist = async (trackId: string): Promise<boolean> => {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/playlist/${encodeURIComponent(trackId)}`,
      { method: "DELETE", headers: authHeaders() }, 8000,
    );
    return resp.ok;
  } catch { return false; }
};

// ─── Send to Telegram bot ───────────────────────────────────────

export const sendToBot = async (trackId: string): Promise<boolean> => {
  try {
    const resp = await fetchWithTimeout(
      `${API_BASE}/api/send-to-bot/${encodeURIComponent(trackId)}`,
      {
        method: "POST",
        headers: authHeaders(),
        body: "{}",
      },
      60000,
    );
    return resp.ok;
  } catch { return false; }
};
