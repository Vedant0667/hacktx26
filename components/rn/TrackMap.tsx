"use client";
// Race Night track map: the real circuit outline as layered asphalt, the start/finish chequer, grey field dots,
// the followed car in team colour with a halo, the named cars ahead/behind in white with labels, and an optional
// rejoin ghost. Labels avoid the track, the dots and each other (buildScene in lib/tracks.ts). Scales via viewBox.
// Client component (useMemo). Its helpers (placeCars, ghostAt, leaderFractionFor, trackFor) live in lib/tracks.ts so
// server components can call them too.
import { useMemo } from "react";
import { TRACKS, buildScene, geometry, type MapMarker, type MapStyle, type PlacedCar, type TrackKey, type TrackOutline } from "@/lib/tracks";

export type TrackMapSize = "host-lg" | "host" | "host-sm" | "phone-lg" | "phone" | "thumb";

// Nominal render width (px) per preset; stroke and dot sizes are tuned for it, and the svg scales with its box.
const PRESET: Record<TrackMapSize, { width: number; style: MapStyle; scale: number }> = {
  "host-lg": { width: 620, style: "host", scale: 1.15 }, // replay map (H03)
  host: { width: 352, style: "host", scale: 1 }, // freeze Simple (H04)
  "host-sm": { width: 300, style: "host", scale: 1 }, // freeze Advanced (H05)
  "phone-lg": { width: 342, style: "phone", scale: 1 }, // phone replay (P04)
  phone: { width: 212, style: "phone", scale: 1 }, // phone call (P05)
  thumb: { width: 240, style: "host", scale: 1.15 }, // home race cards (H01), no cars
};

export interface TrackMapProps {
  track: TrackOutline | TrackKey;
  // Every car on the lap (e.g. from placeCars). Codes not named below draw as grey field dots.
  cars?: readonly Pick<PlacedCar, "code" | "fraction">[];
  followed?: string | null; // team colour + white ring + halo + big label
  near?: readonly string[]; // white dots with white labels (the cars ahead and behind)
  labelled?: readonly string[]; // grey field dots that still get a grey label
  ghost?: { fraction: number; label?: string | null } | null; // "Box: you rejoin here" (dashed ring)
  safetyCar?: { fraction: number } | null; // yellow SC marker
  caution?: boolean; // SC/VSC: the outer edge turns faint yellow
  team?: string; // followed-car colour; default var(--team) from RNRoot
  size?: TrackMapSize;
  width?: number; // rendered width in px (default: the preset's); height follows the outline's aspect
  variant?: "asphalt" | "silhouette"; // silhouette = one flat stroke in `ink` (lobby card on the team slab)
  ink?: string; // silhouette colour (default currentColor)
  racingLine?: string | null; // thin line on top of the surface (selected race card)
  pulse?: boolean; // gently pulse the followed car's halo (reduced-motion safe)
  ariaLabel: string;
  className?: string;
  style?: React.CSSProperties;
}

const f1 = (n: number) => Math.round(n * 10) / 10;

