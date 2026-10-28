import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { ACTIVITY_FILTERS, ACTIVITY_GROUPS, ACTIVITY_PAGE, GROUP_MAX, filterActivities, groupRows, pageOf, riyadhToday } from '../../lib/crm/logic'
import { fetchActivities, fetchLeads, markActivityDone } from '../../lib/crm/client'
import { RW } from './words'
import { useCrmBase, field, fieldInline, leadHref } from './useCrmBase'
import { StatusBadge, DueDate, FilterChips, Pager, NoAccess } from './parts'

// ─── CRM → Planned activities (v2) ─────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Musa's "My activities": what is planned
// and not done yet, yours unless "Everyone's" is on; late, today, coming up;
// grouped by type or owner; searched by the activity or its opportunity;
// 50 a page; marked done here with an outcome.

export function CrmActivities() {
  const { canSection, user } = useAuth()
  const { t: w, lang, dir } = useT(RW)
  const [params, setParams] = useSearchParams()
  const { ws, peopleById } = useCrmBase()
  const [acts, setActs] = useState(null)
  const [leadsById, setLeadsById] = useState({})
  const [outcomes, setOutcomes] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const today = riyadhToday()

  const load = useCallback(async () => {
    if (!ws) return
    const [a, l] = await Promise.all([fetchActivities(ws, { open: true }), fetchLeads(ws)])
    setActs(a.rows)
    setLeadsById(Object.fromEntries(l.rows.map(r => [r.id, r])))
    setError(a.error || l.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  const active = (params.get('f') || '').split(',').filter(k => ACTIVITY_FILTERS.some(f => f.key === k))
  const group = ACTIVITY_GROUPS.includes(params.get('g')) ? params.get('g') : ''
  const q = params.get('q') || ''
  const page = Math.max(0, Number(params.get('p')) || 0)
  const setParam = (k, v) => setParams(p => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v); else n.delete(k)
    if (k !== 'p') n.delete('p')
    return n
  }, { replace: true })
  const toggle = key => setParam('f', (active.includes(key) ? active.filter(k => k !== key) : [...active, key]).join(','))
  const activeKey = active.join(',')
  const me = user?.id
  const shown = useMemo(() => filterActivities(acts || [], { active: activeKey.split(','), me, today, q, leadsById }), [acts, activeKey, me, today, q, leadsById])

  if (!canSection('crm', 'view')) return <NoAccess />
  const canWork = canSection('crm', 'work')
  const rows = group ? shown.slice(0, GROUP_MAX) : pageOf(shown, page, ACTIVITY_PAGE)
  const groups = group ? groupRows(rows, a => (group === 'type' ? a.activity_type : a.assigned_to)) : [{ key: '', rows }]
  const groupTitle = key => (group === 'type' ? w.types[key] : peopleById[key]?.name || '—')

  async function done(a) {
    setBusy(a.id); setError('')
    const out = await markActivityDone(ws, a.id, outcomes[a.id])
    setBusy('')
    if (out.error) setError(out.error); else await load()
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.actTitle} subtitle={w.actSubtitle} />
      <div className="flex flex-wrap gap-2">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={w.actSearch} aria-label={w.actSearch}
          className={`${field} flex-1 min-w-[14rem]`} dir="auto" />
        <select value={group} onChange={e => setParam('g', e.target.value)} className={fieldInline} aria-label={w.groupBy}>
          <option value="">{w.noGroup}</option>
          {ACTIVITY_GROUPS.map(g => <option key={g} value={g}>{`${w.groupBy}: ${w.actGroups[g]}`}</option>)}
        </select>
      </div>
      <FilterChips filters={ACTIVITY_FILTERS} active={active} onToggle={toggle} groupLabel={g => w.actFilterGroups[g]} label={k => w.actFilters[k]} />
      {error && <p className="text-xs text-red-600" dir="auto" role="alert">{error}</p>}

      {acts === null ? <Skeleton className="h-64" /> : !shown.length ? (
        <div className="text-sm text-text-tertiary px-1 py-6">
          <p>{q || active.length || group ? w.actEmptyFilter : w.actEmpty}</p>
          <p className="text-xs mt-1">{w.actEmptyHint}</p>
        </div>
      ) : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              {['due', 'type', 'summary', 'lead', 'assignee'].map(c => <th key={c} className="text-start font-medium px-3 py-2">{w.actCols[c]}</th>)}
              <th />
            </tr></thead>
            {groups.map(g => (
              <tbody key={g.key || '-'} className="divide-y divide-border">
                {group && (
                  <tr className="bg-stone-50"><td colSpan={6} className="px-3 py-1.5 text-xs font-semibold text-text-secondary">
                    <bdi>{groupTitle(g.key)}</bdi> <span className="font-normal text-text-tertiary">({g.rows.length})</span>
                  </td></tr>
                )}
                {g.rows.map(a => {
                  const lead = leadsById[a.lead_id]
                  return (
                    <tr key={a.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap"><DueDate date={a.due_date} today={today} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{w.types[a.activity_type]}</td>
                      <td className="px-3 py-2"><bdi>{a.summary}</bdi></td>
                      <td className="px-3 py-2">
                        {lead && <Link to={leadHref(lead.id)} className="hover:underline"><bdi dir="ltr" className="text-text-tertiary text-xs">{lead.lead_no}</bdi> · <bdi>{lead.title}</bdi></Link>}
                        {lead && lead.status !== 'open' && <> <StatusBadge status={lead.status} /></>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap"><bdi>{peopleById[a.assigned_to]?.name || '—'}</bdi></td>
                      <td className="px-3 py-2">
                        {canWork && (
                          <span className="flex gap-1.5">
                            <input value={outcomes[a.id] || ''} onChange={e => setOutcomes(x => ({ ...x, [a.id]: e.target.value }))} placeholder={w.outcomePh}
                              aria-label={w.outcomePh} maxLength={2000} className={`${fieldInline} min-w-[7rem] py-1 text-xs`} dir="auto" />
                            <Button size="xs" disabled={busy === a.id} onClick={() => done(a)}>{w.doneBtn}</Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ))}
          </table>
          {!group && <Pager page={page} size={ACTIVITY_PAGE} count={shown.length} onPage={p => setParam('p', String(p))} />}
        </div>
      )}
    </div>
  )
}
