// Shared helpers for the API route handlers. The _lib folder is private (not routed).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { getDecision, getDefaultDriver, getDriverAnswer, type DriverReveal } from "@/lib/data";
import type { DecisionPoint } from "@/lib/types";

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfterS?: number) {
    super(message);
  }
}

export function jsonError(status: number, error: string, retryAfterS?: number): Response {
  return Response.json(
    { error },
    { status, headers: retryAfterS ? { "Retry-After": String(Math.max(1, Math.ceil(retryAfterS))) } : undefined },
  );
}

// Client IP for rate limits. On Vercel the platform sets x-real-ip / x-forwarded-for (a client cannot
// override them); locally they can be spoofed, which only affects local dev.
// IPv6 clients are keyed by their /64 (one subscriber usually holds a whole /64 and can rotate within it).
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return rateLimitKey(real || fwd || "unknown");
}

// IPv4 unchanged; IPv4-mapped IPv6 (::ffff:1.2.3.4) becomes the IPv4; other IPv6 becomes "<first 4 hextets>::/64".
export function rateLimitKey(raw: string): string {
  let ip = raw.trim();
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") > 0 ? ip.indexOf("]") : undefined);
  if (!ip.includes(":")) return ip || "unknown";
  ip = ip.split("%")[0].toLowerCase(); // zone id
  const hextets = expandIpv6(ip);
  if (!hextets) return ip; // not a valid address: keep it whole
  if (hextets.slice(0, 5).every((h) => h === "0000") && hextets[5] === "ffff") {
    const n = parseInt(hextets[6] + hextets[7], 16);
    return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  }
  return `${hextets.slice(0, 4).map((h) => h.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

function expandIpv6(ip: string): string[] | null {
  // An embedded IPv4 tail counts as two hextets.
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (v4) {
    const b = v4.slice(1).map(Number);
    if (b.some((x) => x > 255)) return null;
    ip = ip.slice(0, v4.index) + `${((b[0] << 8) | b[1]).toString(16)}:${((b[2] << 8) | b[3]).toString(16)}`;
  }
  const parts = ip.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (parts.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array(fill).fill("0"), ...tail];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => h.padStart(4, "0"));
}

// Random bearer tokens (host and player). Only the SHA-256 is stored; comparison is constant time.
export function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(given: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!given || !storedHash || storedHash.length !== 64) return false;
  return timingSafeEqual(Buffer.from(hashToken(given), "hex"), Buffer.from(storedHash, "hex"));
}

// Parses and validates a JSON body; throws HttpError(415) unless the request says it is JSON (so a
// cross-site text/plain form cannot post a body), and HttpError(400) with the first schema issue.
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") throw new HttpError(415, "Content-Type must be application/json");
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue.path.length ? `${issue.path.join(".")}: ` : "";
    throw new HttpError(400, `${where}${issue.message}`);
  }
  return parsed.data;
}

// Lobby codes are 4 letters; accept any case from the URL.
export function normalizeCode(raw: string): string {
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) throw new HttpError(404, "Lobby not found");
  return code;
}

export async function requireDecision(id: string): Promise<DecisionPoint> {
  const decision = await getDecision(id);
  if (!decision) throw new HttpError(404, `Decision ${id} not found`);
  return decision;
}

// A scorable car of this decision (Round 4); 400 for anything else, so a picker cannot pick a car with no answer.
export async function requireDriver(decisionId: string, code: string): Promise<DriverReveal> {
  const driver = await getDriverAnswer(decisionId, code.trim().toUpperCase());
  if (!driver) throw new HttpError(400, `Unknown driver "${code.slice(0, 8)}" for this decision`);
  return driver;
}

// The car a player is scored against: their own, else the lobby's, else the decision's original car.
export async function driverFor(decisionId: string, ...codes: (string | null | undefined)[]): Promise<DriverReveal> {
  for (const code of [...codes, await getDefaultDriver(decisionId)]) {
    if (!code) continue;
    const driver = await getDriverAnswer(decisionId, code);
    if (driver) return driver;
  }
  throw new HttpError(404, `No scorable car for ${decisionId}`);
}

// Wraps a handler so HttpErrors become {error} responses and anything else is a logged 500.
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.message, err.retryAfterS);
      unstable_rethrow(err); // let Next's own control-flow errors (prerender bailouts) through
      console.error(err);
      return jsonError(500, "Internal error");
    }
  };
}
