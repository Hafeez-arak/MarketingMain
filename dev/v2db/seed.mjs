#!/usr/bin/env node
// ─── Made-up people and data for the LOCAL v2 database ─────────────────────
// 2026-10-19. Run after apply-migrations.sh:
//
//   node dev/v2db/seed.mjs
//
// Talks only to the local stack (http://127.0.0.1:54321) with the Supabase
// CLI's standard local demo service key, and refuses any other address.
// Every name, company and email here is invented (the repo is public, and v2
// never copies production data). Safe to re-run: people are found or made,
// rows are upserted by fixed ids.
//
// Logins (all with the password below), one per kind of person:
//   owner@arak.test          access admin: every section
//   ceo@arak.test            CEO manage; Sales, Marketing, Insights view
//   salesmanager@arak.test   Sales manage; CEO view
//   marketing@arak.test      Marketing and Insights work
//   rep.omar@arak.test       sales seat (the sales team's own app)
//   rep.lina@arak.test       sales seat

const URL = process.env.V2DB_URL || 'http://127.0.0.1:54321'
const KEY = process.env.V2DB_SERVICE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
export const PASSWORD = 'arak-v2-local'
const WS = '00000000-0000-0000-0000-000000000001'

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(URL)) {
  console.error(`Refusing to seed ${URL}: the v2 seed only ever runs against the local database.`)
  process.exit(1)
}

const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, { method, headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}
// PostgREST takes a batch whose rows have different keys only when the
// columns are named (?columns=) and missing=default says what an absent key
// means: the column's default, not null (several columns are NOT NULL with
// a default, which an explicit null would break).
const upsert = (table, rows, onConflict) => {
  const columns = [...new Set(rows.flatMap(r => Object.keys(r)))].join(',')
  const q = [onConflict && `on_conflict=${onConflict}`, `columns=${columns}`].filter(Boolean).join('&')
  return rest(`${table}?${q}`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,missing=default,return=minimal' })
}

async function person(email, fullName) {
  const list = await fetch(`${URL}/auth/v1/admin/users?per_page=200`, { headers: H }).then(r => r.json())
  const found = (list.users || []).find(u => u.email === email)
  if (found) return found.id
  const r = await fetch(`${URL}/auth/v1/admin/users`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: fullName } }),
  })
  const u = await r.json()
  if (!r.ok) throw new Error(`create ${email}: ${JSON.stringify(u).slice(0, 200)}`)
  return u.id
}

