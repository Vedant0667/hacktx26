// The call moment explained from visible info only: the gap line with the rejoin ghost, the trade-off,
// and the race story (Simple) or the full figures (Advanced). Never reads decision.engine or ground_truth.correct.
import { COPY } from "@/lib/copy";
import { advRows, advancedFigures, pitLoss, type DataMode, type GroundTruthFile } from "@/lib/client/mode";
import { callMomentFrames, contextAt, projectRejoin, raceStory, type Rejoin } from "@/lib/client/race";
import type { DecisionPoint, LapFrame } from "@/lib/types";
import { Figures } from "./ui";

export function getBrief(decision: DecisionPoint, frames: LapFrame[], gt: GroundTruthFile | null) {
  const seen = callMomentFrames(frames, decision);
  const total = frames[frames.length - 1]?.lap ?? decision.lap;
  const f = seen.find((x) => x.lap === decision.lap) ?? seen[seen.length - 1];
  return {
    seen,
    frame: f,
    total,
    ctx: contextAt(decision, seen),
    rejoin: projectRejoin(seen, decision, gt?.pit_loss?.normal_s),
    story: raceStory(seen, decision, total),
    loss: pitLoss(gt, decision.trigger),
    adv: advancedFigures(decision, seen, total, gt),
  };
}

// Horizontal seconds axis: every visible car by gap to the leader, the player's car, and where a stop now puts it.
export function GapLine({ frame, playerNumber, rejoin, size = "host" }: { frame: LapFrame; playerNumber: number; rejoin: Rejoin | null; size?: "host" | "phone" }) {
  const me = frame.drivers.find((x) => x.number === playerNumber);
  if (!me || me.gap_to_leader_s == null) return null;
  const myG = me.gap_to_leader_s;
  const outG = rejoin?.gapToLeader ?? myG;
  const span = size === "host" ? 8 : 5;
  const lo = Math.max(0, Math.min(myG, outG) - span / 2);
  const hi = Math.max(myG, outG) + span;
  const cars = frame.drivers
    .filter((x) => x.gap_to_leader_s != null && x.gap_to_leader_s >= lo && x.gap_to_leader_s <= hi)
    .sort((a, b) => (a.gap_to_leader_s as number) - (b.gap_to_leader_s as number));
  const x = (g: number) => `${((g - lo) / (hi - lo)) * 100}%`;
  const rows = size === "host" ? 3 : 2;
  const rowH = 22;
  const top = rows * rowH;
  const text = size === "host" ? "text-16" : "text-14";
  return (
    <figure className="flex flex-col gap-2" aria-label={rejoin ? COPY.rejoin.line(rejoin.pos, rejoin.ahead, rejoin.behind, rejoin.clean) : undefined}>
      <div className="relative" style={{ height: top + 56 }}>
        {/* track line */}
        <div className="absolute inset-x-0 h-0.5 bg-rule" style={{ top: top + 27 }} />
        {cars.map((c, i) => {
          const mine = c.number === playerNumber;
          if (mine) return null;
          return (
            <div key={c.number} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: x(c.gap_to_leader_s as number), top: (i % rows) * rowH }}>
              <span className={`${text} font-bold uppercase stretch-75 leading-none text-ink-2`}>{c.code}</span>
              <span className="mt-1 w-px bg-rule" style={{ height: top - (i % rows) * rowH + 8 }} />
              <span className="size-3 rounded-full bg-ink-2" style={c.team_colour ? { backgroundColor: c.team_colour } : undefined} />
            </div>
          );
        })}
        {rejoin && (
          <>
            <div className="absolute h-0.5 bg-flag-yellow" style={{ top: top + 27, left: x(myG), width: `calc(${x(outG)} - ${x(myG)})` }} />
            <div className="ghost-in absolute flex -translate-x-1/2 flex-col items-center" style={{ left: x(outG), top: top + 14 }}>
              <span className={`border-2 border-dashed border-flag-yellow bg-bg px-2 ${text} font-extrabold uppercase stretch-75 leading-row text-flag-yellow`}>
                {COPY.rejoin.out(rejoin.pos)}
              </span>
            </div>
          </>
        )}
        <div className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: x(myG), top: top + 14 }}>
          <span className={`bg-ink px-2 ${text} font-extrabold uppercase stretch-75 leading-row text-bg`}>{me.code}</span>
        </div>
      </div>
    </figure>
  );
}

