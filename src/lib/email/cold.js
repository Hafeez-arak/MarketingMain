// ─── The cold lane's sending rules ─────────────────────────────────────────
// How fast, when, and from which mailbox a cold email may go out. Pure — no
// IO, no React — so the server obeys exactly what the Settings screen shows.
//
// A cold mailbox is judged by Gmail and Outlook as a person: a new one that
// suddenly writes to strangers all day looks like what it is. So:
//
//   • nothing is sent until two weeks after its warm-up started,
//   • the first week of real sending is 5 a day, the second 10, then the
//     mailbox's own limit — never above HARD_MAX_PER_MAILBOX,
//   • only Sunday–Thursday, 09:00–17:00 Riyadh, one email at a time with a
//     random gap, so a day's emails are spread the way a person's would be,
//   • never two in the same moment, even from different mailboxes (see
//     "One run's rhythm" below),
//   • never from a free-mail address, and a Google (app password) mailbox
//     never from the company's own domain.
//
// Microsoft 365 mailboxes are the exception to that last rule, by the
// owner's decision (2026-09-28): the company's own arak-sa.com accounts,
// renamed from former employees, connected by signing in. They sit on an
// aged domain with years of normal mail behind it, so they need no warm-up
// service, but the ramp and every ceiling below apply to them unchanged:
// a burst from arak-sa.com risks every colleague's mail, not just outreach.
//
// The hard numbers below are not settings. A bug elsewhere, a typo in a
// limit, or an edited request can lower them but never raise them.

import { utcToBrandParts, brandDateKey, brandWallToUtcISO } from '../brandTime.js'
import { daysBetween } from './warmup.js'
import { normalizeEmail, isValidEmail } from './contacts.js'
import { unknownMergeTags } from './render.js'

export const HARD_MAX_PER_MAILBOX = 40      // per day, whatever daily_limit says
// The providers the sending run uses. 'instantly' is reserved, not built.
export const SENDING_PROVIDERS = ['smtp', 'microsoft']
export const HARD_MAX_PER_WORKSPACE = 200   // per day, across all mailboxes
export const WARMUP_DAYS = 14               // warm-up before the first cold email
export const MIN_GAP_MINUTES = 4
export const MAX_GAP_MINUTES = 180
// A person already written to by another cold campaign is left alone this long.
export const RECONTACT_DAYS = 90

// Saudi working week, in brand time.
export const SEND_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']
export const SEND_FROM = '09:00'
export const SEND_UNTIL = '17:00'
const WINDOW_MINUTES = 8 * 60

// The ramp from a mailbox's first cold send.
export const RAMP = [
  { fromDay: 0,  perDay: 5 },
  { fromDay: 7,  perDay: 10 },
  { fromDay: 14, perDay: Infinity },   // = the mailbox's own limit
]

// Addresses a cold email must never come from: a personal inbox has no
// domain to protect and its terms forbid bulk sending.
export const FREE_MAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
]

// Connection presets. Google is the default: every seller of Google
// mailboxes (Google Workspace itself, or a reseller) uses these.
export const PRESETS = {
  google: { label: 'Google (Gmail / Workspace)', smtp_host: 'smtp.gmail.com', smtp_port: 465, imap_host: 'imap.gmail.com', imap_port: 993 },
  custom: { label: 'Other (enter the servers)', smtp_host: '', smtp_port: 465, imap_host: '', imap_port: 993 },
}

export function domainOf(email) {
  return normalizeEmail(email).split('@')[1] || ''
}

/** example.co.uk → co.uk is wrong, but this is only ever compared, never shown. */
export function rootDomain(domain) {
  return String(domain || '').toLowerCase().split('.').slice(-2).join('.')
}

/**
 * Why this address may not be a cold mailbox, or '' if it may.
 * `protectedDomains`: the marketing sender's, the reply-to's, the signed-in
 * person's own — any domain whose reputation matters to the company.
 */
