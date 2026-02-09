import Dexie, { type Table } from "dexie";
import type { Track } from "../types";

class PlayerDatabase extends Dexie {
  tracks!: Table<Track, string>;

  constructor() {
    super("telegramMusicPlayer");
    this.version(1).stores({
      tracks: "id, title, artist"
    });
  }
}

export const db = new PlayerDatabase();
