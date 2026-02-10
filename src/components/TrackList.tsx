import type { Track } from "../types";
import { TrackRow } from "./TrackRow";

type TrackListProps = {
  title: string;
  tracks: Track[];
  onSelect: (track: Track) => void;
  onAddAndSend?: (track: Track) => void | Promise<void>;
  onRemove?: (track: Track) => void;
  isLoggedIn?: boolean;
};

export const TrackList = ({ title, tracks, onSelect, onAddAndSend, onRemove, isLoggedIn }: TrackListProps) => {
  if (tracks.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-0.5">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">{title}</h2>
        <span className="text-[11px] text-text-muted tabular-nums">{tracks.length}</span>
      </div>
      <div className="glass rounded-3xl p-2 space-y-1.5 shadow-card">
        {tracks.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            onSelect={onSelect}
            onAddAndSend={onAddAndSend}
            onRemove={onRemove}
            isLoggedIn={isLoggedIn}
          />
        ))}
      </div>
    </section>
  );
};
