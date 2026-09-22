import { Buffer } from 'node:buffer'
import { callerId, callerMayUseWorkspace, db, isConfigured } from '../../api/agent/_supabase.js'
import { callModel } from '../../api/agent/_provider.js'
import { loadBrandContext, IDENTITY } from '../../api/agent/_context.js'
import { textIn } from '../../src/lib/agent/loop.js'
import {
  evidenceFor, evidenceInstruction, normalizeCritique, describeDraft,
} from '../../src/lib/agent/critique.js'

// ─── POST /api/agent/critique ──────────────────────────────────────────────
// "Why would this post get more interaction?" — asked of a draft, before it
// goes out. AGENT.md §5a's `review` job, which has been reserved in the JOBS
// table since the agent was built and never had a caller.
//
// Body: { workspace_id, draft: { platform, format, caption, media, hashtags,
//                                first_comment, alt_text, scheduled_at } }
//
// It writes nothing. The answer is a critique the person reads and acts on,
// or does not — an "improvement" applied straight to the caption would be a
// decision made for them, the same reason reviseIdea hands its rewrite back
// to a form rather than saving it.
//
// ── THERE IS NO SCORE, AND THAT IS THE DESIGN ──
//
// The obvious build is a predicted engagement rate. It would be fiction. On
// 2026-09-22 this workspace had fifteen measured posts, every one belonging to
// a one-follower test account, and zero published rows in generated_posts.
// A number produced from that would render beside genuinely measured analytics
// in the same typeface and be indistinguishable from them.
//
// So the evidence tier is computed BEFORE the model is called, the prompt is
// told what it may and may not claim, and the panel shows the reader the same
// sentence about what the answer rests on. See src/lib/agent/critique.js.
// Nothing about this changes when real history arrives; the tier moves on its
// own and the critique starts citing posts.

const CRITIQUE_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'strengths', 'changes'],
    properties: {
      verdict: {
        type: 'string',
        description:
          'One or two sentences: what this post is doing and whether it will land. Plain and specific. ' +
          'Never a score, a percentage, a grade, or a predicted number of any kind.',
      },
      strengths: {
        type: 'array',
        description: 'What genuinely works, at most three. Empty if nothing does — do not invent praise.',
        items: { type: 'string' },
      },
      changes: {
        type: 'array',
        description:
          'What to change, MOST VALUABLE FIRST. Between one and five. Each must be something the ' +
          'person can act on in the composer in front of them.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['what', 'why'],
          properties: {
            what: { type: 'string', description: 'The change, as an instruction. Short.' },
            why: { type: 'string', description: 'Why it matters for this post on this platform. One sentence.' },
            suggestion: {
              type: 'string',
              description:
                'Replacement wording, ONLY when the change is a wording change and you can write it. ' +
                'Empty string otherwise — never invent a rewrite for a structural note.',
            },
          },
        },
      },
    },
  },
}

const clip = (v, n) => String(v || '').slice(0, n)

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/**
 * This brand's measured posts, with the follower count of the account behind
 * each one.
 *
 * The follower count is the whole point of the join: it is what separates a
 * real audience from a test account, and post_analytics alone cannot answer
 * it. A read that fails is treated as "no history", never as an error — being
 * unable to look up the past is not a reason to refuse to read a draft.
 */
async function readMeasuredPosts(workspaceId) {
  try {
    const [rows, accounts] = await Promise.all([
      db(`post_analytics?workspace_id=eq.${workspaceId}` +
         '&select=post_id,platform,zernio_account_id,likes,comments,shares,saves,reach' +
         '&order=metric_date.desc&limit=400'),
      db(`social_accounts?workspace_id=eq.${workspaceId}&select=zernio_account_id,followers_count`),
    ])
    const followersBy = new Map(
      (accounts || []).map(a => [String(a.zernio_account_id || ''), a.followers_count]),
    )

    // One row per POST, not per day. post_analytics is a daily series, and
    // counting it raw would report a fortnight of one post as fourteen posts
    // and walk straight past the "too few to read a pattern" guard.
    const byPost = new Map()
    for (const r of rows || []) {
      const key = String(r.post_id || '')
      if (!key || byPost.has(key)) continue
      byPost.set(key, {
        platform: String(r.platform || ''),
        engagement: (r.likes || 0) + (r.comments || 0) + (r.shares || 0) + (r.saves || 0),
        reach: r.reach || null,
        followers: followersBy.has(String(r.zernio_account_id || ''))
          ? followersBy.get(String(r.zernio_account_id || ''))
          : null,
      })
    }
    return [...byPost.values()]
  } catch {
    return []
  }
}

/** The measured posts, as lines the model can read. Only ever the usable ones. */
function performanceBlock(posts) {
  if (!posts.length) return ''
  return [
    '',
    'HOW THIS BRAND\'S OWN POSTS HAVE ACTUALLY DONE:',
    ...posts.slice(0, 20).map((p, i) =>
      `${i + 1}. ${p.engagement} interactions${p.reach ? ` from ${p.reach} reached` : ''}`),
  ].join('\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  if (!isConfigured) return res.status(500).json({ error: 'Supabase is not configured on this deployment.' })

  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ error: 'Body must be JSON.' }) }

  const workspaceId = String(body.workspace_id || '').trim()
  const draft = body.draft || {}
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required.' })
  if (!String(draft.caption || '').trim() && !(draft.media || []).length) {
    return res.status(400).json({ error: 'Write something or add a picture first — there is nothing to read yet.' })
  }

  if (!(await callerId(req))) return res.status(401).json({ error: 'Sign in to analyse a post.' })
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    return res.status(403).json({ error: 'You do not have access to this workspace.' })
  }

  try {
    const [{ brand }, measured] = await Promise.all([
      loadBrandContext(workspaceId, 'review'),
      readMeasuredPosts(workspaceId),
    ])
    const evidence = evidenceFor(measured, String(draft.platform || ''))

    const result = await callModel({
      workspaceId, job: 'review', surface: 'composer', stage: 'critique_post',
      identity: IDENTITY, brand,
      messages: [{
        role: 'user',
        content: [
          'Read this draft post the way an experienced social editor for this brand would, and say',
          'what would make it land better. Be specific to THIS post — advice that would fit any post',
          'is not advice.',
          '',
          evidenceInstruction(evidence),
          '',
          'Rank the changes by how much difference they make, not by where they appear in the post.',
          'If the draft is already good, say so and keep the list short rather than padding it.',
          '',
          'THE DRAFT:',
          clip(describeDraft(draft), 8_000),
          performanceBlock(evidence.usable),
        ].join('\n'),
      }],
      maxTokens: 2_000, effort: 'medium',
      estimateUsd: 0.05,
      outputFormat: CRITIQUE_SCHEMA,
    })

    if (!result.ok) {
      return res.status(result.refused ? 200 : 502)
        .json({ ok: false, error: result.error || 'The analysis failed.' })
    }

    let parsed
    try { parsed = JSON.parse(textIn(result.response)) } catch { parsed = null }
    const critique = normalizeCritique(parsed)
    if (!critique.verdict && !critique.changes.length) {
      return res.status(502).json({ ok: false, error: 'The analysis came back empty. Try again in a moment.' })
    }

    return res.status(200).json({
      ok: true,
      ...critique,
      // Shown on the panel, always. The reader is entitled to know what this
      // rests on without having to trust the critique about its own basis.
      basis: evidence.note,
      evidence_tier: evidence.tier,
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
}
