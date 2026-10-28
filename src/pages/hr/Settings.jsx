import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, PageHeader, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf } from '../../lib/hr/logic'
import { fetchLeaveTypes, saveLeaveType } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field } from './useHrBase'
import { Dialog, ErrorText, Field, Pill } from './parts'

// ─── HR → Settings (v2) ────────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. Manage only (lib/modules.js and the
// database): the company's leave types. The working days and hours moved
// to Attendance → Records with the rest of attendance's settings, where
// Musa keeps them (dev/erp-pilot/ATTENDANCE.md).

export function HrSettings() {
  const { t, lang, dir } = useT(HW)
  const { ws } = useHrBase()
  const [types, setTypes] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    if (!ws) return
    const ty = await fetchLeaveTypes(ws)
    setTypes(ty.rows); setError(ty.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  return (
    <div className="max-w-3xl space-y-5" dir={dir} lang={lang}>
      <PageHeader title={t.settingsTitle} subtitle={t.settingsSubtitle} />
      <ErrorText error={error} />
      <p className="text-xs text-text-secondary bg-white border border-border px-4 py-3">{t.workWeekMoved} <Link to="/hr/attendance/records" className="underline">{t.attendanceTitle}</Link></p>

      <section className="bg-white border border-border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-text">{t.leaveTypes}</h2>
          <Button size="xs" variant="secondary" onClick={() => setEditing({})}>{t.newType}</Button>
        </div>
        <p className="text-[11px] text-text-tertiary">{t.typeHelp}</p>
        {types === null ? <Spinner size="sm" /> : (
          <ul className="divide-y divide-border border border-border">{types.map(ty => (
            <li key={ty.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <span className="flex-1 min-w-0 text-sm text-text">{nameOf(ty, lang)} <span className="text-[11px] text-text-tertiary" dir="auto">{nameOf(ty, lang === 'ar' ? 'en' : 'ar') !== nameOf(ty, lang) ? nameOf(ty, lang === 'ar' ? 'en' : 'ar') : ''}</span></span>
              {ty.paid && <Pill tone="green">{t.paid}</Pill>}
              {ty.needs_balance && <Pill tone="blue">{t.needsBalance}</Pill>}
              {!ty.active && <Pill>{t.archived}</Pill>}
              <Button size="xs" variant="ghost" onClick={() => setEditing(ty)}>{t.edit}</Button>
            </li>
          ))}</ul>
        )}
      </section>

      {editing && (
        <Dialog title={editing.id ? t.edit : t.newType.replace('+ ', '')} onClose={() => setEditing(null)}>
          <TypeForm initial={editing} onCancel={() => setEditing(null)} onSubmit={async f => {
            const out = await saveLeaveType(ws, editing.id, f)
            if (!out.error) { setEditing(null); load() }
            return out
          }} />
        </Dialog>
      )}
    </div>
  )
}

function TypeForm({ initial, onSubmit, onCancel }) {
  const { t, dir } = useT(HW)
  const [f, setF] = useState({
    name_ar: initial.name_ar || '', name_en: initial.name_en || '',
    paid: initial.paid ?? true, needs_balance: initial.needs_balance ?? true, active: initial.active ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  return (
    <form dir={dir} className="space-y-3" onSubmit={async e => {
      e.preventDefault()
      if (!f.name_en.trim() && !f.name_ar.trim()) { setError(t.nameNeeded); return }
      setBusy(true); setError('')
      const out = await onSubmit(f); setBusy(false)
      if (out?.error) setError(out.error)
    }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Field label={t.nameAr}><input value={f.name_ar} onChange={e => set('name_ar', e.target.value)} className={field} dir="rtl" lang="ar" /></Field>
        <Field label={t.nameEn}><input value={f.name_en} onChange={e => set('name_en', e.target.value)} className={field} dir="ltr" lang="en" /></Field>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        {[['paid', t.paid], ['needs_balance', t.needsBalance], ['active', t.active]].map(([k, label]) => {
          // Whether a type is paid / keeps a balance is fixed once it exists (his screen, and the database).
          const locked = Boolean(initial.id) && k !== 'active'
          return (
            <label key={k} className="flex items-center gap-2" title={locked ? t.typeLocked : undefined}>
              <input type="checkbox" checked={f[k]} disabled={locked} onChange={e => set(k, e.target.checked)} />{label}
            </label>
          )
        })}
      </div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
