import type { NextRequest } from "next/server";
import { z } from "zod";
import { addPlayer, getLobbyMeta, hitRateLimit, getLobbyState, MAX_PLAYERS, type LobbyStateResponse } from "@/lib/db";
import { getRaceEntry, getRaceList } from "@/lib/data";
import { COPY } from "@/lib/copy";
import { checkName } from "@/lib/names";
import { clientIp, driverFor, handle, hashToken, HttpError, newToken, normalizeCode, readBody, requireDriver, tokenMatches } from "../../../_lib/http";
import { guardLobbyRead } from "../../../_lib/limits";
import { redactForPhase } from "../../../_lib/redact";

// consent: the player ticked "show my nickname and spoken reasons"; stored as players.consent_at.
const Body = z.object({
  // Trimmed, normalised and length-checked (24 characters) by checkName in the handler.
  name: z.string().min(1).max(100),
  consent: z.literal(true, { error: "consent must be true" }),
  // Round 4: required in a "choose" lobby (a scorable car of its decision); ignored in a "same" lobby.
  driver_code: z.string().trim().min(1).max(8).optional(),
});

// Joining is allowed in any phase so a late player can still watch the reveal.
// Response: { ...LobbyStateResponse, player_token, rejoined }. A new player gets a token (only its hash is
// stored); a taken name can be rejoined only by sending that name's token in x-player-token. A name or device
// token the host removed (POST .../kick) gets 403. In a "choose" lobby a new player must send a scorable
// driver_code (400 otherwise); a rejoin keeps the car stored at the first join.
// Round 6: the car for a race lobby. "same": the lobby's car. "choose": a car from the race's picker list
// before the start; after the start a new player watches without a car (the freeze plan is fixed), and a
// rejoin keeps the stored car.
async function raceDriver(code: string, name: string, lobby: LobbyStateResponse, driverCode: string | undefined, presented: string | null): Promise<string> {
  if (lobby.driver_mode === "same") return lobby.driver_code ?? "";
  const meta = await getLobbyMeta(code, name);
  if (meta?.is_player && tokenMatches(presented, meta.player_token_hash)) return meta.player_driver_code ?? "";
  if (lobby.phase !== "waiting") return "";
  if (!driverCode) throw new HttpError(400, "Pick a driver");
  const race = await getRaceEntry(lobby.decision_id.replace(/^race:/, ""));
  const want = driverCode.trim().toUpperCase();
  const car = race?.drivers.find((d) => d.code === want);
  if (!car) throw new HttpError(400, `Unknown driver "${want.slice(0, 8)}" for this race`);
  return car.code;
}

export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/join">) => {
  const code = normalizeCode((await ctx.params).code);
  const body = await readBody(req, Body);
  const { driver_code } = body;
  const { state: lobby } = await guardLobbyRead(req, code, true);
  if (!lobby) throw new HttpError(404, "Lobby not found");
  // The stored name is the normalised one. Team names are the bare names of the benchmark rows.
  const teams = (await getRaceList()).flatMap((r) => r.drivers.map((d) => d.team));
  const checked = checkName(body.name, teams);
  if (!checked.ok) throw new HttpError(400, COPY.error.nameRejected);
  const name = checked.name;

  const token = newToken();
  const presented = req.headers.get("x-player-token");
  let driver: string;
  const revealed = lobby.phase === "reveal" || lobby.phase === "done";
  if (lobby.mode === "race") {
    driver = await raceDriver(code, name, lobby, driver_code, presented);
  } else if (lobby.driver_mode === "choose" && revealed && driver_code) {
    // After the reveal a new joiner watches without a car, so joining late can't add another car's answer
    // to this lobby's reveal or leaderboard rows.
    driver = "";
  } else if (lobby.driver_mode === "choose") {
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
  // Join flooding: a troll rejoins under new names without a token. Count only joins that are not a rejoin by
  // this name's own token; latecomers still join mid-race, up to 30 new names per IP per lobby per 10 minutes.
  const own = presented ? await getLobbyMeta(code, name) : null;
  if (!(own?.is_player && tokenMatches(presented, own.player_token_hash))) {
    const hit = await hitRateLimit("join_new", `${clientIp(req)}:${code}`, 600);
    if (hit.count > 30) throw new HttpError(429, "Too many requests. Wait a moment and try again.", hit.retry_after_s, "join_new");
  }
  const added = await addPlayer(code, name, hashToken(token), presented ? hashToken(presented) : null, driver || null);
  if (added.result === "no_lobby") throw new HttpError(404, "Lobby not found");
  if (added.result === "kicked") throw new HttpError(403, "Removed from this lobby by the host");
  if (added.result === "full") throw new HttpError(409, `Lobby is full (${MAX_PLAYERS} players)`);
  let player_token: string | null = token;
  let rejoined = false;
  if (added.result === "taken") {
    // A rejoin must match the stored spelling too: "alice" cannot take over "Alice" with Alice's token.
    if (added.name !== name || !tokenMatches(req.headers.get("x-player-token"), added.token_hash)) {
      throw new HttpError(409, `Name "${name}" is taken in this lobby`);
    }
    player_token = null; // the device already holds it
    rejoined = true;
  }
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");
  return Response.json({ ...redactForPhase(state), player_token, rejoined }, { headers: { "Cache-Control": "no-store" } });
});
