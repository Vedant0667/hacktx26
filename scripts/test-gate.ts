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
// R1 (re-audit): dot segments collapse to "//host" during parsing; every one of these must stay on the site.
const dotted = [
  "/.//evil.com", "/..//evil.com", "/a/..//evil.com", "/%2e//evil.com", "/%2e%2e//evil.com", "/%2E%2E//evil.com",
  "/./%2F/evil.com", "/.%2e//evil.com", "/a/b/../..//evil.com", "/././/evil.com", "/..\\/evil.com", "/.//\\evil.com",
  "/./\\/evil.com", "/.%5C/evil.com", "/%2e/%2e//evil.com",
];
for (const bad of dotted) {
  const out = safeNext(bad);
  assert.ok(!out.startsWith("//") && !out.startsWith("/\\"), `safeNext(${JSON.stringify(bad)}) = ${out}`);
  assert.equal(new URL(out, "https://x.test").origin, "https://x.test", `safeNext(${JSON.stringify(bad)}) = ${out} leaves the site`);
}
assert.equal(safeNext("/.//evil.com"), "/");
assert.equal(safeNext("/..//evil.com"), "/");
assert.equal(safeNext("/%2e%2e//evil.com"), "/");
assert.equal(safeNext("/./host/AB?x=1#y"), "/host/AB?x=1#y");

// R6: the purge cron path skips the gate only with the exact cron bearer.
process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";
const cron = (auth?: string) =>
  proxy(new NextRequest("https://x.test/api/cron/purge", auth ? { headers: { authorization: auth } } : undefined)) as Response;
assert.ok(passes(cron("Bearer cron-secret-for-tests-0123456789")), "cron bearer refused by the gate");
for (const bad of [undefined, "Bearer wrong", "Bearer cron-secret-for-tests-012345678", "cron-secret-for-tests-0123456789", "Basic x"]) {
  assert.equal(cron(bad).status, 401, `cron path open with ${bad}`);
}
assert.equal(
  (proxy(new NextRequest("https://x.test/api/cron/purge/x", { headers: { authorization: "Bearer cron-secret-for-tests-0123456789" } })) as Response).status,
  401,
  "the cron bearer opens other paths",
);
assert.equal(
  (proxy(new NextRequest("https://x.test/api/lobby/ABCD", { headers: { authorization: "Bearer cron-secret-for-tests-0123456789" } })) as Response).status,
  401,
  "the cron bearer opens other paths",
);
process.env.CRON_SECRET = "short";
assert.equal(cron("Bearer short").status, 401, "a short CRON_SECRET is accepted");
process.env.CRON_SECRET = "cron-secret-for-tests-0123456789";

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

// R1 + R3 + R7 against the real handlers (no DB: a correct password never touches it; a wrong one fails closed).
async function handlers() {
  delete process.env.DATABASE_URL;
  const { POST: unlock } = await import("../app/api/unlock/route");
  const { GET: purge } = await import("../app/api/cron/purge/route");
  const post = (password: string, next: string, url = "https://x.test/api/unlock") => {
    const body = new URLSearchParams({ password, next });
    return unlock(new Request(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));
  };
  process.env.SITE_PASSWORD = "test-password";
  for (const bad of ["/.//evil.com", "/..//evil.com", "/%2e%2e//evil.com", "/./%2F/evil.com", "//evil.com", "https://evil.com"]) {
    const res = await post("test-password", bad);
    assert.equal(res.status, 303);
    const loc = res.headers.get("location") ?? "";
    assert.ok(loc.startsWith("/") && !loc.startsWith("//"), `unlock next=${bad} -> Location ${loc}`);
    assert.equal(new URL(loc, "https://x.test/api/unlock").origin, "https://x.test", `unlock next=${bad} leaves the site`);
  }
  const ok = await post("test-password", "/host/ABCD");
  assert.equal(ok.headers.get("location"), "/host/ABCD");
  const setCookie = ok.headers.get("set-cookie") ?? "";
  assert.match(setCookie, /site_gate=\d+\./);
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i, "https unlock must set a Secure cookie");
  // Plain-http local dev (npm run dev): no Secure flag, or Safari drops the cookie on http://localhost.
  const local = await post("test-password", "/", "http://localhost:3000/api/unlock");
  assert.ok(!/Secure/i.test(local.headers.get("set-cookie") ?? ""), "http localhost cookie is Secure");
  // A wrong password with the rate-limit store down fails closed ("too many tries"), never unlocks.
  const quiet = console.error;
  console.error = () => {}; // the route logs the expected "DATABASE_URL is not set"
  const wrong = await post("nope", "/.//evil.com").finally(() => (console.error = quiet));
  assert.equal(wrong.status, 303);
  assert.equal(wrong.headers.get("location"), "/unlock?error=2&next=%2F");
  assert.equal(wrong.headers.get("set-cookie"), null);

  // The purge cron route itself refuses without the bearer (before any DB call).
  assert.equal((await purge(new Request("https://x.test/api/cron/purge"))).status, 401);
  assert.equal((await purge(new Request("https://x.test/api/cron/purge", { headers: { authorization: "Bearer wrong" } }))).status, 401);
  delete process.env.CRON_SECRET;
  assert.equal((await purge(new Request("https://x.test/api/cron/purge", { headers: { authorization: "Bearer " } }))).status, 401);
}

// Public launch: SITE_GATE=off opens every path (even on Vercel with no password); any other value keeps the gate.
{
  const saved = { gate: process.env.SITE_GATE, pw: process.env.SITE_PASSWORD, env: process.env.VERCEL_ENV };
  process.env.SITE_PASSWORD = "test-password";
  for (const typo of ["OFF", "of", "false", "0", " off"]) {
    process.env.SITE_GATE = typo;
    assert.equal(run("https://x.test/host/ABCD").status, 307, `SITE_GATE=${JSON.stringify(typo)} opened the gate`);
  }
  process.env.SITE_GATE = "off";
  assert.ok(passes(run("https://x.test/host/ABCD")), "SITE_GATE=off left the page gated");
  assert.ok(passes(run("https://x.test/api/lobby/ABCD")), "SITE_GATE=off left the API gated");
  delete process.env.SITE_PASSWORD;
  process.env.VERCEL_ENV = "production";
  assert.ok(passes(run("https://x.test/")), "SITE_GATE=off on Vercel without a password should be open, not misconfigured");
  delete process.env.SITE_GATE;
  assert.equal(run("https://x.test/").status, 503, "on Vercel without a password and without SITE_GATE=off the gate must refuse");
  for (const [k, v] of [["SITE_GATE", saved.gate], ["SITE_PASSWORD", saved.pw], ["VERCEL_ENV", saved.env]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

handlers().then(
  () => console.log("ok test_gate"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
