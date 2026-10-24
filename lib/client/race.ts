// Pure helpers for the replay clock, the timing tower and scoreboard facts.
import { CALL_WINDOW_S, VOICE_NOTE_MAX_S } from "@/lib/scoring";
import type { Call, DecisionPoint, LapFrame, Submission } from "@/lib/types";

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
export function callMomentFrames(frames: LapFrame[], d: DecisionPoint): LapFrame[] {
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

export function replayLap(d: DecisionPoint, elapsedMs: number): number {
  return Math.min(d.lap, d.replay_from_lap + Math.max(0, Math.floor(elapsedMs / LAP_MS)));
}

export function playedOutLap(d: DecisionPoint, elapsedMs: number): number {
  const span = Math.max(1, d.reveal_to_lap - d.lap);
  const per = PLAYED_OUT_MS / span;
  return Math.min(d.reveal_to_lap, d.lap + Math.max(0, Math.floor(elapsedMs / per)));
}

export function replayDoneMs(d: DecisionPoint): number {
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

export function contextAt(d: DecisionPoint, frames: LapFrame[]) {
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

export function perFactor(d: DecisionPoint): number {
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
