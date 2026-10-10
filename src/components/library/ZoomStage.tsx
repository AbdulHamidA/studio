import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { centred, clampView, fitScale, zoomAbout, type Size, type View } from "../../lib/library";

export interface ZoomHandle {
  fit: () => void;
  actual: () => void;
  zoomBy: (factor: number) => void;
  /**
   * Move a zoomed picture by this many pixels. A positive dx shows more of
   * the right-hand side, the way an arrow key reads: the view moves, not the
   * picture. Does nothing at fit, where there is nothing to pan to.
   */
  panBy: (dx: number, dy: number) => void;
}

/**
 * A picture you can look into.
 *
 * Fits by default, never enlarging a small one. The wheel (or a trackpad
 * pinch, which WebKit reports as a wheel with ctrl held) zooms about the
 * pointer; dragging pans once there is something to pan to; double-click
 * flips between fitting and real pixels, centred on where you clicked.
 */
const ZoomStage = forwardRef<ZoomHandle, {
  src: string;
  alt: string;
  /** Recorded dimensions, so the first frame is laid out before decoding. */
  width?: number | null;
  height?: number | null;
  onScale?: (scale: number, fit: number) => void;
  onError?: () => void;
}>(function ZoomStage({ src, alt, width, height, onScale, onError }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const [nat, setNat] = useState<Size>({ w: width ?? 0, h: height ?? 0 });
  const [boxSize, setBoxSize] = useState<Size>({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null); // null: fit
  const drag = useRef<{ x: number; y: number; v: View } | null>(null);

  useEffect(() => { setNat({ w: width ?? 0, h: height ?? 0 }); setView(null); }, [src, width, height]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setBoxSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = fitScale(nat, boxSize);
  const shown = view ?? centred(fit, nat, boxSize);
  useEffect(() => { onScale?.(shown.scale, fit); }, [shown.scale, fit, onScale]);

  const setScaleAt = useCallback((scale: number, point?: { x: number; y: number }) => {
    const p = point ?? { x: boxSize.w / 2, y: boxSize.h / 2 };
    const next = zoomAbout(shown, scale, p, nat, boxSize);
    setView(Math.abs(next.scale - fit) < 1e-3 ? null : next);
  }, [shown, nat, boxSize, fit]);

  useImperativeHandle(ref, () => ({
    fit: () => setView(null),
    actual: () => setView(clampView(centred(1, nat, boxSize), nat, boxSize)),
    zoomBy: (factor: number) => setScaleAt(shown.scale * factor),
    // Dragging was the only way to look around a zoomed picture, which left
    // the keyboard able to zoom in and then stuck there (WCAG 2.1.1).
    panBy: (dx: number, dy: number) => {
      if (!view) return;
      setView(clampView({ scale: view.scale, x: view.x - dx, y: view.y - dy }, nat, boxSize));
    },
  }), [nat, boxSize, setScaleAt, shown.scale, view]);

  // React's wheel listener is passive, and a passive listener cannot stop the
  // page from scrolling underneath, so this one is attached by hand.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      setScaleAt(shown.scale * factor, { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setScaleAt, shown.scale]);

  const zoomed = shown.scale > fit + 1e-3;

  return (
    <div
      ref={box}
      className={"zoom-stage" + (zoomed ? " zoomed" : "")}
      onDoubleClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const p = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (zoomed) setView(null);
        else setScaleAt(Math.max(1, fit * 2), p);
      }}
      onPointerDown={(e) => {
        if (!zoomed || e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, v: shown };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        setView(clampView({ scale: d.v.scale, x: d.v.x + e.clientX - d.x, y: d.v.y + e.clientY - d.y },
                          nat, boxSize));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        onLoad={(e) => {
          const img = e.currentTarget;
          if (img.naturalWidth && (img.naturalWidth !== nat.w || img.naturalHeight !== nat.h)) {
            setNat({ w: img.naturalWidth, h: img.naturalHeight });
          }
        }}
        onError={onError}
        style={nat.w && boxSize.w ? {
          width: nat.w, height: nat.h,
          transform: `translate(${shown.x}px, ${shown.y}px) scale(${shown.scale})`,
        } : { maxWidth: "100%", maxHeight: "100%", position: "static", margin: "auto" }}
      />
    </div>
  );
});

export default ZoomStage;
