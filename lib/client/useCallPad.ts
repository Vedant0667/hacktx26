"use client";
// The call pad's logic, moved verbatim out of components/play/CallPad.tsx so the legacy pad and the Race Night
// pad (components/rn/call/**) share one implementation: state, refs, effects (same order, same deps), the voice
// note, send / queued send / 0 s auto-send / unmount send, and the derived values the JSX reads.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { COPY, VOICE_COPY } from "@/lib/copy";
import { api, type BlindDecision } from "@/lib/client/api";
import { recallResult } from "@/lib/client/identity";
import { CALL_WINDOW_S, VOICE_NOTE_MAX_S } from "@/lib/client/race";
import { submitCall, submitErrorText } from "@/lib/client/session";
import { buzzFreeze } from "@/lib/client/cue";
import { teamColourOf } from "@/lib/client/field";
import type { DataMode } from "@/lib/client/mode";
import { useVoiceNote } from "@/lib/client/recorder";
import type { Call, LapFrame } from "@/lib/types";
import { getBrief } from "@/components/DecisionBrief";

const SLOW_MS = 4000;
// At 0 s a note still recording or transcribing gets this long before the call goes in (the server keeps
// calls open 2 s into the reveal).
// The host reveals 1.5 s after 0 s and the pad unmounts then, so the 0 s send must go out well inside that.
const AUTO_SEND_WAIT_MS = 600;
// A voice note still recording this close to the end is stopped, so its transcript lands before 0 s.
const VOICE_CUTOFF_S = 5;

export interface CallPadProps {
  code: string;
  me: string;
  decision: BlindDecision;
  frames: LapFrame[] | null;
  elapsed: number;
  players: string[];
  submittedNames: string[];
  mode: DataMode;
  setMode: (m: DataMode) => void;
}

export function useCallPad({ code, me, decision, frames, elapsed, submittedNames, mode }: CallPadProps) {
  const [call, setCall] = useState<Call | null>(null);
  const [why, setWhy] = useState("");
  const [typing, setTyping] = useState(false);
  const [noteShown, setNoteShown] = useState(false); // a transcript opened the field (no autofocus: no keyboard pop)
  const [note, setNote] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [queued, setQueued] = useState(false); // Send tapped while the note was still recording or transcribing
  const [locked, setLocked] = useState<{ call: Call | null } | null>(() => {
    const r = recallResult(code, decision.id);
    return r ? { call: r.submission.call } : null;
  });
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoSent = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [now, setNow] = useState(() => Date.now());
  const callRef = useRef<Call | null>(null);
  useEffect(() => {
    callRef.current = call;
  });

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
        // A call already tapped stays: the note only needs the why.
        if (callRef.current) return setNote(VOICE_COPY.editHint);
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
    // Send tapped while a note is still recording or transcribing: stop it and send once the transcript lands
    // (the awaitingNote effect below), so the reason goes in with the call. The 0 s send (final) never waits here.
    if (!final && (voice.status === "recording" || voice.status === "starting" || voice.status === "transcribing")) {
      if (voice.status !== "transcribing") voice.stop();
      awaitingNote.current = true;
      setQueued(true);
      return;
    }
    setQueued(false);
    setSending(true);
    const text = why.trim();
    const word = call ? COPY.freeze.options[call] : "";
    const transcript = call && !text.toLowerCase().startsWith(word.toLowerCase()) ? `${word}. ${text}`.trim() : text;
    const seconds = Math.min(CALL_WINDOW_S, Math.max(0, elapsed / 1000));
    try {
      const r = await submitCall(code, decision.id, { player_name: me, transcript, seconds_to_call: Math.round(seconds * 10) / 10, call });
      setLocked({ call: r.submission.call ?? call });
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
  // If the pad unmounts (phase flipped to reveal) with the 0 s send or a queued Send still pending, send now: the request
  // outlives the unmount and the server still accepts it during its short grace.
  const lockedRef = useRef(false);
  useEffect(() => {
    lockedRef.current = !!locked || alreadyIn;
  });
  useEffect(
    () => () => {
      if (((autoTimer.current !== undefined && autoSent.current) || awaitingNote.current) && !lockedRef.current) {
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
  // A note started this close to the end would be cut off: the mic closes and typing takes over.
  const tooLate = left > 0 && left <= VOICE_CUTOFF_S && !recording && voice.status !== "transcribing";
  const hasNote = voice.status === "done" && !!why.trim();
  const slow = voice.status === "transcribing" && voice.stoppedAt != null && now - voice.stoppedAt > SLOW_MS;

  const brief = frames ? getBrief(decision, frames) : null;
  const team = teamColourOf(frames, decision.player_role.number);
  const myCode = brief?.frame?.drivers.find((d) => d.number === decision.player_role.number)?.code ?? "";
  const pos = brief?.ctx?.pos;
  const adv = mode === "advanced";

  const helper =
    (sending || queued
      ? COPY.freeze.sending
      : voice.status === "starting"
      ? VOICE_COPY.starting
      : recording
      ? voice.interim
        ? `"${voice.interim}"`
        : call
          ? VOICE_COPY.recordingWhy
          : VOICE_COPY.recording
      : voice.status === "transcribing"
        ? slow
          ? COPY.freeze.slow
          : VOICE_COPY.transcribing
        : (micNote ?? voiceNotice ?? note ?? (tooLate ? VOICE_COPY.tooLate : null))) ?? null;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send();
  }

  // Convenience handlers with exactly the legacy pad's inline behaviour.
  function choose(c: Call) {
    setCall(c);
    setErr(null);
  }
  function toggleTyping() {
    setTyping(!showTyping);
    setNoteShown(false);
  }

  return {
    // state
    call,
    why,
    typing,
    noteShown,
    note,
    sending,
    queued,
    locked,
    err,
    now,
    // setters (the legacy JSX uses these inline)
    setCall,
    setWhy,
    setTyping,
    setNoteShown,
    setErr,
    // refs
    inputRef,
    // voice
    voice,
    busy,
    recording,
    talkMs,
    recSecs,
    micNote,
    voiceNotice,
    micDown,
    showTyping,
    tooLate,
    hasNote,
    slow,
    helper,
    // timing
    left,
    urgent,
    alreadyIn,
    // derived display data
    brief,
    team,
    myCode,
    pos,
    adv,
    // actions
    send,
    onSubmit,
    choose,
    toggleTyping,
  };
}

export type CallPadState = ReturnType<typeof useCallPad>;
