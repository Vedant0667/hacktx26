// Pure helpers for the replay clock, the timing tower and scoreboard facts.
import { CALL_WINDOW_S, VOICE_NOTE_MAX_S } from "@/lib/scoring";
import type { Call, DecisionPoint, LapFrame, Submission } from "@/lib/types";
import type { BlindDecision } from "./api";

export { CALL_WINDOW_S, VOICE_NOTE_MAX_S };
export const LAP_MS = 1200; // replay speed before the call
export const PLAYED_OUT_MS = 6000; // lap L to reveal_to_lap after the call (docs/06 motion table)
// Call 100 + reasoning 50 (docs/05 scoring; lib/scoring.ts). TODO(backend): export these from lib/scoring.ts.
export const CALL_POINTS = 100;
export const REASONING_MAX = 50;
export const MAX_TOTAL = CALL_POINTS + REASONING_MAX;

export function frameAt(frames: LapFrame[], lap: number): LapFrame | undefined {
  return frames.find((f) => f.lap === lap) ?? frames[frames.length - 1];
}

// What the pit wall can see when the call is due: the order at the end of lap L-1, lap L's track status,
// and only the stops made by cars ahead on the road (they reach pit entry first). Use before the reveal.
export function callMomentFrames(frames: LapFrame[], d: BlindDecision): LapFrame[] {
  const prev = frames.find((f) => f.lap === d.lap - 1);
  const now = frames.find((f) => f.lap === d.lap);
  if (!prev || !now) return frames;
  const me = prev.drivers.find((x) => x.number === d.player_role.number);
  const pittedNow = new Set(now.drivers.filter((x) => x.pitted_this_lap).map((x) => x.code));
  const moment: LapFrame = {
    lap: d.lap,
    track_status: now.track_status,
    drivers: prev.drivers.map((x) => ({
      ...x,
      tyre_age: x.tyre_age == null ? null : x.tyre_age + 1,
      pitted_this_lap: !!me && x.position < me.position && pittedNow.has(x.code),
    })),
  };
  return frames.filter((f) => f.lap < d.lap).concat(moment);
}

export function replayLap(d: BlindDecision, elapsedMs: number): number {
  return Math.min(d.lap, d.replay_from_lap + Math.max(0, Math.floor(elapsedMs / LAP_MS)));
}

export function playedOutLap(d: DecisionPoint, elapsedMs: number): number {
  const span = Math.max(1, d.reveal_to_lap - d.lap);
  const per = PLAYED_OUT_MS / span;
  return Math.min(d.reveal_to_lap, d.lap + Math.max(0, Math.floor(elapsedMs / per)));
}

export function replayDoneMs(d: BlindDecision): number {
  return (d.lap - d.replay_from_lap) * LAP_MS + 600;
}

// Three-letter code from a nickname, like the broadcast (PIA, HAM).
export function tla(name: string): string {
  const letters = name.normalize("NFKD").replace(/[^A-Za-z]/g, "").toUpperCase();
  return letters.slice(0, 3) || name.trim().slice(0, 3).toUpperCase();
}

export function fmtGap(gap: number | null, pos: number): string | null {
  if (pos === 1) return null;
  if (gap == null) return "–";
  return `+${gap.toFixed(1)}`;
}

export function fmtSeconds(s: number): string {
  return s.toFixed(1);
}

export function compoundLetter(c: string | null): string | null {
  if (!c) return null;
  const k = c.toUpperCase();
  if (k.startsWith("S")) return "S";
  if (k.startsWith("M")) return "M";
  if (k.startsWith("H")) return "H";
  if (k.startsWith("I")) return "I";
  if (k.startsWith("W")) return "W";
  return null;
}

// Race control lines derived from the frames: status changes and pit stops, newest first.
export function raceControl(frames: LapFrame[], uptoLap: number, fromLap: number): { lap: number; kind: "status" | "pit"; status?: LapFrame["track_status"]; code?: string }[] {
  const out: { lap: number; kind: "status" | "pit"; status?: LapFrame["track_status"]; code?: string }[] = [];
  let prev: LapFrame["track_status"] | null = null;
  for (const f of frames) {
    if (f.lap < fromLap) {
      prev = f.track_status;
      continue;
    }
    if (f.lap > uptoLap) break;
    if (prev === null || f.track_status !== prev) out.push({ lap: f.lap, kind: "status", status: f.track_status });
    prev = f.track_status;
    for (const d of f.drivers) if (d.pitted_this_lap) out.push({ lap: f.lap, kind: "pit", code: d.code });
  }
  return out.reverse();
}

