import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import {
  LEAD_FILTERS, LEAD_GROUPS, LIST_PAGE, GROUP_MAX, applyFilters, searchLeads, sortLeads, boardLeads, boardColumns,
  activityBar, pipelineFigures, nextActivities, groupRows, leadGroupKey, pageOf, partyOf, listName, fmtMoney, riyadhToday, dueState,
} from '../../lib/crm/logic'
import { fetchLeads, fetchLeadTags, fetchActivities, patchLead } from '../../lib/crm/client'
import { RW } from './words'
import { useCrmBase, field, fieldInline, leadHref } from './useCrmBase'
import { Stars, TagChips, StatusBadge, BidChip, DueDate, FilterChips, Pager, Figures, NoAccess } from './parts'

// ─── CRM → Opportunities: the pipeline and the list (v2) ───────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Musa's CRM index, both views: the
// pipeline (a column per stage with its count, the known values' sum and an
// activity bar, cards you drag to another stage or onto "Won", and his four
// figures on top) and the list (his columns, grouping, 30 a page). His
// filters, search and "group by" are in the URL, so a view can be linked
// to. Three menu entries open this page: Pipeline, My opportunities (the
// "Mine" filter on) and All opportunities (the list).

const SEG = { late: 'bg-red-500', today: 'bg-amber-400', planned: 'bg-emerald-500', none: 'bg-stone-300' }

