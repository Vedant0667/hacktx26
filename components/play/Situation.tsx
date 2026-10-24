// The phone's read of the call moment, from call-moment frames only (nothing from the engine or ground truth's answer).
import { COPY } from "@/lib/copy";
import type { DataMode, GroundTruthFile } from "@/lib/client/mode";
import type { DecisionPoint, LapFrame } from "@/lib/types";
import { GapLine, StoryFacts, TradeOff, getBrief } from "../DecisionBrief";

export function Situation({ decision, frames, mode, gt, part = "top" }: { decision: DecisionPoint; frames: LapFrame[]; mode: DataMode; gt: GroundTruthFile | null; part?: "top" | "bottom" }) {
  const brief = getBrief(decision, frames, gt);
  // Below the call controls: the trade-off and the race story, so the buttons stay near the thumb.
  if (part === "bottom")
    return (
      <section className="flex flex-col gap-3">
        {mode === "advanced" && brief.frame && <GapLine frame={brief.frame} playerNumber={decision.player_role.number} rejoin={brief.rejoin} size="phone" />}
        <TradeOff brief={brief} size="phone" mode={mode} />
        <StoryFacts decision={decision} brief={brief} mode={mode} size="phone" />
      </section>
    );
  const { ctx, rejoin } = brief;
  if (!ctx) return null;
  const compound = ctx.compound ? (COPY.compounds[ctx.compound] ?? ctx.compound) : null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <span className="nums text-56 font-extrabold uppercase stretch-125 tracking-hero leading-hero">{COPY.mode.position(ctx.pos)}</span>
        <span className="flex flex-col gap-1 text-20 leading-row">
          {ctx.age != null && (
            <span className="nums font-semibold">
              {mode === "advanced" && compound ? `${compound}. ` : ""}
              {COPY.mode.tyres(ctx.age)}
            </span>
          )}
          <span className="nums text-ink-2">{ctx.ahead !== "–" ? `${COPY.mode.gapAhead} ${COPY.mode.seconds(ctx.ahead)}` : COPY.mode.trackWords[decision.trigger].split(":")[0]}</span>
        </span>
      </div>
      {rejoin && (
        <p className="nums text-20 font-semibold text-flag-yellow">
          {COPY.rejoin.line(rejoin.pos, rejoin.ahead, rejoin.behind, rejoin.clean)}{" "}
          <span className="font-normal text-ink-2">{COPY.rejoin.assumption}</span>
        </p>
      )}
    </section>
  );
}
