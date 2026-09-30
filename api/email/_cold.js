import { pickRecipients, blockReason, fullName, REPLIES_GROUP } from '../../src/lib/email/contacts.js'
import { renderEmail, applyMergeTags } from '../../src/lib/email/render.js'
import { brandDateKey, brandWallToUtcISO } from '../../src/lib/brandTime.js'
import {
  HARD_MAX_PER_WORKSPACE, RECONTACT_DAYS, mailboxReadiness, mailboxCap, inSendingWindow,
  nextWindowStart, gapMinutes, mailboxHealthProblem, followUpSubject, makeMessageId, classifySmtpError, coldProblems,
  SENDING_PROVIDERS, inboxMessageKind, STUCK_AFTER_MINUTES, STUCK_NEEDS_PERSON, isStuckSend,
  MAX_SENDS_PER_RUN, RUN_BUDGET_SECONDS, pauseBeforeSend,
} from '../../src/lib/email/cold.js'
import { closeFinished, subscribeUrl, moveToMarketing } from './_engine.js'

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
//   deps.sleep(ms)             optional: wait before a send (the run's
//                              rhythm). Without it nothing waits, which is
//                              what tests want; the server passes a real one.
//   deps.baseUrl               the app's address, for each email's
//                              newsletter sign-up link ({{subscribe_url}})
//
// What a launch does: queue step 0 for every eligible prospect, with NO
// mailbox yet. The run gives each row to whichever ready mailbox is free, so
// the load spreads by itself and a paused mailbox strands nobody.
//
// What a run does, every ~10 minutes from n8n: for each workspace whose cold
// switch is on, for each ready mailbox whose gap has passed and whose day
// still has room, send ONE email — a due follow-up first (same mailbox, same
// thread), otherwise the next first email. Then set the mailbox's next
// moment a random gap ahead. At most MAX_SENDS_PER_RUN per company per run,
// each after a random pause, so no two leave together and none lands on
// n8n's clock. That is the whole pacing model.
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
  // The run's own clock, for its pauses: shared by every workspace, so the
  // whole run stays inside RUN_BUDGET_SECONDS.
  const pace = deps.sleep && !dryRun ? { startedAt: Date.now(), slept: 0 } : null
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
      await runWorkspace(deps, { ws, now, dryRun, out, result, pace })
    } catch (err) {
      out.error = String(err?.message || err).slice(0, 300)
    }
  }
  return result
}

