// Advanced, after the reveal: the ground-truth comparison behind the verdict (from revealData's ground_truth).
import { COPY } from "@/lib/copy";
import type { GroundTruthFile } from "@/lib/client/mode";
import type { DecisionPoint } from "@/lib/types";

export function Measured({ decision, gt, size = "md" }: { decision: DecisionPoint; gt: GroundTruthFile | null; size?: "sm" | "md" }) {
  const sec = gt?.seconds;
  const pos = gt?.positions_reference;
  const lines: string[] = [];
  if (sec) lines.push(COPY.mode.pairs(sec.pairs.length, sec.start_lap_end, sec.end_lap, sec.mean_delta_s_player_call_vs_other, decision.ground_truth.correct));
  if (pos?.field) lines.push(COPY.mode.places(COPY.mode.field, pos.field, pos.end_lap));
  const same = (x?: { n_box: number; n_stay: number; box_mean_gain: number; stay_mean_gain: number }, y?: typeof x) =>
    !!x && !!y && x.n_box === y.n_box && x.n_stay === y.n_stay && x.box_mean_gain === y.box_mean_gain && x.stay_mean_gain === y.stay_mean_gain;
  if (pos?.cohort && !same(pos.cohort, pos.field)) lines.push(COPY.mode.places(COPY.mode.cohort, pos.cohort, pos.end_lap));
  if (!lines.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="meta">{COPY.mode.measured}</span>
      {lines.map((l) => (
        <p key={l} className={`nums border-b border-line pb-2 ${size === "sm" ? "text-sm" : "text-base"}`}>
          {l}
        </p>
      ))}
    </div>
  );
}
