import { pickRecipients, blockReason, fullName } from '../../src/lib/email/contacts.js'
import { renderEmail, applyMergeTags } from '../../src/lib/email/render.js'
import { brandDateKey, brandWallToUtcISO } from '../../src/lib/brandTime.js'
import {
  HARD_MAX_PER_WORKSPACE, RECONTACT_DAYS, mailboxReadiness, mailboxCap, inSendingWindow,
  nextWindowStart, gapMinutes, mailboxHealthProblem, followUpSubject, makeMessageId, classifySmtpError, coldProblems,
  SENDING_PROVIDERS, inboxMessageKind,
} from '../../src/lib/email/cold.js'
import { closeFinished } from './_engine.js'

export { coldProblems }

// ─── The cold lane: launch and the sending run ─────────────────────────────
// IO injected, like _engine.js, so every rule here runs in tests without a
// mail server:
//
//   deps.db(path, init)        PostgREST (service key)
//   deps.count(path)           exact row count
//   deps.mail.send(mb, pw, m)  one email, by the mailbox's provider (SMTP or
//                              Microsoft Graph) → { ok, messageId, threadId? } | { ok:false, error }
//   deps.mail.inbox(mb, pw, since)  Microsoft only: inbox messages since then
//   deps.open(sealed)          decrypt a stored app password or Microsoft
//                              sign-in → string | null
//   deps.uuid()                a fresh id for Message-IDs
//   deps.random()              0..1, for the gap between sends
//
// What a launch does: queue step 0 for every eligible prospect, with NO
// mailbox yet. The run gives each row to whichever ready mailbox is free, so
// the load spreads by itself and a paused mailbox strands nobody.
//
// What a run does, every ~10 minutes from n8n: for each workspace whose cold
// switch is on, for each ready mailbox whose gap has passed and whose day
// still has room, send ONE email — a due follow-up first (same mailbox, same
// thread), otherwise the next first email. Then set the mailbox's next
// moment a random gap ahead. That is the whole pacing model.
//
// Never twice: the mailbox is claimed (next_send_at moved forward, only if
// it had passed) and then the row (queued → sending, only if still queued),
// each in one conditional PATCH. Two overlapping runs cannot both win either.
// A row whose send crashed after the SMTP server took it stays 'sending'
// rather than being retried: a duplicate cold email is worse than a lost one.

const DAY = 86_400_000
const inList = ids => `(${ids.map(id => `"${id}"`).join(',')})`
const providerFilter = `provider=in.(${SENDING_PROVIDERS.join(',')})`

/** What fixes a mailbox whose login stopped working, by provider. */
const reconnectHint = mb => (mb.provider === 'microsoft'
  ? 'Reconnect it: sign in to Microsoft as this mailbox again.'
  : 'Reconnect it with a new app password.')

/**
 * Start a cold campaign.
 * @param {object} args { workspaceId, campaignId, when: 'now'|'schedule', scheduleDate?, now }
 */
