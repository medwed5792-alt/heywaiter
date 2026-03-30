"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export function ImageModalViewer({
  imageUrl,
  onClose,
}: {
  imageUrl: string;
  onClose: () => void;
}) {
  const imgAlt = useMemo(() => "Изображение блюда", []);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{
    dist: number;
    scale: number;
  } | null>(null);

  const [scale, setScale] = useState(1);
  const [origin, setOrigin] = useState<{ xPercent: number; yPercent: number }>({ xPercent: 50, yPercent: 50 });
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const computeMidpoint = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const computeDist = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.hypot(dx, dy);
  };

  const updateOriginFromClient = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / Math.max(1, r.width)) * 100;
    const y = ((clientY - r.top) / Math.max(1, r.height)) * 100;
    setOrigin({ xPercent: clamp(x, 0, 100), yPercent: clamp(y, 0, 100) });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pts = Array.from(pointersRef.current.entries());
    if (pts.length === 2) {
      const a = pts[0]![1]!;
      const b = pts[1]![1]!;
      pinchStartRef.current = { dist: computeDist(a, b), scale };
      updateOriginFromClient(computeMidpoint(a, b).x, computeMidpoint(a, b).y);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const prev = pointersRef.current.get(e.pointerId)!;
    const next = { x: e.clientX, y: e.clientY };
    pointersRef.current.set(e.pointerId, next);

    const pts = Array.from(pointersRef.current.values());
    if (pts.length === 2 && pinchStartRef.current) {
      const [a, b] = pts;
      const dist = computeDist(a, b);
      const ratio = dist / Math.max(1, pinchStartRef.current.dist);
      const nextScale = clamp(pinchStartRef.current.scale * ratio, 1, 5);
      setScale(nextScale);
      updateOriginFromClient(computeMidpoint(a, b).x, computeMidpoint(a, b).y);
      return;
    }

    // Панорамирование (только если масштаб > 1).
    if (pts.length === 1 && scale > 1.01) {
      const dx = next.x - prev.x;
      const dy = next.y - prev.y;
      setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    const pts = Array.from(pointersRef.current.values());
    if (pts.length < 2) pinchStartRef.current = null;
  };

  const resetView = () => {
    setScale(1);
    setOrigin({ xPercent: 50, yPercent: 50 });
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      className="fixed inset-0 z-[1000] bg-black/80 p-3"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="mx-auto flex h-full max-w-4xl flex-col">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={resetView}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15"
          >
            Сброс
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/10 p-2 text-white hover:bg-white/15"
            aria-label="Закрыть"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div
          ref={containerRef}
          className="mt-3 flex-1 touch-none select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="flex h-full items-center justify-center">
            <img
              src={imageUrl}
              alt={imgAlt}
              className="max-h-[80vh] max-w-full"
              draggable={false}
              style={{
                transformOrigin: `${origin.xPercent}% ${origin.yPercent}%`,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

