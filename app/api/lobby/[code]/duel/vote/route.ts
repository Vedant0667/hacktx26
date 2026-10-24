import type { NextRequest } from "next/server";
import { z } from "zod";
import { castDuelVote } from "@/lib/db";
import { lobbyMetaGuarded } from "../../../../_lib/access";
import { handle, HttpError, normalizeCode, readBody } from "../../../../_lib/http";
import { isRevealed } from "../../../../_lib/redact";

const Body = z.object({ choice: z.union([z.literal(0), z.literal(1)]) });

// A player's vote on who defended their call better: choice is the index into the duel's pair.
// Player only (x-player-token): 403 without a valid player token (a host token alone does not vote), also for an
// unknown code (miss-limited). 409 before the reveal, or when the duel has no pair yet.
// One vote per player; a second vote changes nothing and returns duplicate: true with the stored choice.
// Response: { votes: [number, number], my_vote: 0 | 1, duplicate: boolean }
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/duel/vote">) => {
  const code = normalizeCode((await ctx.params).code);
  const { choice } = await readBody(req, Body);
  const denied = "Only players in this lobby can vote";
  const { meta, player } = await lobbyMetaGuarded(req, code, undefined, denied);
  if (!player) throw new HttpError(403, denied);
  if (!isRevealed(meta.phase)) throw new HttpError(409, "The duel opens at the reveal");
  const tally = await castDuelVote(code, meta.decision_id, player, choice as 0 | 1);
  if (!tally) throw new HttpError(409, "No duel to vote on yet");
  return Response.json(tally, { headers: { "Cache-Control": "no-store" } });
});
