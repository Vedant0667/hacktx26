"use client";
// The phone in a race lobby (Round 6): join (with the race's driver list in a "choose" lobby), wait, follow the
// replay with telemetry and the audible control, make the call at each freeze where your car has one (the
// existing CallPad), "no call needed" otherwise, then "calls locked" while the race goes on (Round 7: nobody
// learns who was right until the flag), and the shared game summary at the flag.
import { useState, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api, type BlindDriver, type BlindFreeze, type JoinResponse, type LobbyStateResponse, type RaceEntry } from "@/lib/client/api";
import { fieldStyle } from "@/lib/client/field";
import type { DataMode } from "@/lib/client/mode";
import { CALL_WINDOW_S, fmtGap } from "@/lib/client/race";
import {
  REVEAL_HOLD_MS,
  clockLap,
  freezeDecision,
  numberOf,
  raceCarOf,
  racePhase,
  replayDecision,
  useAudibleCooldown,
  useRaceEntry,
  useRaceFrames,
  useRaceFreeze,
  type RaceLobby,
} from "@/lib/client/raceLobby";
import { telemetry } from "@/lib/client/telemetry";
import { useTicker, type Conn } from "@/lib/client/useLobby";
import type { LapFrame } from "@/lib/types";
import { CallPad } from "../play/CallPad";
import { FieldHead, Foot, JoinForm } from "../play/PlayScreen";
import { LapChart, NeighbourList, simpleChartLabel } from "../Telemetry";
import { ConnNotice, ErrorText, ModeToggle, ScChip, TrackStrip, TyreChip } from "../ui";
import { RaceProgress, Triggers } from "./parts";
import { PhoneSummary, Scoring } from "../EndScreen";
import { useSummary } from "@/lib/client/results";

