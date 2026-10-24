// Every user-facing string in the game UI. Source: docs/07-copy-rules.md section 4 (microcopy).
// Strings are sentence case; hero and tower roles are set in capitals by CSS (docs/06 type table).
// Strings marked "added" are not in the docs/07 table; they follow its rules (verb plus object, radio register).
import type { Call, TrackStatus } from "./types";

export const NAME = "OutpaceF1";

const callWord = (c: Call) => (c === "BOX" ? "Box" : "Stay out");
const callPast = (c: Call) => (c === "BOX" ? "Boxed" : "Stayed out");
const callGerund = (c: Call) => (c === "BOX" ? "Pitting" : "Staying out");

// "40 s" under a minute, "12 min" above.
const waitText = (s: number) => (s < 60 ? `${Math.ceil(s)} s` : `${Math.ceil(s / 60)} min`);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

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
    // added: 429 on create (hourly lobby cap); s from Retry-After
    createLimited: (s: number | null) =>
      `Lobby limit reached for this hour. Try again in ${s ? waitText(s) : "a few minutes"}.`,
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
    // Talk time used against the voice-note cap: "Rec 0:12 / 0:30".
    rec: (s: number, max: number) => `Rec ${clock(s)} / ${clock(max)}`,
    reRecord: "Hold to record again", // added: one voice note per call; a new one replaces it
    noteCap: (max: number) => `One voice note per call, up to ${max} s.`, // added
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
    mixed: "Mixed", // added: a camp whose members made different calls
    camps: "Reasons in the room", // added
    camp: (n: number, total: number, factor: string) => `${n} of ${total}: ${factor}`, // added
    noFactor: "No factor named", // added
    campsByMuse: "Grouped by Muse Spark from what you said.", // added: source line under Muse camp labels
    credit: "Reasons graded and grouped by Muse Spark. Speech to text by your browser's recognizer (Chrome uses Google). Engine: offline model on Jolpica and OpenF1 lap data.",
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
    hidden: "Calls and reasons show here after your lobby's reveal. Until then: names and scores only.", // added
  },
  play: {
    join: "Join lobby",
    joining: "Joining lobby",
    tla: "Code on the tower", // added: TLA label
    // added: consent checkbox (docs/05 logistics; audit M6). The server rejects a join without it.
    consent:
      "Show my nickname and spoken reasons to the room and on the public leaderboard. Your browser's speech recognizer turns your voice into text. In Chrome, that sends the audio to Google. Lobbies, names and calls are deleted within a day.",
    consentMissing: "Tick the box to join.", // added
    rejoin: (name: string) => `Rejoin as ${name}`, // added
    youAre: (tla: string) => `You are ${tla}`, // added
    gridSlot: (n: number) => `P${n}`, // added: lobby grid slot
    open: "Open", // added: empty grid slot
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
    lobbyFull: "Lobby is full: 12 players. Ask the host to start a new one.", // added: 409 on join
    rateLimited: (s: number | null) => `Too many requests from this network. Try again in ${s ? waitText(s) : "a few seconds"}.`, // added: 429
    notHost: (code: string) => `This screen can't run room ${code}. Use the screen that created the lobby.`, // added: 403 on phase
    removed: "Removed by the host.", // added: kicked from the lobby (join 403 or name gone from the poll)
    notYou: (name: string) => `This phone isn't signed in as ${name}. Send the call from the phone you joined on.`, // added: 403 on submit
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
  // added: Simple / Advanced data mode
  mode: {
    label: "Data",
    simple: "Simple",
    advanced: "Advanced",
    position: (pos: number) => `P${pos}`,
    carBehind: (s: string) => `Car behind ${s} s`,
    noCarBehind: "No car behind",
    tyres: (age: number) => `Tyres ${age} laps old`,
    trackWords: {
      GREEN: "Green flag: a stop costs the full time.",
      SC: "Safety car: a stop costs about half the usual time.",
      VSC: "Virtual safety car: a stop costs about three quarters of the usual time.",
    } satisfies Record<TrackStatus, string>,
    // Host freeze, Simple: one plain sentence.
    hostLine: (driver: string, pos: number, age: number | null, trigger: "SC" | "VSC") =>
      `${driver} is P${pos}${age != null ? ` on tyres ${age} laps old` : ""}, and a stop under the ${
        trigger === "SC" ? "safety car costs about half" : "virtual safety car costs about three quarters of"
      } the usual time.`,
    // Advanced figures, label then value.
    pitLossLabel: (trigger: "SC" | "VSC") => `Pit loss under ${trigger}`,
    pitLoss: (under: number, normal: number) => `${under.toFixed(1)} s (normal ${normal.toFixed(1)} s)`,
    lapsLeft: "Laps left",
    medianAge: "Field median tyre age",
    laps: (n: number) => `${n} laps`,
    within: "Cars within one pit loss behind",
    compound: "Compound",
    gapAhead: "Gap ahead",
    gapBehind: "Gap behind",
    seconds: (s: string) => `${s} s`,
    interval: "Int",
    // After the reveal.
    measured: "How the winning call was measured",
    pairs: (n: number, from: number, to: number, mean: number, c: Call) =>
      `${n} pairs of cars within 3 places, lap ${from} to ${to}: ${callGerund(c).toLowerCase()} gained ${mean.toFixed(1)} s on average.`,
    places: (who: string, s: { n_box: number; n_stay: number; box_mean_gain: number; stay_mean_gain: number }, lap: number) =>
      `${who}: ${s.n_box} boxed, ${s.n_stay} stayed out. Places gained by lap ${lap}: box ${signed(s.box_mean_gain)}, stay out ${signed(s.stay_mean_gain)}.`,
    field: "Whole field",
    cohort: "Cars on similar tyres",
  },
  // added: pit rejoin projector (pre-call info only) and the Simple race story
  rejoin: {
    title: "If you box now",
    assumption: "If no one else stops.",
    line: (pos: number, ahead: { code: string; gap: number } | null, behind: { code: string; gap: number } | null, clean: boolean) => {
      const a = ahead ? `, ${ahead.gap.toFixed(1)} s behind ${ahead.code}` : ", in the lead";
      const b = behind ? (clean ? `, clean air behind` : `, ${behind.code} ${behind.gap.toFixed(1)} s behind`) : "";
      return `Box now: out P${pos}${a}${b}.`;
    },
    out: (pos: number) => `Out P${pos}`,
    ahead: "Ahead",
    behind: "Behind",
    none: "Nobody",
    clean: "Clean air",
    traffic: (code: string) => `Traffic: ${code}`,
    loss: (s: number) => `Stop costs ${s.toFixed(1)} s`,
    ghost: "Box",
    // added: the projection uses end-of-lap gaps; a neutralisation changes them
    caveat: (status: "SC" | "VSC", lap: number) =>
      status === "SC"
        ? `Gaps from the end of lap ${lap}. The safety car will close them up.`
        : `Gaps from the end of lap ${lap}. They will shift under the VSC.`,
  },
  story: {
    stay: "Stay out",
    box: "Box",
    stayKeep: (pos: number) => `Keep P${pos}`,
    stayTyres: (age: number) => `Tyres stay ${age} laps old`,
    boxTyres: "New tyres",
    lapsLeft: (n: number) => `${n} laps left`,
    tyreRank: (newer: number, field: number) => `${newer} of ${field} cars on newer tyres`,
    pittedAhead: (n: number, of: number) => `${n} of ${of} cars ahead pitted this lap`,
    nearStops: (n: number, of: number) => `${n} of ${of} cars around you stopped earlier`,
    scSaves: (under: number, normal: number) => `Stop costs ${under.toFixed(1)} s now, ${normal.toFixed(1)} s at green`,
  },
  // added: telemetry around the player's car at the call moment (lib/client/telemetry.ts)
  tele: {
    title: "Telemetry",
    lapTimeLabel: (n: number, vs: string) => `Lap time · last ${n}${vs ? ` · you vs ${vs}` : ""}`,
    vsAhead: "car ahead",
    vsBehind: "car behind",
    vsBoth: "",
    stintLapTimes: "Stint lap times",
    lapRange: (a: number, b: number) => `L${a}-${b} · s`,
    lap: (n: number) => `L${n}`,
    you: "You",
    ahead: "Ahead",
    behind: "Behind",
    tyre: "Tyre",
    none: "–",
    youLead: "you lead",
    lastCar: "last car",
    gapValue: (code: string, s: number) => `${code} ${s >= 0 ? "+" : ""}${s.toFixed(1)}`,
    rateLine: (r: number | null, kind: "ahead" | "behind") => {
      if (r == null || Math.abs(r) < 0.05) return "steady";
      const open = r > 0;
      return `${open ? "+" : "-"}${Math.abs(r).toFixed(1)} s/lap ${open ? "opening" : kind === "ahead" ? "closing in" : "closing"}`;
    },
    tyreValue: (letter: string | null, age: number | null) => `${letter ?? "?"} · ${age ?? "–"}`,
    offBest: (d: number | null) => (d == null ? "no clean laps" : `+${Math.max(0, d).toFixed(2)} off best`),
    noTimes: "No clean green-flag laps to compare yet.",
    intervals: "Intervals per lap",
    intervalsMeta: "trend s/lap, last 3",
    gapHead: "Gap",
    trendHead: "Trend",
    intervalNote: (code: string, r: number, ahead: boolean) =>
      ahead
        ? `You ${r < 0 ? "gain" : "lose"} ${Math.abs(r).toFixed(1)} s a lap on ${code}.`
        : `${code} is ${r > 0 ? "losing" : "gaining"} ${Math.abs(r).toFixed(1)} s a lap ${r > 0 ? "to" : "on"} you.`,
    rejoinPair: (a: string, b: string) => `${a} and ${b} are the cars you would rejoin between.`,
    fieldTyres: "Field tyres",
    fieldMeta: (n: number, median: number | null) => `all ${n} cars${median != null ? ` · median ${median} laps` : ""}`,
    mix: (parts: string[]) => `${parts.join(", ")}.`,
    mixPart: (n: number, compound: string) => `${n} ${compound.toLowerCase()}`,
    stoppedNone: "Nobody has stopped yet.",
    stopped: (n: number) => `${n} ${n === 1 ? "car has" : "cars have"} stopped.`,
    pitLoss: "Pit loss",
    pitMeta: "pit lane + stationary",
    pitNow: (t: "SC" | "VSC") => `${t} now`,
    pitGreen: "Green",
    pitNote: (t: "SC" | "VSC", saved: number) =>
      `${t === "SC" ? "The safety car halves the stop" : "The VSC cuts the stop by a quarter"}: ${saved.toFixed(1)} s cheaper than at green.`,
    stint: "Stint",
    stintMeta: (code: string, number: number) => `${code} #${number}`,
    stintCols: { stint: "Stint", tyre: "Tyre", laps: "Laps", best: "Best", trend: "Trend" },
    stintNow: "1 now",
    stintBox: "2 if box",
    stintStay: "2 if stay",
    newTyres: "new",
    greenStop: "green stop",
    lapsCount: (n: number) => `${n} laps`,
    perLap: (r: number) => `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(2)}/lap`,
    plusSeconds: (s: number) => `+${s.toFixed(1)} s`,
    rejoinTitle: "Rejoin if you box",
    rejoinMeta: "gap to leader, s",
    rejoinNote: (pos: number, ahead: { code: string; gap: number } | null, behind: { code: string; gap: number } | null) =>
      `Out P${pos}: ${ahead ? `${ahead.gap.toFixed(1)} s behind ${ahead.code}` : "in the lead"}${behind ? `, ${behind.gap.toFixed(1)} s ahead of ${behind.code}` : ""}.`,
    decisionComing: "Decision coming",
    lapsToGo: (n: number) => `${n} ${n === 1 ? "lap" : "laps"} to go`,
    inRoom: (n: number) => `${n} in the room`,
    waitingHost: "Waiting for the host",
    now: "Now",
    sideAhead: "ahead",
    sideBehind: "behind",
    gapAhead: (s: number) => `+${s.toFixed(1)} s`,
    gapBehind: (s: number) => `${s.toFixed(1)} s`,
    youNow: (pos: number) => `P${pos}`,
    undercut: "Undercut clock",
    undercutMeta: (loss: number, t: "SC" | "VSC" | "GREEN") => `pit loss ${loss.toFixed(1)} s${t === "GREEN" ? "" : ` (${t})`}`,
    ucPitted: (code: string, laps: number, compound: string | null) =>
      `${code} boxed ${laps} ${laps === 1 ? "lap" : "laps"} ago${compound ? `, new ${compound.toLowerCase()}s` : ""}`,
    ucPace: (p: number) => (p < 0 ? `, gaining ${Math.abs(p).toFixed(1)} s a lap.` : `, ${p.toFixed(1)} s a lap slower than you.`),
    ucNoPace: ".",
    ucBoxNow: (code: string, v: number) => `Box now: you come out ${Math.abs(v).toFixed(1)} s ${v >= 0 ? "ahead of" : "behind"} ${code}.`,
    ucWait: (v: number) => `Wait a lap: ${Math.abs(v).toFixed(1)} s ${v >= 0 ? "ahead" : "behind"}.`,
    ucTight: (code: string) => `Very tight: about level with ${code} if you box now.`,
    ucWaitTight: "Wait a lap: about level.",
    ucTooEarly: (code: string, compound: string | null) =>
      `${code} just boxed${compound ? `, new ${compound.toLowerCase()}s` : ""}. Too early to read the pace: expect it to be very tight.`,
    ucEstimate: (code: string, v: number) =>
      `Estimate from gap and pit loss only: ${Math.abs(v).toFixed(1)} s ${v >= 0 ? "ahead of" : "behind"} ${code}.`,
    ucStaysTight: (code: string) => `If you box and ${code} stays out: about level with ${code}.`,
    ucStays: (code: string, v: number) => `If you box and ${code} stays out: you come out ${Math.abs(v).toFixed(1)} s ${v >= 0 ? "ahead of" : "behind"} ${code}.`,
    ucGain: (g: number, n: number) => `New tyres have been worth about ${g.toFixed(1)} s a lap for the ${n} ${n === 1 ? "car" : "cars"} that stopped. An estimate.`,
    ucPaceAdv: (p: number, a: number, b: number) => `Pace delta ${p > 0 ? "+" : "-"}${Math.abs(p).toFixed(2)} s/lap, laps ${a} to ${b}, out-lap excluded.`,
    ucUntil: (n: number | null) =>
      n == null ? "No undercut at this pace." : n === 0 ? "Already undercut: boxing now puts you behind." : `Undercut in ${n} ${n === 1 ? "lap" : "laps"} if you stay out.`,
    ucInputs: (gap: number, loss: number) => `Inputs: gap ${gap >= 0 ? "+" : "-"}${Math.abs(gap).toFixed(1)} s now, pit loss ${loss.toFixed(1)} s.`,
    boxed: "Boxed",
    noStop: "No stop",
    notYet: "Not yet",
    callOf: (c: Call) => callPast(c),
    gapS: (s: number) => `${s.toFixed(1)} s`,
    rate: (r: number | null) => (r == null || Math.abs(r) < 0.05 ? "steady" : `${Math.abs(r).toFixed(1)} s/lap`),
    rateWord: (r: number | null, kind: "ahead" | "behind") =>
      r == null || Math.abs(r) < 0.05 ? "" : r > 0 ? "opening" : kind === "ahead" ? "you close" : "closing",
  },
  // added: phone call screen and shell
  phone: {
    typeInstead: "Type",
    hideTyping: "Close",
    send: "Send",
    sendCall: (c: Call) => `Send: ${callWord(c)}`,
    selected: "Your pick",
    holdWhy: "Hold to say why",
    release: "Release to send the note",
    moreData: "More numbers",
    lessData: "Fewer numbers",
    keep: (pos: number) => `keep P${pos}`,
    out: (pos: number) => `out P${pos}`,
    you: (tla: string, driver: string, pos: number) => `${tla} · ${driver.slice(0, 3).toUpperCase()} P${pos}`,
    status: (trigger: "SC" | "VSC", lap: number, total: number) => `${trigger} · L${lap}/${total}`,
    boxNow: "Box now:",
    inLead: ", in the lead",
    onTyres: (age: number, compound: string) => `on ${age}-lap ${compound.toLowerCase()}s`,
    lapTyres: (age: number, compound: string | null) => `${age}-lap ${compound ? `${compound.toLowerCase()}s` : "tyres"}`,
    stopCost: (under: number, normal: number) => `Stop costs ${under.toFixed(1)} s now, ${normal.toFixed(1)} s at green.`,
    lapsLeftOn: (n: number, age: number | null, compound: string | null) =>
      `${n} laps left${age != null ? ` on ${age}-lap ${compound ? compound.toLowerCase() + "s" : "tyres"}` : ""}.`,
    lockedTitle: (c: Call) => `${callWord(c)}.`,
    lockedAt: (t: number) => `Locked at ${t.toFixed(1)} s.`,
    room: "The room",
    joinTitle: "Join the room.",
    roomCode: "Room code",
    nickname: "Nickname",
    replayStatus: (lap: number, total: number) => `Replay · L${lap}/${total}`,
    waitingStatus: "Waiting",
    carLine: (number: number, pos: number, compound: string | null, age: number | null) =>
      `#${number} · P${pos}${compound ? ` · ${compound}` : ""}${age != null ? `, ${age} laps` : ""}`,
    replayChart: (vs: string) => `Lap time · you vs ${vs}`,
    resultStatus: (race: string, lap: number) => `${race} · L${lap}`,
    rightCall: "Right call.",
    otherCall: (c: Call) => `${callWord(c)} was the winning call.`,
    worth: (c: Call, swing: number, team: string, teamCall: Call) =>
      `${callGerund(c)} was worth ${swing.toFixed(1)} s. ${team} ${callPast(teamCall).toLowerCase()}.`,
    percentile: "Percentile",
    top: (pct: number) => `Top ${Math.max(1, 100 - pct)}%`,
    calledIn: "Called in",
    engineSaid: "Engine said",
    engineValue: (c: Call, conf: number) => `${callWord(c)} ${conf}%`,
    score: "Score",
    badges: "Badges",
    yourCamp: (call: string, others: string[]) => `Your camp · ${call}${others.length ? ` · with ${others.join(", ")}` : ""}`,
    campCount: (n: number, total: number) => `${n} of ${total} in the room`,
    scoreFoot: (n: number) => `score ${n}`,
    teamEngine: "Team and engine",
    yourCall: "Your call",
    howScored: "How it was scored",
    neighbours: "Cars either side",
    standing: "Your standing",
  },
  // added: host laptop screens
  host: {
    room: (code: string) => `Room ${code}`,
    joinAt: (url: string) => `Friends join at ${url}`,
    // Before the reveal: driver code only, no race or team name.
    lead: (code: string, pos: number) => (pos === 1 ? `${code} leads.` : `${code} is P${pos}.`),
    statusLong: (trigger: "SC" | "VSC", lap: number, total: number) =>
      `${trigger === "SC" ? "Safety car" : "Virtual safety car"} · Lap ${lap}/${total}`,
    remove: (name: string) => `Remove ${name}`,
    removeShort: "Remove",
    confirmRemove: "Tap again to remove",
    confirmShort: "Tap again",
    callsIn: (s: number) => `Calls in ${s} s`,
    andMore: (n: number) => `…and ${n} more`,
    drives: (car: string, who: string[]) => `${car}: ${who.join(", ")}`,
    carSplit: (car: string, box: number, stay: number) => `${car}: ${box} box, ${stay} stay out`,
    otherCar: (code: string, team: string, did: Call, engine: Call, pct: number, correct: Call, swing: number) =>
      `${code} · ${team} ${did === "BOX" ? "boxed" : "stayed out"} · engine ${engine === "BOX" ? "box" : "stay out"} ${pct}% · ${correct === "BOX" ? "boxing" : "staying out"} worth ${swing.toFixed(1)} s`,
    playerState: (tla: string, called: boolean) => `${tla}: ${called ? "called" : "thinking"}`,
    stayLine: (pos: number, behind: { code: string; gap: string } | null) =>
      `keep P${pos}${behind ? ` · ${behind.code} ${behind.gap} s behind` : ""}`,
    boxLine: (pos: number, laps: number) => `out P${pos} · fresh tyres for ${laps} laps`,
    called: "called",
    thinking: "thinking",
    next: "Next",
    step: (n: number, of: number) => `Step ${n} of ${of}`,
    carLine: (code: string, number: number) => `Your car: ${code} #${number}`,
    roomCode: "Room code",
    players: "Players",
    playersCount: (n: number, max: number) => `${n} / ${max} players`,
    scanOr: (url: string) => `Scan or go to ${url}`,
    yourCar: "Your car",
    carBand: (code: string, number: number) => `${code} #${number}`,
    replayNote: (from: number, lap: number) => `Replay starts at lap ${from}. The call comes at lap ${lap}.`,
    replayTag: "Replay",
    youAre: (code: string, pos: number) => `You are ${code}, P${pos}.`,
    callIn: (n: number) => (n <= 0 ? "The call is now." : n === 1 ? "A call is coming next lap." : `A call is coming in ${n} laps.`),
    callAt: (lap: number) => `Call · L${lap}`,
    gapTitle: (code: string, side: "ahead" | "behind") => `Gap to ${code}, ${side}`,
    sinceLap: (r: number, lap: number) => `${r > 0 ? "+" : ""}${r.toFixed(2)} s/lap since L${lap}`,
    tyreTitle: "Tyre",
    tyreNow: (compound: string, age: number | null) => `${compound}${age != null ? ` · ${age} laps` : ""}`,
    bestSoFar: (t: string) => `${t} · best so far`,
    lapTimeTitle: "Lap time · s",
    lapTimeLast: (n: number) => `Lap time · last ${n}`,
    stintTimes: "Stint lap times",
    intervalsTitle: "Intervals per lap",
    fieldTyres: "Field tyres",
    agesRange: (lo: number, hi: number) => (lo === hi ? `All ${lo} laps old` : `Ages ${lo} to ${hi}`),
    tyreCounts: (parts: string[], stopped: number) =>
      `${parts.join(", ")}. ${stopped === 0 ? "Nobody has stopped." : `${stopped} ${stopped === 1 ? "car has" : "cars have"} stopped.`}`,
    pitNow: (t: "SC" | "VSC") => `${t} now`,
    pitGreen: "Green",
    pitLoss: "Pit loss",
    pitCheaper: (t: "SC" | "VSC", s: number) => `Under the ${t === "SC" ? "safety car" : "VSC"} the stop is ${s.toFixed(1)} s cheaper.`,
    stint: "Stint",
    stintCols: { stint: "Stint", tyre: "Tyre laps", best: "Best", trend: "Trend" },
    stintNow: "1 now",
    stintBox: "2 if box",
    stintStay: "2 if stay",
    stintNew: (from: number, to: number) => `new ${from}-${to}`,
    stintLater: "new, green stop",
    lapsCount: (n: number) => `${n} laps`,
    rejoinTitle: "Rejoin if you box",
    gapToLeader: "Gap to leader",
    revealTag: (n: number, of: number, race: string, lap: number) => `Reveal ${n}/${of} · ${race} · L${lap}`,
    roomSplit: (box: number, stay: number) =>
      box === 0 || stay === 0
        ? `Everyone called ${box ? "box" : "stay out"}.`
        : box === stay
          ? `The room split ${box} to ${stay}.`
          : `The room split ${Math.max(box, stay)} to ${Math.min(box, stay)}.`,
    campTag: (c: string) => `Camp · ${c}`,
    calledAt: (t: string) => `called at ${t}`,
    teamDid: (team: string) => `${team} did`,
    engineSaid: "Engine said",
    outcome: "Outcome",
    worth: (c: Call) => `what ${c === "BOX" ? "boxing" : "staying out"} was worth`,
    diffTitle: "Cars that boxed minus cars that stayed, within 3 places, by lap",
    diffNote: "Above zero: boxing ahead",
    boxAhead: "box ahead",
    boxBehind: "box behind",
    atLap: (s: number, lap: number) => `${s > 0 ? "+" : ""}${s.toFixed(1)} s at L${lap}`,
    takesRound: (who: string) => `${who} takes the round.`,
    scoreboardTag: (race: string, lap: number) => `Scoreboard · ${race} · L${lap}`,
    cols: { rank: "#", player: "Player", call: "Call", time: "Time", vsEngine: "Vs engine", callPts: "Right call", reason: "Reason", pct: "Pct", total: "Total" },
    agreed: "agreed",
    against: "against",
    scoringRule: (max: number) => `Right call +100 · reasoning up to +${max}, split across the factors`,
    you: "You",
    ahead: "Ahead",
    behind: "Behind",
    leading: "leading",
    lastCar: "last car",
    rate: (r: number | null) =>
      r == null || Math.abs(r) < 0.05 ? "steady" : `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(2)} s/lap ${r > 0 ? "opening" : "closing"}`,
    offBest: (d: number | null) => (d == null ? "no clean laps yet" : `+${Math.max(0, d).toFixed(1)} s off best`),
    noTimes: "No clean green-flag laps yet.",
    boxNowSentence: (pos: number, ahead: { code: string; gap: number } | null) =>
      `Box now and ${pos === 1 ? "you stay in front" : `you come out P${pos}`}${ahead ? `, ${ahead.gap.toFixed(1)} s behind ${ahead.code}` : ""}.`,
    stopCost: (t: "SC" | "VSC", under: number, normal: number) =>
      `The stop costs ${under.toFixed(1)} s under the ${t === "SC" ? "safety car" : "VSC"}, ${normal.toFixed(1)} s at green.`,
    lapsLeftOn: (n: number, age: number | null, compound: string | null) =>
      `${n} laps left${age != null ? ` on ${age}-lap ${compound ? `${compound.toLowerCase()}s` : "tyres"}` : ""}.`,
    rejoinBoth: (pos: number, ahead: { code: string; gap: number } | null, behind: { code: string; gap: number } | null) =>
      `Out P${pos}.${ahead ? ` ${ahead.code} ${ahead.gap.toFixed(1)} s ahead.` : ""}${behind ? ` ${behind.code} ${behind.gap.toFixed(1)} s behind.` : ""}`,
    boxNowShort: (pos: number, ahead: { code: string; gap: number } | null, behind: { code: string; gap: number } | null) =>
      `out P${pos}${ahead ? `, ${ahead.gap.toFixed(1)} s behind ${ahead.code}` : ""}${behind ? `, ${behind.gap.toFixed(1)} s ahead of ${behind.code}` : ""}.`,
    boxNowLead: "Box now:",
  },
  // added: home and leaderboard layout labels
  homeUi: {
    joinTitle: "Join a room",
    joinHint: "Four letters, on the host's screen.",
    codePlaceholder: "ABCD",
    hostTitle: "Host a game",
    hostHint: "Run it on a laptop everyone can see. Phones join by QR code.",
    leaderboardTitle: "Leaderboard",
    leaderboardHeadline: "Every room's calls.",
    allRooms: "All rooms",
    calls: (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "call" : "calls"}`,
    yourMark: "Square = your room",
    distribution: "Every score on this call, 0 to 150",
  },
  // added: per-driver play (Round 4)
  drivers: {
    pickTitle: "Pick your driver",
    pick: "Pick a driver to join.",
    pickHint: "Ordered by position at the call. Several players can pick the same driver.",
    picked: (code: string) => `Driving ${code}`,
    sameMode: "Everyone plays the same driver",
    chooseMode: "Each player picks a driver",
    modeLabel: "Drivers",
    loading: "Loading drivers",
  },
  cue: { mute: "Mute sound", unmute: "Sound on" },
  compounds: { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Inter", WET: "Wet" } as Record<string, string>,
} as const;

export function factorLabel(id: string): string {
  return COPY.factors[id] ?? id.replace(/_/g, " ");
}
