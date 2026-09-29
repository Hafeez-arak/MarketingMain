// ─── Research leads → people to write to ───────────────────────────────────
// The research agent finds projects, tenders and leads: companies, never
// people with addresses. The Contacts tab lists the open ones next to the
// contacts, so a person can look up who to write to (the search links) and
// add them as cold contacts tied to the lead (opportunity_id), or say the
// lead is not for outreach. Pure, so it is tested without a browser.

export const OPEN_LEAD_STATUSES = ['new', 'assigned', 'pursued']

const ROLES = [['client', 'Client'], ['contractor', 'Contractor'], ['consultant', 'Consultant']]

/** The named companies on a lead, each with its role, one entry per name. */
export function leadCompanies(opp) {
  const seen = new Map()
  for (const [key, label] of ROLES) {
    // A field may hold a list: "Nesma & Partners; Saudi Binladin Group".
    // Commas are not separators: they sit inside real names too.
    for (const raw of String(opp?.[key] || '').split(/\s*[;\n]\s*|\s+\/\s+/)) {
      const name = raw.trim()
      if (!name || /^(unknown|n\/a|tbc|tbd|-)$/i.test(name)) continue
      const k = name.toLowerCase()
      if (seen.has(k)) seen.get(k).roles.push(label)
      else seen.set(k, { name, roles: [label] })
    }
  }
  return [...seen.values()]
}

/**
 * Open leads still waiting for people: not won/lost/dropped, not marked
 * "not for outreach". Each carries the contacts already added for it.
 */
export function leadsForOutreach(opps = [], contacts = []) {
  const byLead = new Map()
  for (const c of contacts) {
    if (!c.opportunity_id) continue
    if (!byLead.has(c.opportunity_id)) byLead.set(c.opportunity_id, [])
    byLead.get(c.opportunity_id).push(c)
  }
  const rank = { high: 0, medium: 1, low: 2 }
  return opps
    .filter(o => OPEN_LEAD_STATUSES.includes(o.status) && !o.outreach_dismissed_at)
    .map(o => ({ ...o, companies: leadCompanies(o), contacts: byLead.get(o.id) || [] }))
    .sort((a, b) => (a.contacts.length > 0) - (b.contacts.length > 0)
      || (rank[a.relevance] ?? 1) - (rank[b.relevance] ?? 1)
      || String(b.last_seen_at || '').localeCompare(String(a.last_seen_at || '')))
}

/** Where to look for the people at a company. Opened by a person, never fetched. */
export function searchLinks(company, location = '') {
  const q = encodeURIComponent
  const city = String(location || '').split(',')[0].trim()
  return {
    google: `https://www.google.com/search?q=${q(`"${company}" ${city} email contact procurement`.replace(/\s+/g, ' ').trim())}`,
    linkedin: `https://www.linkedin.com/search/results/people/?keywords=${q(`${company} procurement OR "project manager" OR MEP`)}`,
    website: `https://www.google.com/search?q=${q(`${company} official website`)}`,
  }
}

/** The contact form, filled in for someone at this company on this lead. */
export function contactFromLead(opp, company) {
  const roles = company?.roles || []
  const type = roles.includes('Consultant') ? 'Consultant' : roles.includes('Contractor') ? 'Contractor' : 'Developer'
  return {
    company: company?.name || '', audience: 'cold', consent: 'none', source: 'research',
    contact_type: type, opportunity_id: opp.id,
    city: String(opp.location || '').split(',')[0].trim(),
    notes: [opp.name, opp.headline].filter(Boolean).join(': ').slice(0, 500),
  }
}
