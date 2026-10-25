// ─── Waiting for Musa's ERP (2026-10-25) ───────────────────────────────────
// The owner's call: money and projects will come from Musa's ERP (see
// docs/COMPANY-HUB-PLAN.md and the Musa integration notes), not from Odoo. Until it
// is connected, v2 does not read Odoo's projects or accounts at all:
//
//   · the Technical and Finance sections are PARKED (lib/modules.js): hidden
//     from the rail, Home and Section access; their URLs go to Home. Their
//     code stays, to be reused or removed once the ERP's shape is known;
//   · the hourly Odoo mirror is off (api/leads/_deps.js);
//   · the CEO panel's Odoo numbers say they are waiting for the ERP.
//
// Sales keeps sending approved leads to Odoo (live, used daily) until the
// ERP's CRM takes over: that is not the mirror and is not affected.
//
// Un-parking is this switch plus the section list in modules.js.

export const ERP_PENDING = true

/** The words a waiting tile carries, in both languages. */
export const ERP_WAITING = { en: "Waiting for Musa's ERP", ar: 'بانتظار نظام موسى (ERP)' }
// A waiting tile reads "Waiting for Musa's ERP · Not connected yet".
export const ERP_WAITING_SUB = { en: 'Not connected yet', ar: 'لم يُربط بعد' }
