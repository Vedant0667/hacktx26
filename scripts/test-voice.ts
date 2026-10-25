// Hermetic checks for Round 8 (voice notes): the transcribe route's validation, the WAV wrapper and cost,
// and the client downsampler. No network, no DB. Run: npx tsx scripts/test-voice.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { callsStillOpen, callTarget, checkDeclaredLength, readPcm, requireOctetStream, ASR_PER_CALL, ASR_PER_IP, ASR_PER_IP_ALL } from "../app/api/lobby/[code]/transcribe/gate";
import { hashToken, HttpError, newToken } from "../app/api/_lib/http";
import { ASR_MAX_BYTES, ASR_MIN_BYTES, asrCostUsd, museTranscribe, pcmToWav } from "../lib/muse/asr";
import { Downsampler, meterLevel, toPcm16 } from "../lib/client/recorder";
import type { LobbyMeta } from "../lib/db";

const root = path.resolve(__dirname, "..");
const src = (p: string) => readFileSync(path.join(root, p), "utf8");

function statusOf(fn: () => unknown): number {
  try {
    fn();
    return 200;
  } catch (err) {
    return err instanceof HttpError ? err.status : 500;
  }
}
async function statusOfAsync(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (err) {
    return err instanceof HttpError ? err.status : 500;
  }
}

const URL_ = "https://x.test/api/lobby/ABCD/transcribe";
const req = (headers: Record<string, string>, body?: BodyInit) => new Request(URL_, { method: "POST", headers, body });
// A body with no Content-Length (chunked), so only the streaming cap can stop it.
function streamed(total: number, chunk = 64_000): Request {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent >= total) return c.close();
      const n = Math.min(chunk, total - sent);
      sent += n;
      c.enqueue(new Uint8Array(n));
    },
  });
  return new Request(URL_, { method: "POST", headers: { "content-type": "application/octet-stream" }, body, duplex: "half" } as RequestInit);
}

function meta(over: Partial<LobbyMeta> = {}): LobbyMeta {
  return {
    decision_id: "d1", phase: "decision", mode: "moment", race_key: null, freeze_plan: null, freeze_index: 0, total_laps: null,
    phase_elapsed_s: 3, host_token_hash: null, is_player: true, player_token_hash: null, has_submitted: false,
    player_count: 2, submitted_count: 0, token_player: "Ana", driver_mode: "same", driver_code: "VER", player_driver_code: "VER",
    ...over,
  } as LobbyMeta;
}

