import { buildLeadCard, normaliseLeadCard, afterCallFields, senderDomain, objectionsFromCards } from '../../src/lib/sales/leadCard.js'
import { trackFields } from '../../src/lib/leads/pipeline.js'
import { pushCardAfterSave } from './_crmCard.js'

// ─── Battle cards for leads someone is working ─────────────────────────────
// A lead gets its card when it is assigned (the owner, 2026-10-19; it was
// approval until then): the card is the work on it, and when it is approved
// the same card goes to the CRM. The card is built once from what we already hold — no model call —
// and stored; after that it is the team's to edit, every part of it. See
// src/lib/sales/leadCard.js for what goes in it.
//
// Reads use the service key, after [action].js has checked the caller: a
// sales seat sees our accounts only as the one line on the card.

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))

const CARD_COLUMNS = 'lead_id,card,decision,quote_due,target_price,decides,competitors,built_at,updated_at,updated_by,crm_synced_at,crm_pulled_at,crm_sync_error'
const LEAD_COLUMNS = 'id,received_at,created_at,company,name,email,subject,message,summary,details,ask_next,category,verdict,human_verdict,sender_type,source_check,project_type,human_project_type,project_final,philips,approved_at,stage,source,channel,assigned_to'

const effective = (l) => l.human_verdict || l.verdict

/** Everything a card is built from, for one lead. */
async function context(deps, workspaceId, lead) {
  const domain = senderDomain(lead)
  const before = lead.received_at || lead.created_at
  const [icp, accounts, suppliers, profile, earlier, competitorBrands] = await Promise.all([
    deps.db(`sales_icp?workspace_id=eq.${workspaceId}&select=battle_cards,config`).then((r) => r || []).catch(() => []),
    deps.db(`sales_accounts?workspace_id=eq.${workspaceId}&select=name,orders,value_sar,last_order,status`).then((r) => r || []).catch(() => []),
    deps.db(`brand_directory_rows?workspace_id=eq.${workspaceId}&section_key=eq.suppliers&select=data`).then((r) => r || []).catch(() => []),
    deps.db(`brand_profile?workspace_id=eq.${workspaceId}&select=company_facts,key_projects`).then((r) => r || []).catch(() => []),
    domain && before
      ? deps.db(`leads?workspace_id=eq.${workspaceId}&email=ilike.*@${domain}&received_at=lt.${encodeURIComponent(before)}&id=neq.${lead.id}&select=received_at,subject,verdict,human_verdict&order=received_at.desc&limit=20`).then((r) => r || []).catch(() => [])
      : [],
    deps.db(`competitor_brands?workspace_id=eq.${workspaceId}&select=competitor,brand,relationship`).then((r) => r || []).catch(() => []),
  ])
  return {
    playbook: icp[0]?.battle_cards?.lead || null,
    objections: objectionsFromCards(icp[0]?.battle_cards || {}),
    icp: icp[0]?.config || null,
    keyProjects: profile[0]?.key_projects || '',
    competitorBrands,
    accounts,
    suppliers: suppliers.map((r) => r?.data?.name).filter(Boolean),
    companyFacts: profile[0]?.company_facts || '',
    // Earlier real enquiries only: a pitch or a resend from the same domain is not one.
    earlier: earlier.filter((e) => ['qualified', 'needs_review'].includes(effective(e))),
  }
}

/**
 * The competitor watchlist, for "who else is quoting": each active rival
 * with the note Research keeps on it and the brands it holds. Sent with the
 * card, never stored in it, so it is always the current list.
 */
export async function watchlist(deps, workspaceId) {
  const [rivals, brands] = await Promise.all([
    deps.db(`research_agenda?workspace_id=eq.${workspaceId}&kind=eq.competitor&status=eq.active&select=subject,why,domain,lines,city&order=subject`).then((r) => r || []).catch(() => []),
    deps.db(`competitor_brands?workspace_id=eq.${workspaceId}&select=competitor,brand,relationship`).then((r) => r || []).catch(() => []),
  ])
  return rivals.map((c) => ({
    name: c.subject, note: c.why || '', domain: c.domain || '', lines: c.lines || [], city: c.city || '',
    brands: brands.filter((b) => b.competitor === c.subject && b.relationship !== 'ended').map((b) => ({ brand: b.brand, relationship: b.relationship })),
  }))
}

async function readCard(deps, workspaceId, leadId) {
  const [row] = await deps.db(`lead_cards?lead_id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${CARD_COLUMNS}`) || []
  return row || null
}

/**
 * The lead's card, built and stored the first time it is asked for. Only an
 * approved lead has one. Two people opening it at once store one card.
 */
export async function openCard(deps, { workspaceId, leadId }) {
  if (!isUuid(leadId)) return { status: 400, error: 'Which lead?' }
  const existing = await readCard(deps, workspaceId, leadId)
  if (existing) return { card: existing }
  const [lead] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${LEAD_COLUMNS}`) || []
  if (!lead) return { status: 404, error: 'That lead is not in this company.' }
  // Someone has it (assigned, 2026-10-19), or it is in the pipeline: approved, or added by hand.
  if (!lead.approved_at && !lead.stage && !lead.assigned_to) return { status: 409, error: 'The battle card is made when the lead is assigned.' }
  const card = buildLeadCard(lead, await context(deps, workspaceId, lead))
  const now = deps.now().toISOString()
  await deps.db('lead_cards?on_conflict=lead_id', {
    method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
    body: { lead_id: leadId, workspace_id: workspaceId, card, built_at: now, updated_at: now },
  })
  return { card: await readCard(deps, workspaceId, leadId), built: true }
}

/**
 * Save the team's edits: the whole card and the after-call fields. The next
 * step and the follow-up date belong to the lead (the Pipeline lists them),
 * so they are saved on it. Whatever comes in is cut back to shape first.
 */
export async function saveCard(deps, { workspaceId, leadId, user, body = {} }) {
  if (!isUuid(leadId)) return { status: 400, error: 'Which lead?' }
  const after = afterCallFields(body)
  if (after.error) return { status: 400, error: after.error }
  const track = trackFields({ next_step: body.next_step, follow_up: body.follow_up })
  if (track.error) return { status: 400, error: track.error }
  const existing = await readCard(deps, workspaceId, leadId)
  if (!existing) return { status: 404, error: 'This lead has no battle card yet. Open it first.' }
  const [row] = await deps.db(`lead_cards?lead_id=eq.${leadId}&workspace_id=eq.${workspaceId}&select=${CARD_COLUMNS}`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { card: normaliseLeadCard(body.card ?? existing.card), ...after.values, updated_by: user?.id || null, updated_at: deps.now().toISOString() },
  }) || []
  if (!row) return { status: 404, error: 'This lead has no battle card yet. Open it first.' }
  let lead = null
  if (Object.keys(track.values).length) {
    ;[lead] = await deps.db(`leads?id=eq.${leadId}&workspace_id=eq.${workspaceId}`, {
      method: 'PATCH', prefer: 'return=representation', body: { ...track.values, updated_at: deps.now().toISOString() },
    }) || []
  }
  // Already in Odoo: the change goes there now, with a note in its history
  // (2026-10-20). A failure is kept on the card and retried; the save stands.
  const odoo = await pushCardAfterSave(deps, { workspaceId, leadId, user }).catch((err) => ({ ok: false, error: String(err.message || err) }))
  return { card: row, lead, odoo }
}
