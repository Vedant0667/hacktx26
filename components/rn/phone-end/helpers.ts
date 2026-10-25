// Pure helpers for the Race Night phone end, mirroring components/EndScreen.tsx (those are module-private there).
import type { GameSummary, MomentCar, MomentEntry, RankRow, SummaryAudible, SummaryMoment } from "@/lib/client/api";
import { playerRanks, splitPoints, type Split } from "@/lib/client/score";
import { COPY } from "@/lib/copy";

export function carFor(m: SummaryMoment, e: { driver_code: string | null }): MomentCar | undefined {
  return m.cars.find((c) => c.code === e.driver_code) ?? m.cars[0];
}
// The right call for an entry, after any luck verdict on its car.
export function rightOf(m: SummaryMoment, e: MomentEntry): boolean | null {
  if (!e.call) return null;
  const car = carFor(m, e);
  return car?.final_right_call ? e.call === car.final_right_call : e.right;
}
export function splitOf(m: SummaryMoment, e: MomentEntry): Split | null {
  if (!e.call) return null;
  return splitPoints(e.stakes, !!rightOf(m, e), e.reasoning, e.points);
}
export function audibleSplit(a: SummaryAudible): Split | null {
  return a.status === "scored" ? splitPoints(a.stakes, !!a.right, a.reasoning, a.points) : null;
}

// Freeze calls only (audibles are separate), so "x of n calls right" matches the call cards.
export function freezeTally(s: GameSummary, me: string): { right: number; calls: number } {
  let right = 0;
  let calls = 0;
  for (const m of s.moments)
    for (const e of m.entries) {
      if (e.kind !== "player" || e.name !== me || !e.call) continue;
      calls++;
      if (rightOf(m, e)) right++;
    }
  return { right, calls };
}

// Players grouped by shared rank (ties share one row), best first.
export interface StandingGroup {
  rank: number;
  tied: boolean;
  names: string[];
  points: number;
  mine: boolean;
}
export function standingGroups(s: GameSummary, me: string): StandingGroup[] {
  const ranks = playerRanks(s.ranking);
  const players = s.ranking.filter((r) => r.kind === "player").sort((a, b) => b.points - a.points);
  const groups: StandingGroup[] = [];
  for (const p of players) {
    const rk = ranks.get(p.name);
    if (!rk) continue;
    const last = groups[groups.length - 1];
    if (last && last.rank === rk.rank) {
      last.names.push(p.name);
      last.mine ||= p.name === me;
    } else groups.push({ rank: rk.rank, tied: rk.tied, names: [p.name], points: p.points, mine: p.name === me });
  }
  return groups;
}

// The short list: the top three rank groups, then a gap marker and your group if it is further down.
export function shortStandings(groups: StandingGroup[], top = 3): { head: StandingGroup[]; gap: boolean; mine: StandingGroup | null } {
  const head = groups.slice(0, top);
  const mine = head.some((g) => g.mine) ? null : (groups.find((g) => g.mine) ?? null);
  // The gap marker shows only when rows are skipped (between the top three and your row, or after them).
  const gap = mine ? groups.indexOf(mine) > top : groups.length > top;
  return { head, gap, mine };
}

// Engine and the real team for your car (benchmarks, never ranked).
export function benchmarks(s: GameSummary, car: string | null): { engine: RankRow | null; team: RankRow | null } {
  const pick = (k: RankRow["kind"]) =>
    s.ranking.find((r) => r.kind === k && r.driver_code === car) ?? s.ranking.filter((r) => r.kind === k).sort((a, b) => b.points - a.points)[0] ?? null;
  return { engine: pick("engine"), team: pick("team") };
}

export type MyCall =
  | { kind: "moment"; lap: number; m: SummaryMoment; e: MomentEntry }
  | { kind: "audible"; lap: number; a: SummaryAudible };
export function myCalls(s: GameSummary, me: string): MyCall[] {
  return [
    ...s.moments.flatMap((m) => {
      const e = m.entries.find((x) => x.kind === "player" && x.name === me);
      return e ? [{ kind: "moment" as const, lap: m.lap, m, e }] : [];
    }),
    ...s.audibles.filter((a) => a.name === me).map((a) => ({ kind: "audible" as const, lap: a.lap, a })),
  ].sort((x, y) => x.lap - y.lap);
}

// Round 9 luck: a later red flag, SC/VSC or rain changed the result (legacy EndScreen luckNote).
export function luckNote(m: SummaryMoment, e: MomentEntry): string | null {
  const car = carFor(m, e);
  if (!car?.luck || !car.explanation || !e.call) return null;
  return rightOf(m, e) ? `${COPY.end.unlucky} ${car.explanation}` : `${COPY.end.lucky} ${car.explanation}`;
}
