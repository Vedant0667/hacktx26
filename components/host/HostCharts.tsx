// Host-screen charts in plain SVG with currentColor: a labelled line chart with gridlines (replay) and the
// reveal's box-minus-stay bars. Sized for the 2 m read.
import { COPY } from "@/lib/copy";
import type { LapFrame } from "@/lib/types";

export interface Line {
  label: string;
  values: (number | null)[];
  // 0: the player (heavy), 1: dashed, 2+: light.
  tier: number;
}

const niceStep = (span: number) => {
  const raw = span / 3;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * p;
};

export function LineChart({
  lines,
  xLabels,
  width = 560,
  height = 220,
  labelRight = 64,
  invert = false,
  minSpan = 1,
  decimals = 1,
}: {
  lines: Line[];
  xLabels: string[];
  width?: number;
  height?: number;
  labelRight?: number;
  // invert: smaller values plot higher (lap times: faster is up).
  invert?: boolean;
  minSpan?: number;
  decimals?: number;
}) {
  const vals = lines.flatMap((l) => l.values).filter((v): v is number => v != null);
  if (vals.length < 2 || xLabels.length < 2) return <p className="text-base">{COPY.tele.noTimes}</p>;
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < minSpan) {
    const m = (hi + lo) / 2;
    lo = m - minSpan / 2;
    hi = m + minSpan / 2;
  }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const L = 44;
  const R = width - labelRight;
  const T = 8;
  const B = height - 24;
  const n = xLabels.length;
  const x = (i: number) => L + (i / (n - 1)) * (R - L);
  const y = (v: number) => (invert ? T + ((v - lo) / (hi - lo)) * (B - T) : B - ((v - lo) / (hi - lo)) * (B - T));
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 1000) / 1000);
  const every = Math.ceil(n / 8);
  const style = (tier: number) =>
    tier === 0
      ? { strokeWidth: 2.75, strokeOpacity: 1, dash: undefined }
      : tier === 1
        ? { strokeWidth: 1.75, strokeOpacity: 0.65, dash: "5 4" }
        : { strokeWidth: 1.5, strokeOpacity: 0.4, dash: undefined };
  // End labels, nudged apart so they never overlap.
  const ends = lines
    .map((l) => {
      let i = l.values.length - 1;
      while (i >= 0 && l.values[i] == null) i--;
      return i < 0 ? null : { l, i, y: y(l.values[i] as number) };
    })
    .filter((e): e is { l: Line; i: number; y: number } => !!e)
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 13) ends[k].y = ends[k - 1].y + 13;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" aria-hidden>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={R} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity=".18" />
          <text x={L - 6} y={y(v) + 3.5} fontSize="10" textAnchor="end" fill="currentColor" fillOpacity=".75" className="font-mono">
            {v.toFixed(decimals)}
          </text>
        </g>
      ))}
      {xLabels.map((t, i) =>
        i % every === 0 || i === n - 1 ? (
          <text key={i} x={x(i)} y={height - 6} fontSize="10" textAnchor="middle" fill="currentColor" fillOpacity=".75" className="font-mono">
            {t}
          </text>
        ) : null,
      )}
      {[...lines].reverse().map((l) => {
        const s = style(l.tier);
        let d = "";
        let pen = false;
        l.values.forEach((v, i) => {
          if (v == null) return void (pen = false);
          d += `${pen ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
          pen = true;
        });
        return <path key={l.label} d={d} fill="none" stroke="currentColor" strokeWidth={s.strokeWidth} strokeOpacity={s.strokeOpacity} strokeDasharray={s.dash} strokeLinejoin="round" />;
      })}
      {ends.map((e) =>
        e.l.tier === 0 ? <rect key={`m-${e.l.label}`} x={x(e.i) - 3.5} y={y(e.l.values[e.i] as number) - 3.5} width="7" height="7" fill="currentColor" /> : null,
      )}
      {ends.map((e) => (
        <text
          key={`t-${e.l.label}`}
          x={x(e.i) + 9}
          y={e.y + 4}
          fontSize="11"
          fontWeight={e.l.tier === 0 ? 700 : 500}
          fill="currentColor"
          fillOpacity={e.l.tier === 0 ? 1 : 0.75}
          className="font-mono"
        >
          {e.l.label}
        </text>
      ))}
    </svg>
  );
}

// Box group minus stay group, per lap: positive bars are filled (boxing ahead), negative outlined.
export function DiffBars({ laps, values, upto, height = 420 }: { laps: number[]; values: (number | null)[]; upto: number; height?: number }) {
  const vals = values.filter((v): v is number => v != null);
  if (laps.length < 2 || !vals.length) return null;
  const lim = Math.max(5, Math.ceil(Math.max(...vals.map(Math.abs)) / 5) * 5);
  const W = 1328;
  const L = 52;
  const T = 8;
  const B = height - 24;
  const mid = (T + B) / 2;
  const bw = (W - L - 8) / laps.length;
  const y = (v: number) => mid - (v / lim) * (mid - T);
  const ticks = [lim, lim / 2, 0, -lim / 2, -lim];
  const every = Math.ceil(laps.length / 6);
  return (
    <svg viewBox={`0 0 ${W} ${height}`} className="block h-auto w-full" aria-hidden>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.9 : 0.18} strokeWidth={v === 0 ? 1.5 : 1} />
          <text x={L - 8} y={y(v) + 4} fontSize="12" textAnchor="end" fill="currentColor" fillOpacity=".8" className="font-mono">
            {v > 0 ? `+${v}` : v} s
          </text>
        </g>
      ))}
      {laps.map((lap, i) => {
        const v = values[i];
        const shown = lap <= upto && v != null;
        const x0 = L + 4 + i * bw + 1.5;
        return (
          <g key={lap}>
            {shown && (
              <rect
                className="fade"
                x={x0}
                width={Math.max(2, bw - 3)}
                y={v! >= 0 ? y(v!) : mid}
                height={Math.max(1, Math.abs(y(v!) - mid))}
                fill={v! >= 0 ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={v! >= 0 ? 0 : 1.25}
              />
            )}
            {(i % every === 0 || i === laps.length - 1) && (
              <text x={x0 + bw / 2} y={height - 6} fontSize="12" textAnchor="middle" fill="currentColor" fillOpacity=".8" className="font-mono">
                L{lap}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Per-lap box-minus-stay from the full frames, by the ground-truth method: cars within 3 places of the
// player at the call; boxers stopped on the call lap or the next; mean pairwise gap change since lap L-1.
export function boxMinusStay(frames: LapFrame[], callLap: number, toLap: number, me: number) {
  const start = frames.find((f) => f.lap === callLap - 1);
  if (!start) return null;
  const p = start.drivers.find((d) => d.number === me)?.position;
  if (p == null) return null;
  const cohort = start.drivers.filter((d) => Math.abs(d.position - p) <= 3);
  const pitted = new Set(frames.filter((f) => f.lap >= callLap && f.lap <= callLap + 1).flatMap((f) => f.drivers.filter((d) => d.pitted_this_lap).map((d) => d.number)));
  const box = cohort.filter((d) => pitted.has(d.number));
  const stay = cohort.filter((d) => !pitted.has(d.number));
  if (!box.length || !stay.length) return null;
  const g0 = new Map(start.drivers.map((d) => [d.number, d.gap_to_leader_s]));
  const laps: number[] = [];
  const values: (number | null)[] = [];
  for (let lap = callLap; lap <= toLap; lap++) {
    const f = frames.find((x) => x.lap === lap);
    laps.push(lap);
    if (!f) {
      values.push(null);
      continue;
    }
    const g = new Map(f.drivers.map((d) => [d.number, d.gap_to_leader_s]));
    const ds: number[] = [];
    for (const b of box)
      for (const s of stay) {
        const b0 = g0.get(b.number);
        const s0 = g0.get(s.number);
        const b1 = g.get(b.number);
        const s1 = g.get(s.number);
        if (b0 == null || s0 == null || b1 == null || s1 == null) continue;
        ds.push(s1 - s0 - (b1 - b0));
      }
    values.push(ds.length ? Math.round((ds.reduce((a, c) => a + c, 0) / ds.length) * 10) / 10 : null);
  }
  return { laps, values };
}
