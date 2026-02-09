import type { Track } from "../types";
import { getInitData } from "./telegram";

/**
 * API клиент с таймаутами и retry для работы через VPN/туннель.
 */
const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";

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

/** Fetch с таймаутом — не виснет при медленном VPN */
const fetchWithTimeout = (url: string, opts: RequestInit = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
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
    12000,
  );

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const data = await response.json();
  const items = Array.isArray(data) ? data : (data.items ?? data.tracks ?? data.results ?? []);
  return (items as Record<string, unknown>[])
    .map(normalizeTrack)
    .filter((t) => t.id.length > 0);
};

/** URL для стриминга MP3 */
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

export const addToPlaylist = async (track: Track): Promise<boolean> => {
  try {
    const resp = await fetchWithTimeout(`${API_BASE}/api/playlist`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        id: track.id, title: track.title, artist: track.artist,
        duration: track.duration ?? 0, cover_url: track.artwork ?? null,
      }),
    }, 8000);
    return resp.ok;
  } catch { return false; }
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
      { method: "POST", headers: authHeaders() },
      60000,  // Долгий таймаут — ffmpeg конвертация + отправка
    );
    return resp.ok;
  } catch { return false; }
};
