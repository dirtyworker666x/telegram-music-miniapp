import type { Track } from "../types";
import { TrackRow } from "./TrackRow";

type TrackListProps = {
  title: string;
  tracks: Track[];
  onSelect: (track: Track) => void;
  onAdd?: (track: Track) => void;
  onRemove?: (track: Track) => void;
  onSendToBot?: (track: Track) => void;
  isLoggedIn?: boolean;
};

export const TrackList = ({ title, tracks, onSelect, onAdd, onRemove, onSendToBot, isLoggedIn }: TrackListProps) => {
  if (tracks.length === 0) {
    return null;
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[11px] text-text-muted">{tracks.length} треков</p>
      </div>
      <div className="glass rounded-2xl p-1.5 space-y-0.5">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            onSelect={onSelect}
            onAdd={onAdd}
            onRemove={onRemove}
            onSendToBot={onSendToBot}
            isLoggedIn={isLoggedIn}
          />
        ))}
      </div>
    </section>
  );
};
