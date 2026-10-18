import {
  targetsOf, controlKpis, controlDecisions, repRows, keyAccounts, topOpportunities, marketingNumbers,
} from '../lib/control/panel.js'
import { REGIONS } from '../lib/control/region.js'

// ─── The CEO panel's made-up company, for the dev harness ──────────────────
// Rows shaped like the real tables, run through the REAL panel.js, so the
// harness shows what the server would answer. Every name is invented: the
// repo is public, and real customers never go in it.

const H = 3_600_000
const ago = h => new Date(Date.now() - h * H).toISOString()

const TEAM = [
  { id: 'u-sami', name: 'Sami', email: 'sami@example.com', salesAdmin: true },
  { id: 'u-omar', name: 'Omar', email: 'omar@example.com', salesAdmin: false },
  { id: 'u-lina', name: 'Lina', email: 'lina@example.com', salesAdmin: false },
]

const lead = (o) => ({ verdict: 'qualified', duplicate_of: null, details: {}, late_alerted: {}, ...o })

export function controlState(mode = '') {
  const leads = mode === 'clear' ? [
    lead({ id: 'l1', company: 'Falcon Interiors', received_at: ago(30), assigned_to: 'u-omar', first_reply_at: ago(28) }),
  ] : [
    lead({ id: 'l1', company: 'Falcon Interiors', received_at: ago(96), assigned_to: 'u-omar', first_reply_at: ago(90), sender_type: 'contractor', summary: 'Downlights for a 12-floor office' }),
    lead({ id: 'l2', company: 'Desert Rose Hotels', received_at: ago(20), sender_type: 'developer_owner', summary: 'Lobby chandeliers and façade lighting, Jeddah', details: { location: 'Jeddah' } }),
    lead({ id: 'l3', company: 'Nakheel Fit-Out', received_at: ago(9), assigned_to: 'u-lina', summary: 'Track lights for a showroom' }),
    lead({ id: 'l4', company: 'Al Waha Clinics', received_at: ago(50), assigned_to: 'u-lina', first_reply_at: ago(46), quote_sent_at: ago(10), deal_value_sar: 380_000 }),
    lead({ id: 'l5', company: 'Horizon Consultants', received_at: ago(6), sender_type: 'consultant', summary: 'KNX controls for a villa compound' }),
    lead({ id: 'l6', company: 'Old Enquiry Co', received_at: ago(24 * 50) }),
  ]
  const accounts = [
    { id: 'a1', name: 'Crescent Developments', value_sar: 31_000_000, last_order: '2026-03-02', open_deals: 4, open_value_sar: 12_400_000, owner: 'Sami', next_step_on: '2026-10-10', last_contact_at: ago(24 * 44) },
    { id: 'a2', name: 'Palm Tower Contracting', value_sar: 18_500_000, last_order: '2026-08-21', open_deals: 2, open_value_sar: 3_100_000, owner: 'Omar', next_step_on: '2026-10-25', last_contact_at: ago(24 * 6) },
    { id: 'a3', name: 'Gulf Hospitality Group', value_sar: 9_200_000, last_order: '2025-12-14', open_deals: 1, open_value_sar: 900_000, owner: '', next_step_on: null, last_contact_at: null },
    { id: 'a4', name: 'Najd Health Projects', value_sar: 6_700_000, last_order: '2026-06-30', open_deals: 0, open_value_sar: 0, owner: 'Lina', next_step_on: '2026-11-02', last_contact_at: ago(24 * 12) },
  ]
  if (mode === 'clear') for (const a of accounts) { a.last_contact_at = ago(24 * 3); a.next_step_on = null }
  const opportunities = mode === 'clear' ? [] : [
    { id: 'o1', name: 'Riverside mixed-use tower, Riyadh', client: 'Example Real Estate', location: 'Riyadh', stage: 'Design', relevance: 'high', package_value_sar: 2_400_000, package: 'Architectural lighting', suggested_action: 'Ask the consultant for the lighting schedule', source_url: 'https://example.com/news/1', first_seen_at: ago(30), status: 'new' },
    { id: 'o2', name: 'Regional hospital expansion', client: 'Example Health Cluster', location: 'Eastern Province', stage: 'Tender', relevance: 'medium', package_value_sar: 1_100_000, first_seen_at: ago(60), status: 'new' },
  ]
  const targets = targetsOf({ revenue_month_sar: 4_000_000, pipeline_sar: 10_000_000, quotes_week: 6, routing_enabled: true, routing_since: ago(24 * 3), alert_emails: ['ceo@example.com', 'sales.admin@example.com'], brief_emails: ['ceo@example.com'] })
  const rules = [
    { id: 'r1', position: 1, sender_type: 'developer_owner', region: '', project_type: '', assign_to: 'u-sami' },
    { id: 'r2', position: 2, sender_type: '', region: 'western', project_type: '', assign_to: 'u-omar' },
  ]
  return { leads, accounts, opportunities, targets, rules, team: TEAM }
}

/** What /api/leads/control would answer for that company. */
export function controlAnswer(state) {
  const now = new Date()
  const args = { ...state, now }
  return {
    ok: true,
    targets: { ...state.targets, saved: true },
    rules: state.rules,
    team: state.team,
    regions: REGIONS,
    kpis: controlKpis(args),
    decisions: controlDecisions(args),
    reps: repRows(args),
    accounts: keyAccounts(state.accounts, state.targets, now),
    opportunities: topOpportunities(state.opportunities, now),
    marketing: marketingNumbers({ planned: 12, published: 3, websiteLeads: 4, linkedinFollowers: 4_900 }),
    odoo: null,
    at: now.toISOString(),
  }
}
