import type { NextRequest } from "next/server";
import { getLobbyMeta } from "@/lib/db";
import { roleFor, tokenHeaders } from "../../_lib/access";
import { handle, hashToken, HttpError, normalizeCode } from "../../_lib/http";
import { guardLobbyRead } from "../../_lib/limits";
import { isRevealed, redactForPhase, redactSubmissions } from "../../_lib/redact";

// Polled every second by each client: one rate-limit transaction plus the state read.
// After the reveal, calls, reasons and scores are shown only to the host (x-host-token) or a player of this
// lobby (x-player-token); anyone else who knows the code keeps the pre-reveal view (who has called, no answer).
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]">) => {
  const code = normalizeCode((await ctx.params).code);
  const { state } = await guardLobbyRead(req, code, true);
  if (!state) throw new HttpError(404, "Lobby not found");
  if (isRevealed(state.phase)) {
    const t = tokenHeaders(req);
    const meta = t.host || t.player ? await getLobbyMeta(code, undefined, t.player ? hashToken(t.player) : null) : null;
    if (!meta || !roleFor(meta, req)) {
      return Response.json(redactSubmissions(state), { headers: { "Cache-Control": "no-store" } });
    }
  }
  return Response.json(redactForPhase(state), { headers: { "Cache-Control": "no-store" } });
});