export function mailboxDomainProblem(email, protectedDomains = []) {
  if (!isValidEmail(email)) return 'That is not a valid email address.'
  const domain = domainOf(email)
  if (FREE_MAIL_DOMAINS.includes(domain)) {
    return 'A personal Gmail or Outlook address cannot send outreach: use a mailbox on your outreach domain.'
  }
  const root = rootDomain(domain)
  const hit = protectedDomains.map(d => rootDomain(d)).filter(Boolean).find(d => d === root)
  if (hit) {
    return `This mailbox is on ${hit}, a domain your company email depends on. Outreach must come from a separate domain so it can never damage it.`
  }
  return ''
}

/**
 * May this mailbox send cold email today, and if not, why and from when.
 * @returns {{ ready: boolean, reason: string, readyOn: string|null }}
 */
export function mailboxReadiness(mailbox, today) {
  if (!mailbox) return { ready: false, reason: 'No mailbox.', readyOn: null }
  if (mailbox.status === 'paused') return { ready: false, reason: mailbox.status_reason || 'Paused.', readyOn: null }
  if (mailbox.status === 'error') return { ready: false, reason: mailbox.status_reason || mailbox.last_error || 'The login stopped working.', readyOn: null }
  if (!mailbox.warmup_started_on) {
    // An established company mailbox has its warm-up behind it; the ramp
    // still starts it at 5 a day.
    if (mailbox.provider === 'microsoft') return { ready: true, reason: '', readyOn: null }
    return { ready: false, reason: 'Warm-up has not been started. Start it in your warm-up service, then enter the date here.', readyOn: null }
  }
  const readyOn = addDays(mailbox.warmup_started_on, WARMUP_DAYS)
  if (daysBetween(mailbox.warmup_started_on, today) < WARMUP_DAYS) {
    return { ready: false, reason: `Warming up. Ready for outreach on ${readyOn}.`, readyOn }
  }
  return { ready: true, reason: '', readyOn }
}

/** Today's limit for one mailbox: the ramp, its own limit, the hard ceiling. */
export function mailboxCap(mailbox, today) {
  const own = Math.max(0, Math.min(HARD_MAX_PER_MAILBOX, Number(mailbox?.daily_limit ?? 15) || 0))
  const day = mailbox?.first_sent_on ? daysBetween(mailbox.first_sent_on, today) : 0
  let step = RAMP[0]
  for (const s of RAMP) if (day >= s.fromDay) step = s
  const ramp = step.perDay
  return { cap: Math.min(own, ramp), own, day, ramping: ramp < own }
}

/** Is this moment inside the sending window (brand time)? */
export function inSendingWindow(now = new Date()) {
  const p = utcToBrandParts(now)
  if (!p || !SEND_DAYS.includes(p.weekday)) return false
  return p.time >= SEND_FROM && p.time < SEND_UNTIL
}

/** When the sending window next opens (or now, if it is open). */
export function nextWindowStart(now = new Date()) {
  if (inSendingWindow(now)) return new Date(now)
  for (let i = 0; i < 8; i++) {
    const key = addDays(brandDateKey(now), i)
    const start = new Date(brandWallToUtcISO(key, SEND_FROM))
    if (start > now && SEND_DAYS.includes(utcToBrandParts(start).weekday)) return start
  }
  return null
}

/**
 * Minutes to wait after a send. The day's cap spread over the window, then
 * varied by ±40% so the sends never land on a clock pattern.
 * @param {number} cap      today's cap for the mailbox
 * @param {number} random   0..1
 */
export function gapMinutes(cap, random = Math.random()) {
  const avg = WINDOW_MINUTES / Math.max(1, cap)
  const mins = avg * (0.6 + 0.8 * Math.min(1, Math.max(0, random)))
  return Math.round(Math.min(MAX_GAP_MINUTES, Math.max(MIN_GAP_MINUTES, mins)))
}

// ─── One run's rhythm ──────────────────────────────────────────────────────
// n8n starts a sending run on a 10-minute clock. Left alone, every email
// would leave at :00, :10, :20…, and three ready mailboxes on one domain
// would send in the same second. So within a run, per company:
//
//   • at most MAX_SENDS_PER_RUN emails, the rest go on the next run,
//   • the first after a random pause of 0–2 minutes, so sends land anywhere
//     in the ten minutes, not on the clock,
//   • each later one 40–100 seconds after the one before,
//   • nothing new is started once RUN_BUDGET_SECONDS have passed (n8n
//     waits 280 seconds for the run to answer).
export const MAX_SENDS_PER_RUN = 2
export const FIRST_PAUSE_SECONDS = [0, 120]
export const NEXT_PAUSE_SECONDS = [40, 100]
export const RUN_BUDGET_SECONDS = 200

