import { useCallback, useEffect, useState } from 'react'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient'
import { buildInstructionsString, buildSectionBlocks } from './brandBrain'
import { fetchBrandSchema, fetchDirectoryRows } from './brandSchema'
import { fetchBrandAssets } from './brandAssets'

// ─── Brand context assembly ────────────────────────────────────────────────
// The single entry point every AI call goes through to turn the Brand Brain
// into the text a model actually reads.
//
// It exists because that assembly used to happen five different ways in five
// different files, and because the persona line above the brand context was
// hardcoded to one company — so a spa was told it manufactured lighting and
// then handed a spa's brand brain underneath. Identity now comes from the
// brain like everything else.
//
// This module WRAPS the existing flatteners rather than replacing them:
// buildInstructionsString / buildSectionBlocks (brandBrain.js) and
// buildDirectoryBlock (brandSchema.js) still do the formatting. What's new
// is task scoping, the identity line, learned memory, and one shape the
// preview panel and the payload builder can share — the preview calls this
// exact function, so what a user sees cannot drift from what is sent.

// The kinds of generation a field can be scoped to. A field or section with
// an empty `tasks` array belongs to all of them, which is why adding this
// changed nothing until someone tagged something.
export const TASKS = ['plan', 'caption', 'image', 'video', 'research', 'chat']

export const TASK_LABELS = {
  plan:     'Idea planning',
  caption:  'Caption & copy',
  image:    'Image prompts',
  video:    'Video & motion',
  research: 'Research',
  chat:     'Ideation chat',
}

// Empty tags = every task. An unknown tag matches nothing, which is the safe
// direction to fail: a typo'd tag quietly narrows one field rather than
// leaking an internal note into every prompt.
export function matchesTask(tags, task) {
  if (!tags?.length) return true
  if (!task) return true
  return tags.includes(task)
}

// Above this many rows a directory is summarised to an index instead of
// flattened in full. Aqeeq's service menu is 27 rows and Arak's supplier
// list 31 — sending every column of every row to an image-prompt rewriter is
// pure token burn, and the prices are deliberately withheld anyway.
const DIRECTORY_INDEX_THRESHOLD = 12

// A ceiling on how many rows can be pulled in as detail at once. A caption
// naming six services is already an unusual post; beyond that the caller is
// almost certainly matching too loosely, and silently truncating costs less
// than sending a whole catalogue back after it was deliberately indexed.
const MAX_FEATURED_ROWS = 6

// A compact "what exists" list: the first column plus the category-ish
// column, nothing else. The full detail for the handful of rows a plan
// actually selects arrives separately via `featuredRows` — the same
// mechanism content_plans.featured_products already uses.
function buildDirectoryIndex(section, columns, rows) {
  const cols = (columns || []).filter(c => c.enabled !== false && c.in_prompt !== false)
  if (!cols.length || !rows?.length) return ''
  const nameCol = cols[0]
  // "category", "list", "type" — whichever grouping column the workspace
  // happens to have defined. Found by key, not by position, because these
  // directories are user-defined and column order is theirs to change.
  const groupCol = cols.find(c => /categor|group|list|type/i.test(c.key || c.label || ''))
  const groups = new Map()
  for (const row of rows) {
    const data = row.data || {}
    const name = String(data[nameCol.key] || '').trim()
    if (!name) continue
    const group = String((groupCol && data[groupCol.key]) || '').trim() || 'Other'
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(name)
  }
  if (!groups.size) return ''
  const lines = [...groups].map(([group, names]) => `- ${group}: ${names.join(', ')}`)
  return `${section?.title || 'Directory'} — full list of what exists ` +
    `(${rows.length} entries; ask for specifics on any one of these):\n${lines.join('\n')}`
}

// Full detail for just the rows a caller selected — the other half of the
// index/detail split above.
function buildFeaturedRowsBlock(section, columns, rows, featuredKeys) {
  if (!featuredKeys?.length || !rows?.length) return ''
  const cols = (columns || []).filter(c => c.enabled !== false && c.in_prompt !== false)
  if (!cols.length) return ''
  const nameCol = cols[0]
  const wanted = new Set(featuredKeys.map(k => String(k).trim().toLowerCase()))
  const picked = rows.filter(r => {
    const data = r.data || {}
    return wanted.has(String(data[nameCol.key] || '').trim().toLowerCase()) || wanted.has(String(r.id))
  })
  if (!picked.length) return ''
  const lines = picked.map(row => {
    const data = row.data || {}
    const bits = cols.slice(1)
      .map(c => { const v = String(data[c.key] || '').trim(); return v ? `${c.label}: ${v}` : '' })
      .filter(Boolean)
    return `- ${String(data[nameCol.key] || '(unnamed)').trim()}${bits.length ? ` — ${bits.join(' — ')}` : ''}`
  })
  return `${section?.title || 'Directory'} — full detail for the entries this post is about:\n${lines.join('\n')}`
}

