"use client";
// Push-to-talk with the browser Web Speech API (webkitSpeechRecognition, en-US, interim results),
// plus a 12-segment level meter from the mic stream.
import { useCallback, useEffect, useRef, useState } from "react";

export type SpeechStatus = "idle" | "recording" | "transcribing" | "done" | "denied" | "no_mic" | "unsupported" | "error";

interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function getCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const METER_SEGMENTS = 12;

export function useSpeech(onFinal: (text: string) => void) {
  const [status, setStatus] = useState<SpeechStatus>("idle");
  const [interim, setInterim] = useState("");
  const [level, setLevel] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [releasedAt, setReleasedAt] = useState<number | null>(null);
  const rec = useRef<Recognition | null>(null);
  const finalText = useRef("");
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const raf = useRef<number>(0);
  const onFinalRef = useRef(onFinal);
  const statusRef = useRef<SpeechStatus>("idle");
  // Latest interim text, used on end when no final result arrived.
  const interimTextRef = useRef("");

  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const set = (s: SpeechStatus) => {
    statusRef.current = s;
    setStatus(s);
  };

  const supported = getCtor() !== null;

  const stopMeter = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    audio.current?.close().catch(() => {});
    audio.current = null;
    setLevel(0);
  }, []);

  const startMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (statusRef.current !== "recording") {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = s;
      const ctx = new AudioContext();
      audio.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(METER_SEGMENTS, Math.round(rms * 40)));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      const name = (e as DOMException).name;
      if (name === "NotAllowedError") set("denied");
      else if (name === "NotFoundError") set("no_mic");
    }
  }, []);

  const start = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) {
      set("unsupported");
      return;
    }
    if (statusRef.current === "recording") return;
    finalText.current = "";
    interimTextRef.current = "";
    setInterim("");
    setReleasedAt(null);
    const r = new Ctor();
    r.lang = "en-US";
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText.current += res[0].transcript;
        else interimText += res[0].transcript;
      }
      const shown = (finalText.current + " " + interimText).trim();
      interimTextRef.current = shown;
      setInterim(shown);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") set("denied");
      else if (e.error === "audio-capture") set("no_mic");
      else if (e.error !== "no-speech" && e.error !== "aborted") set("error");
    };
    r.onend = () => {
      stopMeter();
      rec.current = null;
      if (statusRef.current === "recording" || statusRef.current === "transcribing") {
        const text = finalText.current.trim() || interimTextRef.current.trim();
        set("done");
        if (text) onFinalRef.current(text);
      }
    };
    rec.current = r;
    set("recording");
    setStartedAt(Date.now());
    try {
      r.start();
    } catch {
      set("error");
      return;
    }
    void startMeter();
  }, [startMeter, stopMeter]);

  const stop = useCallback(() => {
    if (statusRef.current !== "recording") return;
    set("transcribing");
    setReleasedAt(Date.now());
    stopMeter();
    try {
      rec.current?.stop();
    } catch {
      set("done");
    }
  }, [stopMeter]);

  useEffect(
    () => () => {
      rec.current?.abort();
      stopMeter();
    },
    [stopMeter],
  );

  return { status, interim, level, startedAt, releasedAt, start, stop, supported };
}
