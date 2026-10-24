// The call moment explained from visible info only: the gap line with the rejoin marker, the rejoin
// sentence, the box-versus-stay trade-off and the race story. Takes the blind decision, which has no answer.
// Everything draws in currentColor so it reads on white and on the team-colour field.
import { COPY } from "@/lib/copy";
import type { BlindDecision } from "@/lib/client/api";
import { advRows, advancedFigures, pitLoss, type DataMode } from "@/lib/client/mode";
import { callMomentFrames, contextAt, projectRejoin, raceStory, type Rejoin } from "@/lib/client/race";
import { telemetry } from "@/lib/client/telemetry";
import type { LapFrame } from "@/lib/types";
import { Figures, TyreChip } from "./ui";

// Reads the blind decision and blind frames only; total laps and pit loss come from the decision.
export function getBrief(decision: BlindDecision, frames: LapFrame[]) {
  const seen = callMomentFrames(frames, decision);
  const total = decision.total_laps;
  const f = seen.find((x) => x.lap === decision.lap) ?? seen[seen.length - 1];
  return {
    seen,
    frame: f,
    total,
    ctx: contextAt(decision, seen),
    rejoin: projectRejoin(seen, decision, decision.pit_loss?.normal_s),
    story: raceStory(seen, decision, total),
    loss: pitLoss(decision.pit_loss, decision.trigger),
    adv: advancedFigures(decision, seen),
    tele: telemetry(seen, decision),
  };
}
export type Brief = ReturnType<typeof getBrief>;

// Under SC or VSC the projection uses gaps from the end of the previous lap, which the neutralisation will change.
export function RejoinCaveat({ frame, lap, className = "" }: { frame: LapFrame | undefined; lap: number; className?: string }) {
  const s = frame?.track_status;
  if (s !== "SC" && s !== "VSC") return null;
  return <p className={className}>{COPY.rejoin.caveat(s, lap - 1)}</p>;
}

// "Box now: P10, 0.2 s behind HUL. The stop costs 14.2 s now, 28.3 s at green. 50 laps left on 7-lap mediums."
export function RejoinSentence({ brief, className = "", withLaps = false }: { brief: Brief; className?: string; withLaps?: boolean }) {
  const { rejoin, loss, story, ctx } = brief;
  if (!ctx) return null;
  const rival = rejoin?.ahead ? brief.frame?.drivers.find((d) => d.code === rejoin.ahead!.code) : null;
  const compound = ctx.compound ? (COPY.compounds[ctx.compound] ?? ctx.compound) : null;
  return (
    <p className={className}>
      {rejoin && (
        <>
          {COPY.phone.boxNow}{" "}
          <b className="font-black">
            {COPY.phone.out(rejoin.pos)}
            {rejoin.ahead ? COPY.phone.behindCar(rejoin.ahead.gap, rejoin.ahead.code) : COPY.phone.inLead}
            {rival?.compound && rival.tyre_age != null ? ` ${COPY.phone.onTyres(rival.tyre_age, COPY.compounds[rival.compound] ?? rival.compound)}` : ""}.
          </b>{" "}
          {rival?.compound && <TyreChip compound={rival.compound} age={rival.tyre_age} size="sm" />}{" "}
        </>
      )}
      {loss && <>{COPY.phone.stopCost(loss.under, loss.normal)} </>}
      {story && withLaps && COPY.phone.lapsLeftOn(story.lapsLeft, ctx.age, compound)}
    </p>
  );
}

// Horizontal seconds axis: every visible car by gap to the leader, the player's car, and where a stop puts it.
export function GapLine({ frame, playerNumber, rejoin, size = "host" }: { frame: LapFrame; playerNumber: number; rejoin: Rejoin | null; size?: "host" | "phone" }) {
  const me = frame.drivers.find((x) => x.number === playerNumber);
  if (!me || me.gap_to_leader_s == null) return null;
  const myG = me.gap_to_leader_s;
  const outG = rejoin?.gapToLeader ?? myG;
  const span = size === "host" ? 6 : 4;
  const lo = Math.max(0, Math.min(myG, outG) - span / 2);
  const hi = Math.max(myG, outG) + span;
  const cars = frame.drivers
    .filter((x) => x.gap_to_leader_s != null && x.gap_to_leader_s >= lo && x.gap_to_leader_s <= hi && x.number !== playerNumber)
    .sort((a, b) => (a.gap_to_leader_s as number) - (b.gap_to_leader_s as number));
  const x = (g: number) => `${((g - lo) / (hi - lo)) * 100}%`;
  const rows = size === "host" ? 3 : 2;
  const rowH = size === "host" ? 20 : 16;
  const top = rows * rowH;
  const text = size === "host" ? "text-sm" : "text-xs";
  const line = top + 22;
  return (
    <figure className="relative" style={{ height: line + 34 }} aria-label={rejoin ? COPY.rejoin.line(rejoin.pos, rejoin.ahead, rejoin.behind, rejoin.clean) : undefined}>
      <div className="absolute inset-x-0 h-0.5 bg-current opacity-30" style={{ top: line }} />
      {cars.map((c, i) => (
        <div key={c.number} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: x(c.gap_to_leader_s as number), top: (i % rows) * rowH }}>
          <span className={`font-mono font-bold leading-none ${text}`}>{c.code}</span>
          <span className="mt-1 w-px bg-current opacity-30" style={{ height: line - (i % rows) * rowH - 12 }} />
          <span className="size-2.5 rounded-full bg-current opacity-60" />
        </div>
      ))}
      {rejoin && (
        <>
          <div className="grow-x absolute h-[3px] bg-current" style={{ top: line - 0.5, left: x(myG), width: `calc(${x(outG)} - ${x(myG)})` }} />
          <div className="ghost absolute flex -translate-x-1/2 flex-col items-center gap-1" style={{ left: x(outG), top: line - 8 }}>
            <span className="size-4 rounded-full border-[3px] border-current bg-transparent" />
            <span className={`whitespace-nowrap font-mono font-bold ${text}`}>{COPY.rejoin.out(rejoin.pos)}</span>
          </div>
        </>
      )}
      <div className="absolute flex -translate-x-1/2 flex-col items-center gap-1" style={{ left: x(myG), top: line - 7 }}>
        <span className="size-3.5 rounded-full bg-current" />
        <span className={`font-mono font-black ${text}`}>{me.code}</span>
      </div>
    </figure>
  );
}

