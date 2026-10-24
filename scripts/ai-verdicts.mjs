// Round 9: luck-aware verdicts, offline (security-contract.md Round 9). For every seeded race freeze and moment
// decision car whose full row has luck_events (engine/build.py: an SC/VSC deployed, a red flag or a rain change
// after the call, before its measurement ended), asks Muse Spark once which call was right given only what was
// knowable at the call. The answer is checked (lib/luck.ts verdictProblems: no flip without luck, explanation
// grounded in the input and at most 20 words), re-asked once on a problem, else the measured answer stands.
// Results go to table ai_verdicts with the model and time. Rows without luck events get no call: their right
// call is the measured one. Idempotent: a row whose input is unchanged is not asked again (a 'no_answer' row,
// from a failed or over-budget call, is retried). Spend goes through lib/muse/client.ts (budget reservation).
// Usage: npx tsx --env-file=.env.local scripts/ai-verdicts.mjs [--race <key>] [--force] [--dry]
// Run after scripts/seed-db.mjs. A running server caches race data per process: restart it to pick verdicts up.
import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { z } from "zod";
import { MUSE_MODEL, museBudgetUsd, museEnabled, museJson } from "../lib/muse/client.ts";
import { VERDICT_PROMPT_VERSION, VERDICT_SCHEMA, VERDICT_TASK, verdictInput, verdictProblems } from "../lib/luck.ts";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const race = opt("--race");
const force = args.includes("--force");
const dry = args.includes("--dry");
const VERDICT_TOKENS = 1200; // minimal effort still reasons for a few hundred tokens
const TIMEOUT_MS = 30_000;

const sql = neon(process.env.DATABASE_URL);
const started = new Date();

const rows = await sql.query(
  `select * from (
     select 'freeze' as kind, f.race_key as scope, f.race_key, f.driver_code, f.lap,
       f."full"->'luck_events' as luck_events, f."full"->'luck_facts' as facts,
       f."full"->>'correct' as measured, (f."full"->>'swing_s')::float8 as swing_s
     from race_freezes f
     where jsonb_array_length(coalesce(f."full"->'luck_events', '[]'::jsonb)) > 0
     union all
     select 'decision', d.decision_id, p.race_key, d.driver_code, p.lap,
       d."full"->'luck_events', d."full"->'luck_facts',
       d."full"->'ground_truth'->>'correct', (d."full"->'ground_truth'->>'swing_s')::float8
     from decision_drivers d join decision_points p on p.id = d.decision_id
     where d.scorable and jsonb_array_length(coalesce(d."full"->'luck_events', '[]'::jsonb)) > 0
   ) x where $1::text is null or x.race_key = $1 order by race_key, kind, lap, driver_code`,
  [race],
);
const stored = new Map(
  (await sql.query(`select kind, scope, driver_code, lap, input_hash, status from ai_verdicts`)).map((v) => [
    `${v.kind}|${v.scope}|${v.driver_code}|${v.lap}`,
    v,
  ]),
);

const validator = z.object({ right_call: z.enum(["BOX", "STAY"]), luck_changed_outcome: z.boolean(), explanation: z.string() });

async function ask(row, input, note) {
  return museJson({
    purpose: "ai_verdict",
    lobbyCode: null,
    decisionId: row.kind === "freeze" ? `race:${row.scope}:L${row.lap}:${row.driver_code}` : `${row.scope}:${row.driver_code}`,
    instructions: note ? `${VERDICT_TASK}\n\nYour last answer was rejected: ${note}. Fix that and answer again.` : VERDICT_TASK,
    input,
    schemaName: "luck_verdict",
    jsonSchema: VERDICT_SCHEMA,
    validator,
    maxOutputTokens: VERDICT_TOKENS,
    timeoutMs: TIMEOUT_MS,
  });
}

// At most two asks: a problem is re-asked once with the problems listed; then the measured answer stands.
async function judge(row, input) {
  let note = null;
  let last = null;
  let problems = [];
  let attempts = 0;
  for (let i = 0; i < 2; i++) {
    attempts++;
    const out = await ask(row, input, note);
    if (!out) return { status: last ? "rejected" : "no_answer", out: last, problems: last ? problems : ["no answer from Muse"], attempts };
    last = out;
    problems = verdictProblems(out, input, row.measured);
    if (!problems.length) return { status: "accepted", out, problems, attempts };
    note = problems.join("; ");
  }
  return { status: "rejected", out: last, problems, attempts };
}

