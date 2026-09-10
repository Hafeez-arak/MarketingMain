// ─── The tool belt ─────────────────────────────────────────────────────────
// AGENT.md §4. Definitions only — pure data, no IO — so the belt can be
// asserted against without a database, a key, or a model.
//
// ── THE ONE RULE THAT MATTERS HERE ──
//
// No tool takes `workspace_id`. Not as an optional argument, not as a hint.
//
// AGENT.md §2: isolation is enforced in the tool layer, not in the prompt.
// Every executor gets the workspace id from the VERIFIED session and injects
// it itself. If the id were a parameter, then a model that hallucinated
// another workspace's uuid — or was talked into one by text it read on a
// competitor's web page — would be issuing a cross-tenant read, and the only
// thing standing in the way would be the model's own good behaviour.
//
// RLS does not save us here either, and that is written down already: the
// operators belong to all three workspaces, so RLS lets every workspace's rows
// through at once. The workspace_id filter in each executor IS the isolation.
//
// `assertNoWorkspaceParam` below turns that from a convention into a test.

// ── Cost class ──
// Free tools are Supabase queries: they cannot fail expensively and are not
// counted against a run's budget. Metered tools cost money or hit a rate
// limit, and the search loop paces itself against them. Splitting them here
// rather than at the call site means a new tool has to declare which it is.
export const FREE = 'free'
export const METERED = 'metered'

/**
 * Read tools over the brand and the operation. Everything here is a Supabase
 * query against one workspace.
 *
 * Descriptions are written for the model, and they carry the caveats the
 * numbers need — "sample sizes are included, say when they are too small" —
 * because a tool result that arrives without its caveat gets quoted without
 * it too.
 */
