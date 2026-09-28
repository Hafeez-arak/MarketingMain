import crypto from 'node:crypto'
import { pickRecipients, blockReason, SUBSCRIBERS_GROUP } from '../../src/lib/email/contacts.js'
import { renderEmail, marketingProblems } from '../../src/lib/email/render.js'
import { renderDesign, designChecks, hasDesign } from '../../src/lib/email/design.js'
import { dailyCap } from '../../src/lib/email/warmup.js'
import { brandDateKey, brandWallToUtcISO } from '../../src/lib/brandTime.js'

// ─── The email engine ──────────────────────────────────────────────────────
// Everything that decides who gets an email and when, with its IO injected so
// it can be tested with stubs. api/email/[action].js owns auth and HTTP; this
// file owns the rules.
//
//   launch    campaign → one queued email_sends row per eligible recipient
//   dispatch  queued rows → Resend, within today's cap
//   applyEvent  a Resend webhook → the send row, the contact, the log
//   unsubscribe a token → the contact stops receiving marketing email
//
// Rules that live here and nowhere else:
//   • Marketing email goes only to marketing contacts in marketing groups.
//     Cold email is never sent through Resend (its terms forbid it, and a
//     suspension would stop the customer newsletter too).
//   • Every send re-checks the contact at the moment of sending: someone who
//     unsubscribed between launch and the morning run is skipped.
//   • A row is claimed (queued → sending) before it is handed to Resend.

export const MAX_BATCH = 100            // Resend's batch limit
export const MAX_BATCHES_PER_RUN = 8    // keeps one invocation well under 300s
export const MORNING = '09:00'          // brand time; the daily run and "schedule" both mean this

