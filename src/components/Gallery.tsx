import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fmtBytes } from "../lib/api";
import type { ModelStatus, VaultItem } from "../lib/types";
import { savedBoardIds } from "../lib/boardDraft";
import {
  applyPick, browsable, buildEntries, expandPicked, filterItems, isBoard, isFiltered,
  modelCounts, NO_FILTER, projectOrder, sectionize, shelfCounts, SHELVES, sortEntries,
  type GroupKey, type LibraryEntry, type LibraryFilter, type Section, type SortKey,
} from "../lib/library";
import { loadPref, savePref } from "../lib/prefs";
import { exportItem, exportMany } from "./shared";
import SendTo, { type Destination } from "./SendTo";
import LibraryGrid from "./library/LibraryGrid";
import LibraryToolbar from "./library/LibraryToolbar";
import Viewer from "./library/Viewer";
import BoardView from "./library/BoardView";
import { useFavorites } from "./library/useFavorites";

/** How long a delete can be taken back before it reaches the vault. */
export const UNDO_MS = 7000;

/**
 * What the viewer is walking through.
 *
 * Ids rather than items, so a refresh of the library underneath does not
 * leave the viewer holding stale copies; and the current id together with
 * where it was, so deleting the item on screen lands on its neighbour instead
 * of closing the viewer.
 */
interface ViewerState {
  ids: string[];
  current: string;
  at: number;
  reader?: { title: string };
  /** The view this one was opened from, for a detour through an item's history. */
  back?: ViewerState;
}

