// End-to-end game test: plays a full race game (scenario A) and a quick moment (scenario B) in a real browser
// with a host page and two fake phones, then checks the database, the console and the layout.
//
//   NODE_TLS_REJECT_UNAUTHORIZED=0 node --env-file=.env.local scripts/e2e/game.mjs \
//     --base http://localhost:3120 --ui classic|racenight \
//     --puppeteer /Users/vedant/baskaran-edge/node_modules/puppeteer-core --out <dir> [--db prod|dev]
//
// NOT hermetic: needs a running server and the shared Neon DB (DATABASE_URL, SITE_PASSWORD from .env.local),
// so it is not part of .claude/verify.sh. Run it before every ship, once per UI mode.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectorsFor } from "./selectors.mjs";
import { bodyText, dbUrlFor, ensureDir, hostShot, launch, makeApi, makeDb, newPage, pageIssues, press, record, results, shot, sleep, waitLocate, locate } from "./lib.mjs";

// ---- args ----
const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "true"]] : [])),
);
const BASE = (args.base ?? "http://localhost:3120").replace(/\/$/, "");
const UI = args.ui ?? "classic";
if (!["classic", "racenight"].includes(UI)) throw new Error(`--ui must be classic or racenight, got ${UI}`);
const PUPPETEER = args.puppeteer ?? process.env.PUPPETEER_PATH ?? "puppeteer-core";
const CHROME = args.chrome ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const AUDIO = args.audio ?? "/private/tmp/claude-501/-Users-vedant-HackTX26/a0935160-98ac-4dce-ac07-9f67606a9870/scratchpad/voice/box16c.wav";
const OUT = args.out ?? join(tmpdir(), `outpace-e2e-${UI}-${Date.now()}`);
const RACE_KEY = args.race ?? "2026-singapore";
const RACE_DRIVER = args.driver ?? "GAS";
const MOMENT_ID = args.moment ?? "qatar-2025-l7";
const STUB = "stub transcript box box";
const SEL = selectorsFor(UI);
const NAMES = ["Alpha", "Bravo"];
const need = (k) => {
  if (!process.env[k]) throw new Error(`${k} is not set (run with --env-file=.env.local)`);
  return process.env[k];
};

const DB = dbUrlFor(BASE, args.db);
const sql = makeDb(DB.url);
const api = makeApi(BASE, need("SITE_PASSWORD"));
const codes = [];
ensureDir(OUT);
let gate;
let browser;

