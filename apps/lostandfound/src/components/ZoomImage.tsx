// A photo you can look into: pinch, wheel (ctrl/trackpad pinch), double-tap,
// or the +/- buttons to zoom, drag to pan. Pointer Events carry mouse, touch
// and pen through one code path.
//
// At 1x the frame leaves vertical swipes to the page (`touch-action: pan-y`)
// so a phone can still scroll past the photo; once zoomed, the frame owns
// every gesture. The image is `object-fit: contain` inside the frame, and the
// pan clamp uses the frame's box — slightly generous for a letterboxed photo,
// never able to lose the picture.
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/index.js";

const MAX_SCALE = 6;
const DOUBLE_TAP_SCALE = 2.5;

interface View {
  s: number;
  x: number;
  y: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const { t } = useI18n();
  const frame = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ dist: number; s: number } | null>(null);
  const lastTap = useRef(0);
  const moved = useRef(false);

  // Keep the pan inside the zoomed image's bounds.
  const fit = useCallback((v: View): View => {
    const el = frame.current;
    if (!el) return v;
    const s = clamp(v.s, 1, MAX_SCALE);
    if (s === 1) return { s: 1, x: 0, y: 0 };
    const maxX = ((s - 1) * el.clientWidth) / 2;
    const maxY = ((s - 1) * el.clientHeight) / 2;
    return { s, x: clamp(v.x, -maxX, maxX), y: clamp(v.y, -maxY, maxY) };
  }, []);

  // Zoom to `next`, keeping the point under (cx, cy) — frame-centre relative —
  // where it is.
  const zoomAt = useCallback(
    (next: number, cx: number, cy: number) => {
      const v = viewRef.current;
      const s = clamp(next, 1, MAX_SCALE);
      const k = s / v.s;
      setView(fit({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }));
    },
    [fit],
  );

  const centre = (clientX: number, clientY: number) => {
    const r = frame.current!.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  };

  // Wheel must be a non-passive native listener to preventDefault. Plain wheel
  // zooms only once already zoomed in, or with ctrl (a trackpad pinch), so the
  // page still scrolls past an unzoomed photo.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && viewRef.current.s === 1) return;
      e.preventDefault();
      const p = centre(e.clientX, e.clientY);
      zoomAt(viewRef.current.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), p.x, p.y);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    frame.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) gesture.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: viewRef.current.s };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const [a, b] = [...pointers.current.values()];
    if (a && b && gesture.current) {
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = centre((a.x + b.x) / 2, (a.y + b.y) / 2);
      moved.current = true;
      zoomAt(gesture.current.s * (dist / gesture.current.dist), mid.x, mid.y);
    } else if (viewRef.current.s > 1) {
      const dx = cur.x - prev.x;
      const dy = cur.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) moved.current = true;
      const v = viewRef.current;
      setView(fit({ ...v, x: v.x + dx, y: v.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const wasTap = pointers.current.size === 1 && !moved.current && e.type === "pointerup";
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    // Two quick taps (mouse or touch) toggle zoom at the tapped point.
    if (wasTap) {
      const now = Date.now();
      if (now - lastTap.current < 300) {
        lastTap.current = 0;
        const p = centre(e.clientX, e.clientY);
        if (viewRef.current.s > 1) setView({ s: 1, x: 0, y: 0 });
        else zoomAt(DOUBLE_TAP_SCALE, p.x, p.y);
      } else {
        lastTap.current = now;
      }
    }
  };

  const step = (factor: number) => zoomAt(viewRef.current.s * factor, 0, 0);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = viewRef.current;
    if (e.key === "+" || e.key === "=") step(1.5);
    else if (e.key === "-") step(1 / 1.5);
    else if (e.key === "0") setView({ s: 1, x: 0, y: 0 });
    else if (v.s > 1 && e.key.startsWith("Arrow")) {
      const d = 60;
      const dx = e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0;
      const dy = e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0;
      setView(fit({ ...v, x: v.x + dx, y: v.y + dy }));
    } else return;
    e.preventDefault();
  };

  const zoomed = view.s > 1;

  return (
    <div className="lf-zoom">
      <div
        ref={frame}
        className={`lf-zoom-frame${zoomed ? " is-zoomed" : ""}`}
        tabIndex={0}
        role="group"
        aria-label={alt}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        <img
          className="lf-zoom-img"
          src={src}
          alt={alt}
          draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}
        />
      </div>
      <div className="lf-zoom-tools">
        <button type="button" className="lf-zoom-btn" aria-label={t("lfZoomOut")} disabled={!zoomed} onClick={() => step(1 / 1.5)}>
          −
        </button>
        <button type="button" className="lf-zoom-btn" aria-label={t("lfZoomIn")} disabled={view.s >= MAX_SCALE} onClick={() => step(1.5)}>
          +
        </button>
        <button type="button" className="lf-zoom-btn" disabled={!zoomed} onClick={() => setView({ s: 1, x: 0, y: 0 })}>
          {t("lfZoomReset")}
        </button>
      </div>
      <p className="sd-meta" style={{ margin: "4px 0 0" }}>{t("lfZoomHint")}</p>
    </div>
  );
}
