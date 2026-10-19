// ─── Direct edits from the chat, for admins ────────────────────────────────
// 2026-10-17. The owner asked for the assistant to CHANGE things when an admin
// tells it to, rather than filing a proposal the same admin then has to go and
// accept on another page. "Add tendersa.gov.sa as a source", "make the
// positioning line say X", "reject that rule" — each of those used to be a
// proposal, a page change and a click, for a person who already had the
// authority and had already said yes in the sentence they typed.
//
// ── WHAT THIS DELIBERATELY OVERRIDES, AND WHERE IT STOPS ──
//
// RESEARCH-AGENT.md §5a and AGENT.md §4 say the agent never edits the Brand
// Brain. That rule still holds for the weekly research run, which never sees
// this belt: toolsFor() only adds it when the chat endpoint has proven, from
// the session token, that the person asking is an admin. Non-admins keep the
// propose-only belt in writeTools.js exactly as it was.
//
// Definitions only — pure data, no IO — like tools.js and writeTools.js, so
// the belt can be asserted against without a database. The executors are in
// api/agent/_adminEdits.js.
//
// ── THE THREE GUARANTEES ──
//
//   1. The ROLE is checked on the server from the session, never from model
//      output. The belt is not offered to a non-admin, and runTool refuses an
//      admin tool for a non-admin even if a model names one it was never
//      shown (a hallucinated tool name is exactly as cheap as a hallucinated
//      uuid).
//   2. workspace_id still never appears as a parameter, and every OTHER id a
//      tool accepts is re-checked against the session's workspace before use
//      (ADMIN_OWNERSHIP_CHECKS, the same pattern as OWNERSHIP_CHECKS).
//   3. Every change writes an agent_edit_log row with the row before and
//      after, so it can be seen and undone. If the log row cannot be written,
//      the change is reverted — an edit nobody can see is worse than an edit
//      that did not happen.
//
// ── OUT OF REACH, ON PURPOSE ──
//
// Nothing here publishes, schedules or sends; nothing touches members, roles,
// invites, the monthly cost cap, credentials, or deletes a workspace. Those are
// enforced by absence: there is no tool, and ADMIN_EDIT_TABLES is the complete
// list of tables an admin edit (or its undo) may touch.

// 'free' as a literal rather than tools.js's FREE: tools.js imports this file
// to build the belt, and a cycle between the two would hand one of them an
// undefined at load time under plain Node.
const FREE = 'free'

/** research_agenda.kind values the chat may write. 'metric' is the run's own. */
export const AGENDA_KINDS = ['question', 'competitor', 'source']

/**
 * research_agenda.source_type — mirrors the CHECK added by
 * 20261020_research_sources.sql. Listed here so a bad value is an error the
 * model can recover from rather than a 23514 it cannot.
 */
export const SOURCE_TYPES = [
  '', 'website', 'news', 'tender_portal', 'exchange', 'government',
  'instagram', 'linkedin', 'x', 'hashtag', 'keyword',
]

/** research_agenda.status — CHECK. */
export const AGENDA_STATUSES = ['proposed', 'active', 'retired']

/**
 * brand_memory.status — CHECK: proposed | active | retired. "Reject" in the
 * Brand Brain UI writes 'retired'; there is no 'rejected' value in the column.
 */
export const RULE_STATUS_FOR = { accept: 'active', reject: 'retired', retire: 'retired' }

/** plan_ideas.status values an admin edit may set. 'approved' stays a person's click. */
export const IDEA_STATUSES_ALLOWED = ['proposed', 'rejected']

/**
 * The complete list of tables an admin edit, and therefore an undo, may write.
 *
 * An undo replays a stored `before` row into a stored table name. Without this
 * list, a log row is a way to write anything anywhere — the allow-list is what
 * makes the audit log safe to act on.
 */
export const ADMIN_EDIT_TABLES = [
  'brand_profile',
  'brand_sections',
  'brand_fields',
  'brand_directory_rows',
  'brand_memory',
  'research_agenda',
  'sales_icp',
  'plan_ideas',
  'generated_posts',
]

/**
 * Tables no chat tool may ever reach, admin or not. Asserted in a test against
 * ADMIN_EDIT_TABLES, so adding one by accident fails loudly.
 */
