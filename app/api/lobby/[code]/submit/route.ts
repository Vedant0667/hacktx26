import type { NextRequest } from "next/server";
import { z } from "zod";
import { getSubmission, getTotals, insertSubmission, claimSubmission, type DriverSubmission } from "@/lib/db";
import { decisionForDriver } from "@/lib/data";
import { parseCall } from "@/lib/muse";
import { CALL_WINDOW_S, percentile, scoreCall } from "@/lib/scoring";
import { lobbyMetaGuarded } from "../../../_lib/access";
import { driverFor, handle, HttpError, normalizeCode, readBody, requireDecision, tokenMatches } from "../../../_lib/http";

const REVEAL_GRACE_S = 2;

const Body = z.object({
  player_name: z.string().trim().min(1).max(24),
  transcript: z.string().max(4000),
  // Ignored: the server times the call from the start of the decision phase.
  seconds_to_call: z.number().min(0).max(3600).optional(),
  // The BOX / STAY OUT button on the phone, when pressed, wins over the parsed transcript.
  call: z.enum(["BOX", "STAY"]).nullable().optional(),
});

// Requires x-player-token (from join) for player_name. Scored against the player's own car (Round 4).
// Response: { submission, percentile, lobby_rank, lobby_players_submitted, duplicate }.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/submit">) => {
  const code = normalizeCode((await ctx.params).code);
  const { player_name, transcript, call } = await readBody(req, Body);

  // Miss-limited lookup; an unknown code answers 403 like a wrong token, so it does not reveal which codes exist.
  const denied = `This device is not signed in as ${player_name} in this lobby`;
  const { meta } = await lobbyMetaGuarded(req, code, player_name, denied);
  if (!meta.is_player || !tokenMatches(req.headers.get("x-player-token"), meta.player_token_hash)) {
    throw new HttpError(403, denied);
  }
  // Calls count during the decision, plus a short grace for auto-sends in flight when the host reveals.
  const late = meta.phase === "reveal" && meta.phase_elapsed_s < REVEAL_GRACE_S;
  if (meta.phase !== "decision" && !late) throw new HttpError(409, "Calls are closed for this moment");
  const seconds_to_call = meta.phase === "decision" ? Math.min(CALL_WINDOW_S, Math.round(meta.phase_elapsed_s * 10) / 10) : CALL_WINDOW_S;
  const base = await requireDecision(meta.decision_id);
  const driver = await driverFor(base.id, meta.player_driver_code, meta.driver_code);
  const decision = decisionForDriver(base, driver);

  // First submission wins. A re-submit returns the stored row before any Muse call is made.
  const existing = meta.has_submitted ? await getSubmission(code, player_name, decision.id) : null;
  let submission: DriverSubmission;
  let duplicate: boolean;
  if (existing) {
    submission = existing;
    duplicate = true;
  } else {
    if (!(await claimSubmission(code, player_name, decision.id))) {
      // Another request for this player is already grading; that one returns the result.
      const stored = await getSubmission(code, player_name, decision.id);
      if (!stored) throw new HttpError(409, "Your call is already in and being graded");
      return Response.json({ submission: { ...stored, score_call: 0, score_reasoning: 0, total: 0 }, percentile: null, lobby_rank: null, lobby_players_submitted: null, duplicate: true });
    }
    // Muse grades which factors were named; the phone's BOX / STAY button still wins for the call.
    const parsed = await parseCall(transcript, decision, { lobbyCode: code });
    const finalCall = call ?? parsed.call;
    const score = scoreCall(decision, finalCall, parsed.factors_named);
    ({ submission, duplicate } = await insertSubmission({
      lobby_code: code,
      player_name,
      decision_id: decision.id,
      call: finalCall,
      reasons: parsed.reasons,
      factors_named: parsed.factors_named,
      transcript: parsed.transcript,
      seconds_to_call, // display and tie-break only; it does not affect the score
      ...score,
      driver_code: driver.code,
    } satisfies DriverSubmission));
  }

  // The score gives away the answer, so it stays hidden until the reveal; the phone reads it from the leaderboard then.
  if (meta.phase === "decision") {
    return Response.json(
      {
        submission: { ...submission, score_call: 0, score_reasoning: 0, total: 0 },
        percentile: null,
        lobby_rank: null,
        lobby_players_submitted: null,
        duplicate,
      },
      { status: duplicate ? 200 : 201 },
    );
  }
  const totals = await getTotals(decision.id, code);
  return Response.json(
    {
      submission,
      percentile: percentile(submission.total, totals.global),
      lobby_rank: 1 + totals.lobby.filter((t) => t > submission.total).length,
      lobby_players_submitted: totals.lobby.length,
      duplicate,
    },
    { status: duplicate ? 200 : 201 },
  );
});
