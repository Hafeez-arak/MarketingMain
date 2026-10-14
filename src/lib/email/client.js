import { supabase } from '../supabaseClient'
import { websiteOf } from './weekly'
import { STUCK_AFTER_MINUTES } from './cold'

// ─── Email: the browser's data layer ───────────────────────────────────────
// Plain table reads and writes go straight to Supabase with the person's own
// session (RLS applies). Anything that sends, spends, or needs a secret goes
// through /api/email/<action>, which re-checks membership server-side.
//
// Every query carries its own workspace_id filter. RLS here is membership,
// not isolation: the operators belong to every workspace, so without the
// filter one company's contacts would show up in another's list.

const PAGE = 1000

async function all(build) {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < PAGE) return out
  }
}

function check({ data, error }) {
  if (error) throw new Error(error.message)
  return data
}

// ── Reads ──
// Each tab reads only what it shows, when it is opened (src/pages/email/
// data.js keeps the answers for the session). Lists a person scrolls
// through are read a page at a time with a count; a read that needs every
// row on purpose (who a campaign goes to, a CSV export, a group's numbers)
// says so, and still pages past Supabase's 1,000-row cap with all().

export const PAGE_SIZE = 50

// The columns a campaign list, a name lookup or the dispatch check needs.
// The wording, design and versions (the heavy part) are read only when one
// campaign is opened: fetchCampaign.
const CAMPAIGN_LIST_COLUMNS = 'id,audience,name,subject,status,language,group_ids,recipients,scheduled_for,launched_at,completed_at,from_name,from_email,created_at,updated_at'

// email_group_members points at email_contacts twice (the id, and the id
// plus the workspace), so an embed has to name the one it follows.
const MEMBERS = 'email_group_members!email_group_members_contact_id_fkey'
const SEARCH_COLUMNS = ['email', 'first_name', 'last_name', 'company', 'job_title', 'city', 'notes']

/** One page of `build(selectOptions)`, with the total count. */
async function onePage(build, page, size) {
  const from = page * size
  const { data, error, count } = await build({ count: 'exact' }).range(from, from + size - 1)
  if (error) {
    // Past the end (rows were deleted since the count): say how many there
    // are now, so the pager can step back.
    if (error.code === 'PGRST103' && page > 0) {
      const head = await build({ count: 'exact', head: true })
      if (head.error) throw new Error(head.error.message)
      return { rows: [], count: head.count ?? 0 }
    }
    throw new Error(error.message)
  }
  return { rows: data || [], count: count ?? (data || []).length }
}

/** What every tab of the section needs. All small tables. */
export async function fetchEmailCore(ws) {
  const [groups, campaigns, stats, settingsRows, mailboxes] = await Promise.all([
    all(() => supabase.from('email_groups').select('*').eq('workspace_id', ws).order('name')),
    all(() => supabase.from('email_campaigns').select(CAMPAIGN_LIST_COLUMNS).eq('workspace_id', ws).order('created_at', { ascending: false })),
    all(() => supabase.from('email_campaign_stats').select('*').eq('workspace_id', ws)),
    all(() => supabase.from('email_settings').select('*').eq('workspace_id', ws)),
    // Outreach mailboxes. Their passwords live in another table this session
    // cannot read at all. Degrades to none.
    supabase.from('email_mailboxes').select('*').eq('workspace_id', ws).order('created_at')
      .then(r => r.data || [], () => []),
  ])
  return { groups, campaigns, stats, settings: settingsRows[0] || null, mailboxes }
}

/** The last 30 days of sends, for the Overview's rates. */
export async function fetchRecentSends(ws) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  return all(() => supabase.from('email_sends')
    .select('campaign_id,sent_at,opened_at,clicked_at,bounced_at,complained_at,replied_at,subscribed_at')
    .eq('workspace_id', ws).gte('sent_at', since))
}

/** How many contacts are in each lane, counted by the database. */
export async function fetchContactCounts(ws) {
  const count = filter => filter(supabase.from('email_contacts').select('id', { count: 'exact', head: true }).eq('workspace_id', ws))
    .then(({ count: n, error }) => { if (error) throw new Error(error.message); return n || 0 })
  const [marketing, cold, inactive] = await Promise.all([
    count(q => q.eq('status', 'active').eq('audience', 'marketing')),
    count(q => q.eq('status', 'active').eq('audience', 'cold')),
    count(q => q.neq('status', 'active')),
  ])
  return { marketing, cold, inactive }
}

