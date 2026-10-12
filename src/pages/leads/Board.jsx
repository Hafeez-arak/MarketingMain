import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Skeleton, Input, Select } from '../../components/ui/index'
import { fetchLeadsPage } from '../../lib/leads/client'
import {
  SHOW_OPTIONS, EMPTY_FILTERS, activeFilterCount, effectiveVerdict, PAGE_SIZE, pageLabel, pageCount, when,
  SENDER_LABEL, PROJECT_LABEL, REQUEST_LABEL, FOLDER_LABEL, PHILIPS_LABEL, channelLabel, brandOf, phonesOf,
} from '../../lib/leads/view'
import { VerdictTag, LeadDetail } from './parts'

// ─── The leads list ────────────────────────────────────────────────────────
// What the sales team asked for (2026-10-11): one clean row per lead with
// the criteria as columns (who wrote, what they want, JIH / tender /
// maintenance, verified, company or free email, Junk), filters on each, and
// everything else (the email as it arrived, why the agent decided, Outlook)
// one click away in the opened row. Filtered and paged in the database, so
// every lead is reachable however many there are.

const SENDER_OPTIONS = Object.entries(SENDER_LABEL)
const PROJECT_OPTIONS = [...Object.entries(PROJECT_LABEL), ['none', 'Not stated']]
const REQUEST_OPTIONS = Object.entries(REQUEST_LABEL)
const FOLDER_OPTIONS = Object.entries(FOLDER_LABEL)

// Column widths, shared by the header and every row so they line up.
const GRID = 'md:grid md:grid-cols-[6.5rem_minmax(0,1.6fr)_minmax(0,2.2fr)_7rem_6.5rem_6rem_5.5rem_6.5rem] md:gap-3 md:items-start'

function Cell({ label, children, className = '' }) {
  // On a phone each value carries its own label; on a desktop the header does.
  return (
    <div className={`min-w-0 ${className}`}>
      <span className="md:hidden text-[10px] text-text-tertiary uppercase tracking-wide mr-1.5">{label}</span>
      {children}
    </div>
  )
}

const dash = <span className="text-text-tertiary">—</span>