export default function Gallery({
  items, onChanged, notify, send, models, onReuse, onOpenBoard, loading, loadError, active = true,
}: {
  /** The Vault is the tab on screen; it stays mounted while hidden. */
  active?: boolean;
  items: VaultItem[];
  onChanged: () => void | Promise<void>;
  notify: (m: string, bad?: boolean) => void;
  /** Reuse a stored item anywhere else, without exporting it first. */
  send?: (dest: Destination, ids: string[]) => void;
  models: ModelStatus[];
  /** Load this run's settings back into the tab that produced it. */
  onReuse?: (item: VaultItem, reuseSeed: boolean) => void;
  /** Reopen a comic in the Board, by project id. */
  onOpenBoard?: (project: string) => void;
  /** The first listing has not arrived yet. */
  loading?: boolean;
  /** The last listing failed, and why. */
  loadError?: string | null;
}) {
  const [filter, setFilter] = useState<LibraryFilter>(NO_FILTER);
  const [sort, setSort] = useState<SortKey>(() => loadPref("library.sort", "newest"));
  const [group, setGroup] = useState<GroupKey>(() => loadPref("library.group", "date"));
  const [size, setSize] = useState<number>(() => loadPref("library.size", 200));
  useEffect(() => savePref("library.sort", sort), [sort]);
  useEffect(() => savePref("library.group", group), [group]);
  useEffect(() => savePref("library.size", size), [size]);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [board, setBoard] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const { favorites, toggleFavorite } = useFavorites();
  const search = useRef<HTMLInputElement>(null);
  const libraryEl = useRef<HTMLDivElement>(null);
  /**
   * Where the grid was when a comic was opened over it: which tile, and how
   * far down the page. Back puts both back, so leaving a comic lands on the
   * card that opened it rather than at the top of a vault of hundreds
   * (WCAG 2.4.3).
   */
  const returnTo = useRef<{ id: string; scroller: Element | null; top: number } | null>(null);

  /** Which comics kept their story, so the board page knows what it can offer. */
  const [reopenable, setReopenable] = useState<Set<string>>(new Set());
  useEffect(() => { void savedBoardIds().then(setReopenable); }, [items]);

  /* ---------- deleting, with a way back ---------- */

  // A delete is held back for a few seconds before it reaches the vault, and
  // the items are hidden meanwhile. The vault is the only copy and has no
  // bin, so the undo has to happen before the delete rather than after it.
  // Anything still waiting when the library closes is deleted then: leaving
  // the tab is not changing your mind.
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undoable, setUndoable] = useState<VaultItem[] | null>(null);
  const pending = useRef<{ items: VaultItem[]; timer: number } | null>(null);
  const latest = useRef({ onChanged, notify });
  latest.current = { onChanged, notify };

  const commit = useCallback(async (batch: VaultItem[]) => {
    let failed = 0;
    for (const it of batch) {
      try { await api.vaultDelete(it.id); } catch { failed++; }
    }
    try { await latest.current.onChanged(); } finally {
      setHidden((h) => {
        const next = new Set(h);
        for (const it of batch) next.delete(it.id);
        return next;
      });
    }
    if (failed) {
      latest.current.notify(
        `Deleted ${batch.length - failed} of ${batch.length}; ${failed} could not be removed.`, true);
    }
  }, []);

  const flush = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current = null;
    setUndoable(null);
    void commit(p.items);
  }, [commit]);

  useEffect(() => flush, [flush]);

  const remove = useCallback((batch: VaultItem[]) => {
    if (!batch.length) return;
    flush();
    setHidden((h) => new Set([...h, ...batch.map((i) => i.id)]));
    const timer = window.setTimeout(flush, UNDO_MS);
    pending.current = { items: batch, timer };
    setUndoable(batch);
    setPicked(new Set()); setAnchor(null);
  }, [flush]);

  const undo = useCallback(() => {
    const p = pending.current;
    if (!p) return;
    window.clearTimeout(p.timer);
    pending.current = null;
    setUndoable(null);
    setHidden((h) => {
      const next = new Set(h);
      for (const it of p.items) next.delete(it.id);
      return next;
    });
  }, []);

  /* ---------- what is shown ---------- */

  const all = useMemo(() => items.filter((i) => !hidden.has(i.id)), [items, hidden]);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  const library = useMemo(() => browsable(all), [all]);
  const filtered = useMemo(() => filterItems(library, filter, favorites), [library, filter, favorites]);
  const sections = useMemo(
    () => sectionize(sortEntries(buildEntries(filtered), sort), group),
    [filtered, sort, group]);
  const visible = useMemo(() => sections.flatMap((s) => s.entries), [sections]);
  const order = useMemo(() => visible.map((e) => e.item.id), [visible]);
  const boardHeads = useMemo(
    () => new Set(visible.filter(isBoard).map((e) => e.item.id)), [visible]);
  const counts = useMemo(() => shelfCounts(library), [library]);
  const modelList = useMemo(() => modelCounts(library), [library]);
  const totalCards = useMemo(() => buildEntries(library).length, [library]);
  const favoriteCount = useMemo(
    () => library.filter((i) => favorites.has(i.id)).length, [library, favorites]);

  /* ---------- selection ---------- */

  const clearPicks = useCallback(() => { setPicked(new Set()); setAnchor(null); }, []);

  const togglePick = useCallback((entry: LibraryEntry, range: boolean) => {
    setPicked((prev) => applyPick(prev, order, entry.item.id, anchor, range));
    setAnchor(entry.item.id);
  }, [order, anchor]);

  const pickSection = useCallback((section: Section) => {
    setPicked((prev) => {
      const next = new Set(prev);
      const ids = section.entries.map((e) => e.item.id);
      const every = ids.every((id) => next.has(id));
      for (const id of ids) if (every) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const chosen = useMemo(() => expandPicked(picked, all, boardHeads), [picked, all, boardHeads]);

  /* ---------- opening ---------- */

  const openEntry = useCallback((entry: LibraryEntry) => {
    if (isBoard(entry) && entry.item.project) {
      const scroller = scrollParent(libraryEl.current);
      returnTo.current = { id: entry.item.id, scroller, top: scroller?.scrollTop ?? 0 };
      setBoard(entry.item.project);
      return;
    }
    // Walk the grid in the order shown. Boards are not in the walk: they open
    // as a comic of their own, and stepping into one from a picture would
    // swap the viewer's meaning halfway through.
    const ids = visible.filter((e) => !isBoard(e)).map((e) => e.item.id);
    setViewer({ ids, current: entry.item.id, at: Math.max(0, ids.indexOf(entry.item.id)) });
  }, [visible]);

  const viewList = useMemo(
    () => (viewer ? viewer.ids.map((id) => byId.get(id)).filter((i): i is VaultItem => !!i) : []),
    [viewer, byId]);
  const viewIndex = viewer
    ? (() => {
        const at = viewList.findIndex((i) => i.id === viewer.current);
        return at >= 0 ? at : Math.min(viewer.at, viewList.length - 1);
      })()
    : -1;
  useEffect(() => {
    if (viewer && viewList.length === 0) setViewer(viewer.back ?? null);
  }, [viewer, viewList.length]);

  const boardMembers = useMemo(
    () => (board ? all.filter((i) => i.project === board && i.kind !== "mask").sort(projectOrder) : []),
    [board, all]);
  useEffect(() => { if (board && boardMembers.length === 0) setBoard(null); }, [board, boardMembers.length]);

  // Back from a comic: the grid was kept mounted underneath, so its rows and
  // tiles are all still there to scroll to and focus.
  useEffect(() => {
    if (board) return;
    const back = returnTo.current;
    if (!back) return;
    returnTo.current = null;
    if (back.scroller) back.scroller.scrollTop = back.top;
    const tile = [...(libraryEl.current?.querySelectorAll<HTMLElement>(".tile-open") ?? [])]
      .find((el) => el.dataset.id === back.id);
    tile?.focus({ preventScroll: true });
  }, [board]);

  /* ---------- keys on the grid ---------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (viewer) return; // the viewer has its own
      const t = e.target as HTMLElement;
      const typing = t.tagName === "INPUT" && (t as HTMLInputElement).type !== "range"
        || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
      // Escape clears a selection the way it does everywhere else.
      if (e.key === "Escape") { clearPicks(); return; }
      if (typing || board) return;
      if (e.key === "a" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPicked(new Set(order));
      } else if (e.key === "/" || (e.key === "f" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        search.current?.focus();
      } else if ((e.key === "Backspace" && e.metaKey) || e.key === "Delete") {
        if (chosen.length) { e.preventDefault(); remove(chosen); }
      }
    };
    if (!active) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer, board, order, chosen, clearPicks, remove, active]);

  const exportPicked = async () => {
    setBusy(true);
    try { await exportMany(chosen, notify); clearPicks(); }
    finally { setBusy(false); }
  };

  const deleteBoard = async (members: VaultItem[]) => {
    let failed = 0;
    for (const it of members) {
      try { await api.vaultDelete(it.id); } catch { failed++; }
    }
    setBoard(null);
    await onChanged();
    notify(failed
      ? `Deleted ${members.length - failed} of ${members.length}.`
      : `Deleted the board and all ${members.length} pictures.`,
      failed > 0);
  };

  const undoBar = undoable && (
    <div className="undo-bar" role="status">
      <span>
        {undoable.length === 1
          ? `Deleted “${(undoable[0].prompt || undoable[0].name).slice(0, 48)}”.`
          : `Deleted ${undoable.length} items.`}
      </span>
      <button className="btn small" onClick={undo}>Undo</button>
      <button className="link-btn" onClick={flush} aria-label="Dismiss">✕</button>
    </div>
  );

  const viewerEl = viewer && viewIndex >= 0 && (
    <Viewer
      active={active}
      items={viewList}
      index={viewIndex}
      onIndex={(i) => setViewer((v) => (v ? { ...v, current: viewList[i].id, at: i } : v))}
      onClose={() => setViewer(null)}
      reader={viewer.reader}
      all={all}
      onOpenItem={(target) => setViewer((v) => ({ ids: [target.id], current: target.id, at: 0, back: v ?? undefined }))}
      onBack={viewer.back ? () => setViewer(viewer.back ?? null) : undefined}
      favorites={favorites}
      onToggleFavorite={(ids) => toggleFavorite(ids)}
      onDelete={remove}
      onExport={(it) => void exportItem(it, notify)}
      onOpenBoard={board ? undefined : (project) => { setViewer(null); setBoard(project); }}
      send={send}
      models={models}
      onReuse={onReuse}
      notify={notify}
      onChanged={() => void onChanged()}
      onAdjusted={(id) => setViewer((v) => {
        if (!v) return v;
        const at = v.ids.indexOf(v.current);
        const ids = [...v.ids];
        ids.splice(at + 1, 0, id);
        return { ...v, ids, current: id };
      })}
    />
  );

  /* ---------- screens ---------- */

  if (loadError && items.length === 0) {
    return (
      <div className="empty-state">
        <span className="big">⚠</span>
        The vault could not be listed.
        <div className="empty-detail">{loadError}</div>
        <button className="btn small" onClick={() => void onChanged()}>Try again</button>
      </div>
    );
  }

  if (loading && items.length === 0) {
    return (
      <div className="lib-loading" aria-busy="true" aria-label="Opening the vault">
        {Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton" />)}
      </div>
    );
  }

  if (library.length === 0) {
    return (
      <>
        <div className="empty-state">
          <span className="big">▦</span>
          The vault is empty.
          <div className="empty-detail">
            Anything you generate, edit, animate, narrate or import is sealed
            here automatically.
          </div>
        </div>
        {undoBar}
      </>
    );
  }

  const shelfName = SHELVES.find(([s]) => s === filter.shelf)?.[1];
  const bytes = filtered.reduce((n, i) => n + i.bytes, 0);

  const comic = board && boardMembers.length > 0;

  // The grid stays mounted while a comic is open, hidden rather than
  // replaced. Unmounting it threw away its scroll position and the tile that
  // had focus, so Back always landed at the top of the vault.
  return (
    <>
    {comic && (
      <BoardView
        members={boardMembers}
        onBack={() => setBoard(null)}
        onRead={(pages, index, title) => setViewer({
          ids: pages.map((p) => p.id), current: pages[index].id, at: index, reader: { title },
        })}
        onView={(list, index) => setViewer({
          ids: list.map((p) => p.id), current: list[index].id, at: index,
        })}
        onChanged={() => void onChanged()}
        notify={notify}
        send={send}
        models={models}
        onOpenBoard={onOpenBoard}
        reopenable={reopenable}
        onDeleteAll={deleteBoard}
      />
    )}
    <div className="library" ref={libraryEl} style={comic ? { display: "none" } : undefined}
         aria-hidden={comic || undefined}>
      <div className="lib-head">
        <LibraryToolbar
          ref={search}
          filter={filter}
          onFilter={setFilter}
          shelfCounts={counts}
          favoriteCount={favoriteCount}
          total={totalCards}
          models={modelList}
          sort={sort}
          onSort={setSort}
          group={group}
          onGroup={setGroup}
          size={size}
          onSize={setSize}
        />

        {picked.size > 0 ? (
          <div className="bulk-bar" role="region" aria-label="Selection">
            <b>
              {chosen.length === picked.size
                ? `${picked.size} selected`
                : `${picked.size} selected · ${chosen.length} items`}
            </b>
            <button className="btn small" onClick={() => setPicked(new Set(order))}
                    disabled={picked.size === order.length}>Select all {order.length}</button>
            <button className="btn small" onClick={() => toggleFavorite([...picked])}>
              {[...picked].every((id) => favorites.has(id)) ? "Unstar" : "★ Star"}
            </button>
            <button className="btn small" disabled={busy} onClick={exportPicked}>
              {busy ? "Working…" : chosen.length === 1 ? "Export" : `Export ${chosen.length}`}
            </button>
            {send && chosen.every((i) => i.mime.startsWith("image/")) && (
              <SendTo ids={chosen.map((i) => i.id)} send={send} models={models} compact />
            )}
            <button className="btn small danger" disabled={busy} onClick={() => remove(chosen)}
                    title="You can undo for a few seconds">
              Delete {chosen.length}
            </button>
            <button className="btn small" style={{ marginLeft: "auto" }} onClick={clearPicks}>
              Clear
            </button>
          </div>
        ) : (
          <div className="lib-summary">
            {isFiltered(filter)
              ? `${visible.length} of ${totalCards} shown`
              : `${totalCards} item${totalCards === 1 ? "" : "s"}`}
            {` · ${fmtBytes(bytes)}`}
            <span className="hint">Click to open · ⌘-click or Shift-click to select · / to search</span>
          </div>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <span className="big">⌕</span>
          {filter.query.trim()
            ? <>Nothing matches “{filter.query.trim()}”{shelfName ? ` in ${shelfName}` : ""}.</>
            : filter.favorites
            ? <>Nothing starred{shelfName ? ` in ${shelfName}` : ""} yet. Press F in the viewer to star something.</>
            : <>Nothing here with these filters.</>}
          <div style={{ marginTop: 12 }}>
            <button className="btn small" onClick={() => setFilter(NO_FILTER)}>Clear filters</button>
          </div>
        </div>
      ) : (
        <LibraryGrid
          sections={sections}
          size={size}
          picked={picked}
          favorites={favorites}
          byId={byId}
          onActivate={openEntry}
          onTogglePick={togglePick}
          onPickSection={pickSection}
          send={send}
          models={models}
        />
      )}
    </div>
    {viewerEl}
    {undoBar}
    </>
  );
}

/** The nearest ancestor that scrolls, which is where the grid's position lives. */
function scrollParent(el: Element | null): Element | null {
  for (let at = el?.parentElement ?? null; at; at = at.parentElement) {
    const y = getComputedStyle(at).overflowY;
    if ((y === "auto" || y === "scroll") && at.scrollHeight > at.clientHeight) return at;
  }
  return document.scrollingElement;
}
