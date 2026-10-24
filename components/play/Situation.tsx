// The phone's read of the call moment, from call-moment frames only (nothing from the engine or ground truth's answer).
import { COPY } from "@/lib/copy";
import { advRows, advancedFigures, type DataMode, type GroundTruthFile } from "@/lib/client/mode";
import { callMomentFrames, contextAt } from "@/lib/client/race";
import type { DecisionPoint, LapFrame } from "@/lib/types";
import { Figures } from "../ui";

export function Situation({ decision, frames, mode, gt }: { decision: DecisionPoint; frames: LapFrame[]; mode: DataMode; gt: GroundTruthFile | null }) {
  const seen = callMomentFrames(frames, decision);
  const ctx = contextAt(decision, seen);
  if (!ctx) return null;
  const total = frames[frames.length - 1]?.lap ?? decision.lap;
  const adv = mode === "advanced" ? advancedFigures(decision, seen, total, gt) : null;
  const compound = ctx.compound ? (COPY.compounds[ctx.compound] ?? ctx.compound) : null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <span className="nums text-56 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.mode.position(ctx.pos)}</span>
        <span className="flex flex-col gap-1 text-20 leading-row">
          <span className="nums font-semibold">{ctx.behind !== "–" ? COPY.mode.carBehind(ctx.behind) : COPY.mode.noCarBehind}</span>
          {ctx.age != null && (
            <span className="nums">
              {mode === "advanced" && compound ? `${compound}. ` : ""}
              {COPY.mode.tyres(ctx.age)}
            </span>
          )}
          {mode === "advanced" && ctx.ahead !== "–" && (
            <span className="nums text-ink-2">
              {COPY.mode.gapAhead} {COPY.mode.seconds(ctx.ahead)}
            </span>
          )}
        </span>
      </div>
      {mode === "simple" ? (
        <p className="text-20 text-ink-2">{COPY.mode.trackWords[decision.trigger]}</p>
      ) : (
        adv && <Figures size="sm" rows={advRows(decision.trigger, adv)} />
      )}
    </section>
  );
}