// Lowercase and collapse whitespace. Deliberately not stripping punctuation
// or Arabic diacritics: row names here are matched against copy written about
// them, and both sides come from the same people typing the same way.
function normalizeForMatch(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// The primary name column, plus its translations and any other column that
// names the row rather than describing it — `name_ar` beside `name`, or a
// `title_ar` beside `title`. Deliberately narrow: matching against a notes or
// description column would pull in rows on a single shared word.
function isIdentityColumn(key, nameKey) {
  if (!key) return false
  if (key === nameKey) return true
  if (key.startsWith(`${nameKey}_`)) return true
  return /^(name|title)(_[a-z]{2,3})?$/i.test(key)
}

// Which directory rows a piece of text is actually about.
//
// The index/detail split only pays off if something decides what "detail"
// means for a given call. The planner has an explicit row picker; every
// downstream surface — drafting a caption, rewriting an image prompt, a
// free-text Studio prompt — has only the text itself. So the text is what we
// read: a row whose name appears in the brief is a row the model should see
// in full.
//
// Only sections large enough to have been indexed are considered. A small
// directory was already sent whole, and matching there would print the same
// row twice.
export function matchFeaturedRows(schema, directory, ...texts) {
  const haystack = normalizeForMatch(texts.filter(Boolean).join(' \n '))
  if (!haystack) return {}
  const out = {}
  for (const section of schema?.sections || []) {
    if (section.kind !== 'directory' || section.enabled === false) continue
    const rows = directory?.rowsBySection?.[section.key] || []
    if (rows.length <= DIRECTORY_INDEX_THRESHOLD) continue
    const sectionCols = (schema.columns || []).filter(
      c => c.section_key === section.key && c.enabled !== false,
    )
    const cols = sectionCols.filter(c => c.in_prompt !== false)
    if (!cols.length) continue
    const nameCol = cols[0]
    // A row is named in more than one language here: Aqeeq's services carry
    // `name` and `name_ar`, and a brief written in Arabic would otherwise
    // match nothing. Any of a row's names identifies it; the primary name is
    // still what gets returned, since that is what the detail block keys on.
    const idCols = sectionCols.filter(c => isIdentityColumn(c.key, nameCol.key))
    const hits = []
    for (const row of rows) {
      const name = String(row.data?.[nameCol.key] || '').trim()
      if (!name) continue
      const aliases = idCols
        .map(c => String(row.data?.[c.key] || '').trim())
        // Two-character names ("A4", "XL") appear inside unrelated words
        // often enough to drag in rows the post was never about.
        .filter(v => v.length >= 3)
      if (aliases.some(v => haystack.includes(normalizeForMatch(v)))) hits.push(name)
    }
    if (hits.length) out[section.key] = hits.slice(0, MAX_FEATURED_ROWS)
  }
  return out
}

// ─── The identity line ─────────────────────────────────────────────────────
// What replaces the hardcoded "You are a copywriter for Arak Lighting,
// Saudi Arabia's leading architectural lighting company" in 52 places.
export function getBrandIdentity(profile) {
  const custom = profile?.customFields || {}
  const brandName = String(custom.brand_name || '').trim()
  const brandDescriptor = String(custom.brand_descriptor || '').trim()
  return { brandName, brandDescriptor }
}

// ─── Memory → prompt text ──────────────────────────────────────────────────

// A learned rule has always carried a `scope` — it is chosen when a rule is
// added by hand and written by the research workflows that propose them — but
// nothing ever read it, so a rule about captions was sent to the image-prompt
// rewriter too. "Include a booking phone number in every caption" reaching a
// model that draws pictures is at best noise and at worst text baked into the
// artwork. The scope is now the default task tagging, so it means what it
// looks like it means.
//
// `image` covers video as well: a rule about how the brand's pictures should
// look applies to the frames of a clip. `competitor` and `trend` are market
// observations — they belong to deciding WHAT to post, not to drawing it.
export const SCOPE_TASKS = {
  global:     [],                              // every task
  plan:       ['plan'],
  timing:     ['plan'],
  caption:    ['caption'],
  image:      ['image', 'video'],
  competitor: ['plan', 'research', 'chat'],
  trend:      ['plan', 'research', 'chat'],
}

// Explicit tags win; the scope is only the fallback. That ordering is what
// lets someone widen or narrow one rule from the Brand Brain without having
// to reclassify it under a scope that no longer describes it.
export function memoryTasks(rule) {
  if (rule?.tasks?.length) return rule.tasks
  return SCOPE_TASKS[rule?.scope] || []
}

// Only `rule` is ever sent. `detail` and `evidence` exist so a human can
// audit why a rule is there without paying for that context every run, and
// only 'active' rows are injected — an unreviewed machine inference must not
// quietly start steering the brand's output.
function buildMemoryBlock(memory, task) {
  const active = (memory || []).filter(m => m.status === 'active' && matchesTask(memoryTasks(m), task))
  if (!active.length) return ''
  const lines = active.map(m => `- ${String(m.rule || '').trim()}`).filter(l => l.length > 2)
  if (!lines.length) return ''
  return 'What this brand has learned so far (these come from real results ' +
    'and review decisions — follow them unless the request explicitly says otherwise):\n' +
    lines.join('\n')
}

// ─── buildContext ──────────────────────────────────────────────────────────
// The one function. Returns both the assembled `instructions` string that
// goes into the payload AND the individual `blocks` it was built from, so
// the context panel can show exactly what is being sent and let a user mute
// a block for one generation without touching the stored brain.
//
//   profile   — from fetchBrandProfile (carries fieldDefs + customFields)
//   schema    — from fetchBrandSchema ({ sections, fields, columns })
//   directory — { rowsBySection, assets }
//   memory    — brand_memory rows (see fetchBrandMemory below)
//   options   — { task, platformNotes, mutedKeys, featuredRows, sections }
export function buildContext(profile, schema, directory, memory, options = {}) {
  const {
    task = null,
    platformNotes = '',
    mutedKeys = [],
    featuredRows = {},
    // The brief this call is about, in whatever fields the caller has — the
    // topic and angle of an idea, a Studio prompt box, a reference note.
    // Handled here rather than by each caller because the schema and rows
    // needed to match against already live in this function's arguments.
    matchText = null,
    sections: allowedSections = null,
  } = options

  const { brandName, brandDescriptor } = getBrandIdentity(profile)
  const muted = new Set(mutedKeys)
  const blocks = []

  // An explicit selection wins over a matched one: the planner's row picker
  // is a person stating what the month is about, and that should not be
  // narrowed by whether the words happen to appear in the copy.
  const matched = matchText
    ? matchFeaturedRows(schema, directory, ...(Array.isArray(matchText) ? matchText : [matchText]))
    : {}
  const effectiveFeatured = { ...matched, ...featuredRows }

  // 1) Voice — the flattened field blob, scoped to this task.
  //    Filtering the field defs and handing them to the existing flattener
  //    keeps one implementation of the formatting rather than a second copy
  //    that drifts. include_in_prompt is still honoured inside it, which is
  //    what keeps brand_name/brand_descriptor from being printed twice.
  const fieldTaskById = new Map((schema?.fields || []).map(f => [f.key, f.tasks]))
  const sectionTasksByKey = new Map((schema?.sections || []).map(s => [s.key, s.tasks]))
  const scopedProfile = {
    ...profile,
    fieldDefs: (profile?.fieldDefs || []).filter(f => {
      const fieldTags = f.tasks ?? fieldTaskById.get(f.key)
      if (!matchesTask(fieldTags, task)) return false
      // A field inherits its section's scope: tagging the section is the
      // cheap way to scope a whole group without touching every field.
      return matchesTask(sectionTasksByKey.get(f.section_key), task)
    }),
  }
  const voiceText = buildInstructionsString(scopedProfile, platformNotes)
  if (voiceText) blocks.push({ key: 'voice', label: 'Brand Voice & Identity', text: voiceText })

  // 2) Assets — reuse the existing formatter for the asset summary only.
  //    Scoped like everything else: the asset section carries `tasks` in the
  //    schema exactly as a directory does, and skipping that check here was
  //    the one way a section could still be sent to a task it was tagged out
  //    of.
  const legacyBlocks = buildSectionBlocks(profile, { schema, rowsBySection: directory?.rowsBySection, assets: directory?.assets })
  const assetSection = (schema?.sections || []).find(s => s.kind === 'assets')
  if (legacyBlocks.assets && matchesTask(assetSection?.tasks, task)) {
    blocks.push({ key: 'assets', label: assetSection?.title || 'Asset Library', text: legacyBlocks.assets })
  }

  // 3) Directories — index when large, full when small, plus detail for any
  //    specifically featured rows.
  for (const section of schema?.sections || []) {
    if (section.kind !== 'directory' || section.enabled === false) continue
    if (!matchesTask(section.tasks, task)) continue
    const columns = (schema.columns || []).filter(c => c.section_key === section.key)
    const rows = directory?.rowsBySection?.[section.key] || []
    if (!rows.length) continue

    const indexed = rows.length > DIRECTORY_INDEX_THRESHOLD
    const text = indexed
      ? buildDirectoryIndex(section, columns, rows)
      : legacyBlocks[section.key]
    if (text) blocks.push({ key: section.key, label: section.title, text })

    // Only meaningful on top of an index. An un-indexed section already
    // carries every column of every row, so a "selected" block there would
    // repeat what is directly above it.
    if (!indexed) continue
    const featured = buildFeaturedRowsBlock(section, columns, rows, effectiveFeatured[section.key])
    if (featured) blocks.push({ key: `${section.key}__featured`, label: `${section.title} (selected)`, text: featured })
  }

  // 4) Learned memory — last, so it reads as a refinement on top of the
  //    brand's stated defaults rather than as part of them.
  const memoryText = buildMemoryBlock(memory, task)
  if (memoryText) blocks.push({ key: 'memory', label: 'Learned Guidance', text: memoryText })

  // Callers that already expose a section picker (the planner) pass their
  // selection through; everything else gets every block.
  //
  // WHY a block is withheld matters, not just that it is: the panel offers a
  // per-generation mute checkbox, and a block dropped by an upstream section
  // picker has to be shown as locked rather than as unchecked. Reporting both
  // as a bare `muted` flag meant the panel read its own checkbox back as
  // "locked upstream" and disabled it — so unchecking a block made it
  // impossible to check again without reloading the page.
  const mutedBy = b => {
    if (muted.has(b.key)) return 'user'
    if (allowedSections && !allowedSections.includes(b.key) && b.key !== 'memory') return 'section'
    return null
  }
  const visible = blocks.filter(b => !mutedBy(b))

  const identityLine = brandName
    ? `BRAND: ${brandName}${brandDescriptor ? ` — ${brandDescriptor}` : ''}`
    : ''

  const instructions = [identityLine, ...visible.map(b => b.text)].filter(Boolean).join('\n\n')

  return {
    brandName,
    brandDescriptor,
    identityLine,
    // Every block considered, each flagged — this is what the panel renders,
    // so a muted block is still visible as something being withheld rather
    // than silently absent. `mutedBy` says which lever withheld it.
    blocks: blocks.map(b => ({ ...b, muted: !visible.includes(b), mutedBy: mutedBy(b) })),
    instructions,
    task,
  }
}

// ─── useBrandContext ───────────────────────────────────────────────────────
// Loads the three things buildContext needs beyond the profile — schema,
// directory rows/assets, and memory — and returns a builder already bound to
// them, so a page can ask for `ctx('caption')` without growing its own
// three-fetch effect.
//
// Studio and the planner keep their own loaders: they need the raw schema and
// directory for other things (the section chips, the featurable-row list), so
// routing them through here would mean fetching the same rows twice. This is
// for the surfaces that had no brand wiring beyond the flattened profile blob.
//
// Returns a builder rather than a context object because the task differs per
// call site within a page — the Instagram page writes captions AND rewrites
// image prompts, and those want different slices of the brain.
export function useBrandContext(workspaceId, accessToken, profile) {
  const [schema, setSchema] = useState({ sections: [], fields: [], columns: [] })
  const [directory, setDirectory] = useState({ rowsBySection: {}, assets: [] })
  const [memory, setMemory] = useState([])

  useEffect(() => {
    if (!workspaceId) return
    let alive = true
    Promise.all([
      fetchBrandSchema(workspaceId, accessToken),
      fetchDirectoryRows(workspaceId, accessToken),
      fetchBrandAssets(workspaceId, accessToken),
      fetchBrandMemory(workspaceId, accessToken),
    ]).then(([nextSchema, rows, assets, nextMemory]) => {
      if (!alive) return
      const rowsBySection = {}
      for (const r of rows) (rowsBySection[r.section_key] ||= []).push(r)
      setSchema(nextSchema)
      setDirectory({ rowsBySection, assets })
      setMemory(nextMemory)
    })
    // A failed load leaves the empty defaults in place, which degrades to the
    // profile-only context this replaced rather than to no context at all.
    return () => { alive = false }
  }, [workspaceId, accessToken])

  return useCallback(
    (task, options = {}) => buildContext(profile, schema, directory, memory, { task, ...options }),
    [profile, schema, directory, memory],
  )
}

// ─── brand_memory data access ──────────────────────────────────────────────
// Same auth model as the rest of the brand_* tables: anon key routes the
// request, the user's token makes RLS resolve them as a real member.

function authHeaders(accessToken) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}` }
}

// `status` defaults to active because that is what generation needs; the
// Brand Brain page asks for all of them so a human can review proposals.
export async function fetchBrandMemory(workspaceId, accessToken, { status = 'active' } = {}) {
  if (!workspaceId) return []
  // The workspace_id filter is explicit and required: RLS here is per-user,
  // and the operators belong to all three workspaces, so RLS alone would
  // return every brand's rules at once.
  const statusFilter = status === 'all' ? '' : `&status=eq.${status}`
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/brand_memory?workspace_id=eq.${workspaceId}${statusFilter}&select=*&order=created_at.desc`,
      { headers: authHeaders(accessToken) },
    )
    if (!res.ok) return []
    return await res.json()
  } catch { return [] }
}

