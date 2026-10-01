import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, it, expect, beforeEach } from 'vitest'

// ─── Who ends up holding a company ─────────────────────────────────────────
// Runs the real access migrations, in order, on an in-process Postgres and
// then asks the only question that matters: after this action, which
// workspace_members rows exist? Membership is the whole permission model
// (every RLS policy gates on is_workspace_member), so a row that should not
// be there IS the bug — there is no second layer that would catch it.
//
// The rule under test, from 20261004_companies_by_assignment: nothing hands a
// company out automatically. A new company reaches the administrators, its
// creator and whoever was ticked; a newly approved person holds none.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The access migrations up to the one before this change, so the "before"
// state is the real one rather than a guess at it.
const BEFORE = [
  '20260816_access_control',
  '20260817_access_invites',
  '20260818_admin_only_use_existing_access_admin',
  '20260916_assign_workspaces_per_user',
]
const CHANGE = '20261004_companies_by_assignment'

// What those migrations lean on from Supabase and from earlier migrations.
// auth.uid() reads a session setting so a test can act as any user.
const PRELUDE = `
create schema if not exists auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  admin_only boolean not null default false
);
create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner',
  primary key (workspace_id, user_id)
);
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
create or replace function public.is_workspace_member(ws_id uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.workspace_members m where m.workspace_id = ws_id and m.user_id = auth.uid())
$$;
`

const ADMIN  = '00000000-0000-0000-0000-0000000000a1'
const SARA   = '00000000-0000-0000-0000-0000000000b1'
const OMAR   = '00000000-0000-0000-0000-0000000000b2'

function migration(name) {
  return fs.readFileSync(path.join(ROOT, 'supabase/migrations', `${name}.sql`), 'utf8')
}

async function freshDatabase() {
  const pg = new PGlite()
  await pg.exec(PRELUDE)
  // 20260816 backfills its admin by this address, so the row has to exist
  // before the migration runs.
  await pg.query(`insert into auth.users (id, email) values ($1, 'hafeez@arak-sa.com')`, [ADMIN])
  for (const name of BEFORE) await pg.exec(migration(name))
  // Supabase wires this trigger in its own auth setup; the migrations only
  // define the function it calls.
  await pg.exec(`create trigger on_auth_user_created after insert on auth.users
                 for each row execute function public.handle_new_user()`)
  return pg
}

function helpers(pg) {
  const as = async uid => { await pg.query(`select set_config('test.uid', $1, false)`, [uid || '']) }
  const signUp = async (id, email) => {
    await pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
  }
  const holders = async workspaceId => {
    const { rows } = await pg.query(
      `select user_id from public.workspace_members where workspace_id = $1 order by user_id`, [workspaceId])
    return rows.map(r => r.user_id)
  }
  const companiesOf = async userId => {
    const { rows } = await pg.query(
      `select w.name from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
        where m.user_id = $1 order by w.name`, [userId])
    return rows.map(r => r.name)
  }
  const status = async userId => {
    const { rows } = await pg.query(`select status from public.user_access where user_id = $1`, [userId])
    return rows[0]?.status
  }
  const create = async (name, memberIds) => {
    const { rows } = memberIds === undefined
      ? await pg.query(`select public.create_company($1) as id`, [name])
      : await pg.query(`select public.create_company($1, $2::uuid[]) as id`, [name, memberIds])
    return rows[0].id
  }
  return { as, signUp, holders, companiesOf, status, create }
}

