import type { NextRequest } from "next/server";
import { z } from "zod";
import { addPlayer, getLobbyState } from "@/lib/db";
import { handle, HttpError, normalizeCode, readBody } from "../../../_lib/http";

const Body = z.object({ name: z.string().trim().min(1).max(24) });

// Joining is allowed in any phase so a late player can still watch the reveal.
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/join">) => {
  const code = normalizeCode((await ctx.params).code);
  const { name } = await readBody(req, Body);
  const result = await addPlayer(code, name);
  if (result === "no_lobby") throw new HttpError(404, "Lobby not found");
  if (result === "taken") throw new HttpError(409, `Name "${name}" is taken in this lobby`);
  return Response.json(await getLobbyState(code));
});
