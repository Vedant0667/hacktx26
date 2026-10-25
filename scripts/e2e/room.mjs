// Big-room e2e: one race lobby (driver_mode "choose") with a host screen and N phones (default 6, max 12) that
// behave like a real party: shared cars, a long and a unicode name, voice, typed and button-only calls, a call
// left to the 0 s auto-send, a player who ignores the freeze, a "Box now" audible, and one player kicked from
// the lobby before the start. The host page drives the race on its own (the harness only nudges a phase that
// is stuck, and that counts as a failure). Then it checks the database, Muse grading, the end screens, the
// console and the layout.
//
//   node --env-file=.env.local scripts/e2e/room.mjs --base http://localhost:3150 --ui racenight|classic \
//     --phones 6 --puppeteer /Users/vedant/baskaran-edge/node_modules/puppeteer-core --out <dir> [--db prod|dev]
//
// NOT hermetic: needs a running server and its Neon DB (prod for https://outpacef1.vercel.app, else DATABASE_URL;
// --db overrides). POST /transcribe is stubbed in the browser (no Muse ASR spend); the end-of-game grading of the
// spoken and typed reasons is real Muse spend (cents).
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectorsFor } from "./selectors.mjs";
import { bodyText, dbUrlFor, ensureDir, hostShot, launch, locate, makeApi, makeDb, newPage, pageIssues, press, record, results, shot, sleep, waitLocate } from "./lib.mjs";

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : [])),
);
const BASE = (args.base ?? "http://localhost:3150").replace(/\/$/, "");
const UI = args.ui ?? "racenight";
if (!["classic", "racenight"].includes(UI)) throw new Error(`--ui must be classic or racenight, got ${UI}`);
const N = Number(args.phones ?? 6);
if (!Number.isInteger(N) || N < 1 || N > 12) throw new Error(`--phones must be 1..12, got ${args.phones}`);
const PUPPETEER = args.puppeteer ?? process.env.PUPPETEER_PATH ?? "puppeteer-core";
const CHROME = args.chrome ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const AUDIO = args.audio ?? "/private/tmp/claude-501/-Users-vedant-HackTX26/a0935160-98ac-4dce-ac07-9f67606a9870/scratchpad/voice/box16c.wav";
const OUT = args.out ?? join(tmpdir(), `outpace-room-${UI}-${N}-${Date.now()}`);
const RACE_KEY = args.race ?? "2026-singapore";
const SCEN = `room${N}`;
const SEL = selectorsFor(UI);
const STUB = "stub transcript box box";
const TYPED = "Tyres are gone and the gap behind is big enough";
const LONG = "Maximilian-Alexander";
const KICKED = { name: "Spare Phone", driver: "HAM" };
const DB = dbUrlFor(BASE, args.db);
const sql = makeDb(DB.url);
const api = makeApi(BASE, process.env.SITE_PASSWORD ?? (() => { throw new Error("SITE_PASSWORD is not set (run with --env-file=.env.local)"); })());
ensureDir(OUT);
const ctxShot = { out: OUT, ui: UI, scenario: SCEN };

// The room. The first six are the brief's mix (3 GAS, 2 LEC, 1 NOR); 7-12 repeat the behaviours on all three cars.
// voiceRec: Box + voice note + Send while recording. voiceStop: Stay out + voice + stop + Send at once (still
// transcribing). typed: Box + typed reason + Send. autosend: picks Stay out, never sends (0 s auto-send).
// ignore: does nothing at the freeze. audible: "Box now" during the replay; at freezes Box + Send, no reason.
const ROSTER = [
  { name: "Alpha", driver: "GAS", b: "voiceRec" },
  { name: LONG, driver: "GAS", b: "voiceStop" },
  { name: "Zoë", driver: "GAS", b: "typed" },
  { name: "Priya", driver: "LEC", b: "autosend" },
  { name: "Tom", driver: "LEC", b: "ignore" },
  { name: "Kenji", driver: "NOR", b: "audible" },
  { name: "Sam", driver: "GAS", b: "voiceRec" },
  { name: "Luís", driver: "LEC", b: "typed" },
  { name: "Mei", driver: "NOR", b: "voiceStop" },
  { name: "Ana", driver: "NOR", b: "ignore" },
  { name: "Dev", driver: "GAS", b: "audible" },
  { name: "Ola", driver: "LEC", b: "autosend" },
].slice(0, N);
const EXPECT_CALL = { voiceRec: "BOX", voiceStop: "STAY", typed: "BOX", autosend: "STAY", ignore: null, audible: "BOX" };
const EXPECT_TEXT = { voiceRec: STUB, voiceStop: STUB, typed: TYPED.toLowerCase() };

let gate;
let browser;
let code = null;
let hostToken = null;
let hostPage = null;
let kicked = null;
const phones = [];
const notes = []; // informational lines for the summary
const nudges = [];

