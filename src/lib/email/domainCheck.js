// ─── Is the sending domain set up for outreach? ────────────────────────────
// Gmail and Outlook check three DNS records on every email from a domain:
//
//   SPF    which servers may send for it. Without it, or without the
//          mailbox's own provider in it, the email fails at the first check.
//   DKIM   a signature only the domain's provider can make. Without it the
//          email is unsigned, and cold email that is unsigned goes to spam.
//   DMARC  what to do when the two fail, and where to report. Optional at
//          this volume, but its absence is a warning sign of its own.
//
// And MX: where replies to the domain are delivered. No MX, no replies.
//
// Found on 2026-10-08: clb-sa.com and ghusnsa.com had SPF but no DKIM, and
// araklighting.com was not registered yet. So a mailbox does not send until
// its domain passes: SPF, DKIM and MX block; DMARC only warns.
//
// Pure: the DNS answers are looked up in api/email/_dns.js and judged here,
// so the Mailboxes page shows exactly the rule the sending run applies.

/** A check older than this is looked up again by the next sending run. */
export const DNS_STALE_HOURS = 12

/** Where each provider publishes its DKIM key. */
export const DKIM_SELECTORS = {
  microsoft: ['selector1', 'selector2'],
  google: ['google'],
  other: ['google', 'selector1', 'selector2', 'default', 's1', 's2', 'k1', 'dkim', 'mail'],
}

/** The SPF include each provider's servers are listed under. */
export const SPF_INCLUDE = {
  microsoft: 'spf.protection.outlook.com',
  google: '_spf.google.com',
}

const PROVIDER_NAME = { microsoft: 'Microsoft 365', google: 'Google' }

/** Each provider's own MX hosts. */
const MX_HOST = {
  microsoft: /\.mail\.protection\.outlook\.com$/i,
  google: /(^|\.)(google\.com|googlemail\.com)$/i,
}

/** Which kind of provider sends for this mailbox. */
export function providerKind(mailbox) {
  if (mailbox?.provider === 'microsoft') return 'microsoft'
  if (/(^|\.)gmail\.com$/i.test(String(mailbox?.smtp_host || ''))) return 'google'
  return 'other'
}

/**
 * The verdict on one domain's DNS answers.
 * @param {object} found  from lookupDomain(): { domain, mx[], spf[], spfIncludes[],
 *                        spfComplete, dkim[], dkimPending[], dmarc, failed[] }
 * @param {'microsoft'|'google'|'other'} kind
 * @returns {{ blocking: string[], warnings: string[] }}
 */
export function judgeDomain(found = {}, kind = 'other') {
  const blocking = []
  const warnings = []
  const d = found.domain || 'the domain'
  const failed = new Set(found.failed || [])
  const unsure = what => warnings.push(`${what} could not be looked up just now; it is checked again on a later run.`)

  if (failed.has('mx')) unsure('MX')
  else if (!(found.mx || []).length) blocking.push(`${d} has no MX record, so replies to it cannot arrive.`)
  else if (MX_HOST[kind]) {
    // ghusnsa.com, 2026-10-08: Outlook plus two Hostinger servers. A reply
    // the first refuses for a moment is delivered to the others instead.
    const strays = found.mx.filter(h => !MX_HOST[kind].test(h))
    if (strays.length) warnings.push(`${d} also lists ${strays.join(', ')} as mail servers, so some replies may be delivered there instead of to ${PROVIDER_NAME[kind]}. Remove them if nobody uses them.`)
  }

  const spf = found.spf || []
  if (failed.has('spf')) unsure('SPF')
  else if (!spf.length) blocking.push(`${d} has no SPF record.`)
  else if (spf.length > 1) blocking.push(`${d} has ${spf.length} SPF records; receivers treat that as none. Merge them into one.`)
  else if (SPF_INCLUDE[kind]) {
    const want = SPF_INCLUDE[kind]
    const has = (found.spfIncludes || []).map(s => String(s).toLowerCase()).includes(want)
    if (!has && found.spfComplete) blocking.push(`${d}'s SPF record does not allow ${PROVIDER_NAME[kind]} to send for it (include:${want} is missing).`)
    else if (!has) warnings.push(`${d}'s SPF record could not be followed to the end, so it is not certain it allows ${PROVIDER_NAME[kind]}.`)
  }

  if (failed.has('dkim')) unsure('DKIM')
  else if (!(found.dkim || []).length) {
    blocking.push((found.dkimPending || []).length
      ? `${d}'s DKIM records point to ${PROVIDER_NAME[kind] || 'the provider'}, but no key is published there yet: switch DKIM signing on in ${PROVIDER_NAME[kind] || 'the provider'}'s admin.`
      : `${d} has no DKIM record, so its emails are unsigned.`)
  }

  if (failed.has('dmarc')) unsure('DMARC')
  else if (!found.dmarc) warnings.push(`${d} has no DMARC record. Add one (v=DMARC1; p=none; rua=mailto:…) to receive reports.`)

  return { blocking, warnings }
}

/** Does this mailbox's domain need looking up again? */
export function isDnsStale(mailbox, now = new Date()) {
  const at = Date.parse(mailbox?.dns_checked_at || '')
  return !Number.isFinite(at) || now.getTime() - at >= DNS_STALE_HOURS * 3_600_000
}

/** What stops this mailbox's domain sending, as one sentence, or ''. */
export function dnsBlockReason(mailbox) {
  const blocking = mailbox?.dns_check?.blocking || []
  return blocking.length ? `Its domain is not ready for outreach: ${blocking.join(' ')}` : ''
}
