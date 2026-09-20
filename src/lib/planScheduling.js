import { composerFromPost } from './composerState'
import { publishComposed } from './publishPost'
import { isProtectedPlatform, mayPublishTo } from './platformSafety'
import { brandWallToUtc, utcToBrandInputs } from './brandTime'
import { postLock } from './postLock'
import { fetchScheduledPosts } from './scheduledPosts'

// ─── A saved plan goes straight onto the schedule ──────────────────────────
// A plan's captions step is where every post got its picture, its words, its
// date and its time. Asking for a second approval in Post Approvals afterwards
// was a formality that left posts sitting unbooked; so saving a plan now books
// each post at Zernio for the moment it was planned. What cannot be booked is
// named, and waits in the Post Queue under "Needs attention".
//
// Every booking goes through publishComposed — the composer's own path — so
// validation, the protected-account refusal and the workflow's atomic claim
// are the same whether a post was scheduled by hand or by a plan.

// Which connected account a post goes out as. The row's own account when it
// has one; otherwise the only active account on that platform. Several with no
// choice on the row is a question for a person, not a guess.
export function accountFor(row, accounts = []) {
  const usable = accounts.filter(a => a.platform === row.platform && a.is_active !== false && a.zernio_account_id)
  if (row.zernio_account_id) {
    return usable.find(a => a.zernio_account_id === row.zernio_account_id)
      || { platform: row.platform, zernio_account_id: row.zernio_account_id }
  }
  return usable.length === 1 ? usable[0] : null
}

// What saving the plan should do with one post row. Pure, so each branch is
// pinned by a test rather than discovered on a real account.
//   skip      gone out — never touched
//   keep      already booked, nothing Zernio publishes changed
//   book      book it for its planned time
//   rebook    booked, but its words, picture or time changed — cancel & re-book
//   attention cannot be booked; `reason` says why
export function bookingFor(row, { accounts = [], changed = true, now = Date.now() } = {}) {
  const lock = postLock(row, now)
  if (lock.locked) return { action: 'skip', reason: lock.reason }

  const scheduled = row.publish_status === 'scheduled'
  if (scheduled && !changed) return { action: 'keep', reason: '' }

  if (isProtectedPlatform(row.platform)) {
    return { action: 'attention', reason: 'LinkedIn posts are drafts — nothing here posts to the page.' }
  }
  if (!row.scheduled_date) return { action: 'attention', reason: 'No date — pick when it goes out.' }
  const at = brandWallToUtc(row.scheduled_date, (row.publish_time || '09:00').slice(0, 5))
  if (!at || at.getTime() <= now + 60 * 1000) {
    return { action: 'attention', reason: 'Its planned time has already passed — pick a new time.' }
  }

  const account = accountFor(row, accounts)
  if (!account) {
    const count = accounts.filter(a => a.platform === row.platform && a.is_active !== false).length
    return {
      action: 'attention',
      reason: count ? `More than one ${row.platform} account is connected — choose which one in the composer.`
        : `No ${row.platform} account is connected.`,
    }
  }
  if (!mayPublishTo(account)) return { action: 'attention', reason: 'This account is protected — drafts only.' }

  return { action: scheduled ? 'rebook' : 'book', reason: '', account }
}

// Book one row at its planned time (or re-book it). Returns { ok } or { error }.
// `scheduledFor` ('YYYY-MM-DDTHH:MM', brand time) overrides the planned time;
// an empty string publishes now.
export async function bookPost(row, { account, workspaceId, reschedule = false, scheduledFor }) {
  const state = {
    ...composerFromPost(row),
    accountIds: account?.zernio_account_id ? [account.zernio_account_id] : [],
    ...(scheduledFor !== undefined ? { scheduledFor } : {}),
  }
  return publishComposed(state, {
    postId: row.id, postTable: row.post_table || 'generated_posts', workspaceId,
    account, reschedule,
  })
}

// Book every row from a saved plan, one at a time — each call claims its row,
// and running them in parallel buys nothing but a harder failure to read.
//
// `changedIds` is the set of rows whose published content this save changed
// (from publishIdeasAsPosts); a booked row outside it is left booked as is.
export async function schedulePlanPosts({ rows, accounts, workspaceId, changedIds, now = Date.now() }) {
  const result = { booked: [], kept: [], skipped: [], attention: [] }
  for (const row of rows || []) {
    const plan = bookingFor(row, { accounts, changed: changedIds ? changedIds.has(row.id) : true, now })
    if (plan.action === 'skip') { result.skipped.push({ row, reason: plan.reason }); continue }
    if (plan.action === 'keep') { result.kept.push({ row }); continue }
    if (plan.action === 'attention') { result.attention.push({ row, reason: plan.reason }); continue }
    const res = await bookPost(row, { account: plan.account, workspaceId, reschedule: plan.action === 'rebook' })
    if (res.error) result.attention.push({ row, reason: res.error })
    else result.booked.push({ row, rebooked: plan.action === 'rebook' })
  }
  return result
}

