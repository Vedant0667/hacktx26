import { neon } from "@neondatabase/serverless";
const sql = neon(process.env.DATABASE_URL);
const q = process.argv[2];
const rows = await sql.query(q);
console.log(JSON.stringify(rows, null, 1).slice(0, Number(process.argv[3] ?? 6000)));
