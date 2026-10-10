import { useEffect, useMemo, useState } from "react";
import { api, errText, isCancelled, newJobId, onEngineProgress, onEnginePreview, vaultUrl } from "../lib/api";
import type { EngineProgress, ModelStatus } from "../lib/types";
import { humanDuration } from "../lib/presets";
import { exportItem, ImageDrop, JobProgress } from "./shared";
import SendTo, { type Destination } from "./SendTo";
import Field from "./Field";
import { LiveStatus, RunError, useRunShortcut, useStatus } from "./creation";

const SCALES = ["2x", "3x", "4x", "5x"];

/**
 * Time left, from how far a run has got in how long.
 *
 * There is no measured rate for upscaling to quote up front, but a tiled run
 * reports its fraction as each piece lands, and that is enough to project
 * from once it has started. Null until there is something to project from.
 */
export function projectRemaining(elapsed: number, fraction: number | null | undefined): number | null {
  if (!fraction || fraction <= 0.02 || fraction >= 1 || elapsed < 3) return null;
  return Math.round(elapsed * (1 - fraction) / fraction);
}

export default function Upscale({
  models, notify, onProduced, images: controlledImages, onImagesChange, send,
}: {
  models: ModelStatus[];
  notify: (m: string, bad?: boolean) => void;
  onProduced: () => void;
  images?: string[];
  onImagesChange?: (ids: string[]) => void;
  send?: (dest: Destination, ids: string[]) => void;
}) {
  // What the run looks like part-way. A tiled upscale sends one of these per
  // finished piece, so a multi-minute job shows the picture filling in
  // instead of a bar over a blank frame.
  const [preview, setPreview] = useState<string | null>(null);

  const usable = useMemo(
    () => models.filter((m) => m.installed && m.fit !== "too_much_memory"
      && m.fit !== "broken" && m.tasks.includes("upscale" as never)),
    [models]
  );
  const [modelId, setModelId] = useState("");
  const [localImages, setLocalImages] = useState<string[]>([]);
  const images = controlledImages ?? localImages;
  const setImages = onImagesChange ?? setLocalImages;
  const [resolution, setResolution] = useState("2x");
  // "Memory saver" on screen, the same name as everywhere else in the app.
  const [lowRam, setLowRam] = useState(true);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [prog, setProg] = useState<EngineProgress | null>(null);
  const [out, setOut] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [status, setStatus] = useStatus(prog);
  /** The source's pixel size, so the output size can be stated before running. */
  const [source, setSource] = useState<{ w: number; h: number } | null>(null);

  const model = usable.find((m) => m.id === modelId) ?? usable[0];

  useEffect(() => {
    setSource(null);
    if (!images[0]) return;
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setSource({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = vaultUrl(images[0]);
    return () => { live = false; };
  }, [images[0]]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running) { setElapsed(0); return; }
    const t0 = Date.now();
    const t = window.setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    return () => window.clearInterval(t);
  }, [running]);

  // Distinguish "not installed" from "cannot work at all": the only upscaler
  // in the catalog is blocked by a version conflict, and saying "install one"
  // would send the user to download 2.5 GiB that will never run.
  const blocked = models.filter(
    (m) => m.tasks.includes("upscale" as never) && m.fit === "broken"
  );

  // A retry with Memory saver forced on has to use it now, not after the
  // state update lands, so the override is passed in.
  const run = async (opts: { lowRam?: boolean } = {}) => {
    if (!model || running) return;
    if (images.length === 0) { setMissing(true); return; }
    setMissing(false);
    const id = newJobId();
    // The last result stays, dimmed, until the new one lands: clearing it at
    // the start left a failed run with nothing on screen.
    setFailure(null); setStatus("Starting");
    setRunning(true); setJobId(id); setProg(null);
    setPreview(null);
    const un = await onEngineProgress((p) => { if (p.job_id === id) setProg(p); });
    // If this subscription throws, the progress listener above would
    // never be released. Failing to get a preview is not worth leaking one.
    let unp: (() => void) | undefined;
    try { unp = await onEnginePreview((f) => { if (f.jobId === id) setPreview(f.src); }); }
    catch { unp = undefined; }
    try {
      const res = await api.upscale(id, model.id, images[0], resolution, opts.lowRam ?? lowRam);
      if (res[0]) { setOut(res[0]); setStatus("Done, 1 image."); }
      else setFailure("The engine finished but returned no picture.");
      onProduced();
    } catch (e) {
      if (isCancelled(e)) { setStatus("Cancelled."); notify("Cancelled."); }
      else { setStatus(""); setFailure(errText(e)); }
    } finally {
      un(); unp?.(); setPreview(null); setRunning(false); setJobId(null); setProg(null);
    }
  };

  const shortcut = useRunShortcut(() => { void run(); }, !running && usable.length > 0);

  if (usable.length === 0) {
    return (
      <div className="empty-state">
        <span className="big" aria-hidden="true">⤢</span>
        {blocked.length > 0 ? "Upscaling is unavailable in this build." : "No upscaler installed."}
        {blocked.length > 0 ? (
          <div style={{
            marginTop: 12, fontSize: 12, maxWidth: 520, marginLeft: "auto",
            marginRight: "auto", lineHeight: 1.7, textAlign: "left",
          }}>
            SeedVR2 needs MLX 0.31.0, while the prompt assistant needs 0.31.2, and
            MLX-Gen caps MLX below 0.32 — so no single version runs both. This
            build is pinned to 0.31.2, which keeps generation, editing and prompt
            help working.
            <div style={{ marginTop: 10, color: "var(--text-faint)", fontSize: 11 }}>
              If upscaling matters more than prompt help, downgrading MLX to
              0.31.0 reverses the trade.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 12 }}>
            Install one from <b>Models</b>.
          </div>
        )}
      </div>
    );
  }

  const factor = parseInt(resolution, 10) || 1;
  const outSize = source ? `${source.w * factor}×${source.h * factor}` : null;
  const left = projectRemaining(elapsed, prog?.progress);

  return (
    <div className="content split creation" style={{ padding: 0 }}
         ref={shortcut.ref} onKeyDown={shortcut.onKeyDown}>
      <LiveStatus text={status} />
      <div className="creation-params">
        <div className="panel">
          <h2>Upscale</h2>
          <div className="field">
            <div className="choice-label">Image</div>
            <ImageDrop images={images} onChange={(ids) => { setImages(ids); setMissing(false); }} max={1}
              onError={(m) => notify(m, true)} />
            {missing && <div className="field-error" role="alert">Add a picture to enlarge.</div>}
          </div>
          <Field label="Model">
            <select value={model?.id ?? ""} onChange={(e) => setModelId(e.target.value)}>
              {usable.map((m) => (
                <option key={m.id} value={m.id}>{m.name} — ~{m.peak_gib.toFixed(1)} GiB</option>
              ))}
            </select>
          </Field>
          <Field
            label={<>Scale {outSize && <em>{outSize} pixels</em>}</>}
            hint={source
              ? `From ${source.w}×${source.h} to ${outSize}. Larger output needs more memory.`
              : "Larger output needs more memory; big pictures at 4x or 5x may not fit."}
          >
            <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {SCALES.map((r) => (
                <option key={r} value={r}>
                  {r}{source ? ` — ${source.w * (parseInt(r, 10) || 1)}×${source.h * (parseInt(r, 10) || 1)}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <div className="field">
            <label className="check">
              <input
                type="checkbox" checked={lowRam}
                aria-describedby="upscale-saver-hint"
                onChange={(e) => setLowRam(e.target.checked)}
              />
              Memory saver
            </label>
            <div id="upscale-saver-hint" className="t-help" style={{ marginTop: 5 }}>
              Uses less memory for the large output picture. On by default; it
              is the safe choice.
            </div>
          </div>
        </div>
        <div className="run-footer">
          {running ? (
            <>
              <JobProgress p={prog} label="Upscaling" />
              <div className="t-note run-footer-times">
                <span>{elapsed}s elapsed</span>
                <span>{left != null ? `${humanDuration(left)} left` : "working out how long"}</span>
              </div>
              <button className="btn danger full" style={{ marginTop: 8 }}
                onClick={() => jobId && api.cancelJob(jobId).catch(() => {})}>
                Cancel
              </button>
            </>
          ) : (
            <button className="btn primary full" onClick={() => void run()}
              aria-keyshortcuts="Meta+Enter">
              Upscale{outSize ? ` to ${outSize}` : ""}<span className="kbd" aria-hidden="true">⌘↵</span>
            </button>
          )}
        </div>
      </div>
      <div className="creation-canvas">
        <div className="canvas">
          {failure && !running ? (
            <div className="canvas-stack">
              <RunError
                message={failure}
                onRetry={() => void run()}
                onMemorySaver={lowRam ? undefined : () => { setLowRam(true); void run({ lowRam: true }); }}
              />
              {out && <img className="stale" src={vaultUrl(out)} alt="Previous upscaled picture" />}
            </div>
          ) : running && preview ? (
            <div style={{ textAlign: "center" }}>
              {/* Soft on purpose: pieces are still landing, and this should
                  not be mistaken for the finished picture. */}
              <img src={preview} alt="Preview of the upscale filling in" style={{
                maxWidth: "100%", maxHeight: "58vh", borderRadius: 7, opacity: 0.92,
              }} />
              <div className="t-note" style={{ marginTop: 8 }}>
                {prog?.message ?? "Working…"}
              </div>
            </div>
          ) : out ? (
            <img className={running ? "stale" : undefined} src={vaultUrl(out)}
              alt={running ? "Previous upscaled picture" : "Upscaled picture"} />
          ) : (
            <div className="empty"><span className="big" aria-hidden="true">⤢</span>Restored output appears here.</div>
          )}
        </div>
        {out && !running && (
          <div className="result-actions">
            <button className="btn small" onClick={() => exportItem({ id: out, name: "" }, notify)}>
              Save a copy…
            </button>
            {send && <SendTo ids={[out]} send={send} models={models} exclude={["upscale"]} />}
          </div>
        )}
      </div>
    </div>
  );
}
