"use client";
// The player's result on the phone, from revealData only: your call on the team-colour field, then the
// numbers as rows (percentile, called in, engine, score), badges, your Muse camp, and tap-to-open sections.
import { useEffect, useState } from "react";
import Link from "next/link";
import { COPY, factorLabel } from "@/lib/copy";
import { api, type CampsResponse, type LeaderboardResponse, type LobbyStateResponse, type RevealDecision } from "@/lib/client/api";
import { recallResult } from "@/lib/client/identity";
import { MAX_TOTAL, REASONING_MAX, badgesFor, callMomentFrames, perFactor, tla } from "@/lib/client/race";
import { neighbourCalls, telemetry } from "@/lib/client/telemetry";
import { driverCodeOf } from "@/lib/client/drivers";
import { benchmarksFor } from "../host/cars";
import type { DataMode, GroundTruthFile } from "@/lib/client/mode";
import type { LapFrame } from "@/lib/types";
import { Measured } from "../Measured";
import { NeighbourList } from "../Telemetry";
import { DuelTally } from "../Duel";
import type { DuelResponse } from "@/lib/client/api";
import { Brand, CallWord, Check, ModeToggle, Section, Tag, clockText } from "../ui";

export function PlayerResult({
  code,
  me,
  decision,
  frames,
  lobby,
  mode,
  setMode,
  gt,
  duel,
}: {
  code: string;
  me: string;
  decision: RevealDecision;
  frames: LapFrame[];
  lobby: LobbyStateResponse;
  mode: DataMode;
  setMode: (m: DataMode) => void;
  gt: GroundTruthFile | null;
  duel?: DuelResponse | null;
}) {
  const [lb, setLb] = useState<LeaderboardResponse | null>(null);
  const [camps, setCamps] = useState<CampsResponse | null>(null);
  const [stored] = useState(() => recallResult(code, decision.id));

  useEffect(() => {
    api.leaderboard(decision.id, code).then(setLb).catch(() => {});
    api.camps(code).then(setCamps).catch(() => {});
  }, [decision.id, code, lobby.phase, lobby.submissions.length]);

  const correct = decision.ground_truth.correct;
  const mine = lobby.submissions.find((s) => s.player_name === me) ?? stored?.submission ?? null;
  const myRow = lb?.rows.find((r) => r.kind === "player" && r.name === me && r.lobby_code === code);
  const pct = myRow?.percentile ?? stored?.percentile ?? null;
  const ranked = [...lobby.submissions].sort((a, b) => b.total - a.total);
  const rank = mine ? ranked.findIndex((s) => s.player_name === me) + 1 || stored?.lobby_rank || 0 : 0;
  const friends = lobby.submissions.filter((s) => s.player_name !== me);
  // Team and engine rows for this player's own car (per-car benchmarks in "choose" lobbies).
  const bench = benchmarksFor(lb, driverCodeOf(lobby, me));
  const badges = mine ? badgesFor(mine, decision, bench.team?.total ?? null, bench.engine?.total ?? null) : null;
  const badgeNames = badges ? ([badges.winning && COPY.badges.winning.name, badges.team && COPY.badges.team.name, badges.engine && COPY.badges.engine.name].filter(Boolean) as string[]) : [];
  const adv = mode === "advanced";
  const named = mine ? mine.factors_named.filter((f) => decision.factors.includes(f)) : [];
  const camp = camps?.labels?.find((c) => c.players.includes(me)) ?? null;

  // The cars either side at the call, and what they actually did (the full frames arrive with the reveal).
  const tele = telemetry(callMomentFrames(frames, decision), decision);
  const calls = tele ? neighbourCalls(frames, decision, { ahead: tele.neighbours.ahead?.number, behind: tele.neighbours.behind?.number }) : null;

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 border-b border-soft-2 py-3.5">
      <span className="meta">{label}</span>
      <span className="nums text-[1.75rem] font-bold tracking-[-0.03em]">{value}</span>
    </div>
  );

  return (
    <>
      <div className="bg-field text-on-field">
        <div className="flex h-[52px] items-center justify-between gap-3 px-5">
          <span className="meta flex items-center gap-2.5 text-[13px]">
            <Brand kind="mark" height={13} />
            {COPY.phone.resultStatus(decision.race, decision.lap)}
          </span>
          <span className="meta text-[13px]">{tla(me)}</span>
        </div>
        <div className="rise px-5 pb-[26px] pt-1.5">
          <div className="meta mb-2">{COPY.phone.yourCall}</div>
          <div className="display text-[6.875rem] leading-[0.85] tracking-[-0.05em]">
            <CallWord call={mine?.call ?? null} />
          </div>
          <p className="mt-3.5 text-2xl font-black leading-[1.15] tracking-[-0.02em]">
            {mine?.call === correct ? COPY.phone.rightCall : COPY.phone.otherCall(correct)}{" "}
            <span className="font-medium">{COPY.phone.worth(correct, decision.ground_truth.swing_s, decision.player_role.team, decision.team.call)}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-6 pt-1.5">
        {mine && (
          <>
            {pct != null && row(COPY.phone.percentile, COPY.phone.top(pct))}
            {row(COPY.phone.calledIn, clockText(mine.seconds_to_call))}
            {row(COPY.phone.engineSaid, COPY.phone.engineValue(decision.engine.call, Math.round(decision.engine.confidence * 100)))}
            {row(COPY.phone.score, <>{mine.total}<span className="text-base font-medium text-ink-2"> / {MAX_TOTAL}</span></>)}
            {rank > 0 && <p className="nums mt-2 text-sm text-ink-2">{COPY.score.lobbyRank(rank, lobby.submissions.length || 1)}</p>}

            <div className="meta mt-[18px]">{COPY.phone.badges}</div>
            {badgeNames.length ? (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {badgeNames.map((b) => (
                  <span key={b} className="border-2 border-ink px-2.5 py-1.5 text-sm font-bold">
                    {b}
                  </span>
                ))}
              </div>
            ) : (
              lb && <p className="mt-2 text-sm text-ink-2">{COPY.badges.none}</p>
            )}

            {camp && (
              <div className="mt-[18px] bg-soft px-4 py-3.5">
                <div className="meta">{COPY.phone.yourCamp(camp.call === "MIXED" ? COPY.reveal.mixed : camp.call ? COPY.freeze.options[camp.call] : COPY.reveal.noCall, camp.players.filter((p) => p !== me).map(tla))}</div>
                <q className="mt-1.5 block text-[1.375rem] font-black tracking-[-0.02em] [quotes:none]">&ldquo;{camp.label}&rdquo;</q>
                <div className="nums mt-2 text-xs">{COPY.phone.campCount(camp.count, lobby.submissions.length)}</div>
              </div>
            )}
          </>
        )}
        {!mine && <p className="mt-6 text-2xl font-black tracking-tight">{COPY.freeze.noCall}</p>}

        <div className="mt-6 flex items-center justify-between">
          <span className="meta">{COPY.mode.label}</span>
          <ModeToggle mode={mode} onChange={setMode} size="sm" />
        </div>

        <div className="mt-4">
          {duel?.pair && (
            <Section title={COPY.duel.title} meta={<span className="nums">{COPY.duel.tally(duel.votes[0], duel.votes[1])}</span>} open>
              <DuelTally duel={duel} />
              {duel.source === "muse" && <p className="mt-3 text-xs text-ink-2">{COPY.duel.museCredit}</p>}
            </Section>
          )}
          {tele && calls && (
            <Section title={COPY.phone.neighbours} open>
              <NeighbourList t={tele} revealed={calls} />
            </Section>
          )}
          {mine && (
            <Section title={COPY.phone.howScored} meta={<span className="nums">{named.length}/{decision.factors.length}</span>} open={adv}>
              <div className="flex flex-col gap-3">
                {mine.transcript && <q className="text-lg leading-snug">{mine.transcript}</q>}
                <p className="text-sm text-ink-2">{COPY.reveal.playerFactors(named.length, decision.factors.length, named.map((f) => factorLabel(f).toLowerCase()).join(", "))}</p>
                <ul className="flex flex-col">
                  {decision.factors.map((f) => {
                    const hit = mine.factors_named.includes(f);
                    return (
                      <li key={f} className="flex min-h-11 items-center gap-3 border-b border-soft-2 text-base">
                        <span className={`inline-grid size-6 place-items-center ${hit ? "bg-ink text-white" : "border border-soft-2 text-ink-3"}`} aria-label={hit ? "yes" : "no"}>
                          {hit ? <Check /> : <span aria-hidden>–</span>}
                        </span>
                        <span className={hit ? "font-bold" : "text-ink-2"}>{factorLabel(f)}</span>
                        {adv && <span className="nums ml-auto text-sm text-ink-2">{hit ? `+${Math.round(perFactor(decision))}` : "0"}</span>}
                      </li>
                    );
                  })}
                </ul>
                {adv && (
                  <>
                    <p className="nums text-sm">{COPY.score.equation(mine.score_call, mine.score_reasoning, mine.total)}</p>
                    <p className="text-sm">{COPY.reveal.factorRuleFor(decision.factors.length, REASONING_MAX, decision.factors.map((f) => factorLabel(f).toLowerCase()).join(", "))}</p>
                    <Measured decision={decision} gt={gt} size="sm" />
                  </>
                )}
              </div>
            </Section>
          )}
          {friends.length > 0 && (
            <Section title={COPY.phone.room} meta={<span className="nums">{friends.length}</span>}>
              <ol className="flex flex-col">
                {friends.map((s) => (
                  <li key={s.player_name} className="flex flex-col gap-1.5 border-b border-soft-2 py-3">
                    <div className="flex items-center gap-3">
                      <Tag code={tla(s.player_name)} size="sm" />
                      <CallWord call={s.call} className="text-lg font-black tracking-tight" />
                      {s.call === correct && <span className="meta">{COPY.reveal.right}</span>}
                      <span className="nums ml-auto text-base font-bold">{s.total}</span>
                    </div>
                    {s.transcript && <q className="text-sm leading-snug text-ink-2">{s.transcript}</q>}
                  </li>
                ))}
              </ol>
            </Section>
          )}
          <Section title={COPY.phone.teamEngine} open={adv}>
            <div className="flex flex-col">
              <div className="flex flex-col gap-1 border-b border-soft-2 pb-4">
                <span className="meta text-ink-2">{COPY.reveal.team}</span>
                <span className="text-xl font-black tracking-tight">{COPY.reveal.teamRow(decision.player_role.team, decision.team.call)}</span>
                <span className="text-sm text-ink-2">{COPY.reveal.outcome[decision.id] ?? decision.team.reasons[0] ?? ""}</span>
              </div>
              <div className="flex flex-col gap-1 pt-4">
                <span className="meta text-ink-2">{COPY.reveal.engine}</span>
                <span className="nums text-xl font-bold">{COPY.reveal.engineRow(decision.engine.call, Math.round(decision.engine.confidence * 100))}</span>
                <ol className={`mt-1 flex flex-col gap-1 text-sm ${adv ? "list-decimal pl-5" : ""}`}>
                  {(adv ? decision.engine.reasons : decision.engine.reasons.slice(0, 1)).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ol>
              </div>
            </div>
          </Section>
        </div>
      </div>

      <Link
        href="/leaderboard"
        className="on-dark sticky bottom-0 mt-auto flex h-[84px] items-center justify-between bg-ink px-6 pb-[env(safe-area-inset-bottom)] text-white hover:bg-[#262626]"
      >
        <b className="text-xl">{COPY.home.leaderboard}</b>
        {mine && <span className="nums text-[13px] text-[#BDBDBD]">{COPY.phone.scoreFoot(mine.total)}</span>}
      </Link>
    </>
  );
}
