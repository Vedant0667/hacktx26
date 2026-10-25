// Telemetry around the player's car at the call moment, in plain SVG with currentColor so it reads on white
// and on the team-colour field. Pieces are shared by the phone call screen and the host freeze screen.
// Simple: lap-time chart (you, car ahead, car behind), gaps with s/lap trends, tyre age and wear, rejoin line.
// Advanced adds: stint chart with an axis, intervals per lap, field tyres, pit loss, stint table, rejoin strip.
import type { ReactNode } from "react";
import { COPY } from "@/lib/copy";
import { compoundLetter, isTight } from "@/lib/client/race";
import type { CarTrend, Telemetry } from "@/lib/client/telemetry";
import type { DataMode } from "@/lib/client/mode";
import type { Call, TrackStatus } from "@/lib/types";
import { Num, TyreChip } from "./ui";
import { useBoxWidth } from "./useBoxWidth";

const W = 350;
// Keep at most about eight lap labels on an axis.
const labelStep = (n: number) => Math.max(1, Math.ceil(n / 8));
const svgText = { fontFamily: "var(--font-sans)" } as const;

// A titled block: 2px rule, small label left, quieter meta right (in its own case: units stay lower case).
export function Sec({ label, meta, children, className = "" }: { label: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`border-t-2 border-current pb-2.5 pt-2.5 ${className}`}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <span className="meta">{label}</span>
        {meta && <span className="nums text-xs font-medium opacity-75">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-1.5 text-sm font-medium leading-snug [&_b]:font-black">{children}</p>;
}

// Lap-time chart. First car is the player (heavy line, square at the last lap); others dashed and light.
export function LapChart({
  laps,
  cars,
  height = 150,
  axis = false,
  values = true,
  status,
  width = W,
  fit = false,
  text = 1,
}: {
  laps: number[];
  cars: (CarTrend | null)[];
  height?: number;
  axis?: boolean;
  values?: boolean;
  // viewBox width when not fitted.
  width?: number;
  // fit: a 1:1 viewBox measured from the box (host), so labels keep their size; text scales every label.
  fit?: boolean;
  text?: number;
  // SC/VSC laps get a shaded band and a flag-yellow tick on the x-axis.
  status?: Record<number, TrackStatus>;
}) {
  const [box, measured] = useBoxWidth<HTMLDivElement>(width, fit);
  const vw = fit ? measured : width;
  const fs = (n: number) => n * text;
  const list = cars.filter((c): c is CarTrend => !!c && c.times.some((t) => t != null));
  const vals = list.flatMap((c) => c.times).filter((t): t is number => t != null);
  if (laps.length < 2 || vals.length < 2) return <p className="text-sm font-medium">{COPY.tele.noTimes}</p>;
  // Robust range: a lap far slower than the median (SC/VSC, pit in or out) does not set the scale. It is drawn
  // in a band just above the normal laps with a caret; its end label keeps the real time.
  const sorted = [...vals].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  let lo = sorted[0];
  const cap = med + Math.max(2.5, (med - lo) * 2);
  let hi = Math.max(...sorted.filter((t) => t <= cap));
  const capped = sorted[sorted.length - 1] > hi;
  if (hi - lo < 0.6) {
    const mid = (hi + lo) / 2;
    lo = mid - 0.3;
    hi = mid + 0.3;
  }
  const left = axis ? fs(40) : 14;
  const right = vw - (values ? fs(100) : fs(44));
  const bottom = height - fs(18);
  const top = capped ? hi + (hi - lo) * 0.3 : hi;
  const x = (i: number) => left + (laps.length === 1 ? 0 : (i / (laps.length - 1)) * (right - left));
  const y = (t: number) => bottom - 8 - ((Math.min(t, top) - lo) / (top - lo)) * (bottom - 16);
  const ticks = axis ? Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, k) => Math.ceil(lo) + k).filter((_, k, arr) => arr.length <= 5 || k % 2 === 0) : [];
  const styles = [
    { w: 2.75, o: 1, dash: undefined },
    { w: 1.75, o: 0.6, dash: "5 4" },
    { w: 1.5, o: 0.4, dash: undefined },
  ];
  const ends = list
    .map((c, k) => {
      let i = c.times.length - 1;
      while (i >= 0 && c.times[i] == null) i--;
      return i < 0 ? null : { k, i, t: c.times[i] as number, code: c.code, y: y(c.times[i] as number) };
    })
    .filter((e): e is NonNullable<typeof e> => !!e)
    .sort((a, b) => a.y - b.y);
  // Keep end labels at least 12 px apart.
  for (let j = 1; j < ends.length; j++) if (ends[j].y - ends[j - 1].y < fs(13)) ends[j].y = ends[j - 1].y + fs(13);
  return (
    <div ref={box}>
    <svg viewBox={`0 0 ${vw} ${height}`} width="100%" className="block overflow-visible" role="img" aria-label={COPY.tele.title}>
      {status &&
        laps.map((l, i) => {
          const st = status[l];
          if (!st || st === "GREEN") return null;
          const half = laps.length > 1 ? (right - left) / (laps.length - 1) / 2 : 10;
          return (
            <g key={`sc-${l}`}>
              <rect x={x(i) - half} y={4} width={half * 2} height={bottom - 4} fill="currentColor" fillOpacity=".1" />
              <rect x={x(i) - half} y={bottom + 1} width={half * 2} height={5} fill="#FBD530" stroke="#0E0E0E" strokeWidth="1" />
              <text x={x(i)} y={fs(13)} fontSize={fs(9.5)} fontWeight="800" letterSpacing=".04em" textAnchor="middle" fill="currentColor" style={svgText}>
                {st}
              </text>
            </g>
          );
        })}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity=".16" />
          <text x={left - 7} y={y(v) + fs(3.5)} fontSize={fs(10)} fontWeight="500" textAnchor="end" fill="currentColor" fillOpacity=".7" style={svgText}>
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="currentColor" strokeOpacity=".3" />
      {laps.map((l, i) =>
        i % labelStep(laps.length) === 0 || (i === laps.length - 1 && i % labelStep(laps.length) > labelStep(laps.length) / 2) ? (
          <text key={l} x={x(i)} y={height - 3} fontSize={fs(10)} fontWeight="500" textAnchor="middle" fill="currentColor" fillOpacity=".7" style={svgText}>
            {COPY.tele.lap(l)}
          </text>
        ) : null,
      )}
      {list
        .map((c, k) => {
          const pts: string[] = [];
          const segs: string[][] = [pts];
          c.times.forEach((t, i) => {
            if (t == null) segs.push([]);
            else segs[segs.length - 1].push(`${x(i).toFixed(1)},${y(t).toFixed(1)}`);
          });
          const st = styles[Math.min(k, 2)];
          return segs
            .filter((sg) => sg.length > 1)
            .map((sg, n) => (
              <polyline
                key={`${c.number}-${n}`}
                className="draw"
                pathLength={1}
                points={sg.join(" ")}
                fill="none"
                stroke="currentColor"
                strokeOpacity={st.o}
                strokeWidth={st.w}
                strokeDasharray={st.dash}
                strokeLinejoin="round"
                style={st.dash ? { animation: "none" } : undefined}
              />
            ));
        })
        .reverse()}
      {capped &&
        list.flatMap((c) =>
          c.times.map((t, i) =>
            t != null && t > hi ? <path key={`cap-${c.number}-${i}`} d={`M${x(i) - 4} ${y(t) - 5} h8 l-4 -6 z`} fill="currentColor" /> : null,
          ),
        )}
      {ends
        .filter((e) => e.k === 0)
        .map((e) => (
          <rect key="me" x={x(e.i) - 3.5} y={y(e.t) - 3.5} width="7" height="7" fill="currentColor" />
        ))}
      {ends.map((e) => (
        <text key={e.code} x={x(e.i) + fs(10)} y={e.y + fs(4)} fontSize={fs(11.5)} fill="currentColor" fillOpacity={e.k === 0 ? 1 : 0.72} style={svgText}>
          <tspan fontWeight={e.k === 0 ? 800 : 600}>{e.code}</tspan>
          {values && (
            <tspan dx="5" fontWeight={500}>
              {e.t.toFixed(2)}
            </tspan>
          )}
        </text>
      ))}
    </svg>
    </div>
  );
}

