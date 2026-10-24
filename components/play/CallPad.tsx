"use client";
// The call screen. The page becomes the player's team-colour field: countdown, question, the rejoin line and
// telemetry scroll above three full-width bands in the thumb zone: Stay out, Box, tap to say why (+ Type, Send).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { COPY, VOICE_COPY } from "@/lib/copy";
import { api, type BlindDecision } from "@/lib/client/api";
import { recallResult } from "@/lib/client/identity";
import { CALL_WINDOW_S, VOICE_NOTE_MAX_S, tla } from "@/lib/client/race";
import { submitCall, submitErrorText } from "@/lib/client/session";
import { buzzFreeze } from "@/lib/client/cue";
import { fieldStyle, teamColourOf } from "@/lib/client/field";
import type { DataMode } from "@/lib/client/mode";
import { METER_SEGMENTS, useVoiceNote } from "@/lib/client/recorder";
import type { Call, LapFrame } from "@/lib/types";
import { RejoinCaveat, RejoinSentence, getBrief } from "../DecisionBrief";
import { FieldTyres, IntervalTable, LapChart, NeighbourList, Note, UndercutClock, PitLoss, RejoinStrip, Sec, StintTable, intervalNote, simpleChartLabel } from "../Telemetry";
import { Check, ErrorText, MicGlyph, ModeToggle, TrackStrip, clockText } from "../ui";

