// Hermetic checks for the shared-password gate (proxy.ts + lib/gate.ts). Run: npx tsx scripts/test-gate.ts
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";
import { gateToken, safeNext } from "../lib/gate";

const run = (url: string, cookie?: string) =>
  proxy(new NextRequest(url, cookie ? { headers: { cookie: `site_gate=${cookie}` } } : undefined)) as Response;

process.env.SITE_PASSWORD = "test-password";
const page = run("https://x.test/host/ABCD?a=1");
assert.equal(page.status, 307);
assert.equal(page.headers.get("location"), "https://x.test/unlock?next=%2Fhost%2FABCD%3Fa%3D1");
assert.equal(run("https://x.test/api/lobby/ABCD").status, 401);
assert.equal(run("https://x.test/data/qatar-2025-l7/decision.json").status, 307);
assert.equal(run("https://x.test/api/lobby/ABCD", gateToken("test-password")).headers.get("x-middleware-next"), "1");
assert.equal(run("https://x.test/", gateToken("wrong")).status, 307);
assert.deepEqual([safeNext("//evil.com"), safeNext("https://evil.com"), safeNext("/\\evil"), safeNext("/host/AB")], ["/", "/", "/", "/host/AB"]);
delete process.env.SITE_PASSWORD;
assert.equal(run("https://x.test/").headers.get("x-middleware-next"), "1");
console.log("ok test_gate");
