import { motion, useMotionValue, useTransform, AnimatePresence } from "framer-motion";
import { Loader2, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import type { Track } from "../types";

type MiniPlayerProps = {
  track: Track | null;
  isPlaying: boolean;
  isBuffering?: boolean;
  onToggle: () => void;
  onNext: () => void;
  onPrev: () => void;
  onOpen: () => void;
  onClose: () => void;
};

export const MiniPlayer = ({
  track,
  isPlaying,
  isBuffering,
  onToggle,
  onNext,
  onPrev,
  onOpen,
  onClose,
}: MiniPlayerProps) => {
  const y = useMotionValue(0);
  const opacity = useTransform(y, [0, 120], [1, 0]);

  const PlayIcon = isBuffering
    ? () => <Loader2 className="h-5 w-5 animate-spin" />
    : isPlaying
      ? () => <Pause className="h-5 w-5" />
      : () => <Play className="h-5 w-5" />;

  return (
    <AnimatePresence>
      {track ? (
        <motion.div
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(8px,env(safe-area-inset-bottom))]"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 120, opacity: 0 }}
          transition={{ type: "spring", damping: 24, stiffness: 260 }}
          style={{ y, opacity }}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={0.6}
          onDragEnd={(_e, info) => {
            if (info.offset.y > 60 || info.velocity.y > 300) onClose();
          }}
        >
          <div className="glass rounded-3xl shadow-card px-4 py-3 flex items-center gap-3">
            <button
              className="flex items-center gap-2.5 flex-1 min-w-0 touch-manipulation select-none"
              onClick={onOpen}
              type="button"
            >
              <div className="h-11 w-11 shrink-0 rounded-2xl overflow-hidden track-cover shadow-md">
                <img
                  src={track.artwork || "/icon-track.png"}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="text-left min-w-0">
                <p className="text-[13px] font-semibold line-clamp-1">{track.title}</p>
                <p className="text-[11px] text-text-muted line-clamp-1">{track.artist}</p>
              </div>
            </button>
            <div className="flex items-center shrink-0 gap-0.5">
              <button className="p-2 rounded-full active:opacity-80 text-accent touch-manipulation select-none" onClick={onPrev} type="button">
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                className="h-11 w-11 rounded-full bg-transparent text-accent flex items-center justify-center active:opacity-80 touch-manipulation select-none"
                onClick={isBuffering ? undefined : onToggle}
                type="button"
              >
                <PlayIcon />
              </button>
              <button className="p-2 rounded-full active:opacity-80 text-accent touch-manipulation select-none" onClick={onNext} type="button">
                <SkipForward className="h-5 w-5" />
              </button>
              <button className="p-2 rounded-full active:opacity-80 ml-0.5 text-text-muted touch-manipulation select-none" onClick={onClose} type="button">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
};
