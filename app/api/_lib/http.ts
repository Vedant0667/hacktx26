// Shared helpers for the API route handlers. The _lib folder is private (not routed).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { getDecision } from "@/lib/data";
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
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
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
