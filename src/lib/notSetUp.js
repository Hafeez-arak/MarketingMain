// ─── "This part isn't switched on" ─────────────────────────────────────────
// Every screen that needs an n8n workflow used to say "<X> webhook not
// configured — go to Settings → Integrations". That page is gone (#208), and
// the person reading it can't fix it anyway. They get one plain sentence; the
// console gets the name of the missing workflow, for whoever can.
export const NOT_SET_UP = 'This isn’t available right now — contact your admin.'

export function notSetUp(workflow) {
  if (workflow) console.warn(`[setup] The ${workflow} workflow address is not set for this workspace.`)
  return NOT_SET_UP
}
