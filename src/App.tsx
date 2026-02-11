import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "./components/ErrorState";
import { FullPlayer } from "./components/FullPlayer";
import { LoadingState } from "./components/LoadingState";
import { MiniPlayer } from "./components/MiniPlayer";
import { SearchBar } from "./components/SearchBar";
import { TrackList } from "./components/TrackList";
import { useDebouncedValue } from "./hooks/useDebouncedValue";
import { useHlsAudio } from "./hooks/useHlsAudio";
import { useMediaSession } from "./hooks/useMediaSession";
import { useTelegramTheme } from "./hooks/useTelegramTheme";
import {
  addToPlaylist,
  fetchPlaylist,
  getCachedAudioUrl,
  loginTelegram,
  preloadBatchUrls,
  preloadTrackUrl,
  removeFromPlaylist,
  resolveAudioUrl,
  searchTracks,
  sendToBot,
} from "./lib/api";
import { getTelegramUser } from "./lib/telegram";
import type { Track } from "./types";

type TgUser = { id: number; first_name: string; username?: string } | null;
const MAX_VISIBLE = 20;

const App = () => {
  useTelegramTheme();
  const audioRef = useRef<HTMLAudioElement>(null);

  const [tgUser, setTgUser] = useState<TgUser>(null);
  const isLoggedIn = tgUser !== null;

  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlist, setPlaylist] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showAll, setShowAll] = useState(false);

  // ─── Refs для доступа из audio event handlers (useEffect []) ────
  const bufferingRef = useRef(false);       // true = загрузка/смена трека
  const userPausedRef = useRef(false);      // true = пользователь нажал паузу
  const seekingRef = useRef(false);         // true = пользователь тянет ползунок
  const handleNextRef = useRef<() => void>(() => {});

  const debouncedQuery = useDebouncedValue(query, 300);

  // ─── Search ──────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!debouncedQuery.trim()) {
        setTracks([]); setError(""); setLoading(false); return;
      }
      setLoading(true); setError("");
      try {
        const results = await searchTracks(debouncedQuery);
        if (!active) return;
        setTracks(results);
        setShowAll(false);
        if (results.length === 0) setError("Ничего не найдено.");
        // Предзагружаем audio URLs первых 5 треков — клик будет мгновенным
        if (results.length > 0) {
          preloadBatchUrls(results.slice(0, 5).map((t) => t.id));
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Ошибка поиска");
        toast.error("Ошибка поиска треков");
      } finally { if (active) setLoading(false); }
    };
    run();
    return () => { active = false; };
  }, [debouncedQuery]);

  // ─── Auth ────────────────────────────────────────────────────────
  useEffect(() => {
    const u = getTelegramUser();
    if (u) loginTelegram().then((v) => setTgUser(v ?? u)).catch(() => setTgUser(u));
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    fetchPlaylist().then(setPlaylist).catch(() => toast.error("Не удалось загрузить плейлист"));
  }, [isLoggedIn]);

  // ─── Queue ───────────────────────────────────────────────────────
  const queue = useMemo(() => tracks.length > 0 ? tracks : playlist.length > 0 ? playlist : [], [tracks, playlist]);
  const currentIndex = useMemo(() => currentTrack ? queue.findIndex((t) => t.id === currentTrack.id) : -1, [queue, currentTrack]);
  const visibleTracks = useMemo(() => showAll ? tracks : tracks.slice(0, MAX_VISIBLE), [tracks, showAll]);

  // ─── Play track ──────────────────────────────────────────────────
  const playTrack = useCallback((track: Track) => {
    userPausedRef.current = false;
    bufferingRef.current = true;

    setCurrentTrack(track);
    setIsPlayerOpen(true);
    setIsPlaying(true);
    setIsBuffering(true);
    setCurrentTime(0);
    setDuration(track.duration && track.duration > 0 ? track.duration : 0);

    // Сразу обновляем системный пуш (без ожидания React effect)
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "playing";
      const artwork: MediaImage[] = [];
      const artSrc = track.artwork || (typeof window !== "undefined" ? `${window.location.origin}/icon-track.png` : "");
      if (artSrc) artwork.push({ src: artSrc, sizes: "256x256", type: track.artwork ? "image/jpeg" : "image/png" });
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: "TGPlay", artwork });
    }

    // Кеш → мгновенно. Иначе resolve → прямой VK, Fallback → proxy.
    const cached = getCachedAudioUrl(track.id);
    if (cached) {
      setAudioUrl(cached);
      return;
    }
    resolveAudioUrl(track.id)
      .then((directUrl) => setAudioUrl(directUrl))
      .catch(() => {
        const base = typeof window !== "undefined" ? "" : (import.meta.env.VITE_API_BASE || "http://localhost:8000");
        setAudioUrl(`${base}/api/music/download/${encodeURIComponent(track.id)}`);
      });
  }, []);

  const handleNext = useCallback(() => {
    if (queue.length === 0 || currentIndex === -1) return;
    playTrack(queue[(currentIndex + 1) % queue.length]);
  }, [queue, currentIndex, playTrack]);

  const handlePrev = useCallback(() => {
    if (queue.length === 0 || currentIndex === -1) return;
    playTrack(queue[(currentIndex - 1 + queue.length) % queue.length]);
  }, [queue, currentIndex, playTrack]);

  useEffect(() => { handleNextRef.current = handleNext; }, [handleNext]);

  // ─── Preload соседних треков (resolve URL в кеш) ─────────────────
  useEffect(() => {
    if (queue.length === 0 || currentIndex === -1) return;
    const nextIdx = (currentIndex + 1) % queue.length;
    const prevIdx = (currentIndex - 1 + queue.length) % queue.length;
    preloadTrackUrl(queue[nextIdx].id);
    if (prevIdx !== nextIdx) preloadTrackUrl(queue[prevIdx].id);
  }, [queue, currentIndex]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      userPausedRef.current = false;
      audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    } else {
      userPausedRef.current = true;
      audio.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleSeek = useCallback((value: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    seekingRef.current = true;
    setCurrentTime(value);
    audio.currentTime = value;
    const unlock = () => { seekingRef.current = false; };
    audio.addEventListener("seeked", unlock, { once: true });
    setTimeout(unlock, 500);
  }, []);

  // ─── Playlist actions ────────────────────────────────────────────
  const handleRemove = useCallback(async (track: Track) => {
    try { if (await removeFromPlaylist(track.id)) { setPlaylist(await fetchPlaylist()); toast.success("Удалено"); } }
    catch { toast.error("Не удалось удалить"); }
  }, []);

  /** Одна кнопка: добавить в плейлист + сохранить в облако (чат бота), один тост */
  const handleAddAndSend = useCallback(async (track: Track) => {
    if (!isLoggedIn) { toast.error("Войдите через Telegram"); return; }
    const t = toast.loading("Добавляем...");
    try {
      const [addResult, sendOk] = await Promise.all([
        addToPlaylist(track),
        sendToBot(track.id),
      ]);
      const list = await fetchPlaylist();
      setPlaylist(list);
      toast.dismiss(t);
      if (addResult.ok && addResult.status === "already_exists") {
        toast.success(sendOk ? "Трек сохранён в облако" : "Трек уже в плейлисте");
      } else if (addResult.ok && sendOk) {
        toast.success("Трек добавлен в плейлист и сохранён в облако");
      } else if (sendOk) {
        toast.success("Трек сохранён в облако");
      } else if (addResult.ok) {
        toast.success("Трек добавлен в плейлист");
      } else {
        toast.error("Не удалось добавить или сохранить");
      }
    } catch {
      toast.dismiss(t);
      toast.error("Ошибка");
    }
  }, [isLoggedIn]);

  const handleCloseMiniPlayer = useCallback(() => {
    const audio = audioRef.current;
    if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); }
    bufferingRef.current = false;
    userPausedRef.current = false;
    setCurrentTrack(null); setAudioUrl(null);
    setIsPlaying(false); setIsBuffering(false);
    setCurrentTime(0); setDuration(0); setIsPlayerOpen(false);
  }, []);

  // ─── Audio events (ОДИН раз, refs для актуального состояния) ─────
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      // Не обновляем таймер во время буферизации/смены трека/seek
      if (bufferingRef.current || seekingRef.current) return;
      setCurrentTime(audio.currentTime);
    };

    const onDurationChange = () => {
      const ad = audio.duration;
      if (!ad || !Number.isFinite(ad) || ad <= 0) return;
      setDuration((prev) => {
        if (prev > 0) return Math.abs(ad - prev) / prev < 0.3 ? ad : prev;
        return ad > 10 ? ad : prev;
      });
    };

    const onPlaying = () => {
      // Трек РЕАЛЬНО играет — снимаем буферизацию
      bufferingRef.current = false;
      setIsBuffering(false);
      setIsPlaying(true);
      // Обновляем пуш
      if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
    };

    const onPause = () => {
      // Игнорируем pause при буферизации (смена src вызывает pause)
      if (bufferingRef.current) return;
      // Игнорируем если пользователь не нажимал паузу
      // (браузер может вызвать pause при seeking и т.д.)
      if (!userPausedRef.current) return;
      setIsPlaying(false);
    };

    const onWaiting = () => {
      bufferingRef.current = true;
      setIsBuffering(true);
    };

    const onCanPlay = () => {
      // Данные загружены — если мы не на паузе, буферизация окончена
      if (!userPausedRef.current) {
        bufferingRef.current = false;
        setIsBuffering(false);
      }
    };

    const onEnded = () => handleNextRef.current();

    const onError = () => {
      // Игнорируем ошибки при смене src (abort)
      if (bufferingRef.current && audio.error?.code === MediaError.MEDIA_ERR_ABORTED) return;
      bufferingRef.current = false;
      setIsBuffering(false);
      setIsPlaying(false);
      toast.error("Не удалось воспроизвести трек");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadedmetadata", onDurationChange);
    audio.addEventListener("durationchange", onDurationChange);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("canplay", onCanPlay);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadedmetadata", onDurationChange);
      audio.removeEventListener("durationchange", onDurationChange);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("canplay", onCanPlay);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
    };
  }, []);

  // ─── useHlsAudio ─────────────────────────────────────────────────
  const onAudioReady = useCallback(() => {
    bufferingRef.current = false;
    setIsPlaying(true);
    setIsBuffering(false);
  }, []);

  const onAudioError = useCallback((msg: string) => {
    bufferingRef.current = false;
    setIsPlaying(false);
    setIsBuffering(false);
    toast.error(msg);
  }, []);

  useHlsAudio(audioRef, audioUrl, onAudioReady, onAudioError);

  useMediaSession(currentTrack, isPlaying, togglePlay, handleNext, handlePrev, handleSeek, duration, currentTime);

  return (
    <div className="min-h-full px-4 pt-5 pb-32 space-y-8">
      {/* Header — одна строка: логотип, заголовок, приветствие */}
      <header className="space-y-4">
        <div className="flex flex-col items-center gap-1">
          <div className="flex items-center justify-center" style={{ gap: 0 }}>
            <img src="/icon.png" alt="" className="w-11 h-11 object-contain opacity-50 shrink-0 -mr-2" aria-hidden />
            <h1 className="text-xl font-semibold text-white tracking-tight">TGPlay</h1>
          </div>
          <p className="text-[11px] uppercase text-white/70 tracking-[0.12em] font-medium">
            {isLoggedIn ? `Привет, ${tgUser.first_name}` : "Telegram Mini App"}
          </p>
        </div>
        <SearchBar value={query} onChange={setQuery} />
      </header>

      {/* Секция поиска — карточный блок */}
      <section className="space-y-4">
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        <TrackList title="Результаты поиска" tracks={visibleTracks} playlist={playlist} onSelect={playTrack} onAddAndSend={handleAddAndSend} onRemove={handleRemove} isLoggedIn={isLoggedIn} />
        {tracks.length > MAX_VISIBLE && !showAll && (
          <button className="w-full py-3 text-[13px] font-medium text-accent rounded-2xl glass shadow-card active:opacity-80 touch-manipulation select-none" onClick={() => setShowAll(true)} type="button">
            Показать ещё {tracks.length - MAX_VISIBLE} треков
          </button>
        )}
      </section>

      {isLoggedIn && (
        <TrackList title="Мой плейлист" tracks={playlist} playlist={playlist} onSelect={playTrack} onRemove={handleRemove} onAddAndSend={handleAddAndSend} isLoggedIn={isLoggedIn} />
      )}

      <MiniPlayer track={currentTrack} isPlaying={isPlaying} isBuffering={isBuffering} onToggle={togglePlay} onNext={handleNext} onPrev={handlePrev} onOpen={() => setIsPlayerOpen(true)} onClose={handleCloseMiniPlayer} />

      {isPlayerOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 pointer-events-none" aria-hidden />
      )}
      <FullPlayer isOpen={isPlayerOpen} track={currentTrack} isPlaying={isPlaying} isBuffering={isBuffering} currentTime={currentTime} duration={duration} onClose={() => setIsPlayerOpen(false)} onToggle={togglePlay} onNext={handleNext} onPrev={handlePrev} onSeek={handleSeek} onAddAndSend={handleAddAndSend} onRemove={handleRemove} isLoggedIn={isLoggedIn} isInPlaylist={currentTrack ? playlist.some((t) => t.id === currentTrack.id) : false} />

      <audio ref={audioRef} preload="auto" playsInline />
    </div>
  );
};

export default App;
