import { callerId, callerMayUseWorkspace, db, isConfigured } from './_supabase.js'
import { callModel } from './_provider.js'
import { loadBrandContext, IDENTITY } from './_context.js'
import { discover } from './_gather.js'
import { textIn } from '../../src/lib/agent/loop.js'
import {
  scoreCandidate, resolutionFor, queriesFor, SUGGEST_AT,
  CANDIDATES_SCHEMA, candidateToAccount,
} from '../../src/lib/agent/resolve.js'

// ─── POST /api/agent/resolve ───────────────────────────────────────────────
// Find Instagram handles for the competitors that do not have one.
//
// Body: { workspace_id, force? }
//
// Two halves, deliberately split:
//
//   Finding candidates is a SEARCH problem, so a model does it with web
//   search. Judging them is not — that is arithmetic in
//   src/lib/agent/resolve.js, so it answers the same way twice and a wrong
//   answer names the signal that misled it.
//
// Without Meta credentials this still works and is still useful: candidates
// land as `unresolved` with a score and reasons, which is exactly the state
// the watchlist UI lets a person accept or correct. It just cannot promote
// anything to `resolved`, because a handle that was found but not verified
// must never be snapshotted.

const MAX_CANDIDATES = 6

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  if (!isConfigured) return res.status(500).json({ error: 'Supabase is not configured on this deployment.' })

  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ error: 'Body must be JSON.' }) }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required.' })

  if (!(await callerId(req))) return res.status(401).json({ error: 'Sign in to resolve handles.' })
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    return res.status(403).json({ error: 'You do not have access to this workspace.' })
  }

  const canVerify = Boolean(process.env.META_IG_TOKEN && process.env.META_IG_USER_ID)

  try {
    // Never re-resolve over a person's correction. `human_set` is the whole
    // reason that status exists — a discovery pass overwriting a hand-typed
    // handle is the single most annoying thing this feature could do.
    const rows = await db(
      `research_agenda?workspace_id=eq.${workspaceId}&kind=eq.competitor` +
      `&status=neq.retired&select=id,subject,why,ig_handle,ig_status`,
    )
    const targets = (rows || []).filter(r =>
      r.ig_status !== 'human_set' &&
      (body.force ? true : r.ig_status !== 'resolved'),
    )

    if (!targets.length) {
      return res.status(200).json({
        ok: true, checked: 0,
        note: 'Every competitor already has a verified or hand-set handle.',
      })
    }

    // The Brand Brain's competitor directory carries websites, and a matching
    // domain is the single strongest signal in the scorer — worth the one
    // extra read.
    const { directory } = await loadBrandContext(workspaceId, 'research')
    const websiteFor = {}
    for (const list of Object.values(directory?.rowsBySection || {})) {
      for (const row of list) {
        const data = row.data || {}
        const name = data.name || data.company || data.title || ''
        const site = data.website || data.url || data.site || ''
        if (name && site) websiteFor[String(name).toLowerCase()] = site
      }
    }

    const results = []
    let cost = 0

    for (const target of targets) {
      const competitor = {
        name: target.subject,
        website: websiteFor[String(target.subject).toLowerCase()] || '',
      }

      // ── Find candidates (a model, with web search) ──
      // Structured output, so the model hands over what it SAW — display name,
      // bio, any bio link, follower count. Those are exactly the signals
      // scoreCandidate weighs, and a bare handle string carries none of them.
      // The prose-and-regex version of this scored one candidate out of four
      // at 0.25, below the bar to store anything, because the scorer had
      // nothing to read.
      const search = await callModel({
        workspaceId, job: 'extract', surface: 'resolve', stage: 'resolve',
        identity: IDENTITY,
        brand: 'You are finding the official Instagram account for one company.',
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2 }],
        messages: [{
          role: 'user',
          content: [
            `Find the official Instagram account for this company:`,
            `Name: ${competitor.name}`,
            competitor.website ? `Website: ${competitor.website}` : '',
            target.why ? `Context: ${target.why}` : '',
            '',
            `Try searches like: ${queriesFor(competitor).join(' / ')}`,
            '',
            'For every plausible account, record what the page actually showed you —',
            'the display name, the bio, any link in the bio, and the follower count.',
            'Those details decide whether it is really them, so do not omit one you saw.',
            'Omit a field rather than guessing it.',
            'Returning no candidates at all is a correct answer. Never invent a handle.',
          ].filter(Boolean).join('\n'),
        }],
        maxTokens: 3_000, effort: 'low',
        outputFormat: CANDIDATES_SCHEMA,
      })
      cost += search.cost || 0

      if (search.refused) {
        return res.status(200).json({ ok: false, error: search.error, checked: 0 })
      }

      let reported = []
      if (search.ok) {
        try {
          reported = JSON.parse(textIn(search.response))?.candidates || []
        } catch {
          // A brief that will not parse is a failed candidate list, not a
          // failed run — this competitor simply keeps whatever it had.
          reported = []
        }
      }
      const candidates = reported.slice(0, MAX_CANDIDATES)

      // ── Score them (arithmetic) ──
      let best = { handle: '', score: 0, reasons: [], verified: false }
      for (const candidate of candidates) {
        let account = candidateToAccount(candidate)
        if (!account.username) continue
        let verified = false

        if (canVerify) {
          const got = await discover(account.username)
          // A handle that does not exist, is personal, or is private answers
          // with an error. That is a rejected candidate, never a failed run —
          // most guesses SHOULD come back like this. Instagram's own answer
          // beats the model's reading of a page when we can get it.
          if (got.ok) { account = got.acct; verified = true } else { continue }
        }

        const { score, reasons } = scoreCandidate(competitor, account)
        if (score > best.score) {
          best = { handle: account.username, score, reasons, verified }
        }
      }

      const resolution = resolutionFor(best)
      await db(`research_agenda?id=eq.${target.id}&workspace_id=eq.${workspaceId}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        body: {
          ig_handle: best.score >= SUGGEST_AT ? best.handle : '',
          ig_confidence: best.score || null,
          ...resolution,
        },
      })

      results.push({
        competitor: competitor.name,
        handle: best.score >= SUGGEST_AT ? best.handle : '',
        score: best.score,
        status: resolution.ig_status,
        why: best.reasons,
        candidates_seen: candidates.length,
      })
    }

    return res.status(200).json({
      ok: true,
      checked: results.length,
      resolved: results.filter(r => r.status === 'resolved').length,
      suggested: results.filter(r => r.status === 'unresolved').length,
      not_found: results.filter(r => r.status === 'not_found').length,
      results,
      cost_usd: Number(cost.toFixed(4)),
      note: canVerify
        ? ''
        : 'META_IG_TOKEN is not set, so nothing could be verified against Instagram. ' +
          'Candidates are stored as suggestions for you to confirm — a handle that was ' +
          'found but not verified is never measured.',
    })
  } catch (err) {
    console.error('[agent/resolve]', err)
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 400) })
  }
}