// ---- lobby helpers ----
const lobbyPath = (code) => `/api/lobby/${code}`;
const PHASES = ["waiting", "replay", "decision", "reveal", "done"];
function nextOf(st, race) {
  if (race) {
    if (st.phase === "waiting") return "replay";
    if (st.phase === "replay") return st.race.segment_end_lap === st.race.total_laps ? "done" : "freeze";
    if (st.phase === "freeze") return "reveal_freeze";
    if (st.phase === "reveal_freeze") return "replay";
    return null;
  }
  return PHASES[PHASES.indexOf(st.phase) + 1] ?? null;
}
async function state(code, hostToken) {
  const r = await api.get(lobbyPath(code), { "x-host-token": hostToken });
  if (r.status !== 200) throw new Error(`GET lobby ${code} -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
  return r.json;
}
async function nudge(code, hostToken, st, race, target) {
  const body = { phase: target, ...(race ? { freeze_index: st.race.freeze_index } : {}) };
  return api.post(`${lobbyPath(code)}/phase`, body, { "x-host-token": hostToken });
}
// Poll until the lobby reaches `target`, advancing it ourselves when the next step is exactly the target.
async function waitPhase(S, target, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const st = await state(S.code, S.hostToken);
    if (st.phase === target) return st;
    if (nextOf(st, S.race) === target) await nudge(S.code, S.hostToken, st, S.race, target);
    if (Date.now() - t0 > timeoutMs) throw new Error(`lobby ${S.code} did not reach "${target}" in ${Math.round(timeoutMs / 1000)} s (is "${st.phase}")`);
    await sleep(500);
  }
}
// Drive to "done" through the API. Race lobbies: at later freezes the phones' calls are sent through the API
// (button only, no words: no Muse spend) so the freeze ends without waiting out the call window.
async function finishGame(S, timeoutMs = 420000) {
  const t0 = Date.now();
  for (;;) {
    const st = await state(S.code, S.hostToken);
    if (st.phase === "done") return st;
    if (S.race && st.phase === "freeze") {
      for (const p of S.phones) {
        if ((st.race.calls_needed ?? []).includes(S.driver) && !(st.race.called ?? []).includes(p.name)) {
          await api.post(`${lobbyPath(S.code)}/submit`, { player_name: p.name, transcript: "", call: "BOX" }, { "x-player-token": p.token });
        }
      }
    }
    const next = nextOf(st, S.race);
    if (next) {
      const r = await nudge(S.code, S.hostToken, st, S.race, next);
      if (r.status === 409 && r.json?.remaining_s) {
        await sleep(Math.min(5000, Math.ceil(r.json.remaining_s * 1000) + 150));
        continue;
      }
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`lobby ${S.code} stuck in "${st.phase}" after ${Math.round(timeoutMs / 1000)} s`);
    await sleep(400);
  }
}

// ---- one phone ----
async function openPhone(S, i) {
  const name = NAMES[i];
  const page = await newPage(browser, { label: `${S.id}:${name}`, gate, base: BASE, viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } });
  const phone = { name, page, uploads: 0, token: null };
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
  await page.goto(`${BASE}/play/${S.code}?ui=${UI}`, { waitUntil: "domcontentloaded" });
  return phone;
}

async function joinPhone(S, phone, driver, { shots }) {
  const { page, name } = phone;
  const nameInput = await waitLocate(page, SEL.name, { what: "name input", timeout: 45000 });
  if (shots) await shot(page, { out: OUT, ui: UI, scenario: S.id, step: `join-empty-${name}`, vp: "phone390" });
  await nameInput.click();
  await page.keyboard.type(name);
  await press(page, SEL.consent, { what: "consent checkbox" });
  await press(page, SEL.driver, { vars: { driver }, what: `driver ${driver}`, timeout: 45000 });
  if (shots) await shot(page, { out: OUT, ui: UI, scenario: S.id, step: `join-filled-${name}`, vp: "phone390" });
  await press(page, SEL.join, { what: "join button" });
  const t0 = Date.now();
  while (await locate(page, SEL.name)) {
    if (Date.now() - t0 > 20000) throw new Error(`${name}: still on the join form 20 s after Join`);
    await sleep(200);
  }
  phone.token = await page.evaluate((c, n) => localStorage.getItem(`lobby:${c}:player:${n}:token`), S.code, name);
  if (!phone.token) throw new Error(`${name}: no player token stored after joining`);
}

// ---- scenario runner ----
async function step(S, name, fn) {
  try {
    const r = await fn();
    record(S.id, name, true);
    return r;
  } catch (e) {
    record(S.id, name, false, String(e?.message ?? e));
    throw e;
  }
}

async function runScenario(S) {
  const ctxShot = { out: OUT, ui: UI, scenario: S.id };
  await step(S, "create lobby", async () => {
    const r = await api.post("/api/lobby", S.body);
    if (r.status !== 201) throw new Error(`POST /api/lobby -> ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    S.code = r.json.code;
    S.hostToken = r.json.host_token;
    codes.push(S.code);
  });

  S.hostPage = await newPage(browser, { label: `${S.id}:host`, gate, base: BASE, viewport: { width: 1920, height: 1080 } });
  await S.hostPage.evaluateOnNewDocument(
    (c, t) => {
      try {
        localStorage.setItem(`lobby:${c}:host_token`, t);
        localStorage.setItem(`lobby:${c}:host`, "1");
      } catch {}
    },
    S.code,
    S.hostToken,
  );
  await S.hostPage.goto(`${BASE}/host/${S.code}?ui=${UI}`, { waitUntil: "domcontentloaded" });

  S.phones = [];
  await step(S, "two phones join through the UI (same driver)", async () => {
    for (let i = 0; i < 2; i++) {
      const phone = await openPhone(S, i);
      S.phones.push(phone);
      await joinPhone(S, phone, S.driver, { shots: i === 0 });
    }
    const st = await state(S.code, S.hostToken);
    for (const n of NAMES) {
      const p = st.players.find((x) => x.name === n);
      if (!p) throw new Error(`${n} missing from the lobby`);
      if (p.driver_code !== S.driver) throw new Error(`${n} has driver ${p.driver_code}, expected ${S.driver}`);
    }
  });
  for (const p of S.phones) await shot(p.page, { ...ctxShot, step: `waiting-${p.name}`, vp: "phone390" });
  await hostShot(S.hostPage, ctxShot, "lobby", { alt: true });

  await step(S, "host starts the game", async () => {
    await press(S.hostPage, SEL.start, { what: "Start race button" });
    await waitPhase(S, "replay", 30000);
  });
  await sleep(S.race ? 4000 : 3000);
  await hostShot(S.hostPage, ctxShot, "replay");
  for (const p of S.phones) await shot(p.page, { ...ctxShot, step: `replay-${p.name}`, vp: "phone390" });

  const callPhase = S.race ? "freeze" : "decision";
  const st = await step(S, `wait for the first ${callPhase}`, () => waitPhase(S, callPhase, 240000));
  S.callLap = S.race ? st.race.freeze_lap : null;
  await step(S, "call pad shows on both phones", async () => {
    for (const p of S.phones) await waitLocate(p.page, SEL.box, { what: "Box button", timeout: 30000 });
  });
  await hostShot(S.hostPage, ctxShot, callPhase, { alt: true });
  for (const p of S.phones) await shot(p.page, { ...ctxShot, step: `callpad-${p.name}`, vp: "phone390" });

  // Phone 1: Box, record, Send while recording. Phone 2: Stay out, record, stop, Send while transcribing.
  const [p1, p2] = S.phones;
  await step(S, "calls with voice (send while recording / while transcribing)", async () => {
    await Promise.all([
      (async () => {
        await press(p1.page, SEL.box, { what: "Box" });
        await press(p1.page, SEL.record, { what: "record button", enabled: true });
        await sleep(2500);
        await shot(p1.page, { ...ctxShot, step: "recording-Alpha", vp: "phone390", settle: 100 });
        await press(p1.page, SEL.send, { what: "Send", enabled: true });
        await sleep(250);
        await shot(p1.page, { ...ctxShot, step: "sent-while-recording-Alpha", vp: "phone390", settle: 50 });
      })(),
      (async () => {
        await press(p2.page, SEL.stay, { what: "Stay out" });
        await press(p2.page, SEL.record, { what: "record button", enabled: true });
        await sleep(2500);
        await press(p2.page, SEL.record, { what: "stop button" });
        await press(p2.page, SEL.send, { what: "Send", enabled: true });
        await sleep(250);
        await shot(p2.page, { ...ctxShot, step: "sent-while-transcribing-Bravo", vp: "phone390", settle: 50 });
      })(),
    ]);
  });

  const table = S.race ? "race_calls" : "submissions";
  const callRows = () =>
    S.race
      ? sql`select player_name, call, transcript, graded_at, score_reasoning from race_calls where lobby_code = ${S.code} and kind = 'freeze' and lap = ${S.callLap} order by player_name`
      : sql`select player_name, call, transcript, graded_at, score_reasoning from submissions where lobby_code = ${S.code} order by player_name`;
  await step(S, `call rows stored (${table}) with the right call and the voice reason`, async () => {
    const t0 = Date.now();
    let rows = [];
    while (Date.now() - t0 < 40000) {
      rows = await callRows();
      if (rows.length >= 2) break;
      await sleep(500);
    }
    const problems = [];
    const want = { Alpha: "BOX", Bravo: "STAY" };
    for (const n of NAMES) {
      const row = rows.find((r) => r.player_name === n);
      if (!row) problems.push(`${n}: no row`);
      else {
        if (row.call !== want[n]) problems.push(`${n}: call ${row.call}, expected ${want[n]}`);
        if (!String(row.transcript).toLowerCase().includes(STUB)) problems.push(`${n}: transcript ${JSON.stringify(row.transcript)} lacks "${STUB}"`);
      }
    }
    for (const p of S.phones) if (p.uploads < 1) problems.push(`${p.name}: no /transcribe upload was made`);
    if (problems.length) throw new Error(problems.join("; "));
  });

  if (S.race) {
    await step(S, "calls-locked beat", async () => {
      await waitPhase(S, "reveal_freeze", 60000);
    });
    await hostShot(S.hostPage, ctxShot, "locked", { alt: false });
    for (const p of S.phones) await shot(p.page, { ...ctxShot, step: `locked-${p.name}`, vp: "phone390" });
  } else {
    await step(S, "reveal", async () => {
      await waitPhase(S, "reveal", 90000);
    });
  }

  await step(S, "play on to the end", () => finishGame(S));

  // End screens: no "Scoring the calls" on any page, then rows graded.
  const pages = [["host", S.hostPage], ...S.phones.map((p) => [p.name, p.page])];
  await step(S, "end summary on host and phones", async () => {
    const t0 = Date.now();
    let shotScoring = false;
    for (;;) {
      const texts = await Promise.all(pages.map(([, pg]) => bodyText(pg)));
      if (!shotScoring && texts[0].includes(SEL.scoringText)) {
        shotScoring = true;
        await hostShot(S.hostPage, ctxShot, "scoring");
      }
      const ready = texts.every((t) => t.length > 40 && !t.includes(SEL.scoringText) && !/^loading/i.test(t));
      if (ready) return;
      if (Date.now() - t0 > 150000) throw new Error(`end summary not shown after 150 s; pages still on: ${texts.map((t) => t.slice(0, 40)).join(" | ")}`);
      await sleep(1000);
    }
  });
  await hostShot(S.hostPage, ctxShot, "end", { alt: true });
  for (const p of S.phones) await shot(p.page, { ...ctxShot, step: `end-${p.name}`, vp: "phone390" });

  await step(S, "calls graded (graded_at set, reasoning score a number)", async () => {
    const t0 = Date.now();
    let rows = [];
    while (Date.now() - t0 < 120000) {
      rows = S.race
        ? await sql`select player_name, lap, graded_at, score_reasoning from race_calls where lobby_code = ${S.code} and kind = 'freeze'`
        : await sql`select player_name, graded_at, score_reasoning from submissions where lobby_code = ${S.code}`;
      if (rows.length >= 2 && rows.every((r) => r.graded_at)) break;
      await sleep(1000);
    }
    if (rows.length < 2) throw new Error(`only ${rows.length} call rows`);
    const bad = rows.filter((r) => !r.graded_at || typeof r.score_reasoning !== "number" || Number.isNaN(r.score_reasoning));
    if (bad.length) throw new Error(`${bad.length}/${rows.length} rows ungraded or without a reasoning score: ${JSON.stringify(bad.slice(0, 3))}`);
    S.gradedRows = rows.length;
  });
}