/** Milliseconds to wait before this run's next email. */
export function pauseBeforeSend(sentThisRun, random = Math.random()) {
  const [lo, hi] = sentThisRun > 0 ? NEXT_PAUSE_SECONDS : FIRST_PAUSE_SECONDS
  return Math.round((lo + (hi - lo) * Math.min(1, Math.max(0, random))) * 1000)
}

/**
 * The bounce brake for one mailbox, over its last 7 days of cold sends.
 * A cold list with more than a few percent bad addresses was not verified,
 * and each bounce costs the domain reputation. Returns '' or the reason.
 */
export function mailboxHealthProblem({ sent = 0, bounced = 0 } = {}) {
  if (sent < 20) return ''
  const rate = bounced / sent
  if (rate >= 0.05) {
    return `Paused by the bounce brake: ${(rate * 100).toFixed(1)}% of this week's emails bounced (limit 5%). Verify the list before resuming.`
  }
  return ''
}

/** The subject of a follow-up: its own, or "Re:" the first email's. */
export function followUpSubject(stepSubject, firstSubject) {
  const own = String(stepSubject || '').trim()
  if (own) return own
  const first = String(firstSubject || '').trim()
  return /^re:/i.test(first) ? first : `Re: ${first}`
}

// ─── Reading the inbox ─────────────────────────────────────────────────────
// What a message arriving in an outreach thread means. Judged on the sender,
// the subject and the first lines of the reply (Microsoft's ~255-character
// preview). Nothing of the reply is stored: it is read, sorted, and dropped.

const BOUNCE_SENDER = /^(postmaster|mailer-daemon|mail-daemon|microsoftexchange[0-9a-f]*)@/i
const BOUNCE_SUBJECT = /^(undeliverable|undelivered mail|delivery (status notification|has failed|failure)|mail delivery (failed|subsystem)|returned mail|failure notice|لم يتم التسليم|تعذر التسليم)/i
const AUTO_SUBJECT = /^(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office|ooo\b|away from (the )?office|رد تلقائي|الرد التلقائي|خارج المكتب)/i

// A reply asking us to go away. Leaning towards "stop" is the safe mistake:
// a keen prospect wrongly unsubscribed can be moved back by hand, a person
// who said stop and got a newsletter cannot be un-emailed.
const OPT_OUT_EN = /\b(stop|unsubscribe|opt[\s-]?out|remove me|take me off|not interested|no,? thanks?|no thank you|(don'?t|do not|please don'?t) (e-?mail|contact|message|write to) (me|us)|leave me alone)\b/i
// Arabic has no \b, so each phrase must start a word: "يتوقف على" ("it
// depends on") and "منازل" ("houses") must not read as a request to stop.
const OPT_OUT_AR = new RegExp(`(^|[\\s،.!?؟"'«»(])(${[
  'توقف', 'أوقف', 'اوقف', 'إلغاء الاشتراك', 'الغاء الاشتراك', 'احذف', 'إزالة', 'ازالة',
  'لا أرغب', 'لا ارغب', 'لا نرغب', 'غير مهتم', 'لا تراسل', 'لا ترسل',
].join('|')})`)

// Where the quoted original starts. Our own email ends with 'reply "stop"',
// so the quote must never be read as the prospect's words.
const QUOTE_START = /(^|\s)(from:|sent:|on .{3,80} wrote:|-{2,} ?original message|_{5,}|من:|أرسل:|تم الإرسال:|كتب .{0,80}:|sent from my|get outlook for)/i

/** The prospect's own words at the top of a reply, without the quoted email. */
export function replyText(preview) {
  const text = String(preview || '').replace(/\s+/g, ' ').trim()
  const cut = text.search(QUOTE_START)
  return (cut >= 0 ? text.slice(0, cut) : text).trim()
}

/** Does this reply ask us to stop? Checked on the prospect's own words only. */
export function isOptOutReply(preview) {
  const own = replyText(preview)
  return OPT_OUT_EN.test(own) || OPT_OUT_AR.test(own)
}

