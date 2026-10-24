"use client";
// Freeze screen on the phone: countdown, hold-to-talk (Web Speech API), and the typed fallback, always visible.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api, type BlindDecision } from "@/lib/client/api";
import { recallPlayerToken, recallResult, rememberResult } from "@/lib/client/identity";
import { CALL_WINDOW_S, VOICE_NOTE_MAX_S } from "@/lib/client/race";
import { buzzFreeze } from "@/lib/client/cue";
import { METER_SEGMENTS, useSpeech } from "@/lib/client/useSpeech";
import type { Call } from "@/lib/types";
import { Button } from "../ui";

const SLOW_MS = 4000;

function MicGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

export function CallPad({
  code,
  me,
  decision,
  elapsed,
  players,
  submittedNames,
  situation,
  details,
}: {
  code: string;
  me: string;
  decision: BlindDecision;
  elapsed: number;
  players: number;
  submittedNames: string[];
  // Position, gap, tyres and track state for the current data mode (components/play/Situation.tsx).
  situation?: React.ReactNode;
  details?: React.ReactNode;
}) {
  const [call, setCall] = useState<Call | null>(null);
  const [why, setWhy] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState<{ call: Call | null; t: number } | null>(() => {
    const r = recallResult(code, decision.id);
    return r ? { call: r.submission.call, t: r.submission.seconds_to_call } : null;
  });
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSent = useRef(false);
  const [now, setNow] = useState(() => Date.now());

  const left = Math.max(0, Math.ceil(CALL_WINDOW_S - elapsed / 1000));
  // Buzz once when the freeze lands (skipped under reduced motion).
  useEffect(() => {
    buzzFreeze();
  }, []);
  const alreadyIn = submittedNames.includes(me);

  const speech = useSpeech(async (text) => {
    setWhy(text);
    try {
      const parsed = await api.parse(text);
      if (parsed.call) {
        setCall(parsed.call);
        setNote(COPY.freeze.parsed(parsed.call, text));
      } else setNote(COPY.freeze.unclear);
    } catch {
      setNote(null);
    }
  });

  // Ticks the REC clock and the slow-transcription check.
  useEffect(() => {
    if (speech.status !== "recording" && speech.status !== "transcribing") return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [speech.status]);

  const micNote =
    speech.status === "denied"
      ? COPY.error.micDeniedShort
      : speech.status === "no_mic"
        ? COPY.error.noMic
        : speech.status === "unsupported" || speech.status === "error"
          ? COPY.error.bothDown
          : null;
  useEffect(() => {
    if (micNote) inputRef.current?.focus();
  }, [micNote]);

  async function send(final = false) {
    if (locked || sending) return;
    if (!call && !final) {
      setErr(COPY.freeze.pickCall);
      return;
    }
    setErr(null);
    setSending(true);
    const text = why.trim();
    const word = call ? COPY.freeze.options[call] : "";
    const transcript = call && !text.toLowerCase().startsWith(word.toLowerCase()) ? `${word}. ${text}`.trim() : text;
    const seconds = Math.min(CALL_WINDOW_S, Math.max(0, elapsed / 1000));
    try {
      const r = await api.submit(
        code,
        { player_name: me, transcript, seconds_to_call: Math.round(seconds * 10) / 10, call },
        recallPlayerToken(code, me),
      );
      rememberResult(code, decision.id, r);
      setLocked({ call: r.submission.call ?? call, t: r.submission.seconds_to_call });
    } catch (e) {
      setErr(
        e instanceof ApiError && e.status === 403
          ? COPY.error.notYou(me)
          : e instanceof ApiError && e.status === 429
            ? COPY.error.rateLimited(e.retryAfter)
            : COPY.error.connectionLost,
      );
    } finally {
      setSending(false);
    }
  }

  // At 0 s, whatever is on the pad goes in; with no call the row records NO CALL.
  useEffect(() => {
    if (left === 0 && !locked && !alreadyIn && !autoSent.current) {
      autoSent.current = true;
      void send(true);
    }
  });

  // One voice note per call: stop at the cap, and when the window closes.
  const recordingNow = speech.status === "recording";
  const talkMs = speech.startedAt && recordingNow ? now - speech.startedAt : 0;
  useEffect(() => {
    if (recordingNow && (talkMs >= VOICE_NOTE_MAX_S * 1000 || left === 0)) speech.stop();
  }, [recordingNow, talkMs, left, speech]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  const recording = speech.status === "recording";
  const recSecs = Math.min(VOICE_NOTE_MAX_S, Math.floor(talkMs / 1000));
  // A finished note can be replaced while the window is open.
  const hasNote = speech.status === "done" && !!why.trim();
  const slow = speech.status === "transcribing" && speech.releasedAt != null && now - speech.releasedAt > SLOW_MS;

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (down && !e.repeat) speech.start();
    if (!down) speech.stop();
  };

  const countdown = (
    <div
      className={`relative flex h-24 items-center justify-between gap-6 px-4 text-bg transition-colors duration-200 ${left <= 5 ? "bg-flag-red" : "on-yellow bg-flag-yellow"}`}
    >
      <span className="nums text-24 font-extrabold uppercase stretch-125 leading-hero">{decision.trigger} · L{decision.lap}</span>
      <span key={left <= 5 ? left : "n"} className={`nums w-[120px] shrink-0 text-right text-72 font-extrabold stretch-125 leading-hero ${left <= 5 && left > 0 ? "tick-pulse" : ""}`} aria-live="polite">
        {left}
      </span>
      <span
        className="countdown-bar absolute inset-x-0 bottom-0 h-2 bg-bg"
        style={{ animationDuration: `${CALL_WINDOW_S}s`, animationDelay: `-${elapsed / 1000}s` }}
      />
    </div>
  );

  if (locked || alreadyIn) {
    const waitingOn = Math.max(0, players - submittedNames.length);
    return (
      <section className="flex flex-col gap-6">
        {countdown}
        <p className="text-32 font-extrabold uppercase stretch-125 leading-hero">
          {locked?.call ? COPY.freeze.locked(locked.call, locked.t) : locked ? COPY.freeze.noCall : COPY.freeze.timeUp}
        </p>
        {why && <q className="text-20 text-ink-2">{why}</q>}
        <p className="nums text-20 text-ink-2">{left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(waitingOn)}</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      {countdown}
      {left <= 5 && left > 0 && <p className="text-20 font-semibold text-flag-red">{COPY.freeze.fiveLeft}</p>}
      {situation}
      <h1 className="text-32 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.freeze.question}</h1>

      <button
        type="button"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          speech.start();
        }}
        onPointerUp={() => speech.stop()}
        onPointerCancel={() => speech.stop()}
        onKeyDown={onKey(true)}
        onKeyUp={onKey(false)}
        onContextMenu={(e) => e.preventDefault()}
        disabled={left === 0 || speech.status === "denied" || speech.status === "unsupported" || speech.status === "no_mic"}
        className={`flex h-40 w-full touch-none select-none flex-col items-center justify-center gap-3 rounded-ctl text-32 font-extrabold uppercase stretch-125 disabled:bg-surface-2 disabled:text-ink-disabled ${
          recording ? "bg-flag-red text-bg" : "bg-ink text-bg hover:bg-ink-2"
        }`}
        aria-pressed={recording}
      >
        <MicGlyph />
        {recording ? (
          <>
            <span className="nums">{COPY.freeze.rec(recSecs, VOICE_NOTE_MAX_S)}</span>
            <span className="flex gap-1" aria-hidden>
              {Array.from({ length: METER_SEGMENTS }, (_, i) => (
                <span key={i} className={`h-4 w-3 ${i < speech.level ? "bg-bg" : "bg-bg/30"}`} />
              ))}
            </span>
          </>
        ) : (
          <span>{hasNote ? COPY.freeze.reRecord : COPY.freeze.ptt}</span>
        )}
      </button>

      <p className="min-h-7 text-20 text-ink-2" aria-live="polite">
        {recording
          ? speech.interim
            ? `"${speech.interim}"`
            : COPY.freeze.recording
          : speech.status === "transcribing"
            ? slow
              ? COPY.freeze.slow
              : COPY.freeze.released
            : (micNote ?? note ?? COPY.freeze.noteCap(VOICE_NOTE_MAX_S))}
      </p>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={COPY.freeze.question}>
          {(["BOX", "STAY"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCall(c)}
              aria-pressed={call === c}
              className={`h-[72px] whitespace-nowrap rounded-ctl px-2 text-32 font-extrabold uppercase stretch-75 transition-colors duration-[120ms] ${
                call === c ? "border-2 border-ink bg-ink text-bg" : "border border-rule bg-surface text-ink hover:bg-surface-2"
              }`}
            >
              {COPY.freeze.options[c]}
            </button>
          ))}
        </div>
        <label htmlFor="why" className="text-14 font-semibold uppercase tracking-label text-ink-3">
          {COPY.freeze.typedLabel}
        </label>
        <input
          id="why"
          ref={inputRef}
          value={why}
          onChange={(e) => setWhy(e.target.value)}
          placeholder={COPY.freeze.typedPlaceholder}
          maxLength={400}
          enterKeyHint="send"
          className="h-14 w-full rounded-ctl border border-rule bg-surface px-4 text-20 text-ink placeholder:text-ink-3 hover:bg-surface-2"
        />
        <Button type="submit" className="h-14 text-20" busy={sending} busyLabel={COPY.freeze.sending}>
          {COPY.freeze.submit}
        </Button>
        {err && (
          <p className="text-20 text-flag-red" role="alert">
            {err}
          </p>
        )}
      </form>
      {details}
    </section>
  );
}
