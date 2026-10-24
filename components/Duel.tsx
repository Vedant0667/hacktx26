// The post-reveal duel, shared by host and phone: the pair side by side (Box left, Stay out right) and the
// live tally. Names, summaries and the prompt are server strings: rendered as React text only.
import { COPY } from "@/lib/copy";
import type { DuelResponse, DuelSide } from "@/lib/client/api";
import { tla } from "@/lib/client/race";
import { CallWord } from "./ui";

export function DuelPerson({ side, active, big = false, cars }: { side: DuelSide; active: boolean; big?: boolean; cars?: Record<string, string | null> }) {
  const colour = side.driver_code ? cars?.[side.driver_code] : null;
  return (
    <div className={`flex min-w-0 flex-col gap-2 transition-opacity duration-300 ${active ? "" : "opacity-55"}`}>
      <span className="meta flex items-center gap-2">
        <CallWord call={side.call} />
        {side.driver_code && (
          <span className="inline-flex items-center gap-1.5">
            {colour && <span aria-hidden className="h-3 w-1" style={{ backgroundColor: colour }} />}
            {side.driver_code}
          </span>
        )}
      </span>
      <b className={`display leading-none ${big ? "text-5xl" : "text-[2.5rem]"}`}>{tla(side.name)}</b>
      <span className={`truncate font-bold ${big ? "text-xl" : "text-base"}`}>{side.name}</span>
      <q className={`font-medium leading-snug ${big ? "text-2xl" : "text-lg"}`}>{side.summary}</q>
    </div>
  );
}

export function DuelTally({ duel, big = false }: { duel: DuelResponse; big?: boolean }) {
  if (!duel.pair) return null;
  const [a, b] = duel.votes;
  const n = a + b;
  const share = n ? a / n : 0.5;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div className="flex items-baseline justify-between gap-4">
        <span className={`font-black ${big ? "text-2xl" : "text-lg"}`}>
          {tla(duel.pair[0].name)} <span className="nums">{a}</span>
        </span>
        <span className="meta">{COPY.duel.votes(n)}</span>
        <span className={`font-black ${big ? "text-2xl" : "text-lg"}`}>
          <span className="nums">{b}</span> {tla(duel.pair[1].name)}
        </span>
      </div>
      <div className={`flex border-2 border-current ${big ? "h-6" : "h-4"}`} aria-hidden>
        <div className="h-full bg-current transition-[width] duration-500 ease-out" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}
