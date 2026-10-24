import type { NextRequest } from "next/server";
import { z } from "zod";
import { getLobbyState, kickPlayer } from "@/lib/db";
import { requireHost } from "../../../_lib/access";
import { handle, HttpError, normalizeCode, readBody } from "../../../_lib/http";
import { redactForPhase } from "../../../_lib/redact";

const Body = z.object({ name: z.string().trim().min(1).max(24) });

// Host only (x-host-token): removes a player so a room cannot be filled with made-up names (re-audit R5).
// Before the reveal their call and grading claim go too. The name and that device's token cannot rejoin.
// Response: the redacted lobby state. 404 when no player has that name; 403 for a wrong token or unknown code.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/kick">) => {
  const code = normalizeCode((await ctx.params).code);
  const { name } = await readBody(req, Body);
  await requireHost(req, code, "Only the host screen can remove players");
  if (!(await kickPlayer(code, name))) throw new HttpError(404, `No player named "${name}" in this lobby`);
  const state = await getLobbyState(code);
  if (!state) throw new HttpError(404, "Lobby not found");
  return Response.json(redactForPhase(state), { headers: { "Cache-Control": "no-store" } });
});
