// Server-only Muse Spark client with a hard spend cap. Each call first reserves its worst-case cost in
// muse_calls (atomic, see reserveMuseCall), then the row is updated with the real usage;
// callers get null (and use the local fallback) when the key is missing, a spend cap is hit (lifetime, hourly,
// per creator or per lobby), or the call fails, times out, is truncated, or returns JSON that does not validate.
import type { z } from "zod";
import { finishMuseCall, reserveMuseCall, type MuseSkipReason } from "../db";

export const MUSE_MODEL = "muse-spark-1.3";
// Used only when Meta answers 404 model_not_found for MUSE_MODEL (it did for stretches on 2026-10-24/25).
export const MUSE_FALLBACK_MODEL = "muse-spark-1.2";
const ENDPOINT = "https://api.meta.ai/v1/responses";
const TIMEOUT_MS = 6000;
const INPUT_FRAMING_TOKENS = 256;

// muse-spark-1.3 prices, USD per token. output_tokens already includes reasoning tokens.
const PRICE_INPUT = 1.25 / 1e6;
const PRICE_CACHED = 0.15 / 1e6;
const PRICE_OUTPUT = 4.25 / 1e6;

// Every spend cap reads its env the same way: unset, empty, non-numeric or negative means the default.
export function envNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

// Lifetime cap: all spend ever. Also the operator's DB kill switch (a muse_calls row with cost_usd 1000).
export function museBudgetUsd(): number {
  return envNumber(process.env.MUSE_BUDGET_USD, 5);
}

// Rolling cap over the last 60 minutes of muse_calls, every purpose (docs/audits/public-launch.md P1a).
export function museHourlyUsd(): number {
  return envNumber(process.env.MUSE_HOURLY_USD, 4);
}

// Rolling 60-minute cap over every lobby with the same creator key (the creating IP), P1b.
export function museCreatorHourlyUsd(): number {
  return envNumber(process.env.MUSE_CREATOR_HOURLY_USD, 2);
}

export type MuseCapGroup = "grading" | "transcribe";

// Voice clips and grading calls count against separate per-lobby caps, so retries of one never starve the other.
export function capGroupOf(purpose: string): MuseCapGroup {
  return purpose === "transcribe" ? "transcribe" : "grading";
}

type Env = Record<string, string | undefined>;

// Per-lobby call caps for a purpose's group, by lobby mode. Grading: 80 for a race lobby (12 players x 6 freezes
// with one ask each; audibles are graded after the freezes, so they meet the cap first), 30 for a moment lobby.
// Voice: 150 clips per lobby either way.
export function lobbyCallCaps(purpose: string, env: Env = process.env): { group: MuseCapGroup; race: number; moment: number } {
  if (capGroupOf(purpose) === "transcribe") {
    const n = Math.floor(envNumber(env.MUSE_LOBBY_MAX_CLIPS, 150));
    return { group: "transcribe", race: n, moment: n };
  }
  return {
    group: "grading",
    race: Math.floor(envNumber(env.MUSE_LOBBY_MAX_CALLS_RACE, 80)),
    moment: Math.floor(envNumber(env.MUSE_LOBBY_MAX_CALLS_MOMENT, 30)),
  };
}

export function lobbyCallCap(purpose: string, mode: "race" | "moment", env: Env = process.env): number {
  const caps = lobbyCallCaps(purpose, env);
  return mode === "race" ? caps.race : caps.moment;
}

// One warning per lobby per reason (a capped race lobby would otherwise log every refused call).
const skipsLogged = new Set<string>();
export function logBudgetSkip(lobbyCode: string | null, purpose: string, reason: MuseSkipReason): boolean {
  const key = `${lobbyCode ?? "-"}:${reason}`;
  if (skipsLogged.has(key)) return false;
  if (skipsLogged.size >= 5000) skipsLogged.clear(); // a long-lived instance must not grow without bound
  skipsLogged.add(key);
  console.warn(`muse: budget skip (${reason}) lobby=${lobbyCode ?? "-"} purpose=${purpose}`);
  return true;
}

// Reserves a call's worst-case cost under every cap (see reserveMuseCall). null: make no call.
export async function reserveSpend(r: { purpose: string; lobbyCode: string | null; decisionId: string | null; model: string; worstCostUsd: number }): Promise<number | null> {
  const caps = lobbyCallCaps(r.purpose);
  return reserveMuseCall({
    purpose: r.purpose, lobby_code: r.lobbyCode, decision_id: r.decisionId, model: r.model, worst_cost_usd: r.worstCostUsd,
    budget_usd: museBudgetUsd(), hourly_usd: museHourlyUsd(), creator_hourly_usd: museCreatorHourlyUsd(),
    lobby_cap_group: caps.group, lobby_max_race: caps.race, lobby_max_moment: caps.moment,
    onRefused: (reason) => logBudgetSkip(r.lobbyCode, r.purpose, reason),
  });
}

export function museEnabled(): boolean {
  return Boolean(process.env.MODEL_API_KEY);
}

interface Usage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

function costOf(input: number, cached: number, output: number): number {
  return Math.max(0, input - cached) * PRICE_INPUT + cached * PRICE_CACHED + output * PRICE_OUTPUT;
}

