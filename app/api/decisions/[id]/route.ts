import type { NextRequest } from "next/server";
import { getBlindDecision } from "@/lib/data";
import { handle, HttpError } from "../../_lib/http";
import { BLIND_CACHE } from "../cache";

// The blind decision (decision_points.blind): what the pit wall knows at the call. No team, engine, ground truth
// or reveal lap; those leave the server only through GET /api/lobby/[code]/reveal.
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/decisions/[id]">) => {
  const { id } = await ctx.params;
  const decision = await getBlindDecision(id);
  if (!decision) throw new HttpError(404, "Decision not found");
  return Response.json(decision, { headers: { "Cache-Control": BLIND_CACHE } });
});
