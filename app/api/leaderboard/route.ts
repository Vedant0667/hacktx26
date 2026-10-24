import { connection, type NextRequest } from "next/server";
import { getDecisionTotals, topSubmissions } from "@/lib/db";
import { parseCallLocal } from "@/lib/muse";
import { percentile, scoreCall } from "@/lib/scoring";
import type { Call, DecisionPoint, Score } from "@/lib/types";
import { handle, HttpError, requireDecision } from "../_lib/http";

type Row = Score & {
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

// Top 50 players on a decision worldwide, plus the real team and the engine scored the same way.
export const GET = handle(async (req: NextRequest) => {
  await connection(); // always per request; skips the build-time prerender attempt
  const decisionId = req.nextUrl.searchParams.get("decision_id");
  if (!decisionId) throw new HttpError(400, "decision_id is required");
  const decision = await requireDecision(decisionId);

  const [top, totals] = await Promise.all([topSubmissions(decision.id, 50), getDecisionTotals(decision.id)]);
  const players: Row[] = top.map((s) => ({
    kind: "player", name: s.player_name, lobby_code: s.lobby_code, call: s.call, reasons: s.reasons,
    factors_named: s.factors_named, seconds_to_call: s.seconds_to_call, score_call: s.score_call,
    score_reasoning: s.score_reasoning, total: s.total,
    percentile: percentile(s.total, totals),
  }));
  const team = benchmark(decision, "team", decision.player_role.team, decision.team.call, decision.team.reasons, totals);
  const engine = benchmark(decision, "engine", "Engine", decision.engine.call, decision.engine.reasons, totals);

  // Stable sort: on equal totals, players (already ordered by faster call) stay ahead of team and engine.
  const rows = [...players, team, engine].sort((a, b) => b.total - a.total);
  return Response.json(
    { decision_id: decision.id, total_players: totals.length, totals: [...totals].sort((x, y) => x - y), team, engine, rows },
    { headers: { "Cache-Control": "no-store" } },
  );
});