export const NEVER_EDITABLE_TABLES = [
  'workspaces',           // the cost cap, deletion
  'workspace_members',    // membership
  'user_access',          // roles
  'access_invites',       // invites
  'sales_seats',
  'agent_usage',          // the ledger
  'scheduled_posts',      // the publishing queue
  'email_mailboxes',      // credentials
  'social_accounts',      // connections and tokens
]

/** Read tools that exist so an edit can name the right row. Admin belt only. */
const ADMIN_READ_TOOLS = [
  {
    name: 'get_brand_brain',
    cost: FREE,
    description:
      'The Brand Brain as EDITABLE data: every section (id, key, title, kind), every field ' +
      '(id, key, label, section, current value) and every directory row (id, section, data). ' +
      'Call this before set_brand_field, edit_brand_structure or edit_directory_row so you ' +
      'edit the right key or id — never guess one.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        section_key: { type: 'string', description: 'Optional. Only this section.' },
      },
    },
  },
  {
    name: 'get_agenda',
    cost: FREE,
    description:
      'Every research agenda row — standing questions, the competitor watchlist and the ' +
      'source list (domains, handles, hashtags, phrases the research reads first) — with ids, ' +
      'status, tier and who added it. Call before edit_agenda_item.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: AGENDA_KINDS, description: 'Optional filter.' },
      },
    },
  },
  {
    name: 'get_icp',
    cost: FREE,
    description:
      'The sales ideal customer profile (sales_icp.config) exactly as stored. Call before ' +
      'edit_icp so a merge changes only what the person asked for.',
    input_schema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'get_edit_log',
    cost: FREE,
    description:
      'The most recent direct edits made from this chat in this workspace: what table and row, ' +
      'before and after, who asked, and whether it was undone. Use it to answer "what did you ' +
      'change?" and to find the edit_id for undo_edit.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: 'Default 10, max 50.' },
      },
    },
  },
]

const confirmed = {
  type: 'boolean',
  description:
    'Set true ONLY after the person has said yes to the exact change you described. Required ' +
    'for anything that overwrites existing text, deletes, retires or rejects.',
}

