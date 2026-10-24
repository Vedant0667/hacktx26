import type { NextRequest } from "next/server";
import { getLobbyState } from "@/lib/db";
import { parseCallLocal } from "@/lib/muse";
import type { Submission } from "@/lib/types";
import { handle, HttpError, normalizeCode } from "../../../_lib/http";
import { isRevealed } from "../../../_lib/redact";

const QUOTE_MAX = 90;

function clip(text: string): string {
  const t = text.trim();
  if (t.length <= QUOTE_MAX) return t;
  const cut = t.slice(0, QUOTE_MAX);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : QUOTE_MAX)}…`;
}

// The part of a player's call that names this factor; falls back to the start of the transcript.
function quoteFor(s: Submission, factor: string): string {
  const reason = s.reasons.find((r) => parseCallLocal(r).factors_named.includes(factor));
  return clip(reason ?? s.transcript);
}

// Lobby submissions on the current decision grouped by factor id (Muse will relabel these later).
// Response: { code, decision_id, phase, submitted, by_call: {BOX, STAY, none},
//             camps: [{factor, count, players, quotes}] (largest first), no_factor: {count, players, quotes} }
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/camps">) => {
  const code = normalizeCode((await ctx.params).code);
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");
  if (!isRevealed(state.phase)) throw new HttpError(409, "Camps open at the reveal");

  const by_call = { BOX: 0, STAY: 0, none: 0 };
  const groups = new Map<string, { factor: string; count: number; players: string[]; quotes: string[] }>();
  const no_factor = { count: 0, players: [] as string[], quotes: [] as string[] };

  for (const s of state.submissions) {
    by_call[s.call ?? "none"]++;
    if (s.factors_named.length === 0) {
      no_factor.count++;
      no_factor.players.push(s.player_name);
      if (s.transcript.trim()) no_factor.quotes.push(clip(s.transcript));
      continue;
    }
    for (const factor of new Set(s.factors_named)) {
      const g = groups.get(factor) ?? { factor, count: 0, players: [], quotes: [] };
      g.count++;
      g.players.push(s.player_name);
      const q = quoteFor(s, factor);
      if (q) g.quotes.push(q);
      groups.set(factor, g);
    }
  }

  const camps = [...groups.values()].sort((a, b) => b.count - a.count || a.factor.localeCompare(b.factor));
  return Response.json(
    { code, decision_id: state.decision_id, phase: state.phase, submitted: state.submissions.length, by_call, camps, no_factor },
    { headers: { "Cache-Control": "no-store" } },
  );
});
