/**
 * Apply SQL migrations in supabase/migrations in filename order, once each.
 *   npm run db:migrate             → Supabase (or any Postgres that already has the auth schema)
 *   npm run db:migrate -- --local  → plain local Postgres: applies supabase/local/00_auth_shim.sql first
 */
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../supabase');

export async function migrate(connectionString: string, { local = false, log = console.log } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    if (local) {
      await client.query(await readFile(path.join(root, 'local/00_auth_shim.sql'), 'utf8'));
      log('applied local auth shim');
    }
    await client.query(`create table if not exists public.schema_migrations (
      filename text primary key, applied_at timestamptz not null default now())`);
    const done = new Set((await client.query('select filename from public.schema_migrations')).rows.map(r => r.filename));
    const files = (await readdir(path.join(root, 'migrations'))).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(root, 'migrations', file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into public.schema_migrations (filename) values ($1)', [file]);
        await client.query('commit');
        log(`applied ${file}`);
      } catch (err) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }
  migrate(url, { local: process.argv.includes('--local') })
    .then(() => console.log('migrations up to date'))
    .catch(err => {
      console.error(err.message);
      process.exit(1);
    });
}
