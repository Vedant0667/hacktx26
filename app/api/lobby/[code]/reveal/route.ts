import type { NextRequest } from "next/server";
import { getLobbyMeta } from "@/lib/db";
import { getFrames, getGroundTruth } from "@/lib/data";
import { handle, HttpError, normalizeCode, requireDecision } from "../../../_lib/http";
import { isRevealed } from "../../../_lib/redact";

// The answer, only once this lobby has revealed: the full decision (team, engine, ground truth), every lap
// of frames, and ground_truth.json. Before that, clients have only the blind copies in public/data.
// Response: { decision: DecisionPoint & { total_laps, pit_loss }, frames, ground_truth }.
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/reveal">) => {
  const code = normalizeCode((await ctx.params).code);
  const meta = await getLobbyMeta(code);
  if (!meta) throw new HttpError(404, "Lobby not found");
  if (!isRevealed(meta.phase)) throw new HttpError(409, "The answer opens at the reveal");

  const decision = await requireDecision(meta.decision_id);
  const [frames, ground_truth] = await Promise.all([getFrames(decision.id), getGroundTruth(decision.id)]);
  if (!frames || !ground_truth) throw new HttpError(404, `Data for ${decision.id} not found`);
  const total_laps = frames[frames.length - 1]?.lap ?? decision.lap;
  return Response.json(
    { decision: { ...decision, total_laps, pit_loss: ground_truth.pit_loss ?? null }, frames, ground_truth },
    { headers: { "Cache-Control": "no-store" } },
  );
});