// ---- lobby helpers ----
const lobbyPath = `/api/lobby/`;
async function state() {
  const r = await api.get(lobbyPath + code, { "x-host-token": hostToken });
  if (r.status !== 200) throw new Error(`GET lobby ${code} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
}
function nextOf(st) {
  if (st.phase === "waiting") return "replay";
  if (st.phase === "replay") return st.race.segment_end_lap === st.race.total_laps ? "done" : "freeze";
  if (st.phase === "freeze") return "reveal_freeze";
  if (st.phase === "reveal_freeze") return "replay";
  return null;
}
const nudge = (st, target) => api.post(`${lobbyPath}${code}/phase`, { phase: target, freeze_index: st.race.freeze_index }, { "x-host-token": hostToken });

async function step(name, fn) {
  try {
    const r = await fn();
    record(SCEN, name, true, typeof r === "string" ? r : "");
    return r;
  } catch (e) {
    record(SCEN, name, false, String(e?.message ?? e));
    throw e;
  }
}
// A check that must not abort the run.
async function check(name, fn) {
  try {
    const r = await fn();
    record(SCEN, name, true, typeof r === "string" ? r : "");
    return true;
  } catch (e) {
    record(SCEN, name, false, String(e?.message ?? e));
    return false;
  }
}

// ---- long name: fits, or truncated with an ellipsis; never cut off mid-word without one ----
function longNameReport(long) {
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue || !n.nodeValue.includes(long.slice(0, 8))) continue;
    const el = n.parentElement;
    if (!el || el.closest("nextjs-portal")) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 2) continue;
    let hidden = false;
    for (let a = el; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) hidden = true;
      if (a.tagName === "DETAILS" && !a.open && !el.closest("summary")) hidden = true;
    }
    if (hidden || r.bottom < 0 || r.top > innerHeight) continue;
    if (getComputedStyle(el).clipPath !== "none" || el.closest(".sr-only")) continue;
    let state = "fits";
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX === "visible") continue;
      const ar = a.getBoundingClientRect();
      if (ar.width < 2 || ar.height < 2) state = "sr-only";
      else if (r.right > ar.right + 1 || r.left < ar.left - 1) {
        let ell = false;
        for (let b = el; b && !ell; b = b.parentElement) {
          if (getComputedStyle(b).textOverflow === "ellipsis") ell = true;
          if (b === a) break;
        }
        state = ell ? "ellipsis" : "cut";
      }
      break;
    }
    const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 2).join(".") : "";
    out.push({ state, where: `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> "${n.nodeValue.trim().slice(0, 30)}"` });
  }
  return out;
}
// Screenshot + layout check (lib) + long-name check when the long name is on screen.
async function snap(page, stepName, vp, opts = {}) {
  await shot(page, { ...ctxShot, step: stepName, vp, ...opts });
  await longCheck(page, `${stepName} ${vp}`);
}
async function hostSnap(stepName, alt = false) {
  await hostShot(hostPage, ctxShot, stepName, { alt });
  await longCheck(hostPage, `${stepName} host1920`);
}
async function longCheck(page, where) {
  if (!ROSTER.some((p) => p.name === LONG)) return;
  const rep = (await page.evaluate(longNameReport, LONG).catch(() => [])).filter((x) => x.state !== "sr-only");
  if (!rep.length) return;
  const cut = rep.filter((x) => x.state === "cut");
  const states = [...new Set(rep.map((x) => x.state))].join("/");
  record(SCEN, `long name ${where}`, cut.length === 0, cut.length ? `cut without ellipsis: ${cut.map((x) => x.where).join("; ")}` : states);
}

// ---- slow API requests (informational: a big room on one network) ----
const slow = []; // { who, what, ms }
function timeRequests(page, who) {
  const started = new Map();
  page.on("request", (r) => {
    if (r.url().includes("/api/")) started.set(r, Date.now());
  });
  const done = (r) => {
    const t = started.get(r);
    if (t === undefined) return;
    started.delete(r);
    const ms = Date.now() - t;
    if (ms > 2000 && !r.url().includes("/transcribe")) slow.push({ who, what: `${r.method()} ${new URL(r.url()).pathname.replace(/\/api\/lobby\/\w+/, "/api/lobby/:code")}`, ms });
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
}

// ---- phones ----
async function openPhone(spec) {
  const page = await newPage(browser, { label: `${SCEN}:${spec.name}`, gate, base: BASE, viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
  const phone = { ...spec, page, uploads: 0, token: null, acted: [] };
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.isInterceptResolutionHandled()) return;
    if (req.method() === "POST" && req.url().includes("/transcribe")) {
      phone.uploads++;
      setTimeout(() => {
        if (!page.isClosed()) req.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ transcript: STUB, duration_ms: 3000 }) }).catch(() => {});
      }, 1500);
    } else req.continue().catch(() => {});
  });
  timeRequests(page, spec.name);
  await page.goto(`${BASE}/play/${code}?ui=${UI}`, { waitUntil: "domcontentloaded" });
  return phone;
}

async function joinPhone(phone) {
  const { page, name, driver } = phone;
  const input = await waitLocate(page, SEL.name, { what: "name input", timeout: 60000 });
  await input.click();
  await page.keyboard.type(name);
  await input.dispose();
  await press(page, SEL.consent, { what: "consent checkbox" });
  await press(page, SEL.driver, { vars: { driver }, what: `driver ${driver}`, timeout: 60000 });
  await press(page, SEL.join, { what: "join button" });
  const t0 = Date.now();
  while (await locate(page, SEL.name)) {
    if (Date.now() - t0 > 25000) throw new Error(`${name}: still on the join form 25 s after Join (${(await bodyText(page)).slice(0, 120)})`);
    await sleep(250);
  }
  phone.token = await page.evaluate((c, n) => localStorage.getItem(`lobby:${c}:player:${n}:token`), code, name);
  if (!phone.token) throw new Error(`${name}: no player token stored after joining`);
}

// One phone's move at a freeze where its car needs a call.
async function act(p, lap) {
  const pg = p.page;
  const b = p.b;
  p.acted.push(lap);
  if (b === "ignore") return;
  if (b === "voiceRec") {
    await press(pg, SEL.box, { what: "Box" });
    await press(pg, SEL.record, { what: "record button", enabled: true });
    await sleep(2500);
    await press(pg, SEL.send, { what: "Send", enabled: true });
  } else if (b === "voiceStop") {
    await press(pg, SEL.stay, { what: "Stay out" });
    await press(pg, SEL.record, { what: "record button", enabled: true });
    await sleep(2500);
    await press(pg, SEL.record, { what: "stop button" });
    await press(pg, SEL.send, { what: "Send", enabled: true });
  } else if (b === "typed") {
    await press(pg, SEL.box, { what: "Box" });
    await press(pg, SEL.typeBtn, { what: "Type button" });
    const why = await waitLocate(pg, SEL.why, { what: "typed reason field" });
    await why.click();
    await pg.keyboard.type(TYPED);
    await why.dispose();
    await press(pg, SEL.send, { what: "Send", enabled: true });
  } else if (b === "autosend") {
    await press(pg, SEL.stay, { what: "Stay out" });
  } else if (b === "audible") {
    await press(pg, SEL.box, { what: "Box" });
    await press(pg, SEL.send, { what: "Send", enabled: true });
  }
}

// ---- race phases (the host page advances them; the harness watches) ----
const freezesSeen = [];
let audiblesFired = false;
async function onReplay(st) {
  const i = st.race.freeze_index;
  await sleep(3000);
  if (i === 0 || i === (st.race.freeze_count ?? 0)) await hostSnap(`replay${i + 1}`);
  if (i === 0) {
    await snap(phones[0].page, `replay-${phones[0].name}`, "phone390");
    // Audibles a few laps in (lap 4 or later; nowhere near the first freeze of any car).
    const aud = phones.filter((p) => p.b === "audible");
    const laps = [];
    await check(`audible "Box now" from ${aud.map((p) => p.name).join(", ") || "nobody"} during the replay`, async () => {
      await Promise.all(
        aud.map(async (p) => {
          const lapOn = async () => (await bodyText(p.page)).match(/\bL(\d+)\/\d+/)?.[1] ?? "?";
          const before = await lapOn();
          const t0 = Date.now();
          await press(p.page, SEL.audible, { what: "Box now", enabled: true, timeout: 15000 });
          // Confirmation: the cooldown ("Next audible on lap N") replaces the "Audible in on lap N" note until it ends.
          const conf = /next audible on lap (\d+)|audible in on lap (\d+)/i;
          let m = null;
          while (!(m = (await bodyText(p.page)).match(conf))) {
            if (Date.now() - t0 > 10000) throw new Error(`${p.name}: no cooldown or "Audible in" note 10 s after Box now (${(await bodyText(p.page)).slice(0, 160)})`);
            await sleep(150);
          }
          laps.push(`${p.name}: phone on L${before} at the tap; ${m[1] ? `cooldown to lap ${m[1]}` : `note "in on lap ${m[2]}"`} after ${Date.now() - t0} ms`);
          await snap(p.page, `audible-${p.name}`, "phone390", { settle: 100 });
        }),
      );
      audiblesFired = true;
      return laps.join("; ");
    });
  }
}

async function onFreeze(st) {
  const i = st.race.freeze_index;
  const lap = st.race.freeze_lap;
  const need = st.race.calls_needed ?? [];
  const actors = phones.filter((p) => need.includes(p.driver));
  const biggest = actors.length === phones.filter((p) => p.b !== "kicked").length;
  freezesSeen.push({ i, lap, need, actors: actors.map((p) => p.name) });
  console.log(`  freeze ${i + 1} at lap ${lap}: cars ${need.join(",")} -> ${actors.length} phones`);
  await check(`freeze ${i + 1} (L${lap}): call pad on all ${actors.length} phones with a call`, async () => {
    await Promise.all(actors.map((p) => waitLocate(p.page, SEL.box, { what: `${p.name} call pad`, timeout: 30000 })));
  });
  // Host and call pads before anyone acts; the all-cars freeze also at 1440 and with every phone's pad.
  await hostSnap(`freeze${i + 1}-L${lap}`, biggest);
  if (biggest || i === 0) await Promise.all(actors.map((p) => snap(p.page, `callpad${i + 1}-${p.name}`, "phone390", { settle: 200 })));
  await check(`freeze ${i + 1} (L${lap}): every phone made its move (${[...new Set(actors.map((p) => p.b))].join(", ")})`, async () => {
    const errs = [];
    await Promise.all(actors.map((p) => act(p, lap).catch((e) => errs.push(`${p.name}: ${e?.message ?? e}`))));
    if (errs.length) throw new Error(errs.join("; "));
  });
  if (biggest || i === 0) {
    await sleep(600);
    await Promise.all(actors.filter((p) => p.b !== "ignore" && p.b !== "autosend").map((p) => snap(p.page, `sent${i + 1}-${p.name}`, "phone390", { settle: 200 })));
  }
  const now = await state();
  if (now.phase === "freeze" && now.race.freeze_index === i) await hostSnap(`freeze${i + 1}-L${lap}-calls-in`);
}

async function onLocked(st) {
  const i = st.race.freeze_index;
  await hostSnap(`locked${i + 1}`);
  if (i === 0) await snap(phones[0].page, `locked-${phones[0].name}`, "phone390", { settle: 100 });
}

async function runRace() {
  let last = "";
  let lastChange = Date.now();
  const t0 = Date.now();
  for (;;) {
    const st = await state();
    const key = `${st.phase}:${st.race.freeze_index}`;
    if (key !== last) {
      last = key;
      if (st.phase === "replay") await onReplay(st);
      else if (st.phase === "freeze") await onFreeze(st);
      else if (st.phase === "reveal_freeze") await onLocked(st);
      lastChange = Date.now();
      continue;
    }
    if (st.phase === "done") return st;
    // The host page must advance on its own; nudge only when a phase is clearly stuck, and count it as a failure.
    const lapS = 1.2;
    const limitS =
      st.phase === "replay" ? (st.race.segment_end_lap - st.race.segment_start_lap + 1) * lapS + 20 : st.phase === "freeze" ? 41.5 + 20 : st.phase === "reveal_freeze" ? 5.5 + 20 : 60;
    if (Date.now() - lastChange > limitS * 1000) {
      const target = nextOf(st);
      const r = target ? await nudge(st, target) : null;
      nudges.push(`${st.phase} (freeze_index ${st.race.freeze_index}) stuck ${Math.round((Date.now() - lastChange) / 1000)} s; nudged to ${target} -> ${r?.status}`);
      lastChange = Date.now();
    }
    if (Date.now() - t0 > 900000) throw new Error(`race stuck in "${st.phase}" after 15 min`);
    await sleep(700);
  }
}

// ---- end of game ----
const sharedRank = (pts, all) => ({ rank: 1 + all.filter((x) => x > pts).length, tied: all.filter((x) => x === pts).length > 1 });
const rankText = (r) => `${r.tied ? "=" : ""}${r.rank}`;

async function summaryFromApi() {
  const t0 = Date.now();
  for (;;) {
    const r = await api.get(`${lobbyPath}${code}/reveal?part=results`, { "x-host-token": hostToken });
    if (r.status === 200 && !r.json.grading) return r.json;
    if (Date.now() - t0 > 150000) throw new Error(`summary still grading after 150 s (HTTP ${r.status})`);
    await sleep(1500);
  }
}

// Steps the host end screen: every reveal, the audibles, the podium. Checks the rank column against the summary.
async function walkHostEnd(summary) {
  const scoring = /scoring\s+the\s+calls/i;
  const t0 = Date.now();
  let shotScoring = false;
  for (;;) {
    const t = await bodyText(hostPage);
    if (!shotScoring && scoring.test(t)) {
      shotScoring = true;
      await hostSnap("scoring");
    }
    if (!scoring.test(t) && (UI !== "racenight" || (await locate(hostPage, { css: ".rne-rv-top, .rne-podium" })))) break;
    if (Date.now() - t0 > 150000) throw new Error(`host end screen not shown after 150 s: ${t.slice(0, 80)}`);
    await sleep(800);
  }
  if (UI !== "racenight") {
    await hostSnap("end", true);
    return;
  }
  const problems = [];
  for (let k = 0; k < summary.moments.length + 3; k++) {
    const podium = !!(await locate(hostPage, { css: ".rne-podium" }));
    const name = podium ? "podium" : (await locate(hostPage, { css: ".rne-rv-top" })) && /reveal \d+ \/ \d+/i.test(await bodyText(hostPage)) ? `reveal${k + 1}` : "audibles";
    await hostSnap(name, podium);
    const rows = await hostPage.evaluate((sel) => [...document.querySelectorAll(sel)].map((r) => ({ rank: r.querySelector(".rne-rank")?.textContent?.trim() ?? "", who: r.querySelector(".rne-trunc")?.textContent?.trim() ?? "" })), podium ? ".rne-rl.rne-player" : ".rne-tr.rne-player");
    if (podium) {
      const players = summary.ranking.filter((r) => r.kind === "player");
      const pts = players.map((p) => p.points);
      for (const p of players) {
        const row = rows.find((r) => r.who === p.name);
        if (!row) problems.push(`podium: ${p.name} missing from the ranking list`);
        else if (row.rank !== rankText(sharedRank(p.points, pts))) problems.push(`podium: ${p.name} shows rank "${row.rank}", expected "${rankText(sharedRank(p.points, pts))}" (${p.points} pts)`);
        // The API ranks players and benchmarks together; the screens rank players only.
        const all = sharedRank(p.points, summary.ranking.map((r) => r.points));
        if (p.rank !== all.rank || p.tied !== all.tied) problems.push(`summary ranking: ${p.name} rank ${p.rank} tied ${p.tied} for ${p.points} pts`);
      }
      break;
    }
    if (name.startsWith("reveal")) {
      const m = summary.moments[k];
      const players = m.entries.filter((e) => e.kind === "player");
      const pts = players.map((e) => e.points);
      for (const e of players) {
        const row = rows.find((r) => r.who === e.name);
        if (!row) problems.push(`reveal L${m.lap}: ${e.name} missing`);
        else if (row.rank !== rankText(sharedRank(e.points, pts))) problems.push(`reveal L${m.lap}: ${e.name} shows "${row.rank}", expected "${rankText(sharedRank(e.points, pts))}"`);
      }
    }
    const next = await locate(hostPage, { css: 'button[aria-keyshortcuts~="ArrowRight"]' });
    if (!next) {
      problems.push(`no Next button on host end step ${k + 1} (${name})`);
      break;
    }
    await next.click();
    await next.dispose();
    await sleep(700);
  }
  if (problems.length) throw new Error(problems.join("; "));
  const ties = summary.ranking.filter((r) => r.kind === "player" && r.tied).map((r) => `${r.name}=${r.rank}`);
  return `${summary.moments.length} reveals${summary.audibles.length ? " + audibles" : ""} + podium; ranks match${ties.length ? `; ties: ${ties.join(", ")}` : "; no ties"}`;
}

// ---- main ----
let fatal = null;
try {
  console.log(`room: ui=${UI} phones=${N} base=${BASE} db=${DB.which} out=${OUT}`);
  await sql`delete from rate_limits where bucket = 'lobby_create_ip' and key in ('127.0.0.1', '::1', '0:0:0:0::/64')`;
  gate = await api.unlock();
  record("setup", "unlock the password gate", true);
  browser = await launch({ puppeteerPath: PUPPETEER, chrome: CHROME, audio: AUDIO });

  await step("create race lobby (choose)", async () => {
    const r = await api.post("/api/lobby", { mode: "race", race_key: RACE_KEY, driver_mode: "choose" });
    if (r.status !== 201) throw new Error(`POST /api/lobby -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    code = r.json.code;
    hostToken = r.json.host_token;
    return code;
  });
  hostPage = await newPage(browser, { label: `${SCEN}:host`, gate, base: BASE, viewport: { width: 1920, height: 1080 } });
  await hostPage.evaluateOnNewDocument(
    (c, t) => {
      try {
        localStorage.setItem(`lobby:${c}:host_token`, t);
        localStorage.setItem(`lobby:${c}:host`, "1");
      } catch {}
    },
    code,
    hostToken,
  );
  timeRequests(hostPage, "host");
  await hostPage.goto(`${BASE}/host/${code}?ui=${UI}`, { waitUntil: "domcontentloaded" });

  // Kick first, so the room can still fill to 12 afterwards.
  await check(`host removes "${KICKED.name}" (${KICKED.driver}) from the lobby; the phone shows the removed screen`, async () => {
    kicked = await openPhone({ ...KICKED, b: "kicked" });
    await joinPhone(kicked);
    await press(hostPage, SEL.kick, { vars: { name: KICKED.name }, what: "Remove button", timeout: 20000 });
    await hostSnap("lobby-kick-confirm");
    await press(hostPage, SEL.kickConfirm, { what: "Tap again to remove" });
    await waitLocate(kicked.page, SEL.removed, { what: "removed screen", timeout: 20000 });
    await snap(kicked.page, `kicked-${KICKED.name.replace(/\s/g, "")}`, "phone390");
    const st = await state();
    if (st.players.some((p) => p.name === KICKED.name)) throw new Error("still in the lobby state");
    const k = await sql`select name from kicked_players where lobby_code = ${code}`;
    if (!k.some((r) => r.name === KICKED.name)) throw new Error("no kicked_players row");
    // The removed device cannot come back under its name.
    const again = await api.post(`${lobbyPath}${code}/join`, { name: KICKED.name, consent: true, driver_code: KICKED.driver }, { "x-player-token": kicked.token });
    if (again.status !== 403) throw new Error(`rejoin with the kicked token -> ${again.status}, expected 403`);
    return "kicked_players row, rejoin 403";
  });

  await step(`${N} phones join at once through the UI (${Object.entries(ROSTER.reduce((a, p) => ({ ...a, [p.driver]: (a[p.driver] ?? 0) + 1 }), {})).map(([d, n]) => `${n} ${d}`).join(", ")})`, async () => {
    const opened = await Promise.all(ROSTER.map((s) => openPhone(s)));
    phones.push(...opened);
    const errs = [];
    await Promise.all(phones.map((p) => joinPhone(p).catch((e) => errs.push(e?.message ?? String(e)))));
    if (errs.length) throw new Error(errs.join("; "));
    const st = await state();
    const bad = ROSTER.filter((s) => st.players.find((p) => p.name === s.name)?.driver_code !== s.driver).map((s) => s.name);
    if (bad.length) throw new Error(`missing or wrong car: ${bad.join(", ")}; lobby has ${st.players.map((p) => `${p.name}/${p.driver_code}`).join(", ")}`);
    if (st.players.length !== N) throw new Error(`lobby has ${st.players.length} players, expected ${N}`);
  });
  for (const p of phones.filter((x) => [phones[0].name, LONG, "Zoë"].includes(x.name))) await snap(p.page, `waiting-${p.name}`, "phone390");
  await hostSnap("lobby", true);

  await step("host starts the race", async () => {
    await press(hostPage, SEL.start, { what: "Start race button" });
    const t0 = Date.now();
    while ((await state()).phase === "waiting") {
      if (Date.now() - t0 > 30000) throw new Error("still waiting 30 s after Start");
      await sleep(500);
    }
  });
  const [lobbyRow] = await sql`select freeze_plan from lobbies where code = ${code}`;
  const plan = lobbyRow.freeze_plan ?? [];
  console.log(`  plan: ${plan.map((f) => `L${f.lap}[${f.drivers.join(",")}]`).join(" ")}`);
  await check("freeze plan covers only the players' cars (not the kicked player's)", async () => {
    const cars = new Set(ROSTER.map((p) => p.driver));
    const extra = plan.flatMap((f) => f.drivers).filter((d) => !cars.has(d));
    if (extra.length) throw new Error(`plan has ${[...new Set(extra)].join(", ")}`);
    if (!plan.length) throw new Error("empty plan");
    return plan.map((f) => `L${f.lap}[${f.drivers.join(",")}]`).join(" ");
  });

  await step("race runs to the flag on the host page's own clock", runRace);
  await check("host page advanced every phase itself (no harness nudge)", async () => {
    if (nudges.length) throw new Error(nudges.join("; "));
  });
  await check("every planned freeze happened", async () => {
    const want = plan.map((f) => f.lap).join(",");
    const got = freezesSeen.map((f) => f.lap).join(",");
    if (want !== got) throw new Error(`plan laps ${want}, seen ${got}`);
  });

  // Phones on the end screen (no "Scoring" left) and the host walk-through.
  await check("end summary on every phone", async () => {
    const t0 = Date.now();
    for (;;) {
      const texts = await Promise.all(phones.map((p) => bodyText(p.page)));
      const waiting = phones.filter((p, i) => texts[i].length < 40 || /scoring\s+the\s+calls/i.test(texts[i]) || /^loading/i.test(texts[i]));
      if (!waiting.length) return;
      if (Date.now() - t0 > 150000) throw new Error(`still scoring after 150 s on ${waiting.map((p) => p.name).join(", ")}`);
      await sleep(1000);
    }
  });
  const summary = await step("summary from the API (graded)", summaryFromApi);
  await check("host end: reveals, audibles and podium; rank column (ties as =N) matches the summary", () => walkHostEnd(summary));
  for (const p of phones) await snap(p.page, `end-${p.name}`, "phone390");
  if (kicked) await snap(kicked.page, `kicked-end-${KICKED.name.replace(/\s/g, "")}`, "phone390");
  await check("kicked phone still shows the removed screen at the end", async () => {
    if (!(await locate(kicked.page, SEL.removed))) throw new Error((await bodyText(kicked.page)).slice(0, 120));
  });

  // ---- database ----
  const rows = await sql`select player_name, kind, lap, driver_code, call, transcript, status, graded_at, score_reasoning, total, verdict from race_calls where lobby_code = ${code} order by kind, lap, player_name`;
  for (const f of plan) {
    const owed = phones.filter((p) => f.drivers.includes(p.driver));
    await check(`race_calls at L${f.lap} (${owed.length} owed): right call per phone, reason text stored`, async () => {
      const problems = [];
      const info = [];
      for (const p of owed) {
        const row = rows.find((r) => r.kind === "freeze" && r.lap === f.lap && r.player_name === p.name);
        const want = EXPECT_CALL[p.b];
        if (p.b === "ignore") {
          if (!row) info.push(`${p.name}: no row`);
          else if (row.call === null) info.push(`${p.name}: null-call row (0 s auto-send)`);
          else problems.push(`${p.name} ignored the freeze but has call ${row.call}`);
          continue;
        }
        if (!row) {
          problems.push(`${p.name} (${p.b}): no row`);
          continue;
        }
        if (row.call !== want) problems.push(`${p.name} (${p.b}): call ${row.call}, expected ${want}`);
        if (row.driver_code !== p.driver) problems.push(`${p.name}: driver ${row.driver_code}, expected ${p.driver}`);
        const text = EXPECT_TEXT[p.b];
        if (text && !String(row.transcript).toLowerCase().includes(text)) problems.push(`${p.name} (${p.b}): transcript ${JSON.stringify(row.transcript)} lacks "${text}"`);
      }
      const stray = rows.filter((r) => r.kind === "freeze" && r.lap === f.lap && !owed.some((p) => p.name === r.player_name));
      if (stray.length) problems.push(`rows for players without a call: ${stray.map((r) => r.player_name).join(", ")}`);
      if (problems.length) throw new Error(problems.join("; "));
      return info.join("; ");
    });
  }
  await check("every voice phone uploaded its note (/transcribe stubbed)", async () => {
    const bad = phones.filter((p) => (p.b === "voiceRec" || p.b === "voiceStop") && p.acted.length && p.uploads < p.acted.length);
    if (bad.length) throw new Error(bad.map((p) => `${p.name}: ${p.uploads} uploads for ${p.acted.length} freezes`).join("; "));
  });
  await check("audible stored (race_calls kind audible, BOX, own car)", async () => {
    const aud = phones.filter((p) => p.b === "audible");
    if (!audiblesFired) throw new Error("audibles were not fired");
    const problems = [];
    const info = [];
    for (const p of aud) {
      const r = rows.filter((x) => x.kind === "audible" && x.player_name === p.name);
      if (r.length !== 1) problems.push(`${p.name}: ${r.length} audible rows`);
      else {
        if (r[0].call !== "BOX" || r[0].driver_code !== p.driver) problems.push(`${p.name}: ${r[0].call}/${r[0].driver_code}`);
        info.push(`${p.name} L${r[0].lap} ${r[0].status}${r[0].graded_at ? " graded" : ""}`);
      }
    }
    if (problems.length) throw new Error(problems.join("; "));
    return info.join("; ");
  });
  await check("no-call phones show as no call in the summary (call null, 0 points)", async () => {
    const problems = [];
    for (const p of phones.filter((x) => x.b === "ignore")) {
      for (const m of summary.moments) {
        const e = m.entries.find((x) => x.kind === "player" && x.name === p.name);
        if (!e) {
          if (m.cars.some((c) => c.code === p.driver)) problems.push(`L${m.lap}: ${p.name} missing`);
          continue;
        }
        if (e.call !== null || e.points !== 0) problems.push(`L${m.lap}: ${p.name} call ${e.call} points ${e.points}`);
      }
    }
    if (problems.length) throw new Error(problems.join("; "));
  });
  await check("auto-send at 0 s recorded the picked call in the summary", async () => {
    const problems = [];
    for (const p of phones.filter((x) => x.b === "autosend")) {
      for (const lap of p.acted) {
        const e = summary.moments.find((m) => m.lap === lap)?.entries.find((x) => x.kind === "player" && x.name === p.name);
        if (e?.call !== "STAY") problems.push(`L${lap}: ${p.name} call ${e?.call}`);
      }
    }
    if (problems.length) throw new Error(problems.join("; "));
  });
  await check("all calls graded (graded_at set) after the summary loaded", async () => {
    const t0 = Date.now();
    let bad = [];
    for (;;) {
      const now = await sql`select player_name, kind, lap, status, graded_at from race_calls where lobby_code = ${code}`;
      bad = now.filter((r) => !r.graded_at && (r.kind === "freeze" || r.status === "scored"));
      if (!bad.length) return `${now.filter((r) => r.graded_at).length}/${now.length} rows graded (unscored audibles are not graded)`;
      if (Date.now() - t0 > 60000) break;
      await sleep(1500);
    }
    throw new Error(`${bad.length} ungraded: ${bad.slice(0, 6).map((r) => `${r.player_name} ${r.kind} L${r.lap}`).join(", ")}`);
  });
  await check("Muse grading: every grade_call row in muse_calls is ok", async () => {
    const m = await sql`select id, purpose, model, ok, status, error, cost_usd, latency_ms from muse_calls where lobby_code = ${code} order by id`;
    for (const r of m) notes.push(`muse_calls #${r.id} ${r.purpose} ${r.model} ok=${r.ok} status=${r.status ?? ""} $${Number(r.cost_usd).toFixed(5)} ${r.latency_ms} ms${r.error ? " error=" + String(r.error).slice(0, 120) : ""}`);
    const grade = m.filter((r) => r.purpose === "grade_call");
    const bad = grade.filter((r) => !r.ok);
    const withWords = rows.filter((r) => r.kind === "freeze" && r.call && /[a-z]{3,}/i.test(String(r.transcript).replace(/^(box|stay out)\.?/i, ""))).length;
    const cost = m.reduce((a, r) => a + Number(r.cost_usd), 0);
    if (!grade.length) throw new Error(`no grade_call rows for ${withWords} calls with a reason`);
    if (bad.length) throw new Error(`${bad.length}/${grade.length} grade_call rows not ok: ${bad.map((r) => `${r.model} ${r.status} ${String(r.error ?? "").slice(0, 80)}`).join("; ")}`);
    return `${grade.length} grade_call rows ok for ${withWords} calls with a reason; $${cost.toFixed(4)}`;
  });

  const shown = pageIssues.slice(0, 25);
  record("all", "no console errors, page errors or HTTP 5xx", pageIssues.length === 0, shown.map((i) => `\n      [${i.page}] ${i.kind}: ${i.text}`).join("") + (pageIssues.length > 25 ? `\n      ... +${pageIssues.length - 25} more` : ""));
} catch (e) {
  fatal = e;
  record("setup", "harness", false, String(e?.stack ?? e));
  if (hostPage) await shot(hostPage, { ...ctxShot, step: "FAILED", vp: "host1920", settle: 0 }).catch(() => {});
  for (const p of phones) await shot(p.page, { ...ctxShot, step: `FAILED-${p.name}`, vp: "phone390", settle: 0 }).catch(() => {});
} finally {
  await browser?.close().catch(() => {});
  try {
    if (code) {
      await sql`delete from lobbies where code = ${code}`;
      const left = await sql`select count(*)::int as n from lobbies where code = ${code}`;
      record("cleanup", `delete lobby ${code}`, left[0].n === 0);
    }
  } catch (e) {
    record("cleanup", "delete lobby", false, String(e?.message ?? e));
  }
}

