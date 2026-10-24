import type { NextRequest } from "next/server";
import { getLobbyState } from "@/lib/db";
import { handle, HttpError, normalizeCode } from "../../_lib/http";

// Polled every second by each client: one query.
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/lobby/[code]">) => {
  const code = normalizeCode((await ctx.params).code);
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");
  // Until the reveal, players only see who has called, not what they called.
  if (state.phase === "waiting" || state.phase === "replay" || state.phase === "decision") {
    state.submissions = state.submissions.map((s) => ({
      ...s,
      call: null,
      reasons: [],
      factors_named: [],
      transcript: "",
      score_call: 0,
      score_reasoning: 0,
      total: 0,
    }));
  }
  return Response.json(state, { headers: { "Cache-Control": "no-store" } });
});
