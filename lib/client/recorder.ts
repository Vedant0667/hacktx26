"use client";
// Tap-to-talk voice notes. Tap once: the mic opens (getUserMedia + AudioContext, created and resumed inside the
// tap, which iOS Safari requires) and audio is captured by an AudioWorklet (public/worklets/pcm.js), or a
// ScriptProcessor where AudioWorklet is missing, then downsampled here to 16 kHz PCM16 mono into a 30 s buffer.
// Tap again (or hit 30 s, background the tab, lose the mic): the clip goes to POST /api/lobby/[code]/transcribe
// (Muse Voice Transcribe). If that service is off or over budget (503 fallback), later taps use the browser's
// Web Speech API where it exists, else typing only. Nothing is uploaded until the player stops.
import { useCallback, useEffect, useRef, useState } from "react";
import { recallPlayerToken } from "./identity";
import { METER_SEGMENTS, useSpeech } from "./useSpeech";

export { METER_SEGMENTS };
export const RATE = 16000;
export const MAX_S = 30;
const MIN_BYTES = RATE * 2 * 0.4; // under 0.4 s is a double tap, not a note
const UPLOAD_TIMEOUT_MS = 15_000; // server waits up to 10 s on Muse

// Streaming box-filter downsampler: each output sample is the mean of the input samples that fall in its slot,
// which also low-passes enough for speech. Works for non-integer ratios (44.1 kHz -> 16 kHz).
export class Downsampler {
  private readonly ratio: number;
  private g = 0; // input samples seen
  private k = 0; // current output slot
  private sum = 0;
  private cnt = 0;
  constructor(inRate: number, private readonly sink: (v: number) => void, outRate = RATE) {
    this.ratio = inRate / outRate;
  }
  push(input: Float32Array): void {
    if (this.ratio <= 1) {
      // Input at or below 16 kHz: nearest neighbour up to 16 kHz.
      for (const x of input) {
        const until = Math.floor((this.g + 1) / this.ratio);
        while (this.k < until) {
          this.sink(x);
          this.k++;
        }
        this.g++;
      }
      return;
    }
    for (const x of input) {
      const slot = Math.floor(this.g / this.ratio);
      if (slot !== this.k && this.cnt > 0) {
        this.sink(this.sum / this.cnt);
        this.sum = 0;
        this.cnt = 0;
        this.k = slot;
      }
      this.sum += x;
      this.cnt++;
      this.g++;
    }
  }
}

// Float [-1, 1] -> PCM16 little-endian bytes (explicit LE, whatever the platform).
export function toPcm16(samples: Float32Array, n = samples.length): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(n * 2));
  const v = new DataView(out.buffer);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return out;
}

// RMS of a chunk on the 0..12 meter scale (same scale as useSpeech's meter).
export function meterLevel(chunk: Float32Array): number {
  if (chunk.length === 0) return 0;
  let sum = 0;
  for (const x of chunk) sum += x * x;
  return Math.min(METER_SEGMENTS, Math.round(Math.sqrt(sum / chunk.length) * 40));
}

type Ctor = typeof AudioContext;
function audioContextCtor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

// One open mic. Built synchronously from the tap (AudioContext + resume), then `open()` awaits the mic.
class Capture {
  readonly ctx: AudioContext;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private buf = new Float32Array(RATE * MAX_S);
  private n = 0;
  private closed = false;
  private onHidden = () => {
    if (document.visibilityState === "hidden") this.events.onEnd();
  };

  constructor(Ctx: Ctor, private events: { onLevel: (l: number) => void; onEnd: () => void }) {
    this.ctx = new Ctx();
    void this.ctx.resume().catch(() => {}); // must run inside the tap on iOS
  }

