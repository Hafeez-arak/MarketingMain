// ─── The sales team's address ──────────────────────────────────────────────
// The sales team's address for the leads page: leads.araklighting.com from
// 2026-10-11, sales.araklighting.com from 2026-10-19 (the owner: "name it
// sales"). Same app and same Vercel project; on either host the home page IS
// the leads page. leads.* keeps working so old links do not break.

/** Is the app being opened on the sales team's address (sales.* or leads.*)? */
export function isLeadsHost(hostname = typeof window !== 'undefined' ? window.location.hostname : '') {
  return /^(sales|leads)\./i.test(String(hostname || ''))
}
