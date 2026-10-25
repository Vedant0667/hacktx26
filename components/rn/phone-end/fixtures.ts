// Preview fixtures for the phone end, shaped like GET /reveal?part=results (lib/client/api.ts GameSummary).
import type { GameSummary, MomentEntry, RankRow, SummaryMoment } from "@/lib/client/api";

type C = "BOX" | "STAY";
const players: [string, number][] = [
  ["Vedant", 143],
  ["Maya", 121],
  ["Ekb", 98],
  ["Jordan", 98],
  ["Priya", 64],
  ["Sam", 40],
];

function row(kind: RankRow["kind"], name: string, points: number, code = "GAS"): RankRow {
  return { kind, name, driver_code: code, points, calls: 4, right: 2, rank: 0, tied: false, rank_label: "" };
}

const laps: { lap: number; trig: string; right: C; stakes: number; swing: number }[] = [
  { lap: 12, trig: "UNDERCUT", right: "STAY", stakes: 40, swing: 4.1 },
  { lap: 22, trig: "RIVAL_STOP", right: "STAY", stakes: 50, swing: 5.2 },
  { lap: 28, trig: "TYRE_WINDOW", right: "STAY", stakes: 45, swing: 3.0 },
  { lap: 39, trig: "VSC", right: "BOX", stakes: 88, swing: 9.8 },
];
const verdicts = [
  "Named tyre age and the gap to HUL; missed the cheap stop.",
  "Clear undercut maths and pit loss. Traffic on the rejoin undid it.",
  "Right instinct, thin reason: no tyre or gap numbers.",
  "Used the cheap VSC stop; didn't weigh rejoining behind OCO.",
];
const myCallsFor: Record<string, (C | null)[]> = {
  Vedant: ["STAY", "BOX", "STAY", "BOX"],
  Priya: ["STAY", "BOX", null, "BOX"],
};

function entry(kind: MomentEntry["kind"], name: string, call: C | null, right: C, i: number, points: number): MomentEntry {
  return {
    kind,
    name,
    driver_code: "GAS",
    call,
    said: call && kind === "player" ? "Tyres are fine and the gap behind is too small to box." : "",
    right: call ? call === right : null,
    stakes: laps[i].stakes,
    reasoning: kind === "player" && call ? [30, 38, 20, 30][i] : 0,
    verdict: kind === "player" && call ? verdicts[i] : null,
    credited: [],
    points,
  };
}

const moments: SummaryMoment[] = laps.map((l, i) => ({
  lap: l.lap,
  triggers: [l.trig],
  cars: [{ code: "GAS", team: "Alpine", correct: l.right, swing_s: l.swing, stakes: l.stakes, team_call: l.right }],
  entries: [
    ...players.map(([n]) => {
      const c = (myCallsFor[n] ?? ["STAY", "STAY", "BOX", "BOX"])[i];
      return entry("player", n, c, l.right, i, c ? (c === l.right ? 28 : -6) + i : 0);
    }),
    entry("engine", "Engine", l.right, l.right, i, 28),
    entry("team", "Alpine", l.right, l.right, i, 22),
  ],
}));
// Make the two players we preview match the mockup numbers.
moments[0].entries[0].points = 28;
moments[1].entries[0].points = 27;
moments[2].entries[0].points = 27;
moments[3].entries[0].points = 61;

export const FIXTURE: GameSummary = {
  grading: false,
  mode: "race",
  race: "Singapore",
  cars: [{ code: "GAS", name: "Pierre Gasly", team: "Alpine", team_colour: "#2293D1" }],
  winners: { names: ["Vedant"], points: 143 },
  ranking: [...players.map(([n, p]) => row("player", n, p)), row("engine", "Engine", 112), row("team", "Alpine", 87)],
  moments,
  audibles: [
    { name: "Priya", driver_code: "GAS", lap: 33, status: "scored", right: false, stakes: 30, reasoning: 18, verdict: "Boxed into traffic with no tyre case.", said: "box now", points: -9 },
  ],
};

// Single quick moment, two players tied for first, a long name, different team colour.
export const FIXTURE_MOMENT: GameSummary = {
  grading: false,
  mode: "moment",
  race: "Monza",
  cars: [{ code: "HAM", name: "Lewis Hamilton", team: "Ferrari", team_colour: "#E8002D" }],
  winners: { names: ["Alexandria Longname", "Ben"], points: 51 },
  ranking: [row("player", "Alexandria Longname", 51, "HAM"), row("player", "Ben", 51, "HAM"), row("player", "Cleo", -8, "HAM"), row("engine", "Engine", 51, "HAM"), row("team", "Ferrari", -8, "HAM")],
  moments: [
    {
      lap: 19,
      triggers: ["SC"],
      cars: [{ code: "HAM", team: "Ferrari", correct: "BOX", swing_s: 12.4, stakes: 70, team_call: "STAY" }],
      entries: [
        { ...entry("player", "Alexandria Longname", "BOX", "BOX", 3, 51), driver_code: "HAM" },
        { ...entry("player", "Ben", "BOX", "BOX", 3, 51), driver_code: "HAM" },
        { ...entry("player", "Cleo", "STAY", "BOX", 3, -8), driver_code: "HAM" },
        { ...entry("engine", "Engine", "BOX", "BOX", 3, 51), driver_code: "HAM" },
        { ...entry("team", "Ferrari", "STAY", "BOX", 3, -8), driver_code: "HAM" },
      ],
    },
  ],
  audibles: [],
};
