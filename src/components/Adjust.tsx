import { useCallback, useEffect, useRef, useState } from "react";
import { api, errText, vaultUrl } from "../lib/api";
import Field from "./Field";
import { Choice, Toggle } from "./creation";

type Rect = { x: number; y: number; w: number; h: number };

const ASPECTS: [string, number | null][] = [
  ["Free", null], ["Square", 1], ["4:3", 4 / 3], ["3:4", 3 / 4],
  ["16:9", 16 / 9], ["9:16", 9 / 16],
];

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** The pixel size of the picture once turned by `deg`: its bounding box. */
export function turnedSize(w: number, h: number, deg: number) {
  const a = deg * (Math.PI / 180);
  const cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  return {
    w: Math.max(1, Math.round(w * cos + h * sin)),
    h: Math.max(1, Math.round(w * sin + h * cos)),
  };
}

/**
 * The largest upright rectangle that fits inside a `w`×`h` picture turned by
 * `deg`, as a share of the turned picture's bounding box, centred.
 *
 * Straightening used to save the whole bounding box, so every straightened
 * picture came back with four transparent triangles in its corners. Cropping
 * to this rectangle is what a photo editor does when it straightens, and it
 * is the most picture that can be kept without them.
 */
export function inscribedBounds(w: number, h: number, quarter: number, straighten: number): Rect {
  if (!w || !h || straighten === 0) return FULL;
  // A quarter turn swaps the sides; only the fine angle leaves corners.
  const [qw, qh] = quarter % 2 ? [h, w] : [w, h];
  const a = Math.abs(straighten) * (Math.PI / 180);
  const sin = Math.sin(a), cos = Math.cos(a);
  const long = Math.max(qw, qh), short = Math.min(qw, qh);
  let wr: number, hr: number;
  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-10) {
    const x = short / 2;
    [wr, hr] = qw >= qh ? [x / sin, x / cos] : [x / cos, x / sin];
  } else {
    const cos2 = cos * cos - sin * sin;
    wr = (qw * cos - qh * sin) / cos2;
    hr = (qh * cos - qw * sin) / cos2;
  }
  const box = turnedSize(w, h, quarter * 90 + straighten);
  const bw = Math.min(1, wr / box.w), bh = Math.min(1, hr / box.h);
  return { x: (1 - bw) / 2, y: (1 - bh) / 2, w: bw, h: bh };
}

/** `r` limited to `b`, keeping as much of it as fits. */
function within(r: Rect, b: Rect): Rect {
  const x = Math.min(Math.max(r.x, b.x), b.x + b.w);
  const y = Math.min(Math.max(r.y, b.y), b.y + b.h);
  return {
    x, y,
    w: Math.max(0, Math.min(r.x + r.w, b.x + b.w) - x),
    h: Math.max(0, Math.min(r.y + r.h, b.y + b.h) - y),
  };
}

/**
 * Crop, rotate, straighten and flip.
 *
 * None of this needs a model. Doing it here is instant and lossless where the
 * operation allows, instead of asking a diffusion model to reproduce a picture
 * it was only meant to reframe.
 *
 * The crop is kept as a share of the turned picture -- the thing that is
 * saved -- and only converted to screen positions to draw it. It used to be a
 * share of the on-screen box, which after a quarter turn is not the same
 * shape as the picture inside it, so the size it quoted and the area it
 * saved were both of something else.
 */
