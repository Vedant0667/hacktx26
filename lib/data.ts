// Server-only loader for decision data written by engine/build.py into public/data.
// DATA_DIR overrides the directory (absolute, or relative to the project root).
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DecisionIndexEntry, DecisionPoint, LapFrame } from "./types";

// Each readFile spells its path inline: the default one is statically scoped so the bundler traces
// only public/data into the server output (on Vercel, public/ is otherwise CDN-only); the
// DATA_DIR one is a dev/test override the tracer is told to ignore.
function readData(rel: string): Promise<string> {
  const override = process.env.DATA_DIR;
  if (override) {
    return readFile(path.resolve(/*turbopackIgnore: true*/ process.cwd(), override, rel), "utf8");
  }
  return readFile(path.join(process.cwd(), "public", "data", rel), "utf8");
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

// Only successful reads are cached, so files that land after startup are picked up.
const cache = new Map<string, unknown>();

async function readJson<T>(rel: string): Promise<T | null> {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit as T;
  try {
    const raw = await readData(rel);
    const parsed = JSON.parse(raw) as T;
    cache.set(rel, parsed);
    return parsed;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw err;
  }
}

// index.json is written as {decision_points: [...]}; a bare array is accepted too.
export async function getIndex(): Promise<DecisionIndexEntry[] | null> {
  const raw = await readJson<DecisionIndexEntry[] | { decision_points: DecisionIndexEntry[] }>("index.json");
  if (!raw) return null;
  return Array.isArray(raw) ? raw : raw.decision_points;
}

export async function getDecision(id: string): Promise<DecisionPoint | null> {
  if (!ID_RE.test(id)) return null;
  return readJson<DecisionPoint>(path.join(id, "decision.json"));
}

export async function getFrames(id: string): Promise<LapFrame[] | null> {
  if (!ID_RE.test(id)) return null;
  return readJson<LapFrame[]>(path.join(id, "frames.json"));
}
