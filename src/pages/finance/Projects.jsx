import { Link } from 'react-router-dom'
import { useT, fmtSar } from '../../lib/i18n'
import { FinanceFrame } from './index'
import { FW, useFinance } from './data'

// ─── Finance → Project margins (v2) ────────────────────────────────────────
// 2026-10-19. Per project: invoiced and collected (from its sales order's
// invoices), and the margin quoted against the margin to date. Red when
// the actual is more than 5 points under plan. What Odoo is missing for a
// project (no order, no analytic account, no margin on the order) is said
// on its row, so the number is never a silent zero.

export function FinanceProjects() {
  const { t, lang, dir } = useT(FW)
  const data = useFinance()
  const f = data.data?.facts
  const pct = v => (v == null ? '—' : `${v}%`)
  return (
    <div dir={dir} lang={lang}>
      <FinanceFrame title={t.projectsTitle} sub={t.projectsSub} data={data.data} error={data.error} t={t} lang={lang}
        nav={<Link to="/finance" className="text-xs text-text-secondary hover:text-text">{lang === 'ar' ? '→' : '←'} {t.title}</Link>}>
        {f && !f.projects.length ? <p className="text-sm text-text-secondary">{t.noProjects}</p> : f && (
          <>
            <div className="border border-border rounded-xl bg-white overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-surface-subtle text-text-tertiary">
                  <tr>{[t.project, t.invoiced, t.collected, t.pctCollected, t.planned, t.actual, t.gap].map(h => <th key={h} className="text-start font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {f.projects.map(p => (
                    <tr key={p.id} className={`border-t border-border align-top ${p.marginRed ? 'bg-red-50/50' : ''}`}>
                      <td className="px-3 py-2 min-w-[12rem]">
                        <p className="flex items-center gap-1.5">
                          {p.marginRed && <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" aria-hidden="true" />}
                          {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="font-medium text-text hover:underline">{p.name}</a> : <span className="font-medium text-text">{p.name}</span>}
                        </p>
                        <p className="text-[11px] text-text-tertiary">
                          {[p.customer, p.order && p.order.name, p.pctInvoiced != null && t.ofInvoiced(p.pctInvoiced)].filter(Boolean).join(' · ')}
                        </p>
                        {p.missing.length > 0 && <p className="text-[11px] text-yellow-800 mt-0.5">{t.toFix}: {p.missing.map(m => t.missing[m]).join(', ')}</p>}
                      </td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{p.order ? fmtSar(p.invoiced, lang, { short: true }) : '—'}</td>
                      <td className="px-3 py-2 tabular-nums whitespace-nowrap">{p.order ? fmtSar(p.collected, lang, { short: true }) : '—'}</td>
                      <td className="px-3 py-2">
                        {p.pctCollected == null ? '—' : (
                          <span className="flex items-center gap-2">
                            <span className="w-14 h-1.5 rounded-full bg-stone-100 overflow-hidden" aria-hidden="true">
                              <span className="block h-full bg-stone-600 rounded-full" style={{ width: `${p.pctCollected}%` }} />
                            </span>
                            <span className="tabular-nums">{p.pctCollected}%</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{pct(p.plannedMargin)}</td>
                      <td className={`px-3 py-2 tabular-nums ${p.marginRed ? 'text-red-700 font-semibold' : ''}`}>{pct(p.actualMargin)}</td>
                      <td className={`px-3 py-2 tabular-nums whitespace-nowrap ${p.marginRed ? 'text-red-700 font-semibold' : p.marginGap != null && p.marginGap < 0 ? 'text-yellow-800' : 'text-text-secondary'}`}>
                        {p.marginGap == null ? '—' : t.points(p.marginGap)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-text-tertiary">{t.basis}</p>
          </>
        )}
      </FinanceFrame>
    </div>
  )
}
