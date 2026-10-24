import { connection, type NextRequest } from "next/server";
import { getDecisionTotals, getLobbyDriverCodes, topSubmissions, type LobbyMeta } from "@/lib/db";
import { decisionForDriver, getDriverAnswers } from "@/lib/data";
import { parseCallLocal } from "@/lib/muse";
import { percentile, scoreCall } from "@/lib/scoring";
import type { Call, DecisionPoint, Score } from "@/lib/types";
import { requireLobbyMember } from "../_lib/access";
import { handle, HttpError, normalizeCode, requireDecision } from "../_lib/http";
import { isRevealed } from "../_lib/redact";

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
export const GET = handle(async (req: NextRequest) => {
  await connection(); // always per request; skips the build-time prerender attempt
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
