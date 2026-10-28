import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { useT } from '../../lib/i18n'
import { listName, fmtMoney, orgName } from '../../lib/crm/logic'
import { fetchLeads, fetchList } from '../../lib/crm/client'
import { RW } from './words'
import { leadHref } from './useCrmBase'
import { StatusBadge } from './parts'

// ─── A client's opportunities, on its Contacts page (v2) ───────────────────
// 2026-10-28, dev/erp-pilot/CRM.md and CONTACTS.md "Next Contacts step".
// Musa's client page: a summary button with the count of its opportunities
// (opening the list searched by its name), "New opportunity" for an active
// client, and the opportunities themselves (number, title, stage, expected
// value, status). Shown only to people who have the CRM: a count read
// without it would be a zero that looks like a fact.

export function OrgLeads({ org }) {
  const { canSection, activeWorkspaceId: ws } = useAuth()
  const { t: w, lang } = useT(RW)
  const navigate = useNavigate()
  const [leads, setLeads] = useState(null)
  const [stages, setStages] = useState({})
  const can = canSection('crm', 'view')

  useEffect(() => {
    if (!can || !ws || !org?.id) return
    let off = false
    Promise.all([fetchLeads(ws, { clientId: org.id }), fetchList(ws, 'stages')]).then(([l, s]) => {
      if (off) return
      setLeads(l.rows)
      setStages(Object.fromEntries(s.rows.map(r => [r.id, r])))
    })
    return () => { off = true }
  }, [can, ws, org?.id])

  if (!can || !leads) return null
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text">{w.orgLeads}</h2>
          <Link to={`/crm/list?q=${encodeURIComponent(orgName(org, 'en'))}`}
            className="inline-flex items-baseline gap-1.5 border border-border rounded-md px-2.5 py-1 bg-white hover:bg-stone-50 text-xs">
            <strong className="tabular-nums text-sm">{leads.length}</strong>{w.orgSummary}
          </Link>
        </div>
        {canSection('crm', 'work') && org.status === 'active' && (
          <button type="button" onClick={() => navigate(`/crm/new?client=${org.id}`)}
            className="text-xs px-2.5 py-1 rounded-md border border-border bg-white hover:bg-stone-50">{w.orgNewLead}</button>
        )}
      </div>
      {!leads.length ? <p className="text-xs text-text-tertiary">{w.orgLeadsNone}</p> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <th className="text-start font-medium px-3 py-2">{w.cols.no}</th>
              <th className="text-start font-medium px-3 py-2">{w.cols.lead}</th>
              <th className="text-start font-medium px-3 py-2">{w.cols.stage}</th>
              <th className="text-end font-medium px-3 py-2">{w.cols.value}</th>
              <th className="text-start font-medium px-3 py-2">{w.cols.status}</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {leads.map(l => (
                <tr key={l.id} role="link" tabIndex={0} onClick={() => navigate(leadHref(l.id))} onKeyDown={e => { if (e.key === 'Enter') navigate(leadHref(l.id)) }}
                  className="hover:bg-stone-50 cursor-pointer">
                  <td className="px-3 py-2 text-[11px] text-text-tertiary tabular-nums whitespace-nowrap" dir="ltr" style={{ textAlign: 'start' }}>{l.lead_no}</td>
                  <td className="px-3 py-2"><bdi>{l.title}</bdi></td>
                  <td className="px-3 py-2 text-text-secondary"><bdi>{listName(stages[l.stage_id], lang)}</bdi></td>
                  <td className="px-3 py-2 text-end tabular-nums" dir="ltr">{fmtMoney(l.expected_revenue)}</td>
                  <td className="px-3 py-2"><StatusBadge status={l.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
