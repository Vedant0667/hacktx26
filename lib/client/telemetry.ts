// Telemetry for the call moment, from the blind call-moment frames only (callMomentFrames output):
// lap-time trends, intervals to the cars around the player with closing/opening rates, tyre degradation,
// the field's tyre ages and a nearby-car stint table. Nothing here reads the answer, the team or the engine.
import type { Call, DecisionPoint, DriverFrame, LapFrame, TrackStatus } from "@/lib/types";
import type { BlindDecision } from "./api";
import { projectRejoin, undercutRivals, type Rejoin, type Undercut } from "./race";

// frames.json carries lap_time_s per driver row (seconds, or null) once the data build adds it.
type Row = DriverFrame & { lap_time_s?: number | null };

export interface CarTrend {
  number: number;
  code: string;
  colour: string | null;
  // Lap time per lap in `laps`; null when missing, on lap 1, on a pit lap, or under SC/VSC.
  times: (number | null)[];
}

export interface Interval {
  code: string;
  now: number | null;
  // Seconds per lap: negative means the gap is shrinking.
  rate: number | null;
  series: (number | null)[];
}

export interface Nearby {
  number: number;
  code: string;
  colour: string | null;
  position: number;
  compound: string | null;
  age: number | null;
  last: number | null;
  // Seconds to the player at the call moment: negative = ahead on the road.
  toMe: number | null;
  // Gap to the player on each lap in `stintLaps`.
  series: (number | null)[];
  rate: number | null;
}

export interface Telemetry {
  laps: number[];
  me: CarTrend;
  ahead: CarTrend | null;
  behind: CarTrend | null;
  gapAhead: Interval | null;
  gapBehind: Interval | null;
  deg: { best: number | null; recent: number | null; delta: number | null; compound: string | null; age: number | null; stintFrom: number };
  stintLaps: number[];
  stint: { me: CarTrend; ahead: CarTrend | null; behind: CarTrend | null };
  ages: number[];
  myAge: number | null;
  nearby: Nearby[];
  hasTimes: boolean;
  // Interval rows: adjacent pairs around the player and around where a stop rejoins.
  pairs: { a: string; b: string; series: (number | null)[]; rate: number | null }[];
  // Cars that have stopped at least once in the frames seen so far.
  stopped: number;
  compounds: { code: string; number: number; compound: string | null; age: number | null }[];
  rejoin: Rejoin | null;
  // Slope of the player's clean lap times over the stint, s/lap (negative: getting faster).
  stintTrend: number | null;
  callLap: number;
  totalLaps: number;
  // Track status per lap number (for SC/VSC bands on chart axes).
  status: Record<number, TrackStatus>;
  // The cars either side at the call moment, with tyres. aheadBoxed: it stopped on the call lap, which the
  // pit wall sees because it reaches pit entry first. The car behind's choice is never inferred.
  neighbours: {
    me: { code: string; compound: string | null; age: number | null; pos: number };
    ahead: { code: string; number: number; compound: string | null; age: number | null; boxed: boolean } | null;
    behind: { code: string; number: number; compound: string | null; age: number | null } | null;
  };
  // Undercut clock: the 1-2 most relevant rivals (recent stoppers first), from pre-call info only.
  undercut: Undercut[];
}

// After the reveal only: what the cars either side actually did at the call (stopped on lap L or L+1).
export function neighbourCalls(frames: LapFrame[], d: DecisionPoint, numbers: { ahead?: number | null; behind?: number | null }): { ahead: Call | null; behind: Call | null } {
  const win = frames.filter((f) => f.lap >= d.lap && f.lap <= d.lap + 1);
  const did = (n?: number | null): Call | null => {
    if (n == null || !win.length) return null;
    return win.some((f) => f.drivers.some((x) => x.number === n && x.pitted_this_lap)) ? "BOX" : "STAY";
  };
  return { ahead: did(numbers.ahead), behind: did(numbers.behind) };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// Average change per lap over the last `n` laps that have a value.
function rate(series: (number | null)[], n = 3): number | null {
  const pts = series.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null).slice(-(n + 1));
  if (pts.length < 2) return null;
  const [i0, v0] = pts[0];
  const [i1, v1] = pts[pts.length - 1];
  return i1 === i0 ? null : r2((v1 - v0) / (i1 - i0));
}

