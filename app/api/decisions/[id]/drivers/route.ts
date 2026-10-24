import type { NextRequest } from "next/server";
import { getBlindDrivers } from "@/lib/data";
import { handle, HttpError } from "../../../_lib/http";
import { BLIND_CACHE } from "../../cache";

// Scorable cars for the driver picker: { decision_id, default_driver, drivers: [{ code, number, name, team,
// team_colour, blind_title }] }. Identity only; each car's answer is in GET /api/lobby/[code]/reveal.
export const GET = handle(async (_req: NextRequest, ctx: RouteContext<"/api/decisions/[id]/drivers">) => {
  const { id } = await ctx.params;
  const drivers = await getBlindDrivers(id);
  if (!drivers) throw new HttpError(404, "Decision not found");
  return Response.json(drivers, { headers: { "Cache-Control": BLIND_CACHE } });
});
