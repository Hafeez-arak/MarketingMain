import { useMemo, useState } from 'react'
import { Card, Button } from '../../components/ui/index'
import { Pagination } from '../../components/ui/Pagination'
import { leadsForOutreach, searchLinks, contactFromLead } from '../../lib/email/leads'
import { fetchResearchLeads, fetchLeadContacts, dismissLeadForOutreach, PAGE_SIZE } from '../../lib/email/client'
import { useCached } from './data'
import { shortDate } from './format'

// ─── From research: leads waiting for people ───────────────────────────────
// The research agent names companies (a hotel's developer, its contractor,
// its consultant), never people with addresses. This note sits above the
// contact list: per company, searches a person opens to find who handles
// lighting or procurement, and "Add contact", which opens the contact form
// already filled in as a cold prospect tied to the lead. "Not for outreach"
// takes the lead off this list; it stays a lead in Insights.
//
// It reads the open leads (the newest 100) and only the contacts tied to a
// lead, never the whole contact list. Leads waiting for people come first,
// an order only this page knows, so "Show all" pages through them here.

const SHOWN = 4

export function ResearchLeads({ workspaceId, onAdd }) {
  const oppsRead = useCached(workspaceId ? `research-leads:${workspaceId}` : null, () => fetchResearchLeads(workspaceId))
  const tiedRead = useCached(workspaceId ? `lead-contacts:${workspaceId}` : null, () => fetchLeadContacts(workspaceId))
  const [dismissed, setDismissed] = useState(() => new Set())
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')

  const opps = useMemo(() => (oppsRead.data && tiedRead.data ? oppsRead.data.filter(o => !dismissed.has(o.id)) : null),
    [oppsRead.data, tiedRead.data, dismissed])
  const leads = useMemo(() => leadsForOutreach(opps || [], tiedRead.data || []), [opps, tiedRead.data])
  const waiting = leads.filter(l => !l.contacts.length).length
  if (!opps || !leads.length) return null

  async function dismiss(id) {
    setError('')
    try { await dismissLeadForOutreach(workspaceId, id); setDismissed(d => new Set(d).add(id)) }
    catch (err) { setError(err.message) }
  }

  const lastPage = Math.max(0, Math.ceil(leads.length / PAGE_SIZE) - 1)
  const shownPage = Math.min(page, lastPage)
  const visible = all ? leads.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE) : leads.slice(0, SHOWN)
  return (
    <Card>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full px-4 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-surface-subtle">
        <span className="min-w-0">
          <span className="text-xs font-semibold text-text">From research: {leads.length} lead{leads.length === 1 ? '' : 's'}{waiting ? `, ${waiting} with nobody to write to yet` : ''}</span>
          <span className="block text-[11px] text-text-tertiary">Research finds companies, not people. Look up who handles lighting or procurement, then add them here.</span>
        </span>
        <span className="text-[11px] text-text-secondary flex-shrink-0">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border">
          {error && <p className="px-4 py-2 text-xs text-red-600">{error}</p>}
          {visible.map(l => (
            <div key={l.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">
                    {l.name}
                    <span className="ml-2 text-[10px] uppercase tracking-wide text-text-tertiary">{l.type}{l.relevance === 'high' ? ' · high' : ''}</span>
                  </p>
                  {l.headline && <p className="text-xs text-text-secondary mt-0.5">{l.headline}</p>}
                  <p className="text-[11px] text-text-tertiary mt-0.5">
                    {[l.location, l.deadline && `deadline ${shortDate(l.deadline)}`].filter(Boolean).join(' · ')}
                    {l.source_url && <> · <a href={l.source_url} target="_blank" rel="noreferrer" className="underline">source</a></>}
                    {l.contacts.length > 0 && <span className="text-sage-700"> · {l.contacts.length} contact{l.contacts.length === 1 ? '' : 's'} added: {l.contacts.map(c => c.email).join(', ')}</span>}
                  </p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => dismiss(l.id)}>Not for outreach</Button>
              </div>
              {l.companies.length === 0 ? (
                <p className="text-[11px] text-text-tertiary mt-1.5">No company is named on this lead yet. Open the source to see who is behind it.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {l.companies.map(co => {
                    const links = searchLinks(co.name, l.location)
                    return (
                      <li key={co.name} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="text-text">{co.name} <span className="text-text-tertiary">({co.roles.join(', ').toLowerCase()})</span></span>
                        <a href={links.google} target="_blank" rel="noreferrer" className="text-text-secondary underline underline-offset-2">Search emails</a>
                        <a href={links.linkedin} target="_blank" rel="noreferrer" className="text-text-secondary underline underline-offset-2">People on LinkedIn</a>
                        <a href={links.website} target="_blank" rel="noreferrer" className="text-text-secondary underline underline-offset-2">Website</a>
                        <button type="button" onClick={() => onAdd(contactFromLead(l, co))} className="text-amber-800 font-semibold underline underline-offset-2">Add contact</button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          ))}
          {all && <Pagination page={shownPage} pageSize={PAGE_SIZE} count={leads.length} onPage={setPage} noun="leads" />}
          {leads.length > SHOWN && (
            <div className="px-4 py-2 text-center">
              <button type="button" onClick={() => { setAll(a => !a); setPage(0) }} className="text-[11px] text-text-secondary underline">{all ? 'Show fewer' : `Show all ${leads.length}`}</button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