if (!museEnabled() && !dry) throw new Error("MODEL_API_KEY is not set");
console.log(`${rows.length} rows with luck events${race ? ` on ${race}` : ""}; model ${MUSE_MODEL}, budget $${museBudgetUsd()}`);
const results = [];
for (const row of rows) {
  if (!row.facts) throw new Error(`${row.scope} ${row.driver_code} L${row.lap}: luck_events without luck_facts (rebuild and re-seed)`);
  const input = verdictInput(row.facts);
  const hash = createHash("sha256").update(`${VERDICT_PROMPT_VERSION}|${MUSE_MODEL}|${input}`).digest("hex").slice(0, 24);
  const key = `${row.kind}|${row.scope}|${row.driver_code}|${row.lap}`;
  const prev = stored.get(key);
  if (!force && prev && prev.input_hash === hash && prev.status !== "no_answer") {
    results.push({ row, skipped: true });
    continue;
  }
  if (dry) {
    console.log(`DRY ${key}\n  ${input}`);
    continue;
  }
  const j = await judge(row, input);
  const accepted = j.status === "accepted";
  const final = accepted ? j.out.right_call : row.measured;
  await sql.query(
    `insert into ai_verdicts (kind, scope, driver_code, lap, luck_events, measured_correct, measured_swing_s, right_call,
       luck_changed_outcome, explanation, status, final_right_call, problems, attempts, input_hash, model, created_at)
     values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, now())
     on conflict (kind, scope, driver_code, lap) do update set luck_events = excluded.luck_events,
       measured_correct = excluded.measured_correct, measured_swing_s = excluded.measured_swing_s,
       right_call = excluded.right_call, luck_changed_outcome = excluded.luck_changed_outcome,
       explanation = excluded.explanation, status = excluded.status, final_right_call = excluded.final_right_call,
       problems = excluded.problems, attempts = excluded.attempts, input_hash = excluded.input_hash,
       model = excluded.model, created_at = now()`,
    [
      row.kind, row.scope, row.driver_code, row.lap, JSON.stringify(row.luck_events), row.measured, row.swing_s,
      j.out?.right_call ?? null, j.out?.luck_changed_outcome ?? null, accepted ? j.out.explanation.trim() : null,
      j.status, final, JSON.stringify(j.problems), j.attempts, hash, MUSE_MODEL,
    ],
  );
  results.push({ row, skipped: false, ...j });
}
if (dry) process.exit(0);

// Every luck-affected verdict as stored now (including rows skipped as unchanged).
const all = await sql.query(
  `select kind, scope, driver_code, lap, luck_events, measured_correct, measured_swing_s, right_call,
     luck_changed_outcome, explanation, status, final_right_call, problems, attempts, model, created_at
   from ai_verdicts where $1::text is null or scope = $1 or scope in (select id from decision_points where race_key = $1)
   order by scope, lap, driver_code`,
  [race],
);
const live = new Set(rows.map((r) => `${r.kind}|${r.scope}|${r.driver_code}|${r.lap}`));
console.log("\nrace / decision | car | lap | luck events | measured -> final | status | explanation");
for (const v of all.filter((v) => live.has(`${v.kind}|${v.scope}|${v.driver_code}|${v.lap}`))) {
  const ev = v.luck_events.map((e) => `${e.kind} L${e.lap}`).join(", ");
  const flip = v.final_right_call !== v.measured_correct ? "  FLIPPED" : "";
  console.log(
    `${v.scope} | ${v.driver_code} | L${v.lap} | ${ev} | ${v.measured_correct} (${v.measured_swing_s} s) -> ${v.final_right_call}${flip} | ` +
      `${v.status}${v.luck_changed_outcome ? ", luck changed it" : ""}${v.status !== "accepted" ? ` [${v.problems.join("; ")}]` : ""} | ${v.explanation ?? "-"}`,
  );
}
const [spend] = await sql.query(
  `select count(*)::int as calls, coalesce(sum(cost_usd), 0)::float8 as cost from muse_calls where purpose = 'ai_verdict' and created_at >= $1`,
  [started.toISOString()],
);
const [total] = await sql.query(`select coalesce(sum(cost_usd), 0)::float8 as cost from muse_calls`);
const asked = results.filter((r) => !r.skipped);
const count = (s) => asked.filter((r) => r.status === s).length;
console.log(
  `\nthis run: ${asked.length} rows asked (${count("accepted")} accepted, ${count("rejected")} rejected, ${count("no_answer")} no answer), ` +
    `${results.length - asked.length} unchanged and skipped; Muse calls ${spend.calls}, cost $${spend.cost.toFixed(4)}; ` +
    `all Muse spend $${total.cost.toFixed(4)} of $${museBudgetUsd()}`,
);
