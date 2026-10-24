// Shared helpers for the API route handlers. The _lib folder is private (not routed).
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { getDecision } from "@/lib/data";
import type { DecisionPoint } from "@/lib/types";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

// Parses and validates a JSON body; throws HttpError(400) with the first issue.
export async function readBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
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
      if (err instanceof HttpError) return jsonError(err.status, err.message);
      unstable_rethrow(err); // let Next's own control-flow errors (prerender bailouts) through
      console.error(err);
      return jsonError(500, "Internal error");
    }
  };
}
