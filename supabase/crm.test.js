import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, it, expect, beforeAll } from 'vitest'

// ─── CRM: the database's rules, as each kind of person ─────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Runs the Contacts migrations and the two
// CRM migrations on an in-process Postgres and acts as different people (SET
// ROLE authenticated + a test uid, so RLS applies as it does through the API):
//
//   · company separation: nobody reads or writes another company's rows,
//     and no row can point at another company's stage, client, tag…;
//   · the levels: view reads, work does the day-to-day, manage sets it up
//     and reads the history; a member without the CRM sees nothing;
//   · Musa's rules: open → won (needs a client, final) or lost (needs a
//     reason, only reopened), numbering, active lists only, the assignee,
//     the archived client, delete, done activities, closed tags, history.
//
// The helpers below stand in for the baseline's and 20261101_section_access's
// (as supabase/contacts.test.js does).

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
create table public.workspace_members (workspace_id uuid references public.workspaces(id) on delete cascade, user_id uuid, primary key (workspace_id, user_id));
create table public.user_access (user_id uuid primary key, role text not null, status text not null default 'approved', full_name text, email text);
create table public.section_access (workspace_id uuid, user_id uuid, section text, level text, primary key (workspace_id, user_id, section));
create table public.tasks (id uuid primary key default gen_random_uuid(), section text);
create table public.meetings (id uuid primary key default gen_random_uuid(), section text);

create function public.is_workspace_member(ws_id uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members wm where wm.workspace_id = ws_id and wm.user_id = auth.uid())
$$;
create function public.is_access_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_access ua where ua.user_id = auth.uid() and ua.role = 'admin' and ua.status = 'approved')
$$;
create function public.section_rank(l text) returns integer language sql immutable as $$
  select case l when 'view' then 1 when 'work' then 2 when 'manage' then 3 else 0 end
$$;
create function public.has_section(ws uuid, sec text, min_level text default 'view') returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_workspace_member(ws) and (
    public.is_access_admin()
    or exists (select 1 from public.section_access a where a.workspace_id = ws and a.user_id = auth.uid()
               and a.section = sec and public.section_rank(a.level) >= public.section_rank(min_level)))