// ---- summary ----
const failed = results.filter((r) => !r.ok);
console.log(`\n===== room summary (ui=${UI}, phones=${N}, base=${BASE}, lobby ${code}) =====`);
const w = Math.max(...results.map((r) => r.scenario.length));
const quiet = (r) => r.ok && (r.step.startsWith("layout ") || r.step.startsWith("long name "));
for (const r of results) {
  if (quiet(r)) continue;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.scenario.padEnd(w)}  ${r.step}${r.detail ? "  " + r.detail.split("\n").slice(0, r.ok ? 1 : 4).join(" | ") : ""}`);
}
const layoutOk = results.filter((r) => r.ok && r.step.startsWith("layout ")).length;
const longOk = results.filter((r) => r.ok && r.step.startsWith("long name ")).length;
console.log(`PASS  ${layoutOk} screenshots with no text overlap or horizontal clipping; ${longOk} long-name checks fine (fits or ellipsis)`);
if (slow.length) {
  const by = {};
  for (const x of slow) (by[x.what] ??= []).push(x.ms);
  notes.push(`API requests over 2 s (browser side): ${Object.entries(by).map(([k, v]) => `${k} x${v.length} (max ${Math.max(...v)} ms)`).join("; ")}`);
}
if (notes.length) console.log(`\n${notes.join("\n")}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`);
if (fatal || failed.length) {
  console.log(`ROOM E2E FAILED (${failed.length} failing)`);
  process.exit(1);
}
console.log("ROOM E2E PASSED");
process.exit(0);