/**
 * Every contact and every group membership, read in full on purpose: who a
 * campaign goes to (pickRecipients) and what each group can reach are
 * decided over all of them. The campaign editor and Groups only.
 */
export async function fetchAudience(ws) {
  const [contacts, members] = await Promise.all([
    all(() => supabase.from('email_contacts').select('*').eq('workspace_id', ws).order('created_at', { ascending: false })),
    all(() => supabase.from('email_group_members').select('group_id,contact_id').eq('workspace_id', ws)),
  ])
  return { contacts, members }
}

/** The latest weekly AI drafts. A failure must not blank the tab, so it degrades to none. */
export async function fetchAiDrafts(ws) {
  return supabase.from('email_ai_drafts').select('*').eq('workspace_id', ws)
    .order('week_of', { ascending: false }).limit(1)
    .then(r => r.data?.[0] || null, () => null)
}

// ── Contacts, a page at a time ──

/** A search box's text as a quoted ilike pattern for PostgREST's or(), or '' for none. */
export function searchPattern(raw) {
  const text = String(raw || '').trim().replace(/[%*]/g, '').replace(/["\\]/g, '\\$&')
  return text ? `"*${text}*"` : ''
}

function contactQuery(ws, f, columns, options) {
  const inGroup = f.group && f.group !== '__none'
  let q = supabase.from('email_contacts')
    .select(`${columns},groups:${MEMBERS}(group_id)${inGroup ? `,in_group:${MEMBERS}!inner(group_id)` : ''}`, options)
    .eq('workspace_id', ws)
  if (f.audience) q = q.eq('audience', f.audience)
  if (f.status) q = q.eq('status', f.status)
  if (f.type) q = q.eq('contact_type', f.type)
  if (f.group === '__none') q = q.is('groups', null)
  else if (inGroup) q = q.eq('in_group.group_id', f.group)
  const needle = searchPattern(f.q)
  if (needle) q = q.or(SEARCH_COLUMNS.map(c => `${c}.ilike.${needle}`).join(','))
  return q
}

/** A contact row with its groups as a plain list of ids. */
function withGroupIds(row) {
  const rest = { ...row }
  delete rest.groups
  delete rest.in_group
  return { ...rest, group_ids: (row.groups || []).map(g => g.group_id) }
}

/** One page of the contacts matching { q, audience, status, type, group }, newest first. */
export async function fetchContactsPage(ws, filters, page, size = PAGE_SIZE) {
  const { rows, count } = await onePage(
    options => contactQuery(ws, filters, '*', options).order('created_at', { ascending: false }).order('id'),
    page, size)
  return { rows: rows.map(withGroupIds), count }
}

/** Every contact matching the filters, on purpose: a CSV export, or "select all that match". */
export async function fetchContactsMatching(ws, filters, columns = '*') {
  const rows = await all(() => contactQuery(ws, filters, columns).order('created_at', { ascending: false }).order('id'))
  return rows.map(withGroupIds)
}

/** These contacts as they are now, with their groups; only those still matching `filters` when given. */
export async function fetchContactsByIds(ws, ids, columns = 'id,email,audience,status', filters = {}) {
  const out = []
  for (let i = 0; i < ids.length; i += 200) {
    const rows = check(await contactQuery(ws, filters, columns).in('id', ids.slice(i, i + 200)))
    out.push(...(rows || []).map(withGroupIds))
  }
  return out
}

/** Which of these addresses are already contacts. */
export async function existingEmails(ws, emails) {
  const out = new Set()
  for (let i = 0; i < emails.length; i += 200) {
    const rows = check(await supabase.from('email_contacts').select('email').eq('workspace_id', ws).in('email', emails.slice(i, i + 200)))
    for (const r of rows || []) out.add(r.email)
  }
  return out
}

/** Contacts tied to a research lead, for the research note above the list. */
export async function fetchLeadContacts(ws) {
  return all(() => supabase.from('email_contacts').select('id,email,opportunity_id')
    .eq('workspace_id', ws).not('opportunity_id', 'is', null))
}

/**
 * Prospects who answered outreach: signed up or replied. Filtered by the
 * database, then read whole: the set is small, its four numbers count all
 * of it, and its order (newest answer first, across two columns) is one
 * PostgREST cannot sort by.
 */
export async function fetchAnswered(ws) {
  return all(() => supabase.from('email_contacts')
    .select('id,email,first_name,last_name,company,job_title,language,status,subscribed_at,replied_at,subscribed_campaign_id')
    .eq('workspace_id', ws).or('subscribed_at.not.is.null,replied_at.not.is.null').order('id'))
}

// ── Campaigns and sends, a page at a time ──

/** One page of one lane's campaigns, newest first. */
export async function fetchCampaignsPage(ws, audience, page, size = PAGE_SIZE) {
  return onePage(
    options => supabase.from('email_campaigns').select(CAMPAIGN_LIST_COLUMNS, options)
      .eq('workspace_id', ws).eq('audience', audience).order('created_at', { ascending: false }).order('id'),
    page, size)
}

/** One campaign in full: wording, design, versions. null when it is gone. */
export async function fetchCampaign(ws, id) {
  return check(await supabase.from('email_campaigns').select('*').eq('workspace_id', ws).eq('id', id).maybeSingle())
}

const SEND_COLUMNS = 'id,email,step,status,error,sent_at,delivered_at,opened_at,clicked_at,bounced_at,complained_at,replied_at,subscribed_at,due_at,contact_id,mailbox_id,variant'

/** One page of a campaign's recipients, optionally of one status. */
export async function fetchCampaignSendsPage(ws, campaignId, { status = '', page = 0, size = PAGE_SIZE } = {}) {
  return onePage(options => {
    let q = supabase.from('email_sends').select(SEND_COLUMNS, options).eq('workspace_id', ws).eq('campaign_id', campaignId)
    if (status) q = q.eq('status', status)
    return q.order('created_at').order('id')
  }, page, size)
}

/** Emails a dead sending run left half-sent, for a person to settle. Degrades to none. */
export async function fetchStuckSends(ws, { campaignId = null, page = 0, size = 20 } = {}) {
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString()
  return onePage(options => {
    let q = supabase.from('email_sends').select('id,campaign_id,email,step,mailbox_id,status,updated_at,error', options)
      .eq('workspace_id', ws).eq('status', 'sending').lt('updated_at', stuckBefore)
    if (campaignId) q = q.eq('campaign_id', campaignId)
    return q.order('updated_at').order('id')
  }, page, size).catch(() => ({ rows: [], count: 0 }))
}

// ── Contacts ──

export async function saveContact(ws, contact, id = null) {
  const row = { ...contact, workspace_id: ws, updated_at: new Date().toISOString() }
  if (id) {
    return check(await supabase.from('email_contacts').update(row).eq('id', id).eq('workspace_id', ws).select().single())
  }
  const { data: { user } = {} } = await supabase.auth.getUser()
  return check(await supabase.from('email_contacts').insert({ ...row, created_by: user?.id || null }).select().single())
}

/** Insert in chunks; an address already present is skipped, never overwritten. */
export async function importContacts(ws, contacts, onProgress) {
  const { data: { user } = {} } = await supabase.auth.getUser()
  const inserted = []
  for (let i = 0; i < contacts.length; i += 500) {
    const chunk = contacts.slice(i, i + 500).map(c => ({ ...c, workspace_id: ws, created_by: user?.id || null }))
    const rows = check(await supabase.from('email_contacts')
      .upsert(chunk, { onConflict: 'workspace_id,email', ignoreDuplicates: true })
      .select('id,email'))
    inserted.push(...(rows || []))
    onProgress?.(Math.min(i + 500, contacts.length), contacts.length)
  }
  return inserted
}

export async function updateContacts(ws, ids, patch) {
  for (let i = 0; i < ids.length; i += 200) {
    check(await supabase.from('email_contacts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('workspace_id', ws).in('id', ids.slice(i, i + 200)))
  }
}

export async function deleteContacts(ws, ids) {
  for (let i = 0; i < ids.length; i += 200) {
    check(await supabase.from('email_contacts').delete().eq('workspace_id', ws).in('id', ids.slice(i, i + 200)))
  }
}

// ── Groups ──

export async function saveGroup(ws, group, id = null) {
  const row = {
    name: String(group.name || '').trim(),
    description: String(group.description || '').trim(),
    audience: group.audience === 'cold' ? 'cold' : 'marketing',
    color: group.color || 'steel',
    workspace_id: ws,
    updated_at: new Date().toISOString(),
  }
  const q = id
    ? supabase.from('email_groups').update(row).eq('id', id).eq('workspace_id', ws)
    : supabase.from('email_groups').insert(row)
  const { data, error } = await q.select().single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('A group with that name already exists.')
    throw new Error(error.message)
  }
  return data
}

export async function deleteGroup(ws, id) {
  check(await supabase.from('email_groups').delete().eq('id', id).eq('workspace_id', ws))
}

export async function addToGroup(ws, groupId, contactIds) {
  for (let i = 0; i < contactIds.length; i += 500) {
    const rows = contactIds.slice(i, i + 500).map(contact_id => ({ group_id: groupId, contact_id, workspace_id: ws }))
    check(await supabase.from('email_group_members').upsert(rows, { onConflict: 'group_id,contact_id', ignoreDuplicates: true }))
  }
}

export async function removeFromGroup(ws, groupId, contactIds) {
  for (let i = 0; i < contactIds.length; i += 200) {
    check(await supabase.from('email_group_members').delete()
      .eq('workspace_id', ws).eq('group_id', groupId).in('contact_id', contactIds.slice(i, i + 200)))
  }
}

/**
 * Run a plan from planGroupAction (src/lib/email/groupActions.js): the lane
 * first, then the joins, then the leaves, so a failure half-way never leaves
 * someone in no group they were meant to be moved into.
 */
export async function applyGroupPlan(ws, plan) {
  if (plan.patchIds.length) await updateContacts(ws, plan.patchIds, plan.patch)
  if (plan.add.length) await addToGroup(ws, plan.groupId, plan.add)
  for (const r of plan.remove) await removeFromGroup(ws, r.groupId, r.contactIds)
}

/** Make a contact's groups exactly `groupIds`. */
export async function setContactGroups(ws, contactId, groupIds, currentIds) {
  const want = new Set(groupIds)
  const have = new Set(currentIds)
  const add = [...want].filter(g => !have.has(g))
  const remove = [...have].filter(g => !want.has(g))
  for (const g of add) await addToGroup(ws, g, [contactId])
  for (const g of remove) await removeFromGroup(ws, g, [contactId])
}

// ── Campaigns ──

const CAMPAIGN_FIELDS = ['audience', 'name', 'subject', 'preheader', 'body', 'language', 'language_only', 'group_ids', 'follow_ups', 'design', 'mailbox_ids', 'variants']

export async function saveCampaign(ws, campaign, id = null) {
  const row = { workspace_id: ws, updated_at: new Date().toISOString() }
  for (const k of CAMPAIGN_FIELDS) if (campaign[k] !== undefined) row[k] = campaign[k]
  if (id) {
    // Only a draft (or a paused one, for wording fixes) may be edited; the
    // filter is what enforces it, not the button.
    return check(await supabase.from('email_campaigns').update(row).eq('id', id).eq('workspace_id', ws)
      .in('status', ['draft', 'paused']).select().single())
  }
  const { data: { user } = {} } = await supabase.auth.getUser()
  return check(await supabase.from('email_campaigns').insert({ ...row, created_by: user?.id || null }).select().single())
}

export async function deleteCampaign(ws, id) {
  check(await supabase.from('email_campaigns').delete().eq('id', id).eq('workspace_id', ws).in('status', ['draft', 'cancelled']))
}

/** Every send of a campaign: read in full on purpose, for the A/B/C version results. */
export async function fetchCampaignSends(ws, campaignId) {
  return all(() => supabase.from('email_sends')
    .select(SEND_COLUMNS)
    .eq('workspace_id', ws).eq('campaign_id', campaignId).order('created_at'))
}

// ── Research leads (Contacts tab) ──

/** Open research leads, for finding people to write to. Degrades to none. */
export async function fetchResearchLeads(ws) {
  const { data, error } = await supabase.from('research_opportunities')
    .select('id,type,name,headline,client,contractor,consultant,location,deadline,relevance,status,source_url,last_seen_at,outreach_dismissed_at')
    .eq('workspace_id', ws).in('status', ['new', 'assigned', 'pursued']).is('outreach_dismissed_at', null)
    .order('last_seen_at', { ascending: false }).limit(100)
  if (error) return []
  return data || []
}

/** "Not for outreach": the lead leaves the Contacts tab, and stays a lead in Insights. */
export async function dismissLeadForOutreach(ws, id) {
  check(await supabase.from('research_opportunities').update({ outreach_dismissed_at: new Date().toISOString() }).eq('id', id).eq('workspace_id', ws).select('id'))
}

// ── Settings ──

const SETTINGS_FIELDS = ['from_name', 'from_email', 'reply_to', 'company_address', 'warmup_enabled',
  'provider_daily_limit', 'provider_monthly_limit', 'cold_sending_enabled',
  'newsletter_name', 'subscribe_offer', 'subscribe_gift_url']

export async function saveSettings(ws, settings) {
  const row = { workspace_id: ws, updated_at: new Date().toISOString() }
  for (const k of SETTINGS_FIELDS) if (settings[k] !== undefined) row[k] = settings[k]
  return check(await supabase.from('email_settings').upsert(row, { onConflict: 'workspace_id' }).select().single())
}

// ── Server actions ──

export async function emailApi(action, workspaceId, payload = {}) {
  try {
    const res = await fetch(`/api/email/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, workspace_id: workspaceId }),
    })
    const data = await res.json().catch(() => null)
    if (!data) return { error: `The server returned ${res.status} with nothing in it.` }
    if (data.ok === false || !res.ok) return { error: data.error || `Request failed (${res.status}).`, ...data }
    return data
  } catch (err) {
    return { error: `Could not reach the server: ${err.message}` }
  }
}

// ── Brand kit for the design editor ──
// The logo and photos come from Brand Brain's asset library, which lives in
// the PUBLIC brand-assets bucket: an email image must be reachable by any
// inbox without signing in, and those URLs already are.
export async function fetchBrandKit(ws) {
  const [assets, profile] = await Promise.all([
    supabase.from('brand_assets').select('id,kind,title,public_url,created_at').eq('workspace_id', ws)
      .order('created_at', { ascending: false }).limit(200),
    supabase.from('brand_profile').select('brand_colors,contact_info,custom_fields').eq('workspace_id', ws).limit(1),
  ])
  const rows = (assets.data || []).filter(a => /^https:\/\//.test(a.public_url || '') && a.kind !== 'music')
  const p = profile.data?.[0] || {}
  return {
    logos: rows.filter(a => a.kind === 'logo'),
    photos: rows.filter(a => a.kind !== 'logo'),
    brandColors: p.brand_colors || '',
    // Brand Brain keeps the site as a custom field ("arak-sa.com"); older
    // profiles have it in the contact details. Same rule as the weekly drafts.
    website: websiteOf({ customFields: p.custom_fields || {}, contactInfo: p.contact_info || '' }),
  }
}

/** Copy a campaign into a new draft: same wording, design and groups. */
export async function duplicateCampaign(ws, campaign) {
  const copy = {}
  for (const k of CAMPAIGN_FIELDS) if (campaign[k] !== undefined) copy[k] = campaign[k]
  copy.name = `${campaign.name || campaign.subject || 'Untitled'} (copy)`
  return saveCampaign(ws, copy)
}

// ── Weekly AI drafts ──

/** Record what happened to one option (used → which campaign; or dismissed). */
export async function markWeeklyOption(ws, row, index, patch) {
  const options = (row.options || []).map((o, i) => (i === index ? { ...o, ...patch } : o))
  return check(await supabase.from('email_ai_drafts').update({ options, updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('workspace_id', ws).select().single())
}
