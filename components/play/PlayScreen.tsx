"use client";
// `/play/[code]`: the phone controller. Join with nickname and consent, wait, make the call, see your result.
import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api, data, type BlindDecision, type JoinResponse, type LobbyStateResponse } from "@/lib/client/api";
import { noopSubscribe, recallName, recallPlayerToken, rememberName, rememberPlayerToken } from "@/lib/client/identity";
import { callMomentFrames, frameAt, replayLap, tla } from "@/lib/client/race";
import { useLobby, useReveal, useTicker } from "@/lib/client/useLobby";
import { useDataMode, type DataMode } from "@/lib/client/mode";
import type { LapFrame } from "@/lib/types";
import { Tower } from "../Tower";
import { Button, ConnNotice, Label, ModeToggle, StatusStrip } from "../ui";
import { CallPad } from "./CallPad";
import { PlayerResult } from "./PlayerResult";
import { Situation } from "./Situation";

export function PlayScreen({ code }: { code: string }) {
  const { lobby, conn, serverNow, apply } = useLobby(code);
  const stored = useSyncExternalStore(noopSubscribe, () => recallName(code), () => null);
  const [joinedAs, setMe] = useState<string | null>(null);
  const me = joinedAs ?? stored;
  // This device's token for `me`; without it the server refuses submits, so the phone is not joined.
  const token = useSyncExternalStore(noopSubscribe, () => (me ? recallPlayerToken(code, me) : null), () => null);
  // Blind decision and frames until the reveal; the full set arrives from the reveal route.
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

  const joined = !!me && !!token && !!lobby?.players.some((p) => p.name === me);

  if (conn === "not_found") return <Shell><p className="text-24 text-flag-red">{COPY.home.codeNotFound(code)}</p></Shell>;
  if (!lobby) return <Shell><ConnNotice conn={conn} code={code} /></Shell>;

  if (!joined)
    return (
      <Shell>
        <ConnNotice conn={conn} code={code} />
        <JoinForm
          code={code}
          initialName={me ?? ""}
          onJoined={(name, state) => {
            // A rejoin returns null and the stored token stays valid.
            if (state.player_token) rememberPlayerToken(code, name, state.player_token);
            rememberName(code, name);
            setMe(name);
            apply(state, Date.now());
          }}
        />
      </Shell>
    );

  const elapsed = t - lobby.phase_started_at;
  const myTla = tla(me!);

  return (
    <Shell>
      <ConnNotice conn={conn} code={code} />
      <div className="flex items-center justify-between gap-3">
        <span className="nums text-20 font-extrabold uppercase stretch-125 tracking-code">{code}</span>
        <ModeToggle mode={mode} onChange={setMode} size="sm" />
        <span className="bg-ink px-2 text-20 font-bold uppercase text-bg stretch-75">{myTla}</span>
      </div>

      {lobby.phase === "waiting" && <Waiting lobby={lobby} decision={decision} me={me!} />}

      {lobby.phase === "replay" && decision && frames && <ReplayMini decision={decision} frames={frames} elapsed={elapsed} mode={mode} />}

      {lobby.phase === "decision" && decision && (
        <CallPad
          situation={frames && <Situation decision={decision} frames={frames} mode={mode} />}
          details={frames && <Situation decision={decision} frames={frames} mode={mode} part="bottom" />}
          code={code}
          me={me!}
          decision={decision}
          elapsed={elapsed}
          players={lobby.players.length}
          submittedNames={lobby.submissions.map((s) => s.player_name)}
        />
      )}

      {(lobby.phase === "reveal" || lobby.phase === "done") && reveal && (
        <PlayerResult code={code} me={me!} decision={reveal.decision} lobby={lobby} mode={mode} gt={reveal.ground_truth} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col gap-6 px-4 py-6">{children}</main>;
}

function Waiting({ lobby, decision, me }: { lobby: LobbyStateResponse; decision: BlindDecision | null; me: string }) {
  const r = decision?.player_role;
  return (
    <section className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4 border-x-2 border-t-2 border-ink px-4 pt-3 pb-4">
        <h1 className="text-40 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.play.youAre(tla(me))}</h1>
        <span className="nums text-40 font-extrabold uppercase stretch-75 leading-hero text-ink-2">
          {COPY.play.gridSlot(Math.max(1, lobby.players.findIndex((p) => p.name === me) + 1))}
        </span>
      </div>
      <p className="text-24 font-semibold">{COPY.waiting.playerView}</p>
      {decision && r && <p className="text-20 text-ink-2">{COPY.waiting.race(decision.race, r.team, r.driver, r.number)}</p>}
      <div className="flex flex-col gap-2">
        <Label className="nums">{COPY.waiting.count(lobby.players.length)}</Label>
        <ol className="flex flex-wrap gap-0.5">
          {lobby.players.map((p) => (
            <li key={p.name} className={`px-3 py-2 text-24 font-bold uppercase stretch-75 ${p.name === me ? "bg-ink text-bg" : "bg-surface"}`}>
              {tla(p.name)}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ReplayMini({ decision, frames, elapsed, mode }: { decision: BlindDecision; frames: LapFrame[]; elapsed: number; mode: DataMode }) {
  const lap = replayLap(decision, elapsed);
  const f = frameAt(callMomentFrames(frames, decision), lap);
  const total = decision.total_laps;
  if (!f) return null;
  return (
    <section className="flex flex-col gap-4">
      <StatusStrip status={f.track_status} size="phone" />
      <span className="nums text-40 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.replay.lap(lap, total)}</span>
      <Tower drivers={f.drivers} playerNumber={decision.player_role.number} maxRows={10} centerOn={decision.player_role.number} showPit={false} mode={mode} />
    </section>
  );
}

const inputCls =
  "h-14 w-full rounded-ctl border border-rule bg-surface px-4 text-20 text-ink placeholder:text-ink-3 hover:bg-surface-2 aria-invalid:border-flag-red";

function JoinForm({
  code,
  initialName,
  onJoined,
}: {
  code: string;
  initialName: string;
  onJoined: (name: string, state: JoinResponse) => void;
}) {
  const [name, setName] = useState(initialName);
  const [consent, setConsent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [taken, setTaken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setErr(COPY.home.nameMissing);
    if (!consent) return setErr(COPY.play.consentMissing);
    setErr(null);
    setTaken(null);
    setBusy(true);
    try {
      // A held token for this name makes it a rejoin; the server checks it.
      onJoined(n, await api.join(code, n, true, recallPlayerToken(code, n)));
    } catch (e2) {
      setErr(joinError(e2, code, n));
      if (e2 instanceof ApiError && e2.status === 409 && !isFull(e2)) setTaken(n);
    } finally {
      setBusy(false);
    }
  }

  // Only offered when this device holds the name's token (it joined as that name before).
  const rejoinToken = taken ? recallPlayerToken(code, taken) : null;
  async function rejoin() {
    if (!taken || !rejoinToken || !consent) return;
    try {
      onJoined(taken, await api.join(code, taken, true, rejoinToken));
    } catch (e2) {
      setErr(joinError(e2, code, taken));
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
      <h1 className="nums text-56 font-extrabold uppercase stretch-125 tracking-code leading-hero">{COPY.room.heading(code)}</h1>
      <div className="flex flex-col gap-2">
        <label htmlFor="nick">
          <Label>{COPY.home.nameLabel}</Label>
        </label>
        <input
          id="nick"
          className={inputCls}
          value={name}
          maxLength={24}
          autoComplete="nickname"
          placeholder={COPY.home.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!err || undefined}
          aria-describedby="join-err"
        />
        {name.trim() && (
          <p className="flex items-center gap-3 text-16 text-ink-2">
            {COPY.play.tla}
            <span className="bg-ink px-2 text-20 font-bold uppercase text-bg stretch-75">{tla(name)}</span>
          </p>
        )}
      </div>
      <label className="flex cursor-pointer items-start gap-3 text-20">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 size-6 shrink-0 rounded-ctl accent-ink"
        />
        <span>{COPY.play.consent}</span>
      </label>
      <Button type="submit" className="h-14 text-20" busy={busy} busyLabel={COPY.play.joining}>
        {COPY.play.join}
      </Button>
      <p id="join-err" className="min-h-7 text-20 text-flag-red" role="alert">
        {err}
      </p>
      {taken && rejoinToken && (
        <Button type="button" variant="secondary" className="h-14 text-20" onClick={rejoin}>
          {COPY.play.rejoin(taken)}
        </Button>
      )}
    </form>
  );
}

const isFull = (e: ApiError) => /full/i.test(e.message);

function joinError(e: unknown, code: string, name: string): string {
  if (!(e instanceof ApiError)) return COPY.error.connectionLost;
  if (e.status === 409) return isFull(e) ? COPY.error.lobbyFull : COPY.error.nameTaken(name);
  if (e.status === 404) return COPY.home.codeNotFound(code);
  if (e.status === 429) return COPY.error.rateLimited(e.retryAfter);
  if (e.status === 400) return COPY.play.consentMissing;
  return COPY.error.connectionLost;
}
