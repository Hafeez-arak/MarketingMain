// ─── sales.araklighting.com ────────────────────────────────────────────────
// The sales team's address (the owner, 2026-10-19: "it is now sales"). Same
// app and same Vercel project; on this host the home page IS the leads page.
// The old leads.* addresses are switched off: vercel.json sends anyone who
// opens one to sales.araklighting.com.

/** Is the app being opened on the sales team's address? */
export function isLeadsHost(hostname = typeof window !== 'undefined' ? window.location.hostname : '') {
  return /^sales\./i.test(String(hostname || ''))
}
