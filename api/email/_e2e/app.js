import { freshDatabase } from './db.js'
import { createWorld, SUPABASE } from './world.js'

// ─── The whole email server, running against the fake world ────────────────
// Boots a fresh database, installs the world's fetch, sets the environment
// the server reads at import, and imports the REAL api/email/[action].js.
// Tests then call it exactly as Vercel would: by action name, with a
// person's token, n8n's cron secret, Microsoft's redirect, or the website's
// form post.

export const ENV = {
  SUPABASE_URL: SUPABASE,
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-e2e-tests-only',
  SUPABASE_ANON_KEY: 'anon-key',
  RESEND_API_KEY: 're_test',
  RESEND_WEBHOOK_SECRET: '',
  CRON_SECRET: 'cron-secret',
  MICROSOFT_CLIENT_ID: 'client-e2e',
  MICROSOFT_TENANT_ID: 'tenant-e2e',
  MICROSOFT_CLIENT_SECRET: 'secret-e2e',
  PUBLIC_APP_URL: 'https://app.test',
  // The real run waits 0–2 minutes before an email; tests cannot.
  EMAIL_COLD_NO_PAUSE: '1',
}

export const WS = '00000000-0000-0000-0000-00000000aaaa'
export const OTHER_WS = '00000000-0000-0000-0000-00000000bbbb'

export async function bootApp() {
  const pg = await freshDatabase()
  // Live has this column (the parked Google sign-in added it by hand); no
  // code on main reads it. Mirrored so the schema matches production.
  await pg.exec(`alter table public.email_mailboxes add column if not exists auth_method text not null default 'password'`)
  const world = createWorld(pg)
  globalThis.fetch = world.fetch
  Object.assign(process.env, ENV)
  const { default: handler } = await import('../[action].js')

  await pg.exec(`
    insert into public.workspaces (id, name) values ('${WS}', 'Arak'), ('${OTHER_WS}', 'Other company');
    insert into public.email_settings (workspace_id, from_name, from_email, reply_to, company_address)
      values ('${WS}', 'Arak Lighting', 'updates@email.arak-sa.com', 'marketing@arak-sa.com', 'ARAK Lighting, Riyadh');
  `)
  const owner = await world.user('hafeez@arak-sa.com')
  await pg.exec(`insert into public.workspace_members (workspace_id, user_id) values ('${WS}', '${owner.id}')`)

  /** One request to /api/email/<action>. */
  async function call(action, { method = 'POST', body, token = owner.token, headers = {}, query = {}, raw = false } = {}) {
    const res = {
      statusCode: 200, headers: {}, body: undefined,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this },
      status(c) { this.statusCode = c; return this },
      json(b) { this.body = b; return this },
      send(b) { this.body = b; return this },
      end(b) { if (b !== undefined) this.body = b; return this },
    }
    const req = {
      method, url: `/api/email/${action}?${new URLSearchParams(query)}`,
      query: { action, ...query },
      headers: { host: 'app.test', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: raw ? body : (method === 'POST' ? { workspace_id: WS, ...(body || {}) } : undefined),
    }
    await handler(req, res)
    return { status: res.statusCode, body: res.body, headers: res.headers }
  }

  /** What n8n does every 10 minutes. */
  const tick = () => call('cold-tick', { method: 'GET', token: 'cron-secret' })

  /** Sign in as a Microsoft mailbox, the way a person does from Settings. */
  async function connectMicrosoft(email, { mailboxId = null, otherOrg = false } = {}) {
    const start = await call('ms_connect_start', { body: mailboxId ? { mailbox_id: mailboxId } : { other_org: otherOrg } })
    if (start.status !== 200) return start
    const state = new URL(start.body.url).searchParams.get('state')
    const cookie = String(start.headers['set-cookie']).split(';')[0]
    const code = world.signInCode(email)
    return call('ms-callback', { method: 'GET', token: null, headers: { cookie }, query: { code, state } })
  }

  const q = async (sql, params) => (await pg.query(sql, params)).rows

  return { pg, world, call, tick, connectMicrosoft, owner, q }
}