$$;
grant execute on function public.has_section(uuid, text, text) to authenticated;
`

const ARAK = '00000000-0000-0000-0000-000000000001'
const GHUSN = '00000000-0000-0000-0000-000000000002'
const U = {
  admin: '00000000-0000-0000-0000-0000000000a1',
  viewer: '00000000-0000-0000-0000-0000000000b1',
  worker: '00000000-0000-0000-0000-0000000000b2',
  manager: '00000000-0000-0000-0000-0000000000b3',
  outsider: '00000000-0000-0000-0000-0000000000b4', // an Arak member with no CRM grant
  ghusn: '00000000-0000-0000-0000-0000000000c1', // manages the CRM (and Contacts) in Ghusn only
}

let pg
const ids = {}

async function as(who, sql, params = []) {
  await pg.query(`select set_config('test.uid', $1, false)`, [U[who] || ''])
  await pg.exec('set role authenticated')
  try {
    return await pg.query(sql, params)
  } finally {
    await pg.exec('reset role')
  }
}

/** The CRM_… code (or the Postgres message) a refused statement gives; null when it went through. */
async function refusal(who, sql, params = []) {
  try {
    await as(who, sql, params)
    return null
  } catch (err) {
    return err.message
  }
}

const one = async (who, sql, params = []) => (await as(who, sql, params)).rows[0]

async function addLead(who, extra = {}) {
  const f = { ws: ARAK, title: 'Villa lighting (test)', organization: 'Org (test)', stage: ids.s1, client: null, assignee: null, ...extra }
  return one(who, `insert into public.crm_leads (workspace_id, title, organization, stage_id, client_org_id, assigned_to)
                   values ($1, $2, $3, $4, $5, $6) returning id, lead_no, status, created_by`,
  [f.ws, f.title, f.organization, f.stage, f.client, f.assignee])
}

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(`
    insert into public.workspaces values ('${ARAK}', 'Arak'), ('${GHUSN}', 'Ghusn');
    insert into auth.users (id) select unnest(array['${Object.values(U).join("','")}']::uuid[]);
    insert into public.user_access (user_id, role, full_name, email) values
      ('${U.admin}', 'admin', 'Omar', 'staff.admin@arak-sa.com'), ('${U.viewer}', 'member', 'Sara', 'staff.marketing@arak-sa.com'),
      ('${U.worker}', 'member', 'Faisal', 'staff.sales@arak-sa.com'), ('${U.manager}', 'member', 'Nasser', 'staff.ceo@arak-sa.com'),
      ('${U.outsider}', 'member', 'Tariq', 'staff.dev@arak-sa.com'), ('${U.ghusn}', 'member', 'Ghusn (test)', 'outside.two@example.com');
    insert into public.workspace_members values ('${ARAK}', '${U.admin}'), ('${GHUSN}', '${U.admin}'), ('${ARAK}', '${U.viewer}'),
      ('${ARAK}', '${U.worker}'), ('${ARAK}', '${U.manager}'), ('${ARAK}', '${U.outsider}'), ('${GHUSN}', '${U.ghusn}');
    insert into public.section_access values ('${ARAK}', '${U.viewer}', 'crm', 'view'), ('${ARAK}', '${U.worker}', 'crm', 'work'),
      ('${ARAK}', '${U.manager}', 'crm', 'manage'), ('${ARAK}', '${U.manager}', 'contacts', 'manage'),
      ('${ARAK}', '${U.outsider}', 'contacts', 'manage'), ('${GHUSN}', '${U.ghusn}', 'crm', 'manage'), ('${GHUSN}', '${U.ghusn}', 'contacts', 'manage');
  `)
  const files = ['20261120_contacts_1_tables', '20261120_contacts_2_rules', '20261120_contacts_3_musa_parity', '20261125_crm_1_tables', '20261125_crm_2_rules']
  for (const f of files) await pg.exec(migration(f))
  // Every file is safe to re-run.
  for (const f of files) await pg.exec(migration(f))

  // Arak's lists (by its manager) and Ghusn's.
  const add = async (who, table, ws, name, extra = '') => (await one(who, `insert into public.${table} (workspace_id, name${extra ? ', sequence' : ''}) values ($1, $2${extra ? `, ${extra}` : ''}) returning id`, [ws, name])).id
  ids.s1 = await add('manager', 'crm_stages', ARAK, 'جديدة', '10')
  ids.s2 = await add('manager', 'crm_stages', ARAK, 'تفاوض', '20')
  ids.sOff = await add('manager', 'crm_stages', ARAK, 'Old stage', '30')
  ids.src = await add('manager', 'crm_sources', ARAK, 'Exhibition')
  ids.srcOff = await add('manager', 'crm_sources', ARAK, 'Old source')
  ids.r1 = await add('manager', 'crm_lost_reasons', ARAK, 'Price')
  ids.rOff = await add('manager', 'crm_lost_reasons', ARAK, 'Old reason')
  ids.t1 = await add('manager', 'crm_tags', ARAK, 'GRMS')
  ids.tOff = await add('manager', 'crm_tags', ARAK, 'Old tag')
  for (const [t, id] of [['crm_stages', ids.sOff], ['crm_sources', ids.srcOff], ['crm_lost_reasons', ids.rOff], ['crm_tags', ids.tOff]]) {
    await as('manager', `update public.${t} set is_active = false where id = $1`, [id])
  }
  ids.gs = await add('ghusn', 'crm_stages', GHUSN, 'Ghusn stage', '10')
  ids.gt = await add('ghusn', 'crm_tags', GHUSN, 'Ghusn tag')
  // Contacts: an Arak client, an Arak consultant (not a client yet), an archived one, and a Ghusn one.
  const org = async (who, ws, name, roles, status = 'active') => (await one(who,
    `insert into public.contacts_orgs (workspace_id, name, roles) values ($1, $2, $3) returning id`, [ws, name, roles])).id
  ids.client = await org('manager', ARAK, 'Nour Towers (test)', ['client'])
  ids.consultant = await org('manager', ARAK, 'Design Office (test)', ['consultant'])
  ids.archived = await org('manager', ARAK, 'Gone Co (test)', ['client'])
  await as('manager', `update public.contacts_orgs set status = 'archived' where id = $1`, [ids.archived])
  ids.gclient = await org('ghusn', GHUSN, 'Ghusn client (test)', ['client'])
})

describe('company separation', () => {
  it('each company sees only its own opportunities and lists', async () => {
    const a = await addLead('worker')
    const g = await addLead('ghusn', { ws: GHUSN, stage: ids.gs })
    const arakSees = (await as('viewer', 'select id from public.crm_leads')).rows.map(r => r.id)
    expect(arakSees).toContain(a.id)
    expect(arakSees).not.toContain(g.id)
    expect((await as('ghusn', 'select id from public.crm_leads')).rows.map(r => r.id)).toEqual([g.id])
    expect((await as('ghusn', 'select id from public.crm_stages')).rows.map(r => r.id)).toEqual([ids.gs])
    expect((await as('admin', 'select id from public.crm_leads')).rows.map(r => r.id)).toEqual(expect.arrayContaining([a.id, g.id]))
  })

  it('nobody writes into a company they do not hold', async () => {
    expect(await refusal('ghusn', `insert into public.crm_leads (workspace_id, title, organization, stage_id) values ($1, 'x', 'o', $2)`, [ARAK, ids.s1])).not.toBeNull()
    const a = await addLead('worker')
    await as('ghusn', `update public.crm_leads set title = 'hijack' where id = $1`, [a.id])
    await as('ghusn', `delete from public.crm_leads where id = $1`, [a.id])
    expect((await one('worker', 'select title from public.crm_leads where id = $1', [a.id])).title).toBe('Villa lighting (test)')
  })

  it('no row points at another company\'s stage, client, tag or opportunity', async () => {
    // Ghusn's own opportunity on Arak's stage / client: the composite keys refuse.
    expect(await refusal('ghusn', `insert into public.crm_leads (workspace_id, title, organization, stage_id) values ($1, 'x', 'o', $2)`, [GHUSN, ids.s1])).toBeTruthy()
    expect(await refusal('ghusn', `insert into public.crm_leads (workspace_id, title, stage_id, client_org_id) values ($1, 'x', $2, $3)`, [GHUSN, ids.gs, ids.client])).toBeTruthy()
    // The admin holds both companies, and still cannot cross them.
    const g = await addLead('ghusn', { ws: GHUSN, stage: ids.gs })
    expect(await refusal('admin', `insert into public.crm_lead_tags (workspace_id, lead_id, tag_id) values ($1, $2, $3)`, [GHUSN, g.id, ids.t1])).toBeTruthy()
    expect(await refusal('admin', `insert into public.crm_activities (workspace_id, lead_id, activity_type, summary, due_date, assigned_to)
      values ($1, $2, 'call', 'x', current_date, $3)`, [ARAK, g.id, U.admin])).toBeTruthy()
    expect(await refusal('admin', `update public.crm_leads set workspace_id = $1 where id = $2`, [ARAK, g.id])).toBeTruthy()
  })
})

describe('the levels', () => {
  it('a member without the CRM sees nothing and writes nothing', async () => {
    expect((await as('outsider', 'select id from public.crm_leads')).rows).toEqual([])
    expect((await as('outsider', 'select id from public.crm_stages')).rows).toEqual([])
    // Refused (a BEFORE trigger runs before RLS's check, and cannot see the stage either).
    expect(await refusal('outsider', `insert into public.crm_leads (workspace_id, title, organization, stage_id) values ($1, 'x', 'o', $2)`, [ARAK, ids.s1])).toBeTruthy()
    expect((await as('outsider', 'select * from public.crm_people($1)', [ARAK])).rows).toEqual([])
    expect((await as('outsider', 'select * from public.crm_clients($1)', [ARAK])).rows).toEqual([])
  })

  it('view reads but does not write', async () => {
    const a = await addLead('worker')
    expect((await as('viewer', 'select id from public.crm_leads where id = $1', [a.id])).rows).toHaveLength(1)
    expect(await refusal('viewer', `insert into public.crm_leads (workspace_id, title, organization, stage_id) values ($1, 'x', 'o', $2)`, [ARAK, ids.s1])).toMatch(/row-level security/)
    await as('viewer', `update public.crm_leads set title = 'changed' where id = $1`, [a.id])
    expect((await one('worker', 'select title from public.crm_leads where id = $1', [a.id])).title).not.toBe('changed')
    expect(await refusal('viewer', `insert into public.crm_activities (workspace_id, lead_id, activity_type, summary, due_date, assigned_to)
      values ($1, $2, 'call', 'x', current_date, $3)`, [ARAK, a.id, U.worker])).toMatch(/row-level security/)
    // The pickers read for view.
    expect((await as('viewer', 'select name from public.crm_people($1)', [ARAK])).rows.map(r => r.name).sort()).toEqual(['Faisal', 'Nasser', 'Omar', 'Sara'])
    expect((await as('viewer', 'select name from public.crm_clients($1)', [ARAK])).rows.length).toBe(3)
  })

  it('work does the day-to-day but not the settings; the history is for managers', async () => {
    expect(await refusal('worker', `insert into public.crm_stages (workspace_id, name) values ($1, 'Mine')`, [ARAK])).toMatch(/row-level security/)
    await as('worker', `update public.crm_stages set name = 'renamed' where id = $1`, [ids.s1])
    expect((await one('manager', 'select name from public.crm_stages where id = $1', [ids.s1])).name).toBe('جديدة')
    const a = await addLead('worker')
    expect((await as('worker', 'select id from public.crm_history where lead_id = $1', [a.id])).rows).toEqual([])
    expect((await as('manager', 'select id from public.crm_history where lead_id = $1', [a.id])).rows.length).toBeGreaterThan(0)
    expect(await refusal('manager', `insert into public.crm_history (workspace_id, lead_id, action) values ($1, $2, 'insert')`, [ARAK, a.id])).toBeTruthy()
    expect(await refusal('worker', `select * from public.crm_counters`)).toBeTruthy()
  })

  it('the lists are switched off, never deleted', async () => {
    expect(await refusal('manager', 'delete from public.crm_stages where id = $1', [ids.s2])).toBeTruthy()
  })
})

describe('the opportunity: numbering, someone, lists, assignee', () => {
  it('numbers L-<year>-000001 per company, gap-free, and keeps the number and the creator', async () => {
    const y = new Date(Date.now() + 3 * 3_600_000).getUTCFullYear()
    const before = (await one('admin', `select max(lead_no) as n from public.crm_leads where workspace_id = $1`, [GHUSN])).n
    // A refused insert gives its number back.
    expect(await refusal('ghusn', `insert into public.crm_leads (workspace_id, title, stage_id) values ($1, 'nobody', $2)`, [GHUSN, ids.gs])).toMatch(/crm_leads_someone/)
    const g = await addLead('ghusn', { ws: GHUSN, stage: ids.gs })
    const n = Number(before.split('-')[2]) + 1
    expect(g.lead_no).toBe(`L-${y}-${String(n).padStart(6, '0')}`)
    expect(g.created_by).toBe(U.ghusn)
    await as('ghusn', `update public.crm_leads set lead_no = 'L-1999-000001', created_by = $2 where id = $1`, [g.id, U.admin])
    expect(await one('ghusn', 'select lead_no, created_by from public.crm_leads where id = $1', [g.id])).toEqual({ lead_no: g.lead_no, created_by: U.ghusn })
  })

  it('needs a title and someone to talk to; trims, and starts open', async () => {
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, organization, stage_id) values ($1, '  ', 'o', $2)`, [ARAK, ids.s1])).toMatch(/crm_leads_title_check/)
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, stage_id, status) values ($1, 'x', $2, 'won')`, [ARAK, ids.s1])).toBe('CRM_LEAD_TRANSITION')
    const a = await one('worker', `insert into public.crm_leads (workspace_id, title, contact_name, email, stage_id) values ($1, ' Spaced ', ' Sara ', ' A@B.CO ', $2) returning title, contact_name, email`, [ARAK, ids.s1])
    expect(a).toEqual({ title: 'Spaced', contact_name: 'Sara', email: 'a@b.co' })
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, contact_name, email, stage_id) values ($1, 'x', 's', 'nope', $2)`, [ARAK, ids.s1])).toMatch(/crm_leads_email_check/)
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, contact_name, probability, stage_id) values ($1, 'x', 's', 101, $2)`, [ARAK, ids.s1])).toMatch(/probability/)
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, contact_name, expected_revenue, stage_id) values ($1, 'x', 's', -1, $2)`, [ARAK, ids.s1])).toMatch(/expected_revenue/)
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, contact_name, priority, stage_id) values ($1, 'x', 's', 4, $2)`, [ARAK, ids.s1])).toMatch(/priority/)
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, contact_name, phone, stage_id) values ($1, 'x', 's', $3, $2)`, [ARAK, ids.s1, '1'.repeat(31)])).toMatch(/phone/)
  })

  it('takes only an active stage, source, tag; a kept one stays', async () => {
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, organization, stage_id) values ($1, 'x', 'o', $2)`, [ARAK, ids.sOff])).toBe('CRM_STAGE_INACTIVE')
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, organization, stage_id, source_id) values ($1, 'x', 'o', $2, $3)`, [ARAK, ids.s1, ids.srcOff])).toBe('CRM_SOURCE_INACTIVE')
    const a = await addLead('worker')
    expect(await refusal('worker', `update public.crm_leads set stage_id = $2 where id = $1`, [a.id, ids.sOff])).toBe('CRM_STAGE_INACTIVE')
    expect(await refusal('worker', `insert into public.crm_lead_tags (workspace_id, lead_id, tag_id) values ($1, $2, $3)`, [ARAK, a.id, ids.tOff])).toBe('CRM_TAG_INACTIVE')
    await as('worker', `select public.crm_set_tags($1, $2, $3)`, [ARAK, a.id, [ids.t1]])
    expect((await as('worker', 'select tag_id from public.crm_lead_tags where lead_id = $1', [a.id])).rows).toEqual([{ tag_id: ids.t1 }])
    // A stage switched off while an opportunity sits in it: the opportunity keeps it and can still change other things.
    await as('worker', `update public.crm_leads set stage_id = $2 where id = $1`, [a.id, ids.s2])
    await as('manager', `update public.crm_stages set is_active = false where id = $1`, [ids.s2])
    await as('worker', `update public.crm_leads set title = 'Still editable (test)' where id = $1`, [a.id])
    expect((await one('worker', 'select stage_id, title from public.crm_leads where id = $1', [a.id]))).toEqual({ stage_id: ids.s2, title: 'Still editable (test)' })
    await as('manager', `update public.crm_stages set is_active = true where id = $1`, [ids.s2])
  })

  it('is given only to someone with the CRM in this company', async () => {
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, organization, stage_id, assigned_to) values ($1, 'x', 'o', $2, $3)`, [ARAK, ids.s1, U.outsider])).toBe('CRM_ASSIGNEE')
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, organization, stage_id, assigned_to) values ($1, 'x', 'o', $2, $3)`, [ARAK, ids.s1, U.ghusn])).toBe('CRM_ASSIGNEE')
    expect((await addLead('worker', { assignee: U.viewer })).id).toBeTruthy()
    expect((await addLead('worker', { assignee: U.admin })).id).toBeTruthy()
  })
})

