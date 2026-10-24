"use client";
// The phone in a race lobby (Round 6): join (with the race's driver list in a "choose" lobby), wait, follow the
// replay with telemetry and the audible control, make the call at each freeze where your car has one (the
// existing CallPad), "no call needed" otherwise, a short freeze reveal, and your race result at the flag.
// No scores show mid-race.
import { useState, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { ApiError, api, type BlindDriver, type BlindFreeze, type JoinResponse, type LobbyStateResponse, type RaceEntry } from "@/lib/client/api";
import { fieldStyle } from "@/lib/client/field";
import type { DataMode } from "@/lib/client/mode";
import { CALL_WINDOW_S, fmtGap, tla } from "@/lib/client/race";
import {
  REVEAL_HOLD_MS,
  clockLap,
  freezeDecision,
  numberOf,
  raceCarOf,
  racePhase,
  replayDecision,
  useAudibleCooldown,
  useFreezeReveal,
  useRaceBoard,
  useRaceEntry,
  useRaceFrames,
  useRaceFreeze,
  useRaceReveal,
  type RaceLobby,
} from "@/lib/client/raceLobby";
import { telemetry } from "@/lib/client/telemetry";
import { useTicker, type Conn } from "@/lib/client/useLobby";
import type { LapFrame } from "@/lib/types";
import { CallPad } from "../play/CallPad";
import { FieldHead, Foot, JoinForm } from "../play/PlayScreen";
import { LapChart, NeighbourList, simpleChartLabel } from "../Telemetry";
import { CallWord, ConnNotice, ErrorText, ModeToggle, ScChip, TrackStrip, TyreChip } from "../ui";
import { RaceProgress, Triggers } from "./parts";

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
  const freezeRev = useFreezeReveal(code, joined && phase === "reveal_freeze" ? r.freeze_lap : null);
  const full = useRaceReveal(code, joined && phase === "done");
  const board = useRaceBoard(r.race_key, code, "done", joined && phase === "done");
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
      {phase === "reveal_freeze" && <FreezeResult race={race} me={me} car={myCar} rev={freezeRev} left={Math.max(0, Math.ceil((REVEAL_HOLD_MS - elapsed) / 1000))} />}
      {phase === "done" && <RaceResult race={race} me={me} car={myCar} board={board} full={full} />}
    </main>
  );
}

function Head({ race, me, status, children }: { race: RaceLobby; me: string; status: React.ReactNode; children: React.ReactNode }) {
  return (
    <FieldHead status={status} right={tla(me)}>
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
      <FieldHead status={COPY.phone.waitingStatus} right={tla(me)}>
        <div className="display rise text-[4rem] leading-[0.9]">{COPY.play.youAre(tla(me))}</div>
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
            <li key={p.name} className={`rise grid h-10 grid-cols-[40px_64px_1fr] items-center font-mono text-[15px] ${p.name === me ? "-mx-2 bg-field px-2 font-bold text-on-field" : "border-b border-soft-2"}`}>
              <span>{i + 1}</span>
              <span className="font-bold">{tla(p.name)}</span>
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate font-sans font-medium">{p.name}</span>
                {(p.driver_code || race.driver_code) && <span className="text-xs font-bold">{p.driver_code || race.driver_code}</span>}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-base text-ink-2">{COPY.race.audible.hint}</p>
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
                className={`grid h-10 grid-cols-[32px_6px_1fr_80px_60px] items-center gap-x-2 font-mono text-[15px] ${isMe ? "-mx-2 bg-field px-2 font-bold text-on-field" : "border-b border-soft-2 font-medium"}`}
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
      {(note || err || cooling) && (
        <div className="bg-white px-5 pb-2 pt-2 text-sm font-bold" aria-live="polite">
          {err ? <ErrorText>{err}</ErrorText> : cooling ? <p className="nums">{COPY.race.audible.cooldown(next!)} · {COPY.race.audible.lapsLeft(left)}</p> : <p>{note}</p>}
        </div>
      )}
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
          <span className="nums text-[13px] font-medium text-[#BDBDBD]">{cooling ? COPY.race.audible.lapsLeft(left) : COPY.race.audible.ready}</span>
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
            <li key={p.name} className={`inline-flex h-8 items-center px-2 text-sm font-black ${r.called.includes(p.name) ? "bg-ink text-white" : "border border-dashed border-ink"}`}>
              {tla(p.name)}
            </li>
          ))}
        </ol>
      </div>
      <Foot title={left === 0 ? COPY.freeze.timeUp : COPY.freeze.waitingOn(waiting)} meta={`${left} s`} />
    </>
  );
}

