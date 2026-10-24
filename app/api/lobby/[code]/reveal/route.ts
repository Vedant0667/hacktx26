import type { NextRequest } from "next/server";
import { getLobbyDriverCodes } from "@/lib/db";
import { getDriverAnswers, getFrames, getGroundTruth, type DriverReveal } from "@/lib/data";
import { requireLobbyMember } from "../../../_lib/access";
import { handle, HttpError, normalizeCode, requireDecision } from "../../../_lib/http";
import { isRevealed } from "../../../_lib/redact";

// The answer, only for this lobby's host (x-host-token) or a player who joined it (x-player-token), and only
// once the lobby has revealed: the full decision (team, engine, ground truth), every lap of frames, and
// ground_truth.json, plus each car played in this lobby with its own answer (Round 4). Before that, clients
// have only the blind data from GET /api/decisions/**.
// 403 for a missing or wrong token and for an unknown code (miss-limited); 409 before the reveal.
// Response: { decision: DecisionPoint & { total_laps, pit_loss }, frames, ground_truth, drivers: { [code]: DriverReveal } }.
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/reveal">) => {
  const code = normalizeCode((await ctx.params).code);
  const { meta } = await requireLobbyMember(req, code);
  if (!isRevealed(meta.phase)) throw new HttpError(409, "The answer opens at the reveal");

  const decision = await requireDecision(meta.decision_id);
  const [frames, ground_truth, answers, played] = await Promise.all([
    getFrames(decision.id),
    getGroundTruth(decision.id),
    getDriverAnswers(decision.id),
    getLobbyDriverCodes(code),
  ]);
  if (!frames || !ground_truth || !answers) throw new HttpError(404, `Data for ${decision.id} not found`);
  const drivers: Record<string, DriverReveal> = {};
  for (const d of answers) if (d.scorable && played.includes(d.code)) drivers[d.code] = d;
  const total_laps = frames[frames.length - 1]?.lap ?? decision.lap;
  return Response.json(
    { decision: { ...decision, total_laps, pit_loss: ground_truth.pit_loss ?? null }, frames, ground_truth, drivers },
    { headers: { "Cache-Control": "no-store" } },
  );
});
