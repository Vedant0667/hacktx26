// Race Night phone end strings not in lib/copy.ts yet (merge into COPY.rn at integration).
export const PHONE_END_COPY = {
  flag: (race: string) => `Chequered flag · ${race}`,
  standings: "Standings",
  youName: (name: string) => `You · ${name}`,
  pts: "PTS",
  yourCalls: "Your calls",
  everyone: "Everyone's calls",
  back: "Back",
  right: "Right",
  wrong: "Wrong",
  noCall: "No call",
  lap: (n: number) => `L${n}`,
  audible: "Box now",
  meta: (race: string, car: string | null, right: number, calls: number) =>
    [race, car, `${right} of ${calls} right`].filter(Boolean).join(" · "),
  engineBeat: (by: number) => (by > 0 ? `You beat the engine by ${by}` : by < 0 ? `The engine beat you by ${-by}` : "Level with the engine"),
  teamWall: (team: string) => `${team} pit wall`,
  credit: "Reasons graded by Muse Spark",
  more: "More players",
  // Scoring wait (Scoring.tsx), same words as the host's H07
  scoringTop: "Scoring",
  scoringBig: "The calls",
  scoringSub: "Every call checked against what really happened.",
} as const;
