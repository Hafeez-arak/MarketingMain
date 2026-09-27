// ─── How many emails may go out today ──────────────────────────────────────
// A new sending domain has no reputation, and Gmail and Outlook judge it on
// its first few weeks. Volume that grows slowly, to people who open, builds
// one; a big first send to a cold list destroys it. So the daily ceiling is
// computed here, in code, and the sender obeys it — nobody has to remember.
//
// Today's cap is the LOWEST of:
//   1. the warm-up step for how many days sending has been going on,
//   2. the health brake (bounces and spam complaints over the last 7 days),
//   3. the provider's daily limit (Resend free: 100),
//   4. what is left of the provider's monthly limit (Resend free: 3,000).
//
// Pure: the server calls it before every batch, the Overview shows its answer.

// Days since the first send → emails per day. Each step is reached only by
// time; the health brake is what stops the climb when something goes wrong.
export const WARMUP_STEPS = [
  { fromDay: 0,  perDay: 30 },
  { fromDay: 3,  perDay: 50 },
  { fromDay: 7,  perDay: 100 },
  { fromDay: 14, perDay: 200 },
  { fromDay: 21, perDay: 400 },
  { fromDay: 28, perDay: 800 },
  { fromDay: 42, perDay: 2000 },
]

// Gmail's published line for complaints is 0.3%, and it wants senders under
// 0.1%. Bounces above ~2% mark a list as unverified; above 5% as bought.
export const HEALTH = {
  minSample: 20,            // below this many sends, rates are noise
  complaintPause: 0.003,    // stop sending
  bouncePause: 0.05,        // stop sending
  bounceHold: 0.02,         // stop climbing: back to the first step's volume
}

const DAY = 86_400_000

/** Whole days between two YYYY-MM-DD dates (b − a). */
export function daysBetween(a, b) {
  const pa = Date.parse(`${a}T00:00:00Z`)
  const pb = Date.parse(`${b}T00:00:00Z`)
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return 0
  return Math.max(0, Math.round((pb - pa) / DAY))
}

export function warmupStep(day) {
  let step = WARMUP_STEPS[0]
  for (const s of WARMUP_STEPS) if (day >= s.fromDay) step = s
  return step
}

/**
 * The health of the last 7 days of marketing sends.
 * @param {{ sent:number, bounced:number, complained:number }} recent
 * @returns {{ state:'ok'|'hold'|'paused', reason:string, bounceRate:number, complaintRate:number }}
 */
export function healthOf(recent = {}) {
  const sent = Number(recent.sent) || 0
  const bounceRate = sent ? (Number(recent.bounced) || 0) / sent : 0
  const complaintRate = sent ? (Number(recent.complained) || 0) / sent : 0
  if (sent < HEALTH.minSample) return { state: 'ok', reason: '', bounceRate, complaintRate }
  if (complaintRate >= HEALTH.complaintPause) {
    return { state: 'paused', reason: `Spam complaints are ${pct(complaintRate)} this week (limit 0.3%). Sending is paused until the list is cleaned.`, bounceRate, complaintRate }
  }
  if (bounceRate >= HEALTH.bouncePause) {
    return { state: 'paused', reason: `Bounces are ${pct(bounceRate)} this week (limit 5%). Sending is paused: the list has bad addresses.`, bounceRate, complaintRate }
  }
  if (bounceRate >= HEALTH.bounceHold) {
    return { state: 'hold', reason: `Bounces are ${pct(bounceRate)} this week. Volume is held low until they drop under 2%.`, bounceRate, complaintRate }
  }
  return { state: 'ok', reason: '', bounceRate, complaintRate }
}

function pct(r) { return `${(r * 100).toFixed(r < 0.01 ? 2 : 1)}%` }

/**
 * Today's cap for the marketing lane.
 *
 * @param {object} args
 * @param {object} args.settings      email_settings row (or defaults)
 * @param {string} args.today         YYYY-MM-DD in the brand's timezone
 * @param {number} args.sentToday     marketing emails already sent today
 * @param {number} args.sentThisMonth marketing emails already sent this month
 * @param {object} args.recent        { sent, bounced, complained } over 7 days
 * @returns {{ cap:number, remaining:number, day:number, limitedBy:string, health:object }}
 */
export function dailyCap({ settings = {}, today, sentToday = 0, sentThisMonth = 0, recent = {} }) {
  const started = settings.warmup_started_on || null
  const day = started ? daysBetween(started, today) : 0
  const health = healthOf(recent)

  const candidates = []
  const warm = settings.warmup_enabled !== false
  if (warm) candidates.push({ cap: warmupStep(day).perDay, by: 'warm-up' })
  if (health.state === 'paused') candidates.push({ cap: 0, by: 'health' })
  if (health.state === 'hold') candidates.push({ cap: WARMUP_STEPS[0].perDay, by: 'health' })

  const daily = Number(settings.provider_daily_limit ?? 100)
  if (Number.isFinite(daily)) candidates.push({ cap: Math.max(0, daily), by: 'provider daily limit' })
  const monthly = Number(settings.provider_monthly_limit ?? 3000)
  if (Number.isFinite(monthly)) {
    candidates.push({ cap: Math.max(0, monthly - sentThisMonth + sentToday), by: 'provider monthly limit' })
  }

  let best = { cap: Infinity, by: '' }
  for (const c of candidates) if (c.cap < best.cap) best = c
  const cap = Number.isFinite(best.cap) ? best.cap : 0
  return {
    cap,
    remaining: Math.max(0, cap - sentToday),
    day,
    limitedBy: best.by,
    health,
  }
}
