import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { vaultUrl } from "../../lib/api";
import type { ModelStatus, VaultItem } from "../../lib/types";
import { descendants, isAudio, isImage, isPdf, isVideo, kindLabel, lineage } from "../../lib/library";
import { loadPref, savePref } from "../../lib/prefs";
import SendTo, { type Destination } from "../SendTo";
import Adjust from "../Adjust";
import AudioPlayer from "./AudioPlayer";
import { useNowPlaying } from "../../lib/nowPlaying";
import InfoPanel, { coverOf, MiniThumb } from "./InfoPanel";
import ZoomStage, { type ZoomHandle } from "./ZoomStage";

/** How many neighbours either side the filmstrip draws. */
const STRIP_REACH = 40;

export interface ViewerProps {
  /** What ←/→ walks through, in the order the grid showed it. */
  items: VaultItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  /** Set when this is a comic being read: pages are counted as pages. */
  reader?: { title: string };
  /** Every item, for history and covers. */
  all: VaultItem[];
  /** Open an item that is not in `items` -- a step in its history. */
  onOpenItem: (item: VaultItem) => void;
  /** Return from such a detour, when there is one to return from. */
  onBack?: () => void;
  favorites: ReadonlySet<string>;
  onToggleFavorite: (ids: string[]) => void;
  onDelete: (items: VaultItem[]) => void;
  onExport: (item: VaultItem) => void;
  onOpenBoard?: (project: string) => void;
  send?: (dest: Destination, ids: string[]) => void;
  models: ModelStatus[];
  onReuse?: (item: VaultItem, reuseSeed: boolean) => void;
  notify: (m: string, bad?: boolean) => void;
  onChanged: () => void;
  /** An adjusted copy was saved; show it once the library has it. */
  onAdjusted?: (id: string) => void;
}

/** Keys typed into a field belong to the field. A slider is not a field. */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === "INPUT") return (t as HTMLInputElement).type !== "range";
  return t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

/**
 * The lightbox.
 *
 * The old preview replaced the whole library with a details form and a
 * picture capped at two thirds of the window, and the only way to the next
 * item was Back and another click. This sits over the grid instead, so the
 * grid is exactly where it was when you close it, and the arrow keys walk the
 * same order the grid showed. The details are a panel you can put away (I);
 * the picture gets the screen.
 */