export async function launchColdCampaign({ db }, { workspaceId, campaignId, when = 'now', scheduleDate, now = new Date() }) {
  const [campaign] = await db(`email_campaigns?id=eq.${campaignId}&workspace_id=eq.${workspaceId}&select=*`) || []
  if (!campaign) return { error: 'Campaign not found.', status: 404 }
  if (campaign.audience !== 'cold') return { error: 'This is not an outreach campaign.', status: 409 }
  if (!['draft', 'paused', 'scheduled'].includes(campaign.status)) {
    return { error: `This campaign is already ${campaign.status}.`, status: 409 }
  }
  const problems = coldProblems(campaign)
  if (problems.length) return { error: problems.join(' '), status: 400 }
  if (!campaign.group_ids?.length) return { error: 'Choose at least one group to send to.', status: 400 }

  // Mailboxes first: with none ready, nothing is queued at all.
  const today = brandDateKey(now)
  const all = await db(`email_mailboxes?workspace_id=eq.${workspaceId}&${providerFilter}&select=*&order=email.asc`) || []
  const chosen = campaign.mailbox_ids?.length ? all.filter(m => campaign.mailbox_ids.includes(m.id)) : all
  if (!chosen.length) return { error: 'No outreach mailbox is connected. Add one in Email → Settings.', status: 409 }
  const ready = chosen.filter(m => mailboxReadiness(m, today).ready)
  if (!ready.length) {
    const why = chosen.map(m => `${m.email}: ${mailboxReadiness(m, today).reason}`).join(' ')
    return { error: `No chosen mailbox can send yet. ${why}`, status: 409 }
  }

  const groups = await db(`email_groups?workspace_id=eq.${workspaceId}&id=in.${inList(campaign.group_ids)}&select=id,audience`) || []
  const usable = groups.filter(g => g.audience === 'cold').map(g => g.id)
  if (!usable.length) return { error: 'None of the chosen groups is a cold group.', status: 400 }

  const memberships = await db(`email_group_members?workspace_id=eq.${workspaceId}&group_id=in.${inList(usable)}&select=group_id,contact_id`) || []
  const contactIds = [...new Set(memberships.map(m => m.contact_id))]
  const contacts = []
  for (let i = 0; i < contactIds.length; i += 200) {
    const slice = contactIds.slice(i, i + 200)
    contacts.push(...(await db(`email_contacts?workspace_id=eq.${workspaceId}&id=in.${inList(slice)}&select=*`) || []))
  }
  const { eligible, skipped } = pickRecipients({
    contacts, memberships, groupIds: usable, audience: 'cold',
    language: campaign.language_only ? campaign.language : null,
  })

  // Nobody gets two sequences at once, or a second one within 90 days.
  const since = new Date(now.getTime() - RECONTACT_DAYS * DAY).toISOString()
  const busy = new Set()
  for (let i = 0; i < eligible.length; i += 200) {
    const slice = eligible.slice(i, i + 200).map(c => c.id)
    const rows = await db(
      `email_sends?workspace_id=eq.${workspaceId}&contact_id=in.${inList(slice)}&campaign_id=neq.${campaign.id}` +
      `&or=(sent_at.gte.${since},status.in.(queued,sending))&select=contact_id`,
    ) || []
    for (const r of rows) busy.add(r.contact_id)
  }
  const recipients = eligible.filter(c => !busy.has(c.id))
  if (!recipients.length) {
    return {
      error: busy.size
        ? 'Everyone in these groups was written to by another outreach campaign in the last 90 days, or is in one now.'
        : 'Nobody in these groups can receive outreach right now.',
      status: 400, skipped: skipped.length, recontact: busy.size,
    }
  }

  const dueAt = when === 'schedule' && scheduleDate ? brandWallToUtcISO(scheduleDate, '09:00') : now.toISOString()
  if (!dueAt) return { error: 'That start date is not valid.', status: 400 }

  const rows = recipients.map(c => ({
    workspace_id: workspaceId, campaign_id: campaign.id, contact_id: c.id,
    email: c.email, step: 0, status: 'queued', due_at: dueAt,
  }))
  for (let i = 0; i < rows.length; i += 500) {
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
      recipients: recipients.length,
      from_name: '', reply_to: '',
      from_email: ready.map(m => m.email).join(', ').slice(0, 500),
      launched_at: campaign.launched_at || now.toISOString(),
      updated_at: now.toISOString(),
    },
  })
  const perDay = ready.reduce((n, m) => n + mailboxCap(m, today).cap, 0)
  return { queued: recipients.length, skipped: skipped.length, recontact: busy.size, scheduled, dueAt, mailboxes: ready.length, perDay }
}

/**
 * One sending run.
 * @param {object} args { now, dryRun, workspaceId? }
 *   dryRun: decide everything, send and write nothing, and say per mailbox
 *   what it would do and why. This is the "test mode" the Settings screen
 *   shows as "What goes out next".
 */
