import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, it, expect, beforeAll } from 'vitest'

// ─── The v2 shell's database rules ─────────────────────────────────────────
// 2026-10-28, docs/SHELL.md. Runs the two shell migrations on an in-process
// Postgres and acts as different people (SET ROLE authenticated + a test
// uid, so RLS applies as it does through the API):
//
//   · shell_pins: each person reads and writes only their own row, and only
//     in a company they belong to;
//   · shell_fold / shell_hits / shell_rank: the search's matching, the same
//     as the browser's (src/lib/shell/search.js).
//
// The search functions themselves read the modules' tables, which are not
// built here; they are SECURITY INVOKER, so each module's own RLS (tested in
// contacts.test.js, crm.test.js) decides what they return. Their bodies are
// checked against the real local stack (docs/SHELL.md, "How it was checked").

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const migration = name => fs.readFileSync(path.join(ROOT, 'supabase/migrations', `${name}.sql`), 'utf8')

const PRELUDE = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
grant usage on schema auth, public to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;

create table public.workspaces (id uuid primary key, name text not null);
create table public.workspace_members (workspace_id uuid references public.workspaces(id), user_id uuid, primary key (workspace_id, user_id));
create function public.is_workspace_member(ws_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members wm where wm.workspace_id = ws_id and wm.user_id = auth.uid())
$$;
`

const ARAK = '00000000-0000-0000-0000-000000000001'
const GHUSN = '00000000-0000-0000-0000-000000000002'
const U = {
  sara: '00000000-0000-0000-0000-0000000000a1', // Arak only
  faisal: '00000000-0000-0000-0000-0000000000a2', // Arak only
}

let pg

/** Run SQL as a person (RLS on), then return to the superuser. */
async function as(who, sql, params = []) {
  await pg.query(`select set_config('test.uid', $1, false)`, [U[who] || ''])
  await pg.exec('set role authenticated')
  try {
    return await pg.query(sql, params)
  } finally {
    await pg.exec('reset role')
  }
}

async function refused(who, sql, params = []) {
  try { await as(who, sql, params); return false } catch { return true }
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(`
    insert into public.workspaces values ('${ARAK}', 'Arak'), ('${GHUSN}', 'Ghusn');
    insert into auth.users values ('${U.sara}', 'staff.marketing@arak-sa.com'), ('${U.faisal}', 'staff.sales@arak-sa.com');
    insert into public.workspace_members values ('${ARAK}', '${U.sara}'), ('${ARAK}', '${U.faisal}');
  `)
  await pg.exec(migration('20261127_shell_1_pins'))
  // The search functions name tables this test does not build.
  await pg.exec('set check_function_bodies = off')
  await pg.exec(migration('20261127_shell_2_search'))
  await pg.exec('set check_function_bodies = on')
}, 30_000)

describe('shell_pins', () => {
  it('saves and reads back my own pins', async () => {
    await as('sara', `insert into public.shell_pins (workspace_id, sections) values ($1, $2)`, [ARAK, ['marketing', 'insights']])
    const { rows } = await as('sara', `select user_id, sections from public.shell_pins where workspace_id = $1`, [ARAK])
    expect(rows).toEqual([{ user_id: U.sara, sections: ['marketing', 'insights'] }])
    await as('sara', `update public.shell_pins set sections = $2 where workspace_id = $1`, [ARAK, ['marketing']])
    const again = await as('sara', `select sections from public.shell_pins where workspace_id = $1`, [ARAK])
    expect(again.rows[0].sections).toEqual(['marketing'])
  })

  it("never shows or changes someone else's pins", async () => {
    const { rows } = await as('faisal', `select * from public.shell_pins`)
    expect(rows).toEqual([])
    const upd = await as('faisal', `update public.shell_pins set sections = '{}' returning 1`)
    expect(upd.rows).toEqual([])
    const del = await as('faisal', `delete from public.shell_pins returning 1`)
    expect(del.rows).toEqual([])
    expect(await refused('faisal', `insert into public.shell_pins (workspace_id, user_id, sections) values ($1, $2, '{sales}')`, [ARAK, U.sara])).toBe(true)
  })

  it('refuses pins in a company I do not belong to', async () => {
    expect(await refused('sara', `insert into public.shell_pins (workspace_id, sections) values ($1, '{marketing}')`, [GHUSN])).toBe(true)
    expect(await refused('sara', `update public.shell_pins set workspace_id = $1 where workspace_id = $2`, [GHUSN, ARAK])).toBe(true)
  })

  it('takes only section-key-shaped words', async () => {
    expect(await refused('faisal', `insert into public.shell_pins (workspace_id, sections) values ($1, '{"Sales; drop"}')`, [ARAK])).toBe(true)
    await as('faisal', `insert into public.shell_pins (workspace_id, sections) values ($1, '{}')`, [ARAK])
  })

  it('is not open to anonymous callers', async () => {
    await pg.exec('set role anon')
    try {
      await expect(pg.query('select * from public.shell_pins')).rejects.toThrow()
    } finally {
      await pg.exec('reset role')
    }
  })
})

describe('matching, as the browser does it', () => {
  const one = async (sql, params) => Object.values((await pg.query(sql, params)).rows[0])[0]

  it('folds Arabic letter forms and case', async () => {
    expect(await one(`select public.shell_fold($1)`, ['  أبراج  نجد الـمُدير مصطفى مدرسة '])).toBe('ابراج نجد المدير مصطفي مدرسه')
    expect(await one(`select public.shell_fold($1)`, ['NAJD Towers'])).toBe('najd towers')
  })

  it('needs every word of the query, in any order', async () => {
    expect(await one(`select public.shell_hits(public.shell_fold($1), public.shell_fold($2))`, ['Najd tower lobby', 'lobby najd'])).toBe(true)
    expect(await one(`select public.shell_hits(public.shell_fold($1), public.shell_fold($2))`, ['Najd tower lobby', 'najd hotel'])).toBe(false)
    expect(await one(`select public.shell_hits('anything', '')`)).toBe(false)
  })

  it('ranks the exact name, the start, a word start, then anywhere', async () => {
    const rank = (q, names) => one(`select public.shell_rank(public.shell_fold($1), $2)`, [q, names])
    expect(await rank('najd', ['Najd'])).toBe(0)
    expect(await rank('naj', ['Najd Towers'])).toBe(1)
    expect(await rank('tow', ['Najd Towers'])).toBe(2)
    expect(await rank('owers', ['Najd Towers'])).toBe(3)
    expect(await rank('ابراج', [null, 'شركة أبراج نجد'])).toBe(2)
  })

  it('lets only signed-in people call the search functions', async () => {
    const { rows } = await pg.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as auth,
             p.prosecdef as definer
        from pg_proc p where p.proname like 'shell_search_%' order by 1`)
    expect(rows.map(r => r.proname)).toEqual(['shell_search_contacts', 'shell_search_crm', 'shell_search_hr', 'shell_search_leads', 'shell_search_requests', 'shell_search_tasks'])
    for (const r of rows) expect(r).toMatchObject({ anon: false, auth: true, definer: false })
  })
})