// Box versus stay out, side by side, in equal weight: what each option means in places, tyres and seconds.
export function TradeOff({ brief, size = "host", mode }: { brief: ReturnType<typeof getBrief>; size?: "host" | "phone"; mode: DataMode }) {
  const { ctx, rejoin, loss } = brief;
  if (!ctx) return null;
  const big = size === "host" ? "text-32" : "text-24";
  const line = size === "host" ? "text-20" : "text-16";
  const pad = size === "host" ? "px-5 py-3" : "p-3";
  return (
    <div className="grid grid-cols-2 gap-0.5">
      <div className={`flex flex-col gap-1 bg-surface ${pad}`}>
        <span className="text-14 font-semibold uppercase tracking-label text-ink-3">{COPY.story.stay}</span>
        <span className={`nums ${big} font-extrabold uppercase stretch-75 leading-hero`}>{COPY.story.stayKeep(ctx.pos)}</span>
        {ctx.age != null && <span className={`nums ${line} text-ink-2`}>{COPY.story.stayTyres(ctx.age)}</span>}
      </div>
      <div className={`flex flex-col gap-1 bg-surface ${pad}`}>
        <span className="text-14 font-semibold uppercase tracking-label text-ink-3">{COPY.story.box}</span>
        <span className={`nums ${big} font-extrabold uppercase stretch-75 leading-hero text-flag-yellow`}>{rejoin ? COPY.rejoin.out(rejoin.pos) : COPY.story.boxTyres}</span>
        {rejoin && (
          <span className={`nums ${line} text-ink-2`}>
            {rejoin.ahead ? `${rejoin.ahead.gap.toFixed(1)} s ${COPY.rejoin.behind.toLowerCase()} ${rejoin.ahead.code}` : COPY.story.boxTyres}
            {rejoin.behind ? `. ${rejoin.clean ? COPY.rejoin.clean : COPY.rejoin.traffic(rejoin.traffic ?? rejoin.behind.code)}` : ""}
          </span>
        )}
        {mode === "advanced" && rejoin?.behind && (
          <span className={`nums ${line} text-ink-2`}>
            {rejoin.behind.code} {rejoin.behind.gap.toFixed(1)} s {COPY.rejoin.behind.toLowerCase()}
          </span>
        )}
        {loss && <span className={`nums ${line} text-ink-2`}>{COPY.story.scSaves(loss.under, loss.normal)}</span>}
      </div>
    </div>
  );
}

// Simple: the race story in plain numbered facts. Advanced: the full figures.
export function StoryFacts({ decision, brief, mode, size = "host" }: { decision: DecisionPoint; brief: ReturnType<typeof getBrief>; mode: DataMode; size?: "host" | "phone" }) {
  const { story, ctx, adv } = brief;
  if (!story || !ctx) return null;
  // The trade-off already prints the pit loss, so the figures skip it.
  if (mode === "advanced") return adv ? <Figures cols={2} size={size === "host" ? "md" : "sm"} rows={advRows(decision.trigger, adv).slice(adv.loss ? 1 : 0)} /> : null;
  const facts = [
    COPY.story.lapsLeft(story.lapsLeft),
    story.newerThanMe != null ? COPY.story.tyreRank(story.newerThanMe, story.fieldSize) : null,
    story.aheadCount > 0 ? COPY.story.pittedAhead(story.pittedAhead, story.aheadCount) : null,
    story.nearCount > 0 ? COPY.story.nearStops(story.nearStops, story.nearCount) : null,
    ctx.behind !== "–" ? COPY.mode.carBehind(ctx.behind) : COPY.mode.noCarBehind,
  ].filter(Boolean) as string[];
  return (
    <ul className={`grid gap-0.5 ${size === "host" ? "grid-cols-2" : "grid-cols-1"}`}>
      {facts.map((f) => (
        <li key={f} className={`nums flex min-h-9 items-center bg-surface px-3 ${size === "host" ? "text-20" : "text-16"}`}>
          {f}
        </li>
      ))}
    </ul>
  );
}
