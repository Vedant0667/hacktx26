"use client";
// Round 7: the phone's one end screen. Your result first (call ✓/✗, reasoning score and verdict, points,
// rank), then what happened, everyone's call, and the final ranking. "Scoring the calls" while the server grades.
import Link from "next/link";
import { COPY } from "@/lib/copy";
import type { LobbyStateResponse, ResultsResponse } from "@/lib/client/api";
import { useResults } from "@/lib/client/results";
import { tla } from "@/lib/client/race";
import { Brand, CallWord } from "../ui";
import { CarChip, Happened, RankingTable, RightMark, ScoreLine, Scoring } from "../EndScreen";

export function PlayerResult({ code, me, lobby, elapsed }: { code: string; me: string; lobby: LobbyStateResponse; elapsed: number }) {
  const { results, failed } = useResults(code, lobby.phase);
  if (!results) return <Scoring elapsedMs={elapsed} failed={failed} />;
  return <PhoneEnd me={me} results={results} />;
}

function PhoneEnd({ me, results }: { me: string; results: ResultsResponse }) {
  const mine = results.takes.find((t) => t.name === me) ?? null;
  const myCar = mine?.driver_code ?? results.cars[0]?.code ?? null;
  const engine = results.ranking.find((r) => r.kind === "engine" && r.driver_code === myCar);
  const beatEngine = !!mine?.call && !!engine && mine.points > engine.points;
  const players = results.ranking.filter((r) => r.kind === "player").length;
  const others = results.takes.filter((t) => t.name !== me);

  return (
    <>
      <div className="bg-field text-on-field">
        <div className="flex h-[52px] items-center justify-between gap-3 px-5">
          <span className="meta flex items-center gap-2.5 text-[13px]">
            <Brand kind="mark" height={13} />
            {COPY.phone.resultStatus(results.race, results.lap)}
          </span>
          <span className="meta text-[13px]">{tla(me)}</span>
        </div>
        <div className="rise px-5 pb-6 pt-1.5">
          <div className="meta mb-2">{COPY.end.yourCall}</div>
          <div className="flex items-baseline justify-between gap-4">
            <span className="display text-[5.5rem] leading-[0.85] tracking-[-0.05em]">
              <CallWord call={mine?.call ?? null} /> <RightMark right={mine?.right ?? null} className="text-[0.6em]" />
            </span>
            {mine && <span className="nums text-[2.5rem] font-black leading-none">{COPY.end.points(mine.points)}</span>}
          </div>
          {mine && <ScoreLine e={mine} className="mt-3 text-sm font-bold" />}
        </div>
      </div>

      <div className="flex flex-1 flex-col px-5 pb-6">
        {mine?.call ? (
          <div className="flex flex-col gap-1.5 border-b border-soft-2 py-4">
            <span className="flex items-baseline justify-between gap-4">
              <span className="meta">{COPY.end.reasoningLabel}</span>
              <span className="nums text-[1.75rem] font-bold">{COPY.end.reasoning(mine.reasoning)}</span>
            </span>
            {mine.verdict && <p className="text-lg leading-snug">{mine.verdict}</p>}
          </div>
        ) : (
          <p className="border-b border-soft-2 py-4 text-xl font-black">{COPY.freeze.noCall}</p>
        )}
        {mine && (
          <div className="flex items-baseline justify-between gap-4 border-b border-soft-2 py-4">
            <span className="meta">{COPY.end.rankHead}</span>
            <span className="nums text-[1.75rem] font-bold">{COPY.end.rankOf(mine.rank_label, players)}</span>
          </div>
        )}
        {beatEngine && <p className="pt-3 text-base font-bold">{COPY.end.beatEngine}</p>}

        <div className="mt-6 border-t-2 border-ink pt-4">
          <Happened results={results} carCode={myCar} />
        </div>

        {others.length > 0 && (
          <section className="mt-6 flex flex-col">
            <span className="meta border-b-2 border-ink pb-2">{COPY.end.takes}</span>
            <ol className="flex flex-col">
              {others.map((e) => (
                <li key={e.name} className="flex flex-col gap-1.5 border-b border-soft-2 py-3">
                  <div className="flex items-baseline gap-3">
                    <b className="text-xl font-black tracking-tight">{tla(e.name)}</b>
                    <span className="min-w-0 truncate text-sm">{e.name}</span>
                    <CarChip results={results} code={e.driver_code} className="text-xs" />
                    <span className="nums ml-auto text-lg font-black">{COPY.end.points(e.points)}</span>
                  </div>
                  <div className="flex items-baseline gap-2 text-lg font-black">
                    <CallWord call={e.call} />
                    <RightMark right={e.right} />
                  </div>
                  {e.said.trim() ? <q className="text-base leading-snug">{e.said}</q> : <p className="text-sm text-ink-2">{COPY.end.noReason}</p>}
                  {e.call && <ScoreLine e={e} className="text-xs font-bold" />}
                  {e.call && e.verdict && <p className="text-sm leading-snug text-ink-2">{e.verdict}</p>}
                </li>
              ))}
            </ol>
          </section>
        )}

        <section className="mt-6 flex flex-col gap-2">
          <span className="meta">{COPY.end.ranking}</span>
          <RankingTable results={results} me={me} size="phone" />
        </section>
        <p className="mt-5 text-sm text-ink-2">{COPY.end.how}</p>
      </div>

      <Link
        href="/leaderboard"
        className="on-dark sticky bottom-0 mt-auto flex h-[72px] items-center justify-between bg-ink px-6 pb-[env(safe-area-inset-bottom)] text-white hover:bg-[#262626]"
      >
        <b className="text-lg">{COPY.home.leaderboard}</b>
      </Link>
    </>
  );
}
