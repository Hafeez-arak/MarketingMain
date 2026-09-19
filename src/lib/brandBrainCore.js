// ─── Brand Brain — the pure half ───────────────────────────────────────────
// The flatteners that turn a brand profile and its directories into the text
// a model actually reads. Split out of brandBrain.js for the reason in
// AGENT.md §6: that file imports React, the app store and supabaseClient at
// module scope, so a Vercel function cannot load it — and the agent must go
// through the SAME formatting as every browser surface, or the two views of
// the brand drift silently and an off-brand caption has no traceable cause.
//
// The only import here is the other pure module. Nothing that assumes a
// browser, nothing that assumes a bundler.
//
// brandBrain.js re-exports all of this, so no existing call site changes.

import { getFieldValue, buildDirectoryBlock } from './brandSchemaCore.js'

export const DEFAULT_BRAND_PROFILE = {
  // Identity & voice
  mission:           '',
  positioning:       '',
  valueProposition:  '',
  brandStory:        '',
  companyFacts:      '',
  voiceDescriptors:  '',
  // Guardrails
  toneDos:           '',
  toneDonts:         '',
  // Audience
  targetPersonas:    '',
  // Visual
  visualIdentity:    '',
  visualStyleNotes:  '',
  brandColors:       '',
  // Market & references
  marketContext:     '',
  keyProjects:       '',
  // Products (managed via uploads, not free-text — see brand_assets / sheet)
  productSheetPath:  '',
  productIndex:      '',
  // Knowledge centre — powers WhatsApp + email too
  contactInfo:       '',
  languages:         '',
  complianceNotes:   '',
  offersCtas:        '',
  captionLanguage:   'both',   // ar | en | both — which language(s) captions are written in
  arabicDialect:     'saudi',
  // Values for schema-defined fields that don't map to a fixed column above
  // (see brandSchema.js). Keyed by the field's `key`.
  customFields:      {},
  // The workspace's field definitions, in display order — attached at fetch
  // so buildInstructionsString can flatten the profile without every caller
  // having to plumb the schema through. Empty = fall back to the legacy order.
  fieldDefs:         [],
  updatedAt:         null,
}
// Exported, unlike in brandBrain.js where it was private, because the server
// needs it too. buildContext() reads a profile in the camelCase shape this
// produces — `customFields`, `fieldDefs`, `valueProposition` — and a raw
// brand_profile row is snake_case and carries no field definitions at all.
// Handing the raw row straight to buildContext does not throw: it silently
// yields a blank brand name and drops every multi-word field, which is the
// exact "second view of the brand" failure this whole split exists to stop.
export function rowToProfile(row, fieldDefs) {
  if (!row) return null
  return {
    customFields:     row.custom_fields       || {},
    arabicDialect:    row.arabic_dialect      || 'saudi',
    fieldDefs:        fieldDefs               || [],
    mission:          row.mission             || '',
    positioning:      row.positioning         || '',
    valueProposition: row.value_proposition   || '',
    brandStory:       row.brand_story         || '',
    companyFacts:     row.company_facts        || '',
    voiceDescriptors: row.voice_descriptors   || '',
    toneDos:          row.tone_dos            || '',
    toneDonts:        row.tone_donts          || '',
    targetPersonas:   row.target_personas     || '',
    visualIdentity:   row.visual_identity     || '',
    visualStyleNotes: row.visual_style_notes  || '',
    brandColors:      row.brand_colors        || '',
    marketContext:    row.market_context      || '',
    keyProjects:      row.key_projects        || '',
    productSheetPath: row.product_sheet_path  || '',
    productIndex:     row.product_index       || '',
    contactInfo:      row.contact_info        || '',
    languages:        row.languages           || '',
    complianceNotes:  row.compliance_notes    || '',
    offersCtas:       row.offers_ctas         || '',
    captionLanguage:  row.caption_language    || 'both',
    updatedAt:        row.updated_at          || null,
  }
}
// Flatten the structured profile + optional platform-specific notes into the
// single "instructions" string the existing n8n webhooks already expect.
// Keeps the webhook contract unchanged — workflows don't need to be rebuilt,
// they just receive a richer instructions block.
// ── The legacy blob's task scoping ─────────────────────────────────────────
//
// A workspace with structured Brand Brain fields gets its scoping from
// SCOPE_TASKS and each field's own `tasks` tag. A workspace that never defined
// any — which on 2026-09-19 is Arak, with zero brand_fields and zero
// brand_sections — falls down the legacy path below, where there is nothing to
// hang a tag on, so EVERY column went to every task.
//
// What that looked like in practice: the picture models were handed "Speak as
// 'we' — ARAK is an established institution", "Never do: excessive exclamation
// marks" and a list of landmark client names, none of which describe an image.
// nano-banana-2 rejected the request outright (fal 422, "the input cannot be
// processed as the requested output type") while gpt-image-2 rendered it, which
// is how a Gemini lane came to fail four times on a brief ChatGPT completed.
//
// So the legacy path gets the scoping too: for a task that DRAWS, only the
// columns that describe how the brand looks. Every other task is untouched and
// still receives the whole blob — this list is an exclusion for image/video,
// not a new contract for captions and plans.
//
// toneDos/toneDonts stay in deliberately. They are the brand's guardrails, the
// one part the prompt builders mark absolute, and Arak's own never-do list is
// half visual ("Generic stock-photo lighting clichés"). A free-text column
// written by a person cannot be split by key, so the choice is to send it or
// drop a real visual rule; sending it is the smaller error.
const DRAWING_TASKS = new Set(['image', 'video'])
const VISUAL_KEYS = [
  'voiceDescriptors', 'toneDos', 'toneDonts',
  'visualIdentity', 'brandColors', 'visualStyleNotes', 'languages',
]

