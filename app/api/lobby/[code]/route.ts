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
  // The role matters after the reveal (calls) and in a race lobby (the host sees segment_end_lap).
  const t = tokenHeaders(req);
  const meta = (isRevealed(state.phase) || state.mode === "race") && (t.host || t.player)
    ? await getLobbyMeta(code, undefined, t.player ? hashToken(t.player) : null)
    : null;
  const role = meta ? roleFor(meta, req) : null;
  if (isRevealed(state.phase) && !role) {
    return Response.json(redactSubmissions(state), { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json(redactForPhase(state, role === "host"), { headers: { "Cache-Control": "no-store" } });
});
