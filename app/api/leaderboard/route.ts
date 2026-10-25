import { connection, type NextRequest } from "next/server";
import { getDecisionTotals, getLobbyDriverCodes, getLobbyState, getRaceCalls, raceGlobalTotals, topSubmissions, type LobbyMeta } from "@/lib/db";
import { getRaceEntry, getRaceFreezes, type RaceEntry } from "@/lib/data";
import { shapeMomentDetail } from "@/lib/names";
import { percentile, rankLabel, sharedRanks } from "@/lib/scoring";
import type { Call } from "@/lib/types";
import { requireLobbyMember } from "../_lib/access";
import { ensureRaceGraded, momentBenchmarks, raceBenchmarkGrades } from "../_lib/grading";
import { handle, HttpError, normalizeCode, requireDecision } from "../_lib/http";
import { isRevealed } from "../_lib/redact";
import { answerLaps, clockOf } from "../_lib/race";

// Round 7: score_call is the call's stakes, score_reasoning the reasoning score (0–50), total the signed points.
// Equal totals share a rank (rank + tied); time to call is never sent and never breaks a tie.
interface Row {
  kind: "player" | "team" | "engine";
  name: string;
  driver_code: string | null; // the car the row was scored against (Round 4)
  lobby_code: string | null;
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  verdict: string | null;
  seconds_to_call: null; // Round 7: not part of scoring or ranking
  score_call: number | null; // null unless revealed
  score_reasoning: number | null;
  total: number;
  percentile: number;
  rank: number;
  tied: boolean;
  rank_label: string;
}

// Best first; on equal totals players come before benchmarks, then by name. Ranks are shared on equal totals.
function ranked<T extends { kind: string; name: string; total: number }>(rows: T[]): (T & { rank: number; tied: boolean; rank_label: string })[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total || (a.kind === "player" ? 0 : 1) - (b.kind === "player" ? 0 : 1) || a.name.localeCompare(b.name));
  const r = sharedRanks(sorted.map((x) => x.total));
  return sorted.map((x, i) => ({ ...x, ...r[i], rank_label: rankLabel(r[i]) }));
}

// ?lobby= is honoured only for its host (x-host-token) or a player who joined it (x-player-token); anything
// else, an unknown code included, is 403 (miss-limited). True when that lobby is on this decision and revealed.
async function lobbyRevealed(req: NextRequest, raw: string | null, decisionId: string): Promise<{ code: string; meta: LobbyMeta } | null> {
  if (!raw) return null;
  const denied = "Only players in this lobby and its host can see its reveal";
  let code: string;
  try {
    code = normalizeCode(raw);
  } catch {
    throw new HttpError(403, denied);
  }
  const { meta } = await requireLobbyMember(req, code, denied);
  return meta.decision_id === decisionId && isRevealed(meta.phase) ? { code, meta } : null;
}

// Top 50 players on a decision worldwide across every car, plus, once revealed, the real team and the engine
// for each car played in the viewer's lobby, scored against that car (Round 4).
// GET /api/leaderboard?decision_id=<id>&lobby=<CODE> (+ x-host-token or x-player-token for that lobby).
// Unless that lobby has revealed this decision, the
// answer stays out: team and engine are null, and player rows carry no call, reasons, factors or part scores.
interface RaceRow {
  kind: "player" | "team" | "engine";
  name: string;
  driver_code: string | null;
  lobby_code: string | null;
  total: number;
  freezes: { lap: number; call: Call | null; score_call: number; score_reasoning: number; total: number; verdict: string | null }[];
  audibles: { lap: number; status: string; total: number }[];
}

