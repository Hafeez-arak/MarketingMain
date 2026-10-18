// ─── Opening the assistant from anywhere ───────────────────────────────────
// 2026-10-18, PR 4 of docs/CEO-ASSISTANT-PLAN.md. The "comment box" the CEO
// asked for is the assistant, reached from where he is: the dashboard's Ask
// Arak box, and "Ask about this" on a lead or a request. Each one opens the
// drawer with that item pinned as context, so "this caption is weak" knows
// which caption.
//
// A window event rather than a context provider: the drawer is mounted once
// in AppLayout and the callers are scattered across pages that should not
// all have to sit inside a new provider.

export const ASK_EVENT = 'arak:ask'

/**
 * @param {object} p
 * @param {string} [p.question]  prefilled, or sent at once when `send` is true
 * @param {{entity:string,id:string,label:string}} [p.item]  what "this" is
 * @param {boolean} [p.send]
 */
export function askAssistant({ question = '', item = null, send = false } = {}) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: { question, item, send } }))
}

/** Whether a drawer is listening. The sales-only Leads app has none. */
export const assistantMounted = () => Boolean(typeof window !== 'undefined' && window.__arakAssistant)
