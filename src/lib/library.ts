/**
 * The library's thinking, without the library's screen.
 *
 * Everything the Vault decides about what to show -- which kind a thing is,
 * what a search matches, how a board folds into one card, which heading a
 * picture sits under, what a shift-click selects -- lives here as plain
 * functions. The screen only draws the answer. That split is what lets the
 * rules be tested on a thousand items in a millisecond, and it is why a
 * grouping bug cannot hide inside a render branch again.
 */
import type { VaultItem } from "./types";

/* ---------- kinds ---------- */

/**
 * The shelves a person browses by.
 *
 * Not the vault's own `kind`, which records which command wrote the file.
 * Someone looking for "the comic" or "the audiobook" does not know or care
 * that the page was stamped `image` and the book `audiobook`; they know what
 * the thing is. A shelf can hold an item that is also on another one -- an
 * edit is still a picture -- because that is how people look for them.
 */
export type Shelf =
  | "image" | "comic" | "video" | "audio" | "document" | "edit" | "upscale";

export const SHELVES: [Shelf, string][] = [
  ["image", "Images"],
  ["comic", "Comics"],
  ["video", "Video"],
  ["audio", "Audio"],
  ["document", "PDFs"],
  ["edit", "Edits"],
  ["upscale", "Upscales"],
];

export const isImage = (i: VaultItem) => i.mime.startsWith("image/");
export const isVideo = (i: VaultItem) => i.mime.startsWith("video/");
export const isAudio = (i: VaultItem) => i.mime.startsWith("audio/");
export const isPdf = (i: VaultItem) =>
  i.mime === "application/pdf" || i.kind === "document";

export function shelvesOf(i: VaultItem): Shelf[] {
  const out: Shelf[] = [];
  if (isImage(i)) out.push("image");
  if (i.project || i.model === "composed") out.push("comic");
  if (isVideo(i)) out.push("video");
  if (isAudio(i)) out.push("audio");
  if (isPdf(i)) out.push("document");
  if (i.kind === "edit" || i.kind === "adjust") out.push("edit");
  if (i.kind === "upscale") out.push("upscale");
  return out;
}

export const KIND_LABEL: Record<string, string> = {
  generate: "Generated", edit: "Edited", upscale: "Enlarged",
  audiobook: "Audiobook", video: "Animated", import: "Imported", doc: "Document",
  document: "Document", recovered: "Recovered", mask: "Mask", adjust: "Adjusted",
  image: "Composed", reference: "Reference",
};

export const kindLabel = (kind: string) => KIND_LABEL[kind] ?? kind;

/* ---------- filtering ---------- */

export interface LibraryFilter {
  /** One shelf, or everything. */
  shelf: Shelf | "all";
  /** Only starred items. */
  favorites: boolean;
  /** Exact model display name, or "" for any. */
  model: string;
  query: string;
}

export const NO_FILTER: LibraryFilter = { shelf: "all", favorites: false, model: "", query: "" };

export const isFiltered = (f: LibraryFilter) =>
  f.shelf !== "all" || f.favorites || !!f.model || !!f.query.trim();

/**
 * Whether an item answers a search.
 *
 * Every word must appear somewhere, in any order. "red cat" finding a prompt
 * that says "a cat in a red coat" is what people mean by searching their own
 * pictures; a phrase match made them remember their exact wording.
 */
export function matchesQuery(i: VaultItem, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = [
    i.prompt, i.name, i.model, i.project_name ?? "", i.negative_prompt ?? "",
    kindLabel(i.kind),
  ].join("\n").toLowerCase();
  return words.every((w) => hay.includes(w));
}

/**
 * What the library shows at all.
 *
 * Painted masks live in the vault so they are never written in the clear, but
 * they are working data and would only clutter the library.
 */
export const browsable = (items: VaultItem[]) => items.filter((i) => i.kind !== "mask");

export function filterItems(
  items: VaultItem[], f: LibraryFilter, favorites: ReadonlySet<string>,
): VaultItem[] {
  return items.filter((i) =>
    (f.shelf === "all" || shelvesOf(i).includes(f.shelf)) &&
    (!f.favorites || favorites.has(i.id)) &&
    (!f.model || i.model === f.model) &&
    matchesQuery(i, f.query));
}

