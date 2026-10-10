import { monthSpent } from './_intake.js'
import { runHealth as researchHealth } from '../../src/lib/agent/runHealth.js'

// ─── Lead agent: is everything still working? ──────────────────────────────
// The owner's decision (2026-10-07): when any part stops, email
// junaid@arak-sa.com straight away (lead_agent_settings.alert_emails), remind
// once a day while it lasts, and say so when it is fixed.
//
// Who runs the check: both Google timers. The website Sheet's 5-minute call
// checks on the workbook, and the workbook's call checks on the website Sheet,
// so one timer stopping is reported by the other. The app's daily job checks
// everything too, in case both stop. At most one check per 10 minutes.
//
//   deps.db / deps.now          as elsewhere
//   deps.keyInfo(ws)            OpenRouter's view of the company's key
//   deps.sendAlert({ workspaceId, to, subject, text, html })

export const HEALTH_EVERY_MS = 10 * 60_000
/** A Sheet that has not called for this long has stopped (it calls every 5). */
export const STALE_MS = 30 * 60_000
/** A mailbox read this long ago has stopped (rounds come every 5 minutes). */
const MAILBOX_STALE_MS = 45 * 60_000
/** While a problem lasts, remind this often. */
export const REMIND_MS = 24 * 3_600_000
const LOW_CREDIT_USD = 5

const ago = (ms) => {
  const m = Math.round(ms / 60_000)
  return m < 120 ? `${m} minutes` : `${Math.round(m / 60)} hours`
}

/**
 * The problems right now, from plain facts. Each has a stable key (so the
 * same problem is not emailed twice), a title, what it means, and the fix.
 */
export function healthIssues({ settings = {}, mailboxes = [], failed = [], spent = 0, cap = null, key = null, researchRuns = [], now = new Date() }) {
  const issues = []
  const t = now.getTime()
  const since = (iso) => (iso ? t - Date.parse(iso) : null)

  const site = since(settings.last_intake_at)
  const websiteDown = site !== null && site > STALE_MS
  if (websiteDown) {
    issues.push({
      key: 'website_sheet',
      title: 'The website enquiries Sheet has stopped',
      detail: `Its 5-minute timer last called ${ago(site)} ago. New website enquiries are not being sorted, and the mailboxes are only read once a day until it is back.`,
      fix: 'Open the website enquiries Sheet → Extensions → Apps Script → Executions to see why. If the timer is gone, run installLeadAgent again.',
    })
  }
  const book = since(settings.last_export_at)
  if (book !== null && book > STALE_MS) {
    issues.push({
      key: 'workbook',
      title: 'The leads workbook has stopped updating',
      detail: `Its 5-minute timer last called ${ago(book)} ago. New leads are not reaching the workbook.`,
      fix: 'Open the leads workbook → Extensions → Apps Script → Triggers: check that syncLeads is listed, or run installLeadsMaster again.',
    })
  }

  for (const mb of mailboxes) {
    const name = mb.label || mb.email
    if (mb.status === 'reconnect') {
      issues.push({
        key: `mailbox_reconnect:${mb.email}`,
        title: `${name} needs to be connected again`,
        detail: `Microsoft no longer accepts its sign-in (usually a password change, or an admin removed access). Its new mail is not being read. ${mb.last_error || ''}`.trim(),
        fix: 'Lead Agent page → Connection → Disconnect it, then connect it again (sign in as the mailbox).',
      })
      continue
    }
    if (mb.last_error) {
      issues.push({
        key: `mailbox_error:${mb.email}`,
        grace: 20 * 60_000, // Microsoft being busy for a minute clears by itself
        title: `Reading ${name} failed`,
        detail: `${mb.last_error} It is tried again every 5 minutes.`,
        fix: 'If this does not clear by itself within an hour, disconnect and connect it again on the Lead Agent page.',
      })
      continue
    }
    const read = since(mb.last_checked_at)
    // Mailboxes are read on the website Sheet's call: when that is down the
    // Sheet problem says it all.
    if (!websiteDown && read !== null && read > MAILBOX_STALE_MS) {
      issues.push({
        key: `mailbox_stale:${mb.email}`,
        title: `${name} has not been read for ${ago(read)}`,
        detail: 'New mail in it is not being sorted.',
        fix: 'Lead Agent page → Connection → Check now. If it shows an error, connect it again.',
      })
    }
  }

  if (failed.length) {
    issues.push({
      key: 'ai_errors',
      title: `${failed.length} ${failed.length === 1 ? 'enquiry' : 'enquiries'} could not be checked by the AI`,
      detail: `The latest error: ${failed[0].error}. They are tried again every round.`,
      fix: 'Lead Agent page: check that the OpenRouter key shows "Working" and has credit. The waiting ones are under "Not checked".',
    })
  }

  if (key && key.valid === false) {
    issues.push({
      key: 'ai_key',
      title: 'OpenRouter does not accept the saved key',
      detail: 'No enquiry can be checked by the AI until a working key is saved.',
      fix: 'Lead Agent page → Connection → Replace the OpenRouter key.',
    })
  } else if (key && key.limitRemaining != null && key.limitRemaining < LOW_CREDIT_USD) {
    issues.push({
      key: 'ai_credit_low',
      title: `OpenRouter credit is down to $${Number(key.limitRemaining).toFixed(2)}`,
      detail: 'When it reaches zero the AI stops checking enquiries.',
      fix: 'Add credit at openrouter.ai → Credits.',
    })
  }

  // ── The weekly research ──
  // Added 2026-10-10. The research runs on the n8n box once a week and had no
  // alarm of its own: on 2026-09-28 and 10-05 both runs died on "credit
  // balance is too low", were saved as complete, and nobody heard for two
  // weeks. The same judgement the Research page shows, emailed here. Reminded
  // weekly, not daily: a research problem only matters once per run.
  const research = researchHealth(researchRuns, now)
  if (research) {
    issues.push({
      key: 'research_run',
      // A run that is merely slow clears by itself; the page already says so.
      grace: research.level === 'stuck' ? 30 * 60_000 : 0,
      remindEvery: 7 * 24 * 3_600_000,
      title: `Weekly research: ${research.headline.replace(/\.$/, '')}`,
      detail: research.detail || '',
      fix: research.action || 'Open the Research page.',
    })
  }

  if (cap != null && Number(cap) > 0) {
    if (spent >= Number(cap)) {
      issues.push({
        key: 'budget_used',
        title: 'This month\'s AI budget is used up',
        detail: `$${spent.toFixed(2)} of $${Number(cap).toFixed(2)}. New enquiries arrive as "Needs review" without an AI verdict until next month.`,
        fix: 'Raise the company\'s monthly AI limit (agent_monthly_cap_usd).',
      })
    } else if (spent >= 0.8 * Number(cap)) {
      issues.push({
        key: 'budget_80',
        title: 'This month\'s AI budget is 80% used',
        detail: `$${spent.toFixed(2)} of $${Number(cap).toFixed(2)}.`,
        fix: 'Nothing yet; raise the monthly AI limit if it keeps climbing.',
      })
    }
  }
  return issues
}