export function contextAt(d: BlindDecision, frames: LapFrame[]) {
  const f = frameAt(frames, d.lap);
  const me = f?.drivers.find((x) => x.number === d.player_role.number);
  if (!f || !me) return null;
  const sorted = [...f.drivers].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((x) => x.number === me.number);
  const ahead = sorted[i - 1];
  const behind = sorted[i + 1];
  const g = (a: number | null | undefined, b: number | null | undefined) =>
    a == null || b == null ? "–" : Math.abs(a - b).toFixed(1);
  return {
    pos: me.position,
    compound: me.compound,
    age: me.tyre_age,
    ahead: ahead ? g(me.gap_to_leader_s, ahead.gap_to_leader_s) : "–",
    behind: behind ? g(behind.gap_to_leader_s, me.gap_to_leader_s) : "–",
  };
}

export interface Badges {
  team: boolean;
  winning: boolean;
  engine: boolean;
}

export function badgesFor(s: Pick<Submission, "call" | "total">, d: DecisionPoint, teamTotal: number | null, engineTotal: number | null): Badges {
  return {
    team: teamTotal != null && s.total > teamTotal,
    winning: s.call === d.ground_truth.correct,
    engine: engineTotal != null && s.total > engineTotal,
  };
}

export function perFactor(d: BlindDecision): number {
  return REASONING_MAX / Math.min(Math.max(d.factors.length, 1), 4);
}

export function splitCalls(subs: { call: Call | null }[]) {
  let box = 0;
  let stay = 0;
  for (const s of subs) {
    if (s.call === "BOX") box++;
    else if (s.call === "STAY") stay++;
  }
  return { box, stay };
}

// Pit rejoin projector: where the car comes out if it boxes now and no one else stops.
// Uses the call-moment frame only (callMomentFrames output) plus the pit loss under the current flag.
export const REJOIN_CLEAR_S = 1.5;
export interface Rejoin {
  pos: number;
  loss: number;
  ahead: { code: string; gap: number } | null;
  behind: { code: string; gap: number } | null;
  clean: boolean;
  traffic: string | null;
  // Projected gap to the leader after the stop, for the ghost marker.
  gapToLeader: number;
}
// normalLoss defaults to the blind decision's pit_loss.normal_s.
export function projectRejoin(seen: LapFrame[], d: BlindDecision, normalLoss: number | null | undefined = d.pit_loss?.normal_s): Rejoin | null {
  if (normalLoss == null) return null;
  const f = seen.find((x) => x.lap === d.lap) ?? seen[seen.length - 1];
  const me = f?.drivers.find((x) => x.number === d.player_role.number);
  if (!f || !me || me.gap_to_leader_s == null) return null;
  const factor = f.track_status === "SC" ? 0.5 : f.track_status === "VSC" ? 0.75 : 1;
  const loss = Math.round(normalLoss * factor * 10) / 10;
  const out = me.gap_to_leader_s + loss;
  const others = f.drivers
    .filter((x) => x.number !== me.number && x.gap_to_leader_s != null)
    .map((x) => ({ code: x.code, g: x.gap_to_leader_s as number }))
    .sort((a, b) => a.g - b.g);
  const aheadList = others.filter((x) => x.g <= out);
  const behindList = others.filter((x) => x.g > out);
  const a = aheadList[aheadList.length - 1];
  const b = behindList[0];
  const ahead = a ? { code: a.code, gap: Math.round((out - a.g) * 10) / 10 } : null;
  const behind = b ? { code: b.code, gap: Math.round((b.g - out) * 10) / 10 } : null;
  const tA = ahead && ahead.gap < REJOIN_CLEAR_S ? ahead.code : null;
  const tB = behind && behind.gap < REJOIN_CLEAR_S ? behind.code : null;
  return { pos: aheadList.length + 1, loss, ahead, behind, clean: !tA && !tB, traffic: tA ?? tB, gapToLeader: out };
}

