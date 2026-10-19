import { useCallback, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { fetchAllAccess, fetchCompanyAssignments } from '../../lib/access'
import { fetchCompanySections, setSection, sectionRows, GRANTABLE } from '../../lib/sectionAccess'
import { SECTIONS } from '../../lib/modules'
import { useT, labelOf } from '../../lib/i18n'

// ─── Admin → Section access (v2) ───────────────────────────────────────────
// 2026-10-19, the CEO's requirement 18 and step 2 of docs/COMPANY-HUB-PLAN.md:
// each person gets only the sections they need, at a level. One row per
// person in the open company, one choice per section; a change saves at once.
//
// Who is let in at all and which companies they get stay on Team & Access.
// The database enforces every section's grants (has_section): Sales and CEO
// since 20261101, Marketing and Insights since 20261104, Technical and
// Finance since 20261105.

const W = {
  en: {
    title: 'Section access',
    subtitle: c => `Who can open which section of ${c || 'this company'}, and at what level. Changes save as you pick them.`,
    levels: { '': 'No access', view: 'View', work: 'Work', manage: 'Manage' },
    hints: {
      view: 'Can look, cannot change anything.',
      work: 'Uses it day to day: assign, mark, post, edit content.',
      manage: 'Also changes how it works: targets, routing, agent settings.',
    },
    locked: 'The database enforces these choices for every section: someone without a section cannot read its data, and View cannot change it.',
    technicalNote: 'Technical: View and Work show only the projects a person manages in Odoo (matched by email); Manage shows every project and sets the stage limits. Finance is read only from Odoo.',
    person: 'Person', admin: 'Admin: every section', sales: 'Sales team: their own leads app', manage: 'Manage', saved: 'Saved',
    nobody: 'Nobody belongs to this company yet. Add people on Team & Access.',
  },
  ar: {
    title: 'صلاحيات الأقسام',
    subtitle: c => `من يمكنه فتح أي قسم في ${c || 'هذه الشركة'}، وبأي مستوى. تُحفظ التغييرات فور اختيارها.`,
    levels: { '': 'بلا صلاحية', view: 'عرض', work: 'عمل', manage: 'إدارة' },
    hints: {
      view: 'يطّلع فقط، ولا يغيّر شيئًا.',
      work: 'يستخدمه يوميًا: يُسند، ويعلّم، وينشر، ويعدّل المحتوى.',
      manage: 'ويغيّر طريقة عمله أيضًا: الأهداف، والتوزيع، وإعدادات الوكيل.',
    },
    locked: 'قاعدة البيانات تفرض هذه الاختيارات لكل قسم: من لا يملك القسم لا يقرأ بياناته، ومستوى العرض لا يغيّرها.',
    technicalNote: 'الفني: العرض والعمل يُظهران فقط المشاريع التي يديرها الشخص في أودو (بمطابقة البريد)؛ الإدارة تُظهر كل المشاريع وتحدد حدود المراحل. المالية للقراءة فقط من أودو.',
    person: 'الشخص', admin: 'مدير النظام: كل الأقسام', sales: 'فريق المبيعات: تطبيق العملاء الخاص بهم', manage: 'إدارة', saved: 'تم الحفظ',
    nobody: 'لا أحد في هذه الشركة بعد. أضف الأشخاص من صفحة الفريق والصلاحيات.',
  },
}

export default function SectionAccess() {
  const { isAccessAdmin, activeWorkspaceId, activeWorkspace, user } = useAuth()
  const { t, lang, dir } = useT(W)
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

  const label = key => labelOf(SECTIONS.find(s => s.key === key), lang) || key

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={t.title} subtitle={t.subtitle(activeWorkspace?.name)} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {['view', 'work', 'manage'].map(l => (
          <div key={l} className="bg-white border border-border px-3 py-2">
            <p className="text-xs font-semibold text-text">{t.levels[l]}</p>
            <p className="text-[11px] text-text-secondary mt-0.5">{t.hints[l]}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-text-secondary">{t.locked}</p>
      <p className="text-xs text-text-secondary">{t.technicalNote}</p>

      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      {rows === null ? <Skeleton className="h-48" /> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] text-text-tertiary border-b border-border">
                <th className="text-start font-medium px-3 py-2">{t.person}</th>
                {GRANTABLE.map(s => <th key={s} className="text-start font-medium px-3 py-2">{label(s)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(r => (
                <tr key={r.userId} className="align-middle">
                  <td className="px-3 py-2.5 min-w-[11rem]">
                    <p className="font-medium text-text">{r.name}</p>
                    <p className="text-[11px] text-text-tertiary">{r.kind === 'admin' ? t.admin : r.kind === 'sales' ? t.sales : r.email}</p>
                  </td>
                  {GRANTABLE.map(s => {
                    const key = `${r.userId}:${s}`
                    const state = saving[key]
                    if (r.kind !== 'member') {
                      return <td key={s} className="px-3 py-2.5 text-xs text-text-tertiary">{r.kind === 'admin' ? t.manage : '—'}</td>
                    }
                    return (
                      <td key={s} className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <select value={r.levels[s] || ''} onChange={e => change(r, s, e.target.value)} disabled={state === 'busy'}
                            aria-label={`${r.name}: ${label(s)}`}
                            className="rounded-md border border-border bg-white px-2 py-1 text-xs text-text focus:outline-none focus:border-stone-400 focus:ring-2 focus:ring-stone-200">
                            {Object.entries(t.levels).map(([v, x]) => <option key={v} value={v}>{x}</option>)}
                          </select>
                          {state === 'busy' && <Spinner size="sm" />}
                          {state === 'done' && <span className="text-[11px] text-green-700" aria-live="polite">{t.saved}</span>}
                          {state?.startsWith?.('error:') && <span className="text-[11px] text-red-600" dir="auto">{state.slice(6)}</span>}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={GRANTABLE.length + 1} className="px-3 py-6 text-center text-xs text-text-tertiary">{t.nobody}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
