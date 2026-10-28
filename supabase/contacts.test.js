import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { describe, it, expect, beforeAll } from 'vitest'

// ─── Contacts: the database's rules, as each kind of person ────────────────
// 2026-10-28. Runs the two Contacts migrations on an in-process Postgres and
// acts as different people (SET ROLE authenticated + a test uid, so RLS
// applies as it does through the API):
//
//   · company separation: nobody reads or writes another company's rows,
//     and a person cannot be hung on another company's organisation;
//   · the levels: view reads, work adds and edits, manage archives,
//     deletes and imports;
//   · the rules: VAT format, the duplicate guard, the national address,
//     archived = locked, one primary contact.
//
// The section helpers below are the ones Contacts leans on, as defined in
// 20261101_section_access (has_section, section_rank) and the baseline
// (is_workspace_member, is_access_admin). dev/v2db/check-contacts.mjs asks
// the same questions of the real local stack with real logins.

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
create table public.user_access (user_id uuid primary key, role text not null, status text not null default 'approved');
create table public.section_access (workspace_id uuid, user_id uuid, section text, level text, primary key (workspace_id, user_id, section));

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
  outsider: '00000000-0000-0000-0000-0000000000b4', // an Arak member with no Contacts grant
  ghusn: '00000000-0000-0000-0000-0000000000c1', // manages Contacts in Ghusn only
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

/** The CONTACTS_… code (or the Postgres message) a refused statement gives. */
async function refusal(who, sql, params = []) {
  try {
    await as(who, sql, params)
    return null
  } catch (err) {
    return { code: err.message, detail: err.detail || '' }
  }
}

const ORG_COLS = 'workspace_id, name, roles, vat_number, cr_number, kind, nat_building_no, nat_street, nat_district, city, nat_postal_code'

