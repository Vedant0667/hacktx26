// Helpers for scripts/e2e/game.mjs: HTTP client, DB, browser pages, element lookup, screenshots + layout check.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { neon } from "@neondatabase/serverless";
import { findLayoutIssues } from "./overlap.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- results ----
export const results = [];
export function record(scenario, step, ok, detail = "") {
  results.push({ scenario, step, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${scenario}  ${step}${detail ? "  " + detail : ""}`);
  return ok;
}

// ---- HTTP (server side, with the gate cookie) ----
export function makeApi(base, password) {
  let cookie = "";
  async function unlock() {
    const res = await fetch(`${base}/api/unlock`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password, next: "/" }).toString(),
    });
    const sc = res.headers.getSetCookie().map((c) => c.split(";")[0]).find((c) => c.includes("="));
    if (!sc) throw new Error(`unlock failed: HTTP ${res.status}`);
    cookie = sc;
    const i = sc.indexOf("=");
    return { name: sc.slice(0, i), value: sc.slice(i + 1) };
  }
  async function call(method, path, { body, headers = {} } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { cookie, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text.slice(0, 300);
    }
    return { status: res.status, json };
  }
  return { unlock, get: (p, h) => call("GET", p, { headers: h }), post: (p, body, h) => call("POST", p, { body, headers: h }) };
}

// ---- DB ----
export function makeDb(url) {
  const sql = neon(url);
  return sql;
}

// ---- browser ----
export async function launch({ puppeteerPath, chrome, audio }) {
  const require = createRequire(import.meta.url);
  const puppeteer = require(puppeteerPath);
  return puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    acceptInsecureCerts: true,
    args: [
      "--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${audio}`,
    ],
  });
}

// Console messages that are not regressions.
const IGNORED = [/navigator\.vibrate/i, /React DevTools/i, /Download the React DevTools/i];

export const pageIssues = []; // { page, kind, text }

export async function newPage(browser, { label, gate, base, viewport, token }) {
  // One incognito context per page: phones and host must not share localStorage (names, tokens) or cookies.
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.__context = context;
  await page.setViewport(viewport);
  const secure = base.startsWith("https");
  const u = new URL(base);
  await page.setCookie({ name: gate.name, value: gate.value, domain: u.hostname, path: "/", secure });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (IGNORED.some((re) => re.test(text))) return;
    // The harness advances phases through the API while the host page auto-advances too: the loser gets a 409.
    if (/status of 409/.test(text) && /\/api\/lobby\/\w+\/(phase|submit)/.test(m.location()?.url ?? "")) return;
    pageIssues.push({ page: label, kind: "console.error", text: text.slice(0, 300) + (m.location()?.url ? `  (${m.location().url})` : "") });
  });
  page.on("pageerror", (e) => {
    const text = String(e?.message ?? e);
    if (IGNORED.some((re) => re.test(text))) return;
    pageIssues.push({ page: label, kind: "pageerror", text: text.slice(0, 300) });
  });
  page.on("response", (res) => {
    if (res.status() >= 500) pageIssues.push({ page: label, kind: `http ${res.status()}`, text: `${res.request().method()} ${res.url()}` });
  });
  page.__label = label;
  void token;
  return page;
}

// Find an element by selector descriptor (see selectors.mjs). Returns an ElementHandle or null.
export async function locate(page, desc, vars = {}) {
  const css = (desc.css ?? "*").replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
  const h = await page.evaluateHandle(
    ({ css, text, notIn }) => {
      const re = text ? new RegExp(text, "i") : null;
      return (
        [...document.querySelectorAll(css)].find((e) => {
          if (notIn && e.closest(notIn)) return false;
          if (re && !re.test((e.innerText || e.textContent || "").trim())) return false;
          const hidden = e.matches("input[type=checkbox], input[type=radio]");
          const r = e.getBoundingClientRect();
          return hidden || (r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden");
        }) ?? null
      );
    },
    { css, text: desc.text ?? null, notIn: desc.notIn ?? null },
  );
  const el = h.asElement();
  if (!el) await h.dispose();
  return el;
}

export async function waitLocate(page, desc, { timeout = 30000, vars = {}, enabled = false, what = "element" } = {}) {
  const t0 = Date.now();
  for (;;) {
    const el = await locate(page, desc, vars);
    if (el) {
      if (!enabled || !(await el.evaluate((n) => n.disabled))) return el;
      await el.dispose();
    }
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${what} (${desc.css}${desc.text ? " /" + desc.text + "/" : ""}) on ${page.__label}`);
    await sleep(150);
  }
}

export async function press(page, desc, opts = {}) {
  const el = await waitLocate(page, desc, opts);
  if (desc.dom) await el.evaluate((n) => n.click());
  else await el.click();
  await el.dispose();
}

export async function bodyText(page) {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
}

// ---- screenshots + layout check ----
const OVERLAP_PX = 4;
export async function shot(page, { out, ui, scenario, step, vp, settle = 450 }) {
  await sleep(settle);
  const name = `${ui}-${scenario}-${step}-${vp}`;
  await page.screenshot({ path: `${out}/${name}.png` });
  // Rows and numbers animate (overtakes, countdowns): an issue only counts if it is still there on 3 checks, 700 ms apart.
  let bad = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const issues = await page.evaluate(findLayoutIssues, OVERLAP_PX);
    bad = [...issues.overlaps.map((s) => "overlap: " + s), ...issues.clipped.map((s) => "clipped: " + s), ...(issues.hscroll ? ["hscroll: " + issues.hscroll] : [])];
    if (!bad.length) break;
    await sleep(700);
  }
  record(scenario, `layout ${step} ${vp}`, bad.length === 0, bad.length ? `\n      ${bad.slice(0, 8).join("\n      ")}${bad.length > 8 ? `\n      ... +${bad.length - 8} more` : ""}` : "");
  return name;
}

// Host screenshot at 1920x1080 and (optionally) re-rendered at 1440x900.
export async function hostShot(page, ctx, step, { alt = false } = {}) {
  await page.setViewport({ width: 1920, height: 1080 });
  await shot(page, { ...ctx, step, vp: "host1920" });
  if (alt) {
    await page.setViewport({ width: 1440, height: 900 });
    await shot(page, { ...ctx, step, vp: "host1440", settle: 700 });
    await page.setViewport({ width: 1920, height: 1080 });
  }
}

export function ensureDir(d) {
  mkdirSync(d, { recursive: true });
}
