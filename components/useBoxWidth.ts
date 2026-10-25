"use client";
// The rendered width of a chart's box, so an SVG can use a 1:1 viewBox and keep its labels at their set size
// however wide the host screen draws it. Falls back to `fallback` until the first measure.
import { useEffect, useRef, useState } from "react";

export function useBoxWidth<T extends Element>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
