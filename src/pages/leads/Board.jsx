import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Skeleton, Input, Select, Spinner } from '../../components/ui/index'
import { fetchLeadsPage, leadsApi } from '../../lib/leads/client'
import {
  SHOW_OPTIONS, EMPTY_FILTERS, activeFilterCount, effectiveVerdict, PAGE_SIZE, pageLabel, pageCount, when,
  SENDER_LABEL, PROJECT_LABEL, REQUEST_LABEL, FOLDER_LABEL, PHILIPS_LABEL, CRM_LABEL, channelLabel, brandOf, phonesOf, projectOf,
} from '../../lib/leads/view'
import { VerdictTag, LeadDetail } from './parts'

// ─── The leads list ────────────────────────────────────────────────────────
// What the sales team asked for (2026-10-11): one clean row per lead with
// the criteria as columns (who wrote, what they want, JIH / tender /
// maintenance, verified, company or free email, Junk), filters on each, and
// everything else (the email as it arrived, why the agent decided, Outlook)
// one click away in the opened row. Filtered and paged in the database, so
// every lead is reachable however many there are.
//
// The CRM column (2026-10-12): a sales admin (or the access admin) approves
// a lead into Odoo from here, after a confirmation that shows what will be
// sent. Everyone else sees where each lead stands.

const SENDER_OPTIONS = Object.entries(SENDER_LABEL)
const PROJECT_OPTIONS = [...Object.entries(PROJECT_LABEL), ['none', 'Not stated']]
const REQUEST_OPTIONS = Object.entries(REQUEST_LABEL)
const FOLDER_OPTIONS = Object.entries(FOLDER_LABEL)

// Column widths, shared by the header and every row so they line up.
const GRID = 'md:grid md:grid-cols-[6.5rem_minmax(0,1.6fr)_minmax(0,2.2fr)_7rem_6.5rem_6rem_5.5rem_6.5rem_7rem] md:gap-3 md:items-start'

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

// Clicks inside the CRM cell act on the CRM, not on opening the row.
const stop = (e) => e.stopPropagation()

/** Where the lead stands with Odoo, and the Approve button for those who may. */
function CrmCell({ lead, canApprove, onAsk }) {
  const st = lead.crm_status
  if (st === 'sent') {
    return lead.crm_url
      ? <a href={lead.crm_url} target="_blank" rel="noreferrer" onClick={stop} className="text-xs font-semibold text-sage-700 hover:underline">In Odoo ↗</a>
      : <span className="text-xs font-semibold text-sage-700">{CRM_LABEL.sent}</span>
  }
  if (st === 'queued') return <span className="text-[11px] font-semibold text-amber-800 leading-tight block">{CRM_LABEL.queued}</span>
  if (st === 'sending') return <span className="text-[11px] text-text-secondary">{CRM_LABEL.sending}</span>
  if (st === 'failed') {
    return (
      <span className="block" title={lead.crm_error || ''}>
        <span className="text-[11px] font-semibold text-red-600 block">{CRM_LABEL.failed}</span>
        {canApprove && <Button size="xs" variant="secondary" className="mt-1" onClick={(e) => { stop(e); onAsk(lead) }}>Retry</Button>}
      </span>
    )
  }
  if (canApprove && lead.verdict !== 'duplicate') {
    return <Button size="xs" variant="primary" onClick={(e) => { stop(e); onAsk(lead) }}>Approve</Button>
  }
  return dash
}

/**
 * The project phase, set by anyone on the team (2026-10-12): stated in the
 * email or not, they pick it after the call. Picking what the agent read
 * goes back to following the agent.
 */
function ProjectPicker({ lead, onSet }) {
  const [busy, setBusy] = useState(false)
  const value = projectOf(lead) || 'none'
  async function change(e) {
    const choice = e.target.value
    const agent = lead.project_type || 'none'
    setBusy(true)
    await onSet(lead, choice === agent ? null : choice)
    setBusy(false)
  }
  return (
    <span onClick={stop} className="block -ml-1">
      <select aria-label="Project phase" value={value} disabled={busy} onChange={change}
        className={`max-w-full text-xs bg-transparent border border-transparent hover:border-border focus:border-border focus:outline-none px-1 py-0.5 cursor-pointer disabled:opacity-50 ${value !== 'none' ? 'font-semibold text-text' : 'text-text-tertiary'}`}>
        <option value="none">Not stated</option>
        {Object.entries(PROJECT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {lead.human_project_type && <span className="block px-1 text-[10px] text-text-tertiary">set by team</span>}
    </span>
  )
}

function Row({ lead, open, onToggle, onReview, onSetProject, workspaceId, mailboxes, canApprove, onAsk }) {
  const v = effectiveVerdict(lead)
  const v2 = (lead.criteria_version || 1) >= 2
  const junk = lead.folder === 'junk'
  return (
    <li className={open ? 'bg-surface-subtle' : ''}>
      {/* A div, not a button: the row holds the Approve button, and a button
          cannot hold another. Keyboard: Enter or Space opens it. */}
      <div role="button" tabIndex={0} onClick={onToggle} aria-expanded={open}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle() } }}
        className={`w-full text-left px-4 py-3 hover:bg-surface-subtle transition-colors cursor-pointer grid grid-cols-2 gap-x-3 gap-y-1.5 focus:outline-none focus-visible:ring-1 focus-visible:ring-amber-400 ${GRID}`}>
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
          <ProjectPicker lead={lead} onSet={onSetProject} />
        </Cell>
        <Cell label="Source">
          {v2 && lead.source_check
            ? <span className={`text-xs ${lead.source_check === 'verified' ? 'text-sage-700' : 'text-amber-800'}`}>{lead.source_check === 'verified' ? 'Verified' : 'Not verified'}</span>
            : dash}
        </Cell>
        <Cell label="Verdict" className="md:text-right">
          <VerdictTag verdict={v} corrected={Boolean(lead.human_verdict && lead.human_verdict !== lead.verdict)} />
        </Cell>
        <Cell label="CRM" className="md:text-right">
          <CrmCell lead={lead} canApprove={canApprove} onAsk={onAsk} />
        </Cell>
      </div>
      {open && (
        <div className="border-t border-border bg-white">
          <LeadDetail lead={lead} onReview={onReview} workspaceId={workspaceId} mailboxes={mailboxes} wide />
        </div>
      )}
    </li>
  )
}

