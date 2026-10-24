"use client";
// The call screen. The page becomes the player's team-colour field: countdown, question, the rejoin line and
// telemetry scroll above three full-width bands in the thumb zone: Stay out, Box, hold to say why (+ Type, Send).
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { COPY } from "@/lib/copy";
import { api, type BlindDecision } from "@/lib/client/api";
import { recallResult } from "@/lib/client/identity";
import { CALL_WINDOW_S, VOICE_NOTE_MAX_S, tla } from "@/lib/client/race";
import { submitCall, submitErrorText } from "@/lib/client/session";
import { buzzFreeze } from "@/lib/client/cue";
import { fieldStyle, teamColourOf } from "@/lib/client/field";
import type { DataMode } from "@/lib/client/mode";
import { METER_SEGMENTS, useSpeech } from "@/lib/client/useSpeech";
import type { Call, LapFrame } from "@/lib/types";
import { RejoinCaveat, RejoinSentence, getBrief } from "../DecisionBrief";
import { FieldTyres, IntervalTable, LapChart, NeighbourList, Note, UndercutClock, PitLoss, RejoinStrip, Sec, StintTable, intervalNote, simpleChartLabel } from "../Telemetry";
import { Check, ErrorText, MicGlyph, ModeToggle, TrackStrip, clockText } from "../ui";

const SLOW_MS = 4000;