export function buildInstructionsString(profile, platformNotes, task = null) {
  if (!profile) profile = DEFAULT_BRAND_PROFILE

  // Schema-driven path: emit the workspace's own fields, in its own order,
  // under its own headings. A field marked include_in_prompt = false is
  // stored and editable but never sent — that's how a brand keeps, say, an
  // internal note out of every generation.
  if (profile.fieldDefs?.length) {
    const blocks = profile.fieldDefs
      .filter(f => f.enabled !== false && f.include_in_prompt !== false)
      .map(f => {
        const value = String(getFieldValue(profile, f) || '').trim()
        if (!value) return ''
        const heading = f.prompt_label?.trim() || f.label
        // Multi-line values read better under their heading than beside it.
        return value.includes('\n') ? `${heading}:\n${value}` : `${heading}: ${value}`
      })
      .filter(Boolean)
    if (platformNotes?.trim()) blocks.push(`Platform-specific notes:\n${platformNotes.trim()}`)
    return blocks.join('\n\n')
  }

  // Legacy path — used only when a workspace has no field definitions yet
  // (a brand new workspace, or a failed schema fetch). Keeps generation
  // working rather than sending an empty instructions block.
  const draws = DRAWING_TASKS.has(task)
  const only = key => (draws && !VISUAL_KEYS.includes(key) ? '' : profile[key])
  const sections = [
    // Identity first — this is the company persona the AI writes *as*.
    only('mission')          && `Mission: ${profile.mission}`,
    only('positioning')      && `Market positioning: ${profile.positioning}`,
    only('valueProposition') && `Value proposition: ${profile.valueProposition}`,
    only('brandStory')       && `Brand story:\n${profile.brandStory}`,
    only('companyFacts')     && `Facts the brand can state:\n${profile.companyFacts}`,
    only('voiceDescriptors') && `Brand voice: ${profile.voiceDescriptors}`,
    only('toneDos')          && `Always do:\n${profile.toneDos}`,
    only('toneDonts')        && `Never do:\n${profile.toneDonts}`,
    only('targetPersonas')   && `Target audience:\n${profile.targetPersonas}`,
    only('marketContext')    && `Market context:\n${profile.marketContext}`,
    only('keyProjects')      && `Reference when relevant:\n${profile.keyProjects}`,
    only('productIndex')     && `Product range (ask for the full sheet for specifics):\n${profile.productIndex}`,
    only('visualIdentity')   && `Visual identity:\n${profile.visualIdentity}`,
    only('brandColors')      && `Brand colours:\n${profile.brandColors}`,
    only('visualStyleNotes') && `Visual style defaults:\n${profile.visualStyleNotes}`,
    only('languages')        && `Languages:\n${profile.languages}`,
    only('contactInfo')      && `Contact & conversion details:\n${profile.contactInfo}`,
    only('offersCtas')       && `Offers & calls-to-action to push:\n${profile.offersCtas}`,
    only('complianceNotes')  && `Compliance rules (esp. WhatsApp/email):\n${profile.complianceNotes}`,
    platformNotes?.trim()    && `Platform-specific notes:\n${platformNotes.trim()}`,
  ].filter(Boolean)
  return sections.join('\n\n')
}
// ─── Selectable Brand Brain sections for plan generation ──────────────────
// CampaignPlanner lets the user pick which of these feed the plan prompt.
// "voice" is the existing brand_profile block (buildInstructionsString);
// the rest are directory tables that were never wired into plan generation.
// Fallback picker options, used only before a workspace's schema loads.
// The real list is per-workspace — see getBrandBrainSections below.
export const BRAND_BRAIN_SECTIONS = [
  { value: 'voice',  label: 'Brand Voice & Identity' },
  { value: 'assets', label: 'Asset Library' },
]
export const DEFAULT_BRAND_BRAIN_SECTIONS = ['voice', 'assets']

