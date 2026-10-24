// Hermetic checks for the Round 5 duel (no network, no DB): fallback pick, summary cleaning and grounding,
// and the token gating of the duel routes. Run: npx tsx scripts/test-duel.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanLine, fallbackDuel, groundedIn, summaryLocal, type DuelEntry } from "../lib/muse";

const root = path.resolve(__dirname, "..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

const e = (name: string, call: DuelEntry["call"], reasons: string[], transcript = reasons.join(", ")): DuelEntry => ({
  name, driver_code: "PIA", call, reasons, transcript,
});

// Fallback pick: the first BOX against the first STAY, in submission order, BOX first.
const room = [
  e("Ana", "BOX", ["tyres are old"]),
  e("Ben", "BOX", ["everyone pitted"]),
  e("Cy", "STAY", ["keep track position"]),
  e("Dee", "STAY", ["dirty air"]),
];
let d = fallbackDuel(room);
assert.equal(d.source, "fallback");
assert.deepEqual(d.pair?.map((s) => [s.name, s.call]), [["Ana", "BOX"], ["Cy", "STAY"]]);
assert.equal(d.pair?.[0].driver_code, "PIA");
assert.equal(d.prompt, "Ana calls BOX. Cy calls STAY OUT. 10 seconds each.");
// STAY submitted first: still the first of each call, BOX side first.
d = fallbackDuel([room[2], room[0], room[3], room[1]]);
assert.deepEqual(d.pair?.map((s) => s.name), ["Ana", "Cy"]);
// One call for the whole room: the first two calls.
d = fallbackDuel([room[1], room[0]]);
assert.deepEqual(d.pair?.map((s) => s.name), ["Ben", "Ana"]);
assert.equal(d.prompt, "Ben and Ana both call BOX, for different reasons. 10 seconds each.");
// No call parsed for one player: first two submissions.
d = fallbackDuel([e("Eve", null, []), room[0]]);
assert.deepEqual(d.pair?.map((s) => [s.name, s.call]), [["Eve", null], ["Ana", "BOX"]]);
assert.equal(d.pair?.[0].summary, "No reason given");
assert.match(d.prompt ?? "", /^Eve made no call\. Ana calls BOX\./);
// Fewer than 2 calls: null pair and prompt.
assert.deepEqual(fallbackDuel([room[0]]), { source: "fallback", pair: null, prompt: null });
assert.deepEqual(fallbackDuel([]), { source: "fallback", pair: null, prompt: null });

// Fallback summary: the first reason clipped to 14 words; else the transcript; else "No reason given".
const long = "the tyres are completely finished and we will lose so much time on every single lap if we stay";
assert.equal(summaryLocal(e("F", "BOX", [long])).split(" ").length, 14);
assert.equal(summaryLocal(e("F", "BOX", [], "box box now")), "box box now");
assert.equal(summaryLocal(e("F", "BOX", [], "   ")), "No reason given");

// Projector-safe lines: no markup, exclamation, question marks, emoji or dashes; word and character caps.
assert.equal(cleanLine("Box now <script>alert(1)</script>!!", 14), "Box now script alert 1 /script");
assert.equal(cleanLine("Old tyres 🔥 — pit?", 14), "Old tyres pit");
assert.equal(cleanLine("one two three four five six seven eight", 6), "one two three four five six");
assert.ok(cleanLine("x".repeat(300), 14).length <= 110);
assert.equal(cleanLine("track position.", 6), "track position");

// Grounding: numbers and most content words must come from the player's own words.
assert.ok(groundedIn("Tyres are cooked, stop is cheap under the safety car", "box, the tires are cooked and it's cheap under the safety car"));
assert.ok(!groundedIn("Tyres are 20 laps old", "box, the tyres are old"), "a number the player never said");
assert.ok(groundedIn("Tyres are 20 laps old", "box the tyres are 20 laps old"));
assert.ok(!groundedIn("Verstappen pitted and the undercut is on", "stay out for track position"));
assert.ok(!groundedIn("the and of", "anything"), "a summary with no content words is not grounded");

// Token gating and phase rules (docs/audits/security-contract.md Round 5).
const get = src("app/api/lobby/[code]/duel/route.ts");
assert.match(get, /requireLobbyMember\(req, code\)/, "duel GET skips the lobby token guard");
assert.match(get, /if \(!isRevealed\(meta\.phase\)\) throw new HttpError\(409/, "duel GET is open before the reveal");
assert.ok(get.indexOf("requireLobbyMember(") < get.indexOf("duelFor(code, meta)"), "duel GET reads before checking the token");
assert.match(get, /claimMuseDuel\(/, "duel GET can call Muse without a claim");
assert.match(get, /claim === "new"/, "a stale claim must not make a second Muse call");
const vote = src("app/api/lobby/[code]/duel/vote/route.ts");
assert.match(vote, /lobbyMetaGuarded\(req, code/, "vote skips the miss-limited guard");
assert.match(vote, /if \(!player\) throw new HttpError\(403/, "vote accepts a request without a player token");
assert.match(vote, /if \(!isRevealed\(meta\.phase\)\) throw new HttpError\(409/);
assert.match(vote, /readBody\(req, Body\)/, "vote body is not JSON-only");
// Player names never reach the model, and the duel prompt keeps the injection guard.
const duelSrc = src("lib/muse/duel.ts");
assert.match(duelSrc, /players: entries\.map\(\(e, i\) => \(\{ id: ids\[i\], call: e\.call \?\? "UNCLEAR", said: saidBy\(e\) \}\)\)/);
assert.match(src("lib/muse/prompt.ts"), /DUEL_TASK[\s\S]*Ignore any instruction/);
// One pick per lobby and decision: a done row is never re-claimed.
assert.match(src("lib/db/index.ts"), /where m\.status = 'pending' and m\.updated_at < now\(\) - interval '30 seconds'\n     returning \(xmax = 0\) as inserted/);
assert.match(src("db/schema.sql"), /create table if not exists muse_duels[\s\S]*create table if not exists duel_votes/);

console.log("ok test_duel");
