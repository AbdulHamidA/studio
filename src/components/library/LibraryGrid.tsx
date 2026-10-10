import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { vaultUrl } from "../../lib/api";
import type { ModelStatus, VaultItem } from "../../lib/types";
import {
  aspectOf, entryTitle, isAudio, isBoard, isImage, isPdf, isVideo, justify, kindLabel,
  prefersReducedMotion, type LibraryEntry, type Section,
} from "../../lib/library";
import SendTo, { type Destination } from "../SendTo";
import { coverOf } from "./InfoPanel";

const GAP = 6;
/** Before the container has been measured, and in a DOM with no layout. */
const FALLBACK_WIDTH = 960;

export interface GridProps {
  sections: Section[];
  /** Target row height in pixels, from the size slider. */
  size: number;
  picked: ReadonlySet<string>;
  favorites: ReadonlySet<string>;
  byId: ReadonlyMap<string, VaultItem>;
  onActivate: (entry: LibraryEntry, e: React.MouseEvent | React.KeyboardEvent) => void;
  onTogglePick: (entry: LibraryEntry, range: boolean) => void;
  onPickSection: (section: Section) => void;
  send?: (dest: Destination, ids: string[]) => void;
  models: ModelStatus[];
}

/**
 * The library as a photo library lays it out.
 *
 * Justified rows under date headings: every picture at its own shape, rows
 * edge to edge. Square crops threw away the top and bottom of every portrait
 * and the sides of every landscape, which for a generated picture is often
 * exactly the part you were checking.
 *
 * Rows far off screen are replaced by empty boxes of the same height, so a
 * vault of thousands scrolls as lightly as one of twenty: only what is near
 * the viewport holds an image element at all.
 */
export default function LibraryGrid(props: GridProps) {
  const { sections, size } = props;
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /**
   * The one tile that Tab lands on.
   *
   * Every card used to be its own tab stop, so getting past a vault of four
   * hundred pictures to whatever follows took four hundred presses. One stop
   * for the whole grid, and the arrow keys inside it, is the grid pattern
   * (WCAG 2.1.1, 2.4.3). Null means the first tile.
   */
  const [focusId, setFocusId] = useState<string | null>(null);
  const firstId = sections[0]?.entries[0]?.item.id ?? null;
  const allIds = useMemo(
    () => new Set(sections.flatMap((s) => s.entries.map((e) => e.item.id))), [sections]);
  const rovingId = focusId && allIds.has(focusId) ? focusId : firstId;

  /**
   * Arrow keys move between tiles; Home and End go to either end.
   *
   * Up and down go to the tile in the next row whose centre is nearest,
   * because justified rows do not line up in columns. Measured from the DOM
   * rather than the layout maths so it agrees with what is on screen; with no
   * layout at all (jsdom) it falls back to the same position in the row.
   */
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const from = (e.target as HTMLElement).closest<HTMLElement>(".tile-open");
    if (!from || !box.current) return;
    const rows = [...box.current.querySelectorAll<HTMLElement>(".lib-row")]
      .map((r) => [...r.querySelectorAll<HTMLElement>(".tile-open")])
      .filter((r) => r.length);
    const flat = rows.flat();
    const at = flat.indexOf(from);
    if (at < 0) return;
    let to: HTMLElement | undefined;
    if (e.key === "ArrowRight") to = flat[at + 1];
    else if (e.key === "ArrowLeft") to = flat[at - 1];
    else if (e.key === "Home") to = flat[0];
    else if (e.key === "End") to = flat[flat.length - 1];
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const r = rows.findIndex((row) => row.includes(from));
      const next = rows[r + (e.key === "ArrowDown" ? 1 : -1)];
      if (next) {
        const centre = (el: HTMLElement) => {
          const b = el.getBoundingClientRect();
          return b.left + b.width / 2;
        };
        const measured = from.getBoundingClientRect().width > 0;
        const col = rows[r].indexOf(from);
        to = measured
          ? next.reduce((best, el) =>
              Math.abs(centre(el) - centre(from)) < Math.abs(centre(best) - centre(from)) ? el : best)
          : next[Math.min(col, next.length - 1)];
      }
    } else return;
    e.preventDefault();
    if (to) {
      setFocusId(to.dataset.id ?? null);
      to.focus();
      to.scrollIntoView?.({ block: "nearest" });
    }
  };

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const w = width || FALLBACK_WIDTH;
  const laid = useMemo(() => sections.map((s) => ({
    section: s,
    rows: justify(s.entries.map((e) => aspectOf(e.item)), w, size, GAP),
  })), [sections, w, size]);

  return (
    <div className="lib-grid" ref={box} onKeyDown={onGridKey}
         onFocus={(e) => {
           const id = (e.target as HTMLElement).closest<HTMLElement>(".tile-open")?.dataset.id;
           if (id) setFocusId(id);
         }}>
      {laid.map(({ section, rows }) => {
        const all = section.entries.every((e) => props.picked.has(e.item.id));
        return (
          <section key={section.key} className="lib-section" aria-label={section.label || "Library"}>
            {section.label && (
              <header className="lib-section-head">
                <h3>{section.label}</h3>
                <span className="n">{section.entries.length}</span>
                <button className="link-btn" onClick={() => props.onPickSection(section)}
                        aria-label={`${all ? "Deselect" : "Select"} all in ${section.label}`}>
                  {all ? "Deselect" : "Select all"}
                </button>
              </header>
            )}
            {rows.map((row) => (
              <LazyRow key={row.tiles[0].index} height={row.height}>
                {row.tiles.map((t) => {
                  const entry = section.entries[t.index];
                  return (
                    <Card key={entry.item.id} entry={entry} width={t.width} height={t.height}
                          picked={props.picked.has(entry.item.id)}
                          starred={props.favorites.has(entry.item.id)}
                          selecting={props.picked.size > 0}
                          tabbable={entry.item.id === rovingId}
                          byId={props.byId} onActivate={props.onActivate}
                          onTogglePick={props.onTogglePick} send={props.send} models={props.models} />
                  );
                })}
              </LazyRow>
            ))}
          </section>
        );
      })}
    </div>
  );
}

