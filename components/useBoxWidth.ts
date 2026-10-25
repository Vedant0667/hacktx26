"use client";
// The rendered width of a chart's box, so an SVG can use a 1:1 viewBox and keep its labels at their set size
// however wide the host screen draws it. A callback ref, so the observer follows the element even when the
// chart first renders an empty state and the box mounts later. Falls back to `fallback` until measured.
import { useCallback, useLayoutEffect, useState } from "react";

export function useBoxWidth<T extends Element>(fallback: number, enabled = true) {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(fallback);
  const ref = useCallback((node: T | null) => setEl(node), []);
  useLayoutEffect(() => {
    if (!el || !enabled) return;
    const read = (w: number) => {
      const v = Math.round(w);
      if (v > 0) setWidth(v);
    };
    read(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => read(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el, enabled]);
  return [ref, width] as const;
}
