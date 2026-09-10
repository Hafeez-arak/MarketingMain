// ─── The write tools ───────────────────────────────────────────────────────
// AGENT.md §4. Everything here lands as a PROPOSAL for a human. There is no
// tool that publishes and no tool that edits the Brand Brain — not
// "shouldn't", cannot, because the tool does not exist.
//
// The write boundary from RESEARCH-AGENT.md §5a holds in full: nothing here
// touches brand_profile, brand_fields, brand_sections, brand_directory_columns
// or brand_directory_rows, and nothing ever will. What the brand IS stays
// human-authored, permanently. The one-line review check survives the move off
// n8n — grep the executors for those table names; there should never be a hit
// outside a read.
//
// ── THE SECOND ISOLATION RULE ──
//
// Read tools take no workspace_id, so a model cannot point them anywhere. Write
// tools have a subtler hole: they take OTHER ids — a plan_id, a media id — and
// those come from the model. A plan_id the model invented, or read off another
// tenant's page, would attach a row to a workspace the caller cannot see.
//
// So every id a model supplies is re-checked against the session's workspace
// before it is used. `ownedBy` in api/agent/_writeTools.js is that check, and
// it is not optional on any path.

export const WRITE_TOOLS = [
  {
    name: 'propose_rule',
    cost: 'free',
    description:
      'Propose a learned rule for this brand — one imperative sentence that should steer future ' +
      'content. It lands in the Brand Brain rule book as "proposed" and does nothing until a ' +
      'person accepts it. Propose sparingly: a rule steers EVERY future caption this brand ' +
      'generates. Never propose a rule that already exists or that was previously rejected — ' +
      'call get_memory first and check. Ground it in something you actually found.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        rule: { type: 'string', description: 'One imperative sentence. This is what a model will read.' },
        detail: { type: 'string', description: 'What supports it, and how strong that evidence is.' },
        scope: {
          type: 'string',
          enum: ['global', 'plan', 'timing', 'caption', 'image', 'competitor', 'trend'],
          description: 'Which kind of generation this steers. Choose the narrowest that fits.',
        },
        confidence: { type: 'number', description: '0 to 1. Be honest — a low number is useful.' },
        sources: { type: 'array', items: { type: 'string' }, description: 'URLs you actually read.' },
      },
      required: ['rule', 'scope'],
    },
  },
  {
    name: 'propose_idea',
    cost: 'free',
    description:
      'Propose a content idea into an existing content plan. It lands as "proposed" for review. ' +
      'You MUST pass a plan_id — call get_plans first to see which plans exist. An idea cannot ' +
      'float without a plan.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        plan_id: { type: 'string', description: 'From get_plans. Must be a plan in this workspace.' },
        title: { type: 'string' },
        topic: { type: 'string' },
        angle: { type: 'string', description: 'What makes this post worth making.' },
        rationale: { type: 'string', description: 'Which finding or number this answers.' },
        content_pillar: { type: 'string' },
        suggested_format: { type: 'string', description: 'e.g. carousel, reel, single image.' },
        platform: { type: 'string' },
      },
      required: ['plan_id', 'title'],
    },
  },
  {
    name: 'add_agenda_item',
    cost: 'free',
    description:
      'Propose a standing question for the research agenda — something worth re-asking every ' +
      'week so answers stay comparable over time. It lands as "proposed" and is marked as ' +
      'having come from you, so it is never confused with a question a person asked for.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subject: { type: 'string', description: 'The question itself.' },
        why: { type: 'string', description: 'Why it matters — this steers how an answer is judged.' },
        cadence: { type: 'string', enum: ['weekly', 'monthly'] },
      },
      required: ['subject', 'why'],
    },
  },
  {
    name: 'draft_post',
    cost: 'free',
    description:
      'Write a draft post into the composer for review. It lands as a draft and is NOT ' +
      'scheduled and NOT published — you have no ability to do either. Follow the brand\'s ' +
      'active rules and say in your reply which ones you applied.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        platform: { type: 'string', description: 'e.g. instagram. Required.' },
        caption: { type: 'string' },
        caption_ar: { type: 'string', description: 'Arabic caption, if this brand posts in Arabic.' },
        hashtags: { type: 'string' },
        topic: { type: 'string' },
        format: { type: 'string', description: 'e.g. carousel, reel, single.' },
        post_kind: { type: 'string', description: 'The content pillar this belongs to.' },
        plan_id: { type: 'string', description: 'Optional — attach to a plan from get_plans.' },
      },
      required: ['platform', 'caption'],
    },
  },
]

