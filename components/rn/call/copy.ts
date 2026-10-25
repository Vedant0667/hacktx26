// Race Night call pad strings not in lib/copy.ts yet (integration moves them to COPY.rn).
export const RN_CALL_COPY = {
  lockedIn: "Locked in",
  yourReason: "Your reason",
  answersTitle: "Answers at the flag",
  answersSub: "Nobody sees a call until the race ends.",
  room: "The room",
  calledOf: (n: number, total: number) => `${n} of ${total} called`,
  called: "Called",
  thinking: "Thinking",
  radioIn: "Radio in",
  typeLabel: "Type instead",
  ahead: "Ahead",
  behind: "Behind",
  ifYouBox: "If you box",
} as const;