describe('the client (Contacts)', () => {
  it('refuses an archived client, and makes a linked organisation a client', async () => {
    expect(await refusal('worker', `insert into public.crm_leads (workspace_id, title, stage_id, client_org_id) values ($1, 'x', $2, $3)`, [ARAK, ids.s1, ids.archived])).toBe('CRM_CLIENT_ARCHIVED')
    const a = await addLead('worker')
    await as('worker', `update public.crm_leads set client_org_id = $2 where id = $1`, [a.id, ids.consultant])
    expect((await one('manager', 'select roles from public.contacts_orgs where id = $1', [ids.consultant])).roles).toEqual(['client', 'consultant'])
    // Contacts' delete is refused while an opportunity points at it.
    expect(await refusal('manager', 'delete from public.contacts_orgs where id = $1', [ids.consultant])).toMatch(/crm_leads_client_fk/)
  })
})

describe('won, lost, reopen', () => {
  it('won needs a client, is stamped, and is final', async () => {
    const a = await addLead('worker')
    expect(await refusal('worker', `update public.crm_leads set status = 'won' where id = $1`, [a.id])).toBe('CRM_WON_NEEDS_CLIENT')
    await as('worker', `update public.crm_leads set client_org_id = $2 where id = $1`, [a.id, ids.client])
    await as('worker', `update public.crm_leads set status = 'won' where id = $1`, [a.id])
    const won = await one('worker', 'select status, closed_at, closed_by from public.crm_leads where id = $1', [a.id])
    expect(won.status).toBe('won')
    expect(won.closed_at).toBeTruthy()
    expect(won.closed_by).toBe(U.worker)
    expect(await refusal('worker', `update public.crm_leads set title = 'later' where id = $1`, [a.id])).toBe('CRM_LEAD_WON')
    expect(await refusal('worker', `update public.crm_leads set status = 'open' where id = $1`, [a.id])).toBe('CRM_LEAD_WON')
    expect(await refusal('worker', 'delete from public.crm_leads where id = $1', [a.id])).toBe('CRM_LEAD_DELETE')
    expect(await refusal('worker', `insert into public.crm_lead_tags (workspace_id, lead_id, tag_id) values ($1, $2, $3)`, [ARAK, a.id, ids.t1])).toBe('CRM_LEAD_CLOSED')
  })

  it('lost needs an active reason, changes only by reopening, and reopening clears the loss', async () => {
    const a = await addLead('worker')
    await as('worker', `select public.crm_set_tags($1, $2, $3)`, [ARAK, a.id, [ids.t1]])
    expect(await refusal('worker', `update public.crm_leads set status = 'lost' where id = $1`, [a.id])).toBe('CRM_LOST_NEEDS_REASON')
    expect(await refusal('worker', `update public.crm_leads set status = 'lost', lost_reason_id = $2 where id = $1`, [a.id, ids.rOff])).toBe('CRM_REASON_INACTIVE')
    expect(await refusal('worker', `update public.crm_leads set lost_note = 'x' where id = $1`, [a.id])).toMatch(/crm_leads_lost_note/)
    await as('worker', `update public.crm_leads set status = 'lost', lost_reason_id = $2, lost_note = 'Too dear' where id = $1`, [a.id, ids.r1])
    expect(await refusal('worker', `update public.crm_leads set title = 'later' where id = $1`, [a.id])).toBe('CRM_LEAD_LOST')
    expect(await refusal('worker', `update public.crm_leads set status = 'won' where id = $1`, [a.id])).toBe('CRM_LEAD_LOST')
    expect(await refusal('worker', `delete from public.crm_lead_tags where lead_id = $1`, [a.id])).toBe('CRM_LEAD_CLOSED')
    await as('worker', `update public.crm_leads set status = 'open' where id = $1`, [a.id])
    expect(await one('worker', 'select status, lost_reason_id, lost_note, closed_at, closed_by from public.crm_leads where id = $1', [a.id]))
      .toEqual({ status: 'open', lost_reason_id: null, lost_note: null, closed_at: null, closed_by: null })
  })
})

