import { AnimatePresence, motion } from "framer-motion";
import { Bookmark, ChevronDown, Loader2, Pause, Play, Send, SkipBack, SkipForward } from "lucide-react";
import type { Track } from "../types";
import { formatTime } from "../lib/format";

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
  onSaveToPlaylist?: (track: Track) => void;
  onSendToBot?: (track: Track) => void;
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
  onSaveToPlaylist,
  onSendToBot,
  isLoggedIn,
}: FullPlayerProps) => {
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
            <div className="relative z-10 flex flex-col h-full px-5 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              {/* Header bar */}
              <div className="flex items-center justify-between mb-2">
                <button
                  className="p-2 -ml-2 rounded-full active:bg-white/20"
                  onClick={onClose}
                  type="button"
                >
                  <ChevronDown className="h-6 w-6 text-white/80" />
                </button>
                <div className="text-[11px] text-white/50 font-medium uppercase tracking-wider">TGPlayer</div>
                <div className="w-10" />
              </div>

              {/* Album art + info — flexible area */}
              <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-0">
                <motion.div
                  className="w-[55vw] max-w-[240px] aspect-square rounded-[24px] overflow-hidden shadow-2xl"
                  animate={{ scale: isPlaying ? 1.02 : 0.96 }}
                  transition={{ duration: 0.5 }}
                >
                  {track.artwork ? (
                    <img
                      src={track.artwork}
                      alt={`${track.title} cover`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full track-cover" />
                  )}
                </motion.div>
                <div className="text-center space-y-0.5 px-4 w-full">
                  <p className="text-lg font-semibold text-white line-clamp-1">{track.title}</p>
                  <p className="text-[13px] text-white/60 line-clamp-1">{track.artist}</p>
                </div>
              </div>

              {/* Controls area — fixed at bottom */}
              <div className="space-y-3 shrink-0">
                {/* Seek bar */}
                <div className="space-y-1">
                  <input
                    type="range"
                    min={0}
                    max={Math.max(duration, 1)}
                    step={0.1}
                    value={Math.min(currentTime, duration || Infinity)}
                    onChange={(event) => onSeek(Number(event.target.value))}
                    className="w-full"
                  />
                  <div className="flex items-center justify-between text-[11px] text-white/40 font-medium">
                    <span>{formatTime(Math.min(currentTime, duration || Infinity))}</span>
                    <span>{formatTime(duration)}</span>
                  </div>
                </div>

                {/* Play controls */}
                <div className="flex items-center justify-center gap-8">
                  <button
                    className="p-3 rounded-full active:bg-white/10"
                    onClick={onPrev}
                    type="button"
                  >
                    <SkipBack className="h-6 w-6 text-white/80" />
                  </button>
                  <button
                    className="h-16 w-16 rounded-full bg-white text-[#0088cc] flex items-center justify-center shadow-lg"
                    onClick={isBuffering ? undefined : onToggle}
                    type="button"
                  >
                    {isBuffering ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : isPlaying ? (
                      <Pause className="h-7 w-7" />
                    ) : (
                      <Play className="h-7 w-7 ml-0.5" />
                    )}
                  </button>
                  <button
                    className="p-3 rounded-full active:bg-white/10"
                    onClick={onNext}
                    type="button"
                  >
                    <SkipForward className="h-6 w-6 text-white/80" />
                  </button>
                </div>

                {/* Save / Send buttons */}
                {isLoggedIn && (
                  <div className="flex items-center justify-center gap-3 pb-1">
                    {onSaveToPlaylist && (
                      <button
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/15 text-white text-[13px] font-medium active:bg-white/25 transition"
                        onClick={() => onSaveToPlaylist(track)}
                        type="button"
                      >
                        <Bookmark className="h-3.5 w-3.5" />
                        Сохранить
                      </button>
                    )}
                    {onSendToBot && (
                      <button
                        className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#0088cc] text-white text-[13px] font-medium active:bg-[#006daa] transition"
                        onClick={() => onSendToBot(track)}
                        type="button"
                      >
                        <Send className="h-3.5 w-3.5" />
                        В Telegram
                      </button>
                    )}
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