async function main() {
  // Content type: only application/octet-stream (415 otherwise, JSON included).
  assert.equal(statusOf(() => requireOctetStream(req({}))), 415);
  assert.equal(statusOf(() => requireOctetStream(req({ "content-type": "application/json" }))), 415);
  assert.equal(statusOf(() => requireOctetStream(req({ "content-type": "text/plain" }))), 415);
  assert.equal(statusOf(() => requireOctetStream(req({ "content-type": "multipart/form-data; boundary=x" }))), 415);
  assert.equal(statusOf(() => requireOctetStream(req({ "content-type": "application/octet-stream" }))), 200);
  assert.equal(statusOf(() => requireOctetStream(req({ "content-type": "Application/Octet-Stream; x=1" }))), 200);

  // Size: 30 s of 16 kHz PCM16 is the cap, checked from Content-Length first and again while streaming.
  assert.equal(ASR_MAX_BYTES, 960_000);
  assert.equal(statusOf(() => checkDeclaredLength(req({ "content-length": String(ASR_MAX_BYTES + 1) }))), 413);
  assert.equal(statusOf(() => checkDeclaredLength(req({ "content-length": String(ASR_MAX_BYTES) }))), 200);
  assert.equal(statusOf(() => checkDeclaredLength(req({ "content-length": "abc" }))), 400);
  assert.equal(statusOf(() => checkDeclaredLength(req({}))), 200);
  assert.equal(await statusOfAsync(readPcm(streamed(ASR_MAX_BYTES + 2))), 413, "streamed body over the cap must be cut off");
  assert.equal(await statusOfAsync(readPcm(streamed(ASR_MIN_BYTES - 2))), 400, "a stray tap is too short");
  assert.equal(await statusOfAsync(readPcm(streamed(ASR_MIN_BYTES + 1))), 400, "odd byte count is not PCM16");
  assert.equal(await statusOfAsync(readPcm(req({ "content-type": "application/octet-stream" }))), 400, "no body");
  const ok = await readPcm(streamed(32_000 * 3, 7_001));
  assert.equal(ok.byteLength, 96_000);
  assert.equal((await readPcm(streamed(ASR_MAX_BYTES))).byteLength, ASR_MAX_BYTES);

  // Token: a wrong, missing or other player's token is 403, never a phase hint.
  const tok = newToken();
  const denied = "denied";
  const m = meta({ player_token_hash: hashToken(tok) });
  assert.equal(statusOf(() => callTarget(m, null, denied)), 403);
  assert.equal(statusOf(() => callTarget(m, "", denied)), 403);
  assert.equal(statusOf(() => callTarget(m, newToken(), denied)), 403);
  assert.equal(statusOf(() => callTarget({ ...m, is_player: false }, tok, denied)), 403);
  assert.equal(statusOf(() => callTarget({ ...m, phase: "replay" }, newToken(), denied)), 403, "token is checked before phase");

  // Phase: moment lobbies take notes only in "decision" and only before the call is in.
  for (const phase of ["waiting", "replay", "reveal", "done"] as const) assert.equal(statusOf(() => callTarget({ ...m, phase }, tok, denied)), 409, phase);
  assert.equal(statusOf(() => callTarget({ ...m, has_submitted: true }, tok, denied)), 409);
  assert.deepEqual(callTarget(m, tok, denied), { key: "d1", decisionId: "d1", raceLap: null });

  // Race lobbies: only in "freeze", and only when the player's car is in this freeze.
  const plan = [{ lap: 12, drivers: ["VER", "NOR"] }, { lap: 30, drivers: ["HAM"] }];
  const r = meta({ mode: "race", race_key: "2024-x", freeze_plan: plan, freeze_index: 0, phase: "freeze", player_token_hash: hashToken(tok) });
  assert.deepEqual(callTarget(r, tok, denied), { key: "L12", decisionId: "race:2024-x:L12", raceLap: 12 });
  for (const phase of ["waiting", "replay", "reveal_freeze", "done"] as const) assert.equal(statusOf(() => callTarget({ ...r, phase }, tok, denied)), 409, phase);
  assert.equal(statusOf(() => callTarget({ ...r, freeze_index: 1 }, tok, denied)), 409, "car not in this freeze");
  assert.equal(statusOf(() => callTarget({ ...r, player_driver_code: null }, tok, denied)), 409);
  assert.equal(statusOf(() => callTarget({ ...r, player_token_hash: null }, tok, denied)), 403);

  // Rate limit and route order (source checks): 415 and 413 before any DB work, token and phase before the
  // rate limit, the rate limit before the body is read, then Muse.
  assert.equal(ASR_PER_CALL, 4);
  const route = src("app/api/lobby/[code]/transcribe/route.ts");
  const at = (s: string) => {
    const i = route.indexOf(s);
    assert.ok(i >= 0, `route lost ${s}`);
    return i;
  };
  assert.ok(at("requireOctetStream(req)") < at("checkDeclaredLength(req)"));
  assert.ok(at("checkDeclaredLength(req)") < at("lobbyMetaGuarded("));
  assert.ok(at("lobbyMetaGuarded(") < at("callTarget(meta, token"));
  assert.ok(at("callTarget(meta, token") < at('hitRateLimit("asr_player"'));
  assert.ok(at('hitRateLimit("asr_player"') < at("readPcm(req)"));
  // Voice per IP: 300/h per lobby (several rooms behind one venue IP each get their own), 2,000/h per IP overall.
  assert.equal(ASR_PER_IP, 300);
  assert.equal(ASR_PER_IP_ALL, 2000);
  assert.ok(route.includes('hitRateLimit("asr_ip", `${ipKey}:${code}`'), "asr_ip must be keyed by IP and lobby");
  assert.ok(route.includes('hitRateLimit("asr_ip_all", ipKey'), "per-IP voice backstop missing");
  assert.ok(at('hitRateLimit("asr_ip_all"') < at("readPcm(req)"));
  assert.ok(at("readPcm(req)") < at("museTranscribe("));
  assert.ok(route.includes("museTranscribe(pcm, { lobbyCode: code"), "voice clips must carry the lobby code for the clip cap");
  assert.ok(!/readBody\(/.test(route), "this route takes raw PCM, not JSON");
  assert.ok(/fallback: true/.test(route) && /status: 503/.test(route));
  assert.ok(/"Cache-Control": "no-store"/.test(route));
  // The proxy gate still covers the route (not an open path).
  assert.ok(!/transcribe/.test(src("proxy.ts")));

  // No words or audio stored: the muse_calls row carries usage and cost only.
  const asrSrc = src("lib/muse/asr.ts");
  const logBlock = asrSrc.slice(asrSrc.indexOf("const log = {"), asrSrc.indexOf("};", asrSrc.indexOf("const log = {")));
  assert.ok(logBlock.length > 0 && !/transcript|audio|pcm/i.test(logBlock), "muse_calls log must not hold the transcript or audio");
  assert.ok(/purpose: "transcribe", lobbyCode: ctx\.lobbyCode/.test(asrSrc), "voice reserves under purpose 'transcribe' with the lobby code");

  // WAV wrapper and pricing ($0.18 per hour, whole seconds).
  const pcm = toPcm16(new Float32Array([0, 1, -1, 0.5]));
  assert.deepEqual([...pcm], [0, 0, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40]);
  const wav = pcmToWav(pcm);
  const dv = new DataView(wav.buffer);
  assert.equal(String.fromCharCode(...wav.slice(0, 4)), "RIFF");
  assert.equal(String.fromCharCode(...wav.slice(8, 16)), "WAVEfmt ");
  assert.equal(dv.getUint32(4, true), 36 + pcm.byteLength);
  assert.equal(dv.getUint16(20, true), 1); // PCM
  assert.equal(dv.getUint16(22, true), 1); // mono
  assert.equal(dv.getUint32(24, true), 16000);
  assert.equal(dv.getUint16(34, true), 16);
  assert.equal(String.fromCharCode(...wav.slice(36, 40)), "data");
  assert.equal(dv.getUint32(40, true), pcm.byteLength);
  assert.equal(wav.byteLength, 44 + pcm.byteLength);
  assert.equal(asrCostUsd(30), 0.0015);
  assert.equal(asrCostUsd(1000 * 60), 3); // $3 per 1,000 minutes
  assert.equal(asrCostUsd(0), 0);

  // No key: the service reports "disabled" before any DB or network call (the route answers 503 fallback).
  const saved = process.env.MODEL_API_KEY;
  delete process.env.MODEL_API_KEY;
  assert.deepEqual(await museTranscribe(new Uint8Array(32_000), { lobbyCode: null, decisionId: null }), { ok: false, reason: "disabled" });
  if (saved !== undefined) process.env.MODEL_API_KEY = saved;

  // Client downsampler: 48 kHz and 44.1 kHz to 16 kHz, length and DC level kept.
  for (const inRate of [48000, 44100, 16000, 8000]) {
    const out: number[] = [];
    const d = new Downsampler(inRate, (v) => out.push(v));
    for (let i = 0; i < 10; i++) d.push(new Float32Array(inRate / 10).fill(0.25));
    assert.ok(Math.abs(out.length - 16000) <= 1, `${inRate}: ${out.length} samples for 1 s`);
    assert.ok(out.every((v) => Math.abs(v - 0.25) < 1e-6), `${inRate}: DC level changed`);
  }
  // A 1 kHz tone survives 48k -> 16k with most of its amplitude (box filter of width 3).
  const tone: number[] = [];
  const d = new Downsampler(48000, (v) => tone.push(v));
  d.push(Float32Array.from({ length: 48000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000)));
  const peak = Math.max(...tone.map(Math.abs));
  assert.ok(peak > 0.9 && peak <= 1, `1 kHz peak ${peak}`);
  assert.equal(meterLevel(new Float32Array(128)), 0);
  assert.equal(meterLevel(new Float32Array(128).fill(1)), 12);

  // Client: the record control is a single tap (click), never hold-to-talk pointer handlers.
  const pad = src("components/play/CallPad.tsx");
  assert.ok(/onClick=\{voice\.toggle\}/.test(pad), "record control must toggle on click");
  assert.ok(!/onPointerDown|onPointerUp|useSpeech\(/.test(pad), "hold-to-talk is back in CallPad");
  const rec = src("lib/client/recorder.ts");
  assert.ok(/"content-type": "application\/octet-stream"/.test(rec) && /x-player-token/.test(rec));
  assert.ok(/addModule\("\/worklets\/pcm\.js"\)/.test(rec) && /createScriptProcessor/.test(rec), "worklet plus ScriptProcessor fallback");

  console.log("test-voice: all checks passed");
}

// A late transcript is attached only while calls are open for the same moment, or inside the 2 s reveal grace.
{
  const plan = [{ lap: 24, drivers: ["NOR"] }, { lap: 31, drivers: ["NOR"] }] as never;
  const race = (phase: string, elapsed: number, idx = 0) => ({ mode: "race", phase, phase_elapsed_s: elapsed, freeze_plan: plan, freeze_index: idx }) as never;
  const lap24 = { key: "L24", decisionId: null, raceLap: 24 };
  assert.equal(callsStillOpen(race("freeze", 39), lap24), true);
  assert.equal(callsStillOpen(race("reveal_freeze", 1.5), lap24), true);
  assert.equal(callsStillOpen(race("reveal_freeze", 2.5), lap24), false, "held upload past the grace");
  assert.equal(callsStillOpen(race("replay", 0), lap24), false);
  assert.equal(callsStillOpen(race("freeze", 1, 1), lap24), false, "next freeze is a different moment");
  const moment = (phase: string, elapsed: number) => ({ mode: "moment", phase, phase_elapsed_s: elapsed, freeze_plan: null, freeze_index: 0 }) as never;
  const m = { key: "d", decisionId: "d", raceLap: null };
  assert.equal(callsStillOpen(moment("decision", 30), m), true);
  assert.equal(callsStillOpen(moment("reveal", 1), m), true);
  assert.equal(callsStillOpen(moment("reveal", 3), m), false);
  console.log("ok callsStillOpen");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