export default function Viewer(props: ViewerProps) {
  const {
    items, index, onIndex, onClose, reader, all, onOpenItem, onBack, favorites,
    onToggleFavorite, onDelete, onExport, onOpenBoard, send, models, onReuse, notify,
    onChanged, onAdjusted,
  } = props;
  const item = items[index];
  const nowPlaying = useNowPlaying();
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const zoom = useRef<ZoomHandle>(null);
  const strip = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<"info" | "adjust" | null>(
    () => (loadPref("library.info", true) ? "info" : null));
  const [scale, setScale] = useState({ scale: 1, fit: 1 });
  const [broken, setBroken] = useState(false);
  const [pdfMode, setPdfMode] = useState<"pages" | "pdf">("pages");
  const onScale = useCallback((s: number, fit: number) => setScale({ scale: s, fit }), []);

  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);

  // Adjusting belongs to one picture; arriving at the next one with its crop
  // panel still open would offer to crop something you have not looked at.
  useEffect(() => {
    setBroken(false);
    setSide((s) => (s === "adjust" ? "info" : s));
  }, [item?.id]);

  // Focus moves into the dialog and comes back to the card that opened it,
  // so a keyboard user is not left stranded at the top of the page.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    root.current?.focus();
    return () => { before?.focus?.(); };
  }, []);

  const go = useCallback((to: number) => {
    if (!items.length) return;
    onIndex(Math.max(0, Math.min(items.length - 1, to)));
  }, [items.length, onIndex]);

  const toggleSide = useCallback((which: "info" | "adjust") => {
    setSide((s) => {
      const next = s === which ? null : which;
      if (which === "info") savePref("library.info", next === "info");
      return next;
    });
  }, []);

  const copyPrompt = useCallback(() => {
    if (!item?.prompt) return;
    void navigator.clipboard?.writeText(item.prompt)
      .then(() => notify("Prompt copied."))
      .catch(() => notify("Could not reach the clipboard.", true));
  }, [item, notify]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || typing(e) || !item) return;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
      switch (e.key) {
        case "Escape":
          if (side === "adjust") setSide("info"); else onClose();
          break;
        case "ArrowLeft": if (!plain) return; go(index - 1); break;
        case "ArrowRight": if (!plain) return; go(index + 1); break;
        case "Home": go(0); break;
        case "End": go(items.length - 1); break;
        case " ": {
          // The audio player owns Space for audio, with its other keys.
          if (isAudio(item)) return;
          const media = stage.current?.querySelector("video");
          if (!media) return;
          if (media.paused) void media.play()?.catch(() => {}); else media.pause();
          break;
        }
        case "i": case "I": if (!plain) return; toggleSide("info"); break;
        case "f": case "F": if (!plain) return; onToggleFavorite([item.id]); break;
        case "0": if (!plain) return; zoom.current?.fit(); break;
        case "1": if (!plain) return; zoom.current?.actual(); break;
        case "+": case "=": zoom.current?.zoomBy(1.25); break;
        case "-": zoom.current?.zoomBy(0.8); break;
        case "Delete": case "Backspace":
          if (e.key === "Backspace" && !e.metaKey) return;
          onDelete([item]);
          break;
        case "c": case "C":
          if (!e.metaKey || window.getSelection()?.toString()) return;
          copyPrompt();
          break;
        default: return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, index, items.length, go, onClose, side, toggleSide, onToggleFavorite, onDelete, copyPrompt]);

  // The next and previous pictures are fetched before they are asked for,
  // so walking through the library does not wait on a decrypt at every step.
  useEffect(() => {
    for (const n of [items[index + 1], items[index - 1]]) {
      if (n && isImage(n)) { const img = new Image(); img.src = vaultUrl(n.id); }
    }
  }, [items, index]);

  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>("[aria-current='true']");
    el?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [index]);

  if (!item) return null;

  const chain = lineage(item, byId);
  const madeFrom = descendants(item, all);
  const starred = favorites.has(item.id);
  const pages = isPdf(item)
    ? item.inputs.map((id) => byId.get(id)).filter((i): i is VaultItem => !!i && isImage(i))
    : [];
  const position = reader
    ? `Page ${index + 1} of ${items.length}`
    : `${index + 1} of ${items.length}`;
  const title = reader ? reader.title : (item.prompt || item.name);
  const pct = Math.round(scale.scale * 100);

  const onTab = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !root.current) return;
    const f = [...root.current.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
    )].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === root.current)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  };

  let body: React.ReactNode;
  if (broken) {
    body = (
      <div className="viewer-empty">
        <span className="big">⚠</span>
        This item could not be read from the vault.
        <div className="dim">It may have been deleted, or the vault was locked.</div>
      </div>
    );
  } else if (isImage(item)) {
    body = (
      <ZoomStage ref={zoom} key={item.id} src={vaultUrl(item.id)}
                 alt={item.prompt || item.name} width={item.width} height={item.height}
                 onScale={onScale} onError={() => setBroken(true)} />
    );
  } else if (isVideo(item)) {
    const poster = coverOf(item, byId);
    body = (
      <video key={item.id} className="viewer-video" src={vaultUrl(item.id)} controls loop autoPlay muted
             playsInline poster={poster ? vaultUrl(poster) : undefined}
             aria-label={item.prompt || item.name} onError={() => setBroken(true)} />
    );
  } else if (isAudio(item)) {
    body = (
      <div className="viewer-audio">
        <div className="audio-cover" aria-hidden>♫</div>
        <AudioPlayer key={item.id} src={vaultUrl(item.id)} title={item.prompt || item.name} markers={item.markers ?? []}
                     shortcuts="global" />
        <button type="button" className="btn small" onClick={() => {
          nowPlaying.play({ src: vaultUrl(item.id), title: item.prompt || item.name, markers: item.markers ?? [] });
          onClose();
        }}>Keep playing while I browse</button>
      </div>
    );
  } else if (isPdf(item)) {
    body = (
      <div className="viewer-pdf">
        {pages.length > 0 && (
          <div className="seg" role="tablist" aria-label="Show as">
            <button role="tab" aria-selected={pdfMode === "pages"}
                    onClick={() => setPdfMode("pages")}>Pages</button>
            <button role="tab" aria-selected={pdfMode === "pdf"}
                    onClick={() => setPdfMode("pdf")}>PDF</button>
          </div>
        )}
        {pages.length > 0 && pdfMode === "pages" ? (
          <div className="pdf-pages">
            {pages.map((p, i) => (
              <figure key={p.id}>
                <img src={vaultUrl(p.id)} alt={`Page ${i + 1}`} loading="lazy" />
                <figcaption>Page {i + 1} of {pages.length}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <iframe className="pdf-frame" src={vaultUrl(item.id)} title={item.name} />
        )}
      </div>
    );
  } else {
    body = (
      <div className="viewer-empty">
        <span className="big">▤</span>
        {item.name}
        <div className="dim">There is no preview for this kind of file.</div>
        <button className="btn small" onClick={() => onExport(item)}>Export a copy…</button>
      </div>
    );
  }

  const from = Math.max(0, index - STRIP_REACH);
  const near = items.slice(from, index + STRIP_REACH + 1);

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`Viewer: ${title}`}
         ref={root} tabIndex={-1} onKeyDown={onTab}>
      <header className="viewer-bar" data-tauri-drag-region>
        {onBack ? (
          <button className="icon-btn" onClick={onBack} aria-label="Back" title="Back">←</button>
        ) : null}
        <button className="icon-btn" onClick={onClose} aria-label="Close viewer" title="Close (Esc)">✕</button>
        <div className="viewer-title">
          <div className="t" title={title}>{title}</div>
          <div className="s">
            {position}
            {!reader && ` · ${kindLabel(item.kind)}`}
            {item.model && item.model !== "composed" ? ` · ${item.model}` : ""}
          </div>
        </div>
        <div className="viewer-actions">
          {isImage(item) && !broken && (
            <div className="zoom-controls" role="group" aria-label="Zoom">
              <button className="icon-btn" onClick={() => zoom.current?.zoomBy(0.8)}
                      aria-label="Zoom out" title="Zoom out (−)">−</button>
              <button className="zoom-pct" onClick={() =>
                        scale.scale > scale.fit + 1e-3 ? zoom.current?.fit() : zoom.current?.actual()}
                      aria-label={scale.scale > scale.fit + 1e-3 ? "Fit to window" : "Actual size"}
                      title="Fit (0) / 100% (1)">
                {scale.scale > scale.fit + 1e-3 ? `${pct}%` : "Fit"}
              </button>
              <button className="icon-btn" onClick={() => zoom.current?.zoomBy(1.25)}
                      aria-label="Zoom in" title="Zoom in (+)">+</button>
            </div>
          )}
          <button className={"icon-btn star" + (starred ? " on" : "")} aria-pressed={starred}
                  onClick={() => onToggleFavorite([item.id])}
                  aria-label={starred ? "Remove from favourites" : "Add to favourites"}
                  title="Favourite (F)">{starred ? "★" : "☆"}</button>
          <button className={"icon-btn" + (side === "info" ? " on" : "")} aria-pressed={side === "info"}
                  onClick={() => toggleSide("info")} aria-label="Show details" title="Details (I)">ⓘ</button>
          {isImage(item) && (
            <button className={"btn small" + (side === "adjust" ? " primary" : "")}
                    onClick={() => toggleSide("adjust")} aria-pressed={side === "adjust"}>Adjust</button>
          )}
          {isImage(item) && send && (
            <SendTo ids={[item.id]} send={send} models={models} compact />
          )}
          {onReuse && item.prompt && !isAudio(item) && !isPdf(item) && item.model !== "composed" && (
            <>
              <button className="btn small" onClick={() => onReuse(item, false)}
                      title="Same settings, new seed">Make another like this</button>
              <button className="btn small" onClick={() => onReuse(item, true)}
                      title="Same prompt, same seed, same settings">Recreate exactly</button>
            </>
          )}
          {item.project && onOpenBoard && !reader && (
            <button className="btn small" onClick={() => onOpenBoard(item.project!)}>Open its board</button>
          )}
          <button className="btn small" onClick={() => onExport(item)} title="Export an unencrypted copy">
            Export…
          </button>
          <button className="btn small danger" onClick={() => onDelete([item])}
                  title="Delete (⌘⌫) — you can undo for a few seconds">Delete</button>
        </div>
      </header>

      <div className="viewer-main">
        <div className="viewer-stage" ref={stage}>
          {index > 0 && (
            <button className="nav-btn prev" onClick={() => go(index - 1)}
                    aria-label={reader ? "Previous page" : "Previous item"}>‹</button>
          )}
          {body}
          {index < items.length - 1 && (
            <button className="nav-btn next" onClick={() => go(index + 1)}
                    aria-label={reader ? "Next page" : "Next item"}>›</button>
          )}
        </div>
        {side === "info" && (
          <InfoPanel item={item} chain={chain} children={madeFrom} byId={byId}
                     onCopyPrompt={copyPrompt}
                     onOpen={(target) => {
                       const at = items.findIndex((i) => i.id === target.id);
                       if (at >= 0) go(at); else onOpenItem(target);
                     }} />
        )}
        {side === "adjust" && isImage(item) && (
          <aside className="info-panel" aria-label="Adjust">
            <Adjust sourceId={item.id} notify={notify} onSaved={(id) => {
              onChanged();
              notify("Saved as a new picture. The original is untouched.");
              onAdjusted?.(id);
            }} />
          </aside>
        )}
      </div>

      {items.length > 1 && (
        <nav className="filmstrip" ref={strip} aria-label={reader ? "Pages" : "Nearby items"}>
          {near.map((n, k) => {
            const at = from + k;
            return (
              <button key={n.id} className="film" aria-current={at === index}
                      aria-label={reader ? `Page ${at + 1}` : `Show ${n.prompt || n.name}`}
                      onClick={() => go(at)}>
                <MiniThumb item={n} byId={byId} />
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