export async function coldTick(deps, { now = new Date(), dryRun = false, workspaceId = null } = {}) {
  const { db } = deps
  const result = { sent: 0, skipped: 0, failed: 0, window: inSendingWindow(now), nextWindow: null, workspaces: [] }
  if (!result.window) {
    result.nextWindow = nextWindowStart(now)?.toISOString() || null
    // A dry run still explains each mailbox; a real run has nothing to do.
    if (!dryRun) return result
  }

  const filter = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''
  const switchedOn = dryRun && workspaceId
    ? [{ workspace_id: workspaceId }]
    : await db(`email_settings?cold_sending_enabled=is.true${filter}&select=workspace_id`) || []

  for (const { workspace_id: ws } of switchedOn) {
    const out = { workspaceId: ws, sent: 0, mailboxes: [] }
    result.workspaces.push(out)
    try {
      await runWorkspace(deps, { ws, now, dryRun, out, result })
    } catch (err) {
      out.error = String(err?.message || err).slice(0, 300)
    }
  }
  return result
}

async function runWorkspace(deps, { ws, now, dryRun, out, result }) {
  const { db, count } = deps
  const nowIso = now.toISOString()
  if (!dryRun) {
    await db(`email_campaigns?workspace_id=eq.${ws}&audience=eq.cold&status=eq.scheduled&scheduled_for=lte.${nowIso}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'sending', updated_at: nowIso },
    })
  }
  const campaigns = await db(`email_campaigns?workspace_id=eq.${ws}&audience=eq.cold&status=eq.sending&select=*`) || []
  const mailboxes = await db(`email_mailboxes?workspace_id=eq.${ws}&${providerFilter}&select=*&order=last_sent_at.asc.nullsfirst`) || []
  if (!campaigns.length && !dryRun) return

  const today = brandDateKey(now)
  const dayStart = brandWallToUtcISO(today, '00:00')
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString()
  let wsSentToday = await count(`email_sends?workspace_id=eq.${ws}&mailbox_id=not.is.null&sent_at=gte.${dayStart}&select=id`)

  for (const mb of mailboxes) {
    const line = { mailbox: mb.email, action: 'wait', reason: '', next: null }
    out.mailboxes.push(line)

    const readiness = mailboxReadiness(mb, today)
    if (!readiness.ready) { line.reason = readiness.reason; continue }

    const [sent7, bounced7] = await Promise.all([
      count(`email_sends?mailbox_id=eq.${mb.id}&sent_at=gte.${weekAgo}&select=id`),
      count(`email_sends?mailbox_id=eq.${mb.id}&sent_at=gte.${weekAgo}&bounced_at=not.is.null&select=id`),
    ])
    const sick = mailboxHealthProblem({ sent: sent7, bounced: bounced7 })
    if (sick) {
      line.reason = sick
      if (!dryRun) await patchMailbox(db, mb.id, { status: 'paused', status_reason: sick, updated_at: nowIso })
      continue
    }

    const { cap } = mailboxCap(mb, today)
    const sentToday = await count(`email_sends?mailbox_id=eq.${mb.id}&sent_at=gte.${dayStart}&select=id`)
    line.sentToday = sentToday
    line.capToday = cap

    const allowed = campaigns.filter(c => !c.mailbox_ids?.length || c.mailbox_ids.includes(mb.id))
    const row = allowed.length ? await nextRow(db, { ws, mb, campaignIds: allowed.map(c => c.id), nowIso }) : null
    if (row) line.next = { email: row.email, step: row.step, campaign: allowed.find(c => c.id === row.campaign_id)?.name || '' }

    if (!allowed.length) { line.reason = 'No running outreach campaign uses this mailbox.'; continue }
    if (!row) { line.reason = 'Nothing due for this mailbox right now.'; continue }
    if (sentToday >= cap) { line.reason = `Today's ${cap} sent. More tomorrow.`; continue }
    if (wsSentToday >= HARD_MAX_PER_WORKSPACE) { line.reason = `The company-wide ceiling of ${HARD_MAX_PER_WORKSPACE} a day is reached.`; continue }
    if (!result.window) { line.reason = `Outside sending hours. Next window ${result.nextWindow || 'unknown'}.`; continue }
    if (mb.next_send_at && Date.parse(mb.next_send_at) > now.getTime()) {
      line.reason = `Waiting for its gap, until ${mb.next_send_at}.`
      continue
    }
    if (dryRun) { line.action = 'send'; line.reason = 'Would send now.'; continue }

    const outcome = await sendOne(deps, { ws, mb, row, campaign: allowed.find(c => c.id === row.campaign_id), now, cap })
    line.action = outcome.action
    line.reason = outcome.reason
    if (outcome.action === 'sent') { result.sent++; out.sent++; wsSentToday++ }
    else if (outcome.action === 'skipped') result.skipped++
    else if (outcome.action === 'failed') result.failed++
  }

  if (!dryRun) await closeFinished(deps, { workspaceId: ws, now })
}

/** A due follow-up for this mailbox first (it is part of a thread), then the next first email. */
async function nextRow(db, { ws, mb, campaignIds, nowIso }) {
  const base = `email_sends?workspace_id=eq.${ws}&status=eq.queued&due_at=lte.${nowIso}&campaign_id=in.${inList(campaignIds)}`
  const cols = '&select=id,campaign_id,contact_id,email,step,subject,body,mailbox_id'
  const [followUp] = await db(`${base}&mailbox_id=eq.${mb.id}&step=gt.0${cols}&order=due_at.asc&limit=1`) || []
  if (followUp) return followUp
  const [first] = await db(`${base}&mailbox_id=is.null&step=eq.0${cols}&order=due_at.asc,created_at.asc&limit=1`) || []
  return first || null
}

async function patchMailbox(db, id, body) {
  await db(`email_mailboxes?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body })
}

async function patchSend(db, id, body) {
  await db(`email_sends?id=eq.${id}`, { method: 'PATCH', prefer: 'return=minimal', body })
}

async function sendOne(deps, { ws, mb, row, campaign, now, cap }) {
  const { db } = deps
  const nowIso = now.toISOString()
  const today = brandDateKey(now)

  // ── Claim the mailbox: its next moment moves a gap ahead, only if it had passed.
  const gap = gapMinutes(cap, deps.random ? deps.random() : Math.random())
  const nextAt = new Date(now.getTime() + gap * 60_000).toISOString()
  const claimedMb = await db(`email_mailboxes?id=eq.${mb.id}&status=eq.active&or=(next_send_at.is.null,next_send_at.lte.${nowIso})`, {
    method: 'PATCH', prefer: 'return=representation', body: { next_send_at: nextAt, updated_at: nowIso },
  }) || []
  if (!claimedMb.length) return { action: 'wait', reason: 'Another run is using this mailbox.' }
  // Hand the gap back if nothing ends up sent, so a skipped row costs no time.
  const releaseMailbox = () => patchMailbox(db, mb.id, { next_send_at: mb.next_send_at || null, updated_at: nowIso })

  // ── Claim the row.
  const messageId = makeMessageId(mb.email, deps.uuid())
  const claimed = await db(`email_sends?id=eq.${row.id}&status=eq.queued`, {
    method: 'PATCH', prefer: 'return=representation',
    body: { status: 'sending', mailbox_id: mb.id, message_id: messageId, updated_at: nowIso },
  }) || []
  if (!claimed.length) { await releaseMailbox(); return { action: 'wait', reason: 'That email was taken by another run.' } }
  const requeue = extra => patchSend(db, row.id, { status: 'queued', mailbox_id: row.step === 0 ? null : mb.id, message_id: null, updated_at: nowIso, ...extra })

  // ── Re-check the person at the moment of sending.
  const [contact] = await db(`email_contacts?id=eq.${row.contact_id}&workspace_id=eq.${ws}&select=*`) || []
  const blocked = blockReason(contact, 'cold')
  if (blocked) {
    await patchSend(db, row.id, { status: 'skipped', error: blocked, updated_at: nowIso })
    // A reply, an opt-out or a bounce ends every sequence for this person.
    if (contact) {
      await db(`email_sends?workspace_id=eq.${ws}&contact_id=eq.${contact.id}&status=eq.queued`, {
        method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', error: blocked, updated_at: nowIso },
      })
    }
    await releaseMailbox()
    return { action: 'skipped', reason: `${row.email}: ${blocked}` }
  }

  // ── What to send.
  let subject = row.subject || campaign.subject
  let body = row.body || campaign.body
  let references = []
  if (row.step > 0) {
    const fu = (campaign.follow_ups || [])[row.step - 1]
    if (!fu || !String(fu.body || '').trim()) {
      await patchSend(db, row.id, { status: 'cancelled', error: 'The follow-up was removed from the campaign', updated_at: nowIso })
      await releaseMailbox()
      return { action: 'skipped', reason: 'Follow-up removed.' }
    }
    const prior = await db(`email_sends?campaign_id=eq.${campaign.id}&contact_id=eq.${contact.id}&step=lt.${row.step}&select=step,subject,message_id,status&order=step.asc`) || []
    const first = prior.find(p => p.step === 0)
    body = row.body || fu.body
    subject = row.subject || followUpSubject(fu.subject, applyMergeTags(first?.subject || campaign.subject, contact))
    references = prior.map(p => p.message_id).filter(Boolean)
  }

  const password = deps.open(await secretOf(db, mb.id))
  if (!password) {
    await requeue({})
    await patchMailbox(db, mb.id, {
      status: 'error', status_reason: `Its ${mb.provider === 'microsoft' ? 'Microsoft sign-in' : 'app password'} can no longer be read. ${reconnectHint(mb)}`,
      next_send_at: mb.next_send_at || null, updated_at: nowIso,
    })
    return { action: 'failed', reason: 'Password unreadable; mailbox needs reconnecting.' }
  }

  const rendered = renderEmail({
    audience: 'cold', subject, body, language: campaign.language, contact, signature: mb.signature,
  })
  const res = await deps.mail.send(mb, password, {
    from: { name: mb.from_name || '', address: mb.email },
    to: { name: fullName(contact), address: contact.email },
    subject: rendered.subject, text: rendered.text, html: rendered.html,
    messageId,
    inReplyTo: references.length ? references[references.length - 1] : undefined,
    references,
  })

  if (!res.ok) {
    // Graph errors arrive already classified; SMTP ones are read here.
    const kind = res.error?.kind || classifySmtpError(res.error)
    const message = String(res.error?.response || res.error?.message || res.error || 'Send failed').slice(0, 300)
    if (kind === 'recipient') {
      await patchSend(db, row.id, { status: 'bounced', bounced_at: nowIso, error: message, updated_at: nowIso })
      await db(`email_contacts?id=eq.${contact.id}&workspace_id=eq.${ws}&status=eq.active`, {
        method: 'PATCH', prefer: 'return=minimal', body: { status: 'bounced', updated_at: nowIso },
      })
      return { action: 'failed', reason: `${row.email} does not exist (bounced).` }
    }
    await requeue({ error: message })
    if (kind === 'auth') {
      await patchMailbox(db, mb.id, { status: 'error', status_reason: res.error?.reason || `The login was refused. ${reconnectHint(mb)}`, last_error: message, updated_at: nowIso })
    } else if (kind === 'limit') {
      const tomorrow = nextWindowStart(new Date(Date.parse(brandWallToUtcISO(today, '23:59'))))
      await patchMailbox(db, mb.id, { next_send_at: tomorrow?.toISOString() || nextAt, last_error: message, updated_at: nowIso })
    } else {
      await patchMailbox(db, mb.id, { next_send_at: new Date(now.getTime() + 15 * 60_000).toISOString(), last_error: message, updated_at: nowIso })
    }
    return { action: 'failed', reason: `${kind}: ${message}` }
  }

  await patchSend(db, row.id, {
    status: 'sent', sent_at: nowIso, provider_id: res.messageId || messageId, subject: rendered.subject, error: '', updated_at: nowIso,
    // The real Message-ID (Microsoft may assign its own) is what follow-ups
    // must reply to; the thread is how the inbox reader finds answers.
    ...(res.messageId && res.messageId !== messageId ? { message_id: res.messageId } : {}),
    ...(res.threadId ? { thread_id: res.threadId } : {}),
  })
  await db(`email_contacts?id=eq.${contact.id}&workspace_id=eq.${ws}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_sent_at: nowIso } })
  await patchMailbox(db, mb.id, {
    last_sent_at: nowIso, first_sent_on: mb.first_sent_on || today, last_error: '', updated_at: nowIso,
  })

  // The next step is queued now, on this mailbox, due after its wait.
  const next = (campaign.follow_ups || [])[row.step]
  if (next && String(next.body || '').trim()) {
    const days = Math.min(30, Math.max(1, Number(next.delay_days) || 3))
    await db('email_sends?on_conflict=campaign_id,contact_id,step', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: [{
        workspace_id: ws, campaign_id: campaign.id, contact_id: contact.id, email: contact.email,
        step: row.step + 1, status: 'queued', mailbox_id: mb.id,
        due_at: new Date(now.getTime() + days * DAY).toISOString(),
      }],
    })
  }
  return { action: 'sent', reason: `Sent ${row.step === 0 ? 'first email' : `follow-up ${row.step}`} to ${row.email}.` }
}

