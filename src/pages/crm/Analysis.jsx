import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import {
  REPORT_DIMS, REPORT_MEASURES, REPORT_FILTERS, ADDITIVE, reportFacts, reportScope, pivot, quickRanges, fmtMeasure, pivotCsv, riyadhToday,
} from '../../lib/crm/logic'
import { fetchLeads } from '../../lib/crm/client'
import { RW } from './words'
import { useCrmBase, fieldInline } from './useCrmBase'
import { FilterChips, Figures, NoAccess } from './parts'

// ─── CRM → Analysis (v2) ───────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Musa's "opportunity analysis" pivot:
// rows and (optionally) columns by stage, status, source, owner, loss
// reason or month; one value at a time (count, expected and weighted value,
// how many have no value, won, win rate); open / closed; a date range on
// when the opportunity was added, with his quick ranges; a pivot or a bar
// graph; three figures on top; print to PDF and CSV. Unknown values are
// never counted as zero, and a win rate is computed on each set, not summed.

const SERIES = ['#2563eb', '#16a34a', '#ca8a04', '#dc2626', '#9333ea', '#0d9488', '#ea580c']
const DATE = /^\d{4}-\d{2}-\d{2}$/

export function CrmAnalysis() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(RW)
  const [params, setParams] = useSearchParams()
  const { ws, base, stagesById, sourcesById, reasonsById, peopleById } = useCrmBase()
  const [leads, setLeads] = useState(null)
  const [error, setError] = useState('')
  const today = riyadhToday()

  const load = useCallback(async () => {
    if (!ws) return
    const l = await fetchLeads(ws)
    setLeads(l.rows)
    setError(l.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  const row = REPORT_DIMS.includes(params.get('rows')) ? params.get('rows') : REPORT_DIMS[0]
  const col = REPORT_DIMS.includes(params.get('cols')) && params.get('cols') !== row ? params.get('cols') : ''
  const m = REPORT_MEASURES.includes(params.get('m')) ? params.get('m') : REPORT_MEASURES[0]
  const view = params.get('v') === 'graph' ? 'graph' : 'pivot'
  const active = (params.get('f') || '').split(',').filter(k => REPORT_FILTERS.some(f => f.key === k))
  let from = DATE.test(params.get('from') || '') ? params.get('from') : ''
  let to = DATE.test(params.get('to') || '') ? params.get('to') : ''
  const swapped = Boolean(from && to && from > to)
  if (swapped) [from, to] = [to, from]
  const set = changes => setParams(p => {
    const n = new URLSearchParams(p)
    for (const [k, v] of Object.entries(changes)) { if (v) n.set(k, v); else n.delete(k) }
    return n
  }, { replace: true })

  const facts = useMemo(() => reportFacts(leads || [], { stagesById, sourcesById, reasonsById, peopleById, lang }),
    [leads, stagesById, sourcesById, reasonsById, peopleById, lang])
  const activeKey = active.join(',')
  const p = useMemo(() => pivot(reportScope(facts, { active: activeKey.split(','), from, to }), { row, col, m }), [facts, activeKey, from, to, row, col, m])

  if (!canSection('crm', 'view')) return <NoAccess />

  const label = (dim, k) => (k == null || k === '' ? '—' : dim === 'status' ? w.statuses[k] || k : k)
  const fmt = v => fmtMeasure(v, m)
  const rangeText = from || to ? w.range(from, to) : w.allPeriods
  const canShare = ADDITIVE.has(m) && p.grand != null && p.grand > 0
  const top = [...p.rows].sort((a, b) => (p.rowTotals[b] ?? 0) - (p.rowTotals[a] ?? 0))[0]
  const figures = p.rows.length ? [
    [w.measures[m], fmt(p.grand), rangeText],
    [w.countOf(w.dims[row]), String(p.rows.length)],
    [w.top, top ? label(row, top) : '—', top != null && p.rowTotals[top] != null ? `${fmt(p.rowTotals[top])}${canShare ? ` · ${((p.rowTotals[top] / p.grand) * 100).toFixed(1)}%` : ''}` : null],
  ] : []
  const quick = quickRanges(today)

  function downloadCsv() {
    const csv = pivotCsv(p, {
      title: `${w.anTitle} — ${w.measures[m]}`, range: `${w.dateLabel}: ${rangeText}`,
      rowLabel: col ? `${w.dims[row]} / ${w.dims[col]}` : w.dims[row], label: k => label(row, k), colLabel: k => label(col, k), totalLabel: w.total, m,
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([`\uFEFF${csv}\n`], { type: 'text/csv;charset=utf-8' }))
    a.download = `crm-${today}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // The graph: each row's total, split by the columns (up to seven, the rest as "other") when the value adds up.
  const series = col && ADDITIVE.has(m) ? p.cols.slice(0, SERIES.length) : []
  const max = Math.max(0, ...p.rows.map(r => p.rowTotals[r] ?? 0)) || 1

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.anTitle} subtitle={w.anSubtitle} />
      <p className="text-xs text-text-secondary">
        {w.dateLabel}: <strong><bdi>{rangeText}</bdi></strong>
      </p>
      <div className="flex flex-wrap gap-1.5" data-print-hide>
        {Object.entries(quick).map(([k, [qf, qt]]) => (
          <button key={k} type="button" onClick={() => set({ from: qf, to: qt })} aria-pressed={from === qf && to === qt}
            className={`text-xs px-2.5 py-1 rounded-full border ${from === qf && to === qt ? 'border-stone-900 bg-stone-900 text-white' : 'border-border bg-white text-text hover:border-stone-400'}`}>
            {w.quick[k]}
          </button>
        ))}
      </div>
      <div className="bg-white border border-border p-3 flex flex-wrap items-end gap-3" data-print-hide>
        <label className="block"><span className="block text-[11px] text-text-secondary">{w.fromDate}</span>
          <input type="date" value={from} onChange={e => set({ from: e.target.value })} className={fieldInline} dir="ltr" /></label>
        <label className="block"><span className="block text-[11px] text-text-secondary">{w.toDate}</span>
          <input type="date" value={to} onChange={e => set({ to: e.target.value })} className={fieldInline} dir="ltr" /></label>
        <label className="block"><span className="block text-[11px] text-text-secondary">{w.measureLabel}</span>
          <select value={m} onChange={e => set({ m: e.target.value })} className={fieldInline}>
            {REPORT_MEASURES.map(k => <option key={k} value={k}>{w.measures[k]}</option>)}
          </select></label>
        <label className="block"><span className="block text-[11px] text-text-secondary">{w.rowsLabel}</span>
          <select value={row} onChange={e => set({ rows: e.target.value, cols: e.target.value === col ? '' : col })} className={fieldInline}>
            {REPORT_DIMS.map(k => <option key={k} value={k}>{w.dims[k]}</option>)}
          </select></label>
        <label className="block"><span className="block text-[11px] text-text-secondary">{w.colsLabel}</span>
          <select value={col} onChange={e => set({ cols: e.target.value })} className={fieldInline}>
            <option value="">{w.noCols}</option>
            {REPORT_DIMS.filter(k => k !== row).map(k => <option key={k} value={k}>{w.dims[k]}</option>)}
          </select></label>
        <span className="flex-1" />
        {(from || to) && <Button size="sm" variant="ghost" onClick={() => set({ from: '', to: '' })}>{w.clearDates}</Button>}
        {col && <Button size="sm" variant="ghost" onClick={() => set({ rows: col, cols: row })}>{w.swap}</Button>}
        <Button size="sm" variant="secondary" onClick={() => window.print()}>{w.print}</Button>
        <Button size="sm" variant="secondary" onClick={downloadCsv} disabled={!p.rows.length}>{w.csv}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3" data-print-hide>
        <FilterChips filters={REPORT_FILTERS} active={active} onToggle={k => set({ f: (active.includes(k) ? active.filter(x => x !== k) : [...active, k]).join(',') })}
          groupLabel={() => w.filterGroups.status} label={k => w.anFilters[k]} />
        <span className="flex-1" />
        <div className="inline-flex border border-border rounded-md overflow-hidden" role="group">
          {['pivot', 'graph'].map(v => (
            <button key={v} type="button" onClick={() => set({ v: v === 'pivot' ? '' : v })} aria-pressed={view === v}
              className={`text-xs px-2.5 py-1.5 ${view === v ? 'bg-stone-900 text-white' : 'bg-white text-text hover:bg-stone-50'}`}>{w.anViews[v]}</button>
          ))}
        </div>
      </div>
      {error && <p className="text-xs text-red-600" dir="auto" role="alert">{error}</p>}

      {leads === null || !base ? <Skeleton className="h-64" /> : (
        <>
          <Figures items={figures} />
          {!p.rows.length ? (
            <div className="bg-white border border-border p-5 text-sm"><p className="font-semibold">{w.noData}</p><p className="text-text-secondary">{w.noDataBody}</p></div>
          ) : view === 'graph' ? (
            <section className="bg-white border border-border p-4 space-y-3">
              <h2 className="text-sm font-semibold text-text">{w.measures[m]} {w.by} {w.dims[row]} <span className="font-normal text-text-tertiary text-xs">({rangeText})</span></h2>
              {col && !ADDITIVE.has(m) && <p className="text-[11px] text-text-tertiary">{w.notSummable}</p>}
              {series.length > 1 && (
                <div className="flex flex-wrap gap-3 text-[11px] text-text-secondary">
                  {series.map((s, i) => <span key={s} className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: SERIES[i] }} /><bdi>{label(col, s)}</bdi></span>)}
                  {p.cols.length > SERIES.length && <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block bg-stone-400" />{w.other}</span>}
                </div>
              )}
              <div className="space-y-1.5" role="img" aria-label={`${w.measures[m]} ${w.by} ${w.dims[row]}`}>
                {p.rows.map(r => {
                  const v = p.rowTotals[r]
                  let rest = v ?? 0
                  return (
                    <div key={r} className="grid grid-cols-[minmax(6rem,12rem)_1fr] gap-2 items-center text-xs">
                      <span className="truncate text-text-secondary" title={label(row, r)}><bdi>{label(row, r)}</bdi></span>
                      {v == null ? <span className="text-text-tertiary">{w.notComputable}</span> : (
                        <span className="flex items-center gap-2">
                          <span className="flex h-4 rounded-sm overflow-hidden bg-stone-100" style={{ width: `${(v / max) * 100}%`, minWidth: v > 0 ? 2 : 0 }}>
                            {series.length ? (
                              <>
                                {series.map((s, i) => {
                                  const sv = p.cells[r]?.[s] ?? 0
                                  rest -= sv
                                  return sv > 0 && <span key={s} style={{ flex: sv, background: SERIES[i] }} title={`${label(col, s)}: ${fmt(sv)}`} />
                                })}
                                {rest > 0.0001 && <span className="bg-stone-400" style={{ flex: rest }} title={`${w.other}: ${fmt(rest)}`} />}
                              </>
                            ) : <span className="flex-1 bg-stone-800" title={`${label(row, r)}: ${fmt(v)}`} />}
                          </span>
                          <bdi dir="ltr" className="tabular-nums text-text">{fmt(v)}</bdi>
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="text-[11px] text-text-tertiary" data-print-hide>{w.graphHint}</p>
            </section>
          ) : (
            <div className="bg-white border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  <th className="text-start font-medium px-3 py-2">{w.dims[row]}{col && <span className="font-normal"> / {w.dims[col]}</span>}</th>
                  {p.cols.map(c => <th key={c} className="text-end font-medium px-3 py-2"><bdi>{label(col, c)}</bdi></th>)}
                  <th className="text-end font-medium px-3 py-2">{w.total}</th>
                  {canShare && <th className="text-end font-medium px-3 py-2">{w.share}</th>}
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {p.rows.map(r => {
                    const share = canShare ? (Math.max(0, p.rowTotals[r] ?? 0) / p.grand) * 100 : 0
                    return (
                      <tr key={r}>
                        <td className="px-3 py-2"><bdi>{label(row, r)}</bdi></td>
                        {p.cols.map(c => <td key={c} className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmt(p.cells[r]?.[c])}</td>)}
                        <td className="px-3 py-2 text-end tabular-nums font-medium" dir="ltr">{fmt(p.rowTotals[r])}</td>
                        {canShare && (
                          <td className="px-3 py-2 text-end tabular-nums whitespace-nowrap" dir="ltr">
                            <span className="inline-block align-middle w-16 h-1.5 bg-stone-100 rounded me-2 overflow-hidden"><i className="block h-full bg-stone-700" style={{ width: `${Math.min(100, share)}%` }} /></span>
                            {share.toFixed(1)}%
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot><tr className="border-t border-border bg-stone-50 font-semibold">
                  <td className="px-3 py-2">{w.total}</td>
                  {p.cols.map(c => <td key={c} className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmt(p.colTotals[c])}</td>)}
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmt(p.grand)}</td>
                  {canShare && <td className="px-3 py-2 text-end tabular-nums" dir="ltr">100%</td>}
                </tr></tfoot>
              </table>
            </div>
          )}
        </>
      )}
      {swapped && <p className="text-[11px] text-text-tertiary">{w.swappedNote}</p>}
    </div>
  )
}
