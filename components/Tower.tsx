// The broadcast timing tower. Rows sit in absolute slots so a position change animates as translateY.
import { COPY } from "@/lib/copy";
import { fmtGap } from "@/lib/client/race";
import type { DriverFrame } from "@/lib/types";
import { Tyre } from "./ui";

const ROW = 36;
const GAP = 2;

export function Tower({
  drivers,
  playerNumber,
  dim = false,
  pitTags,
  maxRows = 20,
  centerOn,
  showPit = true,
}: {
  drivers: DriverFrame[];
  playerNumber: number;
  dim?: boolean;
  // Driver number to tag text for the PIT cell after the call ("BOX L7").
  pitTags?: Map<number, string>;
  maxRows?: number;
  centerOn?: number;
  // The phone drops the PIT column so the tower fits 390 px.
  showPit?: boolean;
}) {
  const sorted = [...drivers].sort((a, b) => a.position - b.position);
  let visible = sorted;
  if (sorted.length > maxRows) {
    const idx = centerOn != null ? sorted.findIndex((d) => d.number === centerOn) : 0;
    const start = Math.max(0, Math.min(sorted.length - maxRows, idx - Math.floor(maxRows / 2)));
    visible = sorted.slice(start, start + maxRows);
  }
  const slot = new Map(visible.map((d, i) => [d.number, i]));
  // Render in a stable order (by car number) so React moves nothing and CSS animates the slot change.
  const stable = [...visible].sort((a, b) => a.number - b.number);
  const height = visible.length * (ROW + GAP) - GAP;
  const cols = showPit ? "grid-cols-[32px_6px_1fr_88px_72px_48px]" : "grid-cols-[32px_6px_1fr_80px_64px]";

  return (
    <div className={dim ? "tower-dim" : ""}>
      <div className={`grid h-7 ${cols} items-center gap-x-3 px-3 text-14 font-semibold uppercase tracking-label text-ink-3`}>
        <span className="text-right">{COPY.replay.columns.pos}</span>
        <span />
        <span>{COPY.replay.columns.driver}</span>
        <span className="text-right">{COPY.replay.columns.gap}</span>
        <span>{COPY.replay.columns.tyre}</span>
        {showPit && <span>{COPY.replay.columns.pit}</span>}
      </div>
      <ol className="relative" style={{ height }}>
        {stable.map((d) => {
          const mine = d.number === playerNumber;
          const tag = pitTags?.get(d.number);
          const gap = fmtGap(d.gap_to_leader_s, d.position);
          const swatch = d.team_colour;
          return (
            <li
              key={d.number}
              className={`tower-row absolute inset-x-0 grid ${cols} items-center gap-x-3 px-3 text-20 leading-row stretch-75 ${
                mine ? "bg-ink !text-bg" : "bg-surface"
              }`}
              style={{ height: ROW, transform: `translateY(${(slot.get(d.number) ?? 0) * (ROW + GAP)}px)` }}
              aria-current={mine || undefined}
            >
              <span className="nums text-right font-semibold">{d.position}</span>
              <span
                className="tower-swatch h-5 w-1.5"
                style={swatch ? { backgroundColor: `#${swatch.replace("#", "")}` } : undefined}
                aria-hidden
              />
              <span className="font-bold uppercase">{d.code}</span>
              <span className="nums text-right font-semibold">{gap ?? <span className="text-14 uppercase tracking-label">{COPY.replay.leader}</span>}</span>
              <Tyre compound={d.compound} age={d.tyre_age} inverted={mine} />
              {showPit && (
                <span className="text-14 font-semibold uppercase tracking-label">
                  {tag ? (
                    <span className="nums">{tag}</span>
                  ) : d.pitted_this_lap ? (
                    <span className="bg-surface-2 px-1 text-ink">{COPY.replay.pit}</span>
                  ) : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
