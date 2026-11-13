import fs from 'node:fs';
import path from 'node:path';

/**
 * Tiny database layer with one API for two engines:
 *  - PostgreSQL via `pg` when DATABASE_URL is set (production / Supabase)
 *  - PGlite (real Postgres compiled to WASM, in-process) otherwise, so the app runs with zero setup.
 * Both use $1, $2 ... parameters.
 */

export type Row = Record<string, any>;
export interface Db {
  query<T extends Row = any>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run fn inside a transaction. Throwing rolls back. */
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
}

type Engine = { db: Db; ready: Promise<void> };
const g = globalThis as unknown as { __ahadiDb?: Engine };

async function makePg(url: string): Promise<Db> {
  const pg = await import('pg');
  // BIGINT and NUMERIC come back as strings by default; amounts are safe as JS numbers here (< 2^53).
  pg.default.types.setTypeParser(20, (v: string) => Number(v));
  pg.default.types.setTypeParser(1700, (v: string) => Number(v));
  pg.default.types.setTypeParser(1082, (v: string) => v); // DATE stays 'YYYY-MM-DD'
  const pool = new pg.default.Pool({ connectionString: url, max: 10 });
  const wrap = (client: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }): Db => ({
    query: async (sql, params = []) => (await client.query(sql, params)).rows,
    tx: async () => {
      throw new Error('nested transactions are not supported');
    },
  });
  return {
    query: async (sql, params = []) => (await pool.query(sql, params)).rows,
    tx: async (fn) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(wrap(client));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
  };
}

export async function makePglite(dataDir?: string): Promise<Db> {
  const { PGlite, types } = await import('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const parsers = {
    [types.INT8]: (v: string) => Number(v),
    [types.NUMERIC]: (v: string) => Number(v),
    [types.DATE]: (v: string) => v,
  };
  const pgl = dataDir ? new PGlite(dataDir, { parsers }) : new PGlite({ parsers });
  // PGlite is single-connection; serialise transactions so they never interleave.
  let chain: Promise<unknown> = Promise.resolve();
  const inner = (t: { query: (s: string, p?: unknown[]) => Promise<{ rows: any[] }> }): Db => ({
    query: async (sql, params = []) => (await t.query(sql, params)).rows,
    tx: async () => {
      throw new Error('nested transactions are not supported');
    },
  });
  const db: Db = {
    query: async (sql, params = []) => {
      await chain.catch(() => undefined);
      return (await pgl.query(sql, params)).rows as any[];
    },
    tx: (fn) => {
      const run = chain.catch(() => undefined).then(() => pgl.transaction((t) => fn(inner(t))));
      chain = run;
      return run;
    },
  };
  return db;
}

export async function migrate(db: Db, dir = path.join(process.cwd(), 'db', 'migrations')) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await db.tx(async (q) => {
      await execMulti(q, sql);
      await q.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
    });
  }
}

/** Execute a SQL file that contains several statements (handles $$ function bodies). */
async function execMulti(q: Db, sql: string) {
  const stmts: string[] = [];
  let cur = '';
  let inDollar = false;
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (!inDollar && trimmed.startsWith('--')) continue;
    cur += line + '\n';
    const count = (line.match(/\$\$/g) || []).length;
    if (count % 2 === 1) inDollar = !inDollar;
    // A statement ends at ';' even when a trailing "-- comment" follows it on the same line.
    const code = inDollar ? trimmed : trimmed.replace(/\s*--.*$/, '');
    if (!inDollar && code.endsWith(';')) {
      stmts.push(cur);
      cur = '';
    }
  }
  if (cur.trim()) stmts.push(cur);
  for (const s of stmts) await q.query(s);
}

async function init(): Promise<Engine> {
  const url = process.env.DATABASE_URL;
  const db = url ? await makePg(url) : await makePglite(path.join(process.cwd(), '.data', 'pglite'));
  const ready = migrate(db);
  return { db, ready };
}

let pending: Promise<Engine> | undefined;
export async function getDb(): Promise<Db> {
  if (!g.__ahadiDb) {
    pending ??= init();
    g.__ahadiDb = await pending;
  }
  await g.__ahadiDb.ready;
  return g.__ahadiDb.db;
}

/** For tests: install a specific database instance. */
export function setDbForTests(db: Db) {
  g.__ahadiDb = { db, ready: Promise.resolve() };
}