async function secretOf(db, mailboxId) {
  const [row] = await db(`email_mailbox_secrets?mailbox_id=eq.${mailboxId}&select=secret`) || []
  return row?.secret || ''
}


// ─── Reading replies and bounces (Microsoft 365 mailboxes) ─────────────────
// Every run, before sending, each connected Microsoft mailbox's inbox is read
// from where the last run stopped. A message in the thread of one of our
// sends is one of three things (src/lib/email/cold.js, inboxMessageKind):
//
//   reply   the prospect (or a colleague on the thread) answered: the send
//           and the contact get replied_at, and every queued email to that
//           person is cancelled. blockReason() keeps them out of outreach
//           from then on.
//   bounce  the address does not exist: the send and the contact bounce, and
//           the bounce brake counts it.
//   auto    an out-of-office: ignored, the sequence carries on.
//
// Only the sender, subject and thread are read, never the body. It runs
// whether or not outreach sending is switched on: an answer to an email we
// already sent must stop the follow-ups either way.

const INBOX_LOOKBACK_MS = 3 * DAY
const INBOX_OVERLAP_MS = 60_000

export async function readReplies(deps, { now = new Date(), workspaceId = null } = {}) {
  const { db } = deps
  const filter = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''
  const mailboxes = await db(`email_mailboxes?provider=eq.microsoft&status=in.(active,paused)${filter}&select=*`) || []
  const out = { mailboxes: 0, replies: 0, bounces: 0, errors: [] }
  for (const mb of mailboxes) {
    try {
      const r = await readMailbox(deps, mb, now)
      out.mailboxes++
      out.replies += r.replies
      out.bounces += r.bounces
    } catch (err) {
      out.errors.push(`${mb.email}: ${String(err?.message || err).slice(0, 200)}`)
    }
  }
  return out
}

