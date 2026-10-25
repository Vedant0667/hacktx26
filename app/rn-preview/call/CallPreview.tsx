"use client";
// Fixture-driven states for RNCallPadView. The real pad gets its state from useCallPad; here we hand-build it.
import { useEffect, useRef, useState } from "react";
import { COPY, VOICE_COPY } from "@/lib/copy";
import type { BlindDecision } from "@/lib/client/api";
import type { DataMode } from "@/lib/client/mode";
import type { Call } from "@/lib/types";
import { RNCallPadView, type RNCallPadViewState } from "@/components/rn/call/RNCallPad";
import type { CallPadProps } from "@/lib/client/useCallPad";

import decisionJson from "@/components/rn/call/fixtures/decision.json";
import framesJson from "@/components/rn/call/fixtures/frames.json";
import { getBrief } from "@/components/DecisionBrief";
import { teamColourOf } from "@/lib/client/field";
import type { LapFrame } from "@/lib/types";

// Real blind data from GET /api/decisions/singapore-2026-vsc and /frames (no answer fields).
const decision = decisionJson as unknown as BlindDecision;
const frames = framesJson as unknown as LapFrame[];
const brief = getBrief(decision, frames);
const team = teamColourOf(frames, decision.player_role.number);
const myCode = brief?.frame?.drivers.find((d) => d.number === decision.player_role.number)?.code ?? "";
const players = ["Vedant", "Maya", "Priya", "Ekb", "Jordan", "Sam"];
const noop = () => {};
type Voice = RNCallPadViewState["voice"];
const voice = (v: Partial<Voice>): Voice =>
  ({ status: "idle", issue: null, engine: "muse", notice: null, level: 0, startedAt: null, stoppedAt: null, interim: "", canRetry: false, toggle: noop, stop: noop, retry: noop, ...v }) as Voice;

const STATES = ["idle", "selected", "starting", "recording", "transcribing", "slow", "done", "typing", "failed", "limit", "denied", "nomic", "busy", "browser", "toolate", "queued", "error", "locked", "lockedNoCall", "timeup"] as const;
type S = (typeof STATES)[number];

function build(st: S, adv: boolean): { s: Omit<RNCallPadViewState, "inputRef">; submitted: string[] } {
  const why = "VSC makes the stop cheap, softs are ten laps old and dropping a second a lap.";
  const base: Omit<RNCallPadViewState, "inputRef"> = {
    call: null, why: "", sending: false, queued: false, locked: null, err: null, setWhy: noop, voice: voice({}), busy: false,
    recording: false, talkMs: 0, recSecs: 0, micDown: false, showTyping: false, tooLate: false, hasNote: false, left: 17, urgent: false,
    alreadyIn: false, brief, team, myCode, pos: brief?.ctx?.pos, adv, typing: false, helper: null,
    onSubmit: (e) => e.preventDefault(), choose: noop, toggleTyping: noop,
  };
  const box: Partial<RNCallPadViewState> = { call: "BOX" as Call };
  const m: Record<S, Partial<RNCallPadViewState>> = {
    idle: {},
    selected: box,
    starting: { ...box, busy: true, voice: voice({ status: "starting" }), helper: VOICE_COPY.starting },
    recording: { ...box, busy: true, recording: true, talkMs: 8000, recSecs: 8, voice: voice({ status: "recording", level: 4 }), helper: VOICE_COPY.recordingWhy },
    transcribing: { ...box, busy: true, recSecs: 9, voice: voice({ status: "transcribing" }), helper: VOICE_COPY.transcribing },
    slow: { ...box, busy: true, recSecs: 9, voice: voice({ status: "transcribing" }), helper: COPY.freeze.slow },
    done: { ...box, why, hasNote: true, showTyping: true, recSecs: 9, voice: voice({ status: "done" }), helper: VOICE_COPY.editHint },
    typing: { ...box, why: "Cheap stop", showTyping: true, typing: true },
    failed: { ...box, recSecs: 6, voice: voice({ status: "idle", notice: "failed", canRetry: true }), helper: VOICE_COPY.failed },
    limit: { micDown: true, showTyping: true, voice: voice({ issue: "limit" }), helper: VOICE_COPY.limit },
    denied: { micDown: true, showTyping: true, voice: voice({ issue: "denied" }), helper: COPY.error.micDeniedShort },
    nomic: { micDown: true, showTyping: true, voice: voice({ issue: "no_mic" }), helper: COPY.error.noMic },
    busy: { voice: voice({ issue: "busy" }), helper: VOICE_COPY.busy },
    browser: { ...box, voice: voice({ engine: "browser", notice: "switchedBrowser" }), helper: VOICE_COPY.switchedBrowser },
    toolate: { ...box, left: 4, urgent: true, tooLate: true, helper: VOICE_COPY.tooLate },
    queued: { ...box, queued: true, busy: true, voice: voice({ status: "transcribing" }), helper: COPY.freeze.sending },
    error: { err: COPY.freeze.pickCall },
    locked: { ...box, why, locked: { call: "BOX" as Call }, left: 4 },
    lockedNoCall: { locked: { call: null }, left: 0 },
    timeup: { alreadyIn: true, left: 0 },
  };
  const submitted = st.startsWith("locked") || st === "timeup" ? ["Vedant", "Maya", "Priya"] : ["Maya"];
  return { s: { ...base, ...m[st] }, submitted };
}

export function CallPreview() {
  const [st, setSt] = useState<S>("idle");
  const [mode, setMode] = useState<DataMode>("simple");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("s");
    // Read the URL once on mount (client only) to pick the fixture.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s && (STATES as readonly string[]).includes(s)) setSt(s as S);
    if (q.get("mode") === "advanced") setMode("advanced");
  }, []);
  const { s, submitted } = build(st, mode === "advanced");
  const props: CallPadProps = { code: "FIXT", me: "Vedant", decision, frames, elapsed: 0, players, submittedNames: submitted, mode, setMode };
  return <RNCallPadView props={props} s={{ ...s, inputRef }} />;
}