/** @returns {'bounce'|'auto'|'optout'|'reply'} */
export function inboxMessageKind({ from = '', subject = '', preview = '' } = {}) {
  const subj = String(subject || '').trim()
  if (BOUNCE_SENDER.test(String(from || '')) || BOUNCE_SUBJECT.test(subj)) return 'bounce'
  if (AUTO_SUBJECT.test(subj)) return 'auto'
  if (isOptOutReply(preview)) return 'optout'
  return 'reply'
}

// ─── Emails that never finished sending ────────────────────────────────────
// A row is claimed ('sending') a moment before its email is handed over. If
// the run dies in between, nobody knows whether it left, and it is never
// retried by itself: a duplicate cold email is worse than a lost one. After
// this long a row in 'sending' is no longer a send in progress but a question.
export const STUCK_AFTER_MINUTES = 30

/** Is this send row stuck: claimed, and not finished within STUCK_AFTER_MINUTES? */
export function isStuckSend(row, now = Date.now()) {
  if (row?.status !== 'sending') return false
  const at = Date.parse(row.updated_at || '')
  return Number.isFinite(at) && now - at >= STUCK_AFTER_MINUTES * 60_000
}

// What the error column says while a stuck row waits for a person. The UI
// shows it; the automatic check writes it once and then leaves the row alone.
export const STUCK_NEEDS_PERSON = {
  microsoft: 'Not found in the mailbox\'s Sent Items or Drafts, so it most likely never left. Send it again, or drop it.',
  smtp: 'The sending run stopped while handing this email over. Look in the mailbox\'s Sent folder: if it is there, mark it sent; if not, send it again.',
}

/** A Message-ID on the mailbox's own domain. */
export function makeMessageId(mailboxEmail, uuid) {
  return `<${uuid}@${domainOf(mailboxEmail) || 'localhost'}>`
}

/**
 * What an SMTP failure means for the row and the mailbox.
 *   auth        the login is wrong or revoked: stop the mailbox
 *   limit       the provider's own daily limit: stop the mailbox for today
 *   recipient   this address does not exist: the contact bounced
 *   transient   try again later, nobody is to blame
 */
export function classifySmtpError(err) {
  const code = Number(err?.responseCode) || 0
  const text = `${err?.code || ''} ${err?.response || ''} ${err?.message || ''}`
  if (err?.code === 'EAUTH' || code === 535 || code === 534 || /authentication|username and password/i.test(text)) return 'auth'
  if (/5\.4\.5|sending limit|daily user sending quota|quota exceeded/i.test(text)) return 'limit'
  if (err?.command === 'RCPT TO' && code >= 550 && code < 560) return 'recipient'
  if (/5\.1\.1|user unknown|no such user|does not exist|recipient address rejected/i.test(text)) return 'recipient'
  return 'transient'
}

export function addDays(dateKey, n) {
  const t = Date.parse(`${dateKey}T00:00:00Z`)
  if (!Number.isFinite(t)) return null
  return new Date(t + n * 86_400_000).toISOString().slice(0, 10)
}

/** What a cold campaign is missing before it may start. Empty = ready. */
export function coldProblems(campaign) {
  const out = []
  if (!String(campaign?.subject || '').trim()) out.push('Add a subject line.')
  if (!String(campaign?.body || '').trim()) out.push('Write the first email.')
  const followUps = Array.isArray(campaign?.follow_ups) ? campaign.follow_ups : []
  followUps.forEach((f, i) => {
    if (!String(f?.body || '').trim()) out.push(`Follow-up ${i + 1} is empty: write it or remove it.`)
    const d = Number(f?.delay_days)
    if (!Number.isFinite(d) || d < 1 || d > 30) out.push(`Follow-up ${i + 1} needs a wait of 1 to 30 days.`)
  })
  const text = [campaign?.subject, campaign?.body, ...followUps.flatMap(f => [f?.subject, f?.body])].join(' ')
  const unknown = unknownMergeTags(text)
  if (unknown.length) out.push(`Unknown merge tag: ${unknown.map(t => `{{${t}}}`).join(', ')}.`)
  return out
}
