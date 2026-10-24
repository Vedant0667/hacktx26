"use client";
// `/play/[code]`: the phone controller. Join with nickname and consent, wait, watch the replay with telemetry,
// make the call, see your result. Before the reveal it reads only the blind decision and blind frames, and it
// shows decision.blind_title instead of race or team names.
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, data, type BlindDecision, type JoinResponse, type LobbyStateResponse } from "@/lib/client/api";
import { noopSubscribe, recallName, recallPlayerToken } from "@/lib/client/identity";
import { callMomentFrames, fmtGap, replayLap, tla } from "@/lib/client/race";
import { canRejoin, isLobbyFull, joinErrorText, joinLobby } from "@/lib/client/session";
import { telemetry } from "@/lib/client/telemetry";
import { useLobby, useReveal, useTicker } from "@/lib/client/useLobby";
import { useDataMode, type DataMode } from "@/lib/client/mode";
import { fieldStyle, teamColourOf } from "@/lib/client/field";
import type { LapFrame } from "@/lib/types";
import { LapChart, NeighbourList, simpleChartLabel } from "../Telemetry";
import { Check, ConnNotice, ErrorText, ModeToggle, ScChip, TrackStrip, TyreChip } from "../ui";
import { CallPad } from "./CallPad";
import { PlayerResult } from "./PlayerResult";

export function PlayScreen({ code }: { code: string }) {
  const [removed, setRemoved] = useState(false);
  const { lobby, conn, serverNow, apply } = useLobby(code, removed);
  const stored = useSyncExternalStore(noopSubscribe, () => recallName(code), () => null);
  const [joinedAs, setMe] = useState<string | null>(null);
  const me = joinedAs ?? stored;
  const token = useSyncExternalStore(noopSubscribe, () => (me ? recallPlayerToken(code, me) : null), () => null);
  // This device holds a token for `me` but the name is gone from the lobby: the host removed it.
  const kicked = !!lobby && !!me && !!token && !lobby.players.some((p) => p.name === me);
  // Latched during render (React's "adjust state on change" pattern) so polling stops on the next pass.
  if (kicked && !removed) setRemoved(true);
  const [decision, setDecision] = useState<BlindDecision | null>(null);
  const [frames, setFrames] = useState<LapFrame[] | null>(null);
  const t = useTicker(serverNow, 200);
  const [mode, setMode] = useDataMode(code, "play");
  const reveal = useReveal(code, lobby?.phase);

  const decisionId = lobby?.decision_id;
  useEffect(() => {
    if (!decisionId) return;
    Promise.all([data.decision(decisionId), data.frames(decisionId)])
      .then(([d, f]) => {
        setDecision(d);
        setFrames(f);
      })
      .catch(() => {});
  }, [decisionId]);

  // Joined only with this device's token for the name (without it the server refuses submits).
  const joined = !!me && !!(token || joinedAs) && !!lobby?.players.some((p) => p.name === me);
  const team = decision ? teamColourOf(reveal?.frames ?? frames, decision.player_role.number) : null;

  if (removed)
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5">
        <header className="flex h-[52px] items-center">
          <span className="meta text-[13px]">{COPY.name}</span>
        </header>
        <p role="alert" className="display mt-16 text-[2.5rem] leading-[0.95]">
          {COPY.error.removed}
        </p>
      </main>
    );
  if (conn === "not_found")
    return (
      <main className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-5">
        <header className="flex h-[52px] items-center">
          <span className="meta text-[13px]">{COPY.name}</span>
        </header>
        <p className="display mt-16 text-[2.5rem] leading-[0.95]">{COPY.home.codeNotFound(code)}</p>
      </main>
    );
  if (!lobby)
    return (
      <main className="mx-auto min-h-dvh max-w-[480px]">
        <ConnNotice conn={conn} code={code} />
      </main>
    );

  if (!joined)
    return (
      <>
        <ConnNotice conn={conn} code={code} />
        <JoinForm
          code={code}
          players={lobby.players.length}
          initialName={me ?? ""}
          onJoined={(name, state) => {
            setMe(name);
            apply(state, Date.now());
          }}
        />
      </>
    );

  const elapsed = t - lobby.phase_started_at;
  const phase = lobby.phase;

  if (phase === "decision" && decision)
    return (
      <>
        <ConnNotice conn={conn} code={code} />
        <CallPad
          code={code}
          me={me!}
          decision={decision}
          frames={frames}
          elapsed={elapsed}
          players={lobby.players.map((p) => p.name)}
          submittedNames={lobby.submissions.map((s) => s.player_name)}
          mode={mode}
          setMode={setMode}
        />
      </>
    );

  return (
    <main style={fieldStyle(team)} className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <ConnNotice conn={conn} code={code} />
      {phase === "waiting" && <Waiting lobby={lobby} decision={decision} me={me!} mode={mode} setMode={setMode} />}
      {phase === "replay" && decision && frames && <Replay decision={decision} frames={frames} elapsed={elapsed} mode={mode} setMode={setMode} me={me!} />}
      {(phase === "reveal" || phase === "done") &&
        (reveal ? (
          <PlayerResult code={code} me={me!} decision={reveal.decision} frames={reveal.frames} lobby={lobby} mode={mode} setMode={setMode} gt={reveal.ground_truth} />
        ) : (
          <p className="px-5 pt-24 text-lg font-bold">{COPY.reveal.grading}</p>
        ))}
    </main>
  );
}