function LineKey({ k }: { k: 0 | 1 | 2 }) {
  const st = [
    { w: 2.75, o: 1, dash: undefined },
    { w: 1.75, o: 0.6, dash: "5 4" },
    { w: 1.5, o: 0.4, dash: undefined },
  ][k];
  return (
    <svg aria-hidden width="20" height="8" viewBox="0 0 20 8" className="shrink-0">
      <line x1="1" x2="19" y1="4" y2="4" stroke="currentColor" strokeWidth={st.w} strokeOpacity={st.o} strokeDasharray={st.dash} />
    </svg>
  );
}

// The cars either side of you, one row each: tyre chip, delta now, delta if you box, and their decision.
// Before the reveal: the car ahead shows "Boxed" only when it stopped on the call lap (visible); the car
// behind always shows "Not yet". After the reveal, pass both actual calls.
export function NeighbourList({ t, revealed, big = false }: { t: Telemetry; revealed?: { ahead: Call | null; behind: Call | null }; big?: boolean }) {
  const n = t.neighbours;
  const v = big ? "text-[2rem]" : "text-[1.375rem]";
  const cols = big ? "grid-cols-[minmax(0,1fr)_170px]" : "grid-cols-[minmax(0,1fr)_112px]";
  const rateTxt = (r: number | null) => (r == null || Math.abs(r) < 0.05 ? "" : COPY.tele.rateShort(r));
  // Status tag: a quiet tint of the ink for "No stop" / "Not yet", solid ink for a stop.
  const tag = (text: string, strong = false) => (
    <span className={`inline-flex items-center whitespace-nowrap px-1.5 font-bold leading-none ${big ? "h-6 text-sm" : "h-5 text-xs"} ${strong ? "bg-ink text-white" : "bg-current/12"}`}>
      <span className={strong ? "" : "opacity-90"}>{text}</span>
    </span>
  );
  const name = (k: 0 | 1 | 2, label: string, code: string, compound: string | null, age: number | null, extra: ReactNode) => (
    <div className={`flex min-w-0 flex-col ${big ? "gap-1.5" : "gap-1"}`}>
      <span className="meta flex items-center gap-1.5 opacity-80">
        <LineKey k={k} />
        {label}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <b className={`${big ? "text-[1.75rem]" : "text-xl"} font-black leading-none tracking-[-0.02em]`}>{code}</b>
        <TyreChip compound={compound} age={age} size={big ? "md" : "sm"} />
        {extra}
      </span>
    </div>
  );
  const val = (main: string, sub: ReactNode) => (
    <div className="flex flex-col items-end gap-1 text-right">
      <Num value={main} className={`font-extrabold leading-none tracking-[-0.03em] ${v}`} />
      <span className={`nums font-medium leading-tight opacity-75 ${big ? "text-sm" : "text-xs"}`}>{sub}</span>
    </div>
  );
  const aheadCall = revealed ? revealed.ahead : n.ahead?.boxed ? "BOX" : null;
  return (
    <div className="flex flex-col">
      <div className={`grid ${cols} gap-x-3 border-b border-current/35 pb-1.5`}>
        <span />
        <span className="meta text-right opacity-80">{COPY.tele.now}</span>
      </div>
      {n.ahead && (
        <div className={`grid ${cols} items-center gap-x-3 border-b border-current/20 ${big ? "py-3" : "py-2"}`}>
          {name(1, COPY.tele.ahead, n.ahead.code, n.ahead.compound, n.ahead.age, aheadCall ? tag(COPY.tele.callOf(aheadCall), true) : revealed ? null : tag(COPY.tele.noStop))}
          {t.gapAhead?.now != null ? val(COPY.tele.gapAhead(t.gapAhead.now), `${COPY.tele.sideAhead} ${rateTxt(t.gapAhead.rate)}`) : <span />}
        </div>
      )}
      <div className={`grid ${cols} items-center gap-x-3 border-b border-current/20 ${big ? "py-3" : "py-2"}`}>
        {name(0, COPY.tele.you, n.me.code, n.me.compound, n.me.age, <span className={`nums font-medium opacity-75 ${big ? "text-sm" : "text-xs"}`}>{COPY.tele.offBest(t.deg.delta)}</span>)}
        {val(COPY.tele.youNow(n.me.pos), " ")}
      </div>
      {n.behind && (
        <div className={`grid ${cols} items-center gap-x-3 border-b border-current/20 ${big ? "py-3" : "py-2"}`}>
          {name(2, COPY.tele.behind, n.behind.code, n.behind.compound, n.behind.age, revealed ? (revealed.behind ? tag(COPY.tele.callOf(revealed.behind), revealed.behind === "BOX") : null) : tag(COPY.tele.notYet))}
          {t.gapBehind?.now != null ? val(COPY.tele.gapBehind(t.gapBehind.now), `${COPY.tele.sideBehind} ${rateTxt(t.gapBehind.rate)}`) : <span />}
        </div>
      )}
    </div>
  );
}