/** The sender, from settings, as Resend wants it. */
export function fromHeader(settings) {
  const name = String(settings?.from_name || '').replace(/[<>"]/g, '').trim()
  const email = String(settings?.from_email || '').trim()
  return name ? `${name} <${email}>` : email
}

export function unsubscribeUrl(baseUrl, token) {
  return `${String(baseUrl || '').replace(/\/$/, '')}/api/email/unsubscribe?t=${encodeURIComponent(token)}`
}

/** The newsletter sign-up link a cold email carries. The same per-contact token. */
export function subscribeUrl(baseUrl, token) {
  if (!baseUrl || !token) return ''
  return `${String(baseUrl).replace(/\/$/, '')}/api/email/subscribe?t=${encodeURIComponent(token)}`
}

const inList = ids => `(${ids.map(id => `"${id}"`).join(',')})`

/**
 * Queue a marketing campaign.
 *
 * @param {object} deps  { db }
 * @param {object} args  { workspaceId, campaignId, when: 'now'|'schedule', scheduleDate?: 'YYYY-MM-DD', now: Date }
 */
export async function launchCampaign({ db }, { workspaceId, campaignId, when, scheduleDate, now = new Date(), settings }) {
  const [campaign] = await db(`email_campaigns?id=eq.${campaignId}&workspace_id=eq.${workspaceId}&select=*`) || []
  if (!campaign) return { error: 'Campaign not found.', status: 404 }
  if (campaign.audience !== 'marketing') {
    return {
      error: 'Outreach is never sent through the marketing sender. It goes out from the outreach mailboxes.',
      status: 409,
    }
  }
  if (!['draft', 'paused', 'scheduled'].includes(campaign.status)) {
    return { error: `This campaign is already ${campaign.status}.`, status: 409 }
  }
  const designed = hasDesign(campaign.design)
  const problems = [
    // A designed email has no `body` to check; its blocks are checked instead.
    ...marketingProblems({ subject: campaign.subject, body: designed ? 'designed' : campaign.body, sender: settings }),
    ...(designed ? designChecks(campaign.design).problems : []),
  ]
  if (problems.length) return { error: problems.join(' '), status: 400 }
  if (!campaign.group_ids?.length) return { error: 'Choose at least one group to send to.', status: 400 }

  // The groups must be this workspace's AND marketing groups. A cold group
  // picked by editing a request is refused here, not just hidden in the UI.
  const groups = await db(`email_groups?workspace_id=eq.${workspaceId}&id=in.${inList(campaign.group_ids)}&select=id,audience`) || []
  const usable = groups.filter(g => g.audience === 'marketing').map(g => g.id)
  if (!usable.length) return { error: 'None of the chosen groups is a marketing group.', status: 400 }

  const memberships = await db(`email_group_members?workspace_id=eq.${workspaceId}&group_id=in.${inList(usable)}&select=group_id,contact_id`) || []
  const contactIds = [...new Set(memberships.map(m => m.contact_id))]
  const contacts = []
  for (let i = 0; i < contactIds.length; i += 200) {
    const slice = contactIds.slice(i, i + 200)
    contacts.push(...(await db(`email_contacts?workspace_id=eq.${workspaceId}&id=in.${inList(slice)}&select=*`) || []))
  }
  const { eligible, skipped } = pickRecipients({
    contacts, memberships, groupIds: usable, audience: 'marketing',
    language: campaign.language_only ? campaign.language : null,
  })
  if (!eligible.length) {
    return { error: 'Nobody in these groups can receive marketing email right now.', status: 400, skipped: skipped.length }
  }

  const dueAt = when === 'schedule' && scheduleDate
    ? brandWallToUtcISO(scheduleDate, MORNING)
    : now.toISOString()
  if (!dueAt) return { error: 'That schedule date is not valid.', status: 400 }

  const rows = eligible.map(c => ({
    workspace_id: workspaceId, campaign_id: campaign.id, contact_id: c.id,
    email: c.email, step: 0, status: 'queued', due_at: dueAt,
  }))
  for (let i = 0; i < rows.length; i += 500) {
    // ignore-duplicates: relaunching a paused campaign must not queue anyone twice.
    await db('email_sends?on_conflict=campaign_id,contact_id,step', {
      method: 'POST', body: rows.slice(i, i + 500), prefer: 'resolution=ignore-duplicates,return=minimal',
    })
  }

  const scheduled = when === 'schedule' && Date.parse(dueAt) > now.getTime()
  await db(`email_campaigns?id=eq.${campaign.id}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: {
      status: scheduled ? 'scheduled' : 'sending',
      scheduled_for: scheduled ? dueAt : null,
      recipients: eligible.length,
      from_name: settings.from_name || '', from_email: settings.from_email || '', reply_to: settings.reply_to || '',
      launched_at: campaign.launched_at || now.toISOString(),
      updated_at: now.toISOString(),
    },
  })
  return { queued: eligible.length, skipped: skipped.length, scheduled, dueAt }
}

/** Numbers the cap is computed from. `count` returns an exact row count for a PostgREST path. */
export async function sendingStats({ count }, { workspaceId, now = new Date() }) {
  const today = brandDateKey(now)
  const dayStart = brandWallToUtcISO(today, '00:00')
  const monthStart = brandWallToUtcISO(`${today.slice(0, 8)}01`, '00:00')
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  // Marketing sends only. Cold sends will live in the same table and must not
  // spend the Resend allowance or skew its health numbers.
  const base = `email_sends?workspace_id=eq.${workspaceId}&select=id,email_campaigns!inner(audience)&email_campaigns.audience=eq.marketing`
  const [sentToday, sentThisMonth, sent7, bounced7, complained7] = await Promise.all([
    count(`${base}&sent_at=gte.${dayStart}`),
    count(`${base}&sent_at=gte.${monthStart}`),
    count(`${base}&sent_at=gte.${weekAgo}`),
    count(`${base}&sent_at=gte.${weekAgo}&bounced_at=not.is.null`),
    count(`${base}&sent_at=gte.${weekAgo}&complained_at=not.is.null`),
  ])
  return { today, sentToday, sentThisMonth, recent: { sent: sent7, bounced: bounced7, complained: complained7 } }
}

export const DEFAULT_SETTINGS = Object.freeze({
  from_name: '', from_email: '', reply_to: '', company_address: '',
  warmup_started_on: null, warmup_enabled: true,
  provider_daily_limit: 100, provider_monthly_limit: 3000,
  cold_sending_enabled: false,
  newsletter_name: '', subscribe_offer: '', subscribe_gift_url: '',
})

export async function loadSettings({ db }, workspaceId) {
  const [row] = await db(`email_settings?workspace_id=eq.${workspaceId}&select=*`) || []
  return { ...DEFAULT_SETTINGS, ...(row || {}), workspace_id: workspaceId, saved: Boolean(row) }
}

/**
 * Send what is due for one workspace, within today's cap.
 *
 * @param {object} deps { db, count, resend }  resend.batch(emails) → { ok, ids?, status, error, retryable }
 * @param {object} args { workspaceId, baseUrl, now }
 */
export async function dispatch(deps, { workspaceId, baseUrl, now = new Date() }) {
  const { db, resend } = deps
  const settings = await loadSettings(deps, workspaceId)
  const result = { sent: 0, skipped: 0, failed: 0, stoppedBy: '', cap: null }
  if (!settings.from_email) { result.stoppedBy = 'No sender address in Settings.'; return result }

  // Scheduled campaigns whose morning has come start sending.
  await db(`email_campaigns?workspace_id=eq.${workspaceId}&status=eq.scheduled&scheduled_for=lte.${now.toISOString()}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'sending', updated_at: now.toISOString() },
  })

  const stats = await sendingStats(deps, { workspaceId, now })
  const cap = dailyCap({ settings, today: stats.today, sentToday: stats.sentToday, sentThisMonth: stats.sentThisMonth, recent: stats.recent })
  result.cap = cap
  let remaining = cap.remaining
  if (remaining <= 0) {
    result.stoppedBy = cap.health.state === 'paused' ? cap.health.reason : `Today's limit reached (${cap.cap}, set by ${cap.limitedBy}).`
    return result
  }

  const campaignCache = new Map()
  for (let batchNo = 0; batchNo < MAX_BATCHES_PER_RUN && remaining > 0; batchNo++) {
    const take = Math.min(MAX_BATCH, remaining)
    const due = await db(
      `email_sends?workspace_id=eq.${workspaceId}&status=eq.queued&due_at=lte.${now.toISOString()}` +
      '&select=id,campaign_id,contact_id,email,step,subject,body,email_campaigns!inner(status,audience)' +
      '&email_campaigns.status=eq.sending&email_campaigns.audience=eq.marketing' +
      `&order=due_at.asc,created_at.asc&limit=${take}`,
    ) || []
    if (!due.length) break

    // ── Claim ── queued → sending, conditionally. Only rows this call moved
    // come back, so a concurrent run cannot send the same row.
    const claimed = await db(`email_sends?id=in.${inList(due.map(d => d.id))}&status=eq.queued`, {
      method: 'PATCH', prefer: 'return=representation',
      body: { status: 'sending', updated_at: now.toISOString() },
    }) || []
    if (!claimed.length) break

    const contactIds = [...new Set(claimed.map(s => s.contact_id).filter(Boolean))]
    const contacts = contactIds.length
      ? await db(`email_contacts?workspace_id=eq.${workspaceId}&id=in.${inList(contactIds)}&select=*`) || []
      : []
    const contactById = new Map(contacts.map(c => [c.id, c]))

    const outgoing = []
    const skips = []
    for (const s of claimed) {
      if (!campaignCache.has(s.campaign_id)) {
        const [c] = await db(`email_campaigns?id=eq.${s.campaign_id}&workspace_id=eq.${workspaceId}&select=*`) || []
        campaignCache.set(s.campaign_id, c || null)
      }
      const campaign = campaignCache.get(s.campaign_id)
      const contact = contactById.get(s.contact_id)
      const reason = !campaign ? 'Campaign no longer exists' : blockReason(contact, 'marketing')
      if (reason) { skips.push({ id: s.id, reason }); continue }
      const sender = {
        from_name: campaign.from_name || settings.from_name,
        company_address: settings.company_address,
      }
      const unsub = unsubscribeUrl(baseUrl, contact.unsubscribe_token)
      const common = {
        subject: s.subject || campaign.subject,
        preheader: campaign.preheader,
        // The campaign's language, not the contact's: it is the language the
        // body is written in, and an English letter laid out right-to-left
        // with an Arabic footer reads as broken.
        language: campaign.language,
        contact, sender, unsubscribeUrl: unsub,
      }
      // A per-recipient body override is plain text by definition, so it wins
      // over the design; otherwise a designed campaign sends its design.
      const rendered = hasDesign(campaign.design) && !s.body
        ? renderDesign({ ...common, design: campaign.design })
        : renderEmail({ ...common, audience: 'marketing', body: s.body || campaign.body })
      outgoing.push({
        send: s, contact,
        email: {
          from: fromHeader({ from_name: sender.from_name, from_email: campaign.from_email || settings.from_email }),
          to: [contact.email],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          ...(campaign.reply_to || settings.reply_to ? { reply_to: campaign.reply_to || settings.reply_to } : {}),
          // RFC 8058 one-click unsubscribe. Gmail and Yahoo require it of bulk
          // senders; mail clients show it as an "Unsubscribe" button, which
          // is what people press instead of "Report spam".
          headers: {
            'List-Unsubscribe': `<${unsub}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
          tags: [
            { name: 'campaign', value: String(campaign.id) },
            { name: 'send', value: String(s.id) },
          ],
        },
      })
    }

    for (const k of skips) {
      await db(`email_sends?id=eq.${k.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { status: 'skipped', error: k.reason, updated_at: now.toISOString() } })
    }
    result.skipped += skips.length
    if (!outgoing.length) continue

    // Idempotency: the same set of claimed rows always makes the same key, so a
    // retried request inside 24h cannot send twice at Resend's end either.
    const idem = crypto.createHash('sha256').update(outgoing.map(o => o.send.id).sort().join(',')).digest('hex')
    const res = await resend.batch(outgoing.map(o => o.email), { idempotencyKey: `batch-${idem}` })

    if (!res.ok) {
      const ids = outgoing.map(o => o.send.id)
      // Rate limit or Resend down: hand the rows back to the queue untouched.
      // Anything else is a refusal that will repeat, so it is recorded.
      await db(`email_sends?id=in.${inList(ids)}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: res.retryable
          ? { status: 'queued', updated_at: now.toISOString() }
          : { status: 'failed', error: String(res.error || 'Resend refused the batch').slice(0, 500), updated_at: now.toISOString() },
      })
      if (!res.retryable) result.failed += ids.length
      result.stoppedBy = `Resend: ${res.error || res.status}`
      break
    }

    const sentAt = now.toISOString()
    for (let i = 0; i < outgoing.length; i++) {
      const o = outgoing[i]
      await db(`email_sends?id=eq.${o.send.id}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'sent', provider_id: res.ids?.[i] || null, sent_at: sentAt, error: '', updated_at: sentAt },
      })
    }
    await db(`email_contacts?workspace_id=eq.${workspaceId}&id=in.${inList(outgoing.map(o => o.contact.id))}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { last_sent_at: sentAt },
    })
    result.sent += outgoing.length
    remaining -= outgoing.length
  }

  // Warm-up starts on the first real send, not on the day Settings was saved.
  if (result.sent && !settings.warmup_started_on) {
    await db('email_settings?on_conflict=workspace_id', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { workspace_id: workspaceId, warmup_started_on: brandDateKey(now), updated_at: now.toISOString() },
    })
  }

  await closeFinished(deps, { workspaceId, now })
  if (!result.stoppedBy && remaining <= 0) result.stoppedBy = `Today's limit reached (${cap.cap}). The rest go out tomorrow morning.`
  return result
}

/** A sending campaign with nothing left queued or in flight is sent. */
export async function closeFinished({ db, count }, { workspaceId, now = new Date() }) {
  const sending = await db(`email_campaigns?workspace_id=eq.${workspaceId}&status=eq.sending&select=id`) || []
  for (const c of sending) {
    const open = await count(`email_sends?campaign_id=eq.${c.id}&status=in.(queued,sending)&select=id`)
    if (open === 0) {
      await db(`email_campaigns?id=eq.${c.id}&workspace_id=eq.${workspaceId}`, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { status: 'sent', completed_at: now.toISOString(), updated_at: now.toISOString() },
      })
    }
  }
}

// ─── Webhooks ──────────────────────────────────────────────────────────────

/**
 * Verify a Resend (Svix) webhook signature. Resend signs
 * `${svix-id}.${svix-timestamp}.${rawBody}` with HMAC-SHA256, keyed by the
 * base64 part of the `whsec_…` secret. Constant-time compare, 5-minute window
 * against replays.
 */
export function verifySvix({ secret, id, timestamp, signature, body, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false
  const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64')
  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest()
  for (const part of String(signature).split(' ')) {
    const [version, sig] = part.split(',')
    if (version !== 'v1' || !sig) continue
    const given = Buffer.from(sig, 'base64')
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true
  }
  return false
}

// How far along a send is. A later event never moves a row backwards: an
// "opened" arriving after "clicked" leaves it clicked.
const RANK = { queued: 0, sending: 1, sent: 2, delivered: 3, opened: 4, clicked: 5 }

/**
 * What a Resend event does to the send row and the contact.
 * Pure. Returns { send: patch|null, contact: patch|null }.
 */
export function eventEffects(type, send, data = {}, at = new Date().toISOString()) {
  const status = send?.status || 'sent'
  const forward = next => ((RANK[next] ?? -1) > (RANK[status] ?? -1) ? { status: next } : {})
  switch (type) {
    case 'email.sent':
      return { send: { ...forward('sent') }, contact: null }
    case 'email.delivered':
      return { send: { ...forward('delivered'), delivered_at: send?.delivered_at || at }, contact: null }
    case 'email.opened':
      return { send: { ...forward('opened'), opened_at: send?.opened_at || at }, contact: { last_opened_at: at } }
    case 'email.clicked':
      return { send: { ...forward('clicked'), clicked_at: send?.clicked_at || at }, contact: { last_clicked_at: at } }
    case 'email.bounced': {
      // Only a permanent bounce retires the address. A full mailbox or a
      // greylisting server is temporary and says nothing about the person.
      const kind = String(data?.bounce?.type || data?.bounce_type || '').toLowerCase()
      const permanent = !kind || /perm|hard/.test(kind)
      return {
        send: { status: 'bounced', bounced_at: at, error: String(data?.bounce?.message || data?.bounce?.subType || 'Bounced').slice(0, 300) },
        contact: permanent ? { status: 'bounced' } : null,
      }
    }
    case 'email.complained':
      return { send: { status: 'complained', complained_at: at }, contact: { status: 'complained' } }
    case 'email.suppressed':
      // Resend refused to send because this address bounced or complained
      // before, possibly from another campaign or app on the same account.
      return { send: { status: 'failed', error: 'Suppressed by Resend (earlier bounce or complaint)' }, contact: { status: 'bounced' } }
    case 'email.failed':
      return { send: { status: 'failed', error: String(data?.failed?.reason || data?.reason || 'Failed').slice(0, 300) }, contact: null }
    default:
      return { send: null, contact: null }
  }
}

export async function applyEvent({ db }, event, now = new Date()) {
  const type = String(event?.type || '')
  const data = event?.data || {}
  const providerId = String(data.email_id || data.id || '')
  const at = event?.created_at || now.toISOString()
  if (!providerId) return { ignored: 'no email id' }

  const [send] = await db(`email_sends?provider_id=eq.${encodeURIComponent(providerId)}&select=*&limit=1`) || []
  await db('email_events', {
    method: 'POST', prefer: 'return=minimal',
    body: { workspace_id: send?.workspace_id || null, send_id: send?.id || null, provider_id: providerId, type, payload: event },
  })
  if (!send) return { ignored: 'not one of ours' }

  const { send: sendPatch, contact: contactPatch } = eventEffects(type, send, data, at)
  if (sendPatch && Object.keys(sendPatch).length) {
    await db(`email_sends?id=eq.${send.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { ...sendPatch, updated_at: now.toISOString() } })
  }
  if (contactPatch && send.contact_id) {
    // A retired address stays retired: an "opened" arriving late must not
    // un-bounce anyone, so status only ever moves away from 'active'.
    const guard = contactPatch.status ? '&status=eq.active' : ''
    await db(`email_contacts?id=eq.${send.contact_id}&workspace_id=eq.${send.workspace_id}${guard}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { ...contactPatch, updated_at: now.toISOString() },
    })
  }
  return { applied: type }
}

// ─── Unsubscribe ───────────────────────────────────────────────────────────

export async function unsubscribe({ db }, token, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) return { ok: false }
  const rows = await db(`email_contacts?unsubscribe_token=eq.${token}&select=id,workspace_id,email,status`) || []
  const contact = rows[0]
  if (!contact) return { ok: false }
  if (contact.status === 'active') {
    await db(`email_contacts?id=eq.${contact.id}&workspace_id=eq.${contact.workspace_id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { status: 'unsubscribed', unsubscribed_at: now.toISOString(), updated_at: now.toISOString() },
    })
  }
  // Anything still queued for them is cancelled now rather than skipped
  // tomorrow, so the campaign numbers are right today.
  await db(`email_sends?contact_id=eq.${contact.id}&status=eq.queued`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', error: 'Unsubscribed', updated_at: now.toISOString() },
  })
  return { ok: true, email: contact.email }
}

// ─── Subscribe ─────────────────────────────────────────────────────────────
// A cold prospect pressed the sign-up button in an outreach email and then
// confirmed on the page. That is an opt-in, so the contact changes lanes:
//
//   • audience cold → marketing, consent → opted_in, subscribed_at stamped
//   • added to the marketing group SUBSCRIBERS_GROUP (made if missing), and
//     taken out of its cold groups, so outreach can never reach it again
//   • its queued outreach follow-ups are cancelled
//   • the outreach email it answered gets subscribed_at, so the campaign
//     can count sign-ups the way it counts replies
//
// Pressing it twice changes nothing the second time.

export async function subscribe({ db }, token, now = new Date()) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) return { ok: false }
  const [contact] = await db(`email_contacts?unsubscribe_token=eq.${token}&select=id,workspace_id,email,status,subscribed_at`) || []
  if (!contact) return { ok: false }
  const ws = contact.workspace_id
  const nowIso = now.toISOString()
  const already = Boolean(contact.subscribed_at)

  // The outreach email that brought them: the latest one we sent.
  const [send] = await db(`email_sends?contact_id=eq.${contact.id}&workspace_id=eq.${ws}&sent_at=not.is.null&select=id,campaign_id,subscribed_at&order=sent_at.desc&limit=1`) || []

  await db(`email_contacts?id=eq.${contact.id}&workspace_id=eq.${ws}`, {
    method: 'PATCH', prefer: 'return=minimal',
    body: {
      audience: 'marketing', consent: 'opted_in', status: 'active',
      ...(already ? {} : { subscribed_at: nowIso, subscribed_campaign_id: send?.campaign_id || null }),
      updated_at: nowIso,
    },
  })
  if (send && !send.subscribed_at) {
    await db(`email_sends?id=eq.${send.id}`, { method: 'PATCH', prefer: 'return=minimal', body: { subscribed_at: nowIso, updated_at: nowIso } })
  }
  await db(`email_sends?contact_id=eq.${contact.id}&workspace_id=eq.${ws}&status=eq.queued`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', error: 'Subscribed to the newsletter', updated_at: nowIso },
  })

  const groups = await db(`email_groups?workspace_id=eq.${ws}&select=id,name,audience`) || []
  const cold = groups.filter(g => g.audience === 'cold').map(g => g.id)
  if (cold.length) {
    await db(`email_group_members?workspace_id=eq.${ws}&contact_id=eq.${contact.id}&group_id=in.${inList(cold)}`, {
      method: 'DELETE', prefer: 'return=minimal',
    })
  }
  // Names are unique per workspace ignoring case (email_groups_ws_name_idx).
  let list = groups.find(g => g.audience === 'marketing' && String(g.name).toLowerCase() === SUBSCRIBERS_GROUP.toLowerCase())
  if (!list) {
    try {
      ;[list] = await db('email_groups', {
        method: 'POST', prefer: 'return=representation',
        body: { workspace_id: ws, name: SUBSCRIBERS_GROUP, audience: 'marketing', description: 'Signed up from an outreach email.' },
      }) || []
    } catch {
      // Two sign-ups at the same moment: the other one made it.
      ;[list] = await db(`email_groups?workspace_id=eq.${ws}&name=ilike.${encodeURIComponent(SUBSCRIBERS_GROUP)}&audience=eq.marketing&select=id`) || []
    }
  }
  if (list) {
    await db('email_group_members?on_conflict=group_id,contact_id', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: [{ group_id: list.id, contact_id: contact.id, workspace_id: ws }],
    })
  }

  const settings = await loadSettings({ db }, ws)
  return { ok: true, email: contact.email, already, settings }
}
