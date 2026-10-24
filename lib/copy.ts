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
// Signed points with a true minus: "+20", "−12", "0".
const pts = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0");
const pct = (n: number) => (n > 0 ? `+${n}%` : n < 0 ? `−${Math.abs(n)}%` : "0%");
const gainWord = (c: Call) => (c === "BOX" ? "Boxing" : "Staying out");

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
    recording: "Recording. Say box or stay out, and why.",
    // Talk time used against the voice-note cap: "Rec 0:12 / 0:30".
    rec: (s: number, max: number) => `Rec ${clock(s)} / ${clock(max)}`,
    noteCap: (max: number) => `One voice note per call, up to ${max} s.`, // added
    parsed: (c: Call, transcript: string) => `Heard: ${callWord(c)}. "${transcript}"`,
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
    playerFactors: (k: number, n: number, list: string) => `You named ${k} of ${n}${list ? `: ${list}` : ""}.`,
    bestReason: (tla: string, k: number, n: number) => `Best reason: ${tla}, ${k} of ${n} factors`,
    resume: (s: number) => `Replay resumes in ${s} s`,
    noCall: "No call",
    mixed: "Mixed", // added: a camp whose members made different calls
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
    equation: (c: number, r: number, total: number) => `${c}-point stakes, reasoning ${r}/50: ${total} points`,
    outOf: (max: number) => `/ ${max}`,
    percentile: (p: number) => ({ pre: "At or above", num: `${p}%`, post: "of other players on this call." }),
    percentileHelp: (others: number) => `Share of the other ${others} players on this decision who scored at or below you.`,
    lobbyRank: (rank: number, n: number) => `P${rank} of ${n} in this lobby`,
    standings: "Standings", // added
    newLobby: "Create new lobby", // added: host button
    bothCalled: (names: string, c: Call) => `${names} called ${callWord(c).toLowerCase()}.`, // added: lobby facts
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
    you: (rank: number, n: number) => `You: ${rank} of ${n}.`,
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
    // added: consent checkbox (docs/05 logistics; audit M6). The server rejects a join without it.
    consent:
      "Show my nickname and spoken reasons to the room and on the public leaderboard. Your browser's speech recognizer turns your voice into text. In Chrome, that sends the audio to Google. Lobbies, names and calls are deleted within a day.",
    consentMissing: "Tick the box to join.", // added
    // added: the Join bar names what is still missing, in form order
    need: { name: "Add your nickname", consent: "Tick consent", driver: "Pick a driver" },
    rejoin: (name: string) => `Rejoin as ${name}`, // added
    youAre: (name: string) => `You are ${name}`, // added
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
    pitLossLabel: (trigger: TrackStatus) => (trigger === "GREEN" ? "Pit loss at green" : `Pit loss under ${trigger}`),
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
        ? `Gaps from the end of lap ${lap}. The safety car will close these gaps.`
        : `Gaps from the end of lap ${lap}. The virtual safety car will shift these gaps.`,
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
    scSaves: (under: number, normal: number) =>
      under === normal ? `Stop costs ${normal.toFixed(1)} s at green` : `Stop costs ${under.toFixed(1)} s now, ${normal.toFixed(1)} s at green`,
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
    pitNow: (t: TrackStatus) => (t === "GREEN" ? "Now" : `${t} now`),
    pitGreen: "Green",
    pitNote: (t: TrackStatus, saved: number) =>
      t === "GREEN"
        ? "Green flag: the stop costs the full time."
        : `${t === "SC" ? "The safety car halves the stop" : "The VSC cuts the stop by a quarter"}: ${saved.toFixed(1)} s cheaper than at green.`,
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
    inRoom: (n: number) => (n === 0 ? "Nobody in the room yet" : `${n} in the room`),
    waitingHost: "Waiting for the host",
    now: "Now",
    rateShort: (r: number) => `${r > 0 ? "▲" : "▼"}${Math.abs(r).toFixed(1)}/lap`,
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
    ucEstimateTight: (code: string) => `Estimate from gap and pit loss only: about level with ${code}.`,
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
    hideTyping: "Hide",
    send: "Send",
    sendCall: (c: Call) => `Send: ${callWord(c)}`,
    selected: "Your pick",
    moreData: "More numbers",
    lessData: "Fewer numbers",
    keep: (pos: number) => `keep P${pos}`,
    // Stay band: the player's own tyres, so the only tyre age on the band is theirs.
    keepTyres: (pos: number, age: number | null, compound: string | null) =>
      `keep P${pos}${age != null ? `, ${age}-lap ${compound ? `${compound.toLowerCase()}s` : "tyres"}` : ""}`,
    out: (pos: number) => `rejoin P${pos}`,
    you: (tla: string, driver: string, pos: number) => `${tla} · ${driver.slice(0, 3).toUpperCase()} P${pos}`,
    status: (trigger: TrackStatus, lap: number, total: number) =>
      `${trigger === "SC" ? "Safety car" : trigger === "VSC" ? "Virtual safety car" : "Green"} · L${lap}/${total}`,
    boxNow: "Box now:",
    inLead: ", in the lead",
    behindCar: (gap: number, code: string) => `, ${gap.toFixed(1)} s behind ${code}`,
    // Whose tyres, named: "(HAD: 17-lap mediums)".
    rivalTyres: (code: string, age: number, compound: string) => `(${code}: ${age}-lap ${compound.toLowerCase()}s)`,
    lapTyres: (age: number, compound: string | null) => `${age}-lap ${compound ? `${compound.toLowerCase()}s` : "tyres"}`,
    stopCost: (under: number, normal: number) =>
      under === normal ? `Stop costs ${normal.toFixed(1)} s at green.` : `Stop costs ${under.toFixed(1)} s now, ${normal.toFixed(1)} s at green.`,
    lapsLeftOn: (n: number, age: number | null, compound: string | null) =>
      `${n} laps left${age != null ? ` on ${age}-lap ${compound ? compound.toLowerCase() + "s" : "tyres"}` : ""}.`,
    lockedTitle: (c: Call) => `${callWord(c)}. Locked.`,
    room: "The room",
    joinTitle: "Join the room.",
    roomCode: "Room code",
    nickname: "Nickname",
    replayStatus: (lap: number, total: number) => `Replay · L${lap}/${total}`,
    waitingStatus: "Waiting",
    carLine: (number: number, pos: number, compound: string | null, age: number | null) =>
      `#${number} · P${pos}${compound ? ` · ${compound}` : ""}${age != null ? `, ${age} ${age === 1 ? "lap" : "laps"}` : ""}`,
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
    statusLong: (trigger: TrackStatus, lap: number, total: number) =>
      `${trigger === "SC" ? "Safety car" : trigger === "VSC" ? "Virtual safety car" : "Green flag"} · Lap ${lap}/${total}`,
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
    playerState: (name: string, called: boolean) => `${name}: ${called ? "called" : "thinking"}`,
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
    // Round 7 (the max argument is kept for callers; reasoning is out of 50).
    scoringRule: (max: number) => `Points scale with how much the call was worth and how good your reasoning was, out of ${max}.`,
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
    stopCost: (t: TrackStatus, under: number, normal: number) =>
      t === "GREEN"
        ? `The stop costs ${normal.toFixed(1)} s at green.`
        : `The stop costs ${under.toFixed(1)} s under the ${t === "SC" ? "safety car" : "VSC"}, ${normal.toFixed(1)} s at green.`,
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
    distribution: "Every score on this call",
    // Host builder (home redesign, race mode)
    joinSub: "Four letters, on the host's screen.",
    hostSub: "Runs on a laptop everyone can see. Phones join by QR code.",
    stepMode: "Mode",
    stepMoment: "Moment",
    stepRace: "Race",
    stepDrivers: "Drivers",
    modes: {
      moment: { name: "Moment", hint: "One pit call under a safety car. About 2 minutes." },
      race: { name: "Race", hint: "Lap 1 to the flag. A call at every freeze, audibles in between." },
    },
    momentCard: (lap: number, total: number) => `Lap ${lap} of ${total}`,
    raceCard: (laps: number) => `${laps} laps`,
    raceCars: (n: number) => `${n} drivers get calls`,
    preview: "Your lobby",
    previewRaceStatus: (laps: number) => `Race · ${laps} laps`,
    previewRaceLead: (code: string) => `${code}, lap 1 to the flag.`,
    previewRaceSub: (n: number) => `${n} ${n === 1 ? "freeze" : "freezes"}. Audibles any time in between.`,
    previewMomentLead: (code: string, pos: number | null) => (pos == null ? `${code} at the call.` : pos === 1 ? `${code} leads.` : `${code} is P${pos}.`),
    previewChoose: "Each player picks a driver on join.",
    previewChooseSub: "The field turns each player's team colour at the freeze.",
    summary: { mode: "Mode", race: "Race", moment: "Moment", drivers: "Drivers", players: "Players" },
    driversSame: (code: string) => `Everyone drives ${code}`,
    driversChoose: "Each player picks",
    choosePool: (n: number) => `Phones pick from these ${n} drivers. Several players can share one.`,
    playersMax: "Up to 12 phones",
    racesLoading: "Loading races",
  },
  // added: per-driver play (Round 4)
  drivers: {
    pickTitle: "Pick your driver",
    pick: "Pick a driver to join.",
    pickHint: "Ordered by position at the call. Several players can pick the same driver.",
    pickHintRace: "Ordered by start position, with the number of calls each car gets. Several players can pick the same driver.",
    picked: (code: string) => `Driving ${code}`,
    sameMode: "Everyone plays the same driver",
    chooseMode: "Each player picks a driver",
    modeLabel: "Drivers",
    loading: "Loading drivers",
  },
  // added: Round 7 reasoning verdicts written by the server when Muse is off (lib/muse/rubric.ts). At most 18 words.
  grade: {
    labels: {
      tyre_age: "tyre age",
      stops_owed: "stops owed",
      cheap_stop_under_sc: "the cheap SC stop",
      cheap_stop_under_vsc: "the cheap VSC stop",
      similar_cars_pitted: "what rivals did",
      track_position: "track position",
    } as Record<string, string>,
    empty: "No reason given.",
    none: "Named none of the ideas that decided this call.",
    all: "Named every idea that decided this call.",
    some: (named: string, missed: string) => `Named ${named}; missed ${missed}.`,
  },
  // added: Round 7 end-of-game summary (host and phone, moment and race)
  end: {
    scoring: "Scoring the calls",
    scoringFor: (s: number) => `${s} s`,
    final: "Final",
    status: (race: string) => `${race} · Final`,
    wins: (who: string, pts: number) => `${who} wins with ${pts > 0 ? "+" : pts < 0 ? "−" : ""}${Math.abs(pts)}.`,
    tie: (who: string[], pts: number) => `${who.slice(0, -1).join(", ")} and ${who[who.length - 1]} tie on ${pts > 0 ? "+" : pts < 0 ? "−" : ""}${Math.abs(pts)}.`,
    noWinner: "No calls this game.",
    // Seconds, never points: "Boxing gained 15.6 s."
    wasRight: (c: Call, swing: number) => `${gainWord(c)} gained ${swing.toFixed(1)} s.`,
    teamDid: (team: string, c: Call) => `${team} ${callPast(c).toLowerCase()}.`,
    stakes: (n: number) => `${n}-point stakes`,
    gameLine: (moments: number, audibles: number) =>
      `${moments} ${moments === 1 ? "freeze" : "freezes"}${audibles ? `, ${audibles} ${audibles === 1 ? "audible" : "audibles"}` : ""}.`,
    momentHead: (lap: number) => `Lap ${lap}`,
    carRight: (code: string, c: Call, swing: number) => `${code}: ${gainWord(c).toLowerCase()} gained ${swing.toFixed(1)} s`,
    // Round 9 luck: a later red flag, SC/VSC or rain changed the result.
    unlucky: "Right call, unlucky:",
    lucky: "Lucky:",
    moments: "Freeze by freeze",
    audibles: "Audibles",
    audibleRow: (lap: number) => `Box now, lap ${lap}`,
    ranking: "Final ranking",
    // The rule with its numbers, from lib/scoring.ts (lib/client/score.ts WEIGHTS).
    how: (w: { right: number; wrong: number; reasoning: number; reasoningMax: number }, perSecond: number, max: number) =>
      `Stakes: ${perSecond} points per second the call was worth, up to ${max}. Right call ${pct(w.right)} of the stakes, wrong call ${pct(w.wrong)}. Reasoning adds up to ${pct(w.reasoning)}, scored out of ${w.reasoningMax}.`,
    // One score row's arithmetic: the two parts add up to the total.
    split: (s: { right: boolean; call: number; r: number; reasoning: number; total: number }, withTotal = true) =>
      `${s.right ? "Right call" : "Wrong call"} ${pts(s.call)} · Reasoning ${s.r}/50 ${pts(s.reasoning)}${withTotal ? ` = ${pts(s.total)}` : ""}`,
    // A total across several calls.
    sums: (call: number, reasoning: number, total: number) => `Calls ${pts(call)} · Reasoning ${pts(reasoning)} = ${pts(total)}`,
    engineNote: "Engine: our strategy model, scored like a player. Engine and the real team are not ranked.",
    audiblesLine: (n: number, points: number) => `${n} ${n === 1 ? "audible" : "audibles"} ${pts(points)}`,
    stakesTag: (n: number) => `stakes ${n}`,
    right: "Right call",
    wrong: "Wrong call",
    noCall: "No call",
    reasoning: (r: number) => `${r}/50`,
    reasoningLabel: "Reasoning",
    points: (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0"),
    noReason: "No reason given.",
    rankOf: (label: string, n: number) => `${label} of ${n}`,
    rankLine: (label: string, n: number) => `Rank ${label} of ${n}`,
    rankHead: "Rank",
    callsRight: (right: number, calls: number) => `${right} of ${calls} ${calls === 1 ? "call" : "calls"} right`,
    yourCall: "Your call",
    yourTotal: "Your total",
    yourCalls: "Your calls",
    beatEngine: "You beat the engine.",
    engine: "Engine",
    teamRow: (team: string) => `${team} (real team)`,
    carTag: (row: string, code: string) => `${row} · ${code}`,
    showWhy: "Reasons",
    cols: { rank: "#", who: "Who", call: "Call", reasoning: "Reason", points: "Points" },
    newLobby: "Create new lobby",
    leaderboard: "Open leaderboard",
    credit: "Reasons graded by Muse Spark. Speech to text by your browser's recognizer (Chrome uses Google). Engine: offline model on Jolpica and OpenF1 lap data.",
    retry: "Scores didn't load. Retrying.",
    // Phone summary (one screen): place and total, winner line, compact rows.
    place: (rank: number, tied: boolean) => `${tied ? "=" : ""}${ordinal(rank)}`,
    placeTotal: (place: string, pts: number) => `${place} · ${pts > 0 ? "+" : pts < 0 ? "−" : ""}${Math.abs(pts)}`,
    youWin: (pts: number) => `You win with ${pts > 0 ? "+" : pts < 0 ? "−" : ""}${Math.abs(pts)}.`,
    youShare: (others: string[], pts: number) => `You share 1st with ${others.join(" and ")} on ${pts > 0 ? "+" : pts < 0 ? "−" : ""}${Math.abs(pts)}.`,
    yourResult: "Your result",
    seeAll: "See everyone's calls",
    howTitle: "How scoring works",
    wrongStrong: "wrong call · strong reasoning",
    rightWeak: "right call",
    noCallRow: "no call",
    unscored: "not scored",
    boxNow: "Box now",
    rightSwing: (c: Call, swing: number, stakes: number) => `${gainWord(c)} gained ${swing.toFixed(1)} s. ${stakes}-point stakes.`,
    triggerShort: { SC: "SC", VSC: "VSC", RIVAL_STOP: "Rival", UNDERCUT: "Undercut", FAST_DEG: "Deg", TYRE_WINDOW: "Tyres", RAIN: "Rain" } as Record<string, string>,
    // Race mode: after a freeze the race goes on; who was right shows at the flag.
    lockedTitle: "Calls locked.",
    lockedSub: "The race goes on. Who was right shows at the flag.",
    lockedIn: (s: number) => `Replay resumes in ${s} s`,
  },
  // added: race mode (Round 6). Freeze laps come from race state only; nothing here names the team's call before a reveal.
  race: {
    triggers: {
      SC: "Safety car",
      VSC: "Virtual safety car",
      RIVAL_STOP: "Rival stopped nearby",
      UNDERCUT: "Undercut window",
      FAST_DEG: "Tyres fading",
      TYRE_WINDOW: "Tyre window",
      RAIN: "Rain",
    } as Record<string, string>,
    whyTitle: "Why it froze",
    freezeTag: (i: number, n: number | null) => (n ? `Freeze ${i} of ${n}` : `Freeze ${i}`),
    lapTag: (lap: number, total: number) => `L${lap}/${total}`,
    replayTag: "Race",
    progress: "Race",
    freezeMark: (lap: number) => `L${lap}`,
    flag: "Flag",
    noCallTitle: (code: string) => `No call needed for ${code}.`,
    noCallSub: "Watch this one. Audibles open again when the replay restarts.",
    noCallHost: (codes: string[]) => `No call needed: ${codes.join(", ")}`,
    callFor: (codes: string[]) => `Call for ${codes.join(" and ")}`,
    watching: "Watching",
    noCar: "You joined after the start, so you watch this race without a car.",
    scoreTitle: "Race score",
    scoreAfter: (n: number) => (n === 0 ? "Scores show after the first reveal." : `After ${n} ${n === 1 ? "freeze" : "freezes"}`),
    pts: (n: number) => `${n > 0 ? "+" : ""}${n}`,
    lobbyNote: "The replay runs the whole race and freezes when race state calls for a pit decision. Some freezes have stay out as the right call.",
    pickWait: "Waiting for a player to pick a driver.",
    lobbyCar: "Everyone drives",
    lobbyChoose: "Each player picks a driver",
    follows: (code: string) => `Screen follows ${code}`,
    raceLine: (name: string, laps: number) => `${name} · ${laps} laps`,
    // Audible: a "box now" call between freezes.
    audible: {
      title: "Audible",
      button: "Box now",
      hint: "Box now: scored at the flag against cars that stopped around the same laps.",
      why: "Add why",
      whyClose: "Close",
      whyLabel: "Why? (optional)",
      whyPlaceholder: "tyres are going and the gap behind is big",
      sending: "Sending",
      sent: (lap: number) => `Audible in on lap ${lap}. Scored at the flag.`,
      cooldown: (lap: number) => `Next audible on lap ${lap}`,
      lapsLeft: (n: number) => `${n} ${n === 1 ? "lap" : "laps"} to go`,
      ready: "Ready",
      closed: "Audibles are closed during a freeze.",
      failed: "Audible didn't go through. Try again.",
      notYou: "This phone isn't signed in for this car.",
    },
    // Per-freeze reveal.
    revealTag: (i: number, n: number | null, lap: number) => `Reveal ${i}${n ? `/${n}` : ""} · L${lap}`,
    roomOn: (code: string) => `The room on ${code}`,
    nobodyCalled: "Nobody called this one.",
    winning: (c: Call) => `${callWord(c)} was right`,
    worth: (s: number) => `+${s.toFixed(1)} s`,
    worthLabel: "What it was worth",
    window: (a: number, b: number) => (a === b ? `A stop on lap ${a} counts as box.` : `A stop on laps ${a} to ${b} counts as box.`),
    comparison: (boxed: string[], stayed: string[]) =>
      `Measured against ${boxed.length} ${boxed.length === 1 ? "car" : "cars"} that boxed${boxed.length ? ` (${boxed.join(", ")})` : ""} and ${stayed.length} that stayed out${stayed.length ? ` (${stayed.join(", ")})` : ""}.`,
    teamDid: (team: string, c: Call, lap: number | null) => `${team}: ${c === "BOX" && lap != null ? `boxed on lap ${lap}` : callPast(c).toLowerCase()}`,
    engineSaid: (c: Call, pct: number) => `Engine: ${callWord(c).toLowerCase()}, ${pct}%`,
    resumeIn: (s: number) => `Replay resumes in ${s} s`,
    resumeNow: "Resume the race",
    yourCall: "Your call",
    noCall: "No call",
    // Round 7: c is the call's stakes, r the reasoning score, t the signed points.
    scoreLine: (c: number, r: number, t: number) => `${c}-point stakes, reasoning ${r}/50: ${t > 0 ? "+" : t < 0 ? "−" : ""}${Math.abs(t)} points`,
    runningTotal: (n: number) => `Race score ${n}`,
    noCallHere: (code: string) => `No call for ${code} at this freeze.`,
    // Race end.
    flagTitle: "Chequered flag.",
    scoreboardTag: (race: string) => `Scoreboard · ${race}`,
    cols: { rank: "#", player: "Player", car: "Car", audibles: "Audibles", total: "Total" },
    rank: (r: number, n: number) => `P${r} of ${n} in this lobby`,
    audiblesTitle: "Audibles",
    noAudibles: "No audibles this race.",
    audibleRow: (who: string, code: string, lap: number) => `${who} · ${code} · box on lap ${lap}`,
    audibleStatus: {
      pending: "Pending",
      scored: "Scored",
      unscored: "Not scored: no car stopped near that lap",
      cancelled: "Cancelled: a freeze made that call",
    } as Record<string, string>,
    breakdown: "Freeze by freeze",
    freezeCol: (lap: number) => `L${lap}`,
    newLobby: "Create new lobby",
    loading: "Loading the race",
  },
  // added: why a race freeze happened, in plain words (lib/client/triggers.ts parses the engine's numbers)
  triggerInfo: {
    rival: (codes: string[], lap: number) =>
      `${codes.length > 1 ? `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}` : codes[0]} pitted on lap ${lap}.`,
    undercut: (gap: string, code: string, theirs: number, me: string, mine: number, gain: string) =>
      `${gap} s behind ${code}. ${code}'s tyres are ${theirs} laps old, ${me}'s ${mine}. Two laps on new tyres are worth about ${gain} s.`,
    deg: (d: string) => `Last 3 laps: ${d} s a lap slower than early in the stint.`,
    window: (me: string, compound: string, age: number, life: number) =>
      `${me}'s ${compound}s are ${age} laps old. Most cars stop around ${life}.`,
    rain: (started: boolean, lap: number) => (started ? `Rain started on lap ${lap}.` : `Rain eased on lap ${lap}.`),
  },
  tyreLabel: (compound: string, age: number | null) => `${compound}${age != null ? `, ${age} laps` : ""}`, // added: tyre chip label
  cue: { mute: "Mute sound", unmute: "Sound on" },
  compounds: { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Inter", WET: "Wet" } as Record<string, string>,
} as const;

