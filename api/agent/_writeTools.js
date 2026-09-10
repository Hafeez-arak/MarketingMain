import { db } from './_supabase.js'
import {
  OWNERSHIP_CHECKS, WRITE_TARGETS, POST_PLATFORMS,
  AGENT_MEMORY_SOURCE, AGENT_POST_SOURCE,
} from '../../src/lib/agent/writeTools.js'

// ─── Executing a write ─────────────────────────────────────────────────────
// Every row lands as a proposal. See src/lib/agent/writeTools.js for why the
// boundary is enforced by absence rather than by instruction.

/**
 * Does this id actually belong to this workspace?
 *
 * The hole that read tools do not have. A read tool takes no ids, so a model
 * cannot point it anywhere. A write tool takes a plan_id — and a plan_id the
 * model invented, or lifted from another tenant's page it read during a web
 * search, would attach a row to a workspace the caller cannot see.
 *
 * Checked with the service key deliberately: the question is "does this row
 * exist in THIS workspace", and the answer must not depend on RLS, which lets
 * every workspace's rows through for an operator anyway.
 */
async function ownedBy(workspaceId, table, id) {
  if (!id) return false
  const rows = await db(
    `${table}?id=eq.${encodeURIComponent(id)}` +
    `&workspace_id=eq.${encodeURIComponent(workspaceId)}&select=id&limit=1`,
  )
  return Array.isArray(rows) && rows.length === 1
}

/**
 * Validate every model-supplied id on a tool call.
 *
 * Returns an error string, or '' when everything checks out. The error goes
 * back to the model as a tool_result so it can correct itself — "that plan is
 * not in this workspace" is recoverable; a thrown exception is not.
 */
export async function checkOwnership(workspaceId, name, args) {
  for (const check of OWNERSHIP_CHECKS[name] || []) {
    const value = args?.[check.param]
    if (!value) {
      if (check.required) return `${check.param} is required. Call get_plans to find one.`
      continue
    }
    if (!(await ownedBy(workspaceId, check.table, value))) {
      return `No ${check.table.replace(/_/g, ' ')} with id ${value} exists in this workspace. ` +
             `Call get_plans to see what actually exists — do not guess an id.`
    }
  }
  return ''
}

const clip = (v, n) => String(v ?? '').slice(0, n)

async function proposeRule(workspaceId, args) {
  const rule = clip(args.rule, 500).trim()
  if (!rule) return { error: 'A rule needs text.' }

  // A rule that already exists, in any status, is not proposed again. The
  // rejected case is the one that matters: an assistant that re-proposes a
  // turned-down rule every Monday is one people stop reading, and the model
  // cannot be relied on to have called get_memory first.
  const existing = await db(
    `brand_memory?workspace_id=eq.${workspaceId}&select=id,rule,status&limit=200`,
  )
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const clash = (existing || []).find(r => norm(r.rule) === norm(rule))
  if (clash) {
    return {
      error: `That rule already exists in this brand's rule book with status "${clash.status}". ` +
             (clash.status === 'rejected'
               ? 'It was rejected by a person — do not propose it again.'
               : 'Propose something different or say that this is already covered.'),
    }
  }

  const [row] = await db('brand_memory', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      workspace_id: workspaceId,
      rule,
      detail: clip(args.detail, 2000),
      scope: args.scope || 'trend',
      status: 'proposed',   // never anything else
      // NOT 'agent' — brand_memory.source has a CHECK that does not include it.
      source: AGENT_MEMORY_SOURCE,
      confidence: Number.isFinite(Number(args.confidence)) ? Number(args.confidence) : null,
      evidence: { sources: Array.isArray(args.sources) ? args.sources.slice(0, 10) : [] },
    },
  })
  return {
    ok: true, id: row?.id,
    landed: 'Brand Brain → rule book, as "proposed".',
    note: 'It steers nothing until a person accepts it.',
  }
}

async function proposeIdea(workspaceId, args) {
  const [row] = await db('plan_ideas', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      workspace_id: workspaceId,
      plan_id: args.plan_id,
      title: clip(args.title, 200),
      topic: clip(args.topic, 300),
      angle: clip(args.angle, 1000),
      rationale: clip(args.rationale, 1000),
      content_pillar: clip(args.content_pillar, 100),
      suggested_format: clip(args.suggested_format, 60),
      platform: clip(args.platform, 40) || 'instagram',
      status: 'proposed',
      source: 'agent',
    },
  })
  return { ok: true, id: row?.id, landed: 'The planner, as a proposed idea.' }
}

async function addAgendaItem(workspaceId, args) {
  const subject = clip(args.subject, 300).trim()
  if (!subject) return { error: 'A question needs text.' }

  // Same anti-nag guard as rules. A standing question re-proposed weekly is
  // the agenda equivalent of a rejected rule coming back.
  const existing = await db(
    `research_agenda?workspace_id=eq.${workspaceId}&kind=eq.question&select=id,subject,status&limit=200`,
  )
  const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  const clash = (existing || []).find(r => norm(r.subject) === norm(subject))
  if (clash) {
    return { error: `That question is already on the agenda with status "${clash.status}".` }
  }

  const [row] = await db('research_agenda', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      workspace_id: workspaceId,
      kind: 'question',
      subject,
      why: clip(args.why, 1000),
      status: 'proposed',
      cadence: args.cadence === 'monthly' ? 'monthly' : 'weekly',
      // So a question you proposed is never mistaken for one a person asked
      // for. The column exists precisely for this.
      created_by: 'agent',
    },
  })
  return { ok: true, id: row?.id, landed: 'The research agenda, as a proposed question.' }
}

async function draftPost(workspaceId, args) {
  const platform = clip(args.platform, 40).trim().toLowerCase()
  const caption = clip(args.caption, 4000)
  if (!platform) return { error: 'A post needs a platform.' }
  // Checked here rather than left to Postgres: the model can recover from
  // "instagram, tiktok or snapchat" and cannot recover from a 23514.
  if (!POST_PLATFORMS.includes(platform)) {
    return { error: `"${platform}" is not a platform this app publishes to. Use one of: ${POST_PLATFORMS.join(', ')}.` }
  }
  if (!caption.trim()) return { error: 'A post needs a caption.' }

  const [row] = await db('generated_posts', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      workspace_id: workspaceId,
      platform,
      caption,
      caption_ar: clip(args.caption_ar, 4000),
      hashtags: clip(args.hashtags, 1000),
      topic: clip(args.topic, 300),
      format: clip(args.format, 60),
      post_kind: clip(args.post_kind, 100),
      plan_id: args.plan_id || null,
      // 'draft', and nothing that could reach a queue. There is deliberately
      // no scheduled_date and no publish_status here — a post the agent wrote
      // must require a person to open it before it can go anywhere.
      status: 'draft',
      // NOT 'agent' — generated_posts.source has a CHECK that does not include it.
      source: AGENT_POST_SOURCE,
    },
  })
  return {
    ok: true, id: row?.id,
    landed: 'The composer, as a draft.',
    note: 'It is not scheduled and not published. A person has to open and send it.',
  }
}

export const WRITE_EXECUTORS = {
  propose_rule: proposeRule,
  propose_idea: proposeIdea,
  add_agenda_item: addAgendaItem,
  draft_post: draftPost,
}

/** Is this a write tool? Used to decide whether an ownership check is needed. */
export function isWriteTool(name) {
  return Boolean(WRITE_EXECUTORS[name])
}

export { WRITE_TARGETS }