async function runWorkspace(deps, { ws, now, dryRun, out, result, pace }) {
  const { db, count } = deps
  const nowIso = now.toISOString()
  if (!dryRun) {
    await db(`email_campaigns?workspace_id=eq.${ws}&audience=eq.cold&status=eq.scheduled&scheduled_for=lte.${nowIso}`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'sending', updated_at: nowIso },
    })
  }
  if (!dryRun) {
    // A deleted contact's queued emails keep their row (the foreign key sets
    // contact_id to null). Nobody is left to send them to: they are
    // cancelled, as the delete dialog promises, before a run can claim one.
    await db(`email_sends?workspace_id=eq.${ws}&status=eq.queued&contact_id=is.null`, {
      method: 'PATCH', prefer: 'return=minimal', body: { status: 'cancelled', error: 'Contact deleted', updated_at: nowIso },
    })
  }
  const campaigns = await db(`email_campaigns?workspace_id=eq.${ws}&audience=eq.cold&status=eq.sending&select=*`) || []
  const mailboxes = await db(`email_mailboxes?workspace_id=eq.${ws}&${providerFilter}&select=*&order=last_sent_at.asc.nullsfirst`) || []
  if (!campaigns.length && !dryRun) return

  const today = brandDateKey(now)
  const dayStart = brandWallToUtcISO(today, '00:00')
  const weekAgo = new Date(now.getTime() - 7 * DAY).toISOString()
  let wsSentToday = await count(`email_sends?workspace_id=eq.${ws}&mailbox_id=not.is.null&sent_at=gte.${dayStart}&select=id`)
  let sendsThisRun = 0   // sent, or would be in a dry run

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
    if (sendsThisRun >= MAX_SENDS_PER_RUN) {
      line.reason = `Goes on the next run: ${MAX_SENDS_PER_RUN} emails already went this run, and they never leave together.`
      continue
    }
    if (dryRun) { line.action = 'send'; line.reason = 'Would send now.'; sendsThisRun++; continue }

    // The pause before this email. The moment it actually leaves is the
    // run's start plus the time waited, and the window is checked again at
    // that moment.
    let at = now
    if (pace) {
      const pause = pauseBeforeSend(sendsThisRun, deps.random ? deps.random() : Math.random())
      const spent = Math.max(Date.now() - pace.startedAt, pace.slept)
      if (spent + pause > RUN_BUDGET_SECONDS * 1000) {
        line.reason = 'Goes on the next run: this run\'s time is used up.'
        continue
      }
      await deps.sleep(pause)
      pace.slept += pause
      at = new Date(now.getTime() + Math.max(Date.now() - pace.startedAt, pace.slept))
      if (!inSendingWindow(at)) { line.reason = 'Sending hours ended while it waited.'; continue }
    }

    // One mailbox's crash (a dropped connection mid-send) is that mailbox's
    // alone: the others still send this run. Its row stays 'sending', which
    // the stuck-row check settles later, so nothing is sent twice.
    let outcome
    try {
      outcome = await sendOne(deps, { ws, mb, row, campaign: allowed.find(c => c.id === row.campaign_id), now: at, cap })
    } catch (err) {
      outcome = { action: 'failed', reason: `Stopped mid-send: ${String(err?.message || err).slice(0, 200)}. It is checked again in ${STUCK_AFTER_MINUTES} minutes.` }
    }
    line.action = outcome.action
    line.reason = outcome.reason
    if (outcome.action === 'sent') { result.sent++; out.sent++; wsSentToday++; sendsThisRun++ }
    else if (outcome.action === 'skipped') result.skipped++
    else if (outcome.action === 'failed') result.failed++
  }

  if (!dryRun) await closeFinished(deps, { workspaceId: ws, now })
}

/** A due follow-up for this mailbox first (it is part of a thread), then the next first email. */
async function nextRow(db, { ws, mb, campaignIds, nowIso }) {
  const base = `email_sends?workspace_id=eq.${ws}&status=eq.queued&due_at=lte.${nowIso}&contact_id=not.is.null&campaign_id=in.${inList(campaignIds)}`
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
    subscribeUrl: subscribeUrl(deps.baseUrl, contact.unsubscribe_token),
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
      // Nothing left, so the gap claimed for this attempt is handed back: a
      // mailbox reconnected ten minutes later sends on the next run instead
      // of sitting out a gap for an email it never sent.
      await patchMailbox(db, mb.id, { status: 'error', status_reason: res.error?.reason || `The login was refused. ${reconnectHint(mb)}`, last_error: message, next_send_at: mb.next_send_at || null, updated_at: nowIso })
    } else if (kind === 'limit') {
      const tomorrow = nextWindowStart(new Date(Date.parse(brandWallToUtcISO(today, '23:59'))))
      await patchMailbox(db, mb.id, { next_send_at: tomorrow?.toISOString() || nextAt, last_error: message, updated_at: nowIso })
    } else {
      await patchMailbox(db, mb.id, { next_send_at: new Date(now.getTime() + 15 * 60_000).toISOString(), last_error: message, updated_at: nowIso })
    }
    return { action: 'failed', reason: `${kind}: ${message}` }
  }

  await recordSent(db, {
    ws, mb, row, campaign, contactId: contact.id, email: contact.email, now,
    subject: rendered.subject, providerId: res.messageId || messageId,
    // The real Message-ID (Microsoft may assign its own) is what follow-ups
    // must reply to; the thread is how the inbox reader finds answers.
    messageId: res.messageId && res.messageId !== messageId ? res.messageId : '',
    threadId: res.threadId || '',
  })
  await patchMailbox(db, mb.id, {
    last_sent_at: nowIso, first_sent_on: mb.first_sent_on || today, last_error: '', updated_at: nowIso,
  })
  return { action: 'sent', reason: `Sent ${row.step === 0 ? 'first email' : `follow-up ${row.step}`} to ${row.email}.` }
}

