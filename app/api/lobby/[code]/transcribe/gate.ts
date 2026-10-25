// Pure request checks for POST /api/lobby/[code]/transcribe (no I/O), unit-tested in scripts/test-voice.ts.
// Order in the route: content type (415) -> declared length (413) -> token (403) -> call phase
// (409) -> rate limits (429) -> body read with a hard cap (413, 400) -> Muse (503 with fallback: true).
import type { LobbyMeta } from "@/lib/db";
import { ASR_MAX_BYTES, ASR_MIN_BYTES } from "@/lib/muse/asr";
import { HttpError, REVEAL_GRACE_S, tokenMatches } from "../../../_lib/http";

export const ASR_PER_CALL = 4; // clips per player per call window (one decision, or one race freeze)
export const ASR_PER_CALL_WINDOW_S = 3600;
export const ASR_PER_IP = 300; // per IP and lobby per hour: a 13-phone room on one NAT over a 6-freeze race
export const ASR_PER_IP_WINDOW_S = 3600;
// Backstop per IP across every lobby per hour: a venue on one public IP running several rooms at once.
export const ASR_PER_IP_ALL = 2000;
export const ASR_PER_IP_ALL_WINDOW_S = 3600;

// This route is the one POST that takes a non-JSON body: raw PCM16 LE mono at 16 kHz.
export function requireOctetStream(req: Request): void {
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/octet-stream") throw new HttpError(415, "Content-Type must be application/octet-stream");
}

// Rejects a declared body over the cap before anything is read. A missing Content-Length (chunked) is
// allowed here; readPcm still enforces the cap while streaming.
export function checkDeclaredLength(req: Request, max = ASR_MAX_BYTES): void {
  const raw = req.headers.get("content-length");
  if (raw == null) return;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, "Bad Content-Length");
  if (n > max) throw new HttpError(413, `Recording too long (max ${max} bytes, 30 s)`);
}

export interface CallTarget {
  key: string; // rate-limit key part: the decision, or the race freeze lap
  decisionId: string | null; // logged with the Muse row
  raceLap: number | null; // race mode: the freeze lap (the route checks no call is in yet)
}

// Token and call-phase rules. 403 for a wrong or missing token (same message as an unknown lobby), 409 when
// the lobby is not taking a call from this player right now (moment: phase "decision" and no call in yet;
// race: phase "freeze" and the player's car is in this freeze).
export function callTarget(meta: LobbyMeta, token: string | null, denied: string): CallTarget {
  if (!meta.is_player || !tokenMatches(token, meta.player_token_hash)) throw new HttpError(403, denied);
  if (meta.mode === "race") {
    if (meta.phase !== "freeze") throw new HttpError(409, "Voice notes are only taken during a call");
    const f = meta.freeze_plan?.[meta.freeze_index] ?? null; // _lib/race currentFreeze() during "freeze"
    const car = meta.player_driver_code;
    if (!f || !car || !f.drivers.includes(car)) throw new HttpError(409, "No call needed for your car at this lap");
    return { key: `L${f.lap}`, decisionId: meta.race_key ? `race:${meta.race_key}:L${f.lap}` : null, raceLap: f.lap };
  }
  if (meta.phase !== "decision") throw new HttpError(409, "Voice notes are only taken during a call");
  if (meta.has_submitted) throw new HttpError(409, "Your call is already in");
  return { key: meta.decision_id, decisionId: meta.decision_id, raceLap: null };
}

// Reads the body with a hard cap (a lying or missing Content-Length cannot get past it). PCM16 needs an even
// byte count; under ASR_MIN_BYTES (0.25 s) is a stray tap, not speech.
export async function readPcm(req: Request, max = ASR_MAX_BYTES, min = ASR_MIN_BYTES): Promise<Uint8Array> {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "Recording too short");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, `Recording too long (max ${max} bytes, 30 s)`);
    }
    chunks.push(value);
  }
  if (total < min) throw new HttpError(400, "Recording too short");
  if (total % 2 !== 0) throw new HttpError(400, "Body must be 16-bit PCM");
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

// After the audio is read and transcribed: calls must still be open for the same moment (or inside the reveal grace)
// before the words may be attached to a stored call. Otherwise an upload held open past the reveal could add a
// reason after the answer is known.
export function callsStillOpen(meta: Pick<LobbyMeta, "mode" | "phase" | "phase_elapsed_s" | "freeze_plan" | "freeze_index">, target: CallTarget): boolean {
  if (meta.mode === "race") {
    const open = meta.phase === "freeze" || (meta.phase === "reveal_freeze" && meta.phase_elapsed_s < REVEAL_GRACE_S);
    return open && target.raceLap != null && meta.freeze_plan?.[meta.freeze_index]?.lap === target.raceLap;
  }
  return meta.phase === "decision" || (meta.phase === "reveal" && meta.phase_elapsed_s < REVEAL_GRACE_S);
}