describe('activities', () => {
  it('are planned only on an open opportunity, for someone with the CRM; done is history', async () => {
    const a = await addLead('worker')
    const ins = `insert into public.crm_activities (workspace_id, lead_id, activity_type, summary, due_date, assigned_to) values ($1, $2, $3, $4, current_date, $5) returning id`
    expect(await refusal('worker', ins, [ARAK, a.id, 'call', 'x', U.outsider])).toBe('CRM_ASSIGNEE')
    expect(await refusal('worker', ins, [ARAK, a.id, 'fax', 'x', U.worker])).toMatch(/activity_type/)
    expect(await refusal('worker', ins, [ARAK, a.id, 'call', ' ', U.worker])).toMatch(/summary/)
    const planned = await one('worker', ins, [ARAK, a.id, 'call', 'Call back (test)', U.worker])
    const done = await one('worker', ins, [ARAK, a.id, 'meeting', 'Meet (test)', U.viewer])
    expect(await refusal('worker', `update public.crm_activities set outcome = 'x' where id = $1`, [planned.id])).toMatch(/crm_activities_outcome/)
    await as('worker', `update public.crm_activities set done_at = '2000-01-01', done_by = $2, outcome = ' Agreed ' where id = $1`, [done.id, U.admin])
    const d = await one('worker', 'select done_at, done_by, outcome from public.crm_activities where id = $1', [done.id])
    expect(d.done_by).toBe(U.worker)
    expect(new Date(d.done_at).getUTCFullYear()).toBeGreaterThan(2000)
    expect(d.outcome).toBe('Agreed')
    expect(await refusal('worker', `update public.crm_activities set summary = 'rewrite' where id = $1`, [done.id])).toBe('CRM_ACTIVITY_DONE')
    expect(await refusal('worker', 'delete from public.crm_activities where id = $1', [done.id])).toBe('CRM_ACTIVITY_DONE')
    // With a done activity the opportunity can no longer be deleted.
    expect(await refusal('worker', 'delete from public.crm_leads where id = $1', [a.id])).toBe('CRM_LEAD_DELETE')
    // Closed: nothing new, but a planned one can still be marked done.
    await as('worker', `update public.crm_leads set status = 'lost', lost_reason_id = $2 where id = $1`, [a.id, ids.r1])
    expect(await refusal('worker', ins, [ARAK, a.id, 'task', 'More (test)', U.worker])).toBe('CRM_LEAD_CLOSED')
    await as('worker', `update public.crm_activities set done_at = now() where id = $1`, [planned.id])
    expect((await one('worker', 'select done_at from public.crm_activities where id = $1', [planned.id])).done_at).toBeTruthy()
  })

  it('an open opportunity without done activities is deleted with its planned ones and tags', async () => {
    const a = await addLead('worker')
    await as('worker', `select public.crm_set_tags($1, $2, $3)`, [ARAK, a.id, [ids.t1]])
    await as('worker', `insert into public.crm_activities (workspace_id, lead_id, activity_type, summary, due_date, assigned_to) values ($1, $2, 'call', 'x', current_date, $3)`, [ARAK, a.id, U.worker])
    await as('worker', 'delete from public.crm_leads where id = $1', [a.id])
    expect((await as('admin', 'select count(*)::int as n from public.crm_activities where lead_id = $1', [a.id])).rows[0].n).toBe(0)
    expect((await as('admin', 'select count(*)::int as n from public.crm_lead_tags where lead_id = $1', [a.id])).rows[0].n).toBe(0)
    // Its history stays.
    expect((await as('manager', `select action from public.crm_history where lead_id = $1 and activity_id is null order by id`, [a.id])).rows.map(r => r.action)).toEqual(['insert', 'delete'])
  })
})

