import { buildContext } from '../../src/lib/brandContextCore.js'
import { rowToProfile } from '../../src/lib/brandBrainCore.js'
import { volatileFragment } from '../../src/lib/agent/prompt.js'
import { db } from './_supabase.js'

// ─── What the agent knows about this workspace ─────────────────────────────
// AGENT.md §3, layer 1. This module has exactly one job: turn a workspace id
// into the stable prefix of a prompt.
//
// It goes through buildContext() and NOTHING ELSE. That function is already
// the single entry point for every brand-aware prompt in this app; an agent
// that assembled its own view of the brand would be a second source of truth,
// and the two would drift silently until an off-brand caption appeared with no
// traceable cause. If the agent ever needs a slice buildContext does not
// expose, the fix is to add it there — not to query around it.
//
// The IO is here rather than reusing the browser loaders because those read
// SUPABASE_URL from Vite's import.meta.env, which does not exist in a Node
// function. The pure half — buildContext itself — is shared, which is the half
// that matters. Same split n8nWebhookPaths.js already makes for the proxy.
//
// That share is why buildContext now lives in brandContextCore.js: importing
// it from brandContext.js throws under Node before a line runs, so until the
// split there was no server-side path to the one builder every prompt is
// supposed to go through.

/**
 * Identity is the same for every workspace, so it sits in its own system block
 * ahead of the brand block. Both are cached, but only this one is shared, and
 * keeping the boundary honest costs nothing.
 *
 * Everything the agent must not do is stated here rather than left to the
 * tool list to imply. The tools are the enforcement — there is no tool that
 * publishes and none that edits the Brand Brain — but a model that also
 * understands why will stop trying and stop apologising.
 */
export const IDENTITY = [
  'You are the marketing assistant for one brand. You work alongside the person',
  'asking, on whatever is in front of them.',
  '',
  'What you are for:',
  '- Answering questions about this brand, its posts, its numbers and its market.',
  '- Proposing rules, ideas and drafts — always as proposals a person accepts.',
  '- Reviewing work in progress when asked, with specifics rather than praise.',
  '',
  'How you answer:',
  '- Numbers come from tools, never from memory or estimation. If you did not',
  '  fetch it, say you did not fetch it.',
  '- Instagram findings prove; web findings explain. Label which you are using.',
  '- Say when a sample is too small to carry a conclusion. "n=3" is a fact, not',
  '  a hedge.',
  '- "Nothing changed" is a complete and useful answer. Do not manufacture a',
  '  finding to justify having run.',
  '',
  'What you never do:',
  '- You never publish, schedule, or send anything.',
  '- You never edit the Brand Brain. What the brand IS — its identity,',
  '  positioning, products, prices, the competitor list someone typed — is',
  '  authored by people. You may report that a finding contradicts it. You may',
  '  not change it.',
  '- You never work across brands. You see one workspace and only one.',
].join('\n')

/**
 * Load the four things buildContext needs, then build.
 *
 * Mirrors the Insights page's assembly exactly (rowsBySection keyed directory,
 * memory as rows) so that the agent and the existing surfaces are provably
 * looking at the same brain.
 *
 * @param {string} workspaceId  from the VERIFIED session
 * @param {string} task         a key in brandContext TASKS — 'chat' or 'research'
 */
export async function loadBrandContext(workspaceId, task = 'chat') {
  const [profileRows, sections, fields, columns, dirRows, memory] = await Promise.all([
    db(`brand_profile?workspace_id=eq.${workspaceId}&select=*`),
    db(`brand_sections?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc`),
    db(`brand_fields?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc`),
    db(`brand_directory_columns?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc`),
    db(`brand_directory_rows?workspace_id=eq.${workspaceId}&select=*&order=sort_order.asc,created_at.asc`),
    // Every status, not just active: the agent has to see what was REJECTED to
    // avoid re-proposing it next week. An assistant that asks the same
    // turned-down question every Monday is one people stop reading.
    db(`brand_memory?workspace_id=eq.${workspaceId}&select=*&order=created_at.desc`),
  ])

  const rowsBySection = {}
  for (const r of dirRows || []) (rowsBySection[r.section_key] ||= []).push(r)

  const schema = { sections: sections || [], fields: fields || [], columns: columns || [] }
  const directory = { rowsBySection, assets: [] }

  // Through rowToProfile, NOT the raw row. buildContext reads a profile in the
  // camelCase shape the browser's fetchBrandProfile produces — customFields,
  // fieldDefs, valueProposition — and a brand_profile row is snake_case with
  // no field definitions attached at all.
  //
  // Handing it the raw row does not throw. It returns a context with a blank
  // brand name (getBrandIdentity reads profile.customFields) and, with
  // fieldDefs empty, silently falls down buildInstructionsString's legacy
  // path, which drops every multi-word column — value_proposition, brand_story,
  // tone_dos, target_personas. A brand brain that looks assembled and is
  // two-thirds missing is precisely the drift this module exists to prevent,
  // and it would have shown up as nothing worse than slightly vague captions.
  //
  // fields is the workspace's own field definitions, in sort order, which is
  // what the schema-driven path needs to emit them under their own headings.
  const profile = rowToProfile(profileRows?.[0] || null, fields || [])

  const ctx = buildContext(profile, schema, directory, memory || [], { task })

  return {
    ctx,
    schema,
    directory,
    memory: memory || [],
    // The prompt's stable second block. buildContext output is a function of
    // rows a human edits, so it is stable between edits — which is exactly the
    // property prompt caching needs.
    brand: ctx.instructions || `BRAND: (nothing has been written in the Brand Brain for this workspace yet.)`,
  }
}

/**
 * Guard: the stable prefix must contain nothing that changes per request.
 *
 * Called on the way into a request rather than trusted, because this fails
 * silently — a timestamp in the prefix still produces a correct answer, at
 * roughly ten times the price, and nothing in the response says so. Returns
 * the offending fragment, or null.
 */
export function prefixRisk({ identity, brand }) {
  return volatileFragment(identity) || volatileFragment(brand)
}
