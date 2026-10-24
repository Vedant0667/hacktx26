import { randomInt } from "node:crypto";
import { z } from "zod";
import { createLobby, getLobbyState, purgeExpired } from "@/lib/db";
import { handle, hashToken, HttpError, newToken, readBody, requireDecision } from "../_lib/http";
import { guardLobbyCreate } from "../_lib/limits";

// No I, L or O: they read as 1 and 0 on a projector.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

const Body = z.object({
  decision_id: z.string().min(1).max(64),
  // Accepted for older clients; the host is not a player.
  host_name: z.string().trim().max(24).optional(),
});

function newCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

// Response 201: { ...LobbyStateResponse, host_token }. The host token is shown once; only its hash is stored,
// and POST /api/lobby/[code]/phase requires it in x-host-token.
export const POST = handle(async (req: Request) => {
  const { decision_id } = await readBody(req, Body);
  await requireDecision(decision_id);
  await guardLobbyCreate(req);
  // Retention: games older than 24 hours are deleted here (cascades to players, submissions, camps).
  await purgeExpired().catch((err) => console.error("lobby: purge failed", err));
  const host_token = newToken();
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await createLobby(code, decision_id, hashToken(host_token))) {
      const state = await getLobbyState(code);
      return Response.json({ ...state, host_token }, { status: 201, headers: { "Cache-Control": "no-store" } });
    }
  }
  throw new HttpError(503, "Could not allocate a lobby code, try again");
});
