import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { callerId, callerMayUseWorkspace, db, isConfigured } from '../../api/agent/_supabase.js'
import { callModel } from '../../api/agent/_provider.js'
import { textIn } from '../../src/lib/agent/loop.js'
import { modelFor } from '../../src/lib/agent/models.js'
import { searchConfig } from '../../src/lib/agent/searchConsole.js'
import {
  aiQuestions, answerPrompt, ANSWER_IDENTITY, scoreAnswer, answerSources, checkSummary,
  SEARCHES_PER_ANSWER,
} from '../../src/lib/agent/aiAnswers.js'

// ─── POST /api/agent/aiAnswers ─────────────────────────────────────────────
// Ask the brand's buyer questions through a model with web search, the way an
// AI assistant would answer them, and record whether the company was named,
// whether its site was cited, and who was named instead.
//
// Body: { workspace_id }
//
// On a BUTTON, never on mount and never on a schedule nobody chose: each
// question is a paid model call with up to SEARCHES_PER_ANSWER web searches,
// about five to ten cents, so a full list of twenty is one to two dollars.
// The workspace's monthly cap is checked before every call by callModel, on
// the same ledger as everything else; a check that hits the cap stops there
// and keeps the answers it already paid for.
//
// One engine for now: Claude, through the app's own key and ledger. ChatGPT is
// the assistant that actually sends arak-sa.com visits, and it can be added as
// a second engine once it has a key of its own. The leads agent's OpenRouter
// key is not borrowed for this, because it is that agent's budget.

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/** Questions in flight at once. Enough to finish twenty well inside n8n's timeout. */
const CONCURRENCY = 4

async function mapLimit(items, limit, run) {
  const out = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await run(items[i], i)
    }
  }))
  return out
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'POST only.' })
  if (!isConfigured) return res.status(500).json({ ok: false, error: 'Supabase is not configured on this deployment.' })

  let body
  try {
    body = await readBody(req)
  } catch {
    return res.status(400).json({ ok: false, error: 'Body must be JSON.' })
  }

  const workspaceId = String(body.workspace_id || '').trim()
  if (!workspaceId) return res.status(400).json({ ok: false, error: 'workspace_id is required.' })

  const userId = await callerId(req)
  if (!userId) return res.status(401).json({ ok: false, error: 'Sign in to read website analytics.' })
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    return res.status(403).json({ ok: false, error: 'You do not have access to this workspace.' })
  }

  try {
    const [profiles, agenda] = await Promise.all([
      db(`brand_profile?workspace_id=eq.${workspaceId}&select=custom_fields`),
      // Every rival the research agent tracks and nobody retired. Named here
      // only so an answer can be read for who was named INSTEAD of us.
      db(`research_agenda?workspace_id=eq.${workspaceId}&kind=eq.competitor&status=neq.retired&select=subject`)
        .catch(() => []),
    ])
    const customFields = profiles?.[0]?.custom_fields || {}
    const questions = aiQuestions(customFields.ai_questions)
    if (!questions.length) {
      return res.status(200).json({ ok: false, configured: false, error: 'No AI questions are set for this company yet.' })
    }
    const { site, brandTerms } = searchConfig({ customFields }, { brandName: customFields.brand_name || '' })
    const competitors = [...new Set((agenda || []).map(r => String(r.subject || '').trim()).filter(Boolean))]

    const runId = randomUUID()
    const checkedAt = new Date().toISOString()
    const model = modelFor('ai_check')
    let capped = false

    const rows = await mapLimit(questions, CONCURRENCY, async question => {
      const base = { workspace_id: workspaceId, run_id: runId, checked_at: checkedAt, engine: 'claude', model, question }
      // Once the cap has refused one call it will refuse the rest; asking
      // anyway only writes refusals into the ledger.
      if (capped) return { ...base, error: 'Not asked: this month\'s AI budget is used up.', cost_usd: 0 }
      const out = await callModel({
        workspaceId,
        job: 'ai_check',
        surface: 'chat',
        stage: 'ai-answers',
        identity: ANSWER_IDENTITY,
        brand: '',
        tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: SEARCHES_PER_ANSWER }],
        messages: [{ role: 'user', content: answerPrompt(question) }],
        maxTokens: 3_000,
        effort: 'low',
        estimateUsd: 0.1,
      })
      if (out.refused && out.budget && !out.budget.allowed) {
        capped = true
        return { ...base, error: out.error || 'This month\'s AI budget is used up.', cost_usd: 0 }
      }
      if (!out.ok) return { ...base, error: String(out.error || 'No answer.').slice(0, 300), cost_usd: out.cost || 0 }
      const answer = textIn(out.response)
      const { urls } = answerSources(out.response)
      const score = scoreAnswer({ text: answer, sources: urls, brandTerms, site, competitors })
      return {
        ...base,
        answer: answer.slice(0, 6_000),
        named: score.named,
        rank: score.rank,
        cited: score.cited,
        competitors: score.competitors,
        sources: score.sources,
        cost_usd: out.cost || 0,
      }
    })

    // Stored so the next check has something to be compared with. A failed
    // write does not throw the answers away: they were paid for, and the
    // panel can still show them; it says they were not saved.
    let stored = true
    let storeError = ''
    try {
      await db('ai_answer_checks', {
        method: 'POST',
        prefer: 'return=minimal',
        body: rows.map(r => ({
          workspace_id: r.workspace_id, run_id: r.run_id, checked_at: r.checked_at, engine: r.engine,
          model: r.model, question: r.question, answer: r.answer || '', named: !!r.named, rank: r.rank ?? null,
          cited: !!r.cited, competitors: r.competitors || [], sources: r.sources || [],
          cost_usd: r.cost_usd || 0, error: r.error || '',
        })),
      })
    } catch (err) {
      stored = false
      storeError = String(err?.message || err).slice(0, 300)
      console.error('[aiAnswers] could not store the check:', storeError)
    }

    return res.status(200).json({
      ok: true, runId, checkedAt, rows, summary: checkSummary(rows), capped, stored, storeError,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err).slice(0, 300) })
  }
}
