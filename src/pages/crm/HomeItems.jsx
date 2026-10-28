import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { useT } from '../../lib/i18n'
import { homeCounts, riyadhToday } from '../../lib/crm/logic'
import { fetchActivities, fetchLeads } from '../../lib/crm/client'
import { RW } from './words'

// ─── CRM on Home (v2) ──────────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Musa's home board lists what waits for
// the reader, each a link to exactly those records, and only what has
// something waiting: sales activities late on you, those planned for you
// today, and (for whoever works the CRM) your open opportunities with
// nothing planned. Silent for anyone without the CRM.

const TONE = { late: 'border-red-200 bg-red-50 text-red-800', today: 'border-amber-200 bg-amber-50 text-amber-900', idle: 'border-border bg-white text-text' }
const LINK = { late: '/crm/activities?f=overdue', today: '/crm/activities?f=today', idle: '/crm/list?f=mine,no_activity' }

export function CrmHomeItems() {
  const { canSection, activeWorkspaceId: ws, user } = useAuth()
  const { t: w } = useT(RW)
  const [counts, setCounts] = useState(null)
  const can = canSection('crm', 'view')

  useEffect(() => {
    if (!can || !ws || !user?.id) return
    let off = false
    Promise.all([fetchActivities(ws, { open: true }), fetchLeads(ws)]).then(([a, l]) => {
      if (!off) setCounts(homeCounts({ activities: a.rows, leads: l.rows, me: user.id, today: riyadhToday() }))
    })
    return () => { off = true }
  }, [can, ws, user?.id])

  if (!can || !counts) return null
  const items = ['late', 'today', 'idle'].filter(k => counts[k] > 0 && (k !== 'idle' || canSection('crm', 'work')))
  if (!items.length) return null
  return (
    <section>
      <h2 className="eyebrow mb-2">{w.homeTitle}</h2>
      <ul className="flex flex-wrap gap-2">
        {items.map(k => (
          <li key={k}>
            <Link to={LINK[k]} className={`inline-flex items-center gap-2 border rounded-md px-3 py-2 text-xs hover:opacity-90 ${TONE[k]}`}>
              <strong className="tabular-nums text-sm">{counts[k]}</strong>{w.home[k]}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
