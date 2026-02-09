export type Track = {
  id: string;
  title: string;
  artist: string;
  artwork?: string | null;
  duration?: number;
};

export type SearchResponse =
  | Track[]
  | {
      tracks?: Track[];
      items?: Track[];
      results?: Track[];
    };
