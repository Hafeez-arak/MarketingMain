import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { PAGE_SIZE, SOON_DAYS, STATES, canCreateKind, docState, figures, filterDocuments, riyadhToday, sortDocuments, typeName } from '../../lib/documents/logic'
import { fetchDocuments, fetchPendingIds, fetchAlerts, fetchTaskStates, runAlerts } from '../../lib/documents/client'
import { DW } from './words'
import { useDocumentsBase, field, fieldInline, docHref, linkName } from './useDocumentsBase'
import { StateBadge, ConfidentialChip, DaysLeft, DateText, Pager, NoAccess } from './parts'

// ─── Documents → the list (v2) ─────────────────────────────────────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. His documents index: five figures
// (expired, ending within 30 and 90 days, the required documents the company
// holds, the ones waiting for confirmation), the filters, and the table with
// each document's state, days left and renewal task. Opening it runs the
// company's alerts once (the database makes each one once only).

export function DocumentsList() {
  const { sectionLevel } = useAuth()
  const level = sectionLevel('documents')
  const { t: w, lang, dir } = useT(DW)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const base = useDocumentsBase()
  const { ws, typesById, peopleById } = base
  const [docs, setDocs] = useState(null)
  const [pendingIds, setPendingIds] = useState(new Set())
  const [taskByDoc, setTaskByDoc] = useState({})
  const [error, setError] = useState('')
  const today = riyadhToday()

  const load = useCallback(async () => {
    if (!ws) return
    await runAlerts(ws)
    const [d, p, a] = await Promise.all([fetchDocuments(ws), fetchPendingIds(ws), fetchAlerts(ws)])
    const tasks = a.rows.filter(x => x.kind === 'task' && x.task_id)
    const states = await fetchTaskStates(ws, tasks.map(x => x.task_id))
    const byDoc = {}
    for (const t of tasks) byDoc[t.document_id] = { id: t.task_id, expiry_date: t.expiry_date, status: states.states[t.task_id] || null }
    setDocs(d.rows); setPendingIds(p.ids); setTaskByDoc(byDoc)
    setError(d.error || p.error || a.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  const f = {
    q: params.get('q') || '', type_id: params.get('type') || '', link_kind: params.get('link') || '',
    state: STATES.includes(params.get('state')) ? params.get('state') : '', responsible_id: params.get('who') || '', within: params.get('within') || '',
  }
  const page = Math.max(0, Number(params.get('p')) || 0)
  const setParam = (k, v) => setParams(p => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v); else n.delete(k)
    if (k !== 'p') n.delete('p')
    return n
  }, { replace: true })
  const anyFilter = Object.values(f).some(Boolean)

  const names = useMemo(() => Object.fromEntries((docs || []).map(d => [d.id, linkName(d, base, lang, w)])), [docs, base, lang, w])
  const ctx = useMemo(() => ({ typesById, pendingIds, today, linkNames: names }), [typesById, pendingIds, today, names])
  // A renewal task counts as open while it is not done or dropped (and only when it is for the current expiry).
  const openTasks = useMemo(() => new Set((docs || []).filter(d => {
    const t = taskByDoc[d.id]
    return t && t.expiry_date === d.expiry_date && t.status && !['done', 'cancelled'].includes(t.status)
  }).map(d => d.id)), [docs, taskByDoc])

  if (!level) return <NoAccess />
  const types = base.base?.types || []
  const shown = docs ? sortDocuments(filterDocuments(docs, f, ctx)) : []
  const rows = shown.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const fig = docs ? figures(docs, types, { ...ctx, openTasks }) : null
  const canUpload = ['company', 'supplier', 'employee'].some(k => canCreateKind(k, level))

  const tile = (key, title, value, note, tone, to) => (
    <Link key={key} to={to || '#'} onClick={e => { if (!to) e.preventDefault() }}
      className={`block bg-white border rounded-lg px-4 py-3 hover:border-stone-400 ${tone === 'bad' ? 'border-red-200' : tone === 'warn' ? 'border-yellow-300' : 'border-border'}`}>
      <p className="text-[11px] text-text-tertiary">{title}</p>
      <p className={`text-2xl font-semibold tabular-nums mt-0.5 ${tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-yellow-700' : 'text-text'}`}>{value}</p>
      {note && <p className="text-[11px] text-text-tertiary mt-0.5 truncate" dir="auto">{note}</p>}
    </Link>
  )

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.title} subtitle={w.subtitle}>
        {level !== 'view' && <Button size="sm" variant="secondary" onClick={() => navigate('/documents/types')}>{w.typesLink}</Button>}
        {canUpload && <Button size="sm" onClick={() => navigate('/documents/new')}>{w.upload}</Button>}
      </PageHeader>

      {fig && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {tile('expired', w.figures.expired, fig.expired.count, fig.expired.names.join(' · '), fig.expired.count ? 'bad' : '', '?state=expired')}
          {tile('soon', w.figures.soonN(SOON_DAYS[0]), fig.soon.count, fig.soon.tasks ? w.figures.tasks(fig.soon.tasks) : '', fig.soon.count ? 'warn' : '', `?within=${SOON_DAYS[0]}`)}
          {tile('later', w.figures.laterN(SOON_DAYS[1]), fig.later.count, '', '', `?within=${SOON_DAYS[1]}`)}
          {tile('required', w.figures.required, fig.required.total ? `${fig.required.held} / ${fig.required.total}` : '—',
            !fig.required.total ? w.figures.noneRequired : fig.required.missing.length ? w.figures.missing(fig.required.missing.map(id => typeName(typesById[id], lang)).join('، ')) : w.figures.complete,
            fig.required.missing.length ? 'bad' : '', level !== 'view' ? '/documents/types' : null)}
          {tile('awaiting', w.figures.awaiting, fig.awaiting.count, w.figures.awaitingNote, fig.awaiting.count ? 'warn' : '', '?state=awaiting')}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <input type="search" value={f.q} onChange={e => setParam('q', e.target.value)} placeholder={w.search} aria-label={w.search} className={`${field} flex-1 min-w-[14rem]`} dir="auto" />
        <select value={f.type_id} onChange={e => setParam('type', e.target.value)} className={fieldInline} aria-label={w.cols.type}>
          <option value="">{w.allTypes}</option>
          {types.map(t => <option key={t.id} value={t.id}>{typeName(t, lang)}</option>)}
        </select>
        <select value={f.link_kind} onChange={e => setParam('link', e.target.value)} className={fieldInline} aria-label={w.cols.linked}>
          <option value="">{w.allLinks}</option>
          {['company', 'employee', 'supplier', 'asset'].map(k => <option key={k} value={k}>{w.links[k]}</option>)}
        </select>
        <select value={f.state} onChange={e => setParam('state', e.target.value)} className={fieldInline} aria-label={w.cols.state}>
          <option value="">{w.allStates}</option>
          {STATES.map(s => <option key={s} value={s}>{w.states[s]}</option>)}
        </select>
        <select value={f.responsible_id} onChange={e => setParam('who', e.target.value)} className={fieldInline} aria-label={w.cols.responsible}>
          <option value="">{w.allPeople}</option>
          {(base.base?.people || []).map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select>
        {anyFilter && <Button size="sm" variant="ghost" onClick={() => setParams({}, { replace: true })}>{w.clear}</Button>}
      </div>
      {f.within && <p className="text-xs text-text-tertiary">{w.withinNote(Number(f.within))}</p>}
      {(error || base.error) && <p className="text-xs text-red-600" dir="auto" role="alert">{error || base.error || w.loadFailed}</p>}

      {docs === null ? <Skeleton className="h-64" /> : !shown.length ? (
        <div className="text-sm text-text-tertiary px-1 py-6">
          <p className="font-medium text-text-secondary">{anyFilter ? w.emptyFilter : w.emptyAll}</p>
          <p className="text-xs mt-1">{anyFilter ? w.emptyFilterBody : w.emptyAllBody}</p>
        </div>
      ) : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              {['document', 'type', 'number', 'linked', 'expires', 'left', 'responsible', 'state'].map(c => <th key={c} className="text-start font-medium px-3 py-2">{w.cols[c]}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-border">
              {rows.map(d => {
                const state = docState(d, typesById[d.type_id], today)
                const task = taskByDoc[d.id]
                return (
                  <tr key={d.id} className="align-top hover:bg-stone-50 cursor-pointer" onClick={() => navigate(docHref(d.id))}>
                    <td className="px-3 py-2">
                      <Link to={docHref(d.id)} className="hover:underline" onClick={e => e.stopPropagation()}>
                        <bdi dir="ltr" className="text-text-tertiary text-xs tabular-nums">{d.document_no}</bdi>
                      </Link>{' '}<bdi>{d.title}</bdi>{d.confidential && <> <ConfidentialChip /></>}
                    </td>
                    <td className="px-3 py-2"><bdi>{typeName(typesById[d.type_id], lang)}</bdi></td>
                    <td className="px-3 py-2"><bdi dir="ltr">{d.number || '—'}</bdi></td>
                    <td className="px-3 py-2"><bdi>{w.links[d.link_kind]}{names[d.id] && d.link_kind !== 'company' ? `: ${names[d.id]}` : ''}</bdi></td>
                    <td className="px-3 py-2 whitespace-nowrap"><DateText date={d.expiry_date} /></td>
                    <td className="px-3 py-2 whitespace-nowrap"><DaysLeft doc={d} today={today} state={state} /></td>
                    <td className="px-3 py-2"><bdi>{peopleById[d.responsible_id]?.name || '—'}</bdi></td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <StateBadge state={state} />
                      {pendingIds.has(d.id) && state !== 'draft' && <div className="text-[11px] text-text-tertiary mt-0.5">{w.states.awaiting}</div>}
                      {task && task.expiry_date === d.expiry_date && task.status && <div className="text-[11px] text-text-tertiary mt-0.5">{w.task}: {w.taskStates[task.status] || task.status}</div>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pager page={page} size={PAGE_SIZE} count={shown.length} onPage={p => setParam('p', String(p))} />
        </div>
      )}
      <p className="text-[11px] text-text-tertiary">{w.hint}</p>
    </div>
  )
}