function Row({ lead, open, onToggle, onReview }) {
  const v = effectiveVerdict(lead)
  const v2 = (lead.criteria_version || 1) >= 2
  const junk = lead.folder === 'junk'
  return (
    <li className={open ? 'bg-surface-subtle' : ''}>
      <button type="button" onClick={onToggle} aria-expanded={open}
        className={`w-full text-left px-4 py-3 hover:bg-surface-subtle transition-colors grid grid-cols-2 gap-x-3 gap-y-1.5 ${GRID}`}>
        <Cell label="Received" className="col-span-2 md:col-span-1">
          <span className="text-[11px] text-text-secondary tabular-nums">{when(lead.received_at || lead.created_at)}</span>
          <span className="block text-[10px] mt-0.5 text-text-secondary font-semibold">{channelLabel(lead)}</span>
          {lead.source === 'email' && lead.folder && (
            <span className={`block text-[10px] ${junk ? 'text-red-600 font-semibold' : 'text-text-tertiary'}`}>{FOLDER_LABEL[lead.folder] || lead.folder}</span>
          )}
        </Cell>
        <Cell label="From" className="col-span-2 md:col-span-1">
          <span className="text-sm font-semibold text-text truncate block" dir="auto">{lead.company || lead.name || lead.email || 'Unknown sender'}</span>
          <span className="text-[11px] text-text-tertiary truncate block">
            {lead.email ? lead.email.split('@')[1] : ''}{lead.email_kind === 'free' ? ' · free email' : ''}
          </span>
          {phonesOf(lead)[0] && <span className="text-[11px] text-text-secondary truncate block tabular-nums" dir="ltr">{phonesOf(lead)[0]}{phonesOf(lead).length > 1 ? ` +${phonesOf(lead).length - 1}` : ''}</span>}
        </Cell>
        <Cell label="Wants" className="col-span-2 md:col-span-1">
          <span className="text-xs text-text line-clamp-2" dir="auto">{lead.summary || lead.subject || lead.message}</span>
          {PHILIPS_LABEL[lead.philips] && <span className={`text-[10px] ${lead.philips === 'only' ? 'text-red-600 font-semibold' : 'text-text-tertiary'}`}>{PHILIPS_LABEL[lead.philips]}</span>}
        </Cell>
        <Cell label="Who">
          <span className={`text-xs ${lead.sender_type === 'trader' ? 'text-amber-800 font-semibold' : 'text-text'}`}>{v2 ? SENDER_LABEL[lead.sender_type] || dash : dash}</span>
        </Cell>
        <Cell label="Request">
          <span className="text-xs text-text">{REQUEST_LABEL[lead.request_type] || dash}</span>
        </Cell>
        <Cell label="Project">
          <span className={`text-xs ${lead.project_type ? 'text-text font-semibold' : 'text-text-tertiary'}`}>{PROJECT_LABEL[lead.project_type] || (v2 ? 'Not stated' : '—')}</span>
        </Cell>
        <Cell label="Source">
          {v2 && lead.source_check
            ? <span className={`text-xs ${lead.source_check === 'verified' ? 'text-sage-700' : 'text-amber-800'}`}>{lead.source_check === 'verified' ? 'Verified' : 'Not verified'}</span>
            : dash}
        </Cell>
        <Cell label="Verdict" className="md:text-right">
          <VerdictTag verdict={v} corrected={Boolean(lead.human_verdict && lead.human_verdict !== lead.verdict)} />
        </Cell>
      </button>
      {open && (
        <div className="border-t border-border bg-white">
          <LeadDetail lead={lead} onReview={onReview} wide />
        </div>
      )}
    </li>
  )
}

