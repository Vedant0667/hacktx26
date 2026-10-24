import type { NextRequest } from "next/server";
import { getLobbyDriverCodes, getRaceCalls } from "@/lib/db";
import { getRaceFrames, getRaceFreezes, type RaceFreeze } from "@/lib/data";
import { requireRaceMember } from "../../../../_lib/access";
import { handle, HttpError, normalizeCode } from "../../../../_lib/http";
import { clockOf, freezeReveal, measuredTo, presentCall, revealedLaps, type FreezePlanEntry, type FreezeRevealView } from "../../../../_lib/race";

function revealEntry(entry: FreezePlanEntry, cars: string[], freezes: RaceFreeze[], withDetail: boolean) {
  const drivers: Record<string, (FreezeRevealView & { detail?: Record<string, unknown> }) | null> = {};
  for (const car of cars) {
    const row = entry.drivers.includes(car) ? freezes.find((x) => x.lap === entry.lap && x.driver_code === car) : undefined;
    drivers[car] = row ? (withDetail ? { ...freezeReveal(row), detail: row.full.detail } : freezeReveal(row)) : null;
  }
  return drivers;
}

// Round 6, 6.10. ?lap=<freeze lap>: that freeze's answer for each car played in this lobby, once revealed
// (current freeze in reveal_freeze, or an earlier one); no frames or later laps. No lap: the whole race, at done only.
export const GET = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/race/reveal">) => {
  const code = normalizeCode((await ctx.params).code);
  const { meta } = await requireRaceMember(req, code);
  const clock = clockOf(meta);
  const plan = meta.freeze_plan ?? [];
  const revealed = revealedLaps(clock);
  const done = meta.phase === "done";
  const lapRaw = req.nextUrl.searchParams.get("lap");
  const [freezes, cars, calls] = await Promise.all([getRaceFreezes(meta.race_key!), getLobbyDriverCodes(code), getRaceCalls(code)]);
  const headers = { "Cache-Control": "no-store" };

  if (lapRaw !== null) {
    const lap = Number(lapRaw);
    const entry = plan.find((p) => p.lap === lap);
    if (!entry) throw new HttpError(404, "Not a freeze in this lobby");
    if (!revealed.includes(lap)) throw new HttpError(409, "That freeze is not revealed yet");
    // A swing measured past a later freeze in this lobby would describe laps the room hasn't called yet:
    // hold the number back until the race is done (the right call still shows).
    const drivers = revealEntry(entry, cars, freezes, false);
    for (const car of Object.keys(drivers)) {
      const view = drivers[car];
      const row = view ? freezes.find((x) => x.lap === lap && x.driver_code === car) : undefined;
      if (view && row && !done && plan.some((p) => p.lap > lap && p.lap <= measuredTo(row))) {
        drivers[car] = { ...view, swing_s: null as unknown as number, swing_deferred: true } as typeof view;
      }
    }
    return Response.json(
      {
        lap,
        drivers,
        calls: calls.filter((c) => c.kind === "freeze" && c.lap === lap).map((c) => presentCall(c, revealed, done)),
      },
      { headers },
    );
  }
  if (!done) throw new HttpError(409, "The full race opens when the race is done");
  const frames = await getRaceFrames(meta.race_key!);
  if (!frames) throw new HttpError(404, "Race data not found");
  return Response.json(
    {
      race_key: meta.race_key,
      frames,
      freezes: plan.map((entry) => ({ lap: entry.lap, drivers: revealEntry(entry, cars, freezes, true) })),
      calls,
    },
    { headers },
  );
});