// Plain race-story numbers for Simple mode, from visible info only.
export function raceStory(seen: LapFrame[], d: BlindDecision, totalLaps: number) {
  const f = seen.find((x) => x.lap === d.lap) ?? seen[seen.length - 1];
  const me = f?.drivers.find((x) => x.number === d.player_role.number);
  if (!f || !me) return null;
  const ages = f.drivers.map((x) => x.tyre_age).filter((a): a is number => a != null);
  const older = me.tyre_age == null ? null : ages.filter((a) => a < me.tyre_age!).length;
  const ahead = f.drivers.filter((x) => x.position < me.position);
  const pittedAhead = ahead.filter((x) => x.pitted_this_lap).length;
  // Stops by cars within 3 places, earlier in this replay (already on screen).
  const near = new Set(f.drivers.filter((x) => Math.abs(x.position - me.position) <= 3 && x.number !== me.number).map((x) => x.number));
  const nearStops = new Set(seen.filter((x) => x.lap < d.lap && x.lap >= d.replay_from_lap).flatMap((x) => x.drivers.filter((y) => y.pitted_this_lap && near.has(y.number)).map((y) => y.number))).size;
  return {
    lapsLeft: Math.max(0, totalLaps - d.lap),
    fieldSize: f.drivers.length,
    newerThanMe: older,
    aheadCount: ahead.length,
    pittedAhead,
    nearCount: near.size,
    nearStops,
  };
}

// Pit loss under the current flag: the same source and factors as projectRejoin
// (blind decision pit_loss.normal_s × 0.5 under SC, × 0.75 under VSC, × 1 at green).
export function pitLossUnder(normal: number | null | undefined, status: LapFrame["track_status"]): number | null {
  if (normal == null) return null;
  const factor = status === "SC" ? 0.5 : status === "VSC" ? 0.75 : 1;
  return Math.round(normal * factor * 10) / 10;
}

// Undercut clock, from pre-call info only (callMomentFrames output: laps before L plus the call-moment frame).
// A rival is a car within one pit loss (current flag) that stopped in the last UNDERCUT_WINDOW laps, or, when
// none did, the nearest car each side that has not stopped (the lighter "if they stay out" version).
export const UNDERCUT_WINDOW = 5;
// Below this many seconds either way, a projected gap is "about level": no signed decimal is shown.
export const TIGHT_S = 1.0;
export const isTight = (v: number | null | undefined) => v != null && Math.abs(v) < TIGHT_S;
// Rough fuel effect: later laps get this much faster per lap, removed from the new-tyre gain estimate.
const FUEL_S_PER_LAP = 0.05;

export interface Undercut {
  code: string;
  number: number;
  compound: string | null;
  age: number | null;
  pitted: boolean;
  // Seconds; positive = the rival is behind you on the road.
  gapNow: number;
  lapsSinceStop: number | null;
  // The call came on the rival's out-lap or first lap after it: no clean new-tyre lap to read yet.
  tooEarly: boolean;
  // Rival lap time minus yours over its laps since the stop, out-lap excluded; negative = rival faster.
  paceDelta: number | null;
  paceLaps: number[];
  // Gap after a stop now: positive = you rejoin ahead of the rival.
  boxNow: number;
  // Same if you wait one lap (null without a pace delta).
  boxNextLap: number | null;
  // Laps of staying out until boxing would drop you behind the rival (0: already; null: never at this pace).
  lapsUntilUndercut: number | null;
  loss: number;
  // Lighter version only: estimated gain per lap from new tyres, from cars that already stopped.
  newTyreGain: number | null;
  gainFrom: number;
}

type TimedDriver = LapFrame["drivers"][number] & { lap_time_s?: number | null };

