// Every user-facing string in the game UI. Source: docs/07-copy-rules.md section 4 (microcopy).
// Strings are sentence case; hero and tower roles are set in capitals by CSS (docs/06 type table).
// Strings marked "added" are not in the docs/07 table; they follow its rules (verb plus object, radio register).
import type { Call, TrackStatus } from "./types";

export const NAME = "[NAME]";

const callWord = (c: Call) => (c === "BOX" ? "Box" : "Stay out");
const callPast = (c: Call) => (c === "BOX" ? "Boxed" : "Stayed out");
const callGerund = (c: Call) => (c === "BOX" ? "Pitting" : "Staying out");

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export const COPY = {
  name: NAME,
  callWord,
  callPast,
  callGerund,
  meta: {
    title: NAME,
    description: "Replay a real F1 race with friends. When the safety car comes out, you make the pit call.",
  },
  home: {
    title: NAME,
    subtitle: "Replay a real F1 race with friends. When the safety car comes out, you make the pit call.",
    nameLabel: "Your name",
    namePlaceholder: "Name on the leaderboard",
    create: "Create lobby",
    creating: "Creating lobby",
    createFailed: "Couldn't create the lobby. Try again.", // added
    decisionLabel: "Race moment", // added
    joinLabel: "Room code",
    join: "Join lobby", // docs/06 3.1 button; verb plus object
    nameMissing: "Enter a name.",
    codeMissing: "Enter a room code.",
    codeNotFound: (code: string) => `No lobby with code ${code}.`,
    leaderboard: "Open leaderboard", // added
    footer: "Not affiliated with Formula 1 or any F1 team.",
  },
  room: {
    heading: (code: string) => `Room ${code}`,
    share: (url: string) => `Share this code. Friends join at ${url}.`,
    copy: "Copy code",
    copied: "Copied",
    scanAlt: (url: string) => `QR code for ${url}`,
  },
  waiting: {
    count: (n: number) => `${n} in lobby`,
    playerView: "Waiting for the host to start.",
    race: (race: string, team: string, driver: string, number: number) =>
      `${race}. You are the ${team} pit wall, ${driver} #${number}.`,
    hostButton: "Start race",
    alone: (code: string) => `Just you so far. Share code ${code}.`,
    joined: "Joined", // added: column label for join order
  },
  replay: {
    lap: (lap: number, total: number) => `Lap ${lap}/${total}`,
    flags: { GREEN: "Green flag", SC: "Safety car", VSC: "Virtual safety car" } satisfies Record<TrackStatus, string>,
    columns: { pos: "Pos", driver: "Driver", gap: "Gap", tyre: "Tyre", age: "Age", pit: "Pit" },
    leader: "Leader", // added: gap cell for P1
    pit: "Pit",
    messages: "Race control", // added: messages column label
    msgStatus: { GREEN: "Green flag", SC: "Safety car deployed", VSC: "Virtual safety car deployed" } satisfies Record<
      TrackStatus,
      string
    >, // added
    msgPit: (code: string) => `${code} pitted`, // added
    skip: "Freeze at the call", // added: host button
  },
  freeze: {
    banner: (trigger: "SC" | "VSC", lap: number) =>
      `${trigger === "SC" ? "Safety car" : "Virtual safety car"}, lap ${lap}. Your call.`,
    question: "Box or stay out?", // docs/06 question
    bannerShort: (trigger: "SC" | "VSC", lap: number) => `${trigger === "SC" ? "Safety car" : "Virtual safety car"} · lap ${lap}`, // docs/06 banner
    // docs/07: "{driver} P{pos}, {compound}s {age} laps old. Gap ahead {ahead} s, behind {behind} s." Parts with no data are left out.
    context: (d: { driver: string; pos: number; compound: string | null; age: number | null; ahead: string; behind: string }) => {
      const tyres = d.age == null ? "" : ` ${d.compound ? `${d.compound}s` : "Tyres"} ${d.age} laps old.`;
      const gaps = [d.ahead !== "–" && `Gap ahead ${d.ahead} s`, d.behind !== "–" && `${d.ahead !== "–" ? "behind" : "Gap behind"} ${d.behind} s`]
        .filter(Boolean)
        .join(", ");
      return `${d.driver} P${d.pos}.${tyres}${gaps ? ` ${gaps}.` : ""}`;
    },
    options: { BOX: "Box", STAY: "Stay out" } satisfies Record<Call, string>,
    countdown: (s: number) => `${s} s`,
    fiveLeft: "5 seconds.",
    timeUp: "Time. Calls locked.",
    ptt: "Hold to talk",
    pttKeyboard: "Hold space to talk",
    recording: "Recording. Say box or stay out, and why.",
    rec: (s: string) => `Rec ${s}`,
    released: "Copy. Reading your call.",
    parsed: (c: Call, transcript: string) => `Heard: ${callWord(c)}. "${transcript}"`,
    unclear: "Didn't catch box or stay out. Hold and say it again, or type it.",
    slow: "Still transcribing. A typed call counts too.",
    typedLabel: "Why?", // added: input label
    typedPlaceholder: "box, the tyres are old and the stop is cheap now",
    submit: "Send call",
    sending: "Sending call",
    locked: (c: Call, t: number) => `Locked: ${callWord(c)} at ${t.toFixed(1)} s.`,
    waitingOn: (n: number) => `Waiting on ${n} ${n === 1 ? "player" : "players"}.`,
    noCall: "No call made. 0 points.",
    pickCall: "Pick box or stay out.", // added: submit with no call selected
    called: "In", // added: lobby strip state (docs/06 IN)
    notCalled: "–",
    showCalls: "Show the calls", // added: host button
  },
  reveal: {
    heading: (lap: number) => `Lap ${lap}: the calls`,
    split: (box: number, stay: number) => `Lobby: ${box} box, ${stay} stay out`, // docs/06 step 1
    teamRow: (team: string, c: Call) => `${team}: ${callPast(c)}`,
    engineRow: (c: Call, confidence: number) => `Engine: ${callWord(c)}, ${confidence}%`,
    playerRow: (name: string, c: Call) => `${name}: ${callWord(c)}`,
    engine: "Engine",
    team: "Team", // added: row label
    verdict: (c: Call) => `Winning call: ${callWord(c).toLowerCase()}`, // docs/06 verdict band
    right: "Right",
    swing: (c: Call, swing: number, k: number) => `${callGerund(c)} was worth ${swing.toFixed(1)} s by lap ${k}.`,
    outcome: {
      "qatar-2025-l7": "McLaren stayed out. Verstappen won, Piastri 2nd, Norris 4th.",
      "singapore-2026-vsc": "Hamilton stayed out and fell from P3 to P6.",
    } as Record<string, string>,
    teamRadio: (lap: number, quote: string) => `Team radio, lap ${lap}: "${quote}"`,
    engineReasons: "Engine reasons",
    factorRuleFor: (n: number, max: number, list: string) =>
      `Reasoning: up to ${max}, split evenly across ${n} factors: ${list}.`, // filled from decision.json and scoring
    playerFactors: (k: number, n: number, list: string) => `You named ${k} of ${n}${list ? `: ${list}` : ""}.`,
    bestReason: (tla: string, k: number, n: number) => `Best reason: ${tla}, ${k} of ${n} factors`,
    resume: (s: number) => `Replay resumes in ${s} s`,
    noCall: "No call",
    camps: "Reasons in the room", // added
    camp: (n: number, total: number, factor: string) => `${n} of ${total}: ${factor}`, // added
    noFactor: "No factor named", // added
    credit: "Speech to text runs in your browser. Engine: offline model on Jolpica lap data.",
    showScores: "Show scores", // added: host button
    who: "Who", // added: column header
    call: "Call",
    score: "Score",
    speed: "Time", // added
    named: "●",
    notNamed: "–",
    grading: "Grading calls", // added
  },
  score: {
    line: (total: number, max: number, c: number, r: number) => `${total}/${max}. Call ${c}, reasoning ${r}.`,
    equation: (c: number, r: number, total: number) => `Call ${c} + reasoning ${r} = ${total}`,
    outOf: (max: number) => `/ ${max}`,
    percentile: (p: number) => ({ pre: "At or above", num: `${p}%`, post: "of other players on this call." }),
    percentileHelp: (others: number) => `Share of the other ${others} players on this decision who scored at or below you.`,
    lobbyRank: (rank: number, n: number) => `P${rank} of ${n} in this lobby`,
    standings: "Standings", // added
    newLobby: "Create new lobby", // added: host button
    bothCalled: (names: string, c: Call) => `${names} called ${callWord(c).toLowerCase()}.`, // added: lobby facts
    beatEngineBy: (who: string, n: number) => `${who} beat the engine by ${n} points.`, // added
    beatTeamBy: (who: string, team: string, n: number) => `${who} scored ${n} more than the ${team} call.`, // added
    pct: "Pct", // added: column header
    total: "Total", // added
  },
  badges: {
    team: { name: "Beat the team call", text: (you: number, team: string, ts: number) => `You scored ${you}, the ${team} call scored ${ts}.` },
    winning: {
      name: "Matched the winning call",
      text: (c: Call) => `${callGerund(c)} gained more time here, and you called it.`,
    },
    engine: { name: "Beat the engine", text: (you: number, es: number) => `You scored ${you}, the engine scored ${es}.` },
    none: "The team call and the engine both scored higher here.",
  },
  leaderboard: {
    title: (race: string, lap: number) => `${race}, lap ${lap}`,
    columns: { rank: "Rank", player: "Player", call: "Call", factors: "Factors", time: "Time", score: "Score", pct: "Percentile" },
    teamRow: (team: string) => `${team} pit wall (real)`,
    engineRow: "Engine",
    footer: (n: number) => `${n} players on this call`,
    you: (rank: number, n: number, pct: number) => `You: ${rank} of ${n}, ${ordinal(pct)} percentile.`,
    youMarker: "You",
    empty: (race: string, lap: number) => `No calls yet on ${race}, lap ${lap}. Play it from a lobby.`,
    first: "No other scores on this call yet.",
    loading: "Loading scores", // added
    back: "Back to start", // added
  },
  play: {
    join: "Join lobby",
    joining: "Joining lobby",
    tla: "Code on the tower", // added: TLA label
    consent: "Show my name and spoken reasons to the room.", // added: consent checkbox (docs/05 logistics)
    consentMissing: "Tick the box to join.", // added
    rejoin: (name: string) => `Rejoin as ${name}`, // added
    youAre: (tla: string) => `You are ${tla}`, // added
  },
  error: {
    micDenied: "Mic blocked. Allow it in your browser's site settings, or type your call.",
    micDeniedShort: "Mic blocked. Tap box or stay out and type why.", // docs/06
    noMic: "No mic found. Type your call.",
    voiceDown: "Voice service didn't respond. Switched to browser speech.",
    bothDown: "Voice isn't working. Type your call.",
    connectionLost: "Connection lost. Reconnecting.",
    reconnected: (lap: number) => `Back. Replay synced to lap ${lap}.`,
    gaveUp: "Can't reach the lobby. Check your connection and reload.",
    nameTaken: (name: string) => `${name} is taken in this lobby. Pick another.`,
    generic: (code: string) => `Something broke on our side. Reload to rejoin ${code}.`,
    data: "Race data is missing. Reload to try again.", // added
  },
  empty: {
    noRadio: "No team radio for this moment.",
    noEngine: "No engine call for this moment.",
  },
  factors: {
    tyre_age: "Tyre age",
    cheap_stop_under_sc: "Cheaper stop under SC",
    cheap_stop_under_vsc: "Cheaper stop under VSC",
    similar_cars_pitted: "Similar cars pitted",
    track_position: "Track position",
  } as Record<string, string>,
  compounds: { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Inter", WET: "Wet" } as Record<string, string>,
} as const;

export function factorLabel(id: string): string {
  return COPY.factors[id] ?? id.replace(/_/g, " ");
}
