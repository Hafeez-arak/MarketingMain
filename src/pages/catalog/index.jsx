import { useMemo } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { GROUPS, STATUSES, filterItems, groupItems, sortItems, paginate } from '../../lib/catalog/logic'
import { KW } from './words'
import { useCatalog, field, fieldInline } from './useCatalog'

// ─── Catalog → Items (v2) ──────────────────────────────────────────────────
// 2026-10-30, dev/erp-pilot/CATALOG.md. Musa's catalog (الكتالوج): the
// company's items. Active or stopped, a search over code, name, brand, model
// and category, optionally grouped by category or brand, 50 to a page.
// Everything lives in the URL, so a filtered list can be linked to. Opening
// a row goes to the item.

export function CatalogPage() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(KW)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { items, error } = useCatalog()

  const q = params.get('q') || ''
  const status = STATUSES.includes(params.get('status')) ? params.get('status') : 'active'
  const group = GROUPS.includes(params.get('group')) ? params.get('group') : ''
  const pageNo = params.get('page') || 1
  const setParam = (k, v) => setParams(p => {
    const n = new URLSearchParams(p)
    if (v) n.set(k, v); else n.delete(k)
    if (k !== 'page') n.delete('page')
    return n
  }, { replace: true })

  const shown = useMemo(() => sortItems(filterItems(items || [], { q, status })), [items, q, status])
  const { rows, page, pages } = useMemo(() => paginate(shown, pageNo), [shown, pageNo])
  const grouped = useMemo(() => groupItems(rows, group), [rows, group])
  const groupTitle = key => key || (group === 'brand' ? w.noBrand : w.noCategory)

  if (!canSection('catalog', 'view')) return <p className="text-sm text-text-secondary" dir={dir}>{w.noAccess}</p>

  const open = i => navigate(`/catalog/item?id=${i.id}`)
  const cols = ['code', 'name', 'brand', 'model', 'category', 'unit']

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.title} subtitle={w.subtitle}>
        {canSection('catalog', 'manage') && <Link to="/catalog/fields" className="text-xs text-text-secondary hover:text-text underline self-center">{w.fieldsLink}</Link>}
        {canSection('catalog', 'manage') && <Button size="sm" onClick={() => navigate('/catalog/new')}>{w.newItem}</Button>}
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <input type="search" value={q} onChange={e => setParam('q', e.target.value)} placeholder={w.search} aria-label={w.search} className={`${field} flex-1 min-w-[14rem]`} dir="auto" />
        <select value={status} onChange={e => setParam('status', e.target.value === 'active' ? '' : e.target.value)} className={fieldInline} aria-label={w.statusFilter}>
          {STATUSES.map(s => <option key={s} value={s}>{w.statuses[s]}</option>)}
        </select>
        <select value={group} onChange={e => setParam('group', e.target.value)} className={fieldInline} aria-label={w.groupBy}>
          {['', ...GROUPS].map(g => <option key={g} value={g}>{g ? `${w.groupBy}: ${w.groups[g]}` : w.groups['']}</option>)}
        </select>
      </div>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {items === null ? <Skeleton className="h-64" /> : !items.length ? (
        <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyAll}</p>
      ) : (
        <>
          <p className="text-[11px] text-text-tertiary">{w.count(shown.length, items.length)}</p>
          {!shown.length ? <p className="text-sm text-text-tertiary px-1 py-6">{w.emptyFilter}</p> : (
            <div className="bg-white border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  {cols.map(c => <th key={c} className="text-start font-medium px-3 py-2">{w.cols[c]}</th>)}
                </tr></thead>
                {grouped.map(g => (
                  <tbody key={g.key || '-'} className="divide-y divide-border">
                    {group && (
                      <tr className="bg-stone-50"><td colSpan={cols.length} className="px-3 py-1.5 text-xs font-semibold text-text-secondary">
                        <bdi>{groupTitle(g.key)}</bdi> <span className="font-normal text-text-tertiary">({g.rows.length})</span>
                      </td></tr>
                    )}
                    {g.rows.map(i => (
                      <tr key={i.id} role="link" tabIndex={0} onClick={() => open(i)} onKeyDown={e => { if (e.key === 'Enter') open(i) }}
                        className="hover:bg-stone-50 cursor-pointer focus:outline-none focus-visible:bg-stone-50 align-top">
                        <td className="px-3 py-2 text-xs text-text-secondary tabular-nums whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{i.code}</td>
                        <td className="px-3 py-2 min-w-[14rem] font-medium text-text">
                          <bdi>{i.name}</bdi>
                          {!i.active && <span className="ms-2 inline-flex rounded border border-border bg-stone-50 px-1.5 py-0.5 text-[10px] font-normal text-text-secondary">{w.stopped}</span>}
                        </td>
                        <td className="px-3 py-2 text-text-secondary"><bdi>{i.brand || '—'}</bdi></td>
                        <td className="px-3 py-2 text-text-secondary whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{i.model_no || '—'}</td>
                        <td className="px-3 py-2 text-text-secondary"><bdi>{i.category || '—'}</bdi></td>
                        <td className="px-3 py-2 text-text-secondary whitespace-nowrap"><bdi>{i.unit}</bdi></td>
                      </tr>
                    ))}
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