export async function createBrandMemory(workspaceId, accessToken, row) {
  if (!workspaceId) return { error: 'No active workspace.' }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_memory`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ workspace_id: workspaceId, ...row }),
    })
    if (!res.ok) return { error: await res.text() }
    const [created] = await res.json()
    return { ok: true, row: created }
  } catch (err) { return { error: err.message } }
}

export async function updateBrandMemory(accessToken, id, patch) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_memory?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    })
    if (!res.ok) return { error: await res.text() }
    const [row] = await res.json()
    return { ok: true, row }
  } catch (err) { return { error: err.message } }
}

export async function deleteBrandMemory(accessToken, id) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/brand_memory?id=eq.${id}`, {
      method: 'DELETE', headers: authHeaders(accessToken),
    })
    if (!res.ok) return { error: await res.text() }
    return { ok: true }
  } catch (err) { return { error: err.message } }
}

// ─── idea_events ───────────────────────────────────────────────────────────
// The decision log. Append-only and strictly best-effort: this is telemetry
// about the user's work, and a failure to record it must never block the
// work itself — same contract as logEditFeedback.
export async function logIdeaEvent(workspaceId, accessToken, { planId, ideaId, event, reason, before, after, actor }) {
  if (!workspaceId || !event) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/idea_events`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        workspace_id: workspaceId,
        plan_id: planId || null,
        idea_id: ideaId || null,
        event,
        reason: reason || '',
        before: before || {},
        after: after || {},
        actor: actor || null,
      }),
    })
  } catch {
    // best-effort — never block the user's action on the audit trail
  }
}

// Bulk variant — one request for the whole batch. "Reject all" on a
// thirty-idea plan is a single decision and should cost a single insert, not
// thirty; firing them individually also made the log's timestamps imply a
// deliberation that never happened.
export async function logIdeaEvents(workspaceId, accessToken, events) {
  if (!workspaceId || !events?.length) return
  const rows = events
    .filter(e => e && e.event)
    .map(e => ({
      workspace_id: workspaceId,
      plan_id: e.planId || null,
      idea_id: e.ideaId || null,
      event: e.event,
      reason: e.reason || '',
      before: e.before || {},
      after: e.after || {},
      actor: e.actor || null,
    }))
  if (!rows.length) return
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/idea_events`, {
      method: 'POST',
      headers: { ...authHeaders(accessToken), 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    })
  } catch {
    // best-effort, same contract as logIdeaEvent
  }
}

// Only the fields worth diffing. Storing the whole idea row on every edit
// would make the log mostly noise and mostly duplicate.
export const IDEA_EVENT_FIELDS = [
  'title', 'topic', 'angle', 'tone', 'occasion', 'content_pillar',
  'objective', 'cta', 'image_idea', 'format', 'status', 'scheduled_date',
]

export function ideaSnapshot(idea) {
  if (!idea) return {}
  const out = {}
  for (const key of IDEA_EVENT_FIELDS) {
    const camel = key.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    const value = idea[key] ?? idea[camel]
    if (value !== undefined && value !== null && value !== '') out[key] = value
  }
  return out
}
