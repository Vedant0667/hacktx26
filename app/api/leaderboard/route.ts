import { connection, type NextRequest } from "next/server";
import { getDecisionTotals, getLobbyMeta, topSubmissions } from "@/lib/db";
import { parseCallLocal } from "@/lib/muse";
import { percentile, scoreCall } from "@/lib/scoring";
import type { Call, DecisionPoint, Score } from "@/lib/types";
import { handle, HttpError, normalizeCode, requireDecision } from "../_lib/http";
import { isRevealed } from "../_lib/redact";

type Row = Omit<Score, "score_call" | "score_reasoning"> & {
  score_call: number | null; // null unless revealed
  score_reasoning: number | null;
  kind: "player" | "team" | "engine";
  name: string;
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
): Row {
  const factors_named = factorsMentioned(decision, reasons);
  const score = scoreCall(decision, call, factors_named);
  return {
    kind, name, lobby_code: null, call, reasons, factors_named, seconds_to_call: null,
    ...score, percentile: percentile(score.total, [...totals, score.total]),
  };
}

// True only when ?lobby= names a lobby on this decision that has reached its reveal.
async function lobbyRevealed(raw: string | null, decisionId: string): Promise<boolean> {
  if (!raw) return false;
  let code: string;
  try {
    code = normalizeCode(raw);
  } catch {
    return false;
  }
  const meta = await getLobbyMeta(code);
  return !!meta && meta.decision_id === decisionId && isRevealed(meta.phase);
}

// Top 50 players on a decision worldwide, plus the real team and the engine scored the same way.
// GET /api/leaderboard?decision_id=<id>&lobby=<CODE>. Unless that lobby has revealed this decision, the
// answer stays out: team and engine are null, and player rows carry no call, reasons, factors or part scores.
export const GET = handle(async (req: NextRequest) => {
  await connection(); // always per request; skips the build-time prerender attempt
  const decisionId = req.nextUrl.searchParams.get("decision_id");
  if (!decisionId) throw new HttpError(400, "decision_id is required");
  const decision = await requireDecision(decisionId);

  const [top, totals, revealed] = await Promise.all([
    topSubmissions(decision.id, 50),
    getDecisionTotals(decision.id),
    lobbyRevealed(req.nextUrl.searchParams.get("lobby"), decision.id),
  ]);
  const players: Row[] = top.map((s) => ({
    kind: "player", name: s.player_name, lobby_code: s.lobby_code, seconds_to_call: s.seconds_to_call,
    total: s.total, percentile: percentile(s.total, totals),
    ...(revealed
      ? { call: s.call, reasons: s.reasons, factors_named: s.factors_named, score_call: s.score_call, score_reasoning: s.score_reasoning }
      : { call: null, reasons: [], factors_named: [], score_call: null, score_reasoning: null }),
  }));
  const team = revealed
    ? benchmark(decision, "team", decision.player_role.team, decision.team.call, decision.team.reasons, totals)
    : null;
  const engine = revealed ? benchmark(decision, "engine", "Engine", decision.engine.call, decision.engine.reasons, totals) : null;

  // Stable sort: on equal totals, players (already ordered by faster call) stay ahead of team and engine.
  const rows = [...players, ...(team && engine ? [team, engine] : [])].sort((a, b) => b.total - a.total);
  return Response.json(
    { decision_id: decision.id, revealed, total_players: totals.length, totals: [...totals].sort((x, y) => x - y), team, engine, rows },
    { headers: { "Cache-Control": "no-store" } },
  );
});
