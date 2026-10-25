// ─── Read production's rows into local JSON files (2026-10-25) ─────────────
// READ ONLY: every request is a GET (PostgREST with the service key, and the
// auth admin API for the people). Nothing is written to production.
//
//   node dev/v2db/prod-copy/export.mjs <main checkout .env> <out dir> <tables file>
//
// The secret tables are skipped: mailbox passwords and the lead agent's key
// never leave production. The auth admin API returns no password hashes, so
// load.mjs gives every person the local password.

import fs from 'node:fs'

const [envPath, out, tablesFile] = process.argv.slice(2)
const env = Object.fromEntries(fs.readFileSync(envPath, 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]))
const base = env.VITE_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) throw new Error(`${envPath} has no VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`)
if (/127\.0\.0\.1|localhost/.test(base)) throw new Error('That .env points at a local database, not production.')

export const SKIPPED = ['email_mailbox_secrets', 'lead_mailbox_secrets', 'lead_agent_secrets']
const headers = { apikey: key, Authorization: `Bearer ${key}` }
const tables = fs.readFileSync(tablesFile, 'utf8').trim().split(/\s+/).filter((t) => !SKIPPED.includes(t))
fs.mkdirSync(out, { recursive: true })

const counts = {}
for (const t of tables) {
  const rows = []
  // PostgREST caps a read at 1,000 rows: page through.
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${base}/rest/v1/${t}?select=*`, { method: 'GET', headers: { ...headers, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } })
    if (!r.ok) throw new Error(`${t}: ${r.status} ${(await r.text()).slice(0, 200)}`)
    const page = await r.json()
    rows.push(...page)
    if (page.length < 1000) break
  }
  fs.writeFileSync(`${out}/${t}.json`, JSON.stringify(rows))
  counts[t] = rows.length
}

const users = []
for (let page = 1; ; page++) {
  const r = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=200`, { method: 'GET', headers })
  if (!r.ok) throw new Error(`auth users: ${r.status}`)
  const { users: batch = [] } = await r.json()
  users.push(...batch)
  if (batch.length < 200) break
}
fs.writeFileSync(`${out}/_auth_users.json`, JSON.stringify(users))
fs.writeFileSync(`${out}/_counts.json`, JSON.stringify(counts))
console.log(`read ${Object.keys(counts).length} tables, ${Object.values(counts).reduce((a, b) => a + b, 0)} rows, ${users.length} people`)
