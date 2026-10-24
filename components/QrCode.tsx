"use client";
// QR code drawn from the qrcode matrix so it uses the colour tokens (bg modules on an ink field).
import QR from "qrcode";
import { useMemo } from "react";

export function QrCode({ value, size = 280, label }: { value: string; size?: number; label: string }) {
  const { n, path } = useMemo(() => {
    const qr = QR.create(value, { errorCorrectionLevel: "M" });
    const count = qr.modules.size;
    let d = "";
    for (let y = 0; y < count; y++)
      for (let x = 0; x < count; x++) if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
    return { n: count, path: d };
  }, [value]);
  const quiet = 4;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${n + quiet * 2} ${n + quiet * 2}`}
      className="bg-ink text-bg"
      shapeRendering="crispEdges"
    >
      <path d={path} fill="currentColor" />
    </svg>
  );
}
