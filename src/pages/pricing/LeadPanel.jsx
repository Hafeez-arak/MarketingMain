import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { fetchSheetsOfLead } from '../../lib/pricing/client'
import { PW } from './words'
import { StatusBadge } from './parts'
import { sheetHref } from './usePricing'

// The pricing sheets of one opportunity, on the CRM's opportunity page (as on
// Musa's): the sheets with their status, and, for Pricing Work on an open
// opportunity, "New pricing sheet". Shown to whoever can read Pricing; the
// cost and margin stay on the sheet itself.

export function PricingPanel({ ws, lead }) {
  const { canSection } = useAuth()
  const { t: w, dir } = useT(PW)
  const [rows, setRows] = useState(null)
  const can = canSection('pricing', 'view')

  useEffect(() => {
    if (!can || !ws || !lead?.id) return
    let alive = true
    fetchSheetsOfLead(ws, lead.id).then(r => { if (alive) setRows(r.rows) })
    return () => { alive = false }
  }, [can, ws, lead?.id])

  if (!can) return null
  return (
    <section className="bg-white border border-border p-4 space-y-2" dir={dir}>
      <h2 className="text-sm font-semibold text-text">{w.panelTitle}</h2>
      {rows === null ? <p className="text-xs text-text-tertiary">{w.loading}</p> : !rows.length ? (
        <p className="text-xs text-text-secondary">{w.panelNone}</p>
      ) : (
        <ul className="divide-y divide-border text-sm">
          {rows.map(s => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <Link to={sheetHref(s.id)} className="underline text-xs" dir="ltr">{s.sheet_no}</Link>
              <span className="min-w-0 flex-1"><bdi>{s.title}</bdi></span>
              <StatusBadge status={s.status} />
            </li>
          ))}
        </ul>
      )}
      {canSection('pricing', 'work') && lead.status === 'open' && (
        <Link to={`/pricing/new?lead=${lead.id}`}><Button size="sm" variant="secondary">{w.panelNew}</Button></Link>
      )}
    </section>
  )
}
