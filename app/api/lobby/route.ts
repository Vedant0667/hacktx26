import { randomInt } from "node:crypto";
import { z } from "zod";
import { createLobby, getLobbyState } from "@/lib/db";
import { handle, HttpError, readBody, requireDecision } from "../_lib/http";

// No I, L or O: they read as 1 and 0 on a projector.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";

const Body = z.object({
  decision_id: z.string().min(1).max(64),
  host_name: z.string().trim().min(1).max(24),
});

function newCode(): string {
  let code = "";
  for (let i = 0; i < 4; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export const POST = handle(async (req: Request) => {
  const { decision_id, host_name } = await readBody(req, Body);
  await requireDecision(decision_id);
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = newCode();
    if (await createLobby(code, decision_id, host_name)) {
      const state = await getLobbyState(code);
      return Response.json(state, { status: 201 });
    }
  }
  throw new HttpError(503, "Could not allocate a lobby code, try again");
});