export interface MuseRequest<T> {
  purpose: string;
  lobbyCode: string | null;
  decisionId: string | null;
  instructions: string;
  input: string;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  validator: z.ZodType<T>;
  maxOutputTokens: number;
  onSkip?: () => void; // called when no call is made (no key, over a spend cap), as opposed to a failed call
  timeoutMs?: number; // default TIMEOUT_MS; the spend cap does not depend on it (the reservation is the worst case)
}

export async function museJson<T>(req: MuseRequest<T>): Promise<T | null> {
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    req.onSkip?.();
    return null;
  }

  // Upper bound for this call. A BPE token is never shorter than one UTF-8 byte, so the byte length of
  // everything billed as input (instructions, input and the JSON schema) bounds the input tokens; add a
  // fixed allowance for message framing. Output is bounded by max_output_tokens.
  const billedInput = req.instructions + req.input + JSON.stringify(req.jsonSchema) + req.schemaName;
  const worstInput = Buffer.byteLength(billedInput, "utf8") + INPUT_FRAMING_TOKENS;
  const worstCost = Math.ceil(costOf(worstInput, 0, req.maxOutputTokens) * 1e6) / 1e6;
  let reservation: number | null;
  try {
    reservation = await reserveSpend({
      purpose: req.purpose, lobbyCode: req.lobbyCode, decisionId: req.decisionId, model: MUSE_MODEL, worstCostUsd: worstCost,
    });
  } catch (err) {
    console.error("muse: budget reservation failed, using local fallback", err);
    req.onSkip?.();
    return null; // fail closed: no spend we cannot account for
  }
  if (reservation === null) {
    req.onSkip?.();
    return null; // over a spend cap (logged once per lobby and reason)
  }

  const started = Date.now();
  const log = {
    purpose: req.purpose, lobby_code: req.lobbyCode, decision_id: req.decisionId, model: MUSE_MODEL,
    ok: false, status: null as string | null, error: null as string | null,
    input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cost_usd: 0, latency_ms: 0,
  };
  let result: T | null = null;
  try {
    type Body = {
      status?: string;
      usage?: Usage;
      error?: { message?: string; code?: string } | string | null;
      incomplete_details?: { reason?: string } | null;
      output?: { type: string; content?: { type: string; text?: string }[] }[];
    } | null;
    const ask = (model: string) =>
      fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          instructions: req.instructions,
          input: req.input,
          max_output_tokens: req.maxOutputTokens,
          reasoning: { effort: "minimal" },
          text: { format: { type: "json_schema", name: req.schemaName, strict: true, schema: req.jsonSchema } },
        }),
        signal: AbortSignal.timeout(req.timeoutMs ?? TIMEOUT_MS),
      });
    let res = await ask(MUSE_MODEL);
    let body = (await res.json().catch(() => null)) as Body;
    const missing = (b: Body) => typeof b?.error === "object" && b?.error?.code === "model_not_found";
    if (res.status === 404 && missing(body)) {
      // The primary model is unavailable (not billed); same request on the fallback Muse Spark model.
      log.model = MUSE_FALLBACK_MODEL;
      res = await ask(MUSE_FALLBACK_MODEL);
      body = (await res.json().catch(() => null)) as Body;
    }
    const u = body?.usage;
    if (u) {
      log.input_tokens = u.input_tokens ?? 0;
      log.cached_tokens = u.input_tokens_details?.cached_tokens ?? 0;
      log.output_tokens = u.output_tokens ?? 0;
      log.reasoning_tokens = u.output_tokens_details?.reasoning_tokens ?? 0;
    }
    log.status = body?.status ?? `http_${res.status}`;
    if (!res.ok) {
      const e = body?.error;
      // A definite 4xx with an error body is not billed: log it at zero rather than the worst case.
      if (res.status >= 400 && res.status < 500 && e) log.status = `http_${res.status}_unbilled`;
      throw new Error(`HTTP ${res.status}: ${typeof e === "string" ? e : (e?.message ?? "no body")}`);
    }
    if (body?.status !== "completed") throw new Error(`status ${body?.status} ${body?.incomplete_details?.reason ?? ""}`.trim());
    const text = body.output
      ?.filter((o) => o.type === "message")
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text ?? "")
      .join("");
    if (!text) throw new Error("no output_text");
    const parsed = req.validator.safeParse(JSON.parse(text));
    if (!parsed.success) throw new Error(`schema: ${parsed.error.issues[0]?.message}`);
    result = parsed.data;
    log.ok = true;
  } catch (err) {
    log.error = err instanceof Error ? err.message : String(err);
    if (log.input_tokens === 0 && log.output_tokens === 0 && !log.status?.endsWith("_unbilled")) {
      // No usage came back (timeout or network): log the worst case so the cap stays conservative.
      log.input_tokens = worstInput;
      log.output_tokens = req.maxOutputTokens;
      log.status = log.status ?? "no_usage_estimated";
    }
  }
  log.latency_ms = Date.now() - started;
  log.cost_usd = Math.round(costOf(log.input_tokens, log.cached_tokens, log.output_tokens) * 1e6) / 1e6;
  try {
    await finishMuseCall(reservation, log); // if this fails, the reservation stays at the worst case
  } catch (err) {
    console.error("muse: failed to log call", err);
  }
  if (!log.ok) console.warn(`muse ${req.purpose}: ${log.error}`);
  return result;
}
