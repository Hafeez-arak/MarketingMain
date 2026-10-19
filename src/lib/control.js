// ─── The CEO control panel's calls ─────────────────────────────────────────
// 2026-10-18. Everything the panel shows comes from one server answer
// (/api/leads/control, computed by src/lib/control/panel.js on the server),
// and every button is one more action on the same route. See
// api/leads/_control.js. The leads route carries them because Vercel Hobby
// builds twelve functions and all twelve exist.

async function call(action, workspaceId, accessToken, body = {}) {
  try {
    const res = await fetch(`/api/leads/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ workspace_id: workspaceId, ...body }),
    })
    const out = await res.json().catch(() => ({}))
    if (!res.ok || out.ok === false) return { error: out.error || `It did not work (${res.status}).` }
    return out
  } catch (err) {
    return { error: err?.message || 'It did not work. Check the connection and try again.' }
  }
}

export const fetchControl = (ws, token) => call('control', ws, token)
export const saveTargets = (ws, token, targets) => call('targets_save', ws, token, targets)
export const saveRouting = (ws, token, rules) => call('routing_save', ws, token, { rules })
export const assignLead = (ws, token, leadId, userId) => call('assign', ws, token, { lead_id: leadId, user_id: userId })
export const remindOwner = (ws, token, leadId) => call('remind', ws, token, { lead_id: leadId })
export const accountContacted = (ws, token, accountId) => call('account_contacted', ws, token, { account_id: accountId })
export const sendToSales = (ws, token, opportunityId, userId) => call('send_to_sales', ws, token, { opportunity_id: opportunityId, user_id: userId })
export const markLead = (ws, token, leadId, what, extra = {}) => call('lead_mark', ws, token, { lead_id: leadId, what, ...extra })
export const alertsNow = (ws, token) => call('alerts_now', ws, token)
export const odooSync = (ws, token) => call('odoo_sync', ws, token)
