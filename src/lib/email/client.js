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

export async function fetchEmailData(ws) {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const stuckBefore = new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000).toISOString()
  const [contacts, groups, members, campaigns, stats, settingsRows, sends, aiDrafts, mailboxes, stuckSends] = await Promise.all([
    all(() => supabase.from('email_contacts').select('*').eq('workspace_id', ws).order('created_at', { ascending: false })),
    all(() => supabase.from('email_groups').select('*').eq('workspace_id', ws).order('name')),
    all(() => supabase.from('email_group_members').select('group_id,contact_id').eq('workspace_id', ws)),
    all(() => supabase.from('email_campaigns').select('*').eq('workspace_id', ws).order('created_at', { ascending: false })),
    all(() => supabase.from('email_campaign_stats').select('*').eq('workspace_id', ws)),
    all(() => supabase.from('email_settings').select('*').eq('workspace_id', ws)),
    all(() => supabase.from('email_sends')
      .select('campaign_id,sent_at,opened_at,clicked_at,bounced_at,complained_at')
      .eq('workspace_id', ws).gte('sent_at', since)),
    // The latest weekly AI drafts. A failure here (say, the table not yet
    // migrated) must not blank the whole section, so it degrades to none.
    supabase.from('email_ai_drafts').select('*').eq('workspace_id', ws)
      .order('week_of', { ascending: false }).limit(1)
      .then(r => r.data || [], () => []),
    // Outreach mailboxes. Their passwords live in another table this session
    // cannot read at all. Degrades to none, like the drafts.
    supabase.from('email_mailboxes').select('*').eq('workspace_id', ws).order('created_at')
      .then(r => r.data || [], () => []),
    // Emails a dead sending run left half-sent, for a person to settle.
    supabase.from('email_sends').select('id,campaign_id,email,step,mailbox_id,status,updated_at,error')
      .eq('workspace_id', ws).eq('status', 'sending').lt('updated_at', stuckBefore).order('updated_at').limit(200)
      .then(r => r.data || [], () => []),
  ])
  return {
    contacts, groups, members, campaigns, stats, settings: settingsRows[0] || null, recentSends: sends,
    aiDrafts: aiDrafts[0] || null, mailboxes, stuckSends,
  }
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

const CAMPAIGN_FIELDS = ['audience', 'name', 'subject', 'preheader', 'body', 'language', 'language_only', 'group_ids', 'follow_ups', 'design', 'mailbox_ids']

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

export async function fetchCampaignSends(ws, campaignId) {
  return all(() => supabase.from('email_sends')
    .select('id,email,step,status,error,sent_at,delivered_at,opened_at,clicked_at,bounced_at,complained_at,replied_at,subscribed_at,due_at,contact_id,mailbox_id')
    .eq('workspace_id', ws).eq('campaign_id', campaignId).order('created_at'))
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