const ADMIN_WRITE_TOOLS = [
  {
    name: 'set_brand_field',
    cost: FREE,
    description:
      'Change the value of one Brand Brain field (positioning, tone, products, any custom field) ' +
      'by its key from get_brand_brain. This changes what every future caption, image and ' +
      'research run reads, immediately. mode "append" adds a new line to the end; "replace" ' +
      'overwrites — show the person the old and new text and get a yes first.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        field_key: { type: 'string', description: 'The field key from get_brand_brain.' },
        value: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append'] },
        confirmed,
      },
      required: ['field_key', 'value', 'mode'],
    },
  },
  {
    name: 'edit_brand_structure',
    cost: FREE,
    description:
      'Add or change a Brand Brain SECTION or FIELD DEFINITION (its label, hint, whether it is ' +
      'sent to the model). Sections can be created, renamed or hidden (enabled=false), never ' +
      'deleted. Fields can be created, changed or deleted; deleting a field definition keeps its ' +
      'stored value. To change what a field SAYS, use set_brand_field instead.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', enum: ['section', 'field'] },
        action: { type: 'string', enum: ['create', 'update', 'delete'] },
        section_id: { type: 'string', description: 'For updating a section. From get_brand_brain.' },
        field_id: { type: 'string', description: 'For updating or deleting a field. From get_brand_brain.' },
        section_key: { type: 'string', description: 'For creating a field: the section it goes in.' },
        title: { type: 'string', description: 'Section title.' },
        kind: { type: 'string', enum: ['fields', 'directory'], description: 'New section only.' },
        description: { type: 'string', description: 'Section description.' },
        label: { type: 'string', description: 'Field label.' },
        hint: { type: 'string', description: 'Field hint shown under the box.' },
        input_type: { type: 'string', enum: ['text', 'textarea'] },
        include_in_prompt: { type: 'boolean', description: 'Off = stored but never sent to a model.' },
        enabled: { type: 'boolean' },
        confirmed,
      },
      required: ['target', 'action'],
    },
  },
  {
    name: 'edit_directory_row',
    cost: FREE,
    description:
      'Add, change or delete one row in a Brand Brain directory section (products, projects, ' +
      'suppliers, competitors typed by people — whatever the section holds). On update, `data` ' +
      'is MERGED into the row: only the keys you send change, and a key set to null is removed. ' +
      'Use the column keys get_brand_brain shows for that section.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'] },
        row_id: { type: 'string', description: 'For update/delete. From get_brand_brain.' },
        section_key: { type: 'string', description: 'For create: a directory section key.' },
        data: { type: 'object', description: 'Column key → text.' },
        confirmed,
      },
      required: ['action'],
    },
  },
  {
    name: 'edit_rule',
    cost: FREE,
    description:
      'Change the brand rule book directly. "add" files a rule as ACTIVE (it steers every future ' +
      'caption at once); "accept" makes a proposed rule active; "reject" or "retire" switches a ' +
      'rule off; "edit" rewrites its text or scope. Call get_memory first for rule ids.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['add', 'accept', 'reject', 'retire', 'edit'] },
        rule_id: { type: 'string', description: 'For everything except add. From get_memory.' },
        rule: { type: 'string', description: 'One imperative sentence.' },
        detail: { type: 'string' },
        scope: {
          type: 'string',
          enum: ['global', 'plan', 'timing', 'caption', 'image', 'competitor', 'trend'],
        },
        confirmed,
      },
      required: ['action'],
    },
  },
  {
    name: 'edit_agenda_item',
    cost: FREE,
    description:
      'Add or change a research agenda row directly, as ACTIVE: a standing question ' +
      '(kind "question"), a competitor to watch ("competitor"), or a SOURCE the research reads ' +
      'first ("source": subject = the domain, @handle, #hashtag or phrase; source_type says what ' +
      'it is; why = what it carries; every source is checked every run; tier 1 = read closely, 2 = read, 3 = skim). ' +
      'Retire rather than delete. Call get_agenda first.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'retire', 'activate'] },
        item_id: { type: 'string', description: 'For update/retire/activate. From get_agenda.' },
        kind: { type: 'string', enum: AGENDA_KINDS, description: 'For create.' },
        subject: { type: 'string' },
        why: { type: 'string' },
        source_type: { type: 'string', enum: SOURCE_TYPES.filter(Boolean) },
        tier: { type: 'integer', description: '1, 2 or 3.' },
        cadence: { type: 'string', enum: ['weekly', 'monthly'] },
        ig_handle: { type: 'string', description: 'Competitors only: a handle the person confirmed.' },
        confirmed,
      },
      required: ['action'],
    },
  },
  {
    name: 'edit_icp',
    cost: FREE,
    description:
      'Change the sales ideal customer profile by MERGING `patch` into the stored config: keys ' +
      'you send replace those keys, nested objects merge, arrays are replaced whole, a key set ' +
      'to null is removed. Everything you do not mention is kept. Call get_icp first, describe ' +
      'the change, and get a yes — this re-ranks every sales target.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        patch: { type: 'object', description: 'Partial config to merge.' },
        confirmed,
      },
      required: ['patch'],
    },
  },
  {
    name: 'edit_plan_idea',
    cost: FREE,
    description:
      'Add, change or delete a content plan idea directly. Status may be set to "proposed" or ' +
      '"rejected" only — approving an idea stays a person\'s click in the planner, because ' +
      'approval leads to scheduling. Approved ideas cannot be deleted from here.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['create', 'update', 'delete'] },
        idea_id: { type: 'string', description: 'For update/delete. From get_plans.' },
        plan_id: { type: 'string', description: 'For create. From get_plans.' },
        title: { type: 'string' },
        topic: { type: 'string' },
        angle: { type: 'string' },
        rationale: { type: 'string' },
        content_pillar: { type: 'string' },
        suggested_format: { type: 'string' },
        status: { type: 'string', enum: IDEA_STATUSES_ALLOWED },
        confirmed,
      },
      required: ['action'],
    },
  },
  {
    name: 'edit_draft',
    cost: FREE,
    description:
      'Rewrite the text of an existing DRAFT post (caption, Arabic caption, hashtags, topic). ' +
      'Only posts that are not scheduled, not publishing and not published can be changed — you ' +
      'cannot schedule or publish anything. No em or en dashes in captions.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        post_id: { type: 'string', description: 'From get_posts.' },
        caption: { type: 'string' },
        caption_ar: { type: 'string' },
        hashtags: { type: 'string' },
        topic: { type: 'string' },
        confirmed,
      },
      required: ['post_id'],
    },
  },
  {
    name: 'undo_edit',
    cost: FREE,
    description:
      'Undo one direct edit by its edit_id from get_edit_log, putting the row back exactly as it ' +
      'was. Refuses if the row has been changed again since, so a newer edit is never silently ' +
      'overwritten.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        edit_id: { type: 'string', description: 'From get_edit_log.' },
      },
      required: ['edit_id'],
    },
  },
]

