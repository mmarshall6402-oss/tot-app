// Migration runner for sql/*.sql — replaces the previous "run manually
// against the Supabase project" workflow every file in sql/ used to
// document. Connects with a direct Postgres connection (SUPABASE_DB_URL,
// from Supabase's Project Settings -> Database -> Connection string) since
// @supabase/supabase-js only speaks PostgREST and can't run arbitrary DDL.
//
// Applied migrations are tracked in a schema_migrations table (filename +
// applied_at), so this is safe to run repeatedly — already-applied files are
// skipped. Each pending file runs in its own transaction: a failure rolls
// that file back and stops the run before touching anything later, rather
// than leaving a half-applied migration marked as done.
//
// Usage:
//   npm run migrate           # apply all pending migrations
//   npm run migrate -- --status    # list applied/pending, apply nothing
//   npm run migrate -- --dry-run   # print which files would run, apply nothing
import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SQL_DIR = join(__dirname, "..", "sql");

async function loadMigrationFiles() {
  const files = (await readdir(SQL_DIR)).filter((f) => f.endsWith(".sql"));
  files.sort(); // zero-padded numeric prefixes (001_, 002_, ...) sort correctly as strings
  return files;
}

async function main() {
  const args = process.argv.slice(2);
  const statusOnly = args.includes("--status");
  const dryRun = args.includes("--dry-run");

  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("SUPABASE_DB_URL is not set — get it from Supabase Project Settings -> Database -> Connection string (use the pooler URI for serverless-friendly connections) and add it to .env.local");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(`
      create table if not exists schema_migrations (
        filename    text primary key,
        applied_at  timestamptz not null default now()
      );
    `);

    const files = await loadMigrationFiles();
    const { rows: appliedRows } = await client.query("select filename from schema_migrations");
    const applied = new Set(appliedRows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (statusOnly) {
      for (const f of files) console.log(`${applied.has(f) ? "[applied]" : "[pending]"} ${f}`);
      console.log(`\n${applied.size} applied, ${pending.length} pending`);
      return;
    }

    if (!pending.length) {
      console.log("Nothing to apply — schema is up to date.");
      return;
    }

    if (dryRun) {
      console.log("Would apply, in order:");
      for (const f of pending) console.log(`  ${f}`);
      return;
    }

    for (const file of pending) {
      const sql = await readFile(join(SQL_DIR, file), "utf8");
      process.stdout.write(`Applying ${file} ... `);
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("insert into schema_migrations (filename) values ($1)", [file]);
        await client.query("COMMIT");
        console.log("ok");
      } catch (e) {
        await client.query("ROLLBACK");
        console.log("FAILED");
        console.error(`\n${file} failed, rolled back. Migrations after it were not attempted.\n${e.message}`);
        process.exit(1);
      }
    }

    console.log(`\nApplied ${pending.length} migration${pending.length === 1 ? "" : "s"}.`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
