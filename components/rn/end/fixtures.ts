// Preview fixtures for the host end views, in the GameSummary shape (lib/client/api.ts).
import type { GameSummary, MomentEntry, SummaryMoment } from "@/lib/client/api";
import { WEIGHTS, splitPoints } from "@/lib/client/score";

type Call = "BOX" | "STAY";
const SAID: Record<string, string> = {
  Vedant: "Box now, the VSC makes it cheap and our softs are 22 laps old.",
  Maya: "Box. The stop costs 17.5 s under VSC and we keep track position.",
  Ekb: "Stay out. HUL hasn't stopped and he's only 1.5 s up the road, and boxing drops us to P12 in traffic with 23 laps left.",
  Priya: "Stay out, the softs will last to the end.",
  Jordan: "",
  Engine: "Pit loss under VSC is 11 s cheaper than green; undercut on OCO works.",
  Alpine: "",
};
const VERDICT: Record<string, string> = {
  Vedant: "Named the cheap VSC stop and tyre age; missed what rivals did.",
  Maya: "Saw the 17.5 s VSC stop; nothing on traffic after the rejoin.",
  Ekb: "Sharp on HUL and traffic at P12; underrated the cheap stop.",
  Priya: "Said the softs would last; the 1.1 s a lap drop said otherwise.",
  Engine: "Pit loss and undercut both covered.",
};

function entry(kind: MomentEntry["kind"], name: string, call: Call | null, right: Call, stakes: number, r: number, code = "GAS"): MomentEntry {
  const ok = call === right;
  const said = SAID[name] ?? "";
  const reasoning = call && said ? r : 0;
  const base = call ? splitPoints(stakes, ok, reasoning, 0).call : 0;
  const pts = call ? base + Math.round((stakes * WEIGHTS.reasoning * reasoning) / 100 / 50) : 0;
  return { kind, name, driver_code: code, call, said: call ? said : "", right: call ? ok : null, stakes, reasoning, verdict: call && said ? (VERDICT[name] ?? null) : null, credited: [], points: pts };
}

function moment(lap: number, trigger: string, right: Call, stakes: number, calls: Record<string, Call | null>, rs: Record<string, number>): SummaryMoment {
  const entries: MomentEntry[] = Object.entries(calls).map(([name, call]) =>
    entry(name === "Engine" ? "engine" : name === "Alpine" ? "team" : "player", name, call, right, stakes, rs[name] ?? 20),
  );
  return {
    lap,
    triggers: [trigger],
    cars: [{ code: "GAS", team: "Alpine", correct: right, swing_s: 17.6, stakes, team_call: "BOX" }],
    entries,
  };
}

export function raceSummary(players = 6): GameSummary {
  const names = ["Vedant", "Maya", "Ekb", "Jordan", "Priya", "Sam", "Alexandria-Rose", "Tom", "Lena", "Kai", "Noor", "Ravi"].slice(0, players);
  const callsFor = (pattern: (Call | null)[]) => Object.fromEntries([...names.map((n, i) => [n, pattern[i % pattern.length]]), ["Engine", "BOX"], ["Alpine", "BOX"]]);
  const rs = { Vedant: 30, Maya: 27, Ekb: 37, Priya: 22, Engine: 40, Alpine: 10, "Alexandria-Rose": 33 };
  const moments = [
    moment(14, "RIVAL_STOP", "STAY", 60, callsFor(["STAY", "STAY", "BOX", "STAY", "BOX", null]), rs),
    moment(22, "UNDERCUT", "BOX", 72, callsFor(["BOX", "STAY", "BOX", "BOX", "STAY", "BOX"]), rs),
    moment(28, "TYRE_WINDOW", "STAY", 50, callsFor(["STAY", "STAY", "STAY", "BOX", "STAY", "BOX"]), rs),
    moment(39, "VSC", "BOX", 88, callsFor(["BOX", "BOX", "STAY", "BOX", "STAY", null]), rs),
  ];
  return finish(moments, "Singapore 2026", "race");
}

export function momentSummary(players = 3): GameSummary {
  const names = ["Vedant", "Maya", "Ekb", "Priya"].slice(0, players);
  const calls = Object.fromEntries([...names.map((n, i) => [n, (["BOX", "BOX", "STAY", "STAY"] as Call[])[i]]), ["Engine", "BOX"], ["Alpine", "BOX"]]);
  return finish([moment(39, "VSC", "BOX", 88, calls, { Vedant: 30, Maya: 30, Ekb: 37, Priya: 22, Engine: 40, Alpine: 10 })], "Singapore 2026", "moment");
}

function finish(moments: SummaryMoment[], race: string, mode: "race" | "moment"): GameSummary {
  const totals = new Map<string, { kind: MomentEntry["kind"]; name: string; points: number; calls: number; right: number }>();
  for (const m of moments)
    for (const e of m.entries) {
      const t = totals.get(e.name) ?? { kind: e.kind, name: e.name, points: 0, calls: 0, right: 0 };
      t.points += e.points;
      if (e.call) t.calls++;
      if (e.right) t.right++;
      totals.set(e.name, t);
    }
  const rows = [...totals.values()].sort((a, b) => b.points - a.points);
  const players = rows.filter((r) => r.kind === "player");
  const ranking = rows.map((r) => {
    const rank = players.filter((p) => p.points > r.points).length + 1;
    const tied = r.kind === "player" && players.filter((p) => p.points === r.points).length > 1;
    return { ...r, driver_code: "GAS", rank, tied, rank_label: `${tied ? "=" : ""}${rank}` };
  });
  const top = players[0]?.points ?? 0;
  return {
    grading: false,
    mode,
    race,
    cars: [{ code: "GAS", name: "Pierre Gasly", team: "Alpine", team_colour: "#2293D1" }],
    winners: players.length ? { names: players.filter((p) => p.points === top).map((p) => p.name), points: top } : null,
    ranking,
    moments,
    audibles: [],
  };
}