// Box versus stay out, side by side in equal weight: places, tyres and seconds.
export function TradeOff({ brief, size = "host", mode }: { brief: Brief; size?: "host" | "phone"; mode: DataMode }) {
  const { ctx, rejoin, loss } = brief;
  if (!ctx) return null;
  const big = size === "host" ? "text-2xl" : "text-xl";
  const line = size === "host" ? "text-base" : "text-sm";
  return (
    <div className="grid grid-cols-2 gap-6 border-t-2 border-current pt-3">
      <div className="flex flex-col gap-1">
        <span className="meta">{COPY.story.stay}</span>
        <span className={`${big} font-black tracking-tight`}>{COPY.story.stayKeep(ctx.pos)}</span>
        {ctx.age != null && (
          <span className={`nums flex items-center gap-2 ${line}`}>
            <TyreChip compound={ctx.compound} age={ctx.age} size="sm" />
            {COPY.phone.lapTyres(ctx.age, ctx.compound ? (COPY.compounds[ctx.compound] ?? ctx.compound) : null)}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="meta">{COPY.story.box}</span>
        <span className={`${big} font-black tracking-tight`}>{rejoin ? COPY.rejoin.out(rejoin.pos) : COPY.story.boxTyres}</span>
        {rejoin && (
          <span className={`nums ${line}`}>
            {rejoin.ahead ? `${rejoin.ahead.gap.toFixed(1)} s ${COPY.rejoin.behind.toLowerCase()} ${rejoin.ahead.code}` : COPY.story.boxTyres}
            {rejoin.behind ? `. ${rejoin.clean ? COPY.rejoin.clean : COPY.rejoin.traffic(rejoin.traffic ?? rejoin.behind.code)}` : ""}
          </span>
        )}
        {mode === "advanced" && rejoin?.behind && (
          <span className={`nums ${line}`}>
            {rejoin.behind.code} {rejoin.behind.gap.toFixed(1)} s {COPY.rejoin.behind.toLowerCase()}
          </span>
        )}
        {loss && <span className={`nums ${line}`}>{COPY.story.scSaves(loss.under, loss.normal)}</span>}
      </div>
    </div>
  );
}

// Simple: the race story as plain facts. Advanced: the full figures.
export function StoryFacts({ decision, brief, mode, size = "host" }: { decision: BlindDecision; brief: Brief; mode: DataMode; size?: "host" | "phone" }) {
  const { story, ctx, adv } = brief;
  if (!story || !ctx) return null;
  if (mode === "advanced") return adv ? <Figures cols={size === "host" ? 2 : 1} size={size === "host" ? "md" : "sm"} rows={advRows(decision.trigger, adv).slice(adv.loss ? 1 : 0)} /> : null;
  const facts = [
    story.newerThanMe != null ? COPY.story.tyreRank(story.newerThanMe, story.fieldSize) : null,
    story.aheadCount > 0 ? COPY.story.pittedAhead(story.pittedAhead, story.aheadCount) : null,
    story.nearCount > 0 ? COPY.story.nearStops(story.nearStops, story.nearCount) : null,
    ctx.behind !== "–" ? COPY.mode.carBehind(ctx.behind) : COPY.mode.noCarBehind,
  ].filter(Boolean) as string[];
  return (
    <ul className={`grid gap-x-8 ${size === "host" ? "grid-cols-2" : "grid-cols-1"}`}>
      {facts.map((f) => (
        <li key={f} className={`nums flex min-h-10 items-center border-b border-current/20 ${size === "host" ? "text-base" : "text-sm"}`}>
          {f}
        </li>
      ))}
    </ul>
  );
}