/**
 * What to email, given the problems now and what was already said:
 * new problems now, a reminder for ones older than a day since their last
 * email, and "fixed" for ones that are gone. Returns the new state too.
 */
export function plan(issues, state = {}, now = new Date()) {
  const t = now.getTime()
  const iso = now.toISOString()
  const next = {}
  const fresh = []
  const remind = []
  for (const i of issues) {
    const was = state[i.key]
    const since = was?.since || iso
    // A problem with a grace period (one that often clears by itself) is
    // only emailed once it has lasted that long.
    if (!was?.sentAt) {
      if (t - Date.parse(since) >= (i.grace || 0)) { fresh.push(i); next[i.key] = { since, sentAt: iso, title: i.title } } else next[i.key] = { since, sentAt: null, title: i.title }
      continue
    }
    if (t - Date.parse(was.sentAt) >= (i.remindEvery || REMIND_MS)) { remind.push(i); next[i.key] = { ...was, sentAt: iso, title: i.title }; continue }
    next[i.key] = { ...was, title: i.title }
  }
  // "Fixed" only for problems someone was told about.
  const fixed = Object.keys(state).filter((k) => state[k].sentAt && !issues.some((i) => i.key === k)).map((k) => ({ key: k, ...state[k] }))
  return { fresh, remind, fixed, state: next }
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/** The email for one round's news. */
export function alertEmail({ fresh = [], remind = [], fixed = [], company = 'Arak Lighting', pageUrl = '' }) {
  const problems = [...fresh, ...remind]
  const subject = problems.length
    ? `⚠️ Arak agents: ${problems.length === 1 ? problems[0].title : `${problems.length} problems need attention`}`
    : `✅ Arak agents: ${fixed.length === 1 ? `fixed — ${fixed[0].title}` : `${fixed.length} problems fixed`}`
  const lines = []
  const html = []
  if (problems.length) {
    lines.push(`The agents for ${company} need attention:`, '')
    html.push(`<p>The agents for ${esc(company)} need attention:</p>`)
    for (const p of problems) {
      const tag = remind.includes(p) ? ' (still not fixed)' : ''
      lines.push(`• ${p.title}${tag}`, `  ${p.detail}`, `  What to do: ${p.fix}`, '')
      html.push(`<p><b>${esc(p.title)}${esc(tag)}</b><br>${esc(p.detail)}<br><i>What to do:</i> ${esc(p.fix)}</p>`)
    }
  }
  if (fixed.length) {
    // The title names the problem ("…has stopped updating"), so say plainly
    // that it is over; "Working again: …has stopped" read backwards.
    lines.push('Fixed, nothing to do:', ...fixed.map((f) => `• ✓ ${f.title} — this problem is over, it works again.`), '')
    html.push(`<p><b>Fixed, nothing to do:</b><br>${fixed.map((f) => `✓ ${esc(f.title)} — this problem is over, it works again.`).join('<br>')}</p>`)
  }
  if (pageUrl) { lines.push(`Lead Agent page: ${pageUrl}`); html.push(`<p><a href="${esc(pageUrl)}">Open the Lead Agent page</a></p>`) }
  return { subject, text: lines.join('\n'), html: html.join('\n') }
}

/**
 * One health check for one company, if it is due (or `force`). Claims the
 * slot first, so the two Sheets' calls arriving together do not both email.
 */
export async function runHealth(deps, { workspaceId, force = false, pageUrl = '' }) {
  const now = deps.now()
  const cutoff = new Date(now.getTime() - HEALTH_EVERY_MS).toISOString()
  const claim = force ? '' : `&or=(last_health_at.is.null,last_health_at.lt.${encodeURIComponent(cutoff)})`
  const [settings] = await deps.db(`lead_agent_settings?workspace_id=eq.${workspaceId}${claim}`, {
    method: 'PATCH', prefer: 'return=representation', body: { last_health_at: now.toISOString() },
  }) || []
  if (!settings) return { skipped: true }
  if (settings.enabled === false) return { off: true }

  const failedSince = new Date(now.getTime() - 30 * 60_000).toISOString()
  const [mailboxes, failed, [ws], key, researchRuns] = await Promise.all([
    deps.db(`lead_mailboxes?workspace_id=eq.${workspaceId}&select=email,label,status,last_checked_at,last_error`).then((r) => r || []),
    deps.db(`leads?workspace_id=eq.${workspaceId}&verdict=is.null&error=neq.&created_at=lt.${encodeURIComponent(failedSince)}&select=error&order=updated_at.desc&limit=50`).then((r) => r || []),
    deps.db(`workspaces?id=eq.${workspaceId}&select=name,agent_monthly_cap_usd`).then((r) => r || []),
    deps.keyInfo ? deps.keyInfo(workspaceId).catch(() => null) : null,
    // Never allowed to break the lead checks: no research, no research issue.
    deps.db(`research_runs?workspace_id=eq.${workspaceId}&select=status,stage,error,trigger,started_at,finished_at&order=started_at.desc&limit=10`)
      .then((r) => r || []).catch(() => []),
  ])
  const spent = await monthSpent(deps.db, workspaceId, now)
  const issues = healthIssues({ settings, mailboxes, failed, spent, cap: ws?.agent_monthly_cap_usd ?? null, key, researchRuns, now })
  const p = plan(issues, settings.alert_state || {}, now)

  let sent = null
  const to = (settings.alert_emails || []).filter(Boolean)
  if ((p.fresh.length || p.remind.length || p.fixed.length) && to.length && deps.sendAlert) {
    const mail = alertEmail({ ...p, company: ws?.name || 'the company', pageUrl })
    sent = await deps.sendAlert({ workspaceId, to, ...mail }).catch((err) => ({ ok: false, error: err }))
    // Not sent: keep the old state, so the next check tries again.
    if (!sent?.ok) return { issues, sent, error: String(sent?.error?.message || sent?.error || 'not sent') }
  }
  await deps.db(`lead_agent_settings?workspace_id=eq.${workspaceId}`, {
    method: 'PATCH', prefer: 'return=minimal', body: { alert_state: p.state },
  })
  return { issues, sent: sent ? { ok: true } : null, fresh: p.fresh.length, remind: p.remind.length, fixed: p.fixed.length }
}