describe('the history', () => {
  it('records who changed which field, old and new', async () => {
    const a = await addLead('worker')
    await as('worker', `update public.crm_leads set stage_id = $2, probability = 40 where id = $1`, [a.id, ids.s2])
    const rows = (await as('manager', `select action, changes, actor from public.crm_history where lead_id = $1 and action = 'update'`, [a.id])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].actor).toBe(U.worker)
    expect(rows[0].changes).toEqual({ stage_id: [ids.s1, ids.s2], probability: [null, 40] })
  })
})

describe('settings', () => {
  it('names are unique per list and company; one stage per automatic event', async () => {
    expect(await refusal('manager', `insert into public.crm_sources (workspace_id, name) values ($1, ' Exhibition ')`, [ARAK])).toMatch(/crm_sources_name_uq/)
    expect((await one('ghusn', `insert into public.crm_sources (workspace_id, name) values ($1, 'Exhibition') returning id`, [GHUSN])).id).toBeTruthy()
    await as('manager', `update public.crm_stages set auto_event = 'pricing' where id = $1`, [ids.s1])
    expect(await refusal('manager', `update public.crm_stages set auto_event = 'pricing' where id = $1`, [ids.s2])).toMatch(/crm_stages_event_uq/)
    expect(await refusal('manager', `update public.crm_tags set color = 8 where id = $1`, [ids.t1])).toMatch(/color/)
  })

  it('suggests the five starting stages once, managers only', async () => {
    const ws = '00000000-0000-0000-0000-000000000003'
    await pg.exec(`insert into public.workspaces values ('${ws}', 'Third (test)'); insert into public.workspace_members values ('${ws}', '${U.admin}');`)
    expect(await refusal('worker', 'select public.crm_suggest_stages($1)', [ws])).toBe('CRM_NEEDS_MANAGE')
    expect((await one('admin', 'select public.crm_suggest_stages($1) as n', [ws])).n).toBe(5)
    expect((await as('admin', 'select name_en from public.crm_stages where workspace_id = $1 order by sequence', [ws])).rows.map(r => r.name_en))
      .toEqual(['New', 'Qualified', 'Site visit and design', 'Quotation sent', 'Negotiation'])
    expect(await refusal('admin', 'select public.crm_suggest_stages($1)', [ws])).toBe('CRM_STAGES_EXIST')
  })

  it('moves an open opportunity on a quotation-cycle event (for the modules to come)', async () => {
    await as('manager', `update public.crm_stages set auto_event = 'technical' where id = $1`, [ids.s2])
    const a = await addLead('worker')
    expect((await one('worker', `select public.crm_auto_stage($1, 'technical') as s`, [a.id])).s).toBe('تفاوض')
    expect((await one('worker', 'select stage_id from public.crm_leads where id = $1', [a.id])).stage_id).toBe(ids.s2)
    expect((await one('worker', `select public.crm_auto_stage($1, 'revision') as s`, [a.id])).s).toBeNull()
  })
})

