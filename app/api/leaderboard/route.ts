import { connection, type NextRequest } from "next/server";
import { getDecisionTotals, getLobbyDriverCodes, getLobbyState, getRaceCalls, raceGlobalTotals, topSubmissions, type LobbyMeta } from "@/lib/db";
import { decisionForDriver, getDriverAnswers, getRaceEntry, getRaceFreezes, type RaceEntry } from "@/lib/data";
import { parseCallLocal } from "@/lib/muse";
import { percentile, scoreCall } from "@/lib/scoring";
import type { Call, DecisionPoint, Score } from "@/lib/types";
import { requireLobbyMember } from "../_lib/access";
import { handle, HttpError, normalizeCode, requireDecision } from "../_lib/http";
import { isRevealed } from "../_lib/redact";
import { benchmarkScore, clockOf, freezeDecision, revealedLaps } from "../_lib/race";

type Row = Omit<Score, "score_call" | "score_reasoning"> & {
  score_call: number | null; // null unless revealed
  score_reasoning: number | null;
  kind: "player" | "team" | "engine";
  name: string;
  driver_code: string | null; // the car the row was scored against (Round 4)
  lobby_code: string | null;
  call: Call | null;
  reasons: string[];
  factors_named: string[];
  seconds_to_call: number | null; // null for team and engine
  percentile: number;
};

// Factors from the decision's published list that the reasons mention, by keyword or by name.
function factorsMentioned(decision: DecisionPoint, reasons: string[]): string[] {
  const text = reasons.join(". ");
  const byKeyword = new Set(parseCallLocal(text).factors_named);
  const lower = text.toLowerCase();
  return decision.factors.filter(
    (f) => byKeyword.has(f) || lower.includes(f.toLowerCase()) || lower.includes(f.replace(/_/g, " ").toLowerCase()),
  );
}

function benchmark(
  decision: DecisionPoint,
  kind: "team" | "engine",
  name: string,
  call: Call,
  reasons: string[],
  totals: number[],
  driverCode: string | null,
): Row {
  const factors_named = factorsMentioned(decision, reasons);
  const score = scoreCall(decision, call, factors_named);
  return {
    kind, name, driver_code: driverCode, lobby_code: null, call, reasons, factors_named, seconds_to_call: null,
    ...score, percentile: percentile(score.total, [...totals, score.total]),
  };
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
  freezes: { lap: number; call: Call | null; score_call: number; score_reasoning: number; total: number }[];
  audibles: { lap: number; status: string; total: number }[];
}

// Round 6, 6.11: race leaderboard. With lobby= (and that lobby's token): its players plus team and engine rows
// for each car played, counting revealed freezes and, at done, audibles. Without: finished lobbies' totals only.
async function raceLeaderboard(req: NextRequest, race: RaceEntry): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  const raw = req.nextUrl.searchParams.get("lobby");
  if (!raw) {
    const rows: RaceRow[] = (await raceGlobalTotals(race.race_key)).map((r) => ({
      kind: "player", name: r.name, driver_code: r.driver_code, lobby_code: null, total: r.total, freezes: [], audibles: [],
    }));
    return Response.json({ race_key: race.race_key, revealed_laps: [], done: false, rows }, { headers });
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
  const clock = clockOf(meta);
  const revealed = revealedLaps(clock);
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
      row.freezes.push({ lap: c.lap, call: c.call, score_call: c.score_call, score_reasoning: c.score_reasoning, total: c.total });
      row.total += c.total;
    } else if (c.kind === "audible" && done) {
      row.audibles.push({ lap: c.lap, status: c.status, total: c.total });
      row.total += c.total;
    }
  }
  const benchmarks: RaceRow[] = [];
  for (const car of cars) {
    const info = race.drivers.find((d) => d.code === car);
    const team: RaceRow = { kind: "team", name: `${info?.team ?? car} (${car})`, driver_code: car, lobby_code: null, total: 0, freezes: [], audibles: [] };
    const engine: RaceRow = { kind: "engine", name: `Engine (${car})`, driver_code: car, lobby_code: null, total: 0, freezes: [], audibles: [] };
    for (const entry of (meta.freeze_plan ?? []).filter((e) => revealed.includes(e.lap) && e.drivers.includes(car))) {
      const f = freezes.find((x) => x.lap === entry.lap && x.driver_code === car);
      if (!f) continue;
      const decision = freezeDecision(race.race_key, race.name, f);
      for (const [row, call, reasons] of [[team, f.full.team_call.call, f.full.team_call.reasons], [engine, f.full.engine.call, f.full.engine.reasons]] as const) {
        const sc = benchmarkScore(decision, call, [...reasons]);
        row.freezes.push({ lap: entry.lap, call, ...sc });
        row.total += sc.total;
      }
    }
    benchmarks.push(team, engine);
  }
  const rows = [...byName.values(), ...benchmarks].sort((a, b) => b.total - a.total);
  return Response.json({ race_key: race.race_key, revealed_laps: revealed, done, rows }, { headers });
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
  const players: Row[] = top.map((s) => ({
    // Other lobbies' codes are never sent (a code plus a late join opens that lobby's reveal); only rows from
    // the viewer's own revealed lobby carry its code, so the UI can mark them.
    kind: "player", name: s.player_name, driver_code: s.driver_code, lobby_code: revealedCode !== null && s.lobby_code === revealedCode ? s.lobby_code : null, seconds_to_call: s.seconds_to_call,
    total: s.total, percentile: percentile(s.total, totals),
    ...(revealed
      ? { call: s.call, reasons: s.reasons, factors_named: s.factors_named, score_call: s.score_call, score_reasoning: s.score_reasoning }
      : { call: null, reasons: [], factors_named: [], score_call: null, score_reasoning: null }),
  }));
  // A team row and an engine row for each car played in the viewer's revealed lobby.
  const benchmarks: Row[] = [];
  let team: Row | null = null;
  let engine: Row | null = null;
  if (lobby) {
    const [answers, played] = await Promise.all([getDriverAnswers(decision.id), getLobbyDriverCodes(lobby.code)]);
    for (const d of answers ?? []) {
      if (!d.scorable || !played.includes(d.code)) continue;
      const asDriver = decisionForDriver(decision, d);
      const t = benchmark(asDriver, "team", `${d.team} (${d.code})`, d.team_call.call, d.team_call.reasons, totals, d.code);
      const e = benchmark(asDriver, "engine", `Engine (${d.code})`, d.engine.call, d.engine.reasons, totals, d.code);
      benchmarks.push(t, e);
      if (lobby.meta.driver_mode === "same" && d.code === lobby.meta.driver_code) [team, engine] = [t, e];
    }
  }

  // Stable sort: on equal totals, players (already ordered by faster call) stay ahead of team and engine.
  const rows = [...players, ...benchmarks].sort((a, b) => b.total - a.total);
  return Response.json(
    { decision_id: decision.id, revealed, total_players: totals.length, totals: [...totals].sort((x, y) => x - y), team, engine, benchmarks, rows },
    { headers: { "Cache-Control": "no-store" } },
  );
});
