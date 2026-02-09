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
  loginTelegram,
  preloadTrackUrl,
  removeFromPlaylist,
  resolveAudioUrl,
  searchTracks,
  sendToBot,
} from "./lib/api";
import { getTelegramUser } from "./lib/telegram";
import type { Track } from "./types";

type TgUser = { id: number; first_name: string; username?: string } | null;

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

  // ─── Refs для доступа из audio event handlers (useEffect []) ────
  const bufferingRef = useRef(false);       // true = загрузка/смена трека
  const userPausedRef = useRef(false);      // true = пользователь нажал паузу
  const handleNextRef = useRef<() => void>(() => {});

  const debouncedQuery = useDebouncedValue(query, 400);

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
        if (results.length === 0) setError("Ничего не найдено.");
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
      if (track.artwork) artwork.push({ src: track.artwork, sizes: "256x256", type: "image/jpeg" });
      navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: "TGPlayer", artwork });
    }

    // Resolve прямой VK CDN URL (маленький запрос через туннель)
    // Затем audio.src = VK CDN напрямую — минуя туннель для аудио данных
    resolveAudioUrl(track.id)
      .then((directUrl) => setAudioUrl(directUrl))
      .catch(() => {
        // Fallback: прокси через бэкенд если resolve не сработал
        setAudioUrl(`${import.meta.env.VITE_API_BASE ?? "http://localhost:8000"}/api/music/download/${encodeURIComponent(track.id)}`);
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
    audio.currentTime = value;
    setCurrentTime(value);
  }, []);

  // ─── Playlist actions ────────────────────────────────────────────
  const handleAdd = useCallback(async (track: Track) => {
    if (!isLoggedIn) { toast.error("Войдите через Telegram"); return; }
    try {
      if (await addToPlaylist(track)) { setPlaylist(await fetchPlaylist()); toast.success("Добавлено"); }
      else toast.error("Не удалось сохранить");
    } catch { toast.error("Не удалось сохранить"); }
  }, [isLoggedIn]);

  const handleRemove = useCallback(async (track: Track) => {
    try { if (await removeFromPlaylist(track.id)) { setPlaylist(await fetchPlaylist()); toast.success("Удалено"); } }
    catch { toast.error("Не удалось удалить"); }
  }, []);

  const handleSendToBot = useCallback(async (track: Track) => {
    if (!isLoggedIn) { toast.error("Войдите через Telegram"); return; }
    toast.info("Отправляем...");
    try { if (await sendToBot(track.id)) toast.success("Отправлено!"); else toast.error("Ошибка отправки"); }
    catch { toast.error("Ошибка отправки"); }
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
      // Не обновляем таймер во время буферизации/смены трека
      if (bufferingRef.current) return;
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
    <div className="min-h-full px-4 pt-4 pb-28 space-y-5">
      <header className="space-y-3 header-on-gradient">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] uppercase text-white/80 tracking-[0.15em] font-medium">
              {isLoggedIn ? `Привет, ${tgUser.first_name}` : "Telegram Mini App"}
            </p>
            <h1 className="text-xl font-semibold text-white tracking-tight">TGPlayer</h1>
          </div>
          <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center backdrop-blur-sm text-xl">🎵</div>
        </div>
        <SearchBar value={query} onChange={setQuery} />
      </header>

      <section className="space-y-4">
        {loading ? <LoadingState /> : null}
        {error ? <ErrorState message={error} /> : null}
        <TrackList title="Результаты поиска" tracks={tracks} onSelect={playTrack} onAdd={handleAdd} onSendToBot={handleSendToBot} isLoggedIn={isLoggedIn} />
      </section>

      {isLoggedIn && (
        <TrackList title="Мой плейлист" tracks={playlist} onSelect={playTrack} onRemove={handleRemove} onSendToBot={handleSendToBot} isLoggedIn={isLoggedIn} />
      )}

      <MiniPlayer track={currentTrack} isPlaying={isPlaying} isBuffering={isBuffering} onToggle={togglePlay} onNext={handleNext} onPrev={handlePrev} onOpen={() => setIsPlayerOpen(true)} onClose={handleCloseMiniPlayer} />

      <FullPlayer isOpen={isPlayerOpen} track={currentTrack} isPlaying={isPlaying} isBuffering={isBuffering} currentTime={currentTime} duration={duration} onClose={() => setIsPlayerOpen(false)} onToggle={togglePlay} onNext={handleNext} onPrev={handlePrev} onSeek={handleSeek} onSaveToPlaylist={handleAdd} onSendToBot={handleSendToBot} isLoggedIn={isLoggedIn} />

      <audio ref={audioRef} preload="auto" />
    </div>
  );
};

export default App;
