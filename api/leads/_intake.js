import {
  toEnvelope, findDuplicate, openRouterRequest, parseVerdict, sheetColumns, parseTime, QUALIFIER_MODEL,
} from '../../src/lib/leads/qualify.js'
import { spentInMonth, capDecision } from '../../src/lib/agent/budget.js'

// ─── The lead agent's engine ───────────────────────────────────────────────
// Everything between "an enquiry arrived" and "the verdict is stored", for
// every source. The rules (masking, prompt, verdict) are in qualify.js; this
// file is the IO around them, with the database and the model passed in so
// _intake.test.js runs it without either.
//
//   deps.db(path, init)     PostgREST with the service key (api/agent/_supabase.js)
//   deps.model(body, ws)    one OpenRouter call with that company's key → { text, usage, error }
//   deps.now()              the clock
//
// A model call that fails stores the lead with `error` and NO verdict, and
// the Sheet gets no cells for it, so the next pass tries again. Nothing is
// retried inside a pass: one bad answer never re-bills a batch.

/** Rows one Sheet call may send. Twenty model calls fit easily in a function's time. */
export const MAX_ROWS_PER_CALL = 20

/** How far back a resend counts as a duplicate. */
const DUPLICATE_DAYS = 7

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))

/** Company name and what it sells, from the Brand Brain. */
export async function loadBrand(db, workspaceId) {
  const [[ws], [profile]] = await Promise.all([
    db(`workspaces?id=eq.${workspaceId}&select=name,agent_monthly_cap_usd`).then((r) => r || []),
    db(`brand_profile?workspace_id=eq.${workspaceId}&select=product_index`).then((r) => r || []),
  ])
  return {
    companyName: ws?.name || 'the company',
    offering: profile?.product_index || '',
    cap: ws?.agent_monthly_cap_usd ?? null,
  }
}

/** This month's agent spend for the company, the same ledger the cap reads. */
export async function monthSpent(db, workspaceId, now) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const rows = await db(`agent_usage?workspace_id=eq.${workspaceId}&created_at=gte.${start}&select=cost_usd,created_at`) || []
  return spentInMonth(rows, now)
}

