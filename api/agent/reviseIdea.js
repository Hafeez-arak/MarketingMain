import { callerId, callerMayUseWorkspace, isConfigured } from './_supabase.js'
import { callModel } from './_provider.js'
import { loadBrandContext, IDENTITY } from './_context.js'
import { textIn } from '../../src/lib/agent/loop.js'

// ─── POST /api/agent/reviseIdea ────────────────────────────────────────────
// Reword ONE post idea the way a person asked.
//
// Body: { workspace_id, idea: { title, topic, angle }, instruction }
//
// It returns the new wording and writes nothing. The idea card puts the result
// into its edit form, so the person still reads it and presses Save — an AI
// rewrite that landed straight in the plan would be a decision made for them.
//
// Sonnet, through callModel like every other model call, so the spend shows up
// in the ledger and is held to the workspace's monthly cap.

const REVISED_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'topic', 'angle'],
    properties: {
      title: { type: 'string', description: 'The idea as a short headline, under 90 characters.' },
      topic: { type: 'string', description: 'What the post is about, one or two sentences.' },
      angle: { type: 'string', description: 'The angle or hook. Empty string if the original had none and none is needed.' },
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  if (!isConfigured) return res.status(500).json({ error: 'Supabase is not configured on this deployment.' })

  let body
  try { body = await readBody(req) } catch { return res.status(400).json({ error: 'Body must be JSON.' }) }

  const workspaceId = String(body.workspace_id || '').trim()
  const instruction = clip(body.instruction, 1_000).trim()
  const idea = body.idea || {}
  if (!workspaceId) return res.status(400).json({ error: 'workspace_id is required.' })
  if (!instruction) return res.status(400).json({ error: 'Say how the idea should change.' })

  if (!(await callerId(req))) return res.status(401).json({ error: 'Sign in to change an idea.' })
  if (!(await callerMayUseWorkspace(req, workspaceId))) {
    return res.status(403).json({ error: 'You do not have access to this workspace.' })
  }

  try {
    const { brand } = await loadBrandContext(workspaceId, 'plan')
    const result = await callModel({
      workspaceId, job: 'revise', surface: 'review', stage: 'revise_idea',
      identity: IDENTITY, brand,
      messages: [{
        role: 'user',
        content: [
          'Rewrite this post idea as the person asks. Change only what they asked for;',
          'keep everything else about it as it is. Stay in the brand voice.',
          '',
          `TITLE: ${clip(idea.title, 400)}`,
          `ABOUT: ${clip(idea.topic, 1_200)}`,
          `ANGLE: ${clip(idea.angle, 600)}`,
          '',
          `HOW TO CHANGE IT: ${instruction}`,
        ].join('\n'),
      }],
      maxTokens: 1_500, effort: 'low',
      estimateUsd: 0.02,
      outputFormat: REVISED_SCHEMA,
    })

    if (!result.ok) {
      return res.status(result.refused ? 200 : 502).json({ ok: false, error: result.error || 'The rewrite failed.' })
    }

    let revised
    try { revised = JSON.parse(textIn(result.response)) } catch { revised = null }
    if (!revised?.title?.trim() && !revised?.topic?.trim()) {
      return res.status(502).json({ ok: false, error: 'The rewrite came back empty. Try wording the change differently.' })
    }
    return res.status(200).json({
      ok: true,
      title: String(revised.title || '').trim(),
      topic: String(revised.topic || '').trim(),
      angle: String(revised.angle || '').trim(),
    })
  } catch (err) {
    return res.status(500).json({ ok: false, error: String(err?.message || err) })
  }
}