/**
 * "Send this lead to Odoo?": exactly what will be sent, and what happens if
 * Odoo is not connected yet. Nothing is sent until the button is pressed.
 */
function ApproveDialog({ lead, busy, error, onCancel, onConfirm }) {
  const phones = phonesOf(lead)
  const rows = [
    ['Company', lead.company], ['Contact', lead.name], ['Email', lead.email], ['Phone', phones.join(', ')],
    ['Wants', lead.summary || lead.subject], ['Who', SENDER_LABEL[lead.sender_type]], ['Project', PROJECT_LABEL[lead.project_type]],
    ['Came in', channelLabel(lead)],
  ].filter(([, v]) => v)
  const notQualified = effectiveVerdict(lead) !== 'qualified'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(28,35,33,0.45)' }} onClick={busy ? undefined : onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="approve-title" onClick={stop}
        className="bg-white shadow-dropdown w-full max-w-md border border-border animate-fade-scale p-6 space-y-4">
        <h3 id="approve-title" className="font-semibold text-text text-sm">
          {lead.crm_status === 'failed' ? 'Try sending this lead to Odoo again?' : 'Approve this lead and send it to Odoo?'}
        </h3>
        <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-1.5 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-tertiary">{k}</dt>
              <dd className="text-text min-w-0 break-words" dir="auto">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-text-secondary leading-relaxed">
          It becomes a lead in Odoo CRM with the email, the criteria and the agent's questions, and can't be sent twice.
          {notQualified ? ' Approving also marks it qualified.' : ''}
          {' '}If Odoo isn't connected yet, it is marked approved and sent as soon as it is.
        </p>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex gap-3 pt-1">
          <Button variant="secondary" className="flex-1 justify-center" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button className="flex-1 justify-center" disabled={busy} onClick={onConfirm}>
            {busy ? <Spinner size="sm" /> : null}{busy ? 'Sending…' : 'Approve and send'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function LeadsBoard({ workspaceId, onReview, refreshKey = 0, mailboxes = [], canApprove = false }) {
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

  const replaceRow = (id, updated) => setList((s) => ({ ...s, rows: s.rows.map((l) => (l.id === id ? { ...l, ...updated } : l)) }))

  // A correction changes the row in place; it leaves the list on the next load.
  async function review(lead, verdict, reason) {
    const updated = await onReview(lead, verdict, reason)
    if (updated) replaceRow(lead.id, updated)
    return updated // the detail opens its "why?" box only once the No is saved
  }

  // An action on a row that failed (the list itself stays as it is).
  const [actionError, setActionError] = useState('')

  // The team's project phase: saved at once, the row shows it.
  async function setProject(lead, project) {
    const r = await leadsApi('set_project', workspaceId, { lead_id: lead.id, project })
    if (r.error) return setActionError(r.error)
    setActionError('')
    replaceRow(lead.id, r.lead)
  }

  // Approve → confirm → Odoo. The row shows the outcome; Odoo's refusal, if
  // any, stays on the row (Retry) rather than in the dialog.
  const [asking, setAsking] = useState(null)
  const [approving, setApproving] = useState({ busy: false, error: '' })
  async function approve() {
    setApproving({ busy: true, error: '' })
    const r = await leadsApi('approve', workspaceId, { lead_id: asking.id })
    if (r.error) return setApproving({ busy: false, error: r.error })
    replaceRow(asking.id, r.lead)
    setApproving({ busy: false, error: '' })
    setAsking(null)
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
      {actionError && <p className="px-4 py-2 text-xs text-red-600 border-b border-border">{actionError}</p>}
      <div className="px-4 py-2 flex items-center justify-between gap-3 border-b border-border">
        <p className="text-[11px] text-text-secondary tabular-nums">
          {loading ? 'Loading…' : `${list.total} ${list.total === 1 ? 'lead' : 'leads'}`}
          {extra > 0 && !loading ? ` · ${extra} filter${extra === 1 ? '' : 's'} on` : ''}
        </p>
        {extra > 0 && <Button size="xs" variant="ghost" onClick={clear}>Clear filters</Button>}
      </div>

      {/* ── Header (desktop) ── */}
      <div className={`hidden ${GRID} px-4 py-2 border-b border-border text-[10px] font-semibold text-text-tertiary uppercase tracking-wide`}>
        <span>Received</span><span>From</span><span>Wants</span><span>Who</span><span>Request</span><span>Project</span><span>Source</span><span className="text-right">Verdict</span><span className="text-right">CRM</span>
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
            <Row key={l.id} lead={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)} onReview={review}
              onSetProject={setProject} workspaceId={workspaceId} mailboxes={mailboxes} canApprove={canApprove} onAsk={(lead) => { setApproving({ busy: false, error: '' }); setAsking(lead) }} />
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
      {asking && <ApproveDialog lead={asking} busy={approving.busy} error={approving.error} onCancel={() => setAsking(null)} onConfirm={approve} />}
    </div>
  )
}
