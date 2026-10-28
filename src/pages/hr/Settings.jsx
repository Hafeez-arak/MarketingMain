import { useCallback, useEffect, useState } from 'react'
import { Button, PageHeader, Skeleton, Spinner } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { nameOf, hhmm } from '../../lib/hr/logic'
import { fetchSettings, saveSettings, fetchLeaveTypes, saveLeaveType } from '../../lib/hr/client'
import { HW } from './words'
import { useHrBase, field } from './useHrBase'
import { Dialog, ErrorText, Field, Pill } from './parts'

// ─── HR → Settings (v2) ────────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/HR.md. Manage only (lib/modules.js and the
// database): the work week the attendance sheets count against, and the
// company's leave types. Nothing is assumed: an empty work week means
// "unknown", never "every day".

export function HrSettings() {
  const { t, lang, dir } = useT(HW)
  const { ws, me } = useHrBase()
  const [settings, setSettings] = useState(undefined)
  const [types, setTypes] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    if (!ws) return
    const [s, ty] = await Promise.all([fetchSettings(ws), fetchLeaveTypes(ws)])
    setSettings(s.row); setTypes(ty.rows); setError(s.error || ty.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  return (
    <div className="max-w-3xl space-y-5" dir={dir} lang={lang}>
      <PageHeader title={t.settingsTitle} subtitle={t.settingsSubtitle} />
      <ErrorText error={error} />
      {settings === undefined ? <Skeleton className="h-40" /> : <WorkWeek key={settings?.updated_at || 'new'} initial={settings} onSave={f => saveSettings(ws, me, f).then(out => { if (!out.error) load(); return out })} />}

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

function WorkWeek({ initial, onSave }) {
  const { t } = useT(HW)
  const [days, setDays] = useState(initial?.work_days || [])
  const [start, setStart] = useState(hhmm(initial?.work_start))
  const [end, setEnd] = useState(hhmm(initial?.work_end))
  const [grace, setGrace] = useState(initial?.grace_minutes ?? '')
  const [state, setState] = useState('') // '' | 'busy' | 'saved' | error
  const toggle = d => setDays(x => (x.includes(d) ? x.filter(y => y !== d) : [...x, d].sort()))
  return (
    <form className="bg-white border border-border p-4 space-y-3" onSubmit={async e => {
      e.preventDefault(); setState('busy')
      const out = await onSave({ work_days: days, work_start: start || null, work_end: end || null, grace_minutes: grace === '' ? null : Number(grace) })
      setState(out.error || 'saved')
    }}>
      <h2 className="text-sm font-semibold text-text">{t.workWeek}</h2>
      <p className="text-[11px] text-text-tertiary">{t.workWeekHelp}</p>
      <fieldset>
        <legend className="text-[11px] text-text-secondary mb-1">{t.workDays}</legend>
        <div className="flex flex-wrap gap-1.5">{t.weekdays.map((name, d) => (
          <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)}
            className={`rounded-md border px-2.5 py-1 text-xs ${days.includes(d) ? 'bg-stone-900 border-stone-900 text-white' : 'bg-white border-border text-text-secondary hover:bg-stone-50'}`}>{name}</button>
        ))}</div>
      </fieldset>
      <div className="grid grid-cols-3 gap-2 max-w-md">
        <Field label={t.workStart}><input type="time" value={start} onChange={e => setStart(e.target.value)} className={field} /></Field>
        <Field label={t.workEnd}><input type="time" value={end} min={start} onChange={e => setEnd(e.target.value)} className={field} /></Field>
        <Field label={t.grace}><input type="number" min="0" max="240" value={grace} onChange={e => setGrace(e.target.value)} className={field} /></Field>
      </div>
      {state && !['busy', 'saved'].includes(state) && <ErrorText error={state} />}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={state === 'busy'}>{state === 'busy' && <Spinner size="sm" />}{t.save}</Button>
        {state === 'saved' && <span className="text-[11px] text-green-700" aria-live="polite">{t.saved}</span>}
      </div>
    </form>
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
        {[['paid', t.paid], ['needs_balance', t.needsBalance], ['active', t.active]].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={f[k]} onChange={e => set(k, e.target.checked)} />{label}</label>
        ))}
      </div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.save}</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}
