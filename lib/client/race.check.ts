// Quick unit check for the pit-loss and rival-delta helpers: `npx tsx lib/client/race.check.ts`.
import assert from "node:assert/strict";
import { TIGHT_S, isTight, pitLossUnder, undercutRivals } from "./race";

assert.equal(pitLossUnder(28.3, "SC"), 14.2);
assert.equal(pitLossUnder(28.3, "VSC"), 21.2);
assert.equal(pitLossUnder(28.3, "GREEN"), 28.3);
assert.equal(pitLossUnder(null, "SC"), null);

// Undercut clock: NOR stopped on lap 4 and is 2.0 s/lap faster since; you lead it by 15 s under green.
{
  const drv = (code: string, number: number, gap: number, t: number, pitted = false, compound = "MEDIUM", age = 5) => ({
    code, number, team: "", team_colour: null, position: 0, gap_to_leader_s: gap, compound, tyre_age: age, pitted_this_lap: pitted, lap_time_s: t,
  });
  const lap = (n: number, cars: ReturnType<typeof drv>[]) => ({ lap: n, track_status: "GREEN" as const, drivers: cars.map((c, i) => ({ ...c, position: i + 1 })) });
  const seen = [
    lap(3, [drv("PIA", 1, 0, 90), drv("NOR", 4, 18, 90)]),
    lap(4, [drv("PIA", 1, 0, 90), drv("NOR", 4, 40, 112, true, "HARD", 0)]),
    lap(5, [drv("PIA", 1, 0, 90), drv("NOR", 4, 19, 92, false, "HARD", 1)]),
    lap(6, [drv("PIA", 1, 0, 90), drv("NOR", 4, 17, 88, false, "HARD", 2)]),
    lap(7, [drv("PIA", 1, 0, 90), drv("NOR", 4, 15, 88, false, "HARD", 3)]),
    lap(8, [drv("PIA", 1, 0, 90), drv("NOR", 4, 15, 88, false, "HARD", 4)]),
  ];
  const d = { id: "t", race: "", lap: 8, trigger: "SC" as const, player_role: { team: "", driver: "", number: 1 }, options: ["BOX", "STAY"] as ("BOX" | "STAY")[],
    replay_from_lap: 1, factors: [], total_laps: 50, pit_loss: { normal_s: 20, n_stops: 1, from: "" } };
  const [u] = undercutRivals(seen as never, d as never);
  assert.equal(u.code, "NOR");
  assert.equal(u.pitted, true);
  assert.equal(u.lapsSinceStop, 4);
  assert.equal(u.gapNow, 15);
  assert.deepEqual(u.paceLaps, [6, 7]); // out-lap 5 excluded
  assert.equal(u.paceDelta, -2);
  assert.equal(u.boxNow, -5); // GREEN at the moment frame: full 20 s loss
  assert.equal(u.boxNextLap, -7);
  assert.equal(u.lapsUntilUndercut, 0);

  // Too early: the call comes on the lap after the rival's out-lap (stop lap 6, call lap 8): no pace sample.
  const early = seen.map((f) => ({
    ...f,
    drivers: f.drivers.map((x) => (x.code === "NOR" ? { ...x, pitted_this_lap: f.lap === 6, gap_to_leader_s: f.lap >= 6 ? 19.4 : 0.5 } : { ...x, pitted_this_lap: false })),
  }));
  const [e] = undercutRivals(early as never, d as never);
  assert.equal(e.tooEarly, true);
  assert.equal(e.paceDelta, null);
  assert.equal(e.boxNextLap, null);
  assert.equal(e.lapsUntilUndercut, null);
  // 19.4 s gap minus a 20 s loss: inside the tight band, shown as "about level".
  assert.equal(e.boxNow, -0.6);
  assert.equal(isTight(e.boxNow), true);
}
assert.equal(TIGHT_S, 1.0);
assert.equal(isTight(-0.99), true);
assert.equal(isTight(1.0), false);
assert.equal(isTight(null), false);
console.log("race.check: ok");
