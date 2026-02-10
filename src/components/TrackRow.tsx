import { useState } from "react";
import { Send, Trash2 } from "lucide-react";
import type { Track } from "../types";

type TrackRowProps = {
  track: Track;
  onSelect: (track: Track) => void;
  onAddAndSend?: (track: Track) => void | Promise<void>;
  onRemove?: (track: Track) => void;
  isLoggedIn?: boolean;
};

export const TrackRow = ({ track, onSelect, onAddAndSend, onRemove, isLoggedIn }: TrackRowProps) => {
  const [busy, setBusy] = useState(false);

  const onBookmarkClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onAddAndSend || busy) return;
    setBusy(true);
    try {
      await onAddAndSend(track);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      className="w-full flex items-center gap-3 p-3 rounded-2xl active:bg-white/30 dark:active:bg-white/5 transition-colors text-left"
      onClick={() => onSelect(track)}
      type="button"
    >
      <div className="h-12 w-12 shrink-0 rounded-2xl overflow-hidden flex items-center justify-center track-cover shadow-md">
        {track.artwork ? (
          <img
            src={track.artwork}
            alt={`${track.title} cover`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <img src="/icon-track.png" alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-semibold text-text line-clamp-1">{track.title}</p>
        <p className="text-[12px] text-text-muted line-clamp-1 mt-0.5">{track.artist}</p>
      </div>
      <div className="flex items-center shrink-0 gap-0.5">
        {isLoggedIn && onAddAndSend ? (
          <span
            role="button"
            tabIndex={0}
            className={`p-2.5 rounded-xl active:bg-white/40 dark:active:bg-white/10 ${busy ? "opacity-60 pointer-events-none" : ""}`}
            onClick={onBookmarkClick}
            title="Добавить"
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onBookmarkClick(e as unknown as React.MouseEvent); } }}
          >
            <Send className="h-[18px] w-[18px] text-text-muted" />
          </span>
        ) : null}
        {onRemove ? (
          <span
            className="p-2.5 rounded-xl active:bg-white/40 dark:active:bg-white/10"
            onClick={(e) => { e.stopPropagation(); onRemove(track); }}
          >
            <Trash2 className="h-[18px] w-[18px] text-text-muted" />
          </span>
        ) : null}
      </div>
    </button>
  );
};