async function readMailbox(deps, mb, now) {
  const { db } = deps
  const nowIso = now.toISOString()
  const since = mb.inbox_checked_at
    ? new Date(Date.parse(mb.inbox_checked_at) - INBOX_OVERLAP_MS)
    : new Date(Math.max(Date.parse(mb.created_at || nowIso) || 0, now.getTime() - INBOX_LOOKBACK_MS))

  const plain = deps.open(await secretOf(db, mb.id))
  if (!plain) return { replies: 0, bounces: 0 }   // the sending run flags it
  const res = await deps.mail.inbox(mb, plain, since.toISOString())
  if (!res.ok) {
    if (res.error?.kind === 'auth') {
      await patchMailbox(db, mb.id, {
        status: 'error', status_reason: res.error.reason || `The login was refused. ${reconnectHint(mb)}`,
        last_error: String(res.error.message || '').slice(0, 300), updated_at: nowIso,
      })
    }
    throw res.error || new Error('The inbox could not be read.')
  }

  const own = String(mb.email || '').toLowerCase()
  const msgs = (res.messages || []).filter(m => m.threadId && m.from !== own)
  let replies = 0
  let bounces = 0
  if (msgs.length) {
    const threads = [...new Set(msgs.map(m => m.threadId))]
    const rows = []
    for (let i = 0; i < threads.length; i += 50) {
      const list = threads.slice(i, i + 50).map(t => `"${encodeURIComponent(t)}"`).join(',')
      rows.push(...(await db(
        `email_sends?mailbox_id=eq.${mb.id}&thread_id=in.(${list})&sent_at=not.is.null` +
        '&select=id,workspace_id,contact_id,thread_id,step&order=step.desc',
      ) || []))
    }
    for (const m of msgs) {
      // The latest step in the thread is the email being answered.
      const row = rows.find(r => r.thread_id === m.threadId)
      if (!row) continue
      const kind = inboxMessageKind(m)
      if (kind === 'auto') continue
      const at = m.receivedAt || nowIso
      if (kind === 'bounce') {
        if (await markBounced(db, row, at, nowIso)) bounces++
      } else if (await markReplied(db, row, at, nowIso)) {
        replies++
      }
    }
  }

  // A full page means there may be more: carry on from its last message.
  const page = res.messages || []
  const mark = page.length >= 50 ? page[page.length - 1].receivedAt : nowIso
  await patchMailbox(db, mb.id, { inbox_checked_at: mark })
  return { replies, bounces }
}

