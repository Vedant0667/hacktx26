import type { NextRequest } from "next/server";
import { getLobbyDriverCodes } from "@/lib/db";
import { getRaceFreezes, type BlindFreeze } from "@/lib/data";
import { requireRaceMember } from "../../../../_lib/access";
import { handle, HttpError, normalizeCode } from "../../../../_lib/http";
import { clockOf, currentFreeze } from "../../../../_lib/race";

// Round 6, 6.6: the current freeze, blind (pre-call numbers only), for every car played in this lobby.
// null for a car with no call at this lap ("no call needed"). 409 outside freeze and reveal_freeze.
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/race/freeze">) => {
  const code = normalizeCode((await ctx.params).code);
  const { meta } = await requireRaceMember(req, code);
  const f = currentFreeze(clockOf(meta));
  if (!f) throw new HttpError(409, "No freeze right now");
  const [freezes, cars] = await Promise.all([getRaceFreezes(meta.race_key!), getLobbyDriverCodes(code)]);
  const drivers: Record<string, BlindFreeze | null> = {};
  for (const car of cars) {
    const row = f.drivers.includes(car) ? freezes.find((x) => x.lap === f.lap && x.driver_code === car) : undefined;
    drivers[car] = row ? row.blind : null;
  }
  return Response.json({ lap: f.lap, freeze_index: meta.freeze_index, drivers }, { headers: { "Cache-Control": "no-store" } });
});