const DAY = 86_400_000
const ago = (h) => new Date(Date.now() - h * 3_600_000).toISOString()
const day = (d) => new Date(Date.now() + d * DAY).toISOString().slice(0, 10)
const id = (n, prefix = 'a0000000') => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`

async function main() {
  // ── The company ──
  await upsert('workspaces', [{ id: WS, name: 'Arak Lighting (test)', slug: 'arak-test', ceo_brief_enabled: true }], 'id')

  // ── People ──
  const people = {
    owner: await person('owner@arak.test', 'Owner (test)'),
    ceo: await person('ceo@arak.test', 'CEO (test)'),
    salesmanager: await person('salesmanager@arak.test', 'Sami Salesmanager'),
    marketing: await person('marketing@arak.test', 'Mira Marketing'),
    omar: await person('rep.omar@arak.test', 'Omar Rep'),
    lina: await person('rep.lina@arak.test', 'Lina Rep'),
  }
  const access = (uid, email, full_name, role, extra = {}) => ({ user_id: uid, email, full_name, status: 'approved', role, leads_approver: false, decided_at: new Date().toISOString(), ...extra })
  await upsert('user_access', [
    access(people.owner, 'owner@arak.test', 'Owner (test)', 'admin'),
    access(people.ceo, 'ceo@arak.test', 'CEO (test)', 'member'),
    access(people.salesmanager, 'salesmanager@arak.test', 'Sami Salesmanager', 'member'),
    access(people.marketing, 'marketing@arak.test', 'Mira Marketing', 'member'),
    access(people.omar, 'rep.omar@arak.test', 'Omar Rep', 'sales'),
    access(people.lina, 'rep.lina@arak.test', 'Lina Rep', 'sales', { leads_approver: false }),
  ], 'user_id')
  await upsert('workspace_members', ['owner', 'ceo', 'salesmanager', 'marketing'].map(k => ({ workspace_id: WS, user_id: people[k], role: 'editor' })), 'workspace_id,user_id')
  await upsert('sales_seats', [
    { workspace_id: WS, user_id: people.omar, all_website_leads: true },
    { workspace_id: WS, user_id: people.lina, all_website_leads: false },
  ], 'user_id,workspace_id')

  // ── Section grants (v2) ──
  const grant = (k, section, level) => ({ workspace_id: WS, user_id: people[k], section, level, granted_by: people.owner })
  await rest(`section_access?workspace_id=eq.${WS}`, { method: 'DELETE' })
  await upsert('section_access', [
    grant('ceo', 'ceo', 'manage'), grant('ceo', 'sales', 'view'), grant('ceo', 'marketing', 'view'), grant('ceo', 'insights', 'view'),
    grant('salesmanager', 'sales', 'manage'), grant('salesmanager', 'ceo', 'view'),
    grant('marketing', 'marketing', 'work'), grant('marketing', 'insights', 'work'),
  ], 'workspace_id,user_id,section')

  // ── Leads: invented enquiries over the last two weeks ──
  const L = [
    ['Falcon Interiors', 'contractor', 'qualified', 'email', 96, 'omar', { first_reply_at: ago(90) }, 'Downlights for a 12-floor office tower', 'Riyadh'],
    ['Desert Rose Hotels', 'developer_owner', 'qualified', 'website_form', 20, null, {}, 'Lobby chandeliers and facade lighting', 'Jeddah'],
    ['Nakheel Fit-Out', 'contractor', 'qualified', 'email', 9, 'lina', {}, 'Track lights for a showroom', 'Riyadh'],
    ['Al Waha Clinics', 'end_client', 'qualified', 'email', 50, 'lina', { first_reply_at: ago(46), quote_sent_at: ago(10), deal_value_sar: 380000 }, 'Clean-room luminaires for three clinics', 'Dammam'],
    ['Horizon Consultants', 'consultant', 'qualified', 'website_form', 6, null, {}, 'KNX controls for a villa compound', 'Riyadh'],
    ['Palm Tower Contracting', 'contractor', 'qualified', 'email', 140, 'omar', { first_reply_at: ago(130), quote_sent_at: ago(80), stage: 'quotation', stage_at: ago(80) }, 'Corridor and parking lighting', 'Riyadh'],
    ['Crescent Developments', 'developer_owner', 'qualified', 'email', 300, 'omar', { first_reply_at: ago(290), quote_sent_at: ago(250), stage: 'won', stage_at: ago(48), deal_value_sar: 920000 }, 'Mixed-use tower, phase 1', 'Riyadh'],
    ['Gulf Facility Services', 'facility_company', 'qualified', 'email', 200, 'lina', { stage: 'lost', stage_at: ago(30), lost_reason: 'price' }, 'Annual maintenance contract', 'Khobar'],
    ['Najd Schools Project', 'consultant', 'needs_review', 'email', 30, null, {}, 'Classroom lighting, details unclear', 'Qassim'],
    ['Bright Lamp Trading', 'trader', 'unqualified', 'email', 40, null, {}, 'Reseller offering cheap panels', ''],
    ['Job applicant', 'individual', 'unqualified', 'website_form', 70, null, {}, 'Looking for a job', ''],
    ['Red Sea Villas', 'developer_owner', 'qualified', 'website_form', 3, null, {}, 'Landscape and pool lighting for 40 villas', 'Jeddah'],
  ]
  await upsert('leads', L.map(([company, sender_type, verdict, source, h, owner, extra, summary, location], i) => ({
    id: id(i + 1, 'b0000000'), workspace_id: WS, source, source_ref: `test-${i + 1}`, received_at: ago(h),
    name: `${company.split(' ')[0]} contact`, company, email: `contact${i + 1}@${company.toLowerCase().replace(/[^a-z]/g, '')}.test`,
    phone: '+966 50 000 0000', subject: summary, message: `${summary}. Please send your best offer.`, summary,
    verdict, category: verdict === 'qualified' ? 'project_request' : 'other', confidence: 'high', reason: 'Made-up test lead.',
    sender_type, project_type: 'not_stated', request_type: 'requirement', criteria_version: 2, details: { location },
    assigned_to: owner ? people[owner] : null, assigned_at: owner ? ago(h - 1) : null,
    approved_at: extra.stage ? ago(h - 2) : null,
    ...extra,
  })), 'id')

  // ── Key accounts ──
  await upsert('sales_accounts', [
    ['Crescent Developments', 31_000_000, '2026-03-02', 4, 12_400_000, 'Sami', 1],
    ['Palm Tower Contracting', 18_500_000, '2026-08-21', 2, 3_100_000, 'Omar', 1],
    ['Gulf Hospitality Group', 9_200_000, '2025-12-14', 1, 900_000, '', 2],
    ['Najd Health Projects', 6_700_000, '2026-06-30', 0, 0, 'Lina', 2],
    ['Eastern Malls Co', 4_100_000, '2026-01-10', 1, 650_000, 'Omar', 3],
  ].map(([name, value_sar, last_order, open_deals, open_value_sar, owner, priority], i) => ({
    id: id(i + 1, 'c0000000'), workspace_id: WS, name, value_sar, last_order, open_deals, open_value_sar, owner, priority, status: 'new', source: 'test',
  })), 'id')

  // ── New projects from "research" ──
  await upsert('research_opportunities', [
    ['Riverside mixed-use tower', 'Example Real Estate', 'Riyadh', 'high', 2_400_000],
    ['Regional hospital expansion', 'Example Health Cluster', 'Eastern Province', 'medium', 1_100_000],
    ['Boulevard street lighting', 'Example Municipality', 'Jeddah', 'high', 3_000_000],
  ].map(([name, client, location, relevance, package_value_sar], i) => ({
    id: id(i + 1, 'd0000000'), workspace_id: WS, name, client, location, relevance, package_value_sar, status: 'new',
    source_url: `https://example.com/news/${i + 1}`, fingerprint: `test-${i + 1}`, first_seen_at: ago(24 * (i + 1)), last_seen_at: ago(24 * (i + 1)),
    suggested_action: 'Find the lighting consultant and ask for the schedule.',
  })), 'id')

  // ── Marketing: this month's plan, a few posts, the accounts ──
  const month = new Date().toISOString().slice(0, 7)
  await upsert('content_plans', [{ id: id(1, 'e0000000'), workspace_id: WS, name: 'This month (test)', month, status: 'active', kind: 'monthly' }], 'id')
  await upsert('plan_ideas', Array.from({ length: 8 }, (_, i) => ({
    id: id(i + 1, 'f0000000'), workspace_id: WS, plan_id: id(1, 'e0000000'), platform: i % 2 ? 'linkedin' : 'instagram',
    scheduled_date: day(i * 3 - 6), title: `Test idea ${i + 1}`, topic: 'Project showcase', status: 'approved', position: i,
  })), 'id')
  await upsert('generated_posts', Array.from({ length: 3 }, (_, i) => ({
    id: id(i + 1, 'f1000000'), workspace_id: WS, platform: i ? 'instagram' : 'linkedin', caption: `Test post ${i + 1}`,
    status: 'published', publish_status: 'published', published_at: ago(24 * (i + 2)), plan_id: id(1, 'e0000000'),
  })), 'id')
  await upsert('social_accounts', [
    { id: id(1, 'f2000000'), workspace_id: WS, zernio_account_id: 'test-li', platform: 'linkedin', username: 'arak-test', followers_count: 4900, is_active: true },
    { id: id(2, 'f2000000'), workspace_id: WS, zernio_account_id: 'test-ig', platform: 'instagram', username: 'arak.test', followers_count: 860, is_active: true },
  ], 'id')

  // ── CEO panel targets (the migration made the row if the company existed) ──
  await upsert('company_targets', [{
    workspace_id: WS, revenue_month_sar: 4_000_000, pipeline_sar: 10_000_000, quotes_week: 6,
    brief_emails: ['ceo@arak.test'], alert_emails: ['ceo@arak.test', 'salesmanager@arak.test'],
  }], 'workspace_id')

  console.log('Seeded the local v2 database. Logins (password %s):', PASSWORD)
  for (const k of Object.keys(people)) console.log('  %s', k)
}

main().catch(err => { console.error(err.message || err); process.exit(1) })
