// Applies db/schema.sql to DATABASE_URL. Usage: node --env-file=.env.local scripts/migrate.mjs
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const statements = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
for (const s of statements) await sql.query(s);
const tables = await sql.query("select table_name from information_schema.tables where table_schema = 'public' order by 1");
console.log(tables.map((t) => t.table_name).join(", "));
