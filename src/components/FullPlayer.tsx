import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Loader2, Pause, Play, Send, SkipBack, SkipForward } from "lucide-react";
import { useCallback, useState } from "react";
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
  isLoggedIn?: boolean;
};

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
  isLoggedIn,
}: FullPlayerProps) => {
  const [dragging, setDragging] = useState(false);
  const [dragTime, setDragTime] = useState(0);
  const displayTime = dragging ? dragTime : currentTime;

  const onWaveSeekStart = useCallback(() => {
    setDragging(true);
    setDragTime(currentTime);
  }, [currentTime]);

  const onWaveSeekMove = useCallback((time: number) => {
    setDragTime(time);
  }, []);

  const onWaveSeekEnd = useCallback((time: number) => {
    setDragging(false);
    setDragTime(time);
    onSeek(time);
  }, [onSeek]);

  if (!track) return null;

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col bg-black/40 backdrop-blur-2xl"
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 28, stiffness: 300 }}
        >
          <div className="relative flex-1 overflow-hidden flex flex-col">
            {/* Background blur art */}
            <div
              className="absolute inset-0 opacity-50 blur-3xl scale-110"
              style={{
                backgroundImage: track.artwork
                  ? `url(${track.artwork})`
                  : "linear-gradient(135deg, rgba(0,136,204,0.4), rgba(0,102,153,0.4))",
                backgroundSize: "cover",
                backgroundPosition: "center"
              }}
            />

            {/* Content */}
            <div className="relative z-10 flex flex-col h-full px-5 pt-1 pb-[max(12px,env(safe-area-inset-bottom))]">
              {/* Header bar */}
              <div className="flex items-center justify-between mb-1">
                <button
                  className="p-2 -ml-2 rounded-full bg-transparent text-white/80 active:opacity-70 transition border-0"
                  onClick={onClose}
                  type="button"
                >
                  <ChevronDown className="h-6 w-6" />
                </button>
                <div className="text-[11px] text-white/50 font-medium uppercase tracking-[0.15em]">TGPlay</div>
                <div className="w-10" />
              </div>

              {/* Обложка и название/исполнитель вплотную к обложке; пустой блок отталкивает дорожку вниз */}
              <div className="flex flex-col items-center flex-shrink-0">
                <motion.div
                  className="w-[min(82vw,320px)] aspect-square rounded-3xl overflow-hidden shadow-2xl"
                  animate={{ scale: isPlaying ? 1.02 : 0.96 }}
                  transition={{ duration: 0.5 }}
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
              <div className="flex-1 min-h-4" aria-hidden />

              {/* Controls area — fixed at bottom */}
              <div className="space-y-3 shrink-0">
                {/* SoundCloud-style waveform seek bar */}
                <div className="space-y-1">
                  <WaveformSeekBar
                    trackId={track.id}
                    currentTime={displayTime}
                    duration={duration}
                    onSeekStart={onWaveSeekStart}
                    onSeekMove={onWaveSeekMove}
                    onSeekEnd={onWaveSeekEnd}
                  />
                </div>

                {/* Play controls — без фона (только «Добавить» с фоном) */}
                <div className="flex items-center justify-center gap-8">
                  <button
                    className="p-4 rounded-full bg-transparent text-white active:opacity-70 transition border-0"
                    onClick={onPrev}
                    type="button"
                  >
                    <SkipBack className="h-8 w-8" />
                  </button>
                  <button
                    className="h-20 w-20 rounded-full bg-transparent text-white flex items-center justify-center active:opacity-70 transition border-0"
                    onClick={isBuffering ? undefined : onToggle}
                    type="button"
                  >
                    {isBuffering ? (
                      <Loader2 className="h-10 w-10 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="h-10 w-10" />
                    ) : (
                      <Play className="h-10 w-10 ml-0.5" />
                    )}
                  </button>
                  <button
                    className="p-4 rounded-full bg-transparent text-white active:opacity-70 transition border-0"
                    onClick={onNext}
                    type="button"
                  >
                    <SkipForward className="h-8 w-8" />
                  </button>
                </div>

                {/* Одна кнопка: в плейлист + в облако (чат бота) */}
                {isLoggedIn && onAddAndSend && track && (
                  <div className="flex items-center justify-center pb-1">
                    <button
                      className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 text-white text-[13px] font-medium active:bg-white/25 transition"
                      onClick={() => onAddAndSend(track)}
                      type="button"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Добавить
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