export function RacePlay({
  code,
  lobby,
  conn,
  serverNow,
  me,
  joined,
  onRemoved,
  onJoined,
  mode,
  setMode,
}: {
  code: string;
  lobby: LobbyStateResponse;
  conn: Conn;
  serverNow: () => number;
  me: string | null;
  joined: boolean;
  onRemoved: () => void;
  onJoined: (name: string, state: JoinResponse) => void;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const race = lobby as RaceLobby;
  const r = race.race;
  const phase = racePhase(race);
  const entry = useRaceEntry(r.race_key);
  // Token-gated routes: only once this phone has joined.
  const frames = useRaceFrames(code, joined ? lobby : null);
  const freeze = useRaceFreeze(code, joined ? lobby : null);
  const { summary, failed } = useSummary(code, joined && phase === "done");
  const t = useTicker(serverNow, 200);

  if (!joined || !me) {
    const drivers: BlindDriver[] | null = entry ? entry.drivers.map((d) => ({ ...d, blind_title: "" })) : null;
    return (
      <>
        <ConnNotice conn={conn} code={code} />
        <JoinForm
          code={code}
          players={race.players.length}
          choose={race.driver_mode === "choose" && phase === "waiting"}
          drivers={drivers}
          frames={null}
          initialName={me ?? ""}
          onRemoved={onRemoved}
          onJoined={onJoined}
          metaFor={(c) => {
            const n = entry?.drivers.find((d) => d.code === c)?.freeze_count ?? 0;
            return <span className="nums text-xs font-bold">{COPY.homeUi.calls(n)}</span>;
          }}
        />
      </>
    );
  }

  const myCar = raceCarOf(race, me);
  const driver = entry?.drivers.find((d) => d.code === myCar) ?? null;
  const colour = driver?.team_colour ?? null;
  const elapsed = t - race.phase_started_at;
  const need = r.calls_needed ?? [];
  const myFreeze = phase === "freeze" && myCar && need.includes(myCar) ? (freeze?.drivers[myCar] ?? null) : null;
  const myNumber = numberOf(frames, myCar);

  if (myFreeze && myNumber != null && frames.some((f) => f.lap === myFreeze.lap)) {
    const owing = race.players.filter((p) => {
      const c = raceCarOf(race, p.name);
      return c != null && need.includes(c);
    });
    return (
      <>
        <ConnNotice conn={conn} code={code} />
        <CallPad
          code={code}
          me={me}
          decision={freezeDecision(r, myFreeze, myNumber, frames, r.segment_start_lap)}
          frames={frames.filter((f) => f.lap <= myFreeze.lap)}
          elapsed={elapsed}
          players={owing.map((p) => p.name)}
          submittedNames={r.called}
          mode={mode}
          setMode={setMode}
        />
      </>
    );
  }

  return (
    <main style={fieldStyle(colour)} className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col">
      <ConnNotice conn={conn} code={code} />
      {phase === "waiting" && <Waiting race={race} me={me} driver={driver} mode={mode} setMode={setMode} />}
      {phase === "replay" && (
        <Replay
          code={code}
          race={race}
          me={me}
          car={myCar}
          frames={frames}
          lap={Math.min(clockLap(race, t), frames.at(-1)?.lap ?? 0)}
          mode={mode}
          setMode={setMode}
        />
      )}
      {phase === "freeze" && (
        <NoCall race={race} me={me} car={myCar} freeze={freeze?.drivers ?? null} loading={!!myCar && need.includes(myCar)} left={Math.max(0, Math.ceil(CALL_WINDOW_S - elapsed / 1000))} />
      )}
      {phase === "reveal_freeze" && <Locked left={Math.max(0, Math.ceil((REVEAL_HOLD_MS - elapsed) / 1000))} />}
      {phase === "done" && (summary ? <PhoneSummary summary={summary} me={me} /> : <Scoring elapsedMs={elapsed} failed={failed} />)}
    </main>
  );
}

function Head({ race, me, status, children }: { race: RaceLobby; me: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <FieldHead status={status} right={me}>
      {children}
      <div className="mt-4">
        <RaceProgress size="phone" total={race.race.total_laps} lap={racePhase(race) === "done" ? race.race.total_laps : race.race.visible_lap} past={race.race.past_freeze_laps} current={race.race.freeze_lap} />
      </div>
    </FieldHead>
  );
}

function Waiting({ race, me, driver, mode, setMode }: { race: RaceLobby; me: string; driver: RaceEntry["drivers"][number] | null; mode: DataMode; setMode: (m: DataMode) => void }) {
  const slot = Math.max(1, race.players.findIndex((p) => p.name === me) + 1);
  return (
    <>
      <FieldHead status={COPY.phone.waitingStatus} right={me}>
        <div className="display rise break-words text-[3rem] leading-[0.95]">{COPY.play.youAre(me)}</div>
        <p className="mt-2.5 text-lg font-bold leading-snug">
          {driver ? `${COPY.drivers.picked(driver.code)} #${driver.number}. ` : ""}
          {COPY.race.raceLine(race.race.name, race.race.total_laps)}
        </p>
        {driver && <p className="mt-1 text-base font-medium">{COPY.homeUi.previewRaceSub(driver.freeze_count)}</p>}
      </FieldHead>
      <div className="flex flex-1 flex-col px-5 pt-[22px]">
        <div className="flex items-center justify-between">
          <span className="meta">{COPY.waiting.count(race.players.length)}</span>
          <ModeToggle mode={mode} onChange={setMode} size="sm" />
        </div>
        <ol className="mt-3 flex flex-col">
          {race.players.map((p, i) => (
            <li key={p.name} className={`rise tnum grid h-11 grid-cols-[40px_1fr] items-center text-[15px] font-semibold ${p.name === me ? "-mx-2 bg-field px-2 text-on-field" : "border-b border-line"}`}>
              <span>{i + 1}</span>
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate text-base font-bold">{p.name}</span>
                {(p.driver_code || race.driver_code) && <span className="text-xs font-bold tracking-[0.02em] opacity-80">{p.driver_code || race.driver_code}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-base text-ink-2">
          <b className="font-bold text-ink">{COPY.race.audible.title}.</b> {COPY.race.audible.hint}
        </p>
      </div>
      <Foot title={COPY.tele.waitingHost} meta={COPY.play.gridSlot(slot)} />
    </>
  );
}

function Replay({
  code,
  race,
  me,
  car,
  frames,
  lap,
  mode,
  setMode,
}: {
  code: string;
  race: RaceLobby;
  me: string;
  car: string | null;
  frames: LapFrame[];
  lap: number;
  mode: DataMode;
  setMode: (m: DataMode) => void;
}) {
  const r = race.race;
  const f = frames.find((x) => x.lap === lap) ?? frames.at(-1);
  if (!f) return <p className="px-5 pt-24 text-lg font-bold">{COPY.race.loading}</p>;
  const n = numberOf(frames, car);
  const mine = n != null ? f.drivers.find((d) => d.number === n) : undefined;
  const seen = frames.filter((x) => x.lap <= f.lap);
  const tele = n != null ? telemetry(seen, replayDecision(r, n, f.lap), mode === "advanced" ? 8 : 6) : null;
  const sorted = [...f.drivers].sort((a, b) => a.position - b.position);
  const i = Math.max(0, sorted.findIndex((d) => d.number === n));
  const rows = mode === "advanced" ? 8 : 4;
  const start = Math.max(0, Math.min(sorted.length - rows, i - 1));
  const near = sorted.slice(start, start + rows);
  return (
    <>
      <TrackStrip status={f.track_status} />
      <Head
        race={race}
        me={me}
        status={
          <>
            {COPY.phone.replayStatus(f.lap, r.total_laps)}
            <ScChip status={f.track_status} />
          </>
        }
      >
        <div className="display text-[4rem] leading-[0.9]">{mine?.code ?? COPY.race.watching}</div>
        {mine ? (
          <p className="mt-2.5 flex items-center gap-2 text-lg font-bold">
            {COPY.phone.carLine(mine.number, mine.position, mine.compound ? (COPY.compounds[mine.compound] ?? mine.compound) : null, mine.tyre_age)}
          </p>
        ) : (
          <p className="mt-2.5 text-base font-medium">{COPY.race.noCar}</p>
        )}
      </Head>
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
            const isMe = d.number === n;
            return (
              <li
                key={d.number}
                className={`nums grid h-10 grid-cols-[32px_6px_1fr_80px_60px] items-center gap-x-2 text-[15px] ${isMe ? "-mx-2 bg-field px-2 font-bold text-on-field" : "border-b border-soft-2 font-medium"}`}
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
      {car ? <AudibleDock code={code} me={me} lap={f.lap} /> : <Foot title={COPY.race.watching} meta={COPY.race.lapTag(f.lap, r.total_laps)} />}
    </>
  );
}

// The audible: "Box now" for your own car while the replay runs, with an optional typed reason (the same
// input as the call screen's Type band). One per 5 laps: the server's next_lap drives a visible cooldown.
function AudibleDock({ code, me, lap }: { code: string; me: string; lap: number }) {
  const [next, setNext] = useAudibleCooldown(code, me);
  const [why, setWhy] = useState("");
  const [typing, setTyping] = useState(false);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cooling = next != null && lap < next;
  const left = cooling ? next - lap : 0;
  const GAP = 5;

  async function send(e?: FormEvent) {
    e?.preventDefault();
    if (cooling || sending) return;
    setSending(true);
    setErr(null);
    try {
      const res = await api.audible(code, why.trim());
      setNext(res.next_lap);
      setNote(COPY.race.audible.sent(res.audible.lap));
      setWhy("");
      setTyping(false);
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 429 && typeof e2.body?.next_lap === "number") setNext(e2.body.next_lap);
      else if (e2 instanceof ApiError && e2.status === 409) setErr(COPY.race.audible.closed);
      else if (e2 instanceof ApiError && e2.status === 403) setErr(COPY.race.audible.notYou);
      else setErr(COPY.race.audible.failed);
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} className="sticky bottom-0 z-[var(--z-dock)] mt-auto" noValidate>
      <div className="border-t border-line bg-white px-5 pb-2 pt-2 text-sm" aria-live="polite">
        <p className="font-medium">{COPY.race.audible.hint}</p>
        {(note || err || cooling) && (
          <div className="mt-1 font-bold">
            {err ? <ErrorText>{err}</ErrorText> : cooling ? <p className="nums">{COPY.race.audible.cooldown(next!)} · {COPY.race.audible.lapsLeft(left)}</p> : <p>{note}</p>}
          </div>
        )}
      </div>
      {typing && (
        <div className="flex items-center gap-3 border-t border-line bg-white px-5 py-2 text-ink">
          <label htmlFor="audible-why" className="sr-only">
            {COPY.race.audible.whyLabel}
          </label>
          <input
            id="audible-why"
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            placeholder={COPY.race.audible.whyPlaceholder}
            maxLength={400}
            enterKeyHint="send"
            autoFocus
            className="h-12 min-w-0 flex-1 border-b-2 border-ink bg-transparent text-base font-bold outline-none"
          />
        </div>
      )}
      <div className="on-dark relative flex h-24 items-stretch bg-ink pb-[env(safe-area-inset-bottom)] text-white">
        {cooling && <div className="absolute left-0 top-0 h-1 bg-field transition-[width] duration-700 ease-out" style={{ width: `${Math.round(((GAP - left) / GAP) * 100)}%` }} aria-hidden />}
        <button type="submit" disabled={cooling || sending} aria-busy={sending || undefined} className="flex min-w-0 flex-1 items-center justify-between px-6 text-left disabled:text-white/50">
          <span className="flex flex-col">
            <span className="meta text-[11px] text-[#BDBDBD]">{COPY.race.audible.title}</span>
            <span className="text-[1.75rem] font-black tracking-[-0.02em]">{sending ? COPY.race.audible.sending : COPY.race.audible.button}</span>
          </span>
          <span className="nums text-[13px] font-medium text-[#BDBDBD]">{cooling ? COPY.race.freezeMark(next!) : COPY.race.audible.ready}</span>
        </button>
        <button
          type="button"
          onClick={() => setTyping((v) => !v)}
          aria-expanded={typing}
          aria-controls="audible-why"
          className="w-[5.5rem] shrink-0 border-l border-white/15 text-sm font-bold hover:bg-white/10"
        >
          {typing ? COPY.race.audible.whyClose : COPY.race.audible.why}
        </button>
      </div>
    </form>
  );
}

// A freeze where this player's car has no call: say so, show why the others froze, and who still owes a call.
function NoCall({
  race,
  me,
  car,
  freeze,
  loading,
  left,
}: {
  race: RaceLobby;
  me: string;
  car: string | null;
  freeze: Record<string, BlindFreeze | null> | null;
  loading: boolean;
  left: number;
}) {
  const r = race.race;
  const need = r.calls_needed ?? [];
  if (loading) return <p className="px-5 pt-24 text-lg font-bold">{COPY.race.loading}</p>;
  const owing = race.players.filter((p) => {
    const c = raceCarOf(race, p.name);
    return c != null && need.includes(c);
  });
  const waiting = owing.filter((p) => !r.called.includes(p.name)).length;
  return (
    <>
      <Head race={race} me={me} status={`${COPY.race.freezeTag(r.freeze_index + 1, r.freeze_count)} · ${COPY.race.lapTag(r.freeze_lap ?? 0, r.total_laps)}`}>
        <h1 className="display text-[2.75rem] leading-[0.95]">{car ? COPY.race.noCallTitle(car) : COPY.race.watching}</h1>
        <p className="mt-3 text-lg font-medium leading-snug">{COPY.race.noCallSub}</p>
      </Head>
      <div className="flex flex-1 flex-col gap-5 px-5 pb-6 pt-[22px]">
        {need.length > 0 && <span className="meta">{COPY.race.callFor(need)}</span>}
        {need.map((c) => {
          const f = freeze?.[c];
          return f ? <Triggers key={c} freeze={f} size="phone" showCar /> : null;
        })}
        <ol className="flex flex-wrap gap-1.5">
          {owing.map((p) => (
            <li key={p.name} className={`inline-flex h-8 max-w-[14ch] items-center truncate px-2.5 text-sm font-black ${r.called.includes(p.name) ? "bg-ink text-white" : "bg-current/10 shadow-[inset_0_-2px_0_currentColor]"}`}>
              {p.name}
            </li>
          ))}
        </ol>
      </div>
      <Foot title={left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(waiting)} meta={`${left} s`} />
    </>
  );
}

// Round 7: after a freeze the race goes on. No right call, swing or score until the flag.
function Locked({ left }: { left: number }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-5 pb-24">
      <p className="display text-[3rem] leading-none">{COPY.end.lockedTitle}</p>
      <p className="text-lg font-medium">{COPY.end.lockedSub}</p>
      <p className="nums text-base font-bold">{COPY.end.lockedIn(left)}</p>
    </div>
  );
}