export function factorLabel(id: string): string {
  return COPY.factors[id] ?? id.replace(/_/g, " ");
}

// ---- Voice note (Round 8, tap to talk). Owned by the voice change; other COPY blocks are edited separately. ----
// Same register as COPY.freeze (docs/07 section 4). Error lines reuse COPY.error where docs/07 already has one.
export const VOICE_COPY = {
  tap: "Tap to say why",
  stop: "Tap to stop",
  again: "Tap to record again",
  starting: "Opening the mic",
  recording: "Recording. Say box or stay out, and why. Tap to stop.",
  recordingWhy: "Recording. Say why. Tap to stop.", // a call is already picked: only the why is needed
  tooLate: "Too close to the end to record. Type instead.",
  transcribing: "Copy. Transcribing your note.",
  transcribingShort: "Transcribing",
  unclear: "Didn't catch box or stay out. Tap the mic and say it again, or type it.",
  empty: "No words picked up. Tap the mic and try again, or type it.",
  short: "Too short. Tap once to start, talk, then tap to stop.",
  failed: "Transcription failed. Retry, record again, or type it.",
  retry: "Retry",
  switchedBrowser: "Voice service didn't respond. Switched to browser speech.", // docs/07 "voice service down"
  limit: "Voice note limit for this call. Type the rest.",
  busy: "The mic is in use by another app. Close it, or type your call.",
  editHint: "Edit the transcript before you send.",
} as const;