/**
 * Everything that follows an email leaving: the row is sent, the contact was
 * last written to now, and the campaign's next step is queued on the same
 * mailbox, due after its wait. Shared by the sending run and by the stuck-row
 * check, which finds an email that left after all.
 */
async function recordSent(db, { ws, mb, row, campaign, contactId, email, now, sentAt = null, subject, providerId, messageId = '', threadId = '' }) {
  const nowIso = now.toISOString()
  const at = sentAt || nowIso
  await patchSend(db, row.id, {
    status: 'sent', sent_at: at, error: '', updated_at: nowIso,
    ...(subject ? { subject } : {}),
    ...(providerId ? { provider_id: providerId } : {}),
    ...(messageId ? { message_id: messageId } : {}),
    ...(threadId ? { thread_id: threadId } : {}),
  })
  await db(`email_contacts?id=eq.${contactId}&workspace_id=eq.${ws}`, { method: 'PATCH', prefer: 'return=minimal', body: { last_sent_at: at } })

  const next = (campaign?.follow_ups || [])[row.step]
  if (next && String(next.body || '').trim()) {
    const days = Math.min(30, Math.max(1, Number(next.delay_days) || 3))
    await db('email_sends?on_conflict=campaign_id,contact_id,step', {
      method: 'POST', prefer: 'resolution=ignore-duplicates,return=minimal',
      body: [{
        workspace_id: ws, campaign_id: row.campaign_id, contact_id: contactId, email,
        step: row.step + 1, status: 'queued', mailbox_id: mb.id,
        due_at: new Date(Date.parse(at) + days * DAY).toISOString(),
      }],
    })
  }
}

async function secretOf(db, mailboxId) {
  const [row] = await db(`email_mailbox_secrets?mailbox_id=eq.${mailboxId}&select=secret`) || []
  return row?.secret || ''
}


// ─── Reading replies and bounces (Microsoft 365 mailboxes) ─────────────────
// Every run, before sending, each connected Microsoft mailbox's inbox is read
// from where the last run stopped. A message in the thread of one of our
// sends is one of four things (src/lib/email/cold.js, inboxMessageKind):
//
//   reply   the prospect (or a colleague on the thread) answered: the send
//           and the contact get replied_at, every queued email to that
//           person is cancelled, and they move to the marketing lane as a
//           business contact, into the group REPLIES_GROUP. They have
//           written to us, so they may hear from us.
//   optout  a reply that says stop, unsubscribe, not interested (English or
//           Arabic): marked replied too, but the contact is unsubscribed and
//           stays out of every lane.
//   bounce  the address does not exist: the send and the contact bounce, and
//           the bounce brake counts it.
//   auto    an out-of-office: ignored, the sequence carries on.
//
// Read: the sender, subject, thread and the reply's first ~255 characters.
// Stored: none of the reply's words, only what it meant. It runs whether or
// not outreach sending is switched on: an answer to an email we already sent
// must stop the follow-ups either way.

const INBOX_LOOKBACK_MS = 3 * DAY
const INBOX_OVERLAP_MS = 60_000

export async function readReplies(deps, { now = new Date(), workspaceId = null } = {}) {
  const { db } = deps
  const filter = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''
  const mailboxes = await db(`email_mailboxes?provider=eq.microsoft&status=in.(active,paused)${filter}&select=*`) || []
  const out = { mailboxes: 0, replies: 0, bounces: 0, optOuts: 0, movedToMarketing: 0, errors: [] }
  for (const mb of mailboxes) {
    try {
      const r = await readMailbox(deps, mb, now)
      out.mailboxes++
      out.replies += r.replies
      out.bounces += r.bounces
      out.optOuts += r.optOuts
      out.movedToMarketing += r.moved
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
  let optOuts = 0
  let moved = 0
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
        continue
      }
      if (await markReplied(db, row, at, nowIso)) replies++
      if (kind === 'optout') {
        if (await markOptedOut(db, row, at, nowIso)) optOuts++
      } else if (await moveReplierToMarketing(deps, row, now)) {
        moved++
      }
    }
  }

  // A full page means there may be more: carry on from its last message.
  const page = res.messages || []
  const mark = page.length >= 50 ? page[page.length - 1].receivedAt : nowIso
  await patchMailbox(db, mb.id, { inbox_checked_at: mark })
  return { replies, bounces, optOuts, moved }
}

