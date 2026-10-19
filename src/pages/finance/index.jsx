import { Link } from 'react-router-dom'
import { useT, fmtDay, fmtSar } from '../../lib/i18n'
import { FW, useFinance } from './data'
import { Skeleton } from '../../components/ui/index'
import { timeAgo } from '../../lib/utils'

// ─── Finance (v2) ──────────────────────────────────────────────────────────
// 2026-10-19. Read only, from Odoo Accounting through the hourly mirror (the
// CEO's rule 7: Odoo is the source; nothing is typed here). Two pages:
//   /finance            invoices and collections, overdue > 60 days, and how
//                       long the unpaid ones have been outstanding
//   /finance/projects   % collected per project, and planned against actual
//                       margin, red when more than 5 points under plan
// Every number is worked out in lib/finance/finance.js (tested).

export function FinanceFrame({ title, sub, data, error, children, t, lang, nav = null }) {
  return (
    <div className="max-w-5xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text tracking-tight leading-none">{title}</h1>
          <p className="text-xs text-text-secondary mt-2 max-w-2xl leading-relaxed">{sub}</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.sync?.last_ok_at && <p className="text-[11px] text-text-tertiary">{t.lastRead} {lang === 'ar' ? fmtDay(data.sync.last_ok_at, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : timeAgo(data.sync.last_ok_at)}</p>}
          {nav}
        </div>
      </header>
      {error ? (
        <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3">
          <p className="text-sm font-semibold text-red-800">{t.loadFailed}</p>
          <p className="text-xs text-red-700 mt-1" dir="auto">{error}</p>
        </div>
      ) : data === undefined ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>
      ) : !data.facts ? (
        <Empty>{t.notSynced}</Empty>
      ) : children}
    </div>
  )
}

const Empty = ({ children }) => <div className="border border-border rounded-xl bg-surface-subtle px-4 py-6 text-center text-sm text-text-secondary">{children}</div>

function Tile({ label, value, sub, tone = null }) {
  const dot = tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-yellow-500' : tone === 'green' ? 'bg-green-500' : null
  return (
    <div className="bg-white border border-border rounded-xl px-4 py-3 min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-text-secondary leading-tight">
        {dot && <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden="true" />}<span className="truncate">{label}</span>
      </p>
      <p className="text-xl sm:text-2xl font-bold tabular-nums mt-1 leading-none text-text">{value}</p>
      {sub && <p className="text-[11px] text-text-secondary mt-1 leading-snug">{sub}</p>}
    </div>
  )
}

export function FinanceInvoices() {
  const { t, lang, dir } = useT(FW)
  const data = useFinance()
  const f = data.data?.facts
  const maxAging = Math.max(1, ...(f?.aging || []).map(b => b.amount))
  return (
    <div dir={dir} lang={lang}>
      <FinanceFrame title={t.title} sub={t.sub} data={data.data} error={data.error} t={t} lang={lang}
        nav={<Link to="/finance/projects" className="text-xs text-text-secondary hover:text-text">{t.projectsTitle} {lang === 'ar' ? '←' : '→'}</Link>}>
        {f && !f.hasAccounting ? <Empty>{t.noAccounting}</Empty> : f && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label={t.invoicedMonth} value={fmtSar(f.invoicedMonth, lang, { short: true })} />
              <Tile label={t.collectedMonth} value={f.collectedMonth == null ? '—' : fmtSar(f.collectedMonth, lang, { short: true })} sub={f.collectedMonth == null ? t.noPayments : t.paymentsSub} />
              <Tile label={t.outstanding} value={fmtSar(f.outstanding, lang, { short: true })}
                sub={[t.unpaidN(f.unpaidCount), f.avgDaysOutstanding != null && t.avgDays(f.avgDaysOutstanding)].filter(Boolean).join(' · ')} />
              <Tile label={t.overdue} value={fmtSar(f.overdueAmount, lang, { short: true })} sub={t.overdueN(f.overdueCount)} tone={f.overdueCount ? 'red' : 'green'} />
            </div>

            <section className="border border-border rounded-xl bg-white px-4 py-3">
              <h2 className="text-sm font-semibold text-text">{t.aging}</h2>
              <p className="text-[11px] text-text-secondary">{t.agingSub}</p>
              <ul className="mt-3 space-y-2">
                {f.aging.map(b => (
                  <li key={b.key} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-xs">
                    <span className="text-text-secondary">{b[lang] || b.en}</span>
                    <span className="h-2 rounded-full bg-stone-100 overflow-hidden" aria-hidden="true">
                      <span className={`block h-full rounded-full ${b.max > 60 ? 'bg-red-400' : 'bg-stone-500'}`} style={{ width: `${(b.amount / maxAging) * 100}%` }} />
                    </span>
                    <span className="tabular-nums text-text text-end">{fmtSar(b.amount, lang, { short: true })} <span className="text-text-tertiary">· {b.count}</span></span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="border border-border rounded-xl bg-white">
              <div className="px-4 pt-3 pb-2">
                <h2 className="text-sm font-semibold text-text">{t.unpaid}</h2>
                <p className="text-[11px] text-text-secondary">{t.unpaidSub}</p>
              </div>
              {!f.unpaid.length ? <p className="px-4 pb-4 text-xs text-text-tertiary">{t.none}</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-surface-subtle text-text-tertiary">
                      <tr>{[t.invoice, t.customer, t.date, t.due, t.residual, t.outstandingDays].map(h => <th key={h} className="text-start font-medium px-3 py-2 whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {f.unpaid.map(u => (
                        <tr key={u.id} className={`border-t border-border ${u.overdue60 ? 'bg-red-50/50' : ''}`}>
                          <td className="px-3 py-2 whitespace-nowrap">{u.url ? <a href={u.url} target="_blank" rel="noreferrer" className="font-medium text-text hover:underline" dir="ltr">{u.name}</a> : <span dir="ltr">{u.name}</span>}</td>
                          <td className="px-3 py-2 text-text">{u.customer}{u.partial && <span className="text-text-tertiary"> · {t.partial}</span>}</td>
                          <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDay(u.invoiceDate, lang)}</td>
                          <td className="px-3 py-2 text-text-secondary whitespace-nowrap">{fmtDay(u.dueDate, lang)}</td>
                          <td className="px-3 py-2 tabular-nums text-text whitespace-nowrap">{fmtSar(u.residual, lang)}</td>
                          <td className={`px-3 py-2 whitespace-nowrap ${u.overdue60 ? 'text-red-700 font-semibold' : u.daysPastDue ? 'text-yellow-800' : 'text-text-secondary'}`}>
                            {t.days(u.daysOutstanding)}{u.daysPastDue ? ` · ${t.pastDue(u.daysPastDue)}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </FinanceFrame>
    </div>
  )
}