// ---- main ----
const scenarios = [
  { id: "A-race", race: true, driver: RACE_DRIVER, body: { mode: "race", race_key: RACE_KEY, driver_mode: "choose" } },
  { id: "B-moment", race: false, driver: RACE_DRIVER, body: { decision_id: MOMENT_ID, driver_mode: "choose" } },
];

let fatal = null;
try {
  console.log(`e2e: ui=${UI} base=${BASE} db=${DB.which} out=${OUT}`);
  // Clear only this machine's lobby-create limit; 'unknown' is shared by every client without an IP, so leave it on prod.
  const keys = DB.prod ? ["127.0.0.1", "::1", "0:0:0:0::/64"] : ["127.0.0.1", "::1", "0:0:0:0::/64", "unknown"];
  await sql`delete from rate_limits where bucket = 'lobby_create_ip' and key = any(${keys})`;
  gate = await api.unlock();
  record("setup", "unlock the password gate", true);
  // The quick moment's driver must be one the decision can be played as.
  const drv = await api.get(`/api/decisions/${MOMENT_ID}/drivers`);
  const list = drv.json?.drivers ?? [];
  if (list.length && !list.some((d) => d.code === RACE_DRIVER)) scenarios[1].driver = list[0].code;
  browser = await launch({ puppeteerPath: PUPPETEER, chrome: CHROME, audio: AUDIO });
  for (const S of scenarios) {
    if (args.only && !S.id.toLowerCase().includes(args.only)) continue;
    try {
      await runScenario(S);
    } catch (e) {
      console.log(`scenario ${S.id} aborted: ${e?.message ?? e}`);
      // A step() failure is already recorded; anything else (a screenshot, a crashed browser) must fail the run too.
      if (!results.some((r) => r.scenario === S.id && !r.ok && !r.step.startsWith("layout "))) record(S.id, "scenario ran to the end", false, String(e?.message ?? e));
      if (S.hostPage) await shot(S.hostPage, { out: OUT, ui: UI, scenario: S.id, step: "FAILED", vp: "host1920", settle: 0 }).catch(() => {});
      for (const p of S.phones ?? []) await shot(p.page, { out: OUT, ui: UI, scenario: S.id, step: `FAILED-${p.name}`, vp: "phone390", settle: 0 }).catch(() => {});
    } finally {
      for (const p of S.phones ?? []) await p.page.__context.close().catch(() => {});
      await S.hostPage?.__context.close().catch(() => {});
    }
  }
  const byPage = pageIssues.slice(0, 20);
  record("all", "no console errors, page errors or HTTP 5xx", pageIssues.length === 0, byPage.map((i) => `\n      [${i.page}] ${i.kind}: ${i.text}`).join("") + (pageIssues.length > 20 ? `\n      ... +${pageIssues.length - 20} more` : ""));
} catch (e) {
  fatal = e;
  record("setup", "harness", false, String(e?.stack ?? e));
} finally {
  await browser?.close().catch(() => {});
  try {
    if (codes.length) {
      await sql`delete from lobbies where code = any(${codes})`;
      const left = await sql`select count(*)::int as n from lobbies where code = any(${codes})`;
      record("cleanup", `delete ${codes.length} lobbies (${codes.join(", ")})`, left[0].n === 0);
    }
  } catch (e) {
    record("cleanup", "delete lobbies", false, String(e?.message ?? e));
  }
}

// ---- summary ----
const failed = results.filter((r) => !r.ok);
console.log(`\n===== e2e summary (ui=${UI}) =====`);
const w = Math.max(...results.map((r) => r.scenario.length));
const w2 = Math.max(...results.map((r) => r.step.length));
const layoutOk = results.filter((r) => r.ok && r.step.startsWith("layout "));
for (const r of results) {
  if (r.ok && r.step.startsWith("layout ")) continue;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.scenario.padEnd(w)}  ${r.step.padEnd(w2)}${r.ok ? "" : "  " + r.detail.split("\n")[0]}`);
}
console.log(`PASS  ${layoutOk.length} screenshots with no text overlap or horizontal clipping`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`);
if (fatal || failed.length) {
  console.log(`E2E FAILED (${failed.length} failing)`);
  process.exit(1);
}
console.log("E2E PASSED");
process.exit(0);
