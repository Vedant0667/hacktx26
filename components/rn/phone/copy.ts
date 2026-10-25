// Phone strings the Race Night views need that lib/copy.ts does not have yet (merge into COPY.rn at integration).
export const RN_PHONE_COPY = {
  joinRoom: "Join room",
  nickHint: "Shown on the big screen.",
  steps: ["The race freezes at a big moment", "Call Box or Stay out and say why", "Every call is scored at the flag"] as const,
  pickedBy: (names: string[]) => (names.length === 1 ? `${names[0]} picked this` : `${names[0]} + ${names.length - 1} more picked this`),
  room: "The room",
  ahead: "Ahead",
  behind: "Behind",
  picking: "Picking",
  calling: (n: number) => `${n} calling`,
  called: "Called",
  thinking: "Thinking",
  watching: "Watching",
  resumesIn: "Replay resumes in",
  dataOnPhone: "Data on your phone",
  carLabel: (n: number, team: string | null | undefined) => (team ? `Car ${n} · ${team}` : `Car ${n}`),
} as const;
