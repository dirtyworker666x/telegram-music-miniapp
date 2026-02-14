import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Loader2, Pause, Play, Send, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { useCallback } from "react";
import type { Track } from "../types";
import { WaveformSeekBar } from "./WaveformSeekBar";

type FullPlayerProps = {
  isOpen: boolean;
  track: Track | null;
  isPlaying: boolean;
  isBuffering?: boolean;
  currentTime: number;
  duration: number;
  onClose: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (value: number) => void;
  onAddAndSend?: (track: Track) => void | Promise<void>;
  onRemove?: (track: Track) => void | Promise<void>;
  isLoggedIn?: boolean;
  isInPlaylist?: boolean;
};

// Используем CSS‑переменную для support светлой/тёмной темы (как у mini player)
const ACCENT_STYLE = { color: "rgb(var(--accent))" } as const;

export const FullPlayer = ({
  isOpen,
  track,
  isPlaying,
  isBuffering,
  currentTime,
  duration,
  onClose,
  onToggle,
  onNext,
  onPrev,
  onSeek,
  onAddAndSend,
  onRemove,
  isLoggedIn,
  isInPlaylist,
}: FullPlayerProps) => {
  const onWaveSeekStart = useCallback(() => {}, []);
  const onWaveSeekMove = useCallback(() => {}, []);
  const onWaveSeekEnd = useCallback((time: number) => {
    onSeek(time);
  }, [onSeek]);

  if (!track) return null;

  const player = (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed z-[99999] flex flex-col w-full bg-black/65 overflow-hidden"
          style={{
            // inset: 0 + отрицательный top — тянем оверлей до самого верха (включая safe area)
            top: "calc(-1 * env(safe-area-inset-top, 0px))",
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "calc(100dvh + env(safe-area-inset-top, 0px))",
            minHeight: "calc(100dvh + env(safe-area-inset-top, 0px))",
            margin: 0,
            padding: 0,
            backdropFilter: "blur(40px)",
            WebkitBackdropFilter: "blur(40px)",
            touchAction: "pan-x",
          }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
        >
          <div className="relative flex-1 overflow-hidden flex flex-col">
            {/* Размытый фон обложки */}
            <div
              className="absolute inset-0 opacity-60 blur-3xl scale-110 pointer-events-none"
              style={{
                backgroundImage: track.artwork
                  ? `url(${track.artwork})`
                  : "linear-gradient(135deg, rgba(0,136,204,0.6), rgba(0,102,153,0.6))",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
            />
            {/* Градиент — снизу заметно затемнён */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/25 to-black/75 pointer-events-none" />

            {/* Контент — отступ сверху = safe area (чтобы не уйти под вырез) */}
            <div
              className="relative z-10 flex flex-col flex-1 px-5 overflow-hidden"
              style={{
                paddingTop: "env(safe-area-inset-top, 0)",
                paddingBottom: "max(16px, env(safe-area-inset-bottom))",
              }}
            >
              {/* Хедер — кнопка закрытия слева, иконка и текст по центру */}
              <div className="relative flex items-center justify-center flex-shrink-0 py-1">
                <button
                  onClick={onClose}
                  className="absolute left-0 p-2 -ml-2 rounded-full text-white/70 hover:text-white active:opacity-80 border-0 touch-manipulation"
                  type="button"
                  aria-label="Закрыть"
                >
                  <ChevronDown className="h-7 w-7" />
                </button>
                <div className="flex items-center justify-center" style={{ gap: 0 }}>
                  <img
                    src="/icon.png"
                    alt=""
                    className="w-11 h-11 object-contain opacity-50 shrink-0 -mr-2"
                  />
                  <div className="text-[11px] text-white/50 font-medium uppercase tracking-[0.15em]">TGPlay</div>
                </div>
              </div>

              {/* Обложка и название — отступ снизу чтобы дорожка не залезала */}
              <div className="flex flex-col items-center flex-shrink-0 mt-2 mb-12">
                <motion.div
                  className="w-[min(88vw,352px)] aspect-square rounded-3xl overflow-hidden shadow-2xl"
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.4, ease: "easeOut" }}
                >
                  <img
                    src={track.artwork || "/icon-track.png"}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                </motion.div>
                <div className="text-center space-y-0.5 px-4 w-full mt-1">
                  <p className="text-lg font-semibold text-white line-clamp-1">{track.title}</p>
                  <p className="text-[13px] text-white/60 line-clamp-1">{track.artist}</p>
                </div>
              </div>

              {/* Аудиодорожка — по центру между названием и кнопками */}
              <div className="flex-1 flex items-center justify-center min-h-0 py-4">
                <div className="w-full -mx-2">
                  <WaveformSeekBar
                    trackId={track.id}
                    currentTime={currentTime}
                    duration={duration}
                    onSeekStart={onWaveSeekStart}
                    onSeekMove={onWaveSeekMove}
                    onSeekEnd={onWaveSeekEnd}
                  />
                </div>
              </div>

              {/* Кнопки воспроизведения — голубой accent как у mini */}
              <div className="flex flex-col items-center shrink-0 pb-1" style={{ gap: 4 }}>
                <div className="flex items-center justify-center gap-7">
                  <button
                    className="p-5 rounded-full bg-transparent active:opacity-80 border-0 touch-manipulation select-none"
                    style={ACCENT_STYLE}
                    onClick={onPrev}
                    type="button"
                  >
                    <SkipBack className="h-9 w-9" color="rgb(var(--accent))" />
                  </button>
                  <button
                    className="h-24 w-24 rounded-full bg-transparent flex items-center justify-center active:opacity-80 border-0 touch-manipulation select-none"
                    style={ACCENT_STYLE}
                    onClick={isBuffering ? undefined : onToggle}
                    type="button"
                  >
                    {isBuffering ? (
                      <span className="loader-spin block">
                        <Loader2 className="h-12 w-12" color="rgb(var(--accent))" />
                      </span>
                    ) : isPlaying ? (
                      <Pause className="h-12 w-12" color="rgb(var(--accent))" />
                    ) : (
                      <Play className="h-12 w-12 ml-0.5" color="rgb(var(--accent))" />
                    )}
                  </button>
                  <button
                    className="p-5 rounded-full bg-transparent active:opacity-80 border-0 touch-manipulation select-none"
                    style={ACCENT_STYLE}
                    onClick={onNext}
                    type="button"
                  >
                    <SkipForward className="h-9 w-9" color="rgb(var(--accent))" />
                  </button>
                </div>

                {/* Кнопка Добавить — как была: отдельная строка, pill с иконкой и текстом */}
                {isLoggedIn && track && (
                  <div className="flex items-center justify-center">
                    {isInPlaylist && onRemove ? (
                      <button
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 text-white text-[13px] font-medium active:bg-white/25 border-0 touch-manipulation select-none"
                        onClick={() => onRemove(track)}
                        type="button"
                        title="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                        Удалить
                      </button>
                    ) : onAddAndSend ? (
                      <button
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 text-white text-[13px] font-medium active:bg-white/25 border-0 touch-manipulation select-none"
                        onClick={() => onAddAndSend(track)}
                        type="button"
                        title="Добавить"
                      >
                        <Send className="h-4 w-4" />
                        Добавить
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return createPortal(player, document.body);
};