  async open(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (this.closed) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.stream = stream;
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    if (this.closed) return; // stopped while the context resumed
    // iOS can leave the context suspended after the permission prompt; capturing would record silence.
    if (this.ctx.state !== "running") throw new Error("suspended");
    const down = new Downsampler(this.ctx.sampleRate, (v) => {
      if (this.n < this.buf.length) this.buf[this.n++] = v;
    });
    const onChunk = (chunk: Float32Array) => {
      if (this.closed) return;
      down.push(chunk);
      this.events.onLevel(meterLevel(chunk));
      if (this.n >= this.buf.length) this.events.onEnd(); // 30 s: auto-stop
    };
    const source = this.ctx.createMediaStreamSource(stream);
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // the graph must reach the destination to run; keep it silent
    let node: AudioNode | null = null;
    if (this.ctx.audioWorklet && typeof AudioWorkletNode !== "undefined") {
      try {
        await this.ctx.audioWorklet.addModule("/worklets/pcm.js");
        if (this.closed) return; // stopped while the worklet loaded
        const w = new AudioWorkletNode(this.ctx, "pcm-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
        w.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
        node = w;
      } catch {
        node = null; // fall through to ScriptProcessor
      }
    }
    if (!node) {
      const sp = this.ctx.createScriptProcessor(4096, 1, 1);
      sp.onaudioprocess = (e) => onChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
      node = sp;
    }
    source.connect(node);
    node.connect(mute);
    mute.connect(this.ctx.destination);
    this.nodes = [source, node, mute];
    // Mic lost (another app took it, a phone call) or the page went to the background: stop and send what we have.
    stream.getAudioTracks().forEach((t) => t.addEventListener("ended", () => this.events.onEnd()));
    document.addEventListener("visibilitychange", this.onHidden);
    this.ctx.onstatechange = () => {
      if ((this.ctx.state as string) === "interrupted") this.events.onEnd(); // iOS
    };
  }

  // Tears everything down and returns the clip as PCM16 LE bytes.
  close(): Uint8Array<ArrayBuffer> {
    if (!this.closed) {
      this.closed = true;
      document.removeEventListener("visibilitychange", this.onHidden);
      this.ctx.onstatechange = null;
      for (const nd of this.nodes) {
        try {
          nd.disconnect();
        } catch {}
      }
      this.stream?.getTracks().forEach((t) => t.stop());
      void this.ctx.close().catch(() => {});
    }
    return toPcm16(this.buf, this.n);
  }
}

export type VoiceStatus = "idle" | "starting" | "recording" | "transcribing" | "done" | "failed";
// What blocks voice: the mic itself, or this call's voice-note limit.
export type VoiceIssue = "denied" | "no_mic" | "busy" | "limit" | null;
// Which recogniser the next tap uses.
export type VoiceEngine = "muse" | "browser" | "typed";
// A one-line note for the helper row.
export type VoiceNotice = "short" | "empty" | "failed" | "switchedBrowser" | "switchedTyped" | null;

function micErrorIssue(e: unknown): VoiceIssue {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "no_mic";
  return "busy"; // NotReadableError, AbortError: the mic exists but could not start
}

export function useVoiceNote({ code, me, onText }: { code: string; me: string; onText: (text: string) => void }) {
  const [status, setStatusState] = useState<VoiceStatus>("idle");
  const [issue, setIssue] = useState<VoiceIssue>(null);
  // Starts on "muse" on server and client alike (no hydration mismatch); a tap on a browser without
  // getUserMedia (plain HTTP, very old Safari) switches to browser speech or typing.
  const [engine, setEngine] = useState<VoiceEngine>("muse");
  const [notice, setNotice] = useState<VoiceNotice>(null);
  const [level, setLevel] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const statusRef = useRef<VoiceStatus>("idle");
  const cap = useRef<Capture | null>(null);
  const clip = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const setStatus = useCallback((s: VoiceStatus) => {
    statusRef.current = s;
    if (alive.current) setStatusState(s);
  }, []);

  // Browser speech, used only after the voice service says it is unavailable.
  const speech = useSpeech((text) => onTextRef.current(text));

  const upload = useCallback(
    async (bytes: Uint8Array<ArrayBuffer>) => {
      setStatus("transcribing");
      setNotice(null);
      setCanRetry(false);
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), UPLOAD_TIMEOUT_MS);
      let res: Response | null = null;
      try {
        const token = recallPlayerToken(code, me);
        res = await fetch(`/api/lobby/${encodeURIComponent(code)}/transcribe`, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/octet-stream", ...(token ? { "x-player-token": token } : {}) },
          body: bytes,
          signal: ac.signal,
        });
      } catch {
        res = null;
      } finally {
        clearTimeout(t);
      }
      if (!alive.current) return;
      const body = res ? ((await res.json().catch(() => null)) as { transcript?: string; fallback?: boolean } | null) : null;
      if (res?.ok && typeof body?.transcript === "string") {
        clip.current = null;
        const text = body.transcript.trim();
        if (!text) {
          setNotice("empty");
          setStatus("idle");
          return;
        }
        setStatus("done");
        onTextRef.current(text);
        return;
      }
      if (res?.status === 503 && body?.fallback) {
        clip.current = null;
        const next: VoiceEngine = speech.supported ? "browser" : "typed";
        setEngine(next);
        setNotice(next === "browser" ? "switchedBrowser" : "switchedTyped");
        setStatus("failed");
        return;
      }
      if (res?.status === 429) {
        clip.current = null;
        setIssue("limit");
        setStatus("failed");
        return;
      }
      if (res && (res.status === 409 || res.status === 403 || res.status === 413 || res.status === 400)) {
        // Calls closed, not signed in, or a clip the server will never take: nothing to retry.
        clip.current = null;
        setNotice("failed");
        setStatus("failed");
        return;
      }
      // Network error, timeout or a 5xx without fallback: keep the clip so Retry can resend it.
      setNotice("failed");
      setCanRetry(true);
      setStatus("failed");
    },
    [code, me, setStatus, speech.supported],
  );

  const stop = useCallback(() => {
    if (engine === "browser") {
      speech.stop();
      return;
    }
    clearTimeout(timer.current);
    const c = cap.current;
    cap.current = null;
    if (!c) return;
    const wasRecording = statusRef.current === "recording";
    const bytes = c.close();
    setLevel(0);
    setStoppedAt(Date.now());
    if (!wasRecording) {
      setStatus("idle");
      return;
    }
    if (bytes.byteLength < MIN_BYTES) {
      setNotice("short");
      setStatus("idle");
      return;
    }
    clip.current = bytes;
    void upload(bytes);
  }, [engine, speech, setStatus, upload]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  });

  // Call from the tap handler itself (not after an await): iOS only opens audio inside a user gesture.
  const toggle = useCallback(() => {
    if (engine === "typed" || issue === "limit") return;
    if (engine === "browser") {
      if (speech.status === "recording") speech.stop();
      else if (speech.status !== "transcribing") {
        setNotice(null);
        speech.start();
        clearTimeout(timer.current);
        timer.current = setTimeout(() => speech.stop(), MAX_S * 1000);
      }
      return;
    }
    const s = statusRef.current;
    if (s === "recording") {
      stop();
      return;
    }
    if (s === "starting" || s === "transcribing") return;
    const Ctx = audioContextCtor();
    if (!Ctx || typeof navigator.mediaDevices?.getUserMedia !== "function") {
      setEngine(speech.supported ? "browser" : "typed");
      return;
    }
    setNotice(null);
    setIssue(null);
    setCanRetry(false);
    clip.current = null;
    let c: Capture;
    try {
      c = new Capture(Ctx, {
        onLevel: (l) => alive.current && setLevel(l),
        onEnd: () => stopRef.current(),
      });
    } catch {
      setEngine(speech.supported ? "browser" : "typed");
      return;
    }
    cap.current = c;
    setStatus("starting");
    c.open().then(
      () => {
        if (cap.current !== c) return; // stopped or unmounted while the permission prompt was up
        setStartedAt(Date.now());
        setStatus("recording");
        timer.current = setTimeout(() => stopRef.current(), MAX_S * 1000 + 500); // backup for the 30 s cap
      },
      (e) => {
        if (cap.current === c) cap.current = null;
        c.close();
        setIssue(micErrorIssue(e));
        setStatus("idle");
      },
    );
  }, [engine, issue, speech, stop, setStatus]);

  const retry = useCallback(() => {
    if (clip.current && statusRef.current === "failed") void upload(clip.current);
  }, [upload]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
      cap.current?.close();
      cap.current = null;
    };
  }, []);

  // One shape for both recognisers.
  if (engine === "browser") {
    const s = speech.status;
    const unified: VoiceStatus = s === "recording" ? "recording" : s === "transcribing" ? "transcribing" : s === "done" ? "done" : "idle";
    const down = s === "unsupported" || s === "error";
    return {
      status: unified,
      issue: s === "denied" ? ("denied" as const) : s === "no_mic" ? ("no_mic" as const) : issue,
      engine: down ? ("typed" as const) : engine,
      notice: down ? ("switchedTyped" as const) : notice,
      level: speech.level,
      startedAt: speech.startedAt,
      stoppedAt: speech.releasedAt,
      interim: speech.interim,
      canRetry: false,
      toggle,
      stop,
      retry,
    };
  }
  return { status, issue, engine, notice, level, startedAt, stoppedAt, interim: "", canRetry, toggle, stop, retry };
}