export const READ_TOOLS = [
  {
    name: 'get_brand_context',
    cost: FREE,
    description:
      'The brand context for this workspace: who they are, what they sell, their voice and ' +
      'their positioning, assembled from the Brand Brain. You already have this in your system ' +
      'prompt — call this only to re-read a specific block you need verbatim, or to check ' +
      'whether a field exists at all before saying it is missing.',
    input_schema: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          enum: ['plan', 'caption', 'image', 'video', 'research', 'chat'],
          description: 'Which slice of the brain to assemble. Fields can be scoped to a task.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_competitors',
    cost: FREE,
    description:
      'The competitor watchlist for this workspace: name, why we watch them, their resolved ' +
      'Instagram handle and how confident that resolution is. A handle with ig_status ' +
      '"not_found" means we could not find their account, so they can only appear in findings ' +
      'that rest on web evidence. "human_set" means a person typed it and it is authoritative. ' +
      'This list is deliberately allowed to differ from the Brand Brain competitor directory.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_memory',
    cost: FREE,
    description:
      'Every learned rule for this brand, in EVERY status — active, proposed and rejected. ' +
      'Read the rejected ones before proposing anything: a rule a person already turned down ' +
      'must not be proposed again. Only "active" rules currently steer generation.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['active', 'proposed', 'rejected', 'all'],
          description: 'Defaults to all, which is usually what you want.',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_prior_research',
    cost: FREE,
    description:
      'Recent research runs for this workspace with their headlines, plus the standing agenda ' +
      'questions a person has asked you to keep watching. This is what makes one week ' +
      'comparable to the last rather than merely adjacent to it — read it before deciding what ' +
      'to chase.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'How many past runs to return. Default 5, max 20.' },
      },
      required: [],
    },
  },
  {
    name: 'get_competitor_metrics',
    cost: FREE,
    description:
      'The competitor board: followers, posting cadence, format mix and engagement per 1,000 ' +
      'followers for each rival, with the week-over-week movement already computed. These ' +
      'numbers are measured and computed in code — treat them as given facts and never ' +
      'recompute or estimate them yourself. "baseline: true" means this is the first snapshot ' +
      'of that rival and there is genuinely nothing to compare against. "quiet_week: true" ' +
      'means nothing moved, which is a complete and reportable answer.',
    input_schema: {
      type: 'object',
      properties: {
        competitor: { type: 'string', description: 'Optional — limit to one rival by name.' },
      },
      required: [],
    },
  },
  {
    name: 'get_our_performance',
    cost: FREE,
    description:
      'How this brand\'s own posts have actually performed, broken down by format, by content ' +
      'pillar and by weekday. Every row carries BOTH "posts" and "measured" — how many we ' +
      'published versus how many we have analytics for. Quote the sample size whenever you ' +
      'draw a conclusion from this, and say plainly when it is too small to support one.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'Look-back window in days. Default 90, max 365.' },
        platform: { type: 'string', description: 'Optional platform filter, e.g. "instagram".' },
      },
      required: [],
    },
  },
  {
    name: 'get_posts',
    cost: FREE,
    description:
      'This brand\'s posts — published and drafted — with their captions, formats, scheduling ' +
      'and analytics. Use this to answer questions about a specific post, including the one ' +
      'the person is currently looking at.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'A specific post id. Use this when the person is looking at one post.' },
        status: { type: 'string', description: 'Filter by status, e.g. "published" or "draft".' },
        platform: { type: 'string', description: 'Optional platform filter.' },
        days: { type: 'integer', description: 'Look-back window in days. Default 90.' },
        limit: { type: 'integer', description: 'Max rows. Default 25, max 100.' },
      },
      required: [],
    },
  },
  {
    name: 'get_schedule',
    cost: FREE,
    description:
      'What is queued to go out and when, across platforms. Use this before proposing an idea ' +
      'so you do not suggest something already scheduled, and to spot gaps in the calendar.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: 'How far ahead to look. Default 30.' },
        limit: { type: 'integer', description: 'Max rows. Default 50, max 100.' },
      },
      required: [],
    },
  },
  {
    name: 'get_plans',
    cost: FREE,
    description:
      'Content plans for this brand and the ideas inside them, with each idea\'s status. Use ' +
      'this to see what has already been planned before proposing something new.',
    input_schema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'Optional — one plan and its ideas.' },
        limit: { type: 'integer', description: 'Max plans. Default 10, max 50.' },
      },
      required: [],
    },
  },
  {
    name: 'get_media',
    cost: FREE,
    description:
      'What is in this brand\'s media library — names, tags and types. Use this so an idea you ' +
      'propose can reference an asset that actually exists rather than one you imagined.',
    input_schema: {
      type: 'object',
      properties: {
        tag: { type: 'string', description: 'Optional tag filter.' },
        limit: { type: 'integer', description: 'Max rows. Default 50, max 200.' },
      },
      required: [],
    },
  },
]

/** Every tool the agent can currently call. Metered and write tools land here later. */
export const ALL_TOOLS = [...READ_TOOLS]

/**
 * The Anthropic-shaped definitions — name, description, input_schema and
 * nothing else. `cost` is ours and must not be sent: an unknown key on a tool
 * definition is a request the provider can reject, and it would also change
 * the bytes of the cached prefix for no reason.
 */
export function toolDefs(tools = ALL_TOOLS) {
  return tools.map(({ name, description, input_schema }) => ({ name, description, input_schema }))
}

/** Look one up by the name a model produced. Returns null for anything unknown. */
export function findTool(name, tools = ALL_TOOLS) {
  return tools.find(t => t.name === name) || null
}

/** Is this tool free to call? Unknown tools are treated as metered — fail expensive-side. */
export function isFree(name, tools = ALL_TOOLS) {
  return findTool(name, tools)?.cost === FREE
}

/**
 * The isolation invariant, as a checkable function rather than a comment.
 *
 * Returns the names of any tools that expose a workspace/tenant parameter to
 * the model. Must always be empty. See the header: a workspace id the model
 * can supply is a cross-tenant read waiting for a hallucination, and this is
 * the one property of the tool belt that cannot be allowed to regress
 * quietly as tools are added.
 */
export function toolsExposingWorkspace(tools = ALL_TOOLS) {
  const banned = /^(workspace_id|workspaceId|workspace|tenant_id|tenant|org_id|account_id)$/i
  return tools
    .filter(t => Object.keys(t?.input_schema?.properties || {}).some(k => banned.test(k)))
    .map(t => t.name)
}