export function CrmLeads({ defaultView = 'kanban', defaultFilters = [] }) {
  const { canSection, user } = useAuth()
  const { t: w, lang, dir } = useT(RW)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { ws, base, stagesById, sourcesById, tagsById, peopleById, clientsById, error: baseError } = useCrmBase()
  const [leads, setLeads] = useState(null)
  const [leadTags, setLeadTags] = useState([])
  const [openActs, setOpenActs] = useState([])
  const [error, setError] = useState('')
  const [dragId, setDragId] = useState('')
  const [over, setOver] = useState('')
  const today = riyadhToday()
  const canWork = canSection('crm', 'work')

  const load = useCallback(async () => {
    if (!ws) return
    const [l, t, a] = await Promise.all([fetchLeads(ws), fetchLeadTags(ws), fetchActivities(ws, { open: true })])
    setLeads(l.rows)
    setLeadTags(t.rows)
    setOpenActs(a.rows)
    setError(l.error || t.error || a.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  const view = ['kanban', 'list'].includes(params.get('v')) ? params.get('v') : defaultView
  const active = (params.has('f') ? (params.get('f') || '').split(',') : defaultFilters).filter(k => LEAD_FILTERS.some(f => f.key === k))
  const group = LEAD_GROUPS.includes(params.get('g')) ? params.get('g') : ''
  const q = params.get('q') || ''
  const page = Math.max(0, Number(params.get('p')) || 0)
  const setParam = (k, v) => setParams(p => {
    const n = new URLSearchParams(p)
    if (v === null || v === undefined || (v === '' && k !== 'f')) n.delete(k); else n.set(k, v)
    if (k !== 'p') n.delete('p')
    return n
  }, { replace: true })
  const toggle = key => setParam('f', active.includes(key) ? active.filter(k => k !== key).join(',') : [...active, key].join(','))

  const tagsOf = useMemo(() => {
    const m = {}
    for (const r of leadTags) if (tagsById[r.tag_id]) (m[r.lead_id] ||= []).push(tagsById[r.tag_id])
    for (const k of Object.keys(m)) m[k].sort((a, b) => listName(a, lang).localeCompare(listName(b, lang)))
    return id => m[id] || []
  }, [leadTags, tagsById, lang])
  const next = useMemo(() => nextActivities(openActs), [openActs])
  const actsByLead = useMemo(() => {
    const m = {}
    for (const a of openActs) (m[a.lead_id] ||= []).push(a)
    return m
  }, [openActs])
  const shown = sortLeads(applyFilters(searchLeads(leads || [], q, { clientsById, tagsOf }), active,
    { me: user?.id, today, next, openActs: actsByLead }))

  if (!canSection('crm', 'view')) return <NoAccess />

  const stages = base?.stages || []
  const party = l => partyOf(l, clientsById, lang)
  const owner = l => peopleById[l.assigned_to]?.name || ''

  async function drop(e, change) {
    e.preventDefault()
    const id = dragId
    setOver(''); setDragId('')
    if (!id) return
    const out = await patchLead(ws, id, change)
    if (out.error) setError(out.error)
    else { setError(''); await load() }
  }

  const header = (
    <PageHeader title={w.title} subtitle={w.subtitle}>
      {canSection('contacts', 'view') && <Link to="/contacts?quick=clients" className="text-xs text-text-secondary hover:text-text underline self-center">{w.clientsLink}</Link>}
      {canWork && stages.some(s => s.is_active) && <Button size="sm" onClick={() => navigate('/crm/new')}>{w.newLead}</Button>}
    </PageHeader>
  )

  if (base && !stages.length) {
    return (
      <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
        {header}
        <div className="bg-white border border-border p-5 text-sm">
          <p className="font-semibold text-text">{w.noStagesTitle}</p>
          <p className="text-text-secondary mt-1">{w.noStagesBody}</p>
          {canSection('crm', 'manage') && <Link to="/crm/settings" className="inline-block mt-3 text-xs underline">{w.settingsLink}</Link>}
        </div>
      </div>
    )
  }

  // ── The pipeline ──
  const onBoard = boardLeads(shown, active)
  const columns = boardColumns(stages, onBoard)
  const fig = pipelineFigures(onBoard, openActs, today)
  const figures = fig && [
    [w.figures.open, String(fig.open), fig.noValue ? w.figures.noValue(fig.noValue) : null],
    [w.figures.expected, fig.expected == null ? '—' : fmtMoney(fig.expected), w.figures.beforeVat],
    [w.figures.weighted, fig.weighted == null ? '—' : fmtMoney(fig.weighted), fig.noWeight ? w.figures.noWeight(fig.noWeight) : w.figures.allWeighted],
    [w.figures.late, String(fig.late), fig.late ? w.figures.lateHint : null, fig.late ? 'bad' : null],
  ]
  const showWon = canWork && !active.some(k => k === 'won' || k === 'lost')

  // ── The list ──
  const groupTitle = key => (group === 'stage' ? listName(stagesById[key], lang)
    : group === 'status' ? w.statuses[key]
      : group === 'source' ? (key ? listName(sourcesById[key], lang) : w.noSource)
        : group === 'assignee' ? (key ? peopleById[key]?.name || '—' : w.noOwner)
          : group === 'priority' ? (Number(key) ? '★'.repeat(Number(key)) : w.normal) : '')
  const listRows = group ? shown.slice(0, GROUP_MAX) : pageOf(shown, page, LIST_PAGE)
  const groups = group ? groupRows(listRows, l => leadGroupKey(l, group)) : [{ key: '', rows: listRows }]

  return (
    <div className="max-w-7xl space-y-4" dir={dir} lang={lang}>
      {header}

      <div className="flex flex-wrap gap-2">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={w.search} aria-label={w.search}
          className={`${field} flex-1 min-w-[14rem]`} dir="auto" />
        {view === 'list' && (
          <select value={group} onChange={e => setParam('g', e.target.value)} className={fieldInline} aria-label={w.groupBy}>
            <option value="">{w.noGroup}</option>
            {LEAD_GROUPS.map(g => <option key={g} value={g}>{`${w.groupBy}: ${w.groups[g]}`}</option>)}
          </select>
        )}
        <div className="inline-flex border border-border rounded-md overflow-hidden" role="group" aria-label={w.views.kanban}>
          {['kanban', 'list'].map(v => (
            <button key={v} type="button" onClick={() => setParam('v', v === defaultView ? '' : v)} aria-pressed={view === v}
              className={`text-xs px-2.5 py-1.5 ${view === v ? 'bg-stone-900 text-white' : 'bg-white text-text hover:bg-stone-50'}`}>{w.views[v]}</button>
          ))}
        </div>
      </div>

      <FilterChips filters={LEAD_FILTERS} active={active} onToggle={toggle} groupLabel={g => w.filterGroups[g]} label={k => w.filters[k]} />

      {(error || baseError) && <p className="text-xs text-red-600" dir="auto" role="alert">{error || baseError}</p>}

      {leads === null || !base ? <Skeleton className="h-64" /> : view === 'kanban' ? (
        <>
          <Figures items={figures} />
          <div className="flex gap-3 overflow-x-auto pb-2 items-start">
            {columns.map(col => {
              const bar = activityBar(col.leads, next, today)
              const barTotal = Object.values(bar).reduce((a, b) => a + b, 0)
              const droppable = canWork && col.stage.is_active
              return (
                <section key={col.stage.id} aria-label={listName(col.stage, lang)}
                  className={`w-64 flex-shrink-0 bg-stone-50 border rounded-lg p-2 space-y-2 ${over === col.stage.id ? 'border-stone-900' : 'border-border'}`}
                  onDragOver={e => { if (dragId && droppable) { e.preventDefault(); setOver(col.stage.id) } }}
                  onDragLeave={() => setOver('')}
                  onDrop={e => droppable && drop(e, { stage_id: col.stage.id })}>
                  <header className="px-1 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-text truncate">
                        <bdi>{listName(col.stage, lang)}</bdi> <span className="font-normal text-text-tertiary">{col.leads.length}</span>
                      </h3>
                      {canWork && col.stage.is_active && (
                        <Link to={`/crm/new?stage=${col.stage.id}`} title={w.newInStage} aria-label={w.newInStage}
                          className="text-sm leading-none px-1.5 rounded hover:bg-stone-200 text-text-secondary">+</Link>
                      )}
                    </div>
                    <p className="text-[11px] text-text-tertiary tabular-nums" title={w.knownSum}>
                      <bdi dir="ltr">{col.total == null ? '—' : fmtMoney(col.total)}</bdi>
                      {col.unknown > 0 && col.total != null && <span title={w.unknownCount}> +{col.unknown}?</span>}
                    </p>
                    {barTotal > 0 && (
                      <div className="flex h-1.5 rounded overflow-hidden gap-px" role="img"
                        aria-label={Object.entries(bar).filter(([, n]) => n).map(([k, n]) => `${w.bar[k]}: ${n}`).join(lang === 'ar' ? '، ' : ', ')}>
                        {Object.entries(bar).map(([k, n]) => n > 0 && <span key={k} className={SEG[k]} style={{ flex: n }} title={`${w.bar[k]}: ${n}`} />)}
                      </div>
                    )}
                  </header>
                  {!col.leads.length ? <p className="text-[11px] text-text-tertiary px-1 py-3">{w.noLeads}</p> : col.leads.map(l => {
                    const nextDate = next[l.id]
                    const state = dueState(nextDate, today)
                    return (
                      <Link key={l.id} to={leadHref(l.id)} draggable={canWork && l.status === 'open'}
                        onDragStart={e => { setDragId(l.id); e.dataTransfer.effectAllowed = 'move' }}
                        onDragEnd={() => { setDragId(''); setOver('') }}
                        className={`block bg-white border border-border rounded-md p-2.5 space-y-1.5 hover:border-stone-400 ${dragId === l.id ? 'opacity-50' : ''}`}>
                        <p className="text-sm font-medium text-text leading-snug"><bdi>{l.title}</bdi> <Stars n={l.priority} /></p>
                        <TagChips tags={tagsOf(l.id)} />
                        <p className="flex justify-between gap-2 text-[11px] text-text-secondary">
                          <bdi className="truncate">{party(l)}</bdi><bdi dir="ltr" className="tabular-nums whitespace-nowrap">{fmtMoney(l.expected_revenue)}</bdi>
                        </p>
                        <p className="flex justify-between gap-2 text-[11px] text-text-secondary">
                          <bdi className="truncate">{owner(l) || w.noOwner}</bdi>
                          {l.status !== 'open' ? <StatusBadge status={l.status} />
                            : nextDate ? <span className={state === 'late' ? 'text-red-700' : state === 'today' ? 'text-amber-700' : ''}>⏱ <bdi dir="ltr">{nextDate}</bdi></span>
                              : <span className="text-amber-700" title={w.bar.none}>⚠ {w.noActivity}</span>}
                        </p>
                        <BidChip lead={l} today={today} />
                      </Link>
                    )
                  })}
                </section>
              )
            })}
            {showWon && (
              <section aria-label={w.wonColumn}
                className={`w-56 flex-shrink-0 border-2 border-dashed rounded-lg p-3 ${over === 'won' ? 'border-emerald-600 bg-emerald-50' : 'border-emerald-300 bg-emerald-50/40'}`}
                onDragOver={e => { if (dragId) { e.preventDefault(); setOver('won') } }}
                onDragLeave={() => setOver('')}
                onDrop={e => drop(e, { status: 'won' })}>
                <h3 className="text-xs font-semibold text-emerald-800">✓ {w.wonColumn}</h3>
                <p className="text-[11px] text-emerald-900/70 mt-2">{w.wonDrop}</p>
              </section>
            )}
          </div>
          {canWork && <p className="text-[11px] text-text-tertiary">{w.boardHint}</p>}
        </>
      ) : !shown.length ? (
        <p className="text-sm text-text-tertiary px-1 py-6">{q || active.length || group ? w.emptyFilter : w.emptyAll}</p>
      ) : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              {['no', 'lead', 'party', 'stage', 'owner', 'value', 'probability', 'bid', 'next', 'status'].map(c => (
                <th key={c} className={`font-medium px-3 py-2 ${['value', 'probability'].includes(c) ? 'text-end' : 'text-start'}`}>{w.cols[c]}</th>
              ))}
            </tr></thead>
            {groups.map(g => (
              <tbody key={g.key || '-'} className="divide-y divide-border">
                {group && (
                  <tr className="bg-stone-50"><td colSpan={10} className="px-3 py-1.5 text-xs font-semibold text-text-secondary">
                    <bdi>{groupTitle(g.key)}</bdi> <span className="font-normal text-text-tertiary">({g.rows.length})</span>
                  </td></tr>
                )}
                {g.rows.map(l => (
                  <tr key={l.id} role="link" tabIndex={0} onClick={() => navigate(leadHref(l.id))} onKeyDown={e => { if (e.key === 'Enter') navigate(leadHref(l.id)) }}
                    className="hover:bg-stone-50 cursor-pointer focus:outline-none focus-visible:bg-stone-50 align-top">
                    <td className="px-3 py-2 text-[11px] text-text-tertiary tabular-nums whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{l.lead_no}</td>
                    <td className="px-3 py-2 min-w-[12rem] text-text"><bdi>{l.title}</bdi> <Stars n={l.priority} /></td>
                    <td className="px-3 py-2 text-text-secondary"><bdi>{party(l) || '—'}</bdi></td>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap"><bdi>{listName(stagesById[l.stage_id], lang)}</bdi></td>
                    <td className="px-3 py-2 text-text-secondary whitespace-nowrap"><bdi>{owner(l) || '—'}</bdi></td>
                    <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap" dir="ltr">{fmtMoney(l.expected_revenue)}</td>
                    <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{l.probability == null ? '—' : `${l.probability}%`}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {l.status === 'open' && l.bid_due_date ? <BidChip lead={l} today={today} label={false} />
                        : <bdi dir="ltr" className="text-text-secondary">{l.bid_due_date || '—'}</bdi>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.status === 'open' ? (next[l.id] ? <DueDate date={next[l.id]} today={today} /> : '—') : ''}</td>
                    <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
          {!group && <Pager page={page} size={LIST_PAGE} count={shown.length} onPage={p => setParam('p', String(p))} />}
        </div>
      )}
    </div>
  )
}

// The three menu entries.
export const CrmPipeline = () => <CrmLeads />
export const CrmMine = () => <CrmLeads defaultFilters={['mine']} />
export const CrmAll = () => <CrmLeads defaultView="list" />