export function telemetry(seen: LapFrame[], d: BlindDecision, window = 6): Telemetry | null {
  const moment = seen.find((f) => f.lap === d.lap) ?? seen[seen.length - 1];
  const me0 = moment?.drivers.find((x) => x.number === d.player_role.number);
  if (!moment || !me0) return null;
  const done = seen.filter((f) => f.lap < d.lap).sort((a, b) => a.lap - b.lap);
  const byLap = new Map(done.map((f) => [f.lap, f]));
  const sorted = [...moment.drivers].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((x) => x.number === me0.number);
  const aheadCar = sorted[i - 1] ?? null;
  const behindCar = sorted[i + 1] ?? null;

  // Stint start: the lap after this car's last stop, or lap 1.
  let stintFrom = done[0]?.lap ?? 1;
  for (const f of done) if (f.drivers.find((x) => x.number === me0.number)?.pitted_this_lap) stintFrom = f.lap + 1;
  const stintLaps = done.filter((f) => f.lap >= stintFrom).map((f) => f.lap);
  const laps = done.slice(-window).map((f) => f.lap);

  const row = (lap: number, n: number) => byLap.get(lap)?.drivers.find((x) => x.number === n) as Row | undefined;
  const cleanTime = (lap: number, n: number): number | null => {
    const f = byLap.get(lap);
    const x = row(lap, n);
    if (!f || !x || f.track_status !== "GREEN" || x.pitted_this_lap) return null;
    // The lap after a stop is the out-lap.
    if (row(lap - 1, n)?.pitted_this_lap) return null;
    const t = x.lap_time_s;
    return typeof t === "number" && t > 0 ? t : null;
  };
  const trend = (c: DriverFrame | null, over: number[]): CarTrend | null =>
    c ? { number: c.number, code: c.code, colour: c.team_colour, times: over.map((l) => cleanTime(l, c.number)) } : null;

  const gapSeries = (other: DriverFrame, over: number[], sign: 1 | -1) =>
    over.map((l) => {
      const a = row(l, me0.number)?.gap_to_leader_s;
      const b = row(l, other.number)?.gap_to_leader_s;
      return a == null || b == null ? null : r1(sign * (a - b));
    });
  const interval = (other: DriverFrame | null, sign: 1 | -1): Interval | null => {
    if (!other) return null;
    const now = me0.gap_to_leader_s != null && other.gap_to_leader_s != null ? r1(sign * (me0.gap_to_leader_s - other.gap_to_leader_s)) : null;
    const series = gapSeries(other, laps, sign);
    return { code: other.code, now, rate: rate(series), series };
  };

  const meStint = trend(me0, stintLaps)!;
  // Lap 1 (standing start) is drawn but never counts as the stint best.
  const clean = meStint.times.filter((t, k): t is number => t != null && stintLaps[k] > 1);
  const best = clean.length ? Math.min(...clean) : null;
  const recentList = clean.slice(-2);
  const recent = recentList.length ? recentList.reduce((s, t) => s + t, 0) / recentList.length : null;

  const near = sorted.filter((x) => Math.abs(x.position - me0.position) <= 3 && x.number !== me0.number);
  const nearby: Nearby[] = near.map((x) => {
    const series = stintLaps.map((l) => {
      const a = row(l, me0.number)?.gap_to_leader_s;
      const b = row(l, x.number)?.gap_to_leader_s;
      return a == null || b == null ? null : r1(b - a);
    });
    const lastLap = done[done.length - 1]?.lap;
    return {
      number: x.number,
      code: x.code,
      colour: x.team_colour,
      position: x.position,
      compound: x.compound,
      age: x.tyre_age,
      last: lastLap != null ? cleanTime(lastLap, x.number) ?? ((row(lastLap, x.number)?.lap_time_s as number | null | undefined) ?? null) : null,
      toMe: me0.gap_to_leader_s != null && x.gap_to_leader_s != null ? r1(x.gap_to_leader_s - me0.gap_to_leader_s) : null,
      series,
      rate: rate(series),
    };
  });

  const me = trend(me0, laps)!;
  const num = new Map(moment.drivers.map((x) => [x.code, x.number]));
  const pairSeries = (a: number, b: number) =>
    laps.map((l) => {
      const ga = row(l, a)?.gap_to_leader_s;
      const gb = row(l, b)?.gap_to_leader_s;
      return ga == null || gb == null ? null : r1(gb - ga);
    });
  const rj = projectRejoin(seen, d, d.pit_loss?.normal_s);
  const want: [DriverFrame | null | undefined, DriverFrame | null | undefined][] = [
    [aheadCar, me0],
    [me0, behindCar],
    [behindCar, sorted[i + 2]],
  ];
  if (rj?.ahead && rj.behind) {
    const ra = sorted.find((x) => x.code === rj.ahead!.code);
    const rb = sorted.find((x) => x.code === rj.behind!.code);
    want.push([ra, rb]);
  }
  const seenPair = new Set<string>();
  const pairs = want
    .filter((p): p is [DriverFrame, DriverFrame] => !!p[0] && !!p[1])
    .filter(([a, b]) => {
      const k = `${a.code}-${b.code}`;
      if (seenPair.has(k)) return false;
      seenPair.add(k);
      return true;
    })
    .slice(0, 4)
    .map(([a, b]) => {
      const series = pairSeries(num.get(a.code)!, num.get(b.code)!);
      return { a: a.code, b: b.code, series, rate: rate(series) };
    });
  const stoppedSet = new Set(done.flatMap((f) => f.drivers.filter((x) => x.pitted_this_lap).map((x) => x.number)));
  for (const x of moment.drivers) if (x.pitted_this_lap) stoppedSet.add(x.number);
  const cleanPts = meStint.times.map((t, k) => (stintLaps[k] > 1 ? t : null));
  const status: Record<number, TrackStatus> = {};
  for (const f of seen) status[f.lap] = f.track_status;
  return {
    status,
    undercut: undercutRivals(seen, d),
    neighbours: {
      me: { code: me0.code, compound: me0.compound, age: me0.tyre_age, pos: me0.position },
      ahead: aheadCar
        ? {
            code: aheadCar.code,
            number: aheadCar.number,
            compound: aheadCar.compound,
            age: aheadCar.tyre_age,
            boxed: !!aheadCar.pitted_this_lap,
          }
        : null,
      behind: behindCar
        ? {
            code: behindCar.code,
            number: behindCar.number,
            compound: behindCar.compound,
            age: behindCar.tyre_age,
          }
        : null,
    },
    pairs,
    stopped: stoppedSet.size,
    compounds: sorted.map((x) => ({ code: x.code, number: x.number, compound: x.compound, age: x.tyre_age })),
    rejoin: rj,
    stintTrend: rate(cleanPts, Math.max(1, cleanPts.length - 1)),
    callLap: d.lap,
    totalLaps: d.total_laps,
    laps,
    me,
    ahead: trend(aheadCar, laps),
    behind: trend(behindCar, laps),
    gapAhead: interval(aheadCar, 1),
    gapBehind: interval(behindCar, -1),
    deg: {
      best,
      recent: recent != null ? r2(recent) : null,
      delta: best != null && recent != null ? r2(recent - best) : null,
      compound: me0.compound,
      age: me0.tyre_age,
      stintFrom,
    },
    stintLaps,
    stint: { me: meStint, ahead: trend(aheadCar, stintLaps), behind: trend(behindCar, stintLaps) },
    ages: moment.drivers.map((x) => x.tyre_age).filter((a): a is number => a != null),
    myAge: me0.tyre_age,
    nearby,
    hasTimes: done.some((f) => f.drivers.some((x) => typeof (x as Row).lap_time_s === "number")),
  };
}

// "1:23.4"
export function lapTimeText(t: number | null | undefined): string {
  if (t == null) return "–";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m ? `${m}:${s.toFixed(1).padStart(4, "0")}` : s.toFixed(1);
}