// Minimal freeze reveal on the phone: your take, then the right call for your car. No scores mid-race.
function FreezeResult({ race, me, car, rev, left }: { race: RaceLobby; me: string; car: string | null; rev: ReturnType<typeof useFreezeReveal>; left: number }) {
  const r = race.race;
  if (!rev) return <p className="px-5 pt-24 text-lg font-bold">{COPY.reveal.grading}</p>;
  const mineCalled = car ? rev.drivers[car] : null;
  const take = rev.calls.find((c) => c.kind === "freeze" && c.player_name === me);
  const shown = mineCalled ? [[car!, mineCalled] as const] : Object.entries(rev.drivers).filter((e) => e[1] != null);
  return (
    <>
      <Head race={race} me={me} status={COPY.race.revealTag(r.freeze_index + 1, r.freeze_count, rev.lap)}>
        {mineCalled ? (
          <>
            <span className="meta">{COPY.race.yourCall}</span>
            <p className="display mt-1 text-[3rem] leading-none">{take?.call ? COPY.freeze.options[take.call] : COPY.race.noCall}</p>
            {take?.transcript && <q className="mt-3 block text-lg leading-snug">{take.transcript}</q>}
          </>
        ) : (
          <h1 className="display text-[2.5rem] leading-[0.95]">{car ? COPY.race.noCallHere(car) : COPY.race.watching}</h1>
        )}
      </Head>
      <div className="flex flex-1 flex-col gap-4 px-5 pb-6 pt-[22px]">
        {shown.map(([c, d]) =>
          d ? (
            <section key={c} className="rise flex flex-col gap-1 border-t-2 border-ink pt-3">
              <span className="meta">{c}</span>
              <span className="display text-[2.25rem] leading-none">{COPY.race.winning(d.correct)}</span>
              <span className="nums text-lg font-bold">{d.swing_s != null && !d.swing_deferred ? `${COPY.race.worthLabel}: ${COPY.race.worth(d.swing_s)}` : COPY.race.worthDeferred}</span>
            </section>
          ) : null,
        )}
      </div>
      <Foot title={COPY.race.resumeIn(left)} />
    </>
  );
}

// At the flag: race score, rank in the lobby, each freeze and each audible.
function RaceResult({
  race,
  me,
  car,
  board,
  full,
}: {
  race: RaceLobby;
  me: string;
  car: string | null;
  board: ReturnType<typeof useRaceBoard>;
  full: ReturnType<typeof useRaceReveal>;
}) {
  if (!board || !full) return <p className="px-5 pt-24 text-lg font-bold">{COPY.reveal.grading}</p>;
  const players = board.rows.filter((r) => r.kind === "player");
  const rank = players.findIndex((r) => r.name === me) + 1;
  const row = players.find((r) => r.name === me) ?? null;
  const audibles = full.calls.filter((c) => c.kind === "audible" && c.player_name === me);
  const bench = board.rows.filter((r) => r.kind !== "player" && r.driver_code === car);
  return (
    <>
      <Head race={race} me={me} status={COPY.race.flagTitle}>
        <span className="meta">{COPY.race.scoreTitle}</span>
        <p className="nums display mt-1 text-[4.5rem] leading-none">{row?.total ?? 0}</p>
        {rank > 0 && <p className="mt-2 text-lg font-bold">{COPY.race.rank(rank, players.length)}</p>}
      </Head>
      <div className="flex flex-1 flex-col gap-6 px-5 pb-8 pt-[22px]">
        <section>
          <span className="meta block border-b-2 border-ink pb-1">{COPY.race.breakdown}</span>
          <ol>
            {full.freezes
              .filter((f) => car && f.drivers[car])
              .map((f) => {
                const mine = row?.freezes.find((x) => x.lap === f.lap);
                const d = f.drivers[car!]!;
                return (
                  <li key={f.lap} className="grid grid-cols-[48px_1fr_auto] items-center gap-x-3 border-b border-line py-2.5">
                    <span className="nums text-sm font-bold">{COPY.race.freezeCol(f.lap)}</span>
                    <span className="flex flex-col">
                      <CallWord call={mine?.call ?? null} className="text-lg font-black" />
                      <span className="text-xs text-ink-2">{COPY.race.winning(d.correct)}</span>
                    </span>
                    <span className="nums text-lg font-bold">{mine?.total ?? 0}</span>
                  </li>
                );
              })}
          </ol>
        </section>
        <section>
          <span className="meta block border-b-2 border-ink pb-1">{COPY.race.audiblesTitle}</span>
          {audibles.length === 0 ? (
            <p className="mt-2 text-base text-ink-2">{COPY.race.noAudibles}</p>
          ) : (
            <ol>
              {audibles.map((a) => (
                <li key={a.lap} className="grid grid-cols-[48px_1fr_auto] items-center gap-x-3 border-b border-line py-2.5">
                  <span className="nums text-sm font-bold">{COPY.race.freezeCol(a.lap)}</span>
                  <span className="text-sm font-bold">{COPY.race.audibleStatus[a.status] ?? a.status}</span>
                  <span className="nums text-lg font-bold">{a.status === "scored" ? COPY.race.pts(a.total) : "0"}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        {bench.length > 0 && (
          <section>
            <span className="meta block border-b-2 border-ink pb-1">{COPY.phone.teamEngine}</span>
            <ol>
              {bench.map((b) => (
                <li key={b.name} className="flex items-center justify-between border-b border-line py-2.5 text-base">
                  <span className="font-bold">{b.name}</span>
                  <span className="nums font-bold">{b.total}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </>
  );
}
