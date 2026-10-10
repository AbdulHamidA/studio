import { forwardRef } from "react";
import {
  GROUPS, SHELVES, SORTS, type GroupKey, type LibraryFilter, type Shelf, type SortKey,
} from "../../lib/library";

/**
 * Search, shelves, model, order, grouping and size.
 *
 * Shelves are chips rather than a dropdown, with their counts on them: a
 * dropdown hid what the vault held until you opened it, and offered shelves
 * with nothing on them. A shelf with nothing on it is not offered.
 */
const LibraryToolbar = forwardRef<HTMLInputElement, {
  filter: LibraryFilter;
  onFilter: (f: LibraryFilter) => void;
  shelfCounts: Record<Shelf, number>;
  favoriteCount: number;
  total: number;
  models: [string, number][];
  sort: SortKey;
  onSort: (s: SortKey) => void;
  group: GroupKey;
  onGroup: (g: GroupKey) => void;
  size: number;
  onSize: (n: number) => void;
}>(function LibraryToolbar(p, searchRef) {
  const { filter, onFilter } = p;
  const set = (over: Partial<LibraryFilter>) => onFilter({ ...filter, ...over });
  return (
    <div className="lib-toolbar">
      <div className="lib-toolbar-row">
        <div className="lib-search">
          <span aria-hidden>⌕</span>
          <input
            ref={searchRef}
            type="text"
            value={filter.query}
            placeholder="Search prompts, names, models, boards"
            aria-label="Search the vault"
            onChange={(e) => set({ query: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Escape" && filter.query) { e.stopPropagation(); set({ query: "" }); } }}
          />
          {filter.query && (
            <button className="link-btn" onClick={() => set({ query: "" })} aria-label="Clear search">✕</button>
          )}
        </div>
        {p.models.length > 1 && (
          <select value={filter.model} onChange={(e) => set({ model: e.target.value })}
                  aria-label="Filter by model" className="lib-select">
            <option value="">All models</option>
            {p.models.map(([m, n]) => <option key={m} value={m}>{m} ({n})</option>)}
          </select>
        )}
        <select value={p.sort} onChange={(e) => p.onSort(e.target.value as SortKey)}
                aria-label="Sort" className="lib-select">
          {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select value={p.group} onChange={(e) => p.onGroup(e.target.value as GroupKey)}
                aria-label="Group" className="lib-select">
          {GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <label className="lib-size" title="Thumbnail size">
          <span aria-hidden>▫</span>
          <input type="range" min={110} max={360} step={10} value={p.size}
                 onChange={(e) => p.onSize(Number(e.target.value))} aria-label="Thumbnail size" />
          <span aria-hidden>◻</span>
        </label>
      </div>
      <div className="lib-chips" role="toolbar" aria-label="Show">
        <button className={"chip" + (filter.shelf === "all" && !filter.favorites ? " on" : "")}
                aria-pressed={filter.shelf === "all" && !filter.favorites}
                onClick={() => set({ shelf: "all", favorites: false })}>
          Everything <span className="n">{p.total}</span>
        </button>
        {p.favoriteCount > 0 && (
          <button className={"chip" + (filter.favorites ? " on" : "")} aria-pressed={filter.favorites}
                  onClick={() => set({ favorites: !filter.favorites })}>
            ★ Favourites <span className="n">{p.favoriteCount}</span>
          </button>
        )}
        {SHELVES.filter(([s]) => p.shelfCounts[s] > 0 || filter.shelf === s).map(([s, label]) => (
          <button key={s} className={"chip" + (filter.shelf === s ? " on" : "")}
                  aria-pressed={filter.shelf === s}
                  onClick={() => set({ shelf: filter.shelf === s ? "all" : s })}>
            {label} <span className="n">{p.shelfCounts[s]}</span>
          </button>
        ))}
      </div>
    </div>
  );
});

export default LibraryToolbar;
