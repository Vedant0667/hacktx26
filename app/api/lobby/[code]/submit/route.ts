import type { NextRequest } from "next/server";
import { z } from "zod";
import { getLobbyMeta, getTotals, insertSubmission } from "@/lib/db";
import { parseCall } from "@/lib/muse";
import { CALL_WINDOW_S, percentile, scoreCall } from "@/lib/scoring";
import type { Submission } from "@/lib/types";
import { handle, HttpError, normalizeCode, readBody, requireDecision } from "../../../_lib/http";

const REVEAL_GRACE_S = 2;

const Body = z.object({
  player_name: z.string().trim().min(1).max(24),
  transcript: z.string().max(4000),
  // Ignored: the server times the call from the start of the decision phase.
  seconds_to_call: z.number().min(0).max(3600).optional(),
  // The BOX / STAY OUT button on the phone, when pressed, wins over the parsed transcript.
  call: z.enum(["BOX", "STAY"]).nullable().optional(),
});

// Response: { submission, percentile, lobby_rank, lobby_players_submitted, duplicate }.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/submit">) => {
  const code = normalizeCode((await ctx.params).code);
  const { player_name, transcript, call } = await readBody(req, Body);

  const meta = await getLobbyMeta(code, player_name);
  if (!meta) throw new HttpError(404, "Lobby not found");
  if (!meta.is_player) throw new HttpError(403, `${player_name} has not joined lobby ${code}`);
  // Calls count during the decision, plus a short grace for auto-sends in flight when the host reveals.
  const late = meta.phase === "reveal" && meta.phase_elapsed_s < REVEAL_GRACE_S;
  if (meta.phase !== "decision" && !late) throw new HttpError(409, "Calls are closed for this moment");
  const seconds_to_call = meta.phase === "decision" ? Math.min(CALL_WINDOW_S, Math.round(meta.phase_elapsed_s * 10) / 10) : CALL_WINDOW_S;
  const decision = await requireDecision(meta.decision_id);

  // Muse grades which factors were named; the phone's BOX / STAY button still wins for the call.
  const parsed = await parseCall(transcript, decision, { lobbyCode: code });
  const finalCall = call ?? parsed.call;
  const score = scoreCall(decision, finalCall, parsed.factors_named);
  const { submission, duplicate } = await insertSubmission({
    lobby_code: code,
    player_name,
    decision_id: decision.id,
    call: finalCall,
    reasons: parsed.reasons,
    factors_named: parsed.factors_named,
    transcript: parsed.transcript,
    seconds_to_call, // display and tie-break only; it does not affect the score
    ...score,
  } satisfies Submission);

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
