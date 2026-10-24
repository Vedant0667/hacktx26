"use client";
// Phone duel screen after the reveal: the two players as full-width bands (Box, then Stay out), the speaker's
// 10 s spotlight, "You're up" for the two duelling players, then the vote and the live tally.
// Server strings (names, summaries) are rendered as React text only.
import { useState } from "react";
import { COPY } from "@/lib/copy";
import type { DuelResponse } from "@/lib/client/api";
import { DUEL_SPEAK_MS, type DuelStage } from "@/lib/client/duel";
import { tla } from "@/lib/client/race";
import { DuelTally } from "../Duel";
import { Brand, CallWord, Check, ErrorText } from "../ui";

export function DuelVote({
  duel,
  me,
  stage,
  left,
  opensIn,
  vote,
  onDone,
}: {
  duel: DuelResponse;
  me: string;
  stage: DuelStage;
  // Seconds left in the current speaking turn.
  left: number;
  // Seconds until voting opens.
  opensIn: number;
  vote: (c: 0 | 1) => Promise<void>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const pair = duel.pair!;
  const speaker = stage === "a" ? 0 : stage === "b" ? 1 : null;
  const myTurn = speaker != null && pair[speaker].name === me;
  const voted = duel.my_vote != null;
  const canVote = stage === "vote" && !voted;

  async function cast(c: 0 | 1) {
    if (!canVote || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await vote(c);
    } catch {
      setErr(COPY.duel.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex min-h-dvh flex-col">
      <div className="bg-field text-on-field">
        <div className="flex h-[52px] items-center justify-between gap-3 px-5">
          <span className="meta flex items-center gap-2.5 text-[13px]">
            <Brand kind="mark" height={13} />
            {COPY.duel.status}
          </span>
          <span className="meta text-[13px]">{tla(me)}</span>
        </div>
        <div className="px-5 pb-6 pt-2">
          <h1 className="display text-[2.75rem] leading-[0.95]">{myTurn ? COPY.duel.youreUp : COPY.duel.title}</h1>
          <p className="mt-3 text-lg font-bold leading-snug">
            {myTurn ? COPY.duel.youreUpHint : speaker != null ? COPY.duel.speaking(pair[speaker].name) : voted ? COPY.duel.voteIn : stage === "vote" ? COPY.duel.vote : COPY.duel.listen}
          </p>
          {speaker != null && (
            <div className="mt-4 flex items-end gap-4">
              <span key={left} className="nums tick text-[5rem] font-bold leading-none tracking-[-0.04em]" aria-live="polite">
                {left}
              </span>
              <div className="mb-3 h-1.5 flex-1 bg-current/20" aria-hidden>
                <div className="countdown-bar h-full bg-current" style={{ animationDuration: `${DUEL_SPEAK_MS / 1000}s`, animationDelay: `-${(DUEL_SPEAK_MS / 1000 - left)}s` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pt-5">
        {voted ? (
          <DuelTally duel={duel} />
        ) : (
          stage !== "vote" && <p className="nums text-sm font-bold">{COPY.duel.opensIn(opensIn)}</p>
        )}
        <div className="mt-3 min-h-6">
          <ErrorText>{err}</ErrorText>
        </div>
        {duel.prompt && !voted && <p className="text-xl font-bold leading-snug">{duel.prompt}</p>}
        {duel.source === "muse" && <p className="mt-auto pb-4 text-xs text-ink-2">{COPY.duel.museCredit}</p>}
      </div>

      <div role="group" aria-label={COPY.duel.vote} className="sticky bottom-0">
        {pair.map((p, i) => {
          const mineVote = duel.my_vote === i;
          const dark = i === 1;
          const dim = (voted && !mineVote) || (speaker != null && speaker !== i);
          return (
            <button
              key={p.name}
              type="button"
              onClick={() => void cast(i as 0 | 1)}
              disabled={!canVote || busy}
              aria-pressed={mineVote}
              aria-label={COPY.duel.voteFor(p.name)}
              className={`flex w-full flex-col gap-1 px-6 py-4 text-left transition-[background-color,color,opacity] duration-200 disabled:cursor-default ${
                dark ? "on-dark bg-ink text-white" : "border-t-2 border-ink bg-white text-ink"
              } ${dim ? "opacity-60" : ""}`}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-[1.75rem] font-black tracking-[-0.02em]">{tla(p.name)}</span>
                <span className="meta flex items-center gap-2">
                  {mineVote && <Check />}
                  <CallWord call={p.call} />
                  {p.driver_code && <span>· {p.driver_code}</span>}
                </span>
              </span>
              <q className="line-clamp-2 text-base font-medium leading-snug">{p.summary}</q>
            </button>
          );
        })}
        {voted && (
          <button type="button" onClick={onDone} className="on-dark flex h-16 w-full items-center justify-between border-t border-white/15 bg-ink px-6 pb-[env(safe-area-inset-bottom)] text-lg font-bold text-white">
            {COPY.duel.next}
          </button>
        )}
      </div>
    </section>
  );
}
