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
  await pg.query(`insert into auth.users (id, email) values ($1, 'staff.admin@arak-sa.com')`, [ADMIN])
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

// ─── The sales team: Leads only (20261013_sales_role + _sales_seats) ──────
// A sales person must hold no workspace_members row, ever: membership is the
// permission for every marketing table and function, and nine tables join it
// directly. Their companies are sales_seats, which only the leads policies
// read. Every path that hands out companies is checked here.
describe('sales seats after 20261013_sales_seats', () => {
  const FAISAL = '00000000-0000-0000-0000-0000000000c1'
  let pg, h, arak, ghusn

  const seatsOf = async userId => {
    const { rows } = await pg.query(
      `select w.name from public.sales_seats s join public.workspaces w on w.id = s.workspace_id
        where s.user_id = $1 order by w.name`, [userId])
    return rows.map(r => r.name)
  }
  const roleOf = async userId => (await pg.query(`select role from public.user_access where user_id = $1`, [userId])).rows[0]?.role
  const one = async (sql, args = []) => Object.values((await pg.query(sql, args)).rows[0])[0]

  beforeEach(async () => {
    pg = await freshDatabase()
    h = helpers(pg)
    await pg.exec(migration(CHANGE))
    // What the sales migrations lean on beyond the access ones.
    await pg.exec(`
      alter table public.workspaces add column if not exists slug text;
      alter table public.workspaces add column if not exists created_at timestamptz not null default now();
      create table public.leads (id uuid primary key default gen_random_uuid(), workspace_id uuid not null, verdict text, human_verdict text, source text not null default 'email', subject text, updated_at timestamptz not null default now());
      create table public.lead_mailboxes (id uuid primary key default gen_random_uuid(), workspace_id uuid not null);
      create table public.lead_cards (lead_id uuid primary key references public.leads(id) on delete cascade, workspace_id uuid not null);
      alter table public.leads enable row level security;
      alter table public.lead_cards enable row level security;
      grant select on public.leads, public.lead_cards to authenticated;
    `)
    await pg.exec(migration('20261013_sales_role'))
    await pg.exec(migration('20261013_sales_seats'))
    await pg.exec(migration('20261014_lead_approval'))
    // As 20261016_lead_cards leaves it; 20261018 narrows it.
    await pg.exec(`create policy lead_cards_sales_read on public.lead_cards for select to authenticated using (public.is_sales_member(workspace_id))`)
    await pg.exec(migration('20261018_lead_assignment'))
    await pg.exec(migration('20261024_lead_pipeline'))
    await pg.exec(`create table public.lead_agent_settings (workspace_id uuid primary key, read_before timestamptz)`)
    await pg.exec(migration('20261027_lead_reads'))
    await pg.exec(`create table public.notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, workspace_id uuid, kind text not null default 'info', title text not null, body text not null default '', link text not null default '', created_at timestamptz not null default now(), read_at timestamptz)`)
    await pg.exec(migration('20261028_unassign_on_seat_removed'))
    await h.as(ADMIN)
    arak = await h.create('Arak')
    ghusn = await h.create('Ghusn')
  })

  it('an invited sales address signs up into seats, not memberships', async () => {
    expect(await one(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])).toBe('invited')
    await h.signUp(FAISAL, 'Faisal@Example.com')
    expect(await h.status(FAISAL)).toBe('approved')
    expect(await roleOf(FAISAL)).toBe('sales')
    expect(await seatsOf(FAISAL)).toEqual(['Arak'])
    expect(await h.companiesOf(FAISAL)).toEqual([])
  })

  it('a waiting person added as sales gets seats straight away', async () => {
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.as(ADMIN)
    expect(await one(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak, ghusn]])).toBe('approved')
    expect(await seatsOf(FAISAL)).toEqual(['Arak', 'Ghusn'])
    expect(await h.companiesOf(FAISAL)).toEqual([])
  })

  it('the company picker writes seats for a sales person', async () => {
    await pg.query(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.as(ADMIN)
    await pg.query(`select public.set_user_workspaces($1, $2::uuid[])`, [FAISAL, [ghusn]])
    expect(await seatsOf(FAISAL)).toEqual(['Ghusn'])
    expect(await h.companiesOf(FAISAL)).toEqual([])
  })

  it('switching role carries the companies across, both ways', async () => {
    await h.signUp(SARA, 'sara@example.com')
    await h.as(ADMIN)
    await pg.query(`select public.approve_access($1)`, [SARA])
    await pg.query(`select public.set_user_workspaces($1, $2::uuid[])`, [SARA, [arak, ghusn]])
    await pg.query(`select public.set_user_role($1, 'sales')`, [SARA])
    expect(await seatsOf(SARA)).toEqual(['Arak', 'Ghusn'])
    expect(await h.companiesOf(SARA)).toEqual([])
    await pg.query(`select public.set_user_role($1, 'member')`, [SARA])
    expect(await h.companiesOf(SARA)).toEqual(['Arak', 'Ghusn'])
    expect(await seatsOf(SARA)).toEqual([])
  })

  it('never changes the admin\'s role, and only the admin changes anyone\'s', async () => {
    await expect(pg.query(`select public.set_user_role($1, 'sales')`, [ADMIN])).rejects.toThrow(/does not change/)
    await h.signUp(SARA, 'sara@example.com')
    await h.as(ADMIN)
    await pg.query(`select public.approve_access($1)`, [SARA])
    await h.as(SARA)
    await expect(pg.query(`select public.set_user_role($1, 'sales')`, [SARA])).rejects.toThrow(/Only the access admin/)
  })

  it('as the sales person: a seat, not a member, and no way to make a company', async () => {
    await pg.query(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.as(FAISAL)
    expect(await one(`select public.is_sales_member($1)`, [arak])).toBe(true)
    expect(await one(`select public.is_sales_member($1)`, [ghusn])).toBe(false)
    expect(await one(`select public.is_workspace_member($1)`, [arak])).toBe(false)
    expect(await one(`select public.has_app_access()`)).toBe(false)
    expect((await pg.query(`select name from public.my_sales_companies()`)).rows.map(r => r.name)).toEqual(['Arak'])
    await expect(h.create('Mine')).rejects.toThrow(/not been approved/)
  })

  it('remove takes the seats too', async () => {
    await pg.query(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.as(ADMIN)
    await pg.query(`select public.revoke_access($1)`, [FAISAL])
    expect(await seatsOf(FAISAL)).toEqual([])
    await h.as(FAISAL)
    expect(await one(`select public.is_sales_member($1)`, [arak])).toBe(false)
  })

  it('only a sales admin (and the access admin) may approve leads, and only in their own companies', async () => {
    const LAYLA = '00000000-0000-0000-0000-0000000000c2'
    await pg.query(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])
    await pg.query(`select public.invite_access('layla@example.com', $1::uuid[], 'sales_admin')`, [[arak]])
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.signUp(LAYLA, 'layla@example.com')
    expect(await roleOf(LAYLA)).toBe('sales')
    expect(await seatsOf(LAYLA)).toEqual(['Arak'])
    await h.as(LAYLA)
    expect(await one(`select public.can_approve_leads($1)`, [arak])).toBe(true)
    expect(await one(`select public.can_approve_leads($1)`, [ghusn])).toBe(false)
    expect(await one(`select public.has_app_access()`)).toBe(false)
    await h.as(FAISAL)
    expect(await one(`select public.can_approve_leads($1)`, [arak])).toBe(false)
    await h.as(ADMIN)
    expect(await one(`select public.can_approve_leads($1)`, [arak])).toBe(true)
  })

  it('switching to and from sales admin moves the approve right and keeps the seats', async () => {
    await pg.query(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.as(ADMIN)
    await pg.query(`select public.set_user_role($1, 'sales_admin')`, [FAISAL])
    expect(await roleOf(FAISAL)).toBe('sales')
    expect(await seatsOf(FAISAL)).toEqual(['Arak'])
    await h.as(FAISAL)
    expect(await one(`select public.can_approve_leads($1)`, [arak])).toBe(true)
    await h.as(ADMIN)
    await pg.query(`select public.set_user_role($1, 'member')`, [FAISAL])
    expect(await h.companiesOf(FAISAL)).toEqual(['Arak'])
    await h.as(FAISAL)
    expect(await one(`select public.can_approve_leads($1)`, [arak])).toBe(false)
  })

  // 20261018_lead_assignment: a salesperson reads only their own leads, as
  // in Odoo. Read through the real policy: RLS on, as the authenticated role.
  it('a salesperson sees their own leads; a sales admin all; a website seat the website\'s too; a card goes with its lead', async () => {
    const LAYLA = '00000000-0000-0000-0000-0000000000c2'
    const HUDA = '00000000-0000-0000-0000-0000000000c3'
    await pg.query(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])
    await pg.query(`select public.invite_access('huda@example.com', $1::uuid[], 'sales')`, [[arak]])
    await pg.query(`select public.invite_access('layla@example.com', $1::uuid[], 'sales_admin')`, [[arak]])
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.signUp(HUDA, 'huda@example.com')
    await h.signUp(LAYLA, 'layla@example.com')
    await pg.query(`update public.sales_seats set all_website_leads = true where user_id = $1`, [HUDA])
    const lead = async (subject, source, owner, ws = arak) =>
      one(`insert into public.leads (workspace_id, subject, source, assigned_to) values ($1, $2, $3, $4) returning id`, [ws, subject, source, owner])
    const faisalsEmail = await lead('faisal email', 'email', FAISAL)
    await lead('huda email', 'email', HUDA)
    await lead('unassigned email', 'email', null)
    await lead('website for faisal', 'website_form', FAISAL)
    await lead('website unassigned', 'website_form', null)
    await lead('ghusn website', 'website_form', null, ghusn)
    await pg.query(`insert into public.lead_cards (lead_id, workspace_id) values ($1, $2)`, [faisalsEmail, arak])

    const sees = async uid => {
      await h.as(uid)
      await pg.exec('set role authenticated')
      try {
        const { rows } = await pg.query(`select subject from public.leads order by subject`)
        const cards = (await pg.query(`select count(*)::int as n from public.lead_cards`)).rows[0].n
        return { leads: rows.map(r => r.subject), cards }
      } finally { await pg.exec('reset role') }
    }
    expect(await sees(FAISAL)).toEqual({ leads: ['faisal email', 'website for faisal'], cards: 1 })
    expect(await sees(HUDA)).toEqual({ leads: ['huda email', 'website for faisal', 'website unassigned'], cards: 0 })
    expect(await sees(LAYLA)).toEqual({ leads: ['faisal email', 'huda email', 'unassigned email', 'website for faisal', 'website unassigned'], cards: 1 })

    // 20261024_lead_pipeline: a lead added by hand is its owner's, like any other.
    await lead('faisal added', 'manual', FAISAL)
    expect((await sees(FAISAL)).leads).toContain('faisal added')
    expect((await sees(HUDA)).leads).not.toContain('faisal added')
    await expect(lead('bad source', 'fax', FAISAL)).rejects.toThrow(/leads_source_check/)

    // 20261027_lead_reads: a person marks only their own reads, only on a lead they can see.
    const hudasEmail = await one(`select id from public.leads where subject = 'huda email'`)
    const mark = async (uid, leadId, forUser = uid) => {
      await h.as(uid)
      await pg.exec('set role authenticated')
      try { await pg.query(`insert into public.lead_reads (lead_id, user_id, workspace_id) values ($1, $2, $3)`, [leadId, forUser, arak]) } finally { await pg.exec('reset role') }
    }
    await mark(FAISAL, faisalsEmail)
    await expect(mark(FAISAL, hudasEmail)).rejects.toThrow(/row-level security/)
    await expect(mark(FAISAL, faisalsEmail, HUDA)).rejects.toThrow(/row-level security/)
    await h.as(HUDA)
    await pg.exec('set role authenticated')
    try { expect((await pg.query(`select count(*)::int as n from public.lead_reads`)).rows[0].n).toBe(0) } finally { await pg.exec('reset role') }

    // The team by name, for the Owner column: the team and the admin, no one else.
    await h.as(FAISAL)
    expect((await pg.query(`select email, approver from public.sales_team($1)`, [arak])).rows.map(r => r.email)).toEqual(['faisal@example.com', 'huda@example.com', 'layla@example.com'])
    expect((await pg.query(`select * from public.sales_team($1)`, [ghusn])).rows).toEqual([])
    await h.as(SARA)
    expect((await pg.query(`select * from public.sales_team($1)`, [arak])).rows).toEqual([])
  })

  // 20261028: removing someone's seat gives their open leads back, unassigned.
  it('a salesperson losing access: their open leads come back unassigned, won and lost stay, the sales admin is told', async () => {
    const LAYLA = '00000000-0000-0000-0000-0000000000c2'
    await pg.query(`select public.invite_access('faisal@example.com', $1::uuid[], 'sales')`, [[arak]])
    await pg.query(`select public.invite_access('layla@example.com', $1::uuid[], 'sales_admin')`, [[arak]])
    await h.signUp(FAISAL, 'faisal@example.com')
    await h.signUp(LAYLA, 'layla@example.com')
    const lead = async (subject, stage) =>
      one(`insert into public.leads (workspace_id, subject, source, assigned_to, stage) values ($1, $2, 'email', $3, $4) returning id`, [arak, subject, FAISAL, stage])
    await lead('open one', 'quotation')
    await lead('not in pipeline', null)
    await lead('won one', 'won')
    await h.as(ADMIN)
    await pg.query(`select public.revoke_access($1)`, [FAISAL])
    const rows = (await pg.query(`select subject, assigned_to, stage from public.leads where workspace_id = $1 order by subject`, [arak])).rows
    expect(rows).toEqual([
      { subject: 'not in pipeline', assigned_to: null, stage: null },
      { subject: 'open one', assigned_to: null, stage: 'quotation' },
      { subject: 'won one', assigned_to: FAISAL, stage: 'won' },
    ])
    const notes = (await pg.query(`select user_id, title from public.notifications`)).rows
    expect(notes).toEqual([{ user_id: LAYLA, title: '2 leads are unassigned: faisal@example.com no longer has access' }])
  })

  it('a member is added exactly as before', async () => {
    expect(await one(`select public.invite_access('sara@example.com', $1::uuid[])`, [[arak]])).toBe('invited')
    await h.signUp(SARA, 'sara@example.com')
    expect(await roleOf(SARA)).toBe('member')
    expect(await h.companiesOf(SARA)).toEqual(['Arak'])
    expect(await seatsOf(SARA)).toEqual([])
    await h.as(SARA)
    expect(await one(`select public.has_app_access()`)).toBe(true)
  })
})
