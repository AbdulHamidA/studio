import { useCallback, useEffect, useRef, useState } from "react";
import { vaultUrl } from "../lib/api";
import Field from "./Field";
import { Choice } from "./creation";

/** How many strokes Undo can step back through. Each is a full-size copy. */
const UNDO_DEPTH = 12;

/**
 * Paint the region a model is allowed to change.
 *
 * Two canvases sit on top of the picture: one the user paints on, in a colour
 * they can see, and one kept in black and white that is what actually gets
 * sent. Deriving the second from the first at export time would mean
 * round-tripping the display colour back to a threshold, which is lossy and
 * fiddly; keeping both is simpler and exact. Going the other way -- redrawing
 * the visible layer from the mask -- is exact, so Undo and Invert work on the
 * mask alone and repaint the colour from it.
 */
export default function MaskCanvas({
  sourceId, onMaskChange, disabled,
}: {
  sourceId: string;
  /** PNG bytes of the mask, or null when nothing is painted. */
  onMaskChange: (png: Uint8Array | null) => void;
  disabled?: boolean;
}) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const history = useRef<ImageData[]>([]);

  const [brush, setBrush] = useState(48);
  const [erasing, setErasing] = useState(false);
  /** Share of the picture that is painted, 0..1. Also what "painted" means. */
  const [coverage, setCoverage] = useState(0);
  const [canUndo, setCanUndo] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // A rectangle typed in, for anyone who cannot drag a brush (WCAG 2.5.7).
  const [rect, setRect] = useState({ x: 25, y: 25, w: 50, h: 50 });
  const painted = coverage > 0;

  const maskCtx = () => maskRef.current?.getContext("2d") ?? null;

  /** Measure what share is white, and hand the mask on (or null when empty). */
  const publish = useCallback(() => {
    const mask = maskRef.current, ctx = mask?.getContext("2d");
    if (!mask || !ctx || !mask.width || !mask.height) { setCoverage(0); onMaskChange(null); return; }
    const data = ctx.getImageData(0, 0, mask.width, mask.height).data;
    let on = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] > 127) on++;
    const share = on / (mask.width * mask.height);
    setCoverage(share);
    if (share === 0) { onMaskChange(null); return; }
    mask.toBlob(async (blob) => {
      if (!blob) return;
      onMaskChange(new Uint8Array(await blob.arrayBuffer()));
    }, "image/png");
  }, [onMaskChange]);

  /** Redraw the visible layer from the mask: white becomes the paint colour. */
  const repaint = () => {
    const mask = maskRef.current, disp = displayRef.current;
    const mctx = mask?.getContext("2d"), dctx = disp?.getContext("2d");
    if (!mask || !disp || !mctx || !dctx) return;
    const src = mctx.getImageData(0, 0, mask.width, mask.height);
    const out = dctx.createImageData(mask.width, mask.height);
    for (let i = 0; i < src.data.length; i += 4) {
      if (src.data[i] > 127) {
        out.data[i] = 124; out.data[i + 1] = 140; out.data[i + 2] = 255; out.data[i + 3] = 140;
      }
    }
    dctx.putImageData(out, 0, 0);
  };

  /** Keep the mask as it is now, so the next change can be undone. */
  const remember = () => {
    const mask = maskRef.current, ctx = maskCtx();
    if (!mask || !ctx) return;
    history.current.push(ctx.getImageData(0, 0, mask.width, mask.height));
    if (history.current.length > UNDO_DEPTH) history.current.shift();
    setCanUndo(true);
  };

  // Size both canvases to the image's natural pixels, so the exported mask
  // lines up with the source exactly regardless of how it is displayed.
  const onLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.naturalWidth, h = img.naturalHeight;
    setSize({ w, h });

    const mask = document.createElement("canvas");
    mask.width = w; mask.height = h;
    const mctx = mask.getContext("2d");
    if (mctx) { mctx.fillStyle = "#000"; mctx.fillRect(0, 0, w, h); }
    maskRef.current = mask;

    const disp = displayRef.current;
    if (disp) {
      disp.width = w; disp.height = h;
      disp.getContext("2d")?.clearRect(0, 0, w, h);
    }
    history.current = []; setCanUndo(false);
    setCoverage(0);
    onMaskChange(null);
  }, [onMaskChange]);

  const pointAt = (e: React.PointerEvent) => {
    const disp = displayRef.current!;
    const r = disp.getBoundingClientRect();
    // Displayed size differs from natural size; map back into image pixels.
    return {
      x: ((e.clientX - r.left) / r.width) * disp.width,
      y: ((e.clientY - r.top) / r.height) * disp.height,
    };
  };

  const stroke = (from: { x: number; y: number } | null, to: { x: number; y: number }) => {
    const disp = displayRef.current, mask = maskRef.current;
    const dctx = disp?.getContext("2d"), mctx = mask?.getContext("2d");
    if (!dctx || !mctx) return;
    for (const [ctx, colour] of [
      [dctx, erasing ? null : "rgba(124,140,255,0.55)"],
      [mctx, erasing ? "#000" : "#fff"],
    ] as [CanvasRenderingContext2D, string | null][]) {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = brush;
      if (colour === null) {
        // Erasing the visible layer means clearing it, not painting black.
        ctx.globalCompositeOperation = "destination-out";
        ctx.strokeStyle = "rgba(0,0,0,1)";
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = colour;
      }
      ctx.beginPath();
      ctx.moveTo(from?.x ?? to.x, from?.y ?? to.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.globalCompositeOperation = "source-over";
    }
  };

  const clear = () => {
    const mask = maskRef.current, c = maskCtx();
    if (mask && c && painted) remember();
    if (mask && c) {
      c.fillStyle = "#000";
      c.fillRect(0, 0, mask.width, mask.height);
    }
    const disp = displayRef.current;
    disp?.getContext("2d")?.clearRect(0, 0, disp.width, disp.height);
    setCoverage(0);
    onMaskChange(null);
  };

  const undo = () => {
    const prev = history.current.pop();
    const ctx = maskCtx();
    if (prev && ctx) { ctx.putImageData(prev, 0, 0); repaint(); publish(); }
    setCanUndo(history.current.length > 0);
  };

  /** Swap painted and unpainted: "everything but the face" in one step. */
  const invert = () => {
    const mask = maskRef.current, ctx = maskCtx();
    if (!mask || !ctx) return;
    remember();
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, mask.width, mask.height);
    ctx.globalCompositeOperation = "source-over";
    repaint(); publish();
  };

  /** Paint (or erase) the typed rectangle, given in percent of the picture. */
  const fillRect = () => {
    const mask = maskRef.current, ctx = maskCtx();
    if (!mask || !ctx) return;
    remember();
    const clamp = (v: number) => Math.min(100, Math.max(0, v)) / 100;
    const x = clamp(rect.x) * mask.width, y = clamp(rect.y) * mask.height;
    const w = Math.min(clamp(rect.w) * mask.width, mask.width - x);
    const h = Math.min(clamp(rect.h) * mask.height, mask.height - y);
    ctx.fillStyle = erasing ? "#000" : "#fff";
    ctx.fillRect(x, y, w, h);
    repaint(); publish();
  };

  useEffect(() => { history.current = []; setCanUndo(false); clear(); }, [sourceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = Math.round(coverage * 100);
  const described = painted
    ? `Mask: ${pct < 1 ? "under 1" : pct}% of the picture painted`
    : "Mask: nothing painted yet";

  return (
    <div>
      <div style={{
        position: "relative", borderRadius: 8, overflow: "hidden",
        border: "1px solid var(--border)", background: "#0b0d12",
        cursor: disabled ? "default" : "crosshair", touchAction: "none",
      }}>
        <img
          ref={imgRef}
          src={vaultUrl(sourceId)}
          alt=""
          onLoad={onLoad}
          style={{ display: "block", width: "100%" }}
        />
        {/* The picture and the paint over it, as one image with a name that
            says how much is painted -- the one fact the canvas itself
            cannot tell a screen reader. */}
        <canvas
          ref={displayRef}
          role="img"
          aria-label={described}
          style={{
            position: "absolute", inset: 0, width: "100%", height: "100%",
            pointerEvents: disabled ? "none" : "auto",
          }}
          onPointerDown={(e) => {
            if (disabled) return;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            remember();
            drawing.current = true;
            const p = pointAt(e);
            last.current = p;
            stroke(null, p);
          }}
          onPointerMove={(e) => {
            if (!drawing.current || disabled) return;
            const p = pointAt(e);
            stroke(last.current, p);
            last.current = p;
          }}
          onPointerUp={() => {
            drawing.current = false;
            last.current = null;
            publish();
          }}
          onPointerLeave={() => {
            if (drawing.current) { drawing.current = false; last.current = null; publish(); }
          }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
        <Choice
          label="Brush"
          value={erasing ? "erase" : "paint"}
          onChange={(v) => setErasing(v === "erase")}
          options={[["paint", "Paint"], ["erase", "Erase"]] as const}
          disabled={disabled}
        />
        <div className="field" style={{ display: "flex", gap: 6 }}>
          <button className="btn small" onClick={undo} disabled={!canUndo || disabled}>Undo</button>
          <button className="btn small" onClick={invert} disabled={disabled || !size.w}>Invert</button>
          <button className="btn small" onClick={clear} disabled={!painted || disabled}>Clear</button>
        </div>
      </div>
      <Field label={<>Brush size <em aria-hidden="true">{brush}px</em></>}>
        <input
          type="range" min={8} max={160} value={brush}
          aria-valuetext={`${brush} pixels`}
          onChange={(e) => setBrush(+e.target.value)}
        />
      </Field>

      <details className="mask-rect">
        <summary>Mark a rectangle instead</summary>
        <div className="t-help">In percent of the picture. Uses Paint or Erase above.</div>
        <div className="row">
          {(["x", "y", "w", "h"] as const).map((k) => (
            <Field key={k} className="field tight"
              label={{ x: "From left", y: "From top", w: "Width", h: "Height" }[k]}>
              <input type="number" min={0} max={100} value={rect[k]}
                onChange={(e) => setRect({ ...rect, [k]: +e.target.value })} />
            </Field>
          ))}
        </div>
        <button className="btn small" onClick={fillRect} disabled={disabled || !size.w}>
          {erasing ? "Erase this rectangle" : "Paint this rectangle"}
        </button>
      </details>

      <div className="t-help" style={{ marginTop: 6 }}>
        {painted
          ? `${pct < 1 ? "Under 1" : pct}% painted — that area will be regenerated${size.w ? ` (mask ${size.w}×${size.h})` : ""}. Everything else is kept.`
          : "Paint over what you want changed. Nothing is changed until an area is painted."}
      </div>
    </div>
  );
}
