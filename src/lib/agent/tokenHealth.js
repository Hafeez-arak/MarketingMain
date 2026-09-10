// ─── Is the Meta token going to stop working, and when? ────────────────────
// Meta runs TWO clocks on a token and they fail differently. The second one is
// the dangerous one and it is the reason this file exists.
//
//   expires_at              The token itself. A long-lived one reports 0,
//                           meaning never. Straightforward.
//
//   data_access_expires_at  The app's permission to READ DATA, ~90 days from
//                           the last authorisation. When this lapses the token
//                           stays VALID and is_valid keeps saying true — calls
//                           simply stop returning data, sometimes with no error
//                           at all. An integration that "went quiet after about
//                           three months" is almost always this.
//
// A silent stop is exactly the failure this project keeps paying for: the
// spinner nobody can close, the empty-200 from n8n, the anon key that read as
// success. So the deadline is surfaced BEFORE it lands rather than diagnosed
// afterwards.
//
// Pure — takes a debug_token payload, returns a verdict.

/** Warn this far ahead. Long enough to do something, short enough to not nag. */
export const WARN_WITHIN_DAYS = 21

const daysUntil = (epochSeconds, now) => {
  if (!epochSeconds) return null
  return Math.round((epochSeconds - now / 1000) / 86_400)
}

/**
 * Read a `debug_token` response into something a person can act on.
 *
 * @param {object} data  the `data` object from GET /debug_token
 * @param {number} now   ms since epoch, injectable so this is testable
 */
export function tokenHealth(data, now = Date.now()) {
  if (!data) {
    return {
      status: 'missing',
      ok: false,
      headline: 'No Meta token is configured, so no competitor can be measured.',
      action: 'Set META_IG_TOKEN and META_IG_USER_ID.',
    }
  }

  if (data.is_valid === false) {
    return {
      status: 'invalid',
      ok: false,
      headline: 'The Meta token is no longer valid.',
      action: 'Generate a new token and update META_IG_TOKEN.',
    }
  }

  // 0 means never. Treated explicitly rather than falling through the numeric
  // path, where `0` would read as "expired in 1970".
  const tokenDays = data.expires_at === 0 ? null : daysUntil(data.expires_at, now)
  const dataDays = daysUntil(data.data_access_expires_at, now)

  if (tokenDays !== null && tokenDays <= 0) {
    return {
      status: 'expired',
      ok: false,
      headline: 'The Meta token has expired.',
      action: 'Generate a new one and update META_IG_TOKEN.',
      tokenDays, dataDays,
    }
  }

  // The data-access clock is checked BEFORE the token clock when both are
  // live, because it is the one that arrives without an error to explain it.
  if (dataDays !== null && dataDays <= 0) {
    return {
      status: 'data_access_expired',
      ok: false,
      headline: 'The token is still valid but its DATA ACCESS has lapsed — ' +
                'this is why calls return nothing rather than an error.',
      action: 'Re-authorise the app to reset the 90-day data-access window.',
      tokenDays, dataDays,
    }
  }

  if (dataDays !== null && dataDays <= WARN_WITHIN_DAYS) {
    return {
      status: 'data_access_expiring',
      ok: true,
      headline: `Meta data access lapses in ${dataDays} day${dataDays === 1 ? '' : 's'}. ` +
                'The token will still report itself valid — competitor numbers will just stop arriving.',
      action: 'Re-authorise the app before then, or move to a Business Manager System User token.',
      tokenDays, dataDays,
    }
  }

  if (tokenDays !== null && tokenDays <= WARN_WITHIN_DAYS) {
    return {
      status: 'expiring',
      ok: true,
      headline: `The Meta token expires in ${tokenDays} day${tokenDays === 1 ? '' : 's'}.`,
      action: 'Exchange it for a long-lived token, or use a System User token.',
      tokenDays, dataDays,
    }
  }

  return {
    status: 'healthy',
    ok: true,
    headline: tokenDays === null
      ? `Meta token does not expire; data access runs for another ${dataDays} days.`
      : `Meta token good for ${tokenDays} days; data access for ${dataDays}.`,
    action: '',
    tokenDays, dataDays,
  }
}

/**
 * Should this be shown to a person right now?
 *
 * Healthy is deliberately silent. A banner that is always up is a banner
 * nobody reads, and the one week it says something new is the week it gets
 * ignored.
 */
export function worthSurfacing(health) {
  return Boolean(health) && health.status !== 'healthy'
}