async function cancelQueued(db, row, reason, nowIso) {
  await db(`email_sends?workspace_id=eq.${row.workspace_id}&contact_id=eq.${row.contact_id}&status=eq.queued`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', error: reason, updated_at: nowIso },
  })
}

/** @returns {Promise<boolean>} true if this is news (not seen by an earlier run) */
async function markReplied(db, row, at, nowIso) {
  const changed = await db(`email_sends?id=eq.${row.id}&replied_at=is.null`, {
    method: 'PATCH', prefer: 'return=representation', body: { replied_at: at, updated_at: nowIso },
  }) || []
  await db(`email_contacts?id=eq.${row.contact_id}&workspace_id=eq.${row.workspace_id}&replied_at=is.null`, {
    method: 'PATCH', prefer: 'return=minimal', body: { replied_at: at, updated_at: nowIso },
  })
  await cancelQueued(db, row, 'Replied', nowIso)
  return changed.length > 0
}

async function markBounced(db, row, at, nowIso) {
  const changed = await db(`email_sends?id=eq.${row.id}&bounced_at=is.null`, {
    method: 'PATCH', prefer: 'return=representation', body: { status: 'bounced', bounced_at: at, updated_at: nowIso },
  }) || []
  await db(`email_contacts?id=eq.${row.contact_id}&workspace_id=eq.${row.workspace_id}&status=eq.active`, {
    method: 'PATCH', prefer: 'return=minimal', body: { status: 'bounced', updated_at: nowIso },
  })
  await cancelQueued(db, row, 'Address bounced', nowIso)
  return changed.length > 0
}