describe('deleting a company', () => {
  it('takes its whole CRM with it, closed opportunities and done activities included', async () => {
    const ws = '00000000-0000-0000-0000-000000000004'
    await pg.exec(`insert into public.workspaces values ('${ws}', 'Doomed (test)'); insert into public.workspace_members values ('${ws}', '${U.admin}');`)
    const s = (await pg.query(`insert into public.crm_stages (workspace_id, name) values ($1, 'S') returning id`, [ws])).rows[0].id
    const r = (await pg.query(`insert into public.crm_lost_reasons (workspace_id, name) values ($1, 'R') returning id`, [ws])).rows[0].id
    const l = (await pg.query(`insert into public.crm_leads (workspace_id, title, organization, stage_id) values ($1, 'x', 'o', $2) returning id`, [ws, s])).rows[0].id
    await pg.query(`insert into public.crm_activities (workspace_id, lead_id, activity_type, summary, due_date, assigned_to) values ($1, $2, 'call', 'x', current_date, $3)`, [ws, l, U.admin])
    await pg.query(`update public.crm_activities set done_at = now() where lead_id = $1`, [l])
    await pg.query(`update public.crm_leads set status = 'lost', lost_reason_id = $2 where id = $1`, [l, r])
    await pg.query('delete from public.workspaces where id = $1', [ws])
    expect((await pg.query('select count(*)::int as n from public.crm_leads where workspace_id = $1', [ws])).rows[0].n).toBe(0)
    expect((await pg.query('select count(*)::int as n from public.crm_history where workspace_id = $1', [ws])).rows[0].n).toBe(0)
  })
})
