// Server-only Muse Voice Transcribe client (file endpoint, not the realtime WebSocket).
// POST https://api.meta.ai/v1/asr/transcribe, multipart/form-data: `request` (JSON settings) + `audio` (WAV,
// mono, 16-bit PCM, 16 or 24 kHz). Response JSON: { sessionId, transcript, audioDurationMs, turns[] }.
// Docs: https://dev.meta.ai/docs/speech-to-text and https://dev.meta.ai/docs/api-reference/voice/transcribe
// Billing: $0.18 per hour of audio processed ($3 per 1,000 min), metered in whole seconds, rounded down.
// Spend goes through the same muse_calls budget cap as Muse Spark: reserve the worst case, then log the real cost.
import { finishMuseCall } from "../db";
import { reserveSpend } from "./client";

export const ASR_MODEL = "muse-voice-transcribe-1.0";
const ENDPOINT = "https://api.meta.ai/v1/asr/transcribe";
export const ASR_SAMPLE_RATE = 16000;
export const ASR_BYTES_PER_S = ASR_SAMPLE_RATE * 2; // PCM16 mono
export const ASR_MAX_S = 30;
export const ASR_MAX_BYTES = ASR_BYTES_PER_S * ASR_MAX_S; // 960,000
export const ASR_MIN_BYTES = ASR_BYTES_PER_S / 4; // 0.25 s: shorter clips are taps, not speech
export const ASR_TIMEOUT_MS = 10_000;
export const ASR_USD_PER_S = 0.18 / 3600;
// Recognition hints (biases spelling; not a guarantee).
const KEYWORDS = ["box", "stay out", "pit", "undercut", "overcut", "safety car", "VSC", "tyres", "softs", "mediums", "hards", "track position", "pit stop"];

// Cost of `seconds` of audio, rounded up to the micro-dollar so the reservation never under-counts.
export function asrCostUsd(seconds: number): number {
  return Math.ceil(Math.max(0, seconds) * ASR_USD_PER_S * 1e6) / 1e6;
}

// A 44-byte RIFF/WAVE header in front of raw PCM16 LE mono.
export function pcmToWav(pcm: Uint8Array, sampleRate = ASR_SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(44 + pcm.byteLength));
  const v = new DataView(out.buffer);
  const ascii = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  v.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  v.setUint32(40, pcm.byteLength, true);
  out.set(pcm, 44);
  return out;
}

export type AsrResult =
  | { ok: true; transcript: string; duration_ms: number }
  | { ok: false; reason: "disabled" | "budget" | "failed" };

// Transcribes one clip of 16 kHz PCM16 LE mono. Never throws. The transcript is returned to the caller only;
// muse_calls stores usage and cost, never the words. Rows carry the lobby code, so voice counts toward the hourly
// and per-creator caps, but purpose 'transcribe' has its own per-lobby clip cap (150) and never uses up the
// grading cap. decision_id ties the row to the moment.
export async function museTranscribe(pcm: Uint8Array, ctx: { lobbyCode: string | null; decisionId: string | null; timeoutMs?: number }): Promise<AsrResult> {
  const key = process.env.MODEL_API_KEY;
  if (!key) return { ok: false, reason: "disabled" };
  const seconds = pcm.byteLength / ASR_BYTES_PER_S;
  const worstCost = asrCostUsd(Math.ceil(seconds));
  let reservation: number | null;
  try {
    reservation = await reserveSpend({
      purpose: "transcribe", lobbyCode: ctx.lobbyCode, decisionId: ctx.decisionId, model: ASR_MODEL, worstCostUsd: worstCost,
    });
  } catch (err) {
    console.error("asr: budget reservation failed", err);
    return { ok: false, reason: "failed" };
  }
  if (reservation === null) return { ok: false, reason: "budget" };

  const started = Date.now();
  const log = {
    purpose: "transcribe", lobby_code: ctx.lobbyCode, decision_id: ctx.decisionId, model: ASR_MODEL,
    ok: false, status: null as string | null, error: null as string | null,
    input_tokens: 0, cached_tokens: 0, output_tokens: 0, reasoning_tokens: 0, cost_usd: worstCost, latency_ms: 0,
  };
  let result: AsrResult = { ok: false, reason: "failed" };
  try {
    const form = new FormData();
    const settings = { model: ASR_MODEL, audioEncoding: "WAV", mode: "PUSH_TO_TALK", languageBias: ["English"], keywords: KEYWORDS };
    form.append("request", new Blob([JSON.stringify(settings)], { type: "application/json" }));
    form.append("audio", new Blob([pcmToWav(pcm)], { type: "audio/wav" }), "clip.wav");
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(ctx.timeoutMs ?? ASR_TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => null)) as {
      transcript?: unknown;
      audioDurationMs?: unknown;
      sessionId?: unknown;
      error?: { message?: string; type?: string } | string | null;
    } | null;
    log.status = res.ok ? "completed" : `http_${res.status}`;
    if (!res.ok) {
      const e = body?.error;
      throw new Error(`HTTP ${res.status}: ${typeof e === "string" ? e : (e?.message ?? e?.type ?? "no body")} (session ${String(body?.sessionId ?? "-")})`);
    }
    if (typeof body?.transcript !== "string") throw new Error("no transcript in response");
    const ms = typeof body.audioDurationMs === "number" && body.audioDurationMs >= 0 ? body.audioDurationMs : seconds * 1000;
    log.cost_usd = Math.floor(ms / 1000) * ASR_USD_PER_S; // billed in whole seconds, rounded down
    log.cost_usd = Math.round(log.cost_usd * 1e6) / 1e6;
    log.ok = true;
    result = { ok: true, transcript: body.transcript.replace(/\s+/g, " ").trim().replace(/(?<!\.)\.\.$/, ".").slice(0, 1000), duration_ms: Math.round(ms) };
  } catch (err) {
    // Failed or timed out: keep the worst-case cost so the cap stays conservative (the audio may have been processed).
    log.error = err instanceof Error ? err.message : String(err);
    log.status = log.status ?? "no_response";
  }
  log.latency_ms = Date.now() - started;
  try {
    await finishMuseCall(reservation, log);
  } catch (err) {
    console.error("asr: failed to log call", err);
  }
  if (!log.ok) console.warn(`asr transcribe: ${log.error}`);
  return result;
}
