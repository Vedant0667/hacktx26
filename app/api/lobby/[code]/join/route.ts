import type { NextRequest } from "next/server";
import { z } from "zod";
import { addPlayer, getLobbyState, MAX_PLAYERS } from "@/lib/db";
import { handle, hashToken, HttpError, newToken, normalizeCode, readBody, tokenMatches } from "../../../_lib/http";
import { guardLobbyRead } from "../../../_lib/limits";
import { redactForPhase } from "../../../_lib/redact";

// consent: the player ticked "show my nickname and spoken reasons"; stored as players.consent_at.
const Body = z.object({
  name: z.string().trim().min(1).max(24),
  consent: z.literal(true, { error: "consent must be true" }),
});

// Joining is allowed in any phase so a late player can still watch the reveal.
// Response: { ...LobbyStateResponse, player_token, rejoined }. A new player gets a token (only its hash is
// stored); a taken name can be rejoined only by sending that name's token in x-player-token.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/join">) => {
  const code = normalizeCode((await ctx.params).code);
  const { name } = await readBody(req, Body);
  if (!(await guardLobbyRead(req, code, false)).found) throw new HttpError(404, "Lobby not found");

  const token = newToken();
  const added = await addPlayer(code, name, hashToken(token));
  if (added.result === "no_lobby") throw new HttpError(404, "Lobby not found");
  if (added.result === "full") throw new HttpError(409, `Lobby is full (${MAX_PLAYERS} players)`);
  let player_token: string | null = token;
  let rejoined = false;
  if (added.result === "taken") {
    if (!tokenMatches(req.headers.get("x-player-token"), added.token_hash)) {
      throw new HttpError(409, `Name "${name}" is taken in this lobby`);
    }
    player_token = null; // the device already holds it
    rejoined = true;
  }
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");
  return Response.json({ ...redactForPhase(state), player_token, rejoined }, { headers: { "Cache-Control": "no-store" } });
});
