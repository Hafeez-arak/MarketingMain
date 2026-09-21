import { Buffer } from 'node:buffer'
import { callerId, callerMayUseWorkspace, isConfigured } from '../../api/agent/_supabase.js'
import { callModel } from '../../api/agent/_provider.js'
import { textIn } from '../../src/lib/agent/loop.js'
import {
  EXPLAIN_SCHEMA, EXPLAIN_IDENTITY, explainPrompt, parseExplain,
} from '../../src/lib/agent/websiteExplain.js'

// ─── POST /api/agent/websiteExplain ────────────────────────────────────────
// Three sentences about what the website's numbers mean. The only call on the
// Analytics page that costs money.
//
// Body: { workspace_id, facts, audience? }
//
// ── WHY THE BROWSER SENDS THE FACTS ──
//
// The obvious design is to send a workspace id and have the server re-read
// Search Console. It would be wrong here: the screen has ALREADY computed
// every one of these figures, and a second read would be twenty-two more
// Google calls, a few more seconds, and — because the two reads happen at
// different moments and round in different places — a real chance of a
// sentence that disagrees with the tile directly above it.
//
// So the client sends what it is showing, shrunk to a whitelist by
// explainFacts() before it leaves the browser. The trust question that raises
// is smaller than it looks: the caller is an authenticated member of the
// workspace, the facts are shown to a model and thrown away, nothing is
// written, and a member who wanted to feed themselves misleading numbers can
// already just read them wrong. What it does cost is the workspace's money,
// which is why the cap is checked — by callModel, on the same ledger as every
// other call in the app.
//
// ── WHY IT IS NOT GENERATED WITH THE PAGE ──
//
// Because then every visit to Analytics would spend money, most visits do not
// read it, and the same three sentences would be paid for again on every
// refresh. A button is honest about the cost and puts it where the value is.

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/** The largest facts object this will accept, in characters. explainFacts()
 *  produces about 4KB; a body ten times that is a caller sending the whole
 *  payload, and paying to have a model read it. */
const MAX_FACTS = 40_000

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'POST only.' })
  }
  if (!isConfigured) {
    return res.status(500).json({ ok: false, error: 'Supabase is not configured on this deployment.' })
  }

  let body
  try {
    body = await readBody(req)
  } catch {
    return res.status(400).json({ ok: false, error: 'Body must be JSON.' })
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) {
    return res.status(400).json({ ok: false, error: 'workspace_id is required.' })
  }

  const facts = body.facts
  if (!facts || typeof facts !== 'object') {
    return res.status(400).json({ ok: false, error: 'facts is required.' })
  }
  const serialised = JSON.stringify(facts)
  if (serialised.length > MAX_FACTS) {
    return res.status(400).json({ ok: false, error: 'facts is too large to explain.' })
  }

  const audience = body.audience === 'research' ? 'research' : 'analytics'

  const userId = await callerId(req)
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Sign in to read website analytics.' })
  }
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    return res.status(403).json({ ok: false, error: 'You do not have access to this workspace.' })
  }

  try {
    const out = await callModel({
      workspaceId,
      job: 'explain',
      surface: 'chat',
      stage: `website-explain:${audience}`,
      identity: EXPLAIN_IDENTITY,
      brand: 'You are explaining one company\'s own website performance to that company.',
      messages: [{ role: 'user', content: explainPrompt(facts, { audience }) }],
      // Three sentences need nothing like this much. The ceiling is here so a
      // model that decides to think at length still finishes rather than
      // being truncated into unparseable JSON — the failure mode structured
      // output turns into "could not read the explanation".
      maxTokens: 2_000,
      effort: 'low',
      outputFormat: EXPLAIN_SCHEMA,
    })

    // The cap, hit. Said in the answer rather than as an error, because a
    // workspace out of money is a thing to tell someone plainly — the rest of
    // the page still works and they should not be left wondering which part
    // broke.
    if (out.refused) {
      return res.status(200).json({ ok: false, capped: true, points: [], error: out.error, cost: 0 })
    }
    if (!out.ok) {
      return res.status(200).json({ ok: false, points: [], error: out.error || 'The explanation could not be generated.', cost: out.cost || 0 })
    }

    const parsed = parseExplain(textIn(out.response))
    return res.status(200).json({
      ok: parsed.ok,
      points: parsed.points,
      error: parsed.error,
      // Shown on the page. A feature that spends money says what it spent,
      // the same way every other model call in this app does.
      cost: out.cost || 0,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    return res.status(500).json({ ok: false, points: [], error: String(err?.message || err).slice(0, 300) })
  }
}
