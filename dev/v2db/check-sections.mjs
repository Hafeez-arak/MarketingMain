#!/usr/bin/env node
// ─── Check the section rules in the database, signed in as each test login ──
// 2026-10-19. Signs in as every @arak.test person (seed.mjs) through the
// local API, exactly as the app does, and asks the database what each one
// may read and change. The expected answer is worked out from that person's
// grants and each table's sections (the same lists as the migrations), so a
// rule that lets too much through fails as loudly as one that blocks too much.
//
//   node dev/v2db/seed.mjs            (people, grants, rows)
//   node dev/v2db/check-sections.mjs  (exits 1 on any mismatch)
//
// Changes are checked with an update that writes a row's own value back, so
// nothing in the database changes. Local database only.

const URL = 'http://127.0.0.1:54321'
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const PASSWORD = 'arak-v2-local'

// Who has what (seed.mjs). Sales seats are not company members.
export const PEOPLE = {
  'owner@arak.test': { admin: true },
  'ceo@arak.test': { ceo: 'manage', sales: 'view', marketing: 'view', insights: 'view', technical: 'view', finance: 'view' },
  'salesmanager@arak.test': { sales: 'manage', ceo: 'view' },
  'marketing@arak.test': { marketing: 'work', insights: 'work' },
  'technical@arak.test': { technical: 'manage' },
  'pm.sara@arak.test': { technical: 'work' },
  'pm.khalid@arak.test': { technical: 'work' },
  'finance@arak.test': { finance: 'view' },
  'rep.omar@arak.test': { seat: true },
  'rep.lina@arak.test': { seat: true },
}

// table → [read sections, write sections, a column to write back, seats read it]
const TABLES = {
  brand_profile: ['marketing', 'marketing', 'mission'],
  content_plans: ['marketing', 'marketing', 'name'],
  plan_ideas: ['marketing,insights', 'marketing,insights', 'title'],
  generated_posts: ['marketing,insights', 'marketing', 'caption'],
  social_accounts: ['marketing,insights', 'marketing', 'username'],
  email_contacts: ['marketing', 'marketing', 'first_name'],
  research_runs: ['insights,marketing,sales', 'insights', 'stage', true],
  research_opportunities: ['insights,marketing,sales', 'insights,marketing,sales', 'name', true],
  research_signals: ['insights', 'insights', 'summary'],
  competitor_brands: ['insights', 'insights', 'note'],
}

const RANK = { view: 1, work: 2, manage: 3 }
const has = (p, secs, min) => p.admin || secs.split(',').some(s => (RANK[p[s]] || 0) >= RANK[min])

async function signIn(email) {
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`sign in ${email}: ${JSON.stringify(j).slice(0, 200)}`)
  return j.access_token
}

export async function asUser(token, path, { method = 'GET', body, prefer } = {}) {
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await r.text()
  return { ok: r.ok, status: r.status, rows: text ? (() => { try { return JSON.parse(text) } catch { return text } })() : null }
}

export async function tokens() {
  const out = {}
  for (const email of Object.keys(PEOPLE)) {
    try { out[email] = await signIn(email) } catch (err) { out[email] = null; console.log(`  (no login ${email}: run seed.mjs)`) }
  }
  return out
}

async function main() {
  const tok = await tokens()
  let bad = 0
  const line = []
  for (const [email, p] of Object.entries(PEOPLE)) {
    const t = tok[email]
    if (!t) continue
    const cells = []
    for (const [table, [rd, wr, col, seatsRead]] of Object.entries(TABLES)) {
      const read = await asUser(t, `${table}?select=id,${col}&limit=1`)
      const rows = Array.isArray(read.rows) ? read.rows : []
      const canRead = rows.length > 0
      const expectRead = p.seat ? Boolean(seatsRead) : has(p, rd, 'view')
      // Write: the row's own value written back. Unreadable rows are never
      // updatable, so a person who reads nothing writes nothing.
      let canWrite = false
      if (canRead) {
        const w = await asUser(t, `${table}?id=eq.${rows[0].id}`, { method: 'PATCH', body: { [col]: rows[0][col] }, prefer: 'return=representation' })
        canWrite = w.ok && Array.isArray(w.rows) && w.rows.length === 1
      }
      const expectWrite = !p.seat && has(p, wr, 'work')
      const ok = canRead === expectRead && canWrite === expectWrite
      if (!ok) bad++
      cells.push(`${ok ? '' : '✗'}${canRead ? 'R' : '-'}${canWrite ? 'W' : '-'}`)
    }
    line.push([email, cells])
  }
  const names = Object.keys(TABLES)
  console.log('R = can read, W = can change, ✗ = not what the grants say\n')
  names.forEach((n, i) => console.log(`  ${String(i + 1).padStart(2)} ${n}`))
  console.log(`\n${'person'.padEnd(26)}${names.map((_, i) => String(i + 1).padStart(5)).join('')}`)
  for (const [email, cells] of line) console.log(`${email.padEnd(26)}${cells.map(c => c.padStart(5)).join('')}`)
  bad += await projectsAndMoney(tok)
  console.log(bad ? `\n${bad} mismatches.` : '\nEvery answer matches the grants.')
  process.exitCode = bad ? 1 : 0
}