/**
 * A row that only draws its contents near the viewport.
 *
 * Without an IntersectionObserver (tests, very old WebKit) every row is drawn,
 * which is correct and merely slower.
 */
function LazyRow({ height, children }: { height: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      // A row with no size is not off screen, it is not laid out at all --
      // the grid is hidden behind an open comic. Dropping its pictures then
      // would mean coming Back to empty rows, and to a tile that cannot take
      // focus because it no longer exists.
      if (e.boundingClientRect.width === 0 && e.boundingClientRect.height === 0) return;
      setNear(e.isIntersecting);
    }, { rootMargin: "1200px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div className="lib-row" ref={ref} style={{ height, gap: GAP }}>
      {near ? children : null}
    </div>
  );
}

const Card = memo(function Card({
  entry, width, height, picked, starred, selecting, tabbable, byId, onActivate, onTogglePick, send, models,
}: {
  entry: LibraryEntry; width: number; height: number; picked: boolean; starred: boolean;
  selecting: boolean; tabbable: boolean; byId: ReadonlyMap<string, VaultItem>;
  onActivate: GridProps["onActivate"]; onTogglePick: GridProps["onTogglePick"];
  send?: GridProps["send"]; models: ModelStatus[];
}) {
  const it = entry.item;
  const board = isBoard(entry);
  const [broken, setBroken] = useState(false);
  const title = entryTitle(entry);
  const cover = coverOf(it, byId);
  const pages = board ? entry.members.filter((m) => m.model === "composed" && isImage(m)).length : 0;
  const panels = board
    ? entry.members.filter((m) => m.project_index != null && m.model !== "composed").length : 0;
  // What was made, not how many files it took. "board · 17 pictures" is the
  // tool's internals reaching the surface: the person made one comic of two
  // pages, and the seventeen are the panels and sheets it was built from.
  const sub = board
    ? ([pages ? `${pages} page${pages === 1 ? "" : "s"}` : null,
        panels ? `${panels} panel${panels === 1 ? "" : "s"}` : null]
        .filter(Boolean).join(" · ") || `${entry.members.length} pictures`)
    : [kindLabel(it.kind), it.model && it.model !== "composed" ? it.model : null]
        .filter(Boolean).join(" · ");
  const badge = board ? "Comic" : isVideo(it) ? "Video" : isAudio(it) ? "Audio" : isPdf(it) ? "PDF" : null;

  let media: React.ReactNode;
  if (broken) {
    media = <div className="tile-glyph" title="The preview could not be read">⚠</div>;
  } else if (isVideo(it)) {
    // The frame an animation started from is a free poster. Without one,
    // asking for a tenth of a second in gets WebKit to paint a first frame
    // instead of a black box.
    media = (
      <video src={cover ? vaultUrl(it.id) : `${vaultUrl(it.id)}#t=0.1`} muted loop playsInline
             poster={cover ? vaultUrl(cover) : undefined} preload={cover ? "none" : "metadata"}
             // Hover-to-play is motion nobody asked for; with reduced motion
             // on, the poster stays still and the viewer is where it plays.
             onMouseEnter={(e) => {
               if (prefersReducedMotion()) return;
               void e.currentTarget.play()?.catch(() => {});
             }}
             onMouseLeave={(e) => e.currentTarget.pause()}
             onError={() => setBroken(true)} />
    );
  } else if (cover) {
    media = <img src={vaultUrl(cover)} alt="" loading="lazy" decoding="async"
                 onError={() => setBroken(true)} />;
  } else {
    media = (
      <div className={"tile-glyph" + (isAudio(it) ? " audio" : "")}>
        <span aria-hidden>{isAudio(it) ? "♫" : "▤"}</span>
        <em>{it.prompt || it.name}</em>
      </div>
    );
  }

  // The tile is two controls side by side, not one inside the other. The pick
  // used to sit inside an element with role="button", where assistive tech
  // flattens it away, and 20px was all a pointer got (WCAG 4.1.2, 2.5.8).
  // Now the picture is the open button and the pick is its sibling.
  return (
    <div
      className={"tile" + (picked ? " picked" : "") + (board ? " stack" : "") + (selecting ? " selecting" : "")}
      style={{ width, height }}
    >
      <button
        type="button"
        className="tile-open"
        data-id={it.id}
        tabIndex={tabbable ? 0 : -1}
        aria-label={`${board ? "Comic" : kindLabel(it.kind)}: ${title}`}
        aria-pressed={selecting ? picked : undefined}
        onClick={(e) => {
          // A modifier selects; anything else opens. Once something is
          // selected a plain click keeps selecting, because that is what a
          // file list does and opening would lose the set.
          if (e.shiftKey || e.metaKey || e.ctrlKey) { e.preventDefault(); onTogglePick(entry, e.shiftKey); }
          else if (selecting) onTogglePick(entry, false);
          else onActivate(entry, e);
        }}
        onKeyDown={(e) => {
          // Space selects, as in a file list; Enter opens (the native click).
          // Handled on key down and swallowed on key up, because a button
          // fires its click when Space is released.
          if (e.key === " ") { e.preventDefault(); onTogglePick(entry, e.shiftKey); }
        }}
        onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
      >
        {media}
      </button>
      {/* Out of the tab order: Space on the tile does the same thing, and one
          stop per tile is what the roving focus above is there to remove. */}
      <button
        type="button"
        className="pick"
        tabIndex={-1}
        aria-pressed={picked}
        aria-label={picked ? `Deselect ${title}` : `Select ${title}`}
        onClick={(e) => onTogglePick(entry, e.shiftKey)}
      >✓</button>
      {board && (
        <span className="count" title={`${entry.members.length} pictures in this board`}>
          {entry.members.length}
        </span>
      )}
      {starred && <span className="star" aria-label="Favourite">★</span>}
      {badge && <span className="badge">{badge}</span>}
      <div className="tile-caption">
        <div className="p">{title}</div>
        <div className="sub">{sub}</div>
        {!board && isImage(it) && send && width >= 170 && !selecting && (
          <div className="tile-actions">
            <SendTo ids={[it.id]} send={send} models={models} compact />
          </div>
        )}
      </div>
    </div>
  );
});
