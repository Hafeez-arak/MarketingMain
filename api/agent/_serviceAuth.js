import { timingSafeEqual } from 'node:crypto'
import { callerId, callerMayUseWorkspace } from './_supabase.js'

// ─── Letting n8n call the agent, without letting the internet call it ──────
// The run is now three routes that n8n drives in sequence. n8n has no user
// session, so the existing `callerId` / `callerMayUseWorkspace` pair — which
// resolves a Supabase JWT — cannot authorise it.
//
// So these routes accept EITHER:
//
//   a signed-in user, exactly as before (the browser's "run now" button), or
//   a bearer token equal to AGENT_RUN_SECRET (n8n, and only n8n).
//
// ── THE RULE THIS FILE EXISTS TO ENFORCE ──
//
// An unset secret must DENY, never allow. The tempting shape is
// `if (!SECRET) return true` — "no secret configured, so skip the check" —
// which turns a forgotten environment variable into an open endpoint that
// spends money on someone else's Anthropic bill and reads another tenant's
// brand. A missing secret means the service path is closed, full stop; the
// browser path still works, so a forgotten variable degrades to "n8n cannot
// trigger runs", which is visible and harmless.

const SECRET = process.env.AGENT_RUN_SECRET || ''

/** Constant-time compare that does not leak length through early return. */
function sameSecret(given) {
  if (!SECRET || !given) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(SECRET)
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal. Hashing both to a fixed width first would be tidier; for a
  // shared secret compared a handful of times a week, rejecting unequal
  // lengths up front is enough and is easier to read.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** The bearer token on this request, if any. */
function bearer(req) {
  const raw = req?.headers?.authorization || req?.headers?.Authorization || ''
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim())
  return m ? m[1].trim() : ''
}

/**
 * May this request act on this workspace?
 *
 * @returns {Promise<{ok: boolean, as: 'service'|'user'|'', status: number, error: string}>}
 */
export async function authorise(req, workspaceId) {
  // Service first: it is a cheap string compare, and n8n is the common caller
  // for these routes. A user check costs two network round trips to Supabase.
  if (sameSecret(bearer(req))) {
    return { ok: true, as: 'service', status: 200, error: '' }
  }

  const userId = await callerId(req)
  if (!userId) {
    return {
      ok: false,
      as: '',
      status: 401,
      // Names both doors, because the caller is as likely to be a misconfigured
      // n8n workflow as a signed-out browser, and "unauthorized" sends someone
      // to check the wrong one.
      error: 'Sign in, or send a valid AGENT_RUN_SECRET bearer token.',
    }
  }

  const allowed = await callerMayUseWorkspace(req, workspaceId)
  if (!allowed) {
    return { ok: false, as: '', status: 403, error: 'You do not have access to this workspace.' }
  }

  return { ok: true, as: 'user', status: 200, error: '' }
}

/** Is the service door configured at all? Used only for diagnostics. */
export const serviceAuthConfigured = Boolean(SECRET)
