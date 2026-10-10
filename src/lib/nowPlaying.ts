import { createContext, useContext } from "react";

/**
 * The one recording playing across the whole app.
 *
 * A player inside a tab or the viewer stopped the moment you went anywhere
 * else, so listening to a chapter meant not touching the rest of the app.
 * This one lives in the shell and keeps playing while you work.
 */
export interface Track {
  src: string;
  title: string;
  markers?: { time: number; label: string }[];
}

export const NowPlaying = createContext<{
  track: Track | null;
  play: (track: Track) => void;
  stop: () => void;
}>({ track: null, play: () => {}, stop: () => {} });

export const useNowPlaying = () => useContext(NowPlaying);
