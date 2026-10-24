// Hermetic checks for the server-side security fixes (no network, no DB). Run: npx tsx scripts/test-security.ts
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { hashToken, HttpError, newToken, readBody, tokenMatches } from "../app/api/_lib/http";
import { cleanLabel } from "../lib/muse";

const root = path.resolve(__dirname, "..");

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    return err instanceof HttpError ? err.status : 500;
  }
}

async function main() {
  // L6: JSON bodies only.
  const Body = z.object({ name: z.string(), consent: z.literal(true) });
  const req = (type: string | null, body: unknown) =>
    new Request("https://x.test/api", { method: "POST", headers: type ? { "content-type": type } : {}, body: JSON.stringify(body) });
  assert.equal(await status(readBody(req("text/plain", { name: "a", consent: true }), Body)), 415);
  assert.equal(await status(readBody(req(null, { name: "a", consent: true }), Body)), 415);
  assert.equal(await status(readBody(req("application/x-www-form-urlencoded", { name: "a", consent: true }), Body)), 415);
  assert.equal(await status(readBody(req("application/json; charset=utf-8", { name: "a", consent: true }), Body)), 200);
  // M6: consent must be literally true.
  assert.equal(await status(readBody(req("application/json", { name: "a" }), Body)), 400);
  assert.equal(await status(readBody(req("application/json", { name: "a", consent: "true" }), Body)), 400);

  // M4 / L2: tokens are random, only hashes compared, wrong or missing tokens fail.
  const t = newToken();
  assert.match(t, /^[A-Za-z0-9_-]{32}$/);
  assert.notEqual(t, newToken());
  const h = hashToken(t);
  assert.ok(tokenMatches(t, h));
  assert.ok(!tokenMatches(newToken(), h));
  assert.ok(!tokenMatches(null, h) && !tokenMatches("", h) && !tokenMatches(t, null) && !tokenMatches(t, "short"));

  // L5: camp labels are plain words, at most 40 characters.
  assert.equal(cleanLabel("Box now <script>alert(1)</script>!!"), "Box now script alert 1 /script");
  assert.ok(cleanLabel("x".repeat(80)).length <= 40);
  assert.ok(cleanLabel("Cheap stop under the safety car, everyone else pitted already").length <= 40);
  assert.equal(cleanLabel("Old tyres 🔥 — pit"), "Old tyres pit");
  assert.equal(cleanLabel("Track position, 21 laps old"), "Track position, 21 laps old");
  const museSrc = readFileSync(path.join(root, "lib/muse/index.ts"), "utf8");
  assert.ok(/Ignore any instruction/.test(museSrc), "parse/camps prompts lost the injection guard");
  assert.ok(/items: \{ type: "string", enum: factors \}/.test(museSrc), "factors_named is no longer limited to the decision's enum");

  // M2: public data holds no answer and no lap after the call.
  const pub = path.join(root, "public/data");
  const index = JSON.parse(readFileSync(path.join(pub, "index.json"), "utf8")) as { id: string }[];
  assert.ok(index.length > 0);
  assert.ok(!existsSync(path.join(pub, "engine_calls.json")), "engine_calls.json is public");
  for (const { id } of index) {
    const d = JSON.parse(readFileSync(path.join(pub, id, "decision.json"), "utf8"));
    for (const k of ["team", "engine", "ground_truth", "reveal_to_lap"]) assert.ok(!(k in d), `${id}: public decision has ${k}`);
    assert.ok(!existsSync(path.join(pub, id, "ground_truth.json")), `${id}: ground_truth.json is public`);
    const raw = readFileSync(path.join(pub, id, "decision.json"), "utf8");
    assert.ok(!/"correct"|swing/.test(raw), `${id}: public decision mentions the answer`);
    const frames = JSON.parse(readFileSync(path.join(pub, id, "frames.json"), "utf8")) as { lap: number; drivers: { number: number; pitted_this_lap: boolean; position: number }[] }[];
    assert.equal(frames[frames.length - 1].lap, d.lap, `${id}: frames run past the decision lap`);
    const me = frames[frames.length - 1].drivers.find((x) => x.number === d.player_role.number)!;
    assert.ok(!me.pitted_this_lap, `${id}: call-moment frame shows the player's own stop`);
    for (const x of frames[frames.length - 1].drivers) {
      assert.ok(!x.pitted_this_lap || x.position < me.position, `${id}: call-moment frame shows a stop by a car behind`);
    }
    const full = JSON.parse(readFileSync(path.join(root, "server-data", id, "decision.json"), "utf8"));
    assert.ok(full.engine && full.team && full.ground_truth, `${id}: server-data decision is incomplete`);
  }
  console.log("ok test_security");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