/** How many items sit on each shelf, for the counts on the chips. */
export function shelfCounts(items: VaultItem[]): Record<Shelf, number> {
  const out = Object.fromEntries(SHELVES.map(([s]) => [s, 0])) as Record<Shelf, number>;
  for (const i of items) for (const s of shelvesOf(i)) out[s]++;
  return out;
}

/** Models that made something here, most used first. */
export function modelCounts(items: VaultItem[]): [string, number][] {
  const m = new Map<string, number>();
  for (const i of items) if (i.model) m.set(i.model, (m.get(i.model) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ---------- entries: one card per thing made ---------- */

/** A board's parts, in the order the board holds them. */
export const projectOrder = (a: VaultItem, b: VaultItem) =>
  (a.project_index ?? 1e9) - (b.project_index ?? 1e9) ||
  a.created_at.localeCompare(b.created_at);

export interface LibraryEntry {
  /** The card's picture: the board's first panel, or the item itself. */
  item: VaultItem;
  /** Everything the card stands for. One item unless it is a board. */
  members: VaultItem[];
  /** When it was last touched, which is what "newest" means for a board. */
  date: string;
}

export const isBoard = (e: LibraryEntry) => e.members.length > 1;

/**
 * Collapse a board into one entry.
 *
 * A picture board writes a character sheet, a room reference per scene and
 * one picture per panel. Left flat that is seventeen items in the library
 * for one comic, which is what made the vault unusable after a board run.
 * Members are folded into their first panel, and the card says how many are
 * inside; opening it still reaches every one.
 *
 * A board is dated by its newest member. Composing a month-old board again
 * today is today's work, and filing it under last month hid it.
 */
export function buildEntries(items: VaultItem[]): LibraryEntry[] {
  const byProject = new Map<string, VaultItem[]>();
  const out: LibraryEntry[] = [];
  for (const it of items) {
    if (it.project) {
      const g = byProject.get(it.project);
      if (g) g.push(it); else byProject.set(it.project, [it]);
    } else {
      out.push({ item: it, members: [it], date: it.created_at });
    }
  }
  for (const [, members] of byProject) {
    members.sort(projectOrder);
    const date = members.reduce((d, m) => (m.created_at > d ? m.created_at : d), "");
    out.push({ item: members[0], members, date });
  }
  return out;
}

export type SortKey = "newest" | "oldest" | "name" | "kind";

export const SORTS: [SortKey, string][] = [
  ["newest", "Newest first"], ["oldest", "Oldest first"],
  ["name", "Name"], ["kind", "Kind"],
];

/** The name a card goes by: the board's title, or what was asked for. */
export const entryTitle = (e: LibraryEntry) =>
  isBoard(e) ? (e.item.project_name || "Picture board") : (e.item.prompt || e.item.name);

export function sortEntries(entries: LibraryEntry[], key: SortKey): LibraryEntry[] {
  const out = [...entries];
  const newest = (a: LibraryEntry, b: LibraryEntry) => b.date.localeCompare(a.date);
  switch (key) {
    case "oldest": out.sort((a, b) => a.date.localeCompare(b.date)); break;
    case "name": out.sort((a, b) =>
      entryTitle(a).localeCompare(entryTitle(b), undefined, { sensitivity: "base" })
      || newest(a, b)); break;
    case "kind": out.sort((a, b) =>
      (isBoard(a) ? "Board" : kindLabel(a.item.kind))
        .localeCompare(isBoard(b) ? "Board" : kindLabel(b.item.kind)) || newest(a, b)); break;
    default: out.sort(newest);
  }
  return out;
}

/* ---------- sections ---------- */

export type GroupKey = "date" | "board" | "none";

export const GROUPS: [GroupKey, string][] = [
  ["date", "By date"], ["board", "By board"], ["none", "No grouping"],
];

export interface Section {
  key: string;
  label: string;
  entries: LibraryEntry[];
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * The heading a date belongs under, the way a photo library says it.
 *
 * Relative while it is recent, because "Yesterday" is how anyone remembers
 * last night's run; a month and year after that, because nobody remembers
 * which Tuesday.
 */
export function dateBucket(iso: string, now: Date): { key: string; label: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { key: "unknown", label: "Undated" };
  const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 864e5);
  if (days <= 0) return { key: "today", label: "Today" };
  if (days === 1) return { key: "yesterday", label: "Yesterday" };
  if (days < 7) return { key: "week", label: "This week" };
  const label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return { key: `${d.getFullYear()}-${d.getMonth()}`, label };
}

/**
 * Cut the sorted entries into headed sections.
 *
 * Sections appear in the order their first entry does, so "oldest first"
 * reverses the headings along with the pictures and no separate rule is needed
 * for it. Grouping by board unfolds every board into its parts under its own
 * heading -- the one view where the panels are the point -- and puts whatever
 * belongs to no board last.
 */
export function sectionize(entries: LibraryEntry[], by: GroupKey, now = new Date()): Section[] {
  if (by === "none") return entries.length ? [{ key: "all", label: "", entries }] : [];
  const sections = new Map<string, Section>();
  const add = (key: string, label: string, e: LibraryEntry) => {
    const s = sections.get(key);
    if (s) s.entries.push(e); else sections.set(key, { key, label, entries: [e] });
  };
  if (by === "date") {
    for (const e of entries) {
      const b = dateBucket(e.date, now);
      add(b.key, b.label, e);
    }
    return [...sections.values()];
  }
  const loose: LibraryEntry[] = [];
  for (const e of entries) {
    if (!e.item.project) { loose.push(e); continue; }
    for (const m of e.members) {
      add(`board:${e.item.project}`, e.item.project_name || "Picture board",
          { item: m, members: [m], date: m.created_at });
    }
  }
  const out = [...sections.values()];
  if (loose.length) out.push({ key: "loose", label: "Not in a board", entries: loose });
  return out;
}

/* ---------- selection ---------- */

/**
 * The selection after one click.
 *
 * Selection is by id, not by index: filtering and searching reorder the grid
 * underneath, and a selection that survives a search is the point. A range
 * runs between the anchor and the click in the order on screen, and adds to
 * what was already chosen rather than replacing it, as in Finder.
 */
export function applyPick(
  prev: ReadonlySet<string>, order: readonly string[], id: string,
  anchor: string | null, range: boolean,
): Set<string> {
  const next = new Set(prev);
  if (range && anchor) {
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a >= 0 && b >= 0) {
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) next.add(order[k]);
      return next;
    }
  }
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/**
 * Everything a selection actually refers to.
 *
 * The grid shows one card per board, and that card is the board's first
 * panel. Selecting it and pressing Delete must delete the board, not strip
 * one picture out of it and leave the rest orphaned -- which is what matching
 * on picked ids alone would do. So a picked head expands to every member of
 * its project -- but only when the card was standing in for the board, so
 * that picking one panel in the by-board view still means one panel.
 */
export function expandPicked(
  picked: ReadonlySet<string>, all: VaultItem[], boardHeads: ReadonlySet<string>,
): VaultItem[] {
  const projects = new Set(all
    .filter((i) => picked.has(i.id) && i.project && boardHeads.has(i.id))
    .map((i) => i.project));
  return all.filter((i) => picked.has(i.id) || (i.project != null && projects.has(i.project)));
}

/* ---------- history ---------- */

/**
 * Walk an item back to where it started.
 *
 * Each item records the ids it was made from, so a picture that was
 * generated, edited, then animated carries its whole history. Following it
 * is what makes a chain of tabs legible after the fact.
 */
export function lineage(item: VaultItem, byId: ReadonlyMap<string, VaultItem>, depth = 0): VaultItem[] {
  if (depth > 8) return []; // a cycle should not hang the interface
  const parents = item.inputs
    .map((id) => byId.get(id))
    .filter((x): x is VaultItem => !!x);
  return parents.flatMap((p) => [...lineage(p, byId, depth + 1), p]);
}

/** What was made from this item, newest first. */
export function descendants(item: VaultItem, all: VaultItem[]): VaultItem[] {
  return all.filter((i) => i.inputs.includes(item.id) && i.kind !== "mask")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/* ---------- layout ---------- */

export interface Tile { index: number; width: number; height: number }
export interface Row { tiles: Tile[]; height: number }

/**
 * The aspect a card is laid out at.
 *
 * Clamped, because one panorama in a justified row would squash everything
 * beside it into slivers, and a tall strip would make the whole row a
 * screen high. The picture is cropped to the card; the viewer shows it whole.
 */
export function aspectOf(i: VaultItem): number {
  if (!isImage(i) && !isVideo(i)) return 1;
  if (!i.width || !i.height) return 1;
  return Math.min(2.2, Math.max(0.6, i.width / i.height));
}

/**
 * Lay tiles into justified rows, the way photo libraries do.
 *
 * Each row is filled at the target height until it would overflow, then
 * scaled so its edges meet the container exactly. Pictures keep their shape
 * instead of all being cut to squares. The last row is left at the target
 * height rather than stretched across the screen from two pictures.
 */
export function justify(aspects: number[], width: number, target: number, gap: number): Row[] {
  const rows: Row[] = [];
  if (width <= 0) return rows;
  let start = 0;
  let sum = 0;
  for (let i = 0; i < aspects.length; i++) {
    sum += aspects[i];
    const count = i - start + 1;
    const natural = sum * target + gap * (count - 1);
    if (natural >= width) {
      const h = (width - gap * (count - 1)) / sum;
      rows.push(makeRow(aspects, start, i, h));
      start = i + 1;
      sum = 0;
    }
  }
  if (start < aspects.length) rows.push(makeRow(aspects, start, aspects.length - 1, target));
  return rows;
}

function makeRow(aspects: number[], from: number, to: number, height: number): Row {
  const tiles: Tile[] = [];
  for (let k = from; k <= to; k++) tiles.push({ index: k, width: aspects[k] * height, height });
  return { tiles, height };
}

/* ---------- zoom ---------- */

export interface View { scale: number; x: number; y: number }
export interface Size { w: number; h: number }

/** The scale that shows the whole picture, never enlarging a small one. */
export function fitScale(nat: Size, box: Size): number {
  if (!nat.w || !nat.h || !box.w || !box.h) return 1;
  return Math.min(1, box.w / nat.w, box.h / nat.h);
}

/** Centred at a scale, which is where fit and 100% both start. */
export function centred(scale: number, nat: Size, box: Size): View {
  return { scale, x: (box.w - nat.w * scale) / 2, y: (box.h - nat.h * scale) / 2 };
}

/**
 * Keep a zoomed picture on screen.
 *
 * Smaller than the box on an axis, it is centred on that axis; larger, it can
 * be dragged only until its edge meets the box's edge, so a pan can never lose
 * the picture off into empty space.
 */
export function clampView(v: View, nat: Size, box: Size): View {
  const w = nat.w * v.scale;
  const h = nat.h * v.scale;
  const x = w <= box.w ? (box.w - w) / 2 : Math.min(0, Math.max(box.w - w, v.x));
  const y = h <= box.h ? (box.h - h) / 2 : Math.min(0, Math.max(box.h - h, v.y));
  return { scale: v.scale, x, y };
}

export const MAX_ZOOM = 8;

/**
 * Zoom about a point, so what is under the pointer stays under it.
 *
 * Zooming about the centre is what made scroll-zoom feel broken in the old
 * preview: you aim at a face and it slides away from you.
 */
export function zoomAbout(v: View, next: number, point: { x: number; y: number },
                          nat: Size, box: Size): View {
  const min = Math.min(fitScale(nat, box), 1);
  const scale = Math.min(MAX_ZOOM, Math.max(min, next));
  const k = scale / v.scale;
  return clampView(
    { scale, x: point.x - (point.x - v.x) * k, y: point.y - (point.y - v.y) * k }, nat, box);
}

/* ---------- time ---------- */

/** 0:05, 4:12, 1:02:03. A clock, not a duration in words. */
export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The chapter playing at a time, given markers in any order. */
export function markerAt<T extends { time: number }>(markers: T[], t: number): T | null {
  let best: T | null = null;
  for (const m of markers) if (m.time <= t && (!best || m.time > best.time)) best = m;
  return best;
}