// Re-book posts already scheduled at Zernio after something changed what they
// publish — a new Studio picture, say. `posts` are write results carrying
// { id, rebook }. Reads each row fresh so the booking sends what is now saved,
// on the account it was booked on.
export async function rebookChangedPosts({ accessToken, workspaceId, posts, accounts = [] }) {
  const ids = (posts || []).filter(p => p.rebook && p.id).map(p => p.id)
  if (!ids.length) return { ok: true, errors: [] }
  const rows = await fetchScheduledPosts(workspaceId, accessToken, { ids })
  const errors = []
  for (const row of rows) {
    if (postLock(row).locked || row.publish_status !== 'scheduled') continue
    const account = accountFor(row, accounts)
    const scheduledFor = row.scheduled_publish_at ? wallFromInstant(row.scheduled_publish_at) : undefined
    const res = await bookPost(row, { account, workspaceId, reschedule: true, scheduledFor })
    if (res.error) errors.push(`${row.platform}: ${res.error}`)
  }
  return { ok: !errors.length, errors }
}

// The booked instant back to the brand wall clock the composer schedules in.
function wallFromInstant(value) {
  const p = utcToBrandInputs(value)
  return p.date ? `${p.date}T${p.time}` : undefined
}

// ─── Booking one post at a slot a person just chose ────────────────────────
// What the Schedule page calls when you give a pending post a time, or change
// a booked one's time.
//
// This exists because movePost (lib/scheduledPosts) cannot do it. For a post
// that is not yet booked, movePost takes its "local" branch and PATCHes
// scheduled_publish_at — our copy of the time — and stops. Nothing at Zernio
// ever hears about it, so the post sits on the calendar looking scheduled and
// is never sent. That is precisely how a post ends up "planned but not booked",
// and a calendar whose whole job is to say what is going out must not be able
// to manufacture one.
//
// So a slot chosen here goes through the same publishComposed path the planner
// uses: the row is claimed atomically, Zernio books it, and publish_status
// becomes 'scheduled' because the workflow said so rather than because we
// assumed it.
export async function bookPostAt({ post, dateKey, time, accounts = [], workspaceId, now = Date.now() }) {
  const lock = postLock(post, now)
  if (lock.locked) return { error: lock.reason }
  if (post?.publish_status === 'publishing') {
    return { error: 'Publishing right now — wait for it to finish.' }
  }

  const at = brandWallToUtc(dateKey, (time || '').slice(0, 5))
  if (!at) return { error: `Not a valid slot: ${dateKey} ${time}` }
  if (at.getTime() <= now + 60 * 1000) {
    return { error: 'That time has already passed — pick a later one.' }
  }

  if (isProtectedPlatform(post.platform)) {
    return { error: 'LinkedIn posts are drafts here — nothing in this app posts to the page.' }
  }

  const account = accountFor(post, accounts)
  if (!account) {
    const count = accounts.filter(a => a.platform === post.platform && a.is_active !== false).length
    return {
      error: count
        ? `More than one ${post.platform} account is connected — choose which one in the composer.`
        : `No ${post.platform} account is connected, so there is nothing to book this with.`,
    }
  }
  if (!mayPublishTo(account)) return { error: 'This account is protected — drafts only.' }

  // Already booked: Zernio is holding the old slot, so this has to cancel it
  // and book the new one rather than leaving two.
  const reschedule = post.publish_status === 'scheduled'
  const res = await bookPost(post, {
    account, workspaceId, reschedule,
    scheduledFor: `${dateKey}T${(time || '').slice(0, 5)}`,
  })
  if (res.error) {
    return {
      error: res.error,
      // The workflow sets this when it cancelled the old slot but could not
      // book the new one — the post is now booked NOWHERE, which has to be
      // said out loud rather than looking merely unchanged.
      unscheduled: res.unscheduled === true,
    }
  }
  return { ok: true, scheduledPublishAt: at.toISOString(), rebooked: reschedule }
}
