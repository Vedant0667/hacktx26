// Shared-password gate for test deployments. Off when SITE_PASSWORD is unset, but only off Vercel:
// on Vercel (VERCEL_ENV set) a missing password means a misconfigured deployment, and the gate refuses.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const GATE_COOKIE = "site_gate";
export const GATE_MAX_AGE_S = 60 * 60 * 24 * 7;

export function gatePassword(): string | null {
  const p = process.env.SITE_PASSWORD;
  return p && p.length > 0 ? p : null;
}

// True when the gate should refuse everything: deployed on Vercel without a password.
export function gateMisconfigured(): boolean {
  return !gatePassword() && Boolean(process.env.VERCEL_ENV);
}

function sign(password: string, exp: number): string {
  return createHmac("sha256", password).update(`site-gate-v2:${exp}`).digest("base64url");
}

// Cookie value `${exp}.${hmac}`: exp is epoch seconds, signed with the password, so rotating SITE_PASSWORD
// logs everyone out and the server enforces the 7-day expiry itself.
export function gateToken(password: string, nowS = Math.floor(Date.now() / 1000)): string {
  const exp = nowS + GATE_MAX_AGE_S;
  return `${exp}.${sign(password, exp)}`;
}

export function verifyGateToken(cookie: string, password: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  const m = /^(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
  if (!m) return false;
  const exp = Number(m[1]);
  if (exp <= nowS || exp > nowS + GATE_MAX_AGE_S + 60) return false;
  return safeEqual(m[2], sign(password, exp));
}

// Constant time and length-independent: both sides are hashed to 32 bytes before comparing.
export function safeEqual(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

// Only same-site paths, so /unlock?next= can't redirect off the site. Resolve the way the browser will
// (URL parsing strips tabs and newlines, so "/\t/evil.com" becomes "//evil.com") and require our origin.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(next)) return "/";
  const base = "https://gate.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return "/";
  }
  // Dot segments collapse during parsing ("/.//evil.com" -> pathname "//evil.com"), so check the resolved
  // pathname too: a leading "//" or "/\\" would be read as a protocol-relative URL by the redirect.
  if (url.origin !== base || url.pathname.startsWith("//") || url.pathname.startsWith("/\\")) return "/";
  const out = url.pathname + url.search + url.hash;
  // Belt and braces: the result must resolve to the same origin when used as a relative Location.
  try {
    if (new URL(out, base).origin !== base) return "/";
  } catch {
    return "/";
  }
  return out;
}

// The daily purge cron (/api/cron/purge) authenticates with `Authorization: Bearer ${CRON_SECRET}`, which Vercel
// sends on cron invocations. False when CRON_SECRET is unset or shorter than 16 characters.
export const CRON_PURGE_PATH = "/api/cron/purge";

export function cronAuthorized(authorization: string | null | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !authorization) return false;
  return safeEqual(authorization, `Bearer ${secret}`);
}