// Black band pinned to the bottom of the phone: the one thing to do or wait for.
function Foot({ title, meta, progress }: { title: string; meta?: string; progress?: number }) {
  return (
    <div className="on-dark sticky bottom-0 mt-auto flex h-24 items-center justify-between bg-ink px-6 pb-[env(safe-area-inset-bottom)] text-white">
      {progress != null && <div className="absolute left-0 top-0 h-1 bg-field transition-[width] duration-700 ease-out" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden />}
      <b className="whitespace-nowrap text-xl">{title}</b>
      {meta && <span className="nums ml-4 truncate text-[13px] text-[#BDBDBD]">{meta}</span>}
    </div>
  );
}

function FieldHead({ status, right, children }: { status: React.ReactNode; right: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-field text-on-field">
      <div className="flex h-[52px] items-center justify-between gap-3 px-5">
        <span className="meta flex items-center gap-2 text-[13px]">{status}</span>
        <span className="meta text-[13px]">{right}</span>
      </div>
      <div className="px-5 pb-[22px] pt-[18px]">{children}</div>
    </div>
  );
}

function Waiting({ lobby, decision, me, mode, setMode }: { lobby: LobbyStateResponse; decision: BlindDecision | null; me: string; mode: DataMode; setMode: (m: DataMode) => void }) {
  const slot = Math.max(1, lobby.players.findIndex((p) => p.name === me) + 1);
  return (
    <>
      <FieldHead status={COPY.phone.waitingStatus} right={tla(me)}>
        <div className="display rise text-[4rem] leading-[0.9]">{COPY.play.youAre(tla(me))}</div>
        {decision?.blind_title && <p className="mt-2.5 text-lg font-bold leading-snug">{decision.blind_title}</p>}
      </FieldHead>
      <div className="flex flex-1 flex-col px-5 pt-[22px]">
        <div className="flex items-center justify-between">
          <span className="meta">{COPY.waiting.count(lobby.players.length)}</span>
          <ModeToggle mode={mode} onChange={setMode} size="sm" />
        </div>
        <ol className="mt-3 flex flex-col">
          {lobby.players.map((p, i) => (
            <li key={p.name} className={`rise grid h-10 grid-cols-[40px_64px_1fr] items-center font-mono text-[15px] ${p.name === me ? "-mx-2 bg-field px-2 font-bold text-on-field" : "border-b border-soft-2"}`}>
              <span>{i + 1}</span>
              <span className="font-bold">{tla(p.name)}</span>
              <span className="truncate font-sans font-medium">{p.name}</span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-base text-ink-2">{COPY.waiting.playerView}</p>
      </div>
      <Foot title={COPY.tele.waitingHost} meta={COPY.play.gridSlot(slot)} />
    </>
  );
}

function Replay({ decision, frames, elapsed, mode, setMode, me }: { decision: BlindDecision; frames: LapFrame[]; elapsed: number; mode: DataMode; setMode: (m: DataMode) => void; me: string }) {
  const lap = replayLap(decision, elapsed);
  const seen = callMomentFrames(frames, decision).filter((f) => f.lap <= lap);
  const f = seen[seen.length - 1];
  if (!f) return null;
  const mine = f.drivers.find((d) => d.number === decision.player_role.number);
  // Telemetry as of this replay lap: the same helper with the current lap as the moment.
  const tele = telemetry(seen, { ...decision, lap: f.lap }, mode === "advanced" ? 8 : 6);
  const sorted = [...f.drivers].sort((a, b) => a.position - b.position);
  const i = sorted.findIndex((d) => d.number === decision.player_role.number);
  const rows = mode === "advanced" ? 8 : 4;
  const start = Math.max(0, Math.min(sorted.length - rows, i - 1));
  const near = sorted.slice(start, start + rows);
  const togo = Math.max(0, decision.lap - lap);
  return (
    <>
      <TrackStrip status={f.track_status} />
      <FieldHead
        status={
          <>
            {COPY.phone.replayStatus(lap, decision.total_laps)}
            <ScChip status={f.track_status} />
          </>
        }
        right={tla(me)}
      >
        <div className="display text-[4rem] leading-[0.9]">{mine?.code}</div>
        {mine && (
          <p className="mt-2.5 flex items-center gap-2 text-lg font-bold">
            {COPY.phone.carLine(mine.number, mine.position, mine.compound ? (COPY.compounds[mine.compound] ?? mine.compound) : null, mine.tyre_age)}
          </p>
        )}
      </FieldHead>
      <div className="flex flex-1 flex-col px-5 pb-6 pt-[22px]">
        <div className="flex items-center justify-between gap-3">
          <span className="meta">{tele ? simpleChartLabel(tele) : COPY.tele.title}</span>
          <ModeToggle mode={mode} onChange={setMode} size="sm" />
        </div>
        {tele && (
          <>
            <div className="mt-2.5">
              <LapChart laps={tele.laps} cars={[tele.me, tele.ahead, tele.behind]} height={104} status={tele.status} axis={mode === "advanced"} values={mode === "advanced"} />
            </div>
            <div className="mt-3">
              <NeighbourList t={tele} />
            </div>
          </>
        )}
        <ol className="mt-5">
          {near.map((d) => {
            const isMe = d.number === decision.player_role.number;
            return (
              <li
                key={d.number}
                className={`grid h-10 items-center font-mono text-[15px] ${mode === "advanced" ? "grid-cols-[32px_6px_1fr_72px_60px]" : "grid-cols-[32px_6px_1fr_80px_60px]"} gap-x-2 ${
                  isMe ? "-mx-2 bg-field px-2 font-bold text-on-field" : "border-b border-soft-2 font-medium"
                }`}
                aria-current={isMe || undefined}
              >
                <span>{d.position}</span>
                <span className="h-4 w-1" style={d.team_colour ? { backgroundColor: d.team_colour } : undefined} aria-hidden />
                <span className="font-bold">{d.code}</span>
                <span className="text-right">{fmtGap(d.gap_to_leader_s, d.position) ?? COPY.replay.leader.toLowerCase()}</span>
                <span className="flex justify-end">
                  <TyreChip compound={d.compound} age={d.tyre_age} size="sm" />
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <Foot title={COPY.tele.decisionComing} meta={COPY.tele.lapsToGo(togo)} progress={(lap - decision.replay_from_lap) / Math.max(1, decision.lap - decision.replay_from_lap)} />
    </>
  );
}

function JoinForm({ code, players, initialName, onJoined }: { code: string; players: number; initialName: string; onJoined: (name: string, state: JoinResponse) => void }) {
  const [name, setName] = useState(initialName);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function join(n: string) {
    setErr(null);
    setTaken(null);
    setBusy(true);
    try {
      onJoined(n, await joinLobby(code, n, consent));
    } catch (e) {
      setErr(joinErrorText(e, code, n));
      if (e instanceof ApiError && e.status === 409 && !isLobbyFull(e)) setTaken(n);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr(COPY.home.nameMissing);
    if (!consent) return setErr(COPY.play.consentMissing);
    void join(n);
  }

  const rejoinable = taken ? canRejoin(code, taken) : false;
  const letters = code.padEnd(4, " ").slice(0, 4).split("");

  return (
    <form onSubmit={submit} className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col" noValidate>
      <header className="flex h-[52px] items-center justify-between px-5">
        <span className="meta text-[13px]">{COPY.name}</span>
        <span className="meta text-[13px]">{COPY.room.heading(code)}</span>
      </header>
      <div className="flex flex-1 flex-col px-5">
        <h1 className="display mb-[30px] mt-[22px] text-[3.25rem] leading-[0.95]">{COPY.phone.joinTitle}</h1>
        <span className="meta">{COPY.phone.roomCode}</span>
        <div className="mt-2.5 grid grid-cols-4 gap-2" aria-label={COPY.room.heading(code)}>
          {letters.map((c, i) => (
            <div key={i} className={`flex h-[84px] items-center justify-center border-ink font-mono text-[2.75rem] font-bold ${i === 3 ? "border-4" : "border-2"}`} aria-hidden>
              {c}
            </div>
          ))}
        </div>

        <label htmlFor="nick" className="meta mt-[34px]">
          {COPY.phone.nickname}
        </label>
        <input
          id="nick"
          value={name}
          maxLength={24}
          autoComplete="nickname"
          placeholder={COPY.home.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!err || undefined}
          aria-describedby="join-err"
          className="mt-2 h-14 w-full border-0 border-b-2 border-ink bg-transparent pb-1 text-[1.625rem] font-bold tracking-tight text-ink outline-none placeholder:text-lg placeholder:font-medium focus:border-b-4"
        />
        <p className="mt-2 flex h-8 items-center gap-2 text-sm text-ink-2">
          {name.trim() && (
            <>
              {COPY.play.tla}
              <b className="bg-ink px-1.5 font-black text-white">{tla(name)}</b>
            </>
          )}
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3.5 text-base leading-[1.4]">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="peer sr-only" />
          <span
            aria-hidden
            className="mt-0.5 inline-grid size-6 shrink-0 place-items-center border-2 border-ink text-white transition-colors duration-150 peer-checked:bg-ink peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink"
          >
            {consent && <Check />}
          </span>
          <span>{COPY.play.consent}</span>
        </label>

        <div className="mb-4 mt-4 min-h-6">
          <ErrorText id="join-err">{err}</ErrorText>
        </div>
        {taken && rejoinable && (
          <button type="button" onClick={() => consent && void join(taken)} className="mb-4 h-14 border-2 border-ink text-lg font-bold hover:bg-soft">
            {COPY.play.rejoin(taken)}
          </button>
        )}
      </div>
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy || undefined}
        className="on-dark sticky bottom-0 flex h-24 items-center justify-between bg-ink px-6 pb-[env(safe-area-inset-bottom)] text-[1.75rem] font-black text-white transition-colors duration-150 hover:bg-[#262626] disabled:text-white/60"
      >
        <span>{busy ? COPY.play.joining : COPY.play.join}</span>
        <small className="nums text-[13px] font-medium text-[#BDBDBD]">{COPY.tele.inRoom(players)}</small>
      </button>
    </form>
  );
}
