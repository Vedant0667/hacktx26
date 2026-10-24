import type { NextRequest } from "next/server";
import { z } from "zod";
import { getLobbyMeta, getTotals, insertSubmission } from "@/lib/db";
import { parseCall } from "@/lib/muse";
import { percentile, scoreCall } from "@/lib/scoring";
import type { Submission } from "@/lib/types";
import { handle, HttpError, normalizeCode, readBody, requireDecision } from "../../../_lib/http";

const Body = z.object({
  player_name: z.string().trim().min(1).max(24),
  transcript: z.string().max(4000),
  seconds_to_call: z.number().min(0).max(3600),
  // The BOX / STAY OUT button on the phone, when pressed, wins over the parsed transcript.
  call: z.enum(["BOX", "STAY"]).nullable().optional(),
});

// Response: { submission, percentile, lobby_rank, lobby_players_submitted, duplicate }.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/submit">) => {
  const code = normalizeCode((await ctx.params).code);
  const { player_name, transcript, seconds_to_call, call } = await readBody(req, Body);

  const meta = await getLobbyMeta(code, player_name);
  if (!meta) throw new HttpError(404, "Lobby not found");
  if (!meta.is_player) throw new HttpError(403, `${player_name} has not joined lobby ${code}`);
  const decision = await requireDecision(meta.decision_id);

  const parsed = await parseCall(transcript);
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
    seconds_to_call, // stored for display only; it does not affect the score
    ...score,
  } satisfies Submission);

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