// The sections CampaignPlanner lets a user tick when generating a plan.
// "voice" is the flattened field blob, "assets" is the file library, and
// every enabled directory the workspace has defined shows up under its own
// name — "Service Menu" for Aqeeq, "Suppliers" for Arak, and so on.
export function getBrandBrainSections(schema) {
  const directories = (schema?.sections || [])
    .filter(s => s.kind === 'directory' && s.enabled !== false)
    .map(s => ({ value: s.key, label: s.title }))
  return [...BRAND_BRAIN_SECTIONS, ...directories]
}
// Cap on how many rows of any one list get flattened into a prompt — a
// 27-service menu is useful context, an unbounded list is just token burn.
const LIST_CAP = 30

function fmtAssets(rows) {
  const projectPhotos = (rows || []).filter(a => a.kind === 'project_photo')
  const groups = {}
  const individual = []
  for (const a of projectPhotos) {
    if (a.project) (groups[a.project] ||= []).push(a)
    else individual.push(a)
  }
  const groupLines = Object.entries(groups).slice(0, LIST_CAP).map(([name, photos]) => {
    const tags = [...new Set(photos.flatMap(p => p.tags || []))].slice(0, 6)
    return `- "${name}" — ${photos.length} photo${photos.length === 1 ? '' : 's'}${tags.length ? ` — tags: ${tags.join(', ')}` : ''}`
  })
  const hasLogo = (rows || []).some(a => a.kind === 'logo')
  const lines = [...groupLines]
  if (individual.length) lines.push(`- ${individual.length} individual project photo${individual.length === 1 ? '' : 's'} not grouped to a named project`)
  if (hasLogo) lines.push(`- Brand logo asset available`)
  if (!lines.length) return ''
  return `Visual assets on hand (reference these when suggesting shots/formats, exact photo files are picked separately):\n${lines.join('\n')}`
}

// Builds one formatted text block per selectable section (see
// getBrandBrainSections). CampaignPlanner joins only the sections the user
// selected before sending them as the `instructions` payload.
//
// `directory` is { schema, rowsBySection, assets }: the workspace's own
// section/column definitions plus its rows, so a directory renders into the
// prompt under its own name with its own columns.
export function buildSectionBlocks(profile, directory) {
  const { schema, rowsBySection, assets } = directory || {}
  const blocks = {
    voice:  buildInstructionsString(profile, ''),
    assets: fmtAssets(assets),
  }
  for (const section of schema?.sections || []) {
    if (section.kind !== 'directory' || section.enabled === false) continue
    const columns = (schema.columns || []).filter(c => c.section_key === section.key)
    blocks[section.key] = buildDirectoryBlock(section, columns, rowsBySection?.[section.key])
  }
  return blocks
}

export function isBrandProfileEmpty(profile) {
  if (!profile) return true
  // A brand whose schema is mostly custom fields (Aqeeq, Alo Kheyatah) can be
  // richly filled in while every fixed column below is still blank — checking
  // only those would report a fully-trained brain as empty.
  if (Object.values(profile.customFields || {}).some(v => String(v || '').trim())) return false
  return !profile.mission && !profile.positioning && !profile.valueProposition &&
    !profile.brandStory && !profile.companyFacts && !profile.voiceDescriptors &&
    !profile.toneDos && !profile.toneDonts && !profile.targetPersonas &&
    !profile.marketContext && !profile.keyProjects && !profile.visualIdentity &&
    !profile.visualStyleNotes && !profile.brandColors && !profile.contactInfo &&
    !profile.languages && !profile.complianceNotes && !profile.offersCtas
}