const SLOW_MS = 4000;
// At 0 s a note still recording or transcribing gets this long before the call goes in (the server keeps
// calls open 2 s into the reveal).
// The host reveals 1.5 s after 0 s and the pad unmounts then, so the 0 s send must go out well inside that.
const AUTO_SEND_WAIT_MS = 600;
// A voice note still recording this close to the end is stopped, so its transcript lands before 0 s.
const VOICE_CUTOFF_S = 5;

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
  const [noteShown, setNoteShown] = useState(false); // a transcript opened the field (no autofocus: no keyboard pop)
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState<{ call: Call | null; t: number } | null>(() => {
    const r = recallResult(code, decision.id);
    return r ? { call: r.submission.call, t: r.submission.seconds_to_call } : null;
  });
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSent = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());

  const left = Math.max(0, Math.ceil(CALL_WINDOW_S - elapsed / 1000));
  const urgent = left <= 5 && left > 0;
  useEffect(() => {
    buzzFreeze();
  }, []);
  const alreadyIn = submittedNames.includes(me);

  // Tap to start, tap to stop (30 s cap). The transcript lands in the typed field, open and editable before Send.
  const voice = useVoiceNote({
    code,
    me,
    onText: async (text) => {
      setWhy(text);
      setNoteShown(true);
      try {
        const parsed = await api.parse(text);
        if (parsed.call) {
          setCall(parsed.call);
          setNote(COPY.freeze.parsed(parsed.call, text));
        } else setNote(VOICE_COPY.unclear);
      } catch {
        setNote(VOICE_COPY.editHint);
      }
    },
  });
  const busy = voice.status === "starting" || voice.status === "recording" || voice.status === "transcribing";

  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [busy]);

  const micNote =
    voice.issue === "denied"
      ? COPY.error.micDeniedShort
      : voice.issue === "no_mic"
        ? COPY.error.noMic
        : voice.issue === "busy"
          ? VOICE_COPY.busy
          : voice.issue === "limit"
            ? VOICE_COPY.limit
            : voice.engine === "typed"
              ? COPY.error.bothDown
              : null;
  const voiceNotice =
    voice.notice === "short"
      ? VOICE_COPY.short
      : voice.notice === "empty"
        ? VOICE_COPY.empty
        : voice.notice === "failed"
          ? VOICE_COPY.failed
          : voice.notice === "switchedBrowser"
            ? VOICE_COPY.switchedBrowser
            : null;
  const micDown = voice.issue === "denied" || voice.issue === "no_mic" || voice.issue === "limit" || voice.engine === "typed";
  // When the mic is out, open the typed field and focus it.
  const showTyping = typing || noteShown || micDown;
  useEffect(() => {
    if (micNote) inputRef.current?.focus();
  }, [micNote]);

  // Latest send (reads the latest reason), for the delayed auto-send at 0 s.
  const sendRef = useRef<(final?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    sendRef.current = send;
  });

  async function send(final = false) {
    clearTimeout(autoTimer.current);
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

  // At 0 s whatever is on the pad goes in; with no call the row records "No call". A voice note still being
  // recorded is stopped (which uploads it) and the call goes in as soon as the transcript lands, or after
  // AUTO_SEND_WAIT_MS, whichever comes first.
  const awaitingNote = useRef(false);
  useEffect(() => {
    if (left > 0 && left <= VOICE_CUTOFF_S && voice.status === "recording") voice.stop();
  });
  useEffect(() => {
    if (left === 0 && !locked && !alreadyIn && !autoSent.current) {
      autoSent.current = true;
      if (voice.status === "recording" || voice.status === "starting") voice.stop();
      const waiting = voice.status === "recording" || voice.status === "transcribing";
      awaitingNote.current = waiting;
      // Not cleared on re-render (the countdown re-renders every 200 ms); only on send or unmount.
      autoTimer.current = setTimeout(() => void sendRef.current(true), waiting ? AUTO_SEND_WAIT_MS : 0);
    }
  });
  useEffect(() => {
    if (awaitingNote.current && voice.status !== "recording" && voice.status !== "transcribing") {
      awaitingNote.current = false;
      void sendRef.current(true);
    }
  });
  // If the pad unmounts (phase flipped to reveal) with the 0 s send still pending, send now: the request
  // outlives the unmount and the server still accepts it during its short grace.
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = !!locked || alreadyIn;
  });
  useEffect(
    () => () => {
      if (autoTimer.current !== undefined && autoSent.current && !lockedRef.current) {
        clearTimeout(autoTimer.current);
        void sendRef.current(true);
      } else {
        clearTimeout(autoTimer.current);
      }
    },
    [],
  );

  const recording = voice.status === "recording";
  // Live while recording; afterwards the length of the last clip.
  const talkMs = !voice.startedAt
    ? 0
    : recording
      ? Math.max(0, now - voice.startedAt)
      : voice.stoppedAt && voice.stoppedAt > voice.startedAt
        ? voice.stoppedAt - voice.startedAt
        : 0;
  const recSecs = Math.min(VOICE_NOTE_MAX_S, Math.floor(talkMs / 1000));
  const hasNote = voice.status === "done" && !!why.trim();
  const slow = voice.status === "transcribing" && voice.stoppedAt != null && now - voice.stoppedAt > SLOW_MS;

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
      : voice.status === "starting"
      ? VOICE_COPY.starting
      : recording
      ? voice.interim
        ? `"${voice.interim}"`
        : VOICE_COPY.recording
      : voice.status === "transcribing"
        ? slow
          ? COPY.freeze.slow
          : VOICE_COPY.transcribing
        : (micNote ?? voiceNotice ?? note)) ?? null;

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
            {err ? (
              <ErrorText>{err}</ErrorText>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="line-clamp-2">{helper}</p>
                {voice.canRetry && !busy && (
                  <button type="button" onClick={voice.retry} className="shrink-0 border-b-2 border-current font-black">
                    {VOICE_COPY.retry}
                  </button>
                )}
              </div>
            )}
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
          {/* A plain click: iOS opens audio only inside a tap, so toggle() must run in this handler. */}
          <button
            type="button"
            onClick={voice.toggle}
            onContextMenu={(e) => e.preventDefault()}
            disabled={left === 0 || micDown || voice.status === "starting" || voice.status === "transcribing"}
            aria-pressed={recording}
            aria-busy={voice.status === "transcribing" || undefined}
            className="flex min-w-0 flex-1 select-none items-center gap-3 pl-5 pr-2 text-left [-webkit-touch-callout:none] disabled:text-white/50"
          >
            {recording ? <span className="rec-dot size-3 shrink-0 rounded-full bg-white" aria-hidden /> : <MicGlyph className="shrink-0" />}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[1.0625rem] font-bold">
                {recording ? VOICE_COPY.stop : voice.status === "starting" ? VOICE_COPY.starting : voice.status === "transcribing" ? VOICE_COPY.transcribingShort : hasNote ? VOICE_COPY.again : VOICE_COPY.tap}
              </span>
              <span className="mt-1 flex items-center gap-2">
                {recording && (
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length: METER_SEGMENTS }, (_, i) => (
                      <span key={i} className={`h-2 w-2 ${i < voice.level ? "bg-white" : "bg-white/25"}`} />
                    ))}
                  </span>
                )}
                <span className="nums text-xs text-white/75">
                  {clockText(recSecs)} / {clockText(VOICE_NOTE_MAX_S)}
                </span>
              </span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setTyping(!showTyping);
              setNoteShown(false);
            }}
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
