import { Bookmark, Music2, Send, Trash2 } from "lucide-react";
import type { Track } from "../types";

type TrackRowProps = {
  track: Track;
  onSelect: (track: Track) => void;
  onAdd?: (track: Track) => void;
  onRemove?: (track: Track) => void;
  onSendToBot?: (track: Track) => void;
  isLoggedIn?: boolean;
};

export const TrackRow = ({ track, onSelect, onAdd, onRemove, onSendToBot, isLoggedIn }: TrackRowProps) => {
  return (
    <button
      className="w-full flex items-center gap-2.5 p-2 rounded-xl active:bg-white/40 dark:active:bg-white/5 transition-colors"
      onClick={() => onSelect(track)}
      type="button"
    >
      <div className="h-11 w-11 shrink-0 rounded-xl overflow-hidden flex items-center justify-center track-cover">
        {track.artwork ? (
          <img
            src={track.artwork}
            alt={`${track.title} cover`}
            className="h-full w-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <Music2 className="h-5 w-5 text-white/90" />
        )}
      </div>
      <div className="flex-1 text-left min-w-0">
        <p className="text-[14px] font-semibold text-text line-clamp-1">{track.title}</p>
        <p className="text-[12px] text-text-muted line-clamp-1">{track.artist}</p>
      </div>
      <div className="flex items-center shrink-0">
        {onAdd && isLoggedIn ? (
          <span
            className="p-2 rounded-full active:bg-white/50 dark:active:bg-white/10"
            onClick={(e) => { e.stopPropagation(); onAdd(track); }}
          >
            <Bookmark className="h-[18px] w-[18px] text-text-muted" />
          </span>
        ) : null}
        {onRemove ? (
          <span
            className="p-2 rounded-full active:bg-white/50 dark:active:bg-white/10"
            onClick={(e) => { e.stopPropagation(); onRemove(track); }}
          >
            <Trash2 className="h-[18px] w-[18px] text-text-muted" />
          </span>
        ) : null}
        {onSendToBot && isLoggedIn ? (
          <span
            className="p-2 rounded-full active:bg-white/50 dark:active:bg-white/10"
            onClick={(e) => { e.stopPropagation(); onSendToBot(track); }}
          >
            <Send className="h-[18px] w-[18px] text-text-muted" />
          </span>
        ) : null}
      </div>
    </button>
  );
};