export const ADMIN_TOOLS = [...ADMIN_READ_TOOLS, ...ADMIN_WRITE_TOOLS]
export const ADMIN_TOOL_NAMES = ADMIN_TOOLS.map(t => t.name)

export function isAdminTool(name) {
  return ADMIN_TOOL_NAMES.includes(name)
}

/**
 * Every model-supplied id on an admin tool, and the table it must belong to
 * in THIS workspace. A table rather than an `if` in each executor, so a new id
 * parameter forces a decision here — the test fails until it is declared.
 *
 * None is `required` at this level because which id is needed depends on the
 * action; the executors refuse a missing one by name.
 */
export const ADMIN_OWNERSHIP_CHECKS = {
  edit_brand_structure: [
    { param: 'section_id', table: 'brand_sections' },
    { param: 'field_id', table: 'brand_fields' },
  ],
  edit_directory_row: [{ param: 'row_id', table: 'brand_directory_rows' }],
  edit_rule: [{ param: 'rule_id', table: 'brand_memory' }],
  edit_agenda_item: [{ param: 'item_id', table: 'research_agenda' }],
  edit_plan_idea: [
    { param: 'idea_id', table: 'plan_ideas' },
    { param: 'plan_id', table: 'content_plans' },
  ],
  edit_draft: [{ param: 'post_id', table: 'generated_posts' }],
  undo_edit: [{ param: 'edit_id', table: 'agent_edit_log' }],
}

/**
 * Merge a patch into a config: plain objects merge recursively, arrays and
 * scalars replace, `null` removes the key. Never mutates either argument.
 *
 * Used for sales_icp.config, whose shape keeps growing (share, mix, per-segment
 * overrides). A whole-object replace from a model that saw last month's shape
 * would silently drop whatever was added since.
 */
export function mergeConfig(base, patch) {
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
  const out = isObj(base) ? { ...base } : {}
  if (!isObj(patch)) return out
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete out[key]
    else if (isObj(value) && isObj(out[key])) out[key] = mergeConfig(out[key], value)
    else if (isObj(value)) out[key] = mergeConfig({}, value)
    else out[key] = value
  }
  return out
}

/**
 * The addendum to the chat's identity block for an admin. Stable text — no
 * dates, ids or names — because it sits in the cached system prefix, and a
 * per-request byte there silently re-bills the whole prefix on every call.
 * There are exactly two variants of the chat prefix (admin, not admin), each
 * cached on its own.
 */
export const ADMIN_EDITS_PROMPT = [
  'Direct edits (this person is an admin of this workspace):',
  '- In this chat you may CHANGE things directly with the edit tools: Brand Brain',
  '  content and structure, the rule book, the research agenda (questions,',
  '  competitors, sources), the sales ideal customer profile, plan ideas and',
  '  draft post text. This lifts the rule above that you never edit the Brand',
  '  Brain, for this conversation only, because a person with the authority is',
  '  asking. The weekly research run stays read-only.',
  '- Edit only when asked. Read first (get_brand_brain, get_agenda, get_icp,',
  '  get_memory, get_plans, get_posts) so you change the right row; never guess',
  '  a key or an id.',
  '- Before anything that overwrites existing text, deletes, retires, rejects,',
  '  or changes the ideal customer profile: state exactly what will change, old',
  '  and new, and wait for the person to say yes. Then call the tool with',
  '  confirmed: true. Small additive edits the person dictated (add a source, add',
  '  a question, add a rule they worded) can go straight through.',
  '- After an edit, say in one line what changed and that it can be undone.',
  '  get_edit_log shows what you changed; undo_edit reverses one change.',
  '- Still out of reach, whoever asks: publishing, scheduling or sending',
  '  anything; members, roles and invites; the monthly agent budget;',
  '  credentials and connected accounts; deleting a workspace. Say these are',
  '  done in the app by a person.',
].join('\n')
