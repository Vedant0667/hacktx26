import type { NextRequest } from "next/server";
import { handle, HttpError, normalizeCode } from "../../_lib/http";
import { guardLobbyRead } from "../../_lib/limits";
import { redactForPhase } from "../../_lib/redact";

// Polled every second by each client: one rate-limit transaction plus the state read.
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]">) => {
  const code = normalizeCode((await ctx.params).code);
  const { state } = await guardLobbyRead(req, code, true);
  if (!state) throw new HttpError(404, "Lobby not found");
  return Response.json(redactForPhase(state), { headers: { "Cache-Control": "no-store" } });
});