describe('company access after 20261004_companies_by_assignment', () => {
  let pg, h, existing

  beforeEach(async () => {
    pg = await freshDatabase()
    h = helpers(pg)

    // The team as it stands before the change: two approved members who,
    // under the old rules, were joined to the one existing company.
    await h.signUp(SARA, 'sara@example.com')
    await h.signUp(OMAR, 'omar@example.com')
    await h.as(ADMIN)
    await pg.query(`select public.approve_access($1)`, [SARA])
    await pg.query(`select public.approve_access($1)`, [OMAR])
    existing = await h.create('Existing Co')

    await pg.exec(migration(CHANGE))
  })

  it('reproduces the bug it fixes: before the change, everyone was joined', async () => {
    expect(await h.holders(existing)).toEqual([ADMIN, SARA, OMAR].sort())
  })

  it('leaves every membership that already existed alone', async () => {
    expect(await h.companiesOf(SARA)).toEqual(['Existing Co'])
    expect(await h.companiesOf(OMAR)).toEqual(['Existing Co'])
  })

  it('gives a company created by the admin to the admin only', async () => {
    await h.as(ADMIN)
    const id = await h.create('Ghusn')
    expect(await h.holders(id)).toEqual([ADMIN])
  })

  it('still answers a caller that sends only the name', async () => {
    await h.as(ADMIN)
    const id = await h.create('Old Browser Co', undefined)
    expect(await h.holders(id)).toEqual([ADMIN])
  })

  it('adds exactly the people the admin ticked', async () => {
    await h.as(ADMIN)
    const id = await h.create('Ghusn', [SARA])
    expect(await h.holders(id)).toEqual([ADMIN, SARA].sort())
    expect(await h.companiesOf(OMAR)).toEqual(['Existing Co'])
  })

  it('gives a company created by a member to that member and the admin', async () => {
    await h.as(SARA)
    const id = await h.create('Sara Co')
    expect(await h.holders(id)).toEqual([ADMIN, SARA].sort())
  })

  it('refuses a member who tries to choose who gets a company', async () => {
    await h.as(SARA)
    await expect(h.create('Sara Co', [OMAR])).rejects.toThrow(/Only the access admin/)
    expect(await h.companiesOf(OMAR)).toEqual(['Existing Co'])
  })

  it('never joins someone who has not been approved, even if ticked', async () => {
    const pending = '00000000-0000-0000-0000-0000000000c1'
    await h.signUp(pending, 'pending@example.com')
    await h.as(ADMIN)
    const id = await h.create('Ghusn', [pending])
    expect(await h.holders(id)).toEqual([ADMIN])
  })

  it('adds only the administrators when a company is inserted with no signed-in user', async () => {
    await h.as(null)
    const { rows } = await pg.query(`insert into public.workspaces (name) values ('From SQL') returning id`)
    expect(await h.holders(rows[0].id)).toEqual([ADMIN])
  })

  it('approves a request without handing over any company', async () => {
    const lina = '00000000-0000-0000-0000-0000000000c2'
    await h.signUp(lina, 'lina@example.com')
    expect(await h.status(lina)).toBe('pending')
    await h.as(ADMIN)
    await pg.query(`select public.approve_access($1)`, [lina])
    expect(await h.status(lina)).toBe('approved')
    expect(await h.companiesOf(lina)).toEqual([])
  })

  it('adds a waiting person by email with only the ticked companies', async () => {
    const lina = '00000000-0000-0000-0000-0000000000c2'
    await h.signUp(lina, 'lina@example.com')
    await h.as(ADMIN)
    const ghusn = await h.create('Ghusn')
    const { rows } = await pg.query(`select public.invite_access($1, $2::uuid[]) as outcome`, ['Lina@Example.com', [ghusn]])
    expect(rows[0].outcome).toBe('approved')
    expect(await h.companiesOf(lina)).toEqual(['Ghusn'])
  })

  it('does not change the companies of someone who is already in', async () => {
    await h.as(ADMIN)
    const ghusn = await h.create('Ghusn')
    const { rows } = await pg.query(`select public.invite_access($1, $2::uuid[]) as outcome`, ['sara@example.com', [ghusn]])
    expect(rows[0].outcome).toBe('already')
    expect(await h.companiesOf(SARA)).toEqual(['Existing Co'])
  })

  it('carries the ticked companies on an invite through to signup', async () => {
    const noor = '00000000-0000-0000-0000-0000000000c3'
    await h.as(ADMIN)
    const ghusn = await h.create('Ghusn')
    const { rows } = await pg.query(`select public.invite_access($1, $2::uuid[]) as outcome`, ['noor@example.com', [ghusn]])
    expect(rows[0].outcome).toBe('invited')

    await h.as(null)
    await h.signUp(noor, 'noor@example.com')
    expect(await h.status(noor)).toBe('approved')
    expect(await h.companiesOf(noor)).toEqual(['Ghusn'])
    const left = await pg.query(`select count(*)::int as n from public.access_invites`)
    expect(left.rows[0].n).toBe(0)
  })

  it('lets an invited person in with no companies when none were ticked', async () => {
    const noor = '00000000-0000-0000-0000-0000000000c3'
    await h.as(ADMIN)
    await pg.query(`select public.invite_access($1)`, ['noor@example.com'])
    await h.as(null)
    await h.signUp(noor, 'noor@example.com')
    expect(await h.status(noor)).toBe('approved')
    expect(await h.companiesOf(noor)).toEqual([])
  })

  it('uses the latest choice when the same address is added twice', async () => {
    const noor = '00000000-0000-0000-0000-0000000000c3'
    await h.as(ADMIN)
    const ghusn = await h.create('Ghusn')
    await pg.query(`select public.invite_access($1, $2::uuid[])`, ['noor@example.com', [existing]])
    await pg.query(`select public.invite_access($1, $2::uuid[])`, ['noor@example.com', [ghusn]])
    await h.as(null)
    await h.signUp(noor, 'noor@example.com')
    expect(await h.companiesOf(noor)).toEqual(['Ghusn'])
  })

  it('still signs someone up when an invited company was deleted meanwhile', async () => {
    const noor = '00000000-0000-0000-0000-0000000000c3'
    await h.as(ADMIN)
    const doomed = await h.create('Doomed Co')
    await pg.query(`select public.invite_access($1, $2::uuid[])`, ['noor@example.com', [doomed, existing]])
    await pg.query(`delete from public.workspaces where id = $1`, [doomed])
    await h.as(null)
    await h.signUp(noor, 'noor@example.com')
    expect(await h.status(noor)).toBe('approved')
    expect(await h.companiesOf(noor)).toEqual(['Existing Co'])
  })

  it('leaves an ordinary signup pending with nothing', async () => {
    const stranger = '00000000-0000-0000-0000-0000000000c4'
    await h.as(null)
    await h.signUp(stranger, 'stranger@example.com')
    expect(await h.status(stranger)).toBe('pending')
    expect(await h.companiesOf(stranger)).toEqual([])
  })
})