// ── Technical and Finance (20261105): the Odoo mirror by model, and a
// project manager's own projects only. Needs a mirror round first
// (dev/v2db/odoo-round.mjs); the fake Odoo's projects are 401–406, Sara
// manages 401/403/405 and Khalid 402/404/406.
const ALL = [401, 402, 403, 404, 405, 406]
const MINE = { 'pm.sara@arak.test': [401, 403, 405], 'pm.khalid@arak.test': [402, 404, 406] }
const TASKS = { 401: 1, 402: 2, 403: 1, 404: 2 }
// Milestones and files on each project (a file on task 802 belongs to 402).
const MILESTONES = { 401: 3, 402: 1, 403: 1 }
const FILES = { 401: 1, 402: 2 }
function expectFor(email, p) {
  const seesAll = p.admin || p.ceo || p.technical === 'manage'
  const own = seesAll ? ALL : (p.technical ? MINE[email] || [] : [])
  const projects = p.admin || p.ceo || p.finance ? ALL : own
  return {
    projects,
    tasks: own.reduce((s, id) => s + (TASKS[id] || 0), 0),
    milestones: own.reduce((s, id) => s + (MILESTONES[id] || 0), 0),
    files: own.reduce((s, id) => s + (FILES[id] || 0), 0),
    orders: p.admin || p.ceo || p.finance || p.sales ? 6 : 0,
    invoices: p.admin || p.ceo || p.finance ? 7 : 0,
    deals: p.admin || p.ceo || p.sales ? 5 : 0,
    flags: own.filter(id => id !== 406).length, // the archived project has no flag
    // May record a submittal on 403 (Sara's) / 402 (Khalid's)?
    write403: Boolean(p.admin || p.technical === 'manage' || (p.technical === 'work' && MINE[email]?.includes(403))),
    write402: Boolean(p.admin || p.technical === 'manage' || (p.technical === 'work' && MINE[email]?.includes(402))),
  }
}
async function projectsAndMoney(tok) {
  const WS = '00000000-0000-0000-0000-000000000001'
  let bad = 0
  console.log('\nTechnical and Finance: what each person reads in the Odoo mirror and may record.\n')
  const COLS = ['projects', 'tasks', 'milestones', 'files', 'orders', 'invoices', 'deals', 'flags', 'write403', 'write402']
  console.log(`${'person'.padEnd(26)}${['projects', 'tasks', 'milestones', 'files', 'orders', 'invoices', 'deals', 'flags', 'rec 403', 'rec 402'].map(s => s.padStart(11)).join('')}`)
  for (const [email, p] of Object.entries(PEOPLE)) {
    const t = tok[email]
    if (!t) continue
    const ids = model => asUser(t, `odoo_records?model=eq.${model}&select=odoo_id&order=odoo_id`).then(r => (Array.isArray(r.rows) ? r.rows.map(x => x.odoo_id) : []))
    const projects = await ids('project.project')
    const got = {
      projects,
      tasks: (await ids('project.task')).length,
      milestones: (await ids('project.milestone')).length,
      files: (await ids('ir.attachment')).length,
      orders: (await ids('sale.order')).length,
      invoices: (await ids('account.move')).length,
      deals: (await ids('crm.lead')).length,
      flags: (await asUser(t, 'project_flags?select=odoo_project_id').then(r => (Array.isArray(r.rows) ? r.rows : []))).length,
    }
    // A submittal written and removed again: the insert is the question.
    for (const pid of [403, 402]) {
      const me = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).sub
      const w = await asUser(t, 'project_submittals', { method: 'POST', prefer: 'return=representation', body: { workspace_id: WS, odoo_project_id: pid, title: `access check ${Date.now()}`, created_by: me } })
      got[`write${pid}`] = w.ok
      if (w.ok) await asUser(tok['owner@arak.test'], `project_submittals?id=eq.${w.rows[0].id}`, { method: 'DELETE' })
    }
    const want = expectFor(email, p)
    const cells = COLS.map(k => {
      const g = got[k], w = want[k]
      const ok = Array.isArray(w) ? JSON.stringify(g) === JSON.stringify(w) : g === w
      if (!ok) bad++
      const show = Array.isArray(g) ? (g.length === 6 ? 'all 6' : g.join(' ') || '-') : typeof g === 'boolean' ? (g ? 'yes' : 'no') : String(g)
      return `${ok ? '' : '✗'}${show}`
    })
    console.log(`${email.padEnd(26)}${cells.map(c => c.padStart(11)).join('')}`)
  }
  return bad
}

if (process.argv[1] && (await import('node:url')).fileURLToPath(import.meta.url) === process.argv[1]) await main()