/** A "stop" reply: the person is unsubscribed, in every lane. */
async function markOptedOut(db, row, at, nowIso) {
  const changed = await db(`email_contacts?id=eq.${row.contact_id}&workspace_id=eq.${row.workspace_id}&status=eq.active`, {
    method: 'PATCH', prefer: 'return=representation', body: { status: 'unsubscribed', unsubscribed_at: at, updated_at: nowIso },
  }) || []
  return changed.length > 0
}

/**
 * Any other reply: the prospect wrote to us, so they become a business
 * contact in the marketing lane. Only a cold, still-active contact moves:
 * someone who said stop in an earlier message stays unsubscribed, and a
 * subscriber keeps their stronger opt-in.
 */
async function moveReplierToMarketing({ db }, row, now) {
  const [contact] = await db(`email_contacts?id=eq.${row.contact_id}&workspace_id=eq.${row.workspace_id}&select=id,workspace_id,audience,status`) || []
  if (!contact || contact.audience !== 'cold' || contact.status !== 'active') return false
  await moveToMarketing({ db }, contact, {
    patch: { consent: 'business_contact' },
    group: REPLIES_GROUP, groupDescription: 'Replied to an outreach email.',
    reason: 'Replied', now,
  })
  return true
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


// ─── Emails stuck in 'sending' ─────────────────────────────────────────────
// A run that dies after claiming a row and before recording the outcome
// leaves it 'sending'. It is never retried blindly (see the top of this
// file). Every run looks at rows stuck longer than STUCK_AFTER_MINUTES:
//
//   Microsoft mailbox  the mailbox itself says what happened. The email is in
//                      Sent Items → it left: recorded as sent, and its
//                      follow-up is queued. It is still a draft → it never
//                      left: the draft is deleted and the row waits for the
//                      next run. Neither → a person decides (below).
//   any other mailbox  there is nothing to ask, so a person decides.
//
// A person decides in the app (resolveStuckByHand): it went out, send it
// again, or drop it. Only a row that is stuck can be touched, so a send in
// progress is never second-guessed.

const stuckCutoff = now => new Date(now.getTime() - STUCK_AFTER_MINUTES * 60_000).toISOString()
const STUCK_COLS = 'id,workspace_id,campaign_id,contact_id,email,step,mailbox_id,message_id,subject,updated_at,error'

/** The row waits for the next run: a first email may go from any mailbox, a follow-up only from its thread's. */
const requeueBody = (row, nowIso, error = '') => ({
  status: 'queued', mailbox_id: row.step === 0 ? null : row.mailbox_id, message_id: null, error, updated_at: nowIso,
})

export async function resolveStuck(deps, { now = new Date(), workspaceId = null } = {}) {
  const { db } = deps
  const nowIso = now.toISOString()
  const filter = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''
  const rows = await db(`email_sends?status=eq.sending&updated_at=lt.${stuckCutoff(now)}&mailbox_id=not.is.null${filter}&select=${STUCK_COLS}&order=updated_at.asc&limit=50`) || []
  const out = { checked: 0, sent: 0, requeued: 0, needsPerson: 0, errors: [] }
  if (!rows.length) return out

  const mbIds = [...new Set(rows.map(r => r.mailbox_id))]
  const mailboxes = await db(`email_mailboxes?id=in.${inList(mbIds)}&select=*`) || []
  const campaignIds = [...new Set(rows.map(r => r.campaign_id))]
  const campaigns = await db(`email_campaigns?id=in.${inList(campaignIds)}&select=id,follow_ups`) || []

  // Said once: a row already waiting for a person is not rewritten every run.
  const askPerson = async (row, text) => {
    if (row.error === text) return
    await patchSend(db, row.id, { error: text })
    out.needsPerson++
  }

  for (const row of rows) {
    out.checked++
    const mb = mailboxes.find(m => m.id === row.mailbox_id)
    if (!mb || mb.provider !== 'microsoft' || !deps.mail.findSent) {
      await askPerson(row, STUCK_NEEDS_PERSON.smtp)
      continue
    }
    try {
      const plain = deps.open(await secretOf(db, mb.id))
      if (!plain) continue   // the sending run flags the mailbox; try again once it is reconnected
      const found = await deps.mail.findSent(mb, plain, { messageId: row.message_id, to: row.email, since: row.updated_at })
      if (!found.ok) { out.errors.push(`${mb.email}: ${String(found.error?.message || found.error || 'check failed').slice(0, 200)}`); continue }
      if (found.state === 'sent') {
        await recordSent(db, {
          ws: row.workspace_id, mb, row, campaign: campaigns.find(c => c.id === row.campaign_id),
          contactId: row.contact_id, email: row.email, now, sentAt: found.sentAt || row.updated_at,
          subject: found.subject || '', providerId: found.messageId || row.message_id,
          messageId: found.messageId && found.messageId !== row.message_id ? found.messageId : '', threadId: found.threadId || '',
        })
        out.sent++
      } else if (found.state === 'draft') {
        await patchSend(db, row.id, requeueBody(row, nowIso, 'The last attempt stopped before sending; it goes out on a later run.'))
        out.requeued++
      } else {
        await askPerson(row, STUCK_NEEDS_PERSON.microsoft)
      }
    } catch (err) {
      out.errors.push(`${mb.email}: ${String(err?.message || err).slice(0, 200)}`)
    }
  }
  return out
}

/**
 * A person's answer for one stuck row.
 * @param {object} args { workspaceId, sendId, outcome: 'sent'|'retry'|'drop', by, now }
 */
export async function resolveStuckByHand({ db }, { workspaceId, sendId, outcome, by = '', now = new Date() }) {
  const nowIso = now.toISOString()
  const [row] = await db(`email_sends?id=eq.${sendId}&workspace_id=eq.${workspaceId}&select=${STUCK_COLS},status`) || []
  if (!row) return { error: 'That email is not in this workspace.', status: 404 }
  if (!isStuckSend(row, now.getTime())) return { error: 'That email is no longer stuck: it was sent, or is being sent right now.', status: 409 }
  // The same "only if still stuck" condition on the write, so two people
  // (or a person and the run) cannot both answer.
  const guard = `email_sends?id=eq.${row.id}&workspace_id=eq.${workspaceId}&status=eq.sending&updated_at=eq.${encodeURIComponent(row.updated_at)}`
  const claim = async body => ((await db(guard, { method: 'PATCH', prefer: 'return=representation', body }) || []).length > 0)

  if (outcome === 'retry') {
    if (!await claim(requeueBody(row, nowIso, `Sent again by ${by || 'a person'}.`))) return { error: 'Someone else answered this one first.', status: 409 }
    return { send_id: row.id, outcome }
  }
  if (outcome === 'drop') {
    if (!await claim({ status: 'skipped', error: `Dropped by ${by || 'a person'}: not sent.`, updated_at: nowIso })) return { error: 'Someone else answered this one first.', status: 409 }
    return { send_id: row.id, outcome }
  }
  if (outcome === 'sent') {
    // Claim first (the run must not also pick it up), then record the send.
    if (!await claim({ updated_at: nowIso })) return { error: 'Someone else answered this one first.', status: 409 }
    const [campaign] = await db(`email_campaigns?id=eq.${row.campaign_id}&workspace_id=eq.${workspaceId}&select=id,follow_ups`) || []
    const [mb] = await db(`email_mailboxes?id=eq.${row.mailbox_id}&workspace_id=eq.${workspaceId}&select=id`) || []
    await recordSent(db, {
      ws: workspaceId, mb: mb || { id: row.mailbox_id }, row, campaign, contactId: row.contact_id, email: row.email,
      now, sentAt: row.updated_at, providerId: row.message_id,
    })
    return { send_id: row.id, outcome }
  }
  return { error: 'Choose sent, retry or drop.', status: 400 }
}
