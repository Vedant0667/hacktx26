// Hermetic checks for the shared-password gate (proxy.ts + lib/gate.ts). Run: npx tsx scripts/test-gate.ts
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { config, proxy } from "../proxy";
import { GATE_MAX_AGE_S, gateToken, safeEqual, safeNext, verifyGateToken } from "../lib/gate";

const run = (url: string, cookie?: string) =>
  proxy(new NextRequest(url, cookie ? { headers: { cookie: `site_gate=${cookie}` } } : undefined)) as Response;
const passes = (r: Response) => r.headers.get("x-middleware-next") === "1";

delete process.env.VERCEL_ENV;
process.env.SITE_PASSWORD = "test-password";
const page = run("https://x.test/host/ABCD?a=1");
assert.equal(page.status, 307);
assert.equal(page.headers.get("location"), "https://x.test/unlock?next=%2Fhost%2FABCD%3Fa%3D1");
assert.equal(run("https://x.test/api/lobby/ABCD").status, 401);
assert.equal(run("https://x.test/data/qatar-2025-l7/decision.json").status, 307);
assert.ok(passes(run("https://x.test/api/lobby/ABCD", gateToken("test-password"))));
assert.equal(run("https://x.test/", gateToken("wrong")).status, 307);

// L4: cookie is `${exp}.${hmac}`, expiry enforced server-side, v1 cookies and tampering rejected.
const now = Math.floor(Date.now() / 1000);
const tok = gateToken("test-password", now);
assert.match(tok, /^\d+\.[A-Za-z0-9_-]{43}$/);
assert.equal(Number(tok.split(".")[0]), now + GATE_MAX_AGE_S);
assert.ok(verifyGateToken(tok, "test-password", now));
assert.ok(!verifyGateToken(tok, "test-password", now + GATE_MAX_AGE_S + 1), "expired cookie accepted");
assert.ok(!verifyGateToken(gateToken("test-password", now + 10 * GATE_MAX_AGE_S), "test-password", now), "far-future exp accepted");
assert.ok(!verifyGateToken(`${now + 999999}.${tok.split(".")[1]}`, "test-password", now), "exp not covered by the signature");
assert.ok(!verifyGateToken("a".repeat(64), "test-password", now), "v1-style cookie accepted");
assert.equal(run("https://x.test/", gateToken("test-password", now - GATE_MAX_AGE_S - 5)).status, 307);
assert.ok(safeEqual("abc", "abc") && !safeEqual("abc", "abcd") && !safeEqual("", "x"));

// M1: only same-origin paths survive.
for (const bad of ["/%09/evil.com", "/\t/evil.com", "/\n/evil.com", "/\\evil", "//evil", "//evil.com", "https://evil", "https://evil.com", "javascript:alert(1)", ""]) {
  const out = safeNext(bad);
  assert.ok(out === "/" || (out.startsWith("/") && !out.startsWith("//")), `safeNext(${JSON.stringify(bad)}) = ${out}`);
  assert.equal(new URL(out, "https://x.test").origin, "https://x.test", `safeNext(${JSON.stringify(bad)}) leaves the site`);
}
assert.deepEqual(
  [safeNext("//evil.com"), safeNext("https://evil.com"), safeNext("/\\evil"), safeNext("/\t/evil.com"), safeNext("/host/AB")],
  ["/", "/", "/", "/", "/host/AB"],
);

// L7: exact open paths; anything that only starts with them stays gated.
for (const open of ["/unlock", "/api/unlock", "/favicon.ico"]) assert.ok(passes(run(`https://x.test${open}`)), open);
assert.ok(passes(run("https://x.test/unlock?next=%2F&error=1")));
for (const gated of ["/unlock-foo", "/unlock/x", "/unlockx.json", "/api/unlockx", "/api/unlock/x", "/icon", "/apple-icon", "/robots.txt", "/favicon.ico.json"]) {
  assert.ok([307, 401].includes(run(`https://x.test${gated}`).status), `${gated} skipped the gate`);
}
// The matcher, compiled the way path-to-regexp treats a lone custom group (anchored at both ends).
// next/experimental/testing/server's matcher helper needs the Next server runtime, so it is not used here.
assert.deepEqual(config.matcher, ["/((?!_next/static/|_next/image$).*)"]);
const matcherRe = new RegExp(`^${config.matcher[0]}$`);
const matches = (url: string) => matcherRe.test(url);
assert.ok(!matches("/_next/static/chunks/app.js"));
assert.ok(!matches("/_next/image"));
for (const url of ["/", "/unlock", "/_next/imagefoo", "/_next/data/x.json", "/data/qatar-2025-l7/decision.json", "/api/lobby", "/icon"]) {
  assert.ok(matches(url), `proxy does not run on ${url}`);
}

// H1: on Vercel without a password, refuse instead of opening up.
delete process.env.SITE_PASSWORD;
process.env.VERCEL_ENV = "preview";
const api = run("https://x.test/api/lobby/ABCD");
assert.equal(api.status, 503);
assert.match(api.headers.get("content-type") ?? "", /json/);
assert.equal(run("https://x.test/").status, 503);
assert.equal(run("https://x.test/unlock").status, 503);
assert.equal(run("https://x.test/data/qatar-2025-l7/frames.json").status, 503);

// Local dev (no VERCEL_ENV, no password): open.
delete process.env.VERCEL_ENV;
assert.ok(passes(run("https://x.test/")));
console.log("ok test_gate");
