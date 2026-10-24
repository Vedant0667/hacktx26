// The running order as a clean table: hairline rows in absolute slots, so an overtake animates as translateY.
// Rows are opaque, so a row sliding past another mid-animation covers it instead of printing over it.
// The player's row is inverted. Simple: position, swatch, code, gap. Advanced adds interval, tyre and pit.
import { COPY } from "@/lib/copy";
import { fmtGap } from "@/lib/client/race";
import { intervals, type DataMode } from "@/lib/client/mode";
import type { DriverFrame } from "@/lib/types";
import { Tyre } from "./ui";

export function Tower({
  drivers,
  playerNumber,
  dim = false,
  pitTags,
  maxRows = 20,
  centerOn,
  showPit = true,
  mode = "advanced",
  size = "host",
}: {
  drivers: DriverFrame[];
  playerNumber: number;
  dim?: boolean;
  // Driver number to tag text for the pit cell after the call ("Box L7").
  pitTags?: Map<number, string>;
  maxRows?: number;
  centerOn?: number;
  showPit?: boolean;
  mode?: DataMode;
  size?: "host" | "phone";
}) {
  const ROW = size === "host" ? 36 : 40;
  const sorted = [...drivers].sort((a, b) => a.position - b.position);
  let visible = sorted;
  if (sorted.length > maxRows) {
    const idx = centerOn != null ? sorted.findIndex((d) => d.number === centerOn) : 0;
    const start = Math.max(0, Math.min(sorted.length - maxRows, idx - Math.floor(maxRows / 2)));
    visible = sorted.slice(start, start + maxRows);
  }
  const slot = new Map(visible.map((d, i) => [d.number, i]));
  // Stable render order (by car number) so React moves nothing and CSS animates the slot change.
  const stable = [...visible].sort((a, b) => a.number - b.number);
  const adv = mode === "advanced";
  const showInt = adv && showPit;
  const showTyre = adv;
  const showPitCol = showPit && (adv || !!pitTags);
  const ints = showInt ? intervals(drivers) : null;
  const cols = [
    "28px",
    "4px",
    "minmax(44px,1fr)",
    "76px",
    showInt ? "64px" : null,
    showTyre ? "56px" : null,
    showPitCol ? (pitTags ? "84px" : "40px") : null,
  ]
    .filter(Boolean)
    .join("_");
  const text = size === "host" ? "text-base" : "text-base";

  return (
    <div className={dim ? "tower-dim" : ""}>
      <div className="grid h-8 items-center gap-x-3 border-b-2 border-ink px-2" style={{ gridTemplateColumns: cols.replaceAll("_", " ") }}>
        <span className="meta text-right">{COPY.replay.columns.pos}</span>
        <span />
        <span className="meta">{COPY.replay.columns.driver}</span>
        <span className="meta text-right">{COPY.replay.columns.gap}</span>
        {showInt && <span className="meta text-right">{COPY.mode.interval}</span>}
        {showTyre && <span className="meta">{COPY.replay.columns.tyre}</span>}
        {showPitCol && <span className="meta">{COPY.replay.columns.pit}</span>}
      </div>
      <ol className="relative" style={{ height: visible.length * ROW }}>
        {stable.map((d) => {
          const mine = d.number === playerNumber;
          const tag = pitTags?.get(d.number);
          const gap = fmtGap(d.gap_to_leader_s, d.position);
          return (
            <li
              key={d.number}
              className={`tower-row absolute inset-x-0 grid items-center gap-x-3 border-b px-2 ${text} ${mine ? "z-[1] border-ink bg-ink text-white" : "border-line bg-bg"}`}
              style={{ height: ROW, transform: `translateY(${(slot.get(d.number) ?? 0) * ROW}px)`, gridTemplateColumns: cols.replaceAll("_", " ") }}
              aria-current={mine || undefined}
            >
              <span className="nums text-right">{d.position}</span>
              <span className="h-4 w-1" style={d.team_colour ? { backgroundColor: d.team_colour } : undefined} aria-hidden />
              <span className="font-black tracking-tight">{d.code}</span>
              <span className="nums text-right">{gap ?? <span className="meta">{COPY.replay.leader}</span>}</span>
              {showInt && <span className="nums text-right">{ints?.get(d.number) != null ? `+${ints.get(d.number)!.toFixed(1)}` : ""}</span>}
              {showTyre && <Tyre compound={d.compound} age={d.tyre_age} />}
              {showPitCol && (
                <span className="meta">
                  {tag ? <span>{tag}</span> : d.pitted_this_lap ? <span className={`px-1 ${mine ? "bg-white text-ink" : "bg-ink text-white"}`}>{COPY.replay.pit}</span> : null}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
