import { useEffect, useRef, useState } from "react";
import { api, errText, fmtBytes, newJobId, vaultUrl } from "../../lib/api";
import type { ModelStatus, VaultItem } from "../../lib/types";
import { compositions } from "../../lib/board";
import { isPdf } from "../../lib/library";
import { loadSavedBoard } from "../../lib/boardDraft";
import type { Panel } from "../../lib/types";
import { exportMany } from "../shared";
import SendTo, { type Destination } from "../SendTo";

/**
 * One comic, opened.
 *
 * Opening a board shows the comic, not the first panel's metadata. A board is
 * a thing someone made; its parts are pages and sheets, and the actions that
 * matter are on the whole of it. Pages open in the reader, page by page; the
 * panels and sheets open in the ordinary viewer.
 */
export default function BoardView({
  members, onBack, onRead, onView, onChanged, notify, send, models, onOpenBoard,
  reopenable, onDeleteAll,
}: {
  /** Every item in the project, in project order. */
  members: VaultItem[];
  onBack: () => void;
  onRead: (pages: VaultItem[], index: number, title: string) => void;
  onView: (list: VaultItem[], index: number) => void;
  onChanged: () => void;
  notify: (m: string, bad?: boolean) => void;
  send?: (dest: Destination, ids: string[]) => void;
  models: ModelStatus[];
  onOpenBoard?: (project: string) => void;
  /** Which comics kept their story, so the page knows what it can offer. */
  reopenable: ReadonlySet<string>;
  onDeleteAll: (items: VaultItem[]) => Promise<void>;
}) {
  const head = members[0];
  const name = head.project_name || "Picture board";
  /**
   * Which composition of the open board is being shown.
   *
   * Empty means the most recent one, which is what someone opening a comic
   * wants. Kept as an id rather than an index so it survives the board being
   * composed again while the library is open.
   */
  const [selectedRun, setSelectedRun] = useState("");
  // A composition id belongs to one board. Carried into another it selects
  // nothing, and the fallback would quietly show the latest instead -- right
  // by accident, and wrong the moment the fallback changes.
  useEffect(() => { setSelectedRun(""); }, [head.project]);
  const [binding, setBinding] = useState(false);
  const [busy, setBusy] = useState(false);
  // Deleting a whole board asks once. It is the one delete here that the
  // library's undo does not cover, because it is many items in one press and
  // the vault is the only copy.
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { setConfirm(false); }, [head.project]);
  // An armed delete is disarmed by anything else happening: Escape, focus
  // going somewhere else, or five seconds passing. A destructive button left
  // loaded is how a later, unrelated press deletes a whole comic.
  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(false), 5000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setConfirm(false); };
    window.addEventListener("keydown", onKey);
    return () => { window.clearTimeout(timer); window.removeEventListener("keydown", onKey); };
  }, [confirm]);

  // Opening a comic replaces the whole screen, so focus goes to its title.
  // Left where it was -- on a tile that is now hidden -- a keyboard or
  // screen-reader user is nowhere at all (WCAG 2.4.3).
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [head.project]);

  /**
   * The words of the comic, for anyone who cannot read them off the page.
   *
   * The lettering is drawn into the page pictures, so a page's alt text is
   * all a screen reader gets. The vault does not record which panel landed on
   * which page, but a comic saved with its board does keep every panel's
   * caption and dialogue, in reading order, and that is the script.
   */
  const [script, setScript] = useState<Panel[] | null>(null);
  const canReopen = !!head.project && reopenable.has(head.project);
  useEffect(() => {
    setScript(null);
    if (!canReopen || !head.project) return;
    let live = true;
    void loadSavedBoard(head.project).then((saved) => {
      if (!live || !saved || !Array.isArray(saved.panels)) return;
      // Only what was drawn is on the pages; a planned panel never drawn is
      // not part of what someone is reading.
      const drawn = Array.isArray(saved.drawn) ? saved.drawn : null;
      setScript(saved.panels.filter((_, i) => !drawn || drawn[i]));
    }).catch(() => { /* no script is not an error: the pages still read */ });
    return () => { live = false; };
  }, [head.project, canReopen]);

  // One composition is one comic; see `compositions`. Newest last, as the
  // project sort already put them, so the current one is at the end.
  const runs = compositions(members);
  const current = runs.length
    ? (runs.find((r) => r.id === selectedRun) ?? runs[runs.length - 1])
    : null;
  const pagesOf = current?.pages ?? [];
  const panelsOf = members.filter((i) => i.project_index != null && i.model !== "composed");
  const sheets = members.filter((i) => i.project_index == null && i.model !== "composed");
  // A bound PDF is stamped `composed` like the pages are, so it matched
  // neither list above and was nowhere on this screen once bound.
  const bound = members.filter(isPdf);
  const total = members.reduce((n, i) => n + i.bytes, 0);

  return (
    <div className="board-view">
      <button className="btn small" onClick={onBack} style={{ marginBottom: 14 }}>
        ← Back to vault
      </button>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }} ref={heading} tabIndex={-1}>{name}</h2>
        {/* Pages first, because the pages are what was made. The panels and
            the sheets are how it was made, and leading with "12 panels"
            described the machinery to someone looking for their comic. */}
        <span style={{ fontSize: 12, color: "var(--text-faint)" }}>
          {pagesOf.length
            ? `${pagesOf.length} page${pagesOf.length === 1 ? "" : "s"}`
            : "no pages composed yet"}
          {` · ${panelsOf.length} panel${panelsOf.length === 1 ? "" : "s"}`}
          {" · "}{fmtBytes(total)}
          {" · "}{new Date(head.created_at).toLocaleDateString()}
        </span>
      </div>

      {runs.length > 1 && (
        // A board composed more than once. The older pages are still here
        // and still worth looking at -- they are what the comic used to be
        // -- but they are a different comic, and everything below acts on
        // exactly one of them.
        <div style={{ display: "flex", alignItems: "center", gap: 6,
                      flexWrap: "wrap", marginTop: 10 }}>
          <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
            Composed {runs.length} times:
          </span>
          {runs.map((r, i) => (
            <button key={r.id || "unknown"}
                    className={"btn small" + (r === current ? " primary" : "")}
                    onClick={() => setSelectedRun(r.id)}>
              {r.id
                ? `${i === runs.length - 1 ? "Latest" : `Version ${i + 1}`}`
                  + ` · ${r.pages.length} page${r.pages.length === 1 ? "" : "s"}`
                : `Earlier · ${r.pages.length} page`
                  + `${r.pages.length === 1 ? "" : "s"}`}
            </button>
          ))}
          {!current?.id && (
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
              These pages were composed before versions were recorded, so
              which run made them is not known.
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, margin: "14px 0", flexWrap: "wrap" }}>
        {pagesOf.length > 0 && (
          <button className="btn small primary" onClick={() => onRead(pagesOf, 0, name)}>
            Read
          </button>
        )}
        {/* The comic, in one action, named and in order.
            Exporting used to mean picking the two finished pages out of
            seventeen lookalike items and hoping they were the right ones. */}
        {pagesOf.length > 0 && (
          <button className="btn small" disabled={busy}
                  onClick={() => void exportMany(
                    pagesOf.map((it, i) => ({
                      id: it.id,
                      name: `${name.replace(/[\\/:*?"<>|]/g, "-")} — page ${i + 1}.png`,
                    })), notify)}>
            Export the comic ({pagesOf.length} page{pagesOf.length === 1 ? "" : "s"})
          </button>
        )}
        <button className="btn small" disabled={busy}
                onClick={() => void exportMany(members, notify)}>
          Export everything ({members.length})
        </button>
        {pagesOf.length > 0 && (
          // One file, with the reading order inside it. Exporting pages as
          // separate PNGs leaves that order in the file names, and the first
          // person to sort them differently loses it.
          <button
            className="btn small"
            disabled={busy || binding}
            onClick={async () => {
              setBinding(true);
              try {
                await api.bindComic(
                  newJobId(), pagesOf.map((p) => p.id), name,
                  head.project ?? null, head.project_name ?? null, current?.id || null);
                onChanged();
                notify("Bound into a PDF. It is in this comic, ready to export.");
              } catch (e) {
                notify(errText(e), true);
              } finally {
                setBinding(false);
              }
            }}
          >
            {binding ? "Binding…" : "Bind as one PDF"}
          </button>
        )}
        {onOpenBoard && head.project && (
          // The pictures were always here; the comic was not. Its division,
          // its per-panel notes and the character it was drawn against lived
          // in one draft slot that the next story overwrote, so a finished
          // board could be looked at and never worked on again.
          <button
            className="btn small primary"
            disabled={busy || !reopenable.has(head.project)}
            title={reopenable.has(head.project)
              ? "Open this comic in the Board to redraw panels or add notes"
              : "This comic predates per-board saving, so only its pictures were kept"}
            onClick={() => onOpenBoard(head.project!)}
          >
            {reopenable.has(head.project) ? "Open in Board" : "Cannot reopen"}
          </button>
        )}
        {send && (
          <SendTo ids={members.filter((i) => i.mime.startsWith("image/")).map((i) => i.id)}
                  send={send} models={models} compact />
        )}
        <button
          className="btn small danger"
          disabled={busy}
          onBlur={() => setConfirm(false)}
          onClick={async () => {
            if (!confirm) { setConfirm(true); return; }
            setBusy(true);
            try { await onDeleteAll(members); } finally { setBusy(false); setConfirm(false); }
          }}
        >
          {confirm ? "Really delete this whole board? This cannot be undone" : "Delete board"}
        </button>
      </div>

      {/* The comic reads in order, full width, at the shape it was drawn in;
          the materials are still here, folded away, because chapter twelve
          needs the same cast as chapter eleven. */}
      {pagesOf.length > 0 ? (
        <>
          <div className="sub-head">
            {pagesOf.length === 1 ? "The page" : "The comic, in order"}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 22 }}>
            {pagesOf.map((it, i) => (
              <button className="page-sheet" key={it.id}
                      aria-label={`Read from page ${i + 1}`}
                      onClick={() => onRead(pagesOf, i, name)}>
                {/* The button already says "Read from page N"; the picture
                    names the comic, so the two together say which page of
                    what. */}
                <img src={vaultUrl(it.id)} alt={`${name}, page ${i + 1} of ${pagesOf.length}`}
                     loading="lazy" />
                <div className="page-no">Page {i + 1} of {pagesOf.length}</div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="notice" style={{ marginBottom: 18 }}>
          <strong>No pages yet.</strong> The panels are drawn; composing them
          in the Board tab turns them into the pages you read.
        </div>
      )}

      {pagesOf.length > 0 && script && script.some((p) => p.caption || p.dialogue?.length) && (
        <details className="board-script" style={{ marginBottom: 18 }}>
          <summary className="board-summary">Text</summary>
          <ol>
            {script.map((p, i) => (p.caption || p.dialogue?.length) ? (
              <li key={i}>
                {p.caption && <p>{p.caption}</p>}
                {(p.dialogue ?? []).map((d, k) => (
                  <p key={k}>{d.speaker ? <b>{d.speaker}: </b> : null}{d.text}</p>
                ))}
              </li>
            ) : null)}
          </ol>
        </details>
      )}

      {bound.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div className="sub-head">Bound PDFs</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {bound.map((b, i) => (
              <button key={b.id} className="btn small" onClick={() => onView(bound, i)}>
                ▤ {b.name} · {fmtBytes(b.bytes)}
              </button>
            ))}
          </div>
        </div>
      )}

      <details style={{ marginBottom: 12 }} open={pagesOf.length === 0}>
        <summary className="board-summary">Panels ({panelsOf.length})</summary>
        <div className="board-grid">
          {panelsOf.map((it, i) => (
            <button className="board-tile" key={it.id} onClick={() => onView(panelsOf, i)}
                    aria-label={`Panel ${(it.project_index ?? 0) + 1}: ${it.prompt.slice(0, 80)}`}>
              <span className="count">{(it.project_index ?? 0) + 1}</span>
              <img src={vaultUrl(it.id)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      </details>

      {sheets.length > 0 && (
        <details>
          <summary className="board-summary">Cast and places ({sheets.length})</summary>
          <div className="board-grid">
            {sheets.map((it, i) => (
              <button className="board-tile" key={it.id} onClick={() => onView(sheets, i)}
                      aria-label={it.prompt.slice(0, 80) || it.name}>
                <img src={vaultUrl(it.id)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