// Round 6, 6.11: race leaderboard. With lobby= (and that lobby's token): its players plus team and engine rows
// for each car played, counting revealed freezes and, at done, audibles. Without: finished lobbies' totals only.
// Round 7: reading it with lobby= also grades that lobby's revealed calls once (grading: true until done).
async function raceLeaderboard(req: NextRequest, race: RaceEntry): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const raw = req.nextUrl.searchParams.get("lobby");
  if (!raw) {
    const rows = ranked(
      (await raceGlobalTotals(race.race_key)).map((r): RaceRow => ({
        kind: "player", name: r.name, driver_code: r.driver_code, lobby_code: null, total: r.total, freezes: [], audibles: [],
      })),
    );
    return Response.json({ race_key: race.race_key, revealed_laps: [], done: false, grading: false, rows }, { headers });
  }
  const denied = "Only players in this lobby and its host can see its reveal";
  let code: string;
  try {
    code = normalizeCode(raw);
  } catch {
    throw new HttpError(403, denied);
  }
  const { meta } = await requireLobbyMember(req, code, denied);
  if (meta.mode !== "race" || meta.race_key !== race.race_key) throw new HttpError(409, "That lobby is not on this race");
  const { grading } = await ensureRaceGraded(code, meta, race);
  const clock = clockOf(meta);
  const revealed = answerLaps(clock); // Round 7: scores count only at the flag
  const done = meta.phase === "done";
  const [calls, state, cars, freezes] = await Promise.all([getRaceCalls(code), getLobbyState(code), getLobbyDriverCodes(code), getRaceFreezes(race.race_key)]);
  const byName = new Map<string, RaceRow>();
  for (const p of state?.players ?? []) {
    byName.set(p.name, { kind: "player", name: p.name, driver_code: p.driver_code, lobby_code: code, total: 0, freezes: [], audibles: [] });
  }
  for (const c of calls) {
    const row = byName.get(c.player_name) ?? { kind: "player" as const, name: c.player_name, driver_code: c.driver_code, lobby_code: code, total: 0, freezes: [], audibles: [] };
    byName.set(c.player_name, row);
    if (c.kind === "freeze" && revealed.includes(c.lap)) {
      row.freezes.push({ lap: c.lap, call: c.call, score_call: c.score_call, score_reasoning: c.score_reasoning, total: c.total, verdict: c.verdict ?? null });
      row.total += c.total;
    } else if (c.kind === "audible" && done) {
      row.audibles.push({ lap: c.lap, status: c.status, total: c.total });
      row.total += c.total;
    }
  }
  const items = (meta.freeze_plan ?? [])
    .filter((e) => revealed.includes(e.lap))
    .flatMap((e) => cars.filter((car) => e.drivers.includes(car)).map((car) => ({ car, freeze: freezes.find((x) => x.lap === e.lap && x.driver_code === car) })))
    .filter((x): x is { car: string; freeze: NonNullable<typeof x.freeze> } => !!x.freeze);
  const grades = await raceBenchmarkGrades(race.race_key, race.total_laps, items);
  const benchmarks: RaceRow[] = [];
  for (const car of cars) {
    const info = race.drivers.find((d) => d.code === car);
    const team: RaceRow = { kind: "team", name: `${info?.team ?? car} (${car})`, driver_code: car, lobby_code: null, total: 0, freezes: [], audibles: [] };
    const engine: RaceRow = { kind: "engine", name: `Engine (${car})`, driver_code: car, lobby_code: null, total: 0, freezes: [], audibles: [] };
    for (const g of grades.filter((x) => x.car === car)) {
      const row = g.kind === "team" ? team : engine;
      row.freezes.push({ lap: g.lap, call: g.call, score_call: g.stakes, score_reasoning: g.grade.reasoning_score, total: g.points, verdict: g.grade.verdict });
      row.total += g.points;
    }
    benchmarks.push(team, engine);
  }
  const rows = ranked([...byName.values(), ...benchmarks]);
  return Response.json({ race_key: race.race_key, revealed_laps: revealed, done, grading, rows }, { headers });
}

export const GET = handle(async (req: NextRequest) => {
  await connection(); // always per request; skips the build-time prerender attempt
  const raceKey = req.nextUrl.searchParams.get("race_key");
  if (raceKey) {
    const race = await getRaceEntry(raceKey);
    if (!race) throw new HttpError(404, "Race not found");
    return raceLeaderboard(req, race);
  }
  const decisionId = req.nextUrl.searchParams.get("decision_id");
  if (!decisionId) throw new HttpError(400, "decision_id is required");
  const decision = await requireDecision(decisionId);

  const [top, totals, lobby] = await Promise.all([
    topSubmissions(decision.id, 50),
    getDecisionTotals(decision.id),
    lobbyRevealed(req, req.nextUrl.searchParams.get("lobby"), decision.id),
  ]);
  const revealedCode = lobby?.code ?? null;
  const revealed = revealedCode !== null;
  const players = top.map((s) => {
    // Other lobbies' codes are never sent (a code plus a late join opens that lobby's reveal); only rows from
    // the viewer's own revealed lobby carry its code, so the UI can mark them. Only those rows carry the
    // call, reasons and scores: every other lobby's row is name, car and total (this board is public).
    const own = revealedCode !== null && s.lobby_code === revealedCode;
    return {
      kind: "player" as const, name: s.player_name, driver_code: s.driver_code, lobby_code: revealedCode !== null && s.lobby_code === revealedCode ? s.lobby_code : null, seconds_to_call: null,
      total: s.total, percentile: percentile(s.total, totals),
      ...shapeMomentDetail(own, revealed, s),
    };
  });
  // A team row and an engine row for each car played in the viewer's revealed lobby, graded like players.
  const benchmarks = lobby
    ? (await momentBenchmarks(lobby.code, lobby.meta)).map((b) => ({
        kind: b.job.key.kind, name: b.job.key.kind === "engine" ? `Engine (${b.job.key.driver_code})` : `${b.decision.player_role.team} (${b.job.key.driver_code})`,
        driver_code: b.job.key.driver_code, lobby_code: null, call: b.job.call, reasons: b.job.reasons, factors_named: b.grade.credited,
        verdict: b.grade.verdict, seconds_to_call: null, score_call: b.stakes, score_reasoning: b.grade.reasoning_score, total: b.points,
        percentile: percentile(b.points, [...totals, b.points]),
      }))
    : [];
  const rows: Row[] = ranked([...players, ...benchmarks]);
  const pick = (kind: "team" | "engine") =>
    lobby && lobby.meta.driver_mode === "same" ? (rows.find((r) => r.kind === kind && r.driver_code === lobby.meta.driver_code) ?? null) : null;
  return Response.json(
    {
      decision_id: decision.id, revealed, total_players: totals.length, totals: [...totals].sort((x, y) => x - y),
      team: pick("team"), engine: pick("engine"), benchmarks: rows.filter((r) => r.kind !== "player"), rows,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
