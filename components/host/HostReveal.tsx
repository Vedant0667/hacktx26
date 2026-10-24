"use client";
// Round 7: the host's one end screen, for both reveal and done. "Scoring the calls" while the server grades,
// then what happened, everyone's call side by side, and the final ranking. Fits 1440 x 900 with up to 12 players.
import { useRouter } from "next/navigation";
import { COPY } from "@/lib/copy";
import type { LobbyStateResponse, ResultEntry, ResultsResponse } from "@/lib/client/api";
import { useResults } from "@/lib/client/results";
import { tla } from "@/lib/client/race";
import { CallWord, Button } from "../ui";
import { CarChip, Happened, RankingTable, RightMark, ScoreLine, Scoring } from "../EndScreen";

export function HostReveal({ code, carCode, lobby, elapsed }: { code: string; carCode: string | null; lobby: LobbyStateResponse; elapsed: number }) {
  const { results, failed } = useResults(code, lobby.phase);
  if (!results) return <Scoring elapsedMs={elapsed} failed={failed} big />;
  return <HostEnd code={code} carCode={carCode} results={results} />;
}

function layout(n: number) {
  if (n <= 3) return { cols: Math.max(1, n), quote: "line-clamp-4 text-[1.75rem]", verdict: "text-lg", tag: "text-[3rem]" };
  if (n === 4) return { cols: 2, quote: "line-clamp-2 text-2xl", verdict: "text-base", tag: "text-[2.5rem]" };
  if (n <= 9) return { cols: 3, quote: n <= 6 ? "line-clamp-2 text-xl" : "line-clamp-1 text-lg", verdict: n <= 6 ? "text-base" : "line-clamp-1 text-sm", tag: "text-[2rem]" };
  return { cols: 4, quote: "line-clamp-1 text-base", verdict: "line-clamp-1 text-sm", tag: "text-2xl" };
}

function Take({ e, results, l }: { e: ResultEntry; results: ResultsResponse; l: ReturnType<typeof layout> }) {
  return (
    <li className="rise flex min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden border-t-2 border-ink pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex min-w-0 items-baseline gap-3">
          <b className={`display leading-none ${l.tag}`}>{tla(e.name)}</b>
          <span className="truncate text-base font-bold">{e.name}</span>
          <CarChip results={results} code={e.driver_code} />
        </span>
        <span className="nums shrink-0 text-[2rem] font-black leading-none tracking-[-0.03em]">{COPY.end.points(e.points)}</span>
      </div>
      <div className="flex items-baseline gap-2 text-2xl font-black tracking-tight">
        <CallWord call={e.call} />
        <RightMark right={e.right} />
      </div>
      {e.said.trim() ? <q className={`${l.quote} font-medium leading-snug`}>{e.said}</q> : <p className="text-base text-ink-2">{COPY.end.noReason}</p>}
      {e.call && (
        <>
          <ScoreLine e={e} className="text-sm font-bold" />
          {e.verdict && <p className={`${l.verdict} leading-snug text-ink-2`}>{e.verdict}</p>}
        </>
      )}
    </li>
  );
}

function HostEnd({ code, carCode, results }: { code: string; carCode: string | null; results: ResultsResponse }) {
  const router = useRouter();
  const l = layout(results.takes.length);
  return (
    <main className="grid h-dvh grid-cols-12 grid-rows-[auto_auto_minmax(0,1fr)_auto] gap-x-6 gap-y-6 overflow-hidden px-14 py-10">
      <header className="col-span-12 flex items-center justify-between gap-6 font-mono text-lg font-bold uppercase">
        <span>
          {results.race} · L{results.lap}
        </span>
        <span>{COPY.host.room(code)}</span>
      </header>
      <div className="col-span-12 border-b-2 border-ink pb-5">
        <Happened results={results} carCode={carCode} big />
      </div>

      <section className="col-span-8 flex min-h-0 flex-col gap-3">
        <span className="meta text-ink-2">{COPY.end.takes}</span>
        <ol className="grid min-h-0 flex-1 auto-rows-fr gap-x-8 gap-y-4" style={{ gridTemplateColumns: `repeat(${l.cols}, minmax(0, 1fr))` }}>
          {results.takes.map((e) => (
            <Take key={e.name} e={e} results={results} l={l} />
          ))}
        </ol>
      </section>

      <section className="col-span-4 flex min-h-0 flex-col gap-3 overflow-hidden">
        <span className="meta text-ink-2">{COPY.end.ranking}</span>
        <RankingTable results={results} />
      </section>

      <footer className="col-span-12 flex items-end justify-between gap-6 border-t-2 border-ink pt-4">
        <div className="flex max-w-[90ch] flex-col gap-1">
          <p className="text-lg font-bold">{COPY.end.how}</p>
          <p className="text-xs text-ink-2">{COPY.end.credit}</p>
        </div>
        <Button variant="primary" size="md" onClick={() => router.push("/")}>
          {COPY.end.newLobby}
        </Button>
      </footer>
    </main>
  );
}
