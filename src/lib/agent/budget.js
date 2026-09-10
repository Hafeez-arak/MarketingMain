// ─── The spend cap ─────────────────────────────────────────────────────────
// A ledger tells you what happened. A cap is what stops it happening again,
// and it is the difference between "we saw the bill" and "the bill could not
// get there". AGENT.md §7.
//
// Pure functions over rows, so the decision can be tested against a month of
// synthetic usage without a database.

/**
 * The calendar month a moment belongs to, in UTC — 'YYYY-MM'.
 *
 * UTC, not brand time, and this is a real choice rather than laziness.
 * Scheduling in this app is deliberately brand-local (see brandTime.js: "10 AM"
 * in a content plan has never meant 10 AM wherever the laptop is). Spend is
 * the opposite case — it is reconciled against a provider invoice that rolls
 * in UTC, and a cap that resets three hours before or after the invoice does
 * would produce a month where the numbers disagree and nobody could say which
 * was right.
 */
export function monthKey(when = new Date()) {
  const d = when instanceof Date ? when : new Date(when)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * Total USD spent in the month containing `now`, from agent_usage rows.
 *
 * Rows are filtered here rather than trusted to have been filtered by the
 * query, because this function is also what a test and a support question run
 * against a dump.
 */
export function spentInMonth(rows = [], now = new Date()) {
  const key = monthKey(now)
  if (!key) return 0
  return rows.reduce((sum, row) => {
    if (monthKey(row?.created_at) !== key) return sum
    const cost = Number(row?.cost_usd)
    return Number.isFinite(cost) && cost > 0 ? sum + cost : sum
  }, 0)
}

// How close to the ceiling counts as worth warning about. Not a refusal —
// just the point where the UI should start saying so, since a cap that goes
// from silent to blocking with nothing in between reads as a bug.
export const WARN_AT = 0.8

/**
 * May this workspace make another agent call?
 *
 * @param {object} args
 * @param {number|null} args.cap    workspaces.agent_monthly_cap_usd — null = uncapped
 * @param {number} args.spent       from spentInMonth()
 * @param {number} args.estimate    rough USD this call may cost, 0 if unknown
 * @returns {{allowed:boolean, warn:boolean, spent:number, cap:number|null, remaining:number|null, reason:string}}
 */
export function capDecision({ cap = null, spent = 0, estimate = 0 } = {}) {
  const safeSpent = Number.isFinite(Number(spent)) ? Math.max(0, Number(spent)) : 0
  const safeEstimate = Number.isFinite(Number(estimate)) ? Math.max(0, Number(estimate)) : 0

  // Null is uncapped and is the resting state — a workspace nobody has set a
  // number for must keep working. Note that 0 is NOT null here: someone who
  // types 0 means "stop", and honouring that is the whole point of the field.
  const capped = cap !== null && cap !== undefined && cap !== '' && Number.isFinite(Number(cap))
  if (!capped) {
    return { allowed: true, warn: false, spent: safeSpent, cap: null, remaining: null, reason: '' }
  }

  const ceiling = Math.max(0, Number(cap))
  const remaining = ceiling - safeSpent

  if (remaining <= 0) {
    return {
      allowed: false, warn: true, spent: safeSpent, cap: ceiling, remaining: 0,
      reason: `This workspace has used its $${ceiling.toFixed(2)} agent budget for the month ` +
              `($${safeSpent.toFixed(2)} spent). Raise the cap in settings to continue.`,
    }
  }

  // Refuse a call we can already see will not fit, rather than starting it and
  // discovering that halfway through. A run that dies mid-loop still bills for
  // everything it did before dying, so the honest place to stop is before.
  if (safeEstimate > 0 && safeEstimate > remaining) {
    return {
      allowed: false, warn: true, spent: safeSpent, cap: ceiling, remaining,
      reason: `This run is estimated at $${safeEstimate.toFixed(2)} but only ` +
              `$${remaining.toFixed(2)} is left of the $${ceiling.toFixed(2)} monthly budget.`,
    }
  }

  return {
    allowed: true,
    warn: ceiling > 0 && safeSpent / ceiling >= WARN_AT,
    spent: safeSpent, cap: ceiling, remaining, reason: '',
  }
}
