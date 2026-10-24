import type { NextRequest } from "next/server";
import { z } from "zod";
import { addPlayer, getLobbyMeta, getLobbyState, MAX_PLAYERS } from "@/lib/db";
import { driverFor, handle, hashToken, HttpError, newToken, normalizeCode, readBody, requireDriver, tokenMatches } from "../../../_lib/http";
import { guardLobbyRead } from "../../../_lib/limits";
import { redactForPhase } from "../../../_lib/redact";

// consent: the player ticked "show my nickname and spoken reasons"; stored as players.consent_at.
const Body = z.object({
  name: z.string().trim().min(1).max(24),
  consent: z.literal(true, { error: "consent must be true" }),
  // Round 4: required in a "choose" lobby (a scorable car of its decision); ignored in a "same" lobby.
  driver_code: z.string().trim().min(1).max(8).optional(),
});

// Joining is allowed in any phase so a late player can still watch the reveal.
// Response: { ...LobbyStateResponse, player_token, rejoined }. A new player gets a token (only its hash is
// stored); a taken name can be rejoined only by sending that name's token in x-player-token. A name or device
// token the host removed (POST .../kick) gets 403. In a "choose" lobby a new player must send a scorable
// driver_code (400 otherwise); a rejoin keeps the car stored at the first join.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/join">) => {
  const code = normalizeCode((await ctx.params).code);
  const { name, driver_code } = await readBody(req, Body);
  const { state: lobby } = await guardLobbyRead(req, code, true);
  if (!lobby) throw new HttpError(404, "Lobby not found");

  const token = newToken();
  const presented = req.headers.get("x-player-token");
  let driver: string;
  if (lobby.driver_mode === "choose") {
    if (driver_code) {
      driver = (await requireDriver(lobby.decision_id, driver_code)).code;
    } else {
      // Only a rejoin (this name, this device's token) may leave the car out.
      const meta = await getLobbyMeta(code, name);
      if (!meta?.is_player || !tokenMatches(presented, meta.player_token_hash)) throw new HttpError(400, "Pick a driver");
      driver = meta.player_driver_code ?? "";
    }
  } else {
    driver = (await driverFor(lobby.decision_id, lobby.driver_code)).code;
  }
  const added = await addPlayer(code, name, hashToken(token), presented ? hashToken(presented) : null, driver || null);
  if (added.result === "no_lobby") throw new HttpError(404, "Lobby not found");
  if (added.result === "kicked") throw new HttpError(403, "Removed from this lobby by the host");
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
