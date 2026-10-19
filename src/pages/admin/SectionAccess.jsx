import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { fetchAllAccess, fetchCompanyAssignments } from '../../lib/access'
import { fetchCompanySections, setSection, sectionRows, GRANTABLE } from '../../lib/sectionAccess'
import { SECTIONS } from '../../lib/modules'

// ─── Admin → Section access (v2) ───────────────────────────────────────────
// 2026-10-19, the CEO's requirement 18 and step 2 of docs/COMPANY-HUB-PLAN.md:
// each person gets only the sections they need, at a level. One row per
// person in the open company, one choice per section; a change saves at once.
//
// Who is let in at all and which companies they get stay on Team & Access.
// The database enforces Sales and CEO grants (has_section, migration
// 20261101_section_access); Marketing and Insights data is still readable by
// every member of the company, as in v1, and the screen says so.

const LEVEL_LABEL = { '': 'No access', view: 'View', work: 'Work', manage: 'Manage' }
const LEVEL_HINT = {
  view: 'Can look, cannot change anything.',
  work: 'Uses it day to day: assign, mark, post, edit content.',
  manage: 'Also changes how it works: targets, routing, agent settings.',
}

export default function SectionAccess() {
  const { isAccessAdmin, activeWorkspaceId, activeWorkspace, user } = useAuth()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState({}) // `${userId}:${section}` -> 'busy' | 'done' | 'error:…'

  const load = useCallback(async () => {
    if (!activeWorkspaceId) return
    const [acc, asg, gr] = await Promise.all([fetchAllAccess(), fetchCompanyAssignments(), fetchCompanySections(activeWorkspaceId)])
    const err = acc.error || asg.error || gr.error
    setError(err || '')
    setRows(sectionRows({ access: acc.rows, assignments: asg.assignments, grants: gr.rows.map(g => ({ ...g, workspace_id: activeWorkspaceId })), workspaceId: activeWorkspaceId }))
  }, [activeWorkspaceId])

  useEffect(() => { if (isAccessAdmin) queueMicrotask(load) }, [load, isAccessAdmin])

  if (!isAccessAdmin) return <Navigate to="/" replace />

  async function change(row, section, level) {
    const key = `${row.userId}:${section}`
    setSaving(s => ({ ...s, [key]: 'busy' }))
    const out = await setSection(activeWorkspaceId, row.userId, section, level || null, user?.id)
    if (out.error) { setSaving(s => ({ ...s, [key]: `error:${out.error}` })); return }
    setRows(rs => rs.map(r => (r.userId === row.userId ? { ...r, levels: { ...r.levels, [section]: level || null } } : r)))
    setSaving(s => ({ ...s, [key]: 'done' }))
  }

  const label = key => SECTIONS.find(s => s.key === key)?.label || key

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader title="Section access"
        subtitle={`Who can open which section of ${activeWorkspace?.name || 'this company'}, and at what level. Changes save as you pick them.`} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {['view', 'work', 'manage'].map(l => (
          <div key={l} className="bg-white border border-border px-3 py-2">
            <p className="text-xs font-semibold text-text">{LEVEL_LABEL[l]}</p>
            <p className="text-[11px] text-text-secondary mt-0.5">{LEVEL_HINT[l]}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-text-secondary">
        Sales and CEO data is locked by these choices. Marketing and Insights data can still be read by every member of the company, as before; for now those choices only decide what each person sees in the app.
      </p>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {rows === null ? <Skeleton className="h-48" /> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-text-tertiary border-b border-border">
                <th className="text-start font-medium px-3 py-2">Person</th>
                {GRANTABLE.map(s => <th key={s} className="text-start font-medium px-3 py-2">{label(s)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.userId} className="align-middle">
                  <td className="px-3 py-2.5 min-w-[11rem]">
                    <p className="font-medium text-text">{r.name}</p>
                    <p className="text-[11px] text-text-tertiary">{r.kind === 'admin' ? 'Admin: every section' : r.kind === 'sales' ? 'Sales team: their own leads app' : r.email}</p>
                  </td>
                  {GRANTABLE.map(s => {
                    const key = `${r.userId}:${s}`
                    const state = saving[key]
                    if (r.kind !== 'member') {
                      return <td key={s} className="px-3 py-2.5 text-xs text-text-tertiary">{r.kind === 'admin' ? 'Manage' : '—'}</td>
                    }
                    return (
                      <td key={s} className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <select value={r.levels[s] || ''} onChange={e => change(r, s, e.target.value)} disabled={state === 'busy'}
                            aria-label={`${r.name}: ${label(s)}`}
                            className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200">
                            {Object.entries(LEVEL_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                          </select>
                          {state === 'busy' && <Spinner size="sm" />}
                          {state === 'done' && <span className="text-[11px] text-green-700" aria-live="polite">Saved</span>}
                          {state?.startsWith?.('error:') && <span className="text-[11px] text-red-600" dir="auto">{state.slice(6)}</span>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={GRANTABLE.length + 1} className="px-3 py-6 text-center text-xs text-text-tertiary">Nobody belongs to this company yet. Add people on Team &amp; Access.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