export function TrackMap({
  track,
  cars = [],
  followed = null,
  near = [],
  labelled = [],
  ghost = null,
  safetyCar = null,
  caution = false,
  team = "var(--team)",
  size = "host",
  width,
  variant = "asphalt",
  ink = "currentColor",
  racingLine = null,
  pulse = false,
  ariaLabel,
  className,
  style,
}: TrackMapProps) {
  const outline = typeof track === "string" ? TRACKS[track] : track;
  const g = geometry(outline);
  const preset = PRESET[size];
  const [, , vw, vh] = g.vb;
  const k = vw / preset.width;
  const w = width ?? preset.width;
  const h = Math.round((w * vh) / vw);

  const nearKey = near.join(",");
  const labelledKey = labelled.join(",");
  const carsKey = cars.map((c) => `${c.code}:${c.fraction.toFixed(4)}`).join(",");
  const scene = useMemo(() => {
    const markers: MapMarker[] = [];
    const nearSet = new Set(nearKey ? nearKey.split(",") : []);
    const labelSet = new Set(labelledKey ? labelledKey.split(",") : []);
    for (const c of cars) {
      if (c.code === followed) markers.push({ code: c.code, fraction: c.fraction, role: "me", label: c.code, prefer: 270 });
      else if (nearSet.has(c.code)) markers.push({ code: c.code, fraction: c.fraction, role: "near", label: c.code });
      else markers.push({ code: c.code, fraction: c.fraction, role: "field", label: labelSet.has(c.code) ? c.code : null, prefer: 270 });
    }
    if (ghost) markers.push({ code: "__ghost", fraction: ghost.fraction, role: "ghost", label: ghost.label ?? null, prefer: 90 });
    if (safetyCar) markers.push({ code: "__sc", fraction: safetyCar.fraction, role: "sc", label: null });
    return buildScene(g, markers, { style: preset.style, k, scale: preset.scale });
    // carsKey stands in for cars (a fresh array each render with the same content must not recompute).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g, carsKey, followed, nearKey, labelledKey, ghost?.fraction, ghost?.label, safetyCar?.fraction, preset.style, preset.scale, k]);

  const { strokes: st, u } = scene;
  const phone = preset.style === "phone";
  const d = outline.d;
  const sm = scene.start;
  const cell = sm.h / 4;

  return (
    <svg
      className={["rn-map", className].filter(Boolean).join(" ")}
      width={w}
      height={h}
      viewBox={outline.viewBox}
      role="img"
      aria-label={ariaLabel}
      style={{ overflow: "visible", ...style }}
    >
      {variant === "silhouette" ? (
        <path d={d} fill="none" stroke={ink} strokeWidth={f1(u(6.8))} strokeLinejoin="round" />
      ) : phone ? (
        <>
          <path d={d} fill="none" stroke={caution ? "#5A4E1E" : "#2A2E36"} strokeWidth={f1(st.edge)} strokeLinejoin="round" />
          <path d={d} fill="none" stroke="#3A3F48" strokeWidth={f1(st.surface)} strokeLinejoin="round" />
          <path d={d} fill="none" stroke={caution ? "rgba(255,212,59,0.5)" : "rgba(255,255,255,0.18)"} strokeWidth={f1(st.centre)} strokeLinejoin="round" />
        </>
      ) : (
        <>
          <path d={d} fill="none" stroke={caution ? "rgba(255,212,59,0.42)" : "rgba(255,255,255,0.20)"} strokeWidth={f1(st.edge)} strokeLinejoin="round" />
          <path d={d} fill="none" stroke="#24282F" strokeWidth={f1(st.asphalt)} strokeLinejoin="round" />
          <path d={d} fill="none" stroke="#333841" strokeWidth={f1(st.surface)} strokeLinejoin="round" />
          <path d={d} fill="none" stroke="rgba(255,255,255,0.16)" strokeWidth={f1(st.centre)} strokeDasharray={`${f1(st.dash[0])} ${f1(st.dash[1])}`} strokeLinejoin="round" />
        </>
      )}
      {racingLine && variant !== "silhouette" && <path d={d} fill="none" stroke={racingLine} strokeWidth={f1(u(2.6))} strokeLinejoin="round" />}

      {/* start/finish chequer across the track */}
      <g transform={`translate(${f1(sm.x)} ${f1(sm.y)}) rotate(${f1(sm.angle)})`} aria-hidden>
        <rect x={f1(-sm.w / 2)} y={f1(-sm.h / 2)} width={f1(sm.w)} height={f1(sm.h)} fill="#FFFFFF" />
        {[0, 1, 2, 3].flatMap((r) =>
          [0, 1].map((c) =>
            (r + c) % 2 === 0 ? <rect key={`${r}${c}`} x={f1(-sm.w / 2 + (c * sm.w) / 2)} y={f1(-sm.h / 2 + r * cell)} width={f1(sm.w / 2)} height={f1(cell)} fill="#07080A" /> : null,
          ),
        )}
      </g>

      {scene.halos.map((hl, i) => (
        <circle key={`h${i}`} className="rn-halo" data-pulse={pulse || undefined} cx={f1(hl.x)} cy={f1(hl.y)} r={f1(hl.r)} fill={team} opacity={0.3} />
      ))}

      {scene.dots.map((dt) => {
        const sw = f1(scene.dotStroke[dt.role]);
        const key = `d-${dt.code}`;
        switch (dt.role) {
          case "field":
            return <circle key={key} cx={f1(dt.x)} cy={f1(dt.y)} r={f1(dt.r)} fill={phone ? "#6B707A" : "#7C828D"} stroke="#07080A" strokeWidth={sw} />;
          case "near":
            return <circle key={key} cx={f1(dt.x)} cy={f1(dt.y)} r={f1(dt.r)} fill="#FFFFFF" stroke="#07080A" strokeWidth={sw} />;
          case "ghost":
            return phone ? (
              <circle key={key} cx={f1(dt.x)} cy={f1(dt.y)} r={f1(dt.r)} fill="#07080A" stroke={team} strokeWidth={sw} strokeDasharray={`${f1(u(3.2))} ${f1(u(2.4))}`} />
            ) : (
              <circle key={key} cx={f1(dt.x)} cy={f1(dt.y)} r={f1(dt.r)} fill="#07080A" fillOpacity={0.6} stroke="#FFFFFF" strokeWidth={sw} strokeDasharray={`${f1(u(3))} ${f1(u(2.4))}`} />
            );
          case "sc":
            return (
              <g key={key}>
                <circle cx={f1(dt.x)} cy={f1(dt.y)} r={f1(dt.r)} fill="#FFD43B" stroke="#07080A" strokeWidth={sw} />
                <text x={f1(dt.x)} y={f1(dt.y + dt.r * 0.4)} textAnchor="middle" fontWeight={900} fontSize={f1(dt.r * 1.1)} fill="#07080A">
                  SC
                </text>
              </g>
            );
          case "me":
            return <circle key={key} cx={f1(dt.x)} cy={f1(dt.y)} r={f1(dt.r)} fill={team} stroke="#FFFFFF" strokeWidth={sw} />;
        }
      })}

      {scene.labels.map((l) => {
        const fill =
          l.role === "field" ? "#A9AEB8" : l.role === "ghost" ? (phone ? team : "#FFFFFF") : l.role === "near" && phone ? "#D5D8DE" : "#FFFFFF";
        const halo = !(phone && l.role === "ghost");
        return (
          <text
            key={`l-${l.code}`}
            x={f1(l.x)}
            y={f1(l.y)}
            textAnchor="middle"
            fontWeight={l.weight}
            fontSize={f1(l.fontSize)}
            letterSpacing={f1(l.fontSize * 0.04)}
            fill={fill}
            stroke={halo ? "#07080A" : undefined}
            strokeWidth={halo ? f1(u(phone ? 3 : 4)) : undefined}
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {l.text}
          </text>
        );
      })}
    </svg>
  );
}
