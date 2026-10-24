import { randomInt } from "node:crypto";
import { z } from "zod";
import { createLobby, getLobbyState, purgeExpired } from "@/lib/db";
import { getDefaultDriver } from "@/lib/data";
import { handle, hashToken, HttpError, newToken, readBody, requireDecision, requireDriver } from "../_lib/http";
import { guardLobbyCreate } from "../_lib/limits";

// No I, L or O: they read as 1 and 0 on a projector.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

const Body = z.object({
  decision_id: z.string().min(1).max(64),
  // Accepted for older clients; the host is not a player.
  host_name: z.string().trim().max(24).optional(),
  // Round 4: "same" (default) = everyone plays driver_code (default: the decision's original car);
  // "choose" = each player picks a car on join, driver_code is ignored.
  driver_mode: z.enum(["same", "choose"]).optional(),
  driver_code: z.string().trim().min(1).max(8).optional(),
});

function newCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

// Response 201: { ...LobbyStateResponse, host_token }. 400 for a driver_code that is not a scorable car. The host token is shown once; only its hash is stored,
// and POST /api/lobby/[code]/phase requires it in x-host-token.
export const POST = handle(async (req: Request) => {
  const { decision_id, driver_mode = "same", driver_code } = await readBody(req, Body);
  await requireDecision(decision_id);
  let lobbyDriver: string | null = null;
  if (driver_mode === "same") {
    const code = driver_code ?? (await getDefaultDriver(decision_id));
    if (!code) throw new HttpError(404, `No default driver for ${decision_id}`);
    lobbyDriver = (await requireDriver(decision_id, code)).code;
  }
  await guardLobbyCreate(req);
  // Retention: games older than 24 hours are deleted here (cascades to players, submissions, camps).
  await purgeExpired().catch((err) => console.error("lobby: purge failed", err));
  const host_token = newToken();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await createLobby(code, decision_id, hashToken(host_token), driver_mode, lobbyDriver)) {
      const state = await getLobbyState(code);
      return Response.json({ ...state, host_token }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
  }
  throw new HttpError(503, "Could not allocate a lobby code, try again");
});