async function addOrg(who, ws, name, extra = {}) {
  const f = { roles: [], vat: null, cr: null, kind: 'company', addr: [null, null, null, null, null], ...extra }
  const { rows } = await as(who, `insert into public.contacts_orgs (${ORG_COLS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [ws, name, f.roles, f.vat, f.cr, f.kind, ...f.addr])
  return rows[0].id
}

const FULL_ADDRESS = ['2457', 'King Fahd Road', 'Al Olaya', 'Riyadh', '12214']

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(PRELUDE)
  await pg.exec(`
    insert into public.workspaces values ('${ARAK}', 'Arak'), ('${GHUSN}', 'Ghusn');
    insert into auth.users (id) select unnest(array['${Object.values(U).join("','")}']::uuid[]);
    insert into public.user_access values ('${U.admin}', 'admin'), ('${U.viewer}', 'member'), ('${U.worker}', 'member'),
      ('${U.manager}', 'member'), ('${U.outsider}', 'member'), ('${U.ghusn}', 'member');
    insert into public.workspace_members values ('${ARAK}', '${U.admin}'), ('${GHUSN}', '${U.admin}'), ('${ARAK}', '${U.viewer}'),
      ('${ARAK}', '${U.worker}'), ('${ARAK}', '${U.manager}'), ('${ARAK}', '${U.outsider}'), ('${GHUSN}', '${U.ghusn}');
    insert into public.section_access values ('${ARAK}', '${U.viewer}', 'contacts', 'view'), ('${ARAK}', '${U.worker}', 'contacts', 'work'),
      ('${ARAK}', '${U.manager}', 'contacts', 'manage'), ('${ARAK}', '${U.outsider}', 'marketing', 'manage'),
      ('${GHUSN}', '${U.ghusn}', 'contacts', 'manage');
  `)
  const files = ['20261120_contacts_1_tables', '20261120_contacts_2_rules', '20261120_contacts_3_musa_parity']
  for (const f of files) await pg.exec(migration(f))
  // Every file is safe to re-run.
  for (const f of files) await pg.exec(migration(f))
})

describe('company separation', () => {
  it('each company sees only its own organisations and people', async () => {
    const a = await addOrg('worker', ARAK, 'Separation Arak (test)')
    const g = await addOrg('ghusn', GHUSN, 'Separation Ghusn (test)')
    const arakSees = (await as('manager', 'select id from public.contacts_orgs')).rows.map(r => r.id)
    expect(arakSees).toContain(a)
    expect(arakSees).not.toContain(g)
    expect((await as('ghusn', 'select id from public.contacts_orgs')).rows.map(r => r.id)).toEqual([g])
    // The admin is a member of both and sees both.
    expect((await as('admin', 'select id from public.contacts_orgs')).rows.map(r => r.id)).toEqual(expect.arrayContaining([a, g]))
  })

  it('nobody writes into a company they do not hold', async () => {
    expect(await refusal('ghusn', `insert into public.contacts_orgs (workspace_id, name) values ($1, 'Intruder (test)')`, [ARAK])).not.toBeNull()
    const a = await addOrg('worker', ARAK, 'Untouchable (test)')
    const r = await as('ghusn', `update public.contacts_orgs set notes = 'x' where id = $1 returning id`, [a])
    expect(r.rows).toEqual([])
  })

  it('a person cannot belong to another company\'s organisation, and a row never moves company', async () => {
    const g = await addOrg('ghusn', GHUSN, 'Ghusn org (test)')
    expect(await refusal('admin', `insert into public.contacts_people (workspace_id, org_id, name) values ($1, $2, 'Crossed (test)')`, [ARAK, g])).not.toBeNull()
    const a = await addOrg('admin', ARAK, 'Mover (test)')
    expect((await refusal('admin', `update public.contacts_orgs set workspace_id = $1 where id = $2`, [GHUSN, a])).code).toBe('CONTACTS_WORKSPACE_FIXED')
  })
})

describe('levels', () => {
  it('no grant: nothing is read or written, even as a company member', async () => {
    await addOrg('worker', ARAK, 'Hidden (test)')
    expect((await as('outsider', 'select id from public.contacts_orgs')).rows).toEqual([])
    expect(await refusal('outsider', `insert into public.contacts_orgs (workspace_id, name) values ($1, 'No (test)')`, [ARAK])).not.toBeNull()
  })

  it('view reads but does not add or edit', async () => {
    const a = await addOrg('worker', ARAK, 'Viewable (test)')
    expect((await as('viewer', 'select id from public.contacts_orgs where id = $1', [a])).rows).toHaveLength(1)
    expect(await refusal('viewer', `insert into public.contacts_orgs (workspace_id, name) values ($1, 'No (test)')`, [ARAK])).not.toBeNull()
    expect((await as('viewer', `update public.contacts_orgs set notes = 'x' where id = $1 returning id`, [a])).rows).toEqual([])
  })

  it('work adds and edits, but does not archive, delete or import', async () => {
    const a = await addOrg('worker', ARAK, 'Workable (test)')
    expect((await as('worker', `update public.contacts_orgs set notes = 'edited' where id = $1 returning notes`, [a])).rows[0].notes).toBe('edited')
    expect((await refusal('worker', `update public.contacts_orgs set status = 'archived' where id = $1`, [a])).code).toBe('CONTACTS_NEEDS_MANAGE')
    expect((await as('worker', 'delete from public.contacts_orgs where id = $1 returning id', [a])).rows).toEqual([])
    expect((await refusal('worker', `select * from public.contacts_import_orgs($1, '[]'::jsonb)`, [ARAK])).code).toBe('CONTACTS_NEEDS_MANAGE')
    const p = (await as('worker', `insert into public.contacts_people (workspace_id, org_id, name) values ($1, $2, 'Worker adds (test)') returning id`, [ARAK, a])).rows[0].id
    expect((await as('worker', 'delete from public.contacts_people where id = $1 returning id', [p])).rows).toEqual([])
  })

  it('manage archives and restores, stamping who and when', async () => {
    const a = await addOrg('worker', ARAK, 'Archivable (test)')
    const r = (await as('manager', `update public.contacts_orgs set status = 'archived' where id = $1 returning archived_at, archived_by`, [a])).rows[0]
    expect(r.archived_at).not.toBeNull()
    expect(r.archived_by).toBe(U.manager)
    const back = (await as('manager', `update public.contacts_orgs set status = 'active' where id = $1 returning archived_at`, [a])).rows[0]
    expect(back.archived_at).toBeNull()
  })

  it('manage deletes an organisation nobody uses; its contact persons go with it (his cascade)', async () => {
    const lone = await addOrg('worker', ARAK, 'Deletable (test)')
    expect((await as('manager', 'delete from public.contacts_orgs where id = $1 returning id', [lone])).rows).toHaveLength(1)
    const withPeople = await addOrg('worker', ARAK, 'With people (test)')
    await as('worker', `insert into public.contacts_people (workspace_id, org_id, name) values ($1, $2, 'Goes with it (test)')`, [ARAK, withPeople])
    expect((await as('manager', 'delete from public.contacts_orgs where id = $1 returning id', [withPeople])).rows).toHaveLength(1)
    expect((await as('manager', 'select id from public.contacts_people where org_id = $1', [withPeople])).rows).toEqual([])
  })
})

describe('rules', () => {
  it('tidies text and keeps roles once, in a fixed order', async () => {
    const id = await addOrg('worker', ARAK, '  Tidy Co (test)  ', { roles: ['supplier', 'client', 'supplier'], cr: '  ', kind: 'individual' })
    const r = (await as('worker', 'select name, roles, cr_number, created_by from public.contacts_orgs where id = $1', [id])).rows[0]
    expect(r).toEqual({ name: 'Tidy Co (test)', roles: ['client', 'supplier'], cr_number: null, created_by: U.worker })
  })

  it('refuses an unknown role and a VAT number that is not 15 digits', async () => {
    expect(await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, roles) values ($1, 'Bad role (test)', '{reseller}')`, [ARAK])).not.toBeNull()
    expect(await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, vat_number) values ($1, 'Short VAT (test)', '30012345')`, [ARAK])).not.toBeNull()
    // Spaces are taken out first.
    const id = await addOrg('worker', ARAK, 'Spaced VAT (test)', { vat: '300 000 000 000 993' })
    expect((await as('worker', 'select vat_number from public.contacts_orgs where id = $1', [id])).rows[0].vat_number).toBe('300000000000993')
  })

  it('one organisation per VAT number and CR in a company, naming the other one', async () => {
    await addOrg('worker', ARAK, 'First holder (test)', { vat: '300000000000003', cr: '1010123456' })
    const vat = await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, vat_number) values ($1, 'Second (test)', '300000000000003')`, [ARAK])
    expect(vat).toEqual({ code: 'CONTACTS_DUPLICATE_VAT', detail: 'First holder (test)' })
    const cr = await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, cr_number) values ($1, 'Third (test)', '1010123456')`, [ARAK])
    expect(cr.code).toBe('CONTACTS_DUPLICATE_CR')
    // Another company may hold the same numbers.
    await expect(addOrg('ghusn', GHUSN, 'Same VAT elsewhere (test)', { vat: '300000000000003' })).resolves.toBeTruthy()
  })

  it('a client company with a VAT number needs its national address; others do not', async () => {
    const r = await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, roles, vat_number, city) values ($1, 'No address (test)', '{client}', '300000000000011', 'Riyadh')`, [ARAK])
    expect(r).toEqual({ code: 'CONTACTS_ADDRESS_REQUIRED', detail: 'nat_building_no,nat_street,nat_district,nat_postal_code' })
    await expect(addOrg('worker', ARAK, 'Supplier no address (test)', { roles: ['supplier'], vat: '300000000000029' })).resolves.toBeTruthy()
    await expect(addOrg('worker', ARAK, 'Client full address (test)', { roles: ['client'], vat: '300000000000037', addr: FULL_ADDRESS })).resolves.toBeTruthy()
  })

  it('an archived organisation is locked until restored, and nobody is added to it', async () => {
    const a = await addOrg('worker', ARAK, 'Locked (test)')
    const p = (await as('worker', `insert into public.contacts_people (workspace_id, org_id, name) values ($1, $2, 'Inside (test)') returning id`, [ARAK, a])).rows[0].id
    await as('manager', `update public.contacts_orgs set status = 'archived' where id = $1`, [a])
    expect((await refusal('manager', `update public.contacts_orgs set notes = 'x' where id = $1`, [a])).code).toBe('CONTACTS_ARCHIVED')
    expect((await refusal('worker', `insert into public.contacts_people (workspace_id, org_id, name) values ($1, $2, 'Late (test)')`, [ARAK, a])).code).toBe('CONTACTS_ARCHIVED')
    expect((await refusal('worker', `update public.contacts_people set phone = '0500000000' where id = $1`, [p])).code).toBe('CONTACTS_ARCHIVED')
    expect((await refusal('worker', `update public.contacts_people set org_id = null where id = $1`, [p])).code).toBe('CONTACTS_ARCHIVED')
    expect((await as('worker', 'select public.contacts_org_is_active($1) as ok', [a])).rows[0].ok).toBe(false)
  })

  it('one primary contact per organisation: the newest takes the flag', async () => {
    const a = await addOrg('worker', ARAK, 'Primary (test)')
    const add = name => as('worker', `insert into public.contacts_people (workspace_id, org_id, name, is_primary) values ($1, $2, $3, true) returning id`, [ARAK, a, name])
    const first = (await add('First (test)')).rows[0].id
    const second = (await add('Second (test)')).rows[0].id
    const flags = (await as('worker', 'select id, is_primary from public.contacts_people where org_id = $1 order by created_at, name', [a])).rows
    expect(flags.find(r => r.id === first).is_primary).toBe(false)
    expect(flags.find(r => r.id === second).is_primary).toBe(true)
    // A person on their own is never primary.
    const lone = (await as('worker', `insert into public.contacts_people (workspace_id, name, is_primary) values ($1, 'Alone (test)', true) returning is_primary`, [ARAK])).rows[0]
    expect(lone.is_primary).toBe(false)
  })

  it('import: manage only, row by row, refused rows reported by line', async () => {
    const items = [
      { name: 'Imported one (test)', roles: ['supplier'], city: 'Jeddah' },
      { name: 'Imported dup (test)', vat_number: '300000000000003' },
      { name: '', roles: [] },
      { name: 'Imported two (test)', roles: ['consultant', 'client'], kind: 'individual' },
    ]
    const out = (await as('manager', 'select * from public.contacts_import_orgs($1, $2::jsonb)', [ARAK, JSON.stringify(items)])).rows
    expect(out.map(r => [r.line_no, Boolean(r.org_id), r.error_code])).toEqual([
      [1, true, null],
      [2, false, 'CONTACTS_DUPLICATE_VAT'],
      [3, false, expect.stringContaining('check constraint')],
      [4, true, null],
    ])
    const two = (await as('manager', `select roles from public.contacts_orgs where name = 'Imported two (test)'`)).rows[0]
    expect(two.roles).toEqual(['client', 'consultant'])
  })
})