export default function LeadsBoard({ workspaceId, onReview, refreshKey = 0, mailboxes = [] }) {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  // The search box waits for a pause in typing before it asks the database.
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const [list, setList] = useState({ key: null, rows: [], total: 0, error: '' })
  const wanted = useRef('')
  const top = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setFilters((f) => (f.search === searchText ? f : { ...f, search: searchText }))
      setPage(0)
    }, 350)
    return () => clearTimeout(t)
  }, [searchText])

  const key = `${workspaceId}|${JSON.stringify(filters)}|${page}|${refreshKey}`
  const load = useCallback(async () => {
    if (!workspaceId) return
    wanted.current = key
    try {
      const r = await fetchLeadsPage(workspaceId, { filters, page })
      if (wanted.current !== key) return
      if (!r.rows.length && r.total && page > 0) return setPage(pageCount(r.total) - 1)
      setList({ key, ...r, error: '' })
    } catch (err) {
      if (wanted.current === key) setList({ key, rows: [], total: 0, error: err.message || String(err) })
    }
  }, [workspaceId, filters, page, key])

  useEffect(() => { queueMicrotask(load) }, [load])

  // A correction changes the row in place; it leaves the list on the next load.
  async function review(lead, verdict) {
    const updated = await onReview(lead, verdict)
    if (updated) setList((s) => ({ ...s, rows: s.rows.map((l) => (l.id === lead.id ? { ...l, ...updated } : l)) }))
  }

  const set = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(0); setOpen(null) }
  const clear = () => { setFilters((f) => ({ ...EMPTY_FILTERS, show: f.show })); setSearchText(''); setPage(0); setOpen(null) }
  const goTo = (p) => {
    setPage(p); setOpen(null)
    const y = top.current?.getBoundingClientRect().top
    if (y != null && y < 0) top.current.scrollIntoView({ block: 'start' })
  }

  const loading = list.key !== key
  const pages = pageCount(list.total)
  const extra = activeFilterCount(filters)

  return (
    <div ref={top} className="bg-white border border-border min-w-0 scroll-mt-4">
      {/* ── Filters ── */}
      <div className="p-4 border-b border-border grid grid-cols-2 md:grid-cols-4 xl:grid-cols-[1.3fr_1.1fr_1fr_1fr_1fr_1fr_1fr_1.5fr] gap-3 items-end">
        <Select label="Show" value={filters.show} onChange={set('show')} className="col-span-2 md:col-span-1">
          {SHOW_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
        <Select label="Came in" value={filters.channel} onChange={set('channel')}>
          <option value="">Anywhere</option>
          <option value="website">{channelLabel({ source: 'website_form' })}</option>
          {mailboxes.map((m) => <option key={m.id} value={m.label || m.email}>{brandOf(m.label || m.email)} email ({m.label || m.email})</option>)}
        </Select>
        <Select label="Who" value={filters.sender} onChange={set('sender')}>
          <option value="">Anyone</option>
          {SENDER_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label="Project" value={filters.project} onChange={set('project')}>
          <option value="">Any</option>
          {PROJECT_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label="Request" value={filters.request} onChange={set('request')}>
          <option value="">Any</option>
          {REQUEST_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label="Folder" value={filters.folder} onChange={set('folder')}>
          <option value="">Any</option>
          {FOLDER_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
        <Select label="Email" value={filters.emailKind} onChange={set('emailKind')}>
          <option value="">Any</option>
          <option value="company">Company domain</option>
          <option value="free">Free email (Gmail…)</option>
        </Select>
        <div className="col-span-2 md:col-span-2 xl:col-span-1">
          <Input id="leads-search" label="Search" placeholder="Company, subject, words…" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
        </div>
      </div>
      <div className="px-4 py-2 flex items-center justify-between gap-3 border-b border-border">
        <p className="text-[11px] text-text-secondary tabular-nums">
          {loading ? 'Loading…' : `${list.total} ${list.total === 1 ? 'lead' : 'leads'}`}
          {extra > 0 && !loading ? ` · ${extra} filter${extra === 1 ? '' : 's'} on` : ''}
        </p>
        {extra > 0 && <Button size="xs" variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>

      {/* ── Header (desktop) ── */}
      <div className={`hidden ${GRID} px-4 py-2 border-b border-border text-[10px] font-semibold text-text-tertiary uppercase tracking-wide`}>
        <span>Received</span><span>From</span><span>Wants</span><span>Who</span><span>Request</span><span>Project</span><span>Source</span><span className="text-right">Verdict</span>
      </div>

      {loading ? (
        <div className="p-4 space-y-3">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
      ) : list.error ? (
        <p className="px-4 py-10 text-sm text-red-600 text-center">Could not load the leads: {list.error}</p>
      ) : !list.rows.length ? (
        <p className="px-4 py-10 text-sm text-text-tertiary text-center">{extra ? 'No leads match these filters.' : 'No leads here yet.'}</p>
      ) : (
        <ul className="divide-y divide-border">
          {list.rows.map((l) => (
            <Row key={l.id} lead={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} onReview={review} />
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-border">
        <p className="text-[11px] text-text-tertiary tabular-nums">{pageLabel(page, PAGE_SIZE, list.total)}</p>
        {pages > 1 && (
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="ghost" onClick={() => goTo(0)} disabled={page === 0}>First</Button>
            <Button size="xs" variant="secondary" onClick={() => goTo(page - 1)} disabled={page === 0}>Previous</Button>
            <span className="text-[11px] text-text-secondary tabular-nums px-1">Page {page + 1} of {pages}</span>
            <Button size="xs" variant="secondary" onClick={() => goTo(page + 1)} disabled={page >= pages - 1}>Next</Button>
            <Button size="xs" variant="ghost" onClick={() => goTo(pages - 1)} disabled={page >= pages - 1}>Last</Button>
          </div>
        )}
      </div>
    </div>
  )
}