export default function Adjust({
  sourceId, onSaved, notify,
}: {
  sourceId: string;
  onSaved: (newId: string) => void;
  notify: (m: string, bad?: boolean) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ ox: number; oy: number } | null>(null);

  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [crop, setCrop] = useState<Rect | null>(null);
  const [aspect, setAspect] = useState<number | null>(null);
  const [quarter, setQuarter] = useState(0);      // 90-degree steps
  const [straighten, setStraighten] = useState(0); // fine angle, degrees
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [busy, setBusy] = useState(false);

  const onLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setCrop(null);
  }, []);

  useEffect(() => {
    setQuarter(0); setStraighten(0); setFlipH(false); setFlipV(false); setCrop(null);
  }, [sourceId]);

  const turned = turnedSize(natural.w, natural.h, quarter * 90 + straighten);
  const bounds = inscribedBounds(natural.w, natural.h, quarter, straighten);
  // What will actually be saved: the selection, or when straightened with no
  // selection, the largest clean rectangle.
  const effective = crop ? within(crop, bounds) : straighten !== 0 ? bounds : null;

  // A selection made against one angle is still inside the clean area at the
  // next one, or trimmed to it.
  useEffect(() => {
    setCrop((c) => (c ? within(c, bounds) : c));
  }, [straighten, quarter, natural.w, natural.h]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Fit `r` to the aspect, growing from its top-left corner, inside bounds. */
  const applyAspect = (r: Rect, a: number | null): Rect => {
    const availableW = Math.max(0, bounds.x + bounds.w - r.x);
    const availableH = Math.max(0, bounds.y + bounds.h - r.y);
    if (!a || !natural.w || !natural.h) {
      return { ...r, w: Math.min(r.w, availableW), h: Math.min(r.h, availableH) };
    }
    // Shares of the turned picture, so correct for its own proportions
    // before enforcing the requested output shape.
    const normalisedAspect = a * turned.h / turned.w;
    let w = Math.min(r.w, availableW);
    let h = w / normalisedAspect;
    if (h > availableH) {
      h = availableH;
      w = Math.min(availableW, h * normalisedAspect);
    }
    return { ...r, w, h };
  };

  /**
   * The largest crop of this shape, centred in the clean area.
   *
   * Picking a shape used to do nothing until you dragged, and dragging was
   * the only way to crop at all. Now a click makes a crop, which can then be
   * nudged with the number fields -- no pointer needed (WCAG 2.5.7).
   */
  const centred = (a: number | null): Rect => {
    if (!a) return bounds;
    const bw = bounds.w * turned.w, bh = bounds.h * turned.h;
    const w = Math.min(bw, bh * a), h = w / a;
    const cw = w / turned.w, ch = h / turned.h;
    return { x: 0.5 - cw / 2, y: 0.5 - ch / 2, w: cw, h: ch };
  };

  /**
   * Where the turned picture sits inside the on-screen box, as shares of it.
   *
   * A CSS transform does not affect layout, so the box keeps the unturned
   * picture's proportions while the turned one is scaled to fit inside it.
   * Worked in units of the box's width, so the width itself cancels: the
   * unturned picture is 1 wide by `ratio` tall, and its turned bounding box
   * is the usual cos/sin combination of the two.
   */
  const ratio = natural.w > 0 ? natural.h / natural.w : 1;
  const angle = (quarter * 90 + straighten) * (Math.PI / 180);
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  const turnedW = cos + ratio * sin;
  const turnedH = sin + ratio * cos;
  const fit = Math.min(1 / (turnedW || 1), ratio / (turnedH || 1), 1);
  const frame = {
    w: turnedW * fit, h: (turnedH * fit) / ratio,
    x: (1 - turnedW * fit) / 2, y: (1 - (turnedH * fit) / ratio) / 2,
  };

  const pointIn = (e: React.PointerEvent) => {
    const r = boxRef.current!.getBoundingClientRect();
    const bx = (e.clientX - r.left) / (r.width || 1);
    const by = (e.clientY - r.top) / (r.height || 1);
    return {
      x: Math.min(bounds.x + bounds.w, Math.max(bounds.x, (bx - frame.x) / (frame.w || 1))),
      y: Math.min(bounds.y + bounds.h, Math.max(bounds.y, (by - frame.y) / (frame.h || 1))),
    };
  };

  const reset = () => {
    setCrop(null); setQuarter(0); setStraighten(0); setFlipH(false); setFlipV(false);
  };

  const dirty = !!crop || quarter !== 0 || straighten !== 0 || flipH || flipV;

  const save = async () => {
    const img = imgRef.current;
    if (!img) return;
    setBusy(true);
    try {
      // Turn first, then cut what was actually selected.
      //
      // This was the other way round -- crop the source, rotate the result --
      // while the preview turns the picture on screen with a CSS transform. So
      // the rectangle was drawn over a rotated image and applied to an
      // unrotated one: after a quarter turn a horizontal drag took a vertical
      // band out of the source, and the saved picture was of somewhere else.
      // The selection is a share of the turned picture, so the thing it has
      // to be applied to is the turned picture.
      const rotW = turned.w, rotH = turned.h;

      const turnedCanvas = document.createElement("canvas");
      turnedCanvas.width = rotW; turnedCanvas.height = rotH;
      const tctx = turnedCanvas.getContext("2d")!;
      tctx.translate(rotW / 2, rotH / 2);
      tctx.rotate(angle);
      tctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      tctx.drawImage(img, -natural.w / 2, -natural.h / 2);

      const c = effective ?? FULL;
      const sx = c.x * rotW, sy = c.y * rotH, sw = c.w * rotW, sh = c.h * rotH;

      const out = document.createElement("canvas");
      const outW = Math.max(1, Math.round(sw));
      const outH = Math.max(1, Math.round(sh));
      out.width = outW; out.height = outH;
      out.getContext("2d")!.drawImage(turnedCanvas, sx, sy, sw, sh, 0, 0, outW, outH);

      const blob = await new Promise<Blob | null>((r) => out.toBlob(r, "image/png"));
      if (!blob) throw new Error("could not render the result");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const id = await api.vaultImportBytes(bytes, "adjusted.png", "image/png", "adjust");
      notify(`Saved ${outW}×${outH}.`);
      onSaved(id);
      reset();
    } catch (e) {
      notify(errText(e), true);
    } finally {
      setBusy(false);
    }
  };

  const preview = {
    transform: `rotate(${quarter * 90 + straighten}deg) `
      + `scale(${fit * (flipH ? -1 : 1)}, ${fit * (flipV ? -1 : 1)})`,
    transition: "transform .12s",
  };

  // The selection in pixels of the turned picture, for the number fields.
  const px = effective
    ? {
        x: Math.round(effective.x * turned.w), y: Math.round(effective.y * turned.h),
        w: Math.round(effective.w * turned.w), h: Math.round(effective.h * turned.h),
      }
    : { x: 0, y: 0, w: turned.w, h: turned.h };

  /** Set one side of the selection from a typed pixel value. */
  const setPx = (k: keyof Rect, value: number) => {
    if (!natural.w || Number.isNaN(value)) return;
    const base = effective ?? FULL;
    const share = k === "x" || k === "w" ? value / turned.w : value / turned.h;
    let next: Rect = { ...base, [k]: share };
    if (aspect && k === "h") {
      // A locked shape follows whichever side was typed.
      next = { ...next, w: (share * turned.h * aspect) / turned.w };
    }
    setCrop(within(applyAspect(next, aspect), bounds));
  };

  const onScreen = (r: Rect) => ({
    left: `${(frame.x + r.x * frame.w) * 100}%`,
    top: `${(frame.y + r.y * frame.h) * 100}%`,
    width: `${r.w * frame.w * 100}%`,
    height: `${r.h * frame.h * 100}%`,
  });

  return (
    <div>
      <div
        ref={boxRef}
        style={{
          position: "relative", overflow: "hidden", borderRadius: 8,
          border: "1px solid var(--border)", background: "#0b0d12",
          cursor: "crosshair", touchAction: "none",
        }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          const p = pointIn(e);
          drag.current = { ox: p.x, oy: p.y };
          setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const p = pointIn(e);
          const { ox, oy } = drag.current;
          setCrop(applyAspect({
            x: Math.min(ox, p.x), y: Math.min(oy, p.y),
            w: Math.abs(p.x - ox), h: Math.abs(p.y - oy),
          }, aspect));
        }}
        onPointerUp={() => {
          drag.current = null;
          // A stray click is not a crop.
          setCrop((c) => (c && (c.w < 0.02 || c.h < 0.02) ? null : c));
        }}
      >
        <img
          ref={imgRef} src={vaultUrl(sourceId)} onLoad={onLoad}
          alt={`The picture being adjusted${effective ? `, cropped to ${px.w}×${px.h}` : ""}`}
          /* Fetched as a CORS request so the canvas that saves the result is
             not tainted by it. `vault://` is a different origin from the page,
             and without this the rotate-and-crop save threw SecurityError --
             "The operation is insecure." -- at `toBlob`, which is the last
             step, after the work. Needs the matching
             `Access-Control-Allow-Origin` on the protocol in lib.rs: with
             `crossOrigin` set and no such header the image does not load at
             all, so the two only work together. */
          crossOrigin="anonymous"
          style={{ display: "block", width: "100%", ...preview }}
        />
        {effective && (
          <>
            {/* Dim everything outside the selection. */}
            <div style={{
              position: "absolute", pointerEvents: "none", ...onScreen(effective),
              boxShadow: `0 0 0 9999px rgba(8,9,13,.62)`,
            }} />
            <div style={{
              position: "absolute", pointerEvents: "none", ...onScreen(effective),
              outline: "1px solid var(--accent)",
            }} />
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <button className="btn small" onClick={() => { setQuarter((q) => (q + 3) % 4); setCrop(null); }}>↺ Left</button>
        <button className="btn small" onClick={() => { setQuarter((q) => (q + 1) % 4); setCrop(null); }}>↻ Right</button>
        <Toggle on={flipH} onChange={setFlipH}>Flip ↔</Toggle>
        <Toggle on={flipV} onChange={setFlipV}>Flip ↕</Toggle>
        <button className="btn small" disabled={!dirty} onClick={reset}>Reset</button>
      </div>

      <Field
        className="field adjust-straighten"
        label={<>Straighten <em aria-hidden="true">{straighten.toFixed(1)}°</em></>}
        hint={straighten !== 0 ? "Trimmed to the largest rectangle with no empty corners." : undefined}
      >
        <input type="range" min={-15} max={15} step={0.5} value={straighten}
          aria-valuetext={`${straighten.toFixed(1)} degrees`}
          onChange={(e) => setStraighten(+e.target.value)} />
      </Field>

      <Choice
        label="Crop shape"
        value={ASPECTS.findIndex(([, a]) => a === aspect)}
        onChange={(i) => {
          const a = ASPECTS[i][1];
          setAspect(a);
          // A shape is a crop: the largest of it, centred. Free keeps
          // whatever is selected and only unlocks the proportions.
          if (a) setCrop(centred(a));
        }}
        options={ASPECTS.map(([label], i) => [i, label] as const)}
      />

      <div className="row adjust-xywh">
        {(["x", "y", "w", "h"] as const).map((k) => (
          <Field key={k} className="field tight"
            label={{ x: "Left", y: "Top", w: "Width", h: "Height" }[k]}>
            <input type="number" min={0} value={px[k]}
              disabled={!natural.w}
              max={k === "x" || k === "w" ? turned.w : turned.h}
              onChange={(e) => setPx(k, +e.target.value)} />
          </Field>
        ))}
      </div>
      <div className="t-note" style={{ marginBottom: 10 }}>
        {effective
          ? `Cropping to ${px.w}×${px.h}`
          : "Drag on the picture, pick a shape, or type a size to crop. Nothing selected keeps the whole frame."}
      </div>

      <button className="btn primary full" disabled={busy || !dirty} onClick={save}>
        {busy ? "Saving…" : "Save as a new picture"}
      </button>
      <div className="t-help" style={{ marginTop: 6 }}>
        Saved into your vault as a new item. The original is untouched.
      </div>
    </div>
  );
}
