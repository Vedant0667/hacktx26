"use client";
// The player's own result on the phone: verdict, percentile, score, badges, their row, then friends, team and engine.
import { useEffect, useState } from "react";
import { COPY, factorLabel } from "@/lib/copy";
import { api, type LeaderboardResponse, type LobbyStateResponse } from "@/lib/client/api";
import { recallResult } from "@/lib/client/identity";
import { MAX_TOTAL, badgesFor, tla } from "@/lib/client/race";
import type { DecisionPoint } from "@/lib/types";
import { BadgeTags, CallWord, Label } from "../ui";
import { Measured } from "../host/HostReveal";
import type { DataMode, GroundTruthFile } from "@/lib/client/mode";

export function PlayerResult({
  code,
  me,
  decision,
  lobby,
  mode,
  gt,
}: {
  code: string;
  me: string;
  decision: DecisionPoint;
  lobby: LobbyStateResponse;
  mode: DataMode;
  gt: GroundTruthFile | null;
}) {
  const [lb, setLb] = useState<LeaderboardResponse | null>(null);
  const [stored] = useState(() => recallResult(code, decision.id));

  useEffect(() => {
    api.leaderboard(decision.id).then(setLb).catch(() => {});
  }, [decision.id, lobby.phase]);

  const correct = decision.ground_truth.correct;
  const mine = lobby.submissions.find((s) => s.player_name === me) ?? stored?.submission ?? null;
  const pct =
    stored?.percentile ?? lb?.rows.find((r) => r.kind === "player" && r.name === me && r.lobby_code === code)?.percentile ?? null;
  const ranked = [...lobby.submissions].sort((a, b) => b.total - a.total);
  const rank = mine ? ranked.findIndex((s) => s.player_name === me) + 1 || stored?.lobby_rank || 0 : 0;
  const friends = lobby.submissions.filter((s) => s.player_name !== me);
  const badges = mine ? badgesFor(mine, decision, lb?.team.total ?? null, lb?.engine.total ?? null) : null;
  const anyBadge = badges && (badges.team || badges.engine || badges.winning);

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-40 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.reveal.verdict(correct)}</h1>
        <p className="text-20 text-ink-2">{COPY.reveal.swing(correct, decision.ground_truth.swing_s, decision.reveal_to_lap)}</p>
      </div>

      {!mine ? (
        <p className="text-24 font-semibold">{COPY.freeze.noCall}</p>
      ) : (
        <>
          {pct != null && (
            <div className="flex flex-col">
              <span className="text-20">{COPY.score.percentile(pct).pre}</span>
              <span className="nums text-96 font-extrabold stretch-125 leading-hero">{COPY.score.percentile(pct).num}</span>
              <span className="text-20">{COPY.score.percentile(pct).post}</span>
              {lb && <span className="mt-1 text-16 text-ink-3">{COPY.score.percentileHelp(lb.total_players - 1)}</span>}
            </div>
          )}
          <div className="flex flex-col gap-1">
            <p className="nums text-24 font-semibold">{COPY.score.line(mine.total, MAX_TOTAL, mine.score_call, mine.score_reasoning)}</p>
            {rank > 0 && <p className="nums text-20 text-ink-2">{COPY.score.lobbyRank(rank, lobby.submissions.length || 1)}</p>}
          </div>
          {badges && (anyBadge ? <BadgeTags badges={badges} /> : lb && <p className="text-20 text-ink-2">{COPY.badges.none}</p>)}

          <div className="flex flex-col gap-3 bg-ink p-4 text-bg">
            <div className="flex items-baseline gap-3">
              <CallWord call={mine.call} className="text-40" />
              {mine.call === correct && <span className="text-16 font-semibold uppercase tracking-label">{COPY.reveal.right}</span>}
            </div>
            {mine.transcript && <q className="text-20">{mine.transcript}</q>}
            <p className="text-16">
              {COPY.reveal.playerFactors(
                mine.factors_named.filter((f) => decision.factors.includes(f)).length,
                decision.factors.length,
                mine.factors_named
                  .filter((f) => decision.factors.includes(f))
                  .map((f) => factorLabel(f).toLowerCase())
                  .join(", "),
              )}
            </p>
            <ul className="flex flex-col gap-1 text-20">
              {decision.factors.map((f) => (
                <li key={f} className="flex gap-3">
                  <span className="w-5 text-center">{mine.factors_named.includes(f) ? COPY.reveal.named : COPY.reveal.notNamed}</span>
                  {factorLabel(f)}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {friends.length > 0 && (
        <ol className="flex flex-col gap-0.5">
          {friends.map((s) => (
            <li key={s.player_name} className="flex flex-col gap-1 bg-surface p-4">
              <div className="flex items-baseline gap-3">
                <span className="text-24 font-bold uppercase stretch-75">{tla(s.player_name)}</span>
                <CallWord call={s.call} className={`text-24 ${s.call === correct ? "" : "text-ink-2"}`} />
                {s.call === correct && <span className="text-14 font-semibold uppercase tracking-label text-flag-green">{COPY.reveal.right}</span>}
                <span className="nums ml-auto text-20">{s.total}</span>
              </div>
              {s.transcript && <q className="text-16 text-ink-2">{s.transcript}</q>}
            </li>
          ))}
        </ol>
      )}

      <div className="flex flex-col gap-0.5">
        <div className="flex flex-col gap-1 bg-surface p-4">
          <Label>{COPY.reveal.team}</Label>
          <span className="text-24 font-bold">{COPY.reveal.teamRow(decision.player_role.team, decision.team.call)}</span>
          <span className="text-16 text-ink-2">{COPY.reveal.outcome[decision.id] ?? decision.team.reasons[0] ?? ""}</span>
        </div>
        <div className="flex flex-col gap-1 bg-engine-deep p-4">
          <Label className="text-ink">{COPY.reveal.engine}</Label>
          <span className="nums text-24 font-bold">{COPY.reveal.engineRow(decision.engine.call, Math.round(decision.engine.confidence * 100))}</span>
          <ol className={`flex flex-col gap-1 text-16 ${mode === "advanced" ? "list-decimal pl-5" : ""}`}>
            {(mode === "advanced" ? decision.engine.reasons : decision.engine.reasons.slice(0, 1)).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ol>
        </div>
      </div>
      {mode === "advanced" && <Measured decision={decision} gt={gt} size="sm" />}
    </section>
  );
}
