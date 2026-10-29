import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { riyadhToday, bidChip } from '../../lib/crm/logic'
import { SHEET_FILTERS, SHEET_GROUPS, filterSheets, searchSheets, sortSheets, groupSheets, pageOf, marginPct, fmtMoney } from '../../lib/pricing/logic'
import { fetchSheets } from '../../lib/pricing/client'
import { PW } from './words'
import { usePricingBase, field, fieldInline, sheetHref } from './usePricing'
import { StatusBadge, NoAccess, Alert } from './parts'

// ─── Pricing → Sheets (v2) ─────────────────────────────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Musa's list of pricing sheets: a
// search over the sheet and its opportunity, status filters (any of the
// chosen) and "my sheets", grouped by status if asked, 30 to a page; work in
// progress first by the opportunity's bid date. Cost, selling price and
// margin are shown to everyone who can open Pricing. Everything lives in the
// URL, so a filtered list can be linked to.

export function PricingPage() {
  const { canSection, user } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { ws, leadsById, error: baseError } = usePricingBase()
  const [sheets, setSheets] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!ws) return
    const r = await fetchSheets(ws)
    setSheets(r.rows)
    setError(r.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  const q = params.get('q') || ''
  const active = (params.get('f') || '').split(',').filter(k => SHEET_FILTERS.some(f => f.key === k))
  const group = SHEET_GROUPS.includes(params.get('group')) ? params.get('group') : ''
  const pageNo = params.get('page') || 1
  const setParam = (k, v) => setParams(p => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v); else n.delete(k)
    if (k !== 'page') n.delete('page')
    return n
  }, { replace: true })
  const toggle = key => setParam('f', (active.includes(key) ? active.filter(k => k !== key) : [...active, key]).join(','))

  const shown = useMemo(() => sortSheets(searchSheets(filterSheets(sheets || [], active, user?.id), q, leadsById), leadsById),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheets, params, leadsById, user?.id])
  const { rows, page, pages } = useMemo(() => pageOf(shown, pageNo), [shown, pageNo])
  const grouped = useMemo(() => groupSheets(rows, group), [rows, group])
  const today = riyadhToday()

  if (!canSection('pricing', 'view')) return <NoAccess />

  const open = s => navigate(sheetHref(s.id))
  const colKeys = ['no', 'sheet', 'lead', 'bid', 'lines', 'cost', 'sell', 'margin', 'status']
  const num = 'px-3 py-2 tabular-nums whitespace-nowrap'

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.title} subtitle={w.subtitle}>
        <Link to="/pricing/settings" className="text-xs text-text-secondary hover:text-text underline self-center">{w.settingsLink}</Link>
        {canSection('pricing', 'work') && <Button size="sm" onClick={() => navigate('/pricing/new')}>{w.newSheet}</Button>}
      </PageHeader>

      <div className="flex flex-wrap gap-2 items-center">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={w.search} aria-label={w.search} className={`${field} flex-1 min-w-[14rem]`} dir="auto" />
        <select value={group} onChange={e => setParam('group', e.target.value)} className={fieldInline} aria-label={w.groupBy}>
          {['', ...SHEET_GROUPS].map(g => <option key={g} value={g}>{g ? `${w.groupBy}: ${w.groups[g]}` : w.groups['']}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={w.filterStatus}>
        {SHEET_FILTERS.map(f => (
          <button key={f.key} type="button" aria-pressed={active.includes(f.key)} onClick={() => toggle(f.key)}
            className={`text-xs px-2.5 py-1 rounded-md border ${active.includes(f.key) ? 'bg-stone-900 text-white border-stone-900' : 'bg-white text-text-secondary border-border hover:bg-stone-50'}`}>
            {f.key === 'mine' ? w.mine : w.statuses[f.key]}
          </button>
        ))}
      </div>

      <Alert>{error || baseError}</Alert>

      {sheets === null ? <Skeleton className="h-64" /> : !sheets.length ? (
        <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyAll}</p>
      ) : (
        <>
          <p className="text-[11px] text-text-tertiary">{w.count(shown.length, sheets.length)}</p>
          {!shown.length ? <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyFilter}</p> : (
            <div className="bg-white border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  {colKeys.map(c => <th key={c} className={`font-medium px-3 py-2 ${['lines', 'cost', 'sell', 'margin'].includes(c) ? 'text-end' : 'text-start'}`}>{w.cols[c]}</th>)}
                </tr></thead>
                {grouped.map(g => (
                  <tbody key={g.key || '-'} className="divide-y divide-border">
                    {group && (
                      <tr className="bg-stone-50"><td colSpan={colKeys.length} className="px-3 py-1.5 text-xs font-semibold text-text-secondary">
                        {w.statuses[g.key]} <span className="font-normal text-text-tertiary">({g.rows.length})</span>
                      </td></tr>
                    )}
                    {g.rows.map(s => {
                      const l = leadsById[s.lead_id]
                      const t = s.totals
                      const margin = t ? marginPct(t.sell_total, t.cost_total) : null
                      const chip = (s.status === 'draft' || s.status === 'submitted') && l ? bidChip(l, today) : null
                      return (
                        <tr key={s.id} role="link" tabIndex={0} onClick={() => open(s)} onKeyDown={e => { if (e.key === 'Enter') open(s) }}
                          className="hover:bg-stone-50 cursor-pointer focus:outline-none focus-visible:bg-stone-50 align-top">
                          <td className={`${num} text-xs text-text-secondary`} dir="ltr" style={{ textAlign: 'start' }}>{s.sheet_no}</td>
                          <td className="px-3 py-2 min-w-[12rem] font-medium text-text"><bdi>{s.title}</bdi></td>
                          <td className="px-3 py-2 min-w-[11rem] text-text-secondary"><bdi dir="ltr">{l?.lead_no}</bdi> — <bdi>{(lang === 'ar' ? l?.party_ar : l?.party) || l?.title || ''}</bdi></td>
                          <td className="px-3 py-2 whitespace-nowrap text-xs">
                            {chip ? <span className={chip.tone === 'past' ? 'text-red-700' : chip.tone === 'soon' ? 'text-yellow-800' : 'text-text-secondary'} dir="ltr">{String(l.bid_due_date).slice(0, 10)}</span>
                              : <span className="text-text-secondary" dir="ltr">{l?.bid_due_date ? String(l.bid_due_date).slice(0, 10) : '—'}</span>}
                          </td>
                          <td className={`${num} text-end`}>{t?.line_count ?? 0}</td>
                          <td className={`${num} text-end`} title={t && t.cost_total === null && t.line_count ? w.unknownCost(t.uncosted_count) : undefined} dir="ltr">{fmtMoney(t?.cost_total)}</td>
                          <td className={`${num} text-end`} title={t && t.sell_total === null && t.line_count ? w.unknownSell(t.unpriced_count) : undefined} dir="ltr">{fmtMoney(t?.sell_total)}</td>
                          <td className={`${num} text-end`} dir="ltr">{margin === null ? '—' : `${margin}%`}</td>
                          <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {pages > 1 && (
            <div className="flex items-center justify-between gap-2 text-xs text-text-secondary">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setParam('page', page - 1 > 1 ? String(page - 1) : '')}>{w.prev}</Button>
              <span>{w.page(page, pages)}</span>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>{w.next}</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
