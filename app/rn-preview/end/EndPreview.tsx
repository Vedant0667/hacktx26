"use client";
import { RNHostSummary, RNScoring, type RejoinMap } from "@/components/rn/end/RNHostEnd";
import { momentSummary, raceSummary } from "@/components/rn/end/fixtures";

const REJOIN: RejoinMap = {
  track: "sg-2008",
  cars: [
    { code: "GAS", fraction: 0.62 },
    { code: "OCO", fraction: 0.58 },
    { code: "HUL", fraction: 0.55 },
  ],
  followed: "GAS",
  near: ["OCO"],
  ghost: { fraction: 0.66, label: "Box: P12" },
  team: "#2293D1",
  caption: "Rejoined P12 behind OCO on new tyres.",
};

export function EndPreview({ v }: { v: string }) {
  if (v === "scoring") return <RNScoring elapsedMs={7400} failed={false} big team="#2293D1" race="Singapore 2026" />;
  if (v === "scoring-moments")
    return (
      <RNScoring
        elapsedMs={3200}
        failed={false}
        big
        team="#2293D1"
        race="Singapore 2026"
        moments={[
          { lap: 14, trigger: "RIVAL_STOP" },
          { lap: 22, trigger: "UNDERCUT" },
          { lap: 28, trigger: "TYRE_WINDOW" },
          { lap: 39, trigger: "VSC" },
        ]}
      />
    );
  if (v === "moment") return <RNHostSummary summary={momentSummary(3)} code="TQ7K" carCode="GAS" />;
  if (v === "race12") return <RNHostSummary summary={raceSummary(12)} code="TQ7K" carCode="GAS" rejoinMaps={{ 39: REJOIN }} />;
  return <RNHostSummary summary={raceSummary(6)} code="TQ7K" carCode="GAS" rejoinMaps={{ 39: REJOIN }} onPlayAgain={() => {}} />;
}