export function undercutRivals(seen: LapFrame[], d: BlindDecision, max = 2): Undercut[] {
  const moment = seen.find((f) => f.lap === d.lap);
  const me = moment?.drivers.find((x) => x.number === d.player_role.number);
  const loss = pitLossUnder(d.pit_loss?.normal_s, moment?.track_status ?? "GREEN");
  if (!moment || !me || me.gap_to_leader_s == null || loss == null) return [];
  const byLap = new Map(seen.map((f) => [f.lap, f]));
  const row = (lap: number, n: number) => byLap.get(lap)?.drivers.find((x) => x.number === n) as TimedDriver | undefined;
  const time = (lap: number, n: number) => {
    const f = byLap.get(lap);
    const t = row(lap, n)?.lap_time_s;
    return f && f.track_status === "GREEN" && lap < d.lap && typeof t === "number" && t > 0 ? t : null;
  };
  const stopLap = (n: number) => {
    let s: number | null = null;
    for (const f of seen) if (f.lap <= d.lap && f.drivers.find((x) => x.number === n)?.pitted_this_lap) s = f.lap;
    return s;
  };
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r2 = (v: number) => Math.round(v * 100) / 100;

  const base = (x: (typeof moment.drivers)[number]) => {
    const gapNow = r1((x.gap_to_leader_s as number) - (me.gap_to_leader_s as number));
    return { code: x.code, number: x.number, compound: x.compound, age: x.tyre_age, gapNow, loss };
  };
  const near = moment.drivers.filter((x) => x.number !== me.number && x.gap_to_leader_s != null && Math.abs(x.gap_to_leader_s - me.gap_to_leader_s!) <= loss);

  const pitted: Undercut[] = [];
  for (const x of near) {
    const s = stopLap(x.number);
    if (s == null || d.lap - s > UNDERCUT_WINDOW) continue;
    // Laps after the stop, skipping the out-lap (s + 1).
    const paceLaps: number[] = [];
    const deltas: number[] = [];
    for (let l = s + 2; l < d.lap; l++) {
      const a = time(l, x.number);
      const b = time(l, me.number);
      if (a != null && b != null) {
        paceLaps.push(l);
        deltas.push(a - b);
      }
    }
    const tooEarly = d.lap <= s + 2;
    const paceDelta = !tooEarly && deltas.length ? r2(deltas.reduce((p, v) => p + v, 0) / deltas.length) : null;
    const b = base(x);
    const boxNow = r1(b.gapNow - loss);
    let until: number | null = null;
    if (tooEarly) until = null;
    else if (boxNow < 0) until = 0;
    else if (paceDelta != null && paceDelta < 0) until = Math.floor(boxNow / -paceDelta) + 1;
    pitted.push({
      ...b,
      pitted: true,
      tooEarly,
      lapsSinceStop: d.lap - s,
      paceDelta,
      paceLaps,
      boxNow,
      boxNextLap: paceDelta != null ? r1(b.gapNow + paceDelta - loss) : null,
      lapsUntilUndercut: until,
      newTyreGain: null,
      gainFrom: 0,
    });
  }
  if (pitted.length) {
    return pitted.sort((p, q) => (p.lapsSinceStop ?? 99) - (q.lapsSinceStop ?? 99) || Math.abs(p.gapNow) - Math.abs(q.gapNow)).slice(0, max);
  }

  // Lighter version: nobody near has stopped. New-tyre gain from cars that stopped earlier in the race.
  const gains: number[] = [];
  for (const x of moment.drivers) {
    const s = stopLap(x.number);
    if (s == null || s >= d.lap) continue;
    const pre = [s - 3, s - 2, s - 1].map((l) => time(l, x.number)).filter((v): v is number => v != null);
    const post = [s + 2, s + 3, s + 4].filter((l) => l < d.lap).map((l) => time(l, x.number)).filter((v): v is number => v != null);
    if (pre.length < 2 || post.length < 1) continue;
    const mean = (a: number[]) => a.reduce((p, v) => p + v, 0) / a.length;
    gains.push(mean(pre) - mean(post) - FUEL_S_PER_LAP * 4);
  }
  const gain = gains.length ? r2(gains.reduce((p, v) => p + v, 0) / gains.length) : null;
  const unstopped = near.filter((x) => stopLap(x.number) == null);
  const behind = unstopped.filter((x) => x.gap_to_leader_s! > me.gap_to_leader_s!).sort((a, b) => a.gap_to_leader_s! - b.gap_to_leader_s!)[0];
  const ahead = unstopped.filter((x) => x.gap_to_leader_s! < me.gap_to_leader_s!).sort((a, b) => b.gap_to_leader_s! - a.gap_to_leader_s!)[0];
  return [behind, ahead]
    .filter((x): x is NonNullable<typeof x> => !!x)
    .slice(0, max)
    .map((x) => {
      const b = base(x);
      return {
        ...b,
        pitted: false,
        tooEarly: false,
        lapsSinceStop: null,
        paceDelta: null,
        paceLaps: [],
        boxNow: r1(b.gapNow - loss),
        boxNextLap: null,
        lapsUntilUndercut: null,
        newTyreGain: gain,
        gainFrom: gains.length,
      };
    });
}