const receivedIso = (s) => {
  const t = parseTime(s)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

/**
 * Ask the model about one enquiry. Records the call in agent_usage (so the
 * company's monthly cap counts it) whether it worked or not.
 */
export async function askModel(deps, { workspaceId, env, brand, surface = 'lead_qualifier' }) {
  const body = openRouterRequest(env, brand)
  const res = await deps.model(body, workspaceId)
  const usage = res.usage || {}
  const cost = Number(usage.cost) || 0
  await deps.db('agent_usage', {
    method: 'POST', prefer: 'return=minimal',
    body: {
      workspace_id: workspaceId, surface, model: body.model,
      tokens_in: usage.prompt_tokens || 0, tokens_out: usage.completion_tokens || 0,
      cost_usd: cost, error: res.error ? String(res.error).slice(0, 300) : '',
    },
  }).catch(() => {})
  if (res.error) return { error: String(res.error).slice(0, 300), cost, model: body.model }
  return { verdict: parseVerdict(res.text), cost, model: body.model }
}

/**
 * The website Sheet's script calls this every five minutes with the rows that
 * have no AI verdict yet. Returns the two cells to write for each row it
 * settled; rows it could not settle come back without cells and are sent
 * again next time.
 */
export async function intakeWebsite(deps, { key, rows = [] }) {
  if (!isUuid(key)) return { status: 401, error: 'This Sheet is not connected to the lead agent (bad key).' }
  const [settings] = await deps.db(`lead_agent_settings?intake_key=eq.${key}&select=workspace_id,enabled`) || []
  if (!settings) return { status: 401, error: 'This Sheet is not connected to the lead agent (unknown key).' }
  const workspaceId = settings.workspace_id
  const now = deps.now()
  await deps.db(`lead_agent_settings?workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { last_intake_at: now.toISOString() },
  })
  if (!settings.enabled) return { status: 200, off: true, results: [] }

  const batch = (Array.isArray(rows) ? rows : []).slice(0, MAX_ROWS_PER_CALL)
    .map((r) => ({ row: r.row, env: toEnvelope('website_form', r) }))
    .filter((x) => x.env.email || x.env.phone || x.env.message)
  // The Sheet calls every five minutes and waits at most a minute for the
  // answer, so the work fits a budget: website rows first, then the mailboxes
  // (deps.checkMail, the same five-minute heartbeat). Whatever does not fit
  // waits, unanswered, for the next round.
  const started = (deps.clock || Date.now)()
  const results = batch.length ? await qualifyRows(deps, { workspaceId, batch, now, started }) : []
  let mail = null
  if (deps.checkMail) {
    try { mail = await deps.checkMail({ workspaceId, deadline: started + TOTAL_BUDGET_MS }) } catch (err) { mail = { error: String(err.message || err).slice(0, 300) } }
  }
  return { status: 200, results, mail }
}

/** Time the website rows may take in one call, and the call as a whole. */
export const WEBSITE_BUDGET_MS = 30_000
export const TOTAL_BUDGET_MS = 45_000

async function qualifyRows(deps, { workspaceId, batch, now, started }) {
  const clock = deps.clock || Date.now
  // What we already know: the same rows from an earlier pass, and the last
  // week's leads for the duplicate check.
  const since = new Date(now.getTime() - (DUPLICATE_DAYS + 1) * 86_400_000).toISOString()
  const recent = await deps.db(`leads?workspace_id=eq.${workspaceId}&source=eq.website_form&or=(received_at.gte.${since},received_at.is.null)&select=id,source_ref,email,phone,message,received_at,verdict,category,reason,error,duplicate_of&order=received_at.asc&limit=1000`) || []
  const byRef = new Map(recent.map((l) => [l.source_ref, l]))
  const known = recent.map((l) => ({ id: l.id, sourceRef: l.source_ref, email: l.email, phone: l.phone, message: l.message, receivedAt: l.received_at }))

  let brand = null
  let spent = null
  const results = []

  for (const { row, env } of batch) {
    const stored = byRef.get(env.sourceRef)
    if (stored?.verdict) {
      // Already decided: hand back the same cells, spend nothing.
      results.push({ row, cells: stored.verdict === 'duplicate'
        ? ['duplicate', stored.reason]
        : sheetColumns({ verdict: stored.verdict, category: stored.category, reason: stored.reason }) })
      continue
    }

    const base = {
      workspace_id: workspaceId, source: 'website_form', source_ref: env.sourceRef,
      received_at: receivedIso(env.receivedAt), name: env.name, company: env.company, email: env.email,
      phone: env.phone, subject: env.subject, message: env.message, language: env.language,
      updated_at: now.toISOString(),
    }

    const dup = findDuplicate(env, known.filter((k) => k.sourceRef !== env.sourceRef), { days: DUPLICATE_DAYS })
    if (dup) {
      const cells = sheetColumns(null, { receivedAt: dup.receivedAt ? new Date(dup.receivedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'an earlier enquiry' })
      await upsertLead(deps.db, { ...base, verdict: 'duplicate', reason: cells[1], duplicate_of: isUuid(dup.id) ? dup.id : null, error: '' })
      results.push({ row, cells })
      continue
    }

    if (clock() - started > WEBSITE_BUDGET_MS) { results.push({ row, error: 'Waiting for the next round.' }); continue }
    brand ||= await loadBrand(deps.db, workspaceId)
    if (spent === null) spent = await monthSpent(deps.db, workspaceId, now)
    const cap = capDecision({ cap: brand.cap, spent, estimate: 0.001 })
    if (!cap.allowed) {
      const reason = 'Not checked: this month\'s AI budget is used up.'
      await upsertLead(deps.db, { ...base, verdict: 'needs_review', category: 'unclear', reason, error: 'cap' })
      results.push({ row, cells: ['needs review', reason] })
      continue
    }

    const out = await askModel(deps, { workspaceId, env, brand })
    spent += out.cost
    if (out.error) {
      await upsertLead(deps.db, { ...base, model: out.model, cost_usd: out.cost, error: out.error })
      results.push({ row, error: out.error })
      continue
    }
    const v = out.verdict
    const saved = await upsertLead(deps.db, {
      ...base, verdict: v.verdict, category: v.category, confidence: v.confidence, reason: v.reason,
      summary: v.summary, details: v.details, ask_next: v.ask_next, model: out.model, cost_usd: out.cost, error: '',
    })
    // Later rows in this same batch can be duplicates of this one.
    known.push({ id: saved?.id, sourceRef: env.sourceRef, email: env.email, phone: env.phone, message: env.message, receivedAt: base.received_at })
    results.push({ row, cells: sheetColumns(v) })
  }
  return results
}

export async function upsertLead(db, row) {
  const [saved] = await db('leads?on_conflict=workspace_id,source,source_ref', {
    method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: row,
  }) || []
  return saved || null
}

/**
 * The page's "Try it" box: any pasted enquiry or email, nothing stored. Still
 * recorded in agent_usage, because it is still spend.
 */
export async function tryIt(deps, { workspaceId, input = {} }) {
  const message = String(input.message || '').slice(0, 20_000)
  if (!message.trim()) return { status: 400, error: 'Paste an enquiry or an email to check.' }
  const env = toEnvelope('email', {
    sourceRef: 'test', receivedAt: '', name: input.name || '', company: input.company || '',
    email: input.email || '', phone: '', subject: input.subject || '', message,
    language: /\p{Script=Arabic}/u.test(message) ? 'ar' : 'en',
  })
  const brand = await loadBrand(deps.db, workspaceId)
  const spent = await monthSpent(deps.db, workspaceId, deps.now())
  if (!capDecision({ cap: brand.cap, spent, estimate: 0.001 }).allowed) return { status: 402, error: 'This month\'s AI budget is used up.' }
  const out = await askModel(deps, { workspaceId, env, brand, surface: 'lead_qualifier_test' })
  if (out.error) return { status: 502, error: `The model did not answer: ${out.error}` }
  return { status: 200, verdict: out.verdict, cost: out.cost, model: out.model }
}

export { QUALIFIER_MODEL }
