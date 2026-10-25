import type { NextRequest } from "next/server";
import { attachLateReason, getLobbyMeta, getRaceCall, hitRateLimit } from "@/lib/db";
import { COPY } from "@/lib/copy";
import { parseCallLocal } from "@/lib/muse";
import { museTranscribe } from "@/lib/muse/asr";
import { lobbyMetaGuarded } from "../../../_lib/access";
import { clientIp, handle, hashToken, HttpError, normalizeCode } from "../../../_lib/http";
import { ASR_PER_CALL, ASR_PER_CALL_WINDOW_S, ASR_PER_IP, ASR_PER_IP_ALL, ASR_PER_IP_ALL_WINDOW_S, ASR_PER_IP_WINDOW_S, callsStillOpen, callTarget, checkDeclaredLength, readPcm, requireOctetStream } from "./gate";

// Round 8 (voice): a player's voice note -> text with Muse Voice Transcribe. Body: raw PCM16 LE mono at 16 kHz,
// Content-Type application/octet-stream, at most 30 s (960,000 bytes). Header x-player-token. Only while the
// lobby takes a call from this player. 200 { transcript, duration_ms }. 503 { error, fallback: true } when the
// voice service is off, over budget or failing: the phone then uses browser speech or typing.
// Nothing is stored except the muse_calls usage row (no audio, no words).
export const POST = handle(async (req: NextRequest, ctx: RouteContext<"/api/lobby/[code]/transcribe">) => {
  requireOctetStream(req);
  checkDeclaredLength(req);
  const code = normalizeCode((await ctx.params).code);
  const denied = "This device is not signed in as a player in this lobby";
  const token = req.headers.get("x-player-token");
  const { player } = await lobbyMetaGuarded(req, code, undefined, denied);
  if (!player || !token) throw new HttpError(403, denied);
  // getLobbyMeta resolves the player fields (car, has_submitted, token hash) by name: read again for the token's player.
  const meta = await getLobbyMeta(code, player, hashToken(token));
  if (!meta || meta.token_player !== player) throw new HttpError(403, denied);
  const target = callTarget(meta, token, denied);
  if (target.raceLap != null && (await getRaceCall(code, player, "freeze", target.raceLap))) {
    throw new HttpError(409, "Your call is already in");
  }

  const tooMany = (s: number, bucket: string) => new HttpError(429, "Too many voice notes for this call. Type it instead.", s, bucket);
  const mine = await hitRateLimit("asr_player", `${code}:${player}:${target.key}`, ASR_PER_CALL_WINDOW_S);
  if (mine.count > ASR_PER_CALL) throw tooMany(mine.retry_after_s, "asr_player");
  const ipKey = clientIp(req);
  const ip = await hitRateLimit("asr_ip", `${ipKey}:${code}`, ASR_PER_IP_WINDOW_S);
  if (ip.count > ASR_PER_IP) throw tooMany(ip.retry_after_s, "asr_ip");
  const ipAll = await hitRateLimit("asr_ip_all", ipKey, ASR_PER_IP_ALL_WINDOW_S);
  if (ipAll.count > ASR_PER_IP_ALL) throw tooMany(ipAll.retry_after_s, "asr_ip_all");

  const pcm = await readPcm(req);
  const r = await museTranscribe(pcm, { lobbyCode: code, decisionId: target.decisionId });
  if (!r.ok) {
    const error = r.reason === "budget" ? "Voice service is over budget" : r.reason === "disabled" ? "Voice service is off" : "Voice service didn't respond";
    return Response.json({ error, fallback: true }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  // The 0 s auto-send may have stored this call while the note was still transcribing: give it these words.
  // Only while calls are still open for this moment (re-read now: the upload and transcription took time).
  const text = r.transcript.trim();
  const now = text ? await getLobbyMeta(code, player) : null;
  if (text && now && callsStillOpen(now, target)) {
    await attachLateReason(code, player, target.raceLap != null ? { raceLap: target.raceLap } : { scope: meta.decision_id }, (call) => {
      const transcript = text.toLowerCase().startsWith(COPY.freeze.options[call].toLowerCase()) ? text : `${COPY.freeze.options[call]}. ${text}`;
      return { transcript, reasons: parseCallLocal(transcript).reasons };
    }).catch((err) => console.warn("transcribe: late reason not attached", err instanceof Error ? err.message : err));
  }
  return Response.json({ transcript: r.transcript, duration_ms: r.duration_ms }, { headers: { "Cache-Control": "no-store" } });
});