/**
 * Which parameters on which tools are ids the model supplies that must be
 * re-checked against the session's workspace before use.
 *
 * A table rather than an `if` inside each executor, so adding a write tool
 * with a new foreign key forces a decision here rather than silently
 * inheriting no check at all.
 */
export const OWNERSHIP_CHECKS = {
  propose_idea: [{ param: 'plan_id', table: 'content_plans', required: true }],
  draft_post: [{ param: 'plan_id', table: 'content_plans', required: false }],
}

/**
 * Tables no agent tool may ever write. RESEARCH-AGENT.md §5a.
 *
 * Exported so the guard is a test rather than a code-review habit — a habit
 * survives exactly as long as the person who has it.
 */
export const FORBIDDEN_WRITE_TABLES = [
  'brand_profile',
  'brand_fields',
  'brand_sections',
  'brand_directory_columns',
  'brand_directory_rows',
]

// ─── Values the database will actually accept ──────────────────────────────
// These mirror CHECK constraints that live in Postgres, and they are listed
// here so a violation is a test failure rather than a 400 at the moment the
// agent finally tries to write something.
//
// Found the hard way: `source = 'agent'` seemed like the obvious, honest value
// for both brand_memory and generated_posts. Neither column allows it, and the
// failure surfaces only when a real row is attempted — every unit test passed,
// because none of them touched Postgres.

/** brand_memory.source — CHECK: rejections | edits | analytics | research | human */
export const MEMORY_SOURCES = ['rejections', 'edits', 'analytics', 'research', 'human']
/** What the agent writes. 'research' is the existing value for machine-proposed rules. */
export const AGENT_MEMORY_SOURCE = 'research'

/** generated_posts.source — CHECK: scheduled | manual | plan | generated | studio */
export const POST_SOURCES = ['scheduled', 'manual', 'plan', 'generated', 'studio']
export const AGENT_POST_SOURCE = 'generated'

/** generated_posts.platform — CHECK. A platform outside this list is a 400. */
export const POST_PLATFORMS = ['instagram', 'tiktok', 'snapchat', 'linkedin']

/** brand_memory.scope — CHECK. Must match the tool's enum exactly. */
export const MEMORY_SCOPES = ['plan', 'caption', 'image', 'timing', 'competitor', 'trend', 'global']

/** Where each write tool's row lands, and in what status. */
export const WRITE_TARGETS = {
  propose_rule:    { table: 'brand_memory',    status: 'proposed' },
  propose_idea:    { table: 'plan_ideas',      status: 'proposed' },
  add_agenda_item: { table: 'research_agenda', status: 'proposed' },
  // The composer's own review state. Named differently because it is not a
  // proposal a person accepts or rejects — it is a draft they edit.
  draft_post:      { table: 'generated_posts', status: 'draft' },
}

/**
 * No write tool may reach a terminal or publishing status.
 *
 * Checkable rather than assumed: widening this later is a permission change,
 * and it should look like one in a diff rather than being a string somebody
 * edited.
 */
export const FORBIDDEN_STATUSES = ['active', 'approved', 'scheduled', 'published', 'publishing']

export function writeToolsReachingForbiddenStatus() {
  return Object.entries(WRITE_TARGETS)
    .filter(([, t]) => FORBIDDEN_STATUSES.includes(t.status))
    .map(([name]) => name)
}