// Undercut clock: one compact block per relevant rival. Shows nothing when no rival qualifies.
export function UndercutClock({ t, mode, big = false }: { t: Telemetry; mode: DataMode; big?: boolean }) {
  if (!t.undercut.length) return null;
  const adv = mode === "advanced";
  const u0 = t.undercut[0];
  return (
    <Sec label={COPY.tele.undercut} meta={COPY.tele.undercutMeta(u0.loss, t.status[t.callLap] ?? "GREEN")}>
      <ul className="flex flex-col">
        {t.undercut.map((u) => (
          <li key={u.number} className={`flex gap-3 border-b border-current/20 py-2.5 last:border-0 ${big ? "text-lg" : "text-[0.9375rem]"} font-medium leading-snug`}>
            <span className="mt-0.5">
              <TyreChip compound={u.compound} age={u.age} size={big ? "md" : "sm"} />
            </span>
            <span className="min-w-0 [&_b]:font-black">
              {u.pitted && u.tooEarly ? (
                <b>{COPY.tele.ucTooEarly(u.code, u.compound ? (COPY.compounds[u.compound] ?? u.compound) : null)}</b>
              ) : u.pitted ? (
                <>
                  <b>{COPY.tele.ucPitted(u.code, u.lapsSinceStop ?? 0, u.compound ? (COPY.compounds[u.compound] ?? u.compound) : null)}</b>
                  {u.paceDelta != null ? COPY.tele.ucPace(u.paceDelta) : COPY.tele.ucNoPace}{" "}
                  <b>{isTight(u.boxNow) ? COPY.tele.ucTight(u.code) : COPY.tele.ucBoxNow(u.code, u.boxNow)}</b>
                  {u.boxNextLap != null && <> {isTight(u.boxNextLap) ? COPY.tele.ucWaitTight : COPY.tele.ucWait(u.boxNextLap)}</>}
                </>
              ) : (
                <>
                  <b>{isTight(u.boxNow) ? COPY.tele.ucStaysTight(u.code) : COPY.tele.ucStays(u.code, u.boxNow)}</b>
                  {u.newTyreGain != null && u.newTyreGain > 0 && <> {COPY.tele.ucGain(u.newTyreGain, u.gainFrom)}</>}
                </>
              )}
              {adv && (
                <span className="nums mt-1 block text-xs leading-snug opacity-75">
                  {u.paceDelta != null && u.paceLaps.length > 0 && <>{COPY.tele.ucPaceAdv(u.paceDelta, u.paceLaps[0], u.paceLaps[u.paceLaps.length - 1])} </>}
                  {u.pitted && u.tooEarly && <>{isTight(u.boxNow) ? COPY.tele.ucEstimateTight(u.code) : COPY.tele.ucEstimate(u.code, u.boxNow)} </>}
                  {u.pitted && !u.tooEarly && <>{COPY.tele.ucUntil(u.lapsUntilUndercut)} </>}
                  {COPY.tele.ucInputs(u.gapNow, u.loss)}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </Sec>
  );
}

// Ahead / Behind / Tyre, three columns under a 2px rule.
export function Readouts({ t, big = false }: { t: Telemetry; big?: boolean }) {
  const v = big ? "text-[1.75rem]" : "text-xl";
  const arrow = (r: number | null) => (r == null || Math.abs(r) < 0.05 ? "" : r > 0 ? "▲ " : "▼ ");
  const cell = (label: string, value: string, sub: string) => (
    <div className="min-w-0">
      <div className="meta opacity-80">{label}</div>
      <Num value={value} className={`mt-1 block truncate font-extrabold tracking-[-0.02em] ${v}`} />
      <div className="nums mt-0.5 text-xs font-medium leading-tight opacity-75">{sub}</div>
    </div>
  );
  const a = t.gapAhead;
  const b = t.gapBehind;
  return (
    <div className="grid grid-cols-3 gap-3 border-t-2 border-current pt-2.5">
      {a ? cell(COPY.tele.ahead, COPY.tele.gapValue(a.code, a.now ?? 0), `${arrow(a.rate)}${COPY.tele.rateLine(a.rate, "ahead")}`) : cell(COPY.tele.ahead, COPY.tele.none, COPY.tele.youLead)}
      {b ? cell(COPY.tele.behind, COPY.tele.gapValue(b.code, b.now ?? 0), `${arrow(b.rate)}${COPY.tele.rateLine(b.rate, "behind")}`) : cell(COPY.tele.behind, COPY.tele.none, COPY.tele.lastCar)}
      {cell(COPY.tele.tyre, COPY.tele.tyreValue(compoundLetter(t.deg.compound), t.deg.age), COPY.tele.offBest(t.deg.delta))}
    </div>
  );
}

export function simpleChartLabel(t: Telemetry) {
  const vs = t.ahead && t.behind ? COPY.tele.vsBoth : t.ahead ? COPY.tele.vsAhead : COPY.tele.vsBehind;
  return COPY.tele.lapTimeLabel(t.laps.length, vs);
}

export function IntervalTable({ t }: { t: Telemetry }) {
  if (!t.pairs.length) return null;
  const cols = `62px repeat(${t.laps.length}, minmax(0,1fr)) 52px`;
  return (
    <div role="table" className="nums">
      <div role="row" className="grid h-7 items-center border-b border-current/30 text-right text-[10px] font-bold tracking-[0.04em] opacity-75" style={{ gridTemplateColumns: cols }}>
        <b role="columnheader" className="text-left">{COPY.tele.gapHead.toUpperCase()}</b>
        {t.laps.map((l) => (
          <span role="columnheader" key={l}>{COPY.tele.lap(l)}</span>
        ))}
        <b role="columnheader">{COPY.tele.trendHead.toUpperCase()}</b>
      </div>
      {t.pairs.map((p) => (
        <div role="row" key={`${p.a}-${p.b}`} className="grid h-7 items-center border-b border-current/12 text-right text-[12.5px] font-medium" style={{ gridTemplateColumns: cols }}>
          <b role="cell" className="text-left">
            {p.a}-{p.b}
          </b>
          {p.series.map((v, i) => (
            <span role="cell" key={i}>{v == null ? "" : v.toFixed(1)}</span>
          ))}
          <b role="cell">{p.rate == null ? "" : `${p.rate >= 0 ? "+" : "-"}${Math.abs(p.rate).toFixed(2)}`}</b>
        </div>
      ))}
    </div>
  );
}

// The same intervals as lines (host layout).
export function IntervalChart({ t, height = 200, fit = false, text = 1 }: { t: Telemetry; height?: number; fit?: boolean; text?: number }) {
  const [box, measured] = useBoxWidth<HTMLDivElement>(W, fit);
  const vw = fit ? measured : W;
  const fs = (n: number) => n * text;
  const rows = t.pairs.filter((p) => p.series.some((v) => v != null));
  if (!rows.length || t.laps.length < 2) return null;
  const vals = rows.flatMap((p) => p.series).filter((v): v is number => v != null);
  const lo = Math.min(0, Math.floor(Math.min(...vals)));
  const hi = Math.max(1, Math.ceil(Math.max(...vals)));
  const left = fs(40);
  const right = vw - fs(72);
  const bottom = height - fs(18);
  const x = (i: number) => left + (i / (t.laps.length - 1)) * (right - left);
  const y = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - 10);
  const styles = [
    { w: 2.75, o: 1, dash: undefined },
    { w: 1.75, o: 0.65, dash: "5 4" },
    { w: 1.5, o: 0.4, dash: undefined },
    { w: 1.5, o: 0.4, dash: "1.5 3" },
  ];
  const ends = rows.map((p, k) => {
    let i = p.series.length - 1;
    while (i >= 0 && p.series[i] == null) i--;
    return { k, i, label: `${p.a}-${p.b}`, y: y(p.series[i] as number) };
  });
  ends.sort((a, b) => a.y - b.y);
  for (let j = 1; j < ends.length; j++) if (ends[j].y - ends[j - 1].y < fs(13)) ends[j].y = ends[j - 1].y + fs(13);
  // About four gridlines whatever the range.
  const raw = (hi - lo) / 4;
  const step = [0.5, 1, 2, 5, 10, 20].find((v) => v >= raw) ?? 20;
  return (
    <div ref={box}>
    <svg viewBox={`0 0 ${vw} ${height}`} width="100%" className="block overflow-visible" role="img" aria-label={COPY.tele.intervals}>
      {Array.from({ length: Math.floor((hi - Math.ceil(lo / step) * step) / step) + 1 }, (_, k) => Math.ceil(lo / step) * step + k * step).map((v) => (
        <g key={v}>
          <line x1={left} x2={right} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={v === 0 ? 0.4 : 0.16} />
          <text x={left - 7} y={y(v) + fs(3.5)} fontSize={fs(10)} fontWeight="500" textAnchor="end" fill="currentColor" fillOpacity=".7" style={svgText}>
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {t.laps.map((l, i) => (
        <text key={l} x={x(i)} y={height - 3} fontSize={fs(10)} fontWeight="500" textAnchor="middle" fill="currentColor" fillOpacity=".7" style={svgText}>
          {COPY.tele.lap(l)}
        </text>
      ))}
      {rows.map((p, k) => {
        const st = styles[Math.min(k, 3)];
        const pts = p.series.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" ");
        return <polyline key={`${p.a}-${p.b}`} points={pts} fill="none" stroke="currentColor" strokeWidth={st.w} strokeOpacity={st.o} strokeDasharray={st.dash} strokeLinejoin="round" />;
      })}
      {ends.map((e) => (
        <text key={e.label} x={x(e.i) + fs(10)} y={e.y + fs(4)} fontSize={fs(11.5)} fontWeight={e.k === 0 ? 800 : 600} fill="currentColor" fillOpacity={e.k === 0 ? 1 : 0.72} style={svgText}>
          {e.label}
        </text>
      ))}
    </svg>
    </div>
  );
}

export function intervalNote(t: Telemetry): ReactNode {
  const b = t.gapBehind;
  const a = t.gapAhead;
  const parts: ReactNode[] = [];
  if (b?.rate != null && Math.abs(b.rate) >= 0.05) parts.push(<span key="b">{COPY.tele.intervalNote(b.code, b.rate, false)} </span>);
  else if (a?.rate != null && Math.abs(a.rate) >= 0.05) parts.push(<span key="a">{COPY.tele.intervalNote(a.code, a.rate, true)} </span>);
  if (t.rejoin?.ahead && t.rejoin.behind) parts.push(<span key="r">{COPY.tele.rejoinPair(t.rejoin.ahead.code, t.rejoin.behind.code)}</span>);
  return parts;
}

// Every car's compound as a broadcast badge with its code under it; the player's car sits on a tint.
// onField is kept for older call sites (the badge reads on white and on the field alike).
export function FieldTyres({ t, me }: { t: Telemetry; me: number; onField?: boolean }) {
  const counts = new Map<string, number>();
  for (const c of t.compounds) if (c.compound) counts.set(c.compound, (counts.get(c.compound) ?? 0) + 1);
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => COPY.tele.mixPart(n, COPY.compounds[c] ?? c));
  return (
    <>
      <div className="grid grid-cols-10 gap-x-1 gap-y-1">
        {t.compounds.map((c) => {
          const mine = c.number === me;
          return (
            <div
              key={c.number}
              title={`${c.code} ${c.compound ?? ""} ${c.age ?? ""}`}
              className={`flex h-[38px] flex-col items-center justify-center gap-[3px] leading-none ${mine ? "bg-current/15 shadow-[inset_0_0_0_2px_currentColor]" : ""}`}
            >
              <TyreChip compound={c.compound} size="sm" />
              <span className={`text-[9.5px] tracking-[0.02em] ${mine ? "font-black" : "font-semibold opacity-75"}`}>{c.code}</span>
            </div>
          );
        })}
      </div>
      <Note>
        {COPY.tele.mix(parts)} <b>{t.stopped ? COPY.tele.stopped(t.stopped) : COPY.tele.stoppedNone}</b>
      </Note>
    </>
  );
}

export function PitLoss({ under, normal, trigger }: { under: number; normal: number; trigger: TrackStatus }) {
  const max = 210;
  return (
    <>
      <svg viewBox={`0 0 ${W} 50`} width="100%" className="block" role="img" aria-label={`${COPY.tele.pitNow(trigger)} ${under} s, ${COPY.tele.pitGreen} ${normal} s`}>
        <text x="0" y="12" fontSize="11.5" fontWeight="800" fill="currentColor" style={svgText}>
          {COPY.tele.pitNow(trigger)}
        </text>
        <rect className="grow-x" x="62" y="1" width={(under / normal) * max} height="14" fill="currentColor" />
        <text x={62 + (under / normal) * max + 8} y="13" fontSize="13" fontWeight="800" fill="currentColor" style={svgText}>
          {under.toFixed(1)}
          <tspan dx="2" fontSize="9.5" fontWeight="600" fillOpacity=".72">
            s
          </tspan>
        </text>
        <text x="0" y="43" fontSize="11.5" fontWeight="600" fill="currentColor" fillOpacity=".75" style={svgText}>
          {COPY.tele.pitGreen}
        </text>
        <rect x="62" y="32" width={max} height="14" fill="currentColor" fillOpacity=".16" />
        <text x={62 + max + 8} y="44" fontSize="13" fontWeight="700" fill="currentColor" fillOpacity=".75" style={svgText}>
          {normal.toFixed(1)}
          <tspan dx="2" fontSize="9.5" fontWeight="600">
            s
          </tspan>
        </text>
      </svg>
      <Note>{COPY.tele.pitNote(trigger, normal - under)}</Note>
    </>
  );
}

export function StintTable({ t, normal }: { t: Telemetry; normal: number | null }) {
  const best = t.deg.best;
  const letter = t.deg.compound ? (COPY.compounds[t.deg.compound] ?? t.deg.compound).slice(0, 3).toUpperCase() : "–";
  const rows = [
    [COPY.tele.stintNow, letter, `${t.deg.stintFrom}-${t.callLap}`, best != null ? best.toFixed(3) : COPY.tele.none, t.stintTrend != null ? COPY.tele.perLap(t.stintTrend) : COPY.tele.none],
    [COPY.tele.stintBox, COPY.tele.newTyres, `${t.callLap + 1}-${t.totalLaps}`, COPY.tele.none, COPY.tele.lapsCount(t.totalLaps - t.callLap)],
    [COPY.tele.stintStay, COPY.tele.newTyres, COPY.tele.greenStop, COPY.tele.none, normal != null ? COPY.tele.plusSeconds(normal) : COPY.tele.none],
  ];
  const c = COPY.tele.stintCols;
  return (
    <table className="nums w-full border-collapse text-[13px]">
      <thead>
        <tr>
          {[c.stint, c.tyre, c.laps, c.best, c.trend].map((h, i) => (
            <th key={h} className={`border-b border-current/40 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.06em] opacity-75 ${i === 4 ? "text-right" : "text-left"}`}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>
            {r.map((v, i) => (
              <td key={i} className={`border-b border-current/15 py-2 ${i === 0 ? "font-bold" : "font-medium"} ${i === 4 ? "text-right" : "text-left"}`}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Where a stop rejoins: nearby cars as ticks on a gap-to-leader axis, the projected spot as a square.
export function RejoinStrip({ t, frameCars }: { t: Telemetry; frameCars: { code: string; gap: number | null; number: number }[] }) {
  // 1:1 viewBox from the box width, so the strip keeps its 60 px height and label size at any width.
  const [box, vw] = useBoxWidth<HTMLDivElement>(W);
  const rj = t.rejoin;
  if (!rj) return null;
  const out = rj.gapToLeader;
  const near = frameCars
    .filter((c) => c.gap != null && Math.abs((c.gap as number) - out) < 3)
    .sort((a, b) => Math.abs((a.gap as number) - out) - Math.abs((b.gap as number) - out))
    .slice(0, 4)
    .sort((a, b) => (a.gap as number) - (b.gap as number));
  const gs = near.map((c) => c.gap as number).concat(out);
  const lo = Math.min(...gs) - 0.6;
  const hi = Math.max(...gs) + 0.6;
  const x = (g: number) => 14 + ((g - lo) / (hi - lo)) * (vw - 28);
  return (
    <div ref={box}>
      <svg viewBox={`0 0 ${vw} 60`} width="100%" className="block" role="img" aria-label={COPY.tele.rejoinNote(rj.pos, rj.ahead, rj.behind)}>
        <line x1="14" x2={vw - 14} y1="30" y2="30" stroke="currentColor" strokeOpacity=".35" />
        {near.map((c) => (
          <g key={c.number}>
            <line x1={x(c.gap as number)} x2={x(c.gap as number)} y1="22" y2="38" stroke="currentColor" strokeWidth="1.5" strokeOpacity=".85" />
            <text x={x(c.gap as number)} y="14" fontSize="11.5" fontWeight="700" textAnchor="middle" fill="currentColor" fillOpacity=".85" style={svgText}>
              {c.code}
            </text>
            <text x={x(c.gap as number)} y="54" fontSize="10" fontWeight="500" textAnchor="middle" fill="currentColor" fillOpacity=".7" style={svgText}>
              {(c.gap as number).toFixed(1)}
            </text>
          </g>
        ))}
        <rect className="ghost" x={x(out) - 6} y="24" width="12" height="12" fill="currentColor" />
      </svg>
      <Note>{COPY.tele.rejoinNote(rj.pos, rj.ahead, rj.behind)}</Note>
    </div>
  );
}