export function CallPad({
  code,
  me,
  decision,
  frames,
  elapsed,
  players,
  submittedNames,
  mode,
  setMode,
}: {
  code: string;
  me: string;
  decision: BlindDecision;
  frames: LapFrame[] | null;
  elapsed: number;
  players: string[];
  submittedNames: string[];
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const [call, setCall] = useState<Call | null>(null);
  const [why, setWhy] = useState("");
  const [typing, setTyping] = useState(false);
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
  const urgent = left <= 5 && left > 0;
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
  const micDown = speech.status === "denied" || speech.status === "unsupported" || speech.status === "no_mic";
  // When the mic is out, open the typed field and focus it.
  const showTyping = typing || micDown;
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
      const r = await submitCall(code, decision.id, { player_name: me, transcript, seconds_to_call: Math.round(seconds * 10) / 10, call });
      setLocked({ call: r.submission.call ?? call, t: r.submission.seconds_to_call });
    } catch (e) {
      setErr(submitErrorText(e, me));
    } finally {
      setSending(false);
    }
  }

  // At 0 s whatever is on the pad goes in; with no call the row records "No call".
  useEffect(() => {
    if (left === 0 && !locked && !alreadyIn && !autoSent.current) {
      autoSent.current = true;
      void send(true);
    }
  });

  const recording = speech.status === "recording";
  const talkMs = speech.startedAt && recording ? now - speech.startedAt : 0;
  useEffect(() => {
    if (recording && (talkMs >= VOICE_NOTE_MAX_S * 1000 || left === 0)) speech.stop();
  }, [recording, talkMs, left, speech]);

  const recSecs = Math.min(VOICE_NOTE_MAX_S, Math.floor(talkMs / 1000));
  const hasNote = speech.status === "done" && !!why.trim();
  const slow = speech.status === "transcribing" && speech.releasedAt != null && now - speech.releasedAt > SLOW_MS;

  const onKey = (down: boolean) => (e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    if (down && !e.repeat) speech.start();
    if (!down) speech.stop();
  };

  const brief = frames ? getBrief(decision, frames) : null;
  const team = teamColourOf(frames, decision.player_role.number);
  const myCode = brief?.frame?.drivers.find((d) => d.number === decision.player_role.number)?.code ?? "";
  const pos = brief?.ctx?.pos;
  const adv = mode === "advanced";

  const status = (
    <header className="flex h-[52px] shrink-0 items-center justify-between gap-3 px-5">
      <span className="meta text-[13px]">{COPY.phone.status(decision.trigger, decision.lap, decision.total_laps)}</span>
      <span className="meta text-[13px]">
        {tla(me)}
        {myCode && pos ? ` · ${myCode} P${pos}` : ""}
      </span>
    </header>
  );

  const countdown = (
    <span
      key={urgent ? left : "n"}
      className={`nums inline-block font-bold leading-none tracking-[-0.04em] ${mode === "advanced" ? "text-[3.5rem]" : "text-[4.75rem]"} ${urgent ? "tick bg-on-field px-2 text-field" : ""}`}
      aria-live="polite"
      aria-label={`${left} s`}
    >
      {clockText(left)}
    </span>
  );

  const helper =
    (sending
      ? COPY.freeze.sending
      : recording
      ? speech.interim
        ? `"${speech.interim}"`
        : COPY.freeze.recording
      : speech.status === "transcribing"
        ? slow
          ? COPY.freeze.slow
          : COPY.freeze.released
        : (micNote ?? note)) ?? null;

  if (locked || alreadyIn) {
    const waitingOn = Math.max(0, players.length - submittedNames.length);
    return (
      <main style={fieldStyle(team)} className="flood mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-field text-on-field">
        {brief?.frame && <TrackStrip status={brief.frame.track_status} />}
        {status}
        <div className="flex flex-1 flex-col px-5 pt-6">
          {countdown}
          <h1 className="display mt-6 text-3xl">
            {locked?.call ? COPY.phone.lockedTitle(locked.call) : locked ? COPY.freeze.noCall : COPY.freeze.timeUp}
          </h1>
          {locked?.call && <p className="nums mt-3 text-lg font-bold">{COPY.phone.lockedAt(locked.t)}</p>}
          {why && <q className="mt-5 text-lg leading-snug">{why}</q>}
        </div>
        <div className="on-dark bg-ink px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 text-white">
          <p className="nums text-lg font-bold">{left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(waitingOn)}</p>
          <ol className="mt-3 flex flex-wrap gap-1.5">
            {players.map((p) => {
              const inn = submittedNames.includes(p);
              return (
                <li key={p} className={`inline-flex h-8 items-center px-2 text-sm font-black ${inn ? "bg-white text-ink" : "border border-dashed border-white/60"}`}>
                  {tla(p)}
                </li>
              );
            })}
          </ol>
        </div>
      </main>
    );
  }

  const band = (c: Call) => {
    const on = call === c;
    const other = call !== null && !on;
    const base = c === "STAY" ? "bg-white text-ink" : "on-dark bg-ink text-white";
    const sub = c === "STAY" ? (pos ? COPY.phone.keep(pos) : "") : brief?.rejoin ? COPY.phone.out(brief.rejoin.pos) : "";
    return (
      <button
        key={c}
        type="button"
        onClick={() => {
          setCall(c);
          setErr(null);
        }}
        aria-pressed={on}
        className={`flex h-[5.25rem] w-full items-center justify-between px-6 text-left transition-[background-color,color,opacity] duration-150 ${
          other ? "bg-soft text-ink-2" : base
        } ${c === "BOX" ? "border-t border-white/10" : ""}`}
      >
        <span className="text-[1.75rem] font-black tracking-[-0.02em]">{COPY.freeze.options[c]}</span>
        <span className="flex items-center gap-2 font-mono text-[13px] font-medium">
          {on ? (
            <>
              <Check />
              {COPY.phone.selected}
            </>
          ) : (
            sub
          )}
        </span>
      </button>
    );
  };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  return (
    <main style={fieldStyle(team)} className="flood mx-auto flex h-dvh w-full max-w-[480px] flex-col bg-field text-on-field">
      {brief?.frame && <TrackStrip status={brief.frame.track_status} />}
      {status}
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        <div className="flex items-end justify-between gap-3 pt-1">
          {countdown}
          <div className="mb-2.5">
            <ModeToggle mode={mode} onChange={setMode} size="sm" onField />
          </div>
        </div>
        <h1 className={`display ${adv ? "mt-2 text-[1.875rem]" : "mt-3 text-[2.625rem] leading-[0.95]"}`}>{COPY.freeze.question}</h1>
        {brief && !adv && <RejoinSentence brief={brief} className="mt-3 text-[1.1875rem] leading-[1.3]" />}
        {brief?.tele && !adv && (
          <div className="mt-4 border-t-2 border-current pt-2.5">
            <div className="meta">{simpleChartLabel(brief.tele)}</div>
            <div className="mt-2">
              <LapChart laps={brief.tele.laps} cars={[brief.tele.me, brief.tele.ahead, brief.tele.behind]} height={124} status={brief.tele.status} />
            </div>
            <div className="mt-3">
              <NeighbourList t={brief.tele} />
            </div>
            <div className="mt-4">
              <UndercutClock t={brief.tele} mode={mode} />
            </div>
          </div>
        )}
        {brief?.tele && adv && (
          <div className="mt-3.5 flex flex-col">
            <Sec label={COPY.tele.stintLapTimes} meta={COPY.tele.lapRange(brief.tele.stintLaps[0] ?? 1, brief.tele.stintLaps[brief.tele.stintLaps.length - 1] ?? 1)}>
              <LapChart laps={brief.tele.stintLaps} cars={[brief.tele.stint.me, brief.tele.stint.ahead, brief.tele.stint.behind]} height={124} axis values={false} status={brief.tele.status} />
            </Sec>
            <div className="pb-4">
              <NeighbourList t={brief.tele} />
            </div>
            <UndercutClock t={brief.tele} mode={mode} />
            <Sec label={COPY.tele.intervals} meta={COPY.tele.intervalsMeta}>
              <IntervalTable t={brief.tele} />
              <Note>{intervalNote(brief.tele)}</Note>
            </Sec>
            <Sec label={COPY.tele.fieldTyres} meta={COPY.tele.fieldMeta(brief.tele.compounds.length, brief.adv?.median ?? null)}>
              <FieldTyres t={brief.tele} me={decision.player_role.number} />
            </Sec>
            {brief.loss && (
              <Sec label={COPY.tele.pitLoss} meta={COPY.tele.pitMeta}>
                <PitLoss under={brief.loss.under} normal={brief.loss.normal} trigger={decision.trigger} />
              </Sec>
            )}
            <Sec label={COPY.tele.stint} meta={COPY.tele.stintMeta(myCode, decision.player_role.number)}>
              <StintTable t={brief.tele} normal={decision.pit_loss?.normal_s ?? null} />
            </Sec>
            {brief.frame && (
              <Sec label={COPY.tele.rejoinTitle} meta={COPY.tele.rejoinMeta}>
                <RejoinStrip t={brief.tele} frameCars={brief.frame.drivers.filter((d) => d.number !== decision.player_role.number).map((d) => ({ code: d.code, gap: d.gap_to_leader_s, number: d.number }))} />
              </Sec>
            )}
          </div>
        )}
        {brief?.rejoin && <RejoinCaveat frame={brief.frame} lap={decision.lap} className="mt-2 text-xs font-medium" />}
      </div>

      <form onSubmit={onSubmit} className="shrink-0" noValidate>
        {(helper || err) && (
          <div className="bg-field px-5 pb-2 pt-1 text-sm font-bold" aria-live="polite">
            {err ? <ErrorText>{err}</ErrorText> : <p className="line-clamp-2">{helper}</p>}
          </div>
        )}
        {showTyping && (
          <div className="flex items-center gap-3 bg-white px-5 py-2 text-ink">
            <label htmlFor="why" className="sr-only">
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
              autoFocus={typing}
              className="h-12 min-w-0 flex-1 border-b-2 border-ink bg-transparent text-base font-bold outline-none"
            />
          </div>
        )}
        <div role="group" aria-label={COPY.freeze.question}>
          {band("STAY")}
          {band("BOX")}
        </div>
        <div className="on-dark relative flex h-24 items-stretch border-t border-white/15 bg-ink pb-[env(safe-area-inset-bottom)] text-white">
          {recording && <div className="absolute inset-x-0 top-0 h-1 bg-field transition-[width] duration-200" style={{ width: `${(talkMs / (VOICE_NOTE_MAX_S * 1000)) * 100}%` }} aria-hidden />}
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
            disabled={left === 0 || micDown}
            aria-pressed={recording}
            className="flex min-w-0 flex-1 touch-none select-none items-center gap-3 pl-5 pr-2 text-left disabled:text-white/50"
          >
            {recording ? <span className="rec-dot size-3 shrink-0 rounded-full bg-white" aria-hidden /> : <MicGlyph className="shrink-0" />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[1.0625rem] font-bold">{recording ? COPY.phone.release : hasNote ? COPY.freeze.reRecord : COPY.phone.holdWhy}</span>
              {recording ? (
                <span className="mt-1 flex gap-0.5" aria-hidden>
                  {Array.from({ length: METER_SEGMENTS }, (_, i) => (
                    <span key={i} className={`h-2 w-2 ${i < speech.level ? "bg-white" : "bg-white/25"}`} />
                  ))}
                </span>
              ) : (
                <span className="nums text-xs text-white/75">{clockText(recSecs)} / {clockText(VOICE_NOTE_MAX_S)}</span>
              )}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTyping((v) => !v)}
            aria-expanded={showTyping}
            aria-controls="why"
            className="w-[4.25rem] shrink-0 border-l border-white/15 text-sm font-bold hover:bg-white/10"
          >
            {showTyping && !micDown ? COPY.phone.hideTyping : COPY.phone.typeInstead}
          </button>
          <button
            type="submit"
            disabled={sending || !call}
            aria-busy={sending || undefined}
            className="w-[5.5rem] shrink-0 bg-field text-base font-black text-on-field transition-opacity duration-150 disabled:bg-white/10 disabled:text-white/50"
          >
            {COPY.phone.send}
          </button>
        </div>
      </form>
    </main>
  );
}
