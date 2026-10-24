// Shared-password gate for test deployments. Off when SITE_PASSWORD is unset (local dev).
import { createHmac, timingSafeEqual } from "node:crypto";

export const GATE_COOKIE = "site_gate";
export const GATE_MAX_AGE_S = 60 * 60 * 24 * 7;

export function gatePassword(): string | null {
  const p = process.env.SITE_PASSWORD;
  return p && p.length > 0 ? p : null;
}

// The cookie holds an HMAC of the password, never the password, so rotating SITE_PASSWORD logs everyone out.
export function gateToken(password: string): string {
  return createHmac("sha256", password).update("site-gate-v1").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Only same-site relative paths, so /unlock?next= can't redirect off the site.
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
