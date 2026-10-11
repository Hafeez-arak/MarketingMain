// ─── leads.arak-sa.com ─────────────────────────────────────────────────────
// The sales team's address for the leads page (the owner, 2026-10-11). Same
// app and same Vercel project; on this host the home page IS the leads page.
// How far sales and marketing separate beyond that is decided later.

/** Is the app being opened on a leads.* address? */
export function isLeadsHost(hostname = typeof window !== 'undefined' ? window.location.hostname : '') {
  return /^leads\./i.test(String(hostname || ''))
}
