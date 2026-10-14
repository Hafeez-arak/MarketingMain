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

import { getFieldValue, setFieldValue, buildDirectoryBlock } from './brandSchemaCore.js'

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
// ── What a drawing model is allowed to read ────────────────────────────────
//
// An image or video model reads the brand block as part of the picture's
// description, so anything in it that is not about how the brand LOOKS is at
// best noise and at worst a refusal. Measured: nano-banana-2 rejected a
// request outright (fal 422, "the input cannot be processed as the requested
// output type") on a brief gpt-image-2 rendered without complaint, because the
// block it was handed read as a copywriting job — "Speak as 'we'", "Never do:
// excessive exclamation marks", a list of landmark client names.
//
// PR #77 scoped only the legacy path below, on the grounds that Arak had zero
// brand_fields and so never reached the schema path. By 2026-10-14 Arak had 24
// of them, the schema path was the one running, and the untagged fields — the
// guardrails, the key-projects list, compliance — went to every task again:
// 2,548 characters into each picture prompt, about 15% of it visual.
//
// So the rule now lives in code, for both paths, rather than in how carefully
// someone tagged the Brand Brain:
//   · a field explicitly tagged for image/video is sent (someone decided);
//   · an untagged field whose name says it is visual is sent;
//   · an untagged guardrail is sent as ITS VISUAL LINES ONLY — "Generic
//     stock-photo lighting clichés" is a rule about pictures, "Speak as 'we'"
//     is not, and a never-do list is one rule per line;
//   · every other untagged field is dropped.
// Whatever is sent loses its staff-facing notes ("confirm with the client",
// "flagging rather than guessing") and any sentence about the logo — logos
// are placed afterwards as a real layer in the editor, exactly like text, and
// a described logo is an invitation to paint a wrong one.
//
// Every task that writes is untouched and still receives the whole blob.
export const DRAWING_TASKS = new Set(['image', 'video'])

const VISUAL_NAME = /visual|colou?r|palette|imagery|photograph|typograph|\bimage|\blook\b/i
const GUARDRAIL_COLUMNS = new Set(['tone_dos', 'tone_donts'])
const GUARDRAIL_NAME = /^(always|never)\b|\bdon'?ts?\b|\bavoid\b|guardrail/i
// A line of a free-text rule list that talks about what a picture shows.
const VISUAL_LINE = /photo|image|imagery|picture|visual|colou?r|palette|\bshots?\b|camera|\blens|render|stock|illustrat|graphic|cartoon|clip ?art|filter|saturat|contrast|composition|aesthetic|\blook/i
// Notes written for the people maintaining the Brand Brain, not for a model.
const STAFF_NOTE = /\bconfirm|\bflag(ging|ged)?\b|not found|\bTBC\b|to be confirmed|check with|ask the client|on the (live|current) site|\bplaceholder|\bTODO\b/i
const LOGO_TALK = /\blogo|\bwordmark|\blockup/i

// Only the lines of a rule list that are about the picture.
export function visualLines(text) {
  return String(text || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && VISUAL_LINE.test(l))
    .join('\n')
}

// A visual field with the staff notes and the logo talk taken out. Notes
// trail the fact they qualify ("…dark backgrounds — a variant was not found;
// confirm with the client"), so a sentence keeps the clauses BEFORE its first
// note, and a sentence that opens with one is dropped whole.
export function cleanVisualText(text) {
  return String(text || '').split('\n').map(line => line
    .split(/(?<=[.!?])\s+/)
    .map(sentence => {
      if (LOGO_TALK.test(sentence)) return ''
      const clauses = sentence.split(/\s+[—–]\s+|;\s+/)
      const firstNote = clauses.findIndex(c => STAFF_NOTE.test(c))
      if (firstNote === -1) return sentence.trim()
      const kept = clauses.slice(0, firstNote).join(' — ').trim().replace(/[,;:—–\s]+$/, '')
      return kept ? (/[.!?]$/.test(kept) ? kept : `${kept}.`) : ''
    })
    .filter(Boolean)
    .join(' '))
    .filter(l => l.trim())
    .join('\n')
}

function isGuardrailField(f) {
  return f.section_key === 'guardrails' || GUARDRAIL_COLUMNS.has(f.storage_column) ||
    GUARDRAIL_NAME.test(f.label || '') || GUARDRAIL_NAME.test(f.prompt_label || '')
}
function isVisualField(f) {
  return /visual/i.test(f.section_key || '') ||
    [f.key, f.label, f.prompt_label].some(n => VISUAL_NAME.test(n || ''))
}

// The schema path's half. `explicit(f)` says whether this field (or its
// section) was tagged for the task on purpose — buildContext knows the
// section tags, this module does not. Values are rewritten in place through
// setFieldValue so the one flattener below still does all the formatting.
export function scopeProfileForDrawing(profile, explicit = () => false) {
  if (!profile?.fieldDefs?.length) return profile
  let out = profile
  const kept = []
  for (const f of profile.fieldDefs) {
    const value = getFieldValue(profile, f)
    let next
    if (explicit(f) || isVisualField(f)) next = cleanVisualText(value)
    else if (isGuardrailField(f)) next = visualLines(value)
    else continue
    if (!String(next).trim()) continue
    out = setFieldValue(out, f, next)
    kept.push(f)
  }
  return { ...out, fieldDefs: kept }
}

// The fixed columns a drawing task may read on the legacy path.
const LEGACY_VISUAL_KEYS = ['toneDos', 'toneDonts', 'visualIdentity', 'brandColors', 'visualStyleNotes']

// Flatten the structured profile + optional platform-specific notes into the
// single "instructions" string the existing n8n webhooks already expect.
// Keeps the webhook contract unchanged — workflows don't need to be rebuilt,
// they just receive a richer instructions block.
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
  // Same rule as scopeProfileForDrawing, applied to the fixed columns.
  const draws = DRAWING_TASKS.has(task)
  if (draws) {
    profile = {
      ...profile,
      toneDos:          visualLines(profile.toneDos),
      toneDonts:        visualLines(profile.toneDonts),
      visualIdentity:   cleanVisualText(profile.visualIdentity),
      brandColors:      cleanVisualText(profile.brandColors),
      visualStyleNotes: cleanVisualText(profile.visualStyleNotes),
    }
  }
  const only = key => (draws && !LEGACY_VISUAL_KEYS.includes(key) ? '' : profile[key])
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
