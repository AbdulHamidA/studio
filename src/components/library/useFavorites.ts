import { useCallback, useState } from "react";
import { loadPref, savePref } from "../../lib/prefs";

/**
 * Starred items, by id.
 *
 * The vault has no field for this and adding one means a schema change on the
 * Rust side for what is an interface preference, so it lives with the other
 * preferences. An id says nothing about what the picture shows, which keeps
 * localStorage free of vault content. A star on an item that has since been
 * deleted is harmless: it matches nothing.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(
    () => new Set(loadPref<string[]>("library.favorites", [])));
  const toggle = useCallback((ids: string[], on?: boolean) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      const add = on ?? !ids.every((id) => prev.has(id));
      for (const id of ids) if (add) next.add(id); else next.delete(id);
      savePref("library.favorites", [...next]);
      return next;
    });
  }, []);
  return { favorites, toggleFavorite: toggle };
}