describe('the rest of his clients and suppliers', () => {
  it('every record gets a number, per company and year, that never changes', async () => {
    const y = new Date().getFullYear()
    const a = await addOrg('worker', ARAK, 'Numbered one (test)')
    const b = await addOrg('worker', ARAK, 'Numbered two (test)')
    const g = await addOrg('ghusn', GHUSN, 'Numbered Ghusn (test)')
    const no = async id => (await as('admin', 'select contact_no from public.contacts_orgs where id = $1', [id])).rows[0].contact_no
    const [na, nb, ng] = [await no(a), await no(b), await no(g)]
    expect(na).toMatch(new RegExp(`^C-${y}-\\d{6}$`))
    expect(Number(nb.slice(-6))).toBe(Number(na.slice(-6)) + 1)
    expect(ng.startsWith(`C-${y}-`)).toBe(true)
    await as('worker', `update public.contacts_orgs set contact_no = 'C-1999-000001', notes = 'x' where id = $1`, [a])
    expect(await no(a)).toBe(na)
  })

  it('supplier categories: named by managers, read by everyone with access, switched off rather than deleted', async () => {
    const add = (who, name) => as(who, `insert into public.contacts_categories (workspace_id, name, name_en) values ($1, $2, 'Lighting units') returning id`, [ARAK, name])
    expect(await refusal('worker', `insert into public.contacts_categories (workspace_id, name) values ($1, 'No (test)')`, [ARAK])).not.toBeNull()
    const cat = (await add('manager', 'وحدات إنارة')).rows[0].id
    expect(await refusal('manager', `insert into public.contacts_categories (workspace_id, name) values ($1, ' وحدات إنارة ')`, [ARAK])).not.toBeNull()
    expect((await as('viewer', 'select id from public.contacts_categories where id = $1', [cat])).rows).toHaveLength(1)
    expect((await as('ghusn', 'select id from public.contacts_categories where id = $1', [cat])).rows).toEqual([])
    expect((await as('manager', 'delete from public.contacts_categories where id = $1 returning id', [cat]).catch(() => ({ rows: [] }))).rows).toEqual([])

    const s = (await as('worker', `insert into public.contacts_orgs (workspace_id, name, roles, category_id) values ($1, 'Categorised (test)', '{supplier}', $2) returning id`, [ARAK, cat])).rows[0].id
    // Another company cannot use this company's category.
    expect(await refusal('ghusn', `insert into public.contacts_orgs (workspace_id, name, category_id) values ($1, 'Borrowed (test)', $2)`, [GHUSN, cat])).not.toBeNull()
    // Switched off: kept where it is, not given anew.
    await as('manager', 'update public.contacts_categories set is_active = false where id = $1', [cat])
    await expect(as('worker', `update public.contacts_orgs set notes = 'still here' where id = $1`, [s])).resolves.toBeTruthy()
    expect((await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, category_id) values ($1, 'Late (test)', $2)`, [ARAK, cat])).code).toBe('CONTACTS_CATEGORY_INACTIVE')
  })

  it('IBAN: Saudi shape in the Kingdom, any country\'s shape outside it; SWIFT and payment terms have a shape too', async () => {
    const ins = (name, country, iban, swift = null, terms = null) => as('worker',
      'insert into public.contacts_orgs (workspace_id, name, country, iban, swift, payment_terms_days) values ($1, $2, $3, $4, $5, $6) returning iban, swift',
      [ARAK, name, country, iban, swift, terms])
    expect((await ins('Saudi bank (test)', 'SA', 'sa03 8000 0000 6080 1016 7519')).rows[0].iban).toBe('SA0380000000608010167519')
    expect(await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, country, iban) values ($1, 'Foreign IBAN in SA (test)', 'SA', 'IT60X0542811101000000123456')`, [ARAK])).not.toBeNull()
    expect((await ins('Italian bank (test)', 'IT', 'IT60X0542811101000000123456', 'bcitit mm')).rows[0]).toEqual({ iban: 'IT60X0542811101000000123456', swift: 'BCITITMM' })
    expect(await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, swift) values ($1, 'Bad SWIFT (test)', 'BC1')`, [ARAK])).not.toBeNull()
    expect(await refusal('worker', `insert into public.contacts_orgs (workspace_id, name, payment_terms_days) values ($1, 'Bad terms (test)', 4000)`, [ARAK])).not.toBeNull()
  })

  it('the activity log: who did what, field by field, kept after a delete, read by managers only', async () => {
    const a = await addOrg('worker', ARAK, 'Logged (test)')
    await as('worker', `update public.contacts_orgs set city = 'Riyadh', notes = 'n' where id = $1`, [a])
    await as('worker', `update public.contacts_orgs set city = 'Riyadh' where id = $1`, [a]) // no change: no row
    await as('worker', `insert into public.contacts_people (workspace_id, org_id, name) values ($1, $2, 'Logged person (test)')`, [ARAK, a])
    await as('manager', 'delete from public.contacts_orgs where id = $1', [a])
    const log = (await as('manager', 'select action, label, changes, actor, person_id is not null as person from public.contacts_activity where org_id = $1 order by id', [a])).rows
    expect(log.map(r => [r.action, r.person])).toEqual([['insert', false], ['update', false], ['insert', true], ['delete', false], ['delete', true]])
    expect(log[1].changes).toEqual({ city: [null, 'Riyadh'], notes: ['', 'n'] })
    expect(log[1].actor).toBe(U.worker)
    expect(log[3].actor).toBe(U.manager)
    expect(log[3].label).toBe('Logged (test)')
    expect((await as('worker', 'select id from public.contacts_activity where org_id = $1', [a])).rows).toEqual([])
    expect(await refusal('manager', `insert into public.contacts_activity (workspace_id, action) values ($1, 'insert')`, [ARAK])).not.toBeNull()
  })

  it('the import takes the new fields', async () => {
    const out = (await as('manager', 'select * from public.contacts_import_orgs($1, $2::jsonb)', [ARAK, JSON.stringify([
      { name: 'Imported bank (test)', roles: ['supplier'], country: 'IT', iban: 'IT60X0542811101000000123456', payment_terms_days: '60', address: 'Via Roma 1, Milano' },
      { name: 'Imported bad terms (test)', payment_terms_days: 'sixty' },
    ])])).rows
    expect(out.map(r => Boolean(r.org_id))).toEqual([true, false])
    const r = (await as('manager', 'select payment_terms_days, address, contact_no from public.contacts_orgs where id = $1', [out[0].org_id])).rows[0]
    expect(r).toMatchObject({ payment_terms_days: 60, address: 'Via Roma 1, Milano' })
    expect(r.contact_no).toMatch(/^C-\d{4}-\d{6}$/)
  })
})
