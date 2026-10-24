// Race mode pieces shared by the host and the phone: the race progress bar with freeze markers, the trigger
// chips with the numbers behind them, and the running race score. All draw in currentColor where they can,
// so they read on white, on black and on the team-colour field.
import { COPY } from "@/lib/copy";
import type {
  BlindFreeze,
  RaceLeaderboardResponse,
  RaceRow,
} from "@/lib/client/api";
import { triggerText } from "@/lib/client/triggers";

// Lap 1 to the flag. Filled to the current lap; a tick per freeze already reached (blind: the replay reveals
// freezes only as it reaches them), the current freeze drawn solid.
export function RaceProgress({
  total,
  lap,
  past,
  current = null,
  size = "host",
}: {
  total: number;
  lap: number;
  past: number[];
  current?: number | null;
  size?: "host" | "phone";
}) {
  const x = (l: number) =>
    `${(Math.max(0, Math.min(total, l)) / total) * 100}%`;
  const marks = [
    ...new Set([...past, ...(current != null ? [current] : [])]),
  ].sort((a, b) => a - b);
  const h = size === "host" ? "h-3" : "h-2";
  return (
    <div
      className="flex flex-col gap-1.5"
      role="img"
      aria-label={`${COPY.race.progress}: ${COPY.race.lapTag(lap, total)}`}
    >
      <div className={`relative ${h} bg-current/15`}>
        <div
          className="h-full bg-current transition-[width] duration-700 ease-out"
          style={{ width: x(lap) }}
        />
        {marks.map((m) => (
          <span
            key={m}
            className={`absolute -top-1.5 w-[3px] -translate-x-1/2 ${m === current ? "bg-current" : "bg-current/70"} ${size === "host" ? "h-6" : "h-5"}`}
            style={{ left: x(m) }}
          />
        ))}
        <span
          className={`absolute -top-1.5 right-0 w-[3px] bg-current ${size === "host" ? "h-6" : "h-5"}`}
        />
      </div>
      <div
        className={`relative ${size === "host" ? "h-4 text-xs" : "h-3.5 text-[11px]"} font-mono font-bold`}
      >
        <span className="absolute left-0">L1</span>
        {marks.map((m) => (
          <span
            key={m}
            className="absolute -translate-x-1/2 whitespace-nowrap"
            style={{ left: x(m) }}
          >
            {COPY.race.freezeMark(m)}
          </span>
        ))}
        <span className="absolute right-0">{COPY.race.flag}</span>
      </div>
    </div>
  );
}

// Why the replay froze for one car: a square chip per trigger and the numbers behind it in plain words
// (lib/client/triggers.ts). compact: chips only (a second car at the same freeze), no numbers.
export function Triggers({
  freeze,
  size = "host",
  showCar = false,
  compact = false,
}: {
  freeze: BlindFreeze;
  size?: "host" | "phone";
  showCar?: boolean;
  compact?: boolean;
}) {
  const chip = size === "host" ? "h-9 px-3 text-base" : "h-7 px-2 text-sm";
  const lines = freeze.triggers.map((t) => ({ type: t.type, text: triggerText(t.type, t.info, freeze.driver_code) })).filter((x) => x.text);
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-wrap items-center gap-2">
        {showCar && (
          <li
            className={`flex items-center font-black tracking-tight ${size === "host" ? "text-2xl" : "text-lg"}`}
          >
            {freeze.driver_code}
          </li>
        )}
        {freeze.triggers.map((t) => {
          const flag = t.type === "SC" || t.type === "VSC";
          return (
            <li
              key={t.type}
              className={`inline-flex items-center font-bold ${chip} ${flag ? "border-2 border-ink bg-[#FBD530] text-ink" : "border-2 border-current"}`}
            >
              {COPY.race.triggers[t.type] ?? t.type}
            </li>
          );
        })}
      </ul>
      {!compact && lines.length > 0 && (
        <ul className={`flex flex-col gap-0.5 font-medium ${size === "host" ? "text-lg" : "text-sm"} leading-snug`}>
          {lines.map((t) => (
            <li key={t.type} className="line-clamp-2">
              {t.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Running race score per player, best first. `me` is inverted. Before the first reveal every total is 0.
export function RaceScores({
  board,
  me,
  carOf,
  size = "host",
  max = 12,
}: {
  board: RaceLeaderboardResponse | null;
  me?: string | null;
  carOf?: (name: string) => string | null;
  size?: "host" | "phone";
  max?: number;
}) {
  const rows: RaceRow[] = (board?.rows ?? [])
    .filter((r) => r.kind === "player")
    .slice(0, max);
  const n = board?.revealed_laps.length ?? 0;
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between border-b-2 border-current pb-1">
        <span className="meta">{COPY.race.scoreTitle}</span>
        <span className="meta font-medium">{COPY.race.scoreAfter(n)}</span>
      </div>
      <ol
        className={`grid ${size === "host" && rows.length > 6 ? "grid-cols-2 gap-x-6" : "grid-cols-1"}`}
      >
        {rows.map((r, i) => {
          const mine = r.name === me;
          return (
            <li
              key={r.name}
              className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2 border-b border-current/20 ${size === "host" ? "h-10 text-lg" : "h-9 text-base"} ${
                mine ? "-mx-1 bg-ink px-1 text-white" : ""
              }`}
            >
              <span className="nums text-xs">{i + 1}</span>
              <span className="flex min-w-0 items-baseline gap-2">
                <b className="truncate font-black tracking-tight">{r.name}</b>
                {carOf?.(r.name) && (
                  <span className="font-mono text-[11px] font-bold">
                    {carOf(r.name)}
                  </span>
                )}
              </span>
              <span className="nums font-bold">{r.total}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
