import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { LINK_KINDS, docState, parseAlertDays, riyadhToday, typeName, typeProblems } from '../../lib/documents/logic'
import { fetchDocuments, saveType, suggestTypes } from '../../lib/documents/client'
import { DW } from './words'
import { useDocumentsBase, field } from './useDocumentsBase'
import { Dialog, Field, NoAccess } from './parts'

// ─── Documents → Document types and alerts (v2) ────────────────────────────
// 2026-10-29, dev/erp-pilot/DOCUMENTS.md. His types screen: the company's
// list, each with its names in both languages, the links it allows, the
// fields a confirmed document must have, the alert days before the expiry
// and when a renewal task opens, whether the company must hold one, whether
// it is confidential by default, and whether it is active. A type in use is
// stopped, never deleted. "Add the missing suggested types" brings back what
// was removed without touching what was edited. These are the company's
// data: nothing here is a constant in the code.

const REQUIRED_FIELDS = [['number_required', 'number'], ['issuer_required', 'issuer'], ['issue_date_required', 'issue_date'], ['expiry_required', 'expiry_date']]

const blank = () => ({
  name: '', name_en: '', link_kinds: ['company'], number_required: false, issuer_required: false, issue_date_required: false, expiry_required: false,
  alert_days_text: '', task_days_before: '', is_required: false, confidential_default: false, is_active: true,
})
const fromType = t => ({ ...t, name_en: t.name_en || '', alert_days_text: (t.alert_days || []).join(', '), task_days_before: t.task_days_before ?? '' })

function TypeForm({ initial, ws, types, nextSequence, onDone, onCancel }) {
  const { t: w, dir } = useT(DW)
  const [f, setF] = useState(initial)
  const [errors, setErrors] = useState({})
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); setMsg('') }
  const toggleKind = k => set('link_kinds', f.link_kinds.includes(k) ? f.link_kinds.filter(x => x !== k) : [...f.link_kinds, k])

  async function submit(e) {
    e.preventDefault()
    const p = typeProblems(f, { names: types, ownId: initial.id || null })
    if (Object.keys(p).length) {
      setErrors(Object.fromEntries(Object.entries(p).map(([k, c]) => [k, w.typeErrors[c] || c])))
      return
    }
    setBusy(true)
    const out = await saveType(ws, initial.id || null, { ...f, alert_days: parseAlertDays(f.alert_days_text), nextSequence })
    setBusy(false)
    if (out.error) { setMsg(out.error); return }
    onDone(initial.id ? w.saved : w.typeAdded)
  }

  return (
    <form onSubmit={submit} className="space-y-3" dir={dir}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={`${w.tName} *`} error={errors.name}><input value={f.name} onChange={e => set('name', e.target.value)} maxLength={120} className={field} dir="auto" required /></Field>
        <Field label={w.tNameEn}><input value={f.name_en} onChange={e => set('name_en', e.target.value)} maxLength={120} className={field} dir="ltr" /></Field>
      </div>
      <div>
        <span className="text-[11px] text-text-secondary">{w.tLinks} *</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          {LINK_KINDS.map(k => <label key={k} className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={f.link_kinds.includes(k)} onChange={() => toggleKind(k)} />{w.links[k]}</label>)}
        </div>
        {errors.link_kinds && <p className="text-[11px] text-red-600 mt-0.5">{errors.link_kinds}</p>}
      </div>
      <div>
        <span className="text-[11px] text-text-secondary">{w.tFields}</span>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
          {REQUIRED_FIELDS.map(([flag, name]) => <label key={flag} className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={f[flag]} onChange={e => set(flag, e.target.checked)} />{w.fieldWord[name]}</label>)}
        </div>
        <p className="text-[11px] text-text-tertiary mt-0.5">{w.tFieldsHint}</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label={w.tAlerts} error={errors.alert_days} hint={w.tAlertsHint}><input value={f.alert_days_text} onChange={e => set('alert_days_text', e.target.value)} maxLength={60} className={field} dir="ltr" placeholder="90, 30, 7" /></Field>
        <Field label={w.tTask} error={errors.task_days} hint={w.tTaskHint}><input type="number" min={0} max={1000} value={f.task_days_before} onChange={e => set('task_days_before', e.target.value)} className={field} dir="ltr" placeholder="30" /></Field>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <label className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={f.is_required} onChange={e => set('is_required', e.target.checked)} />{w.tRequired}</label>
        <label className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={f.confidential_default} onChange={e => set('confidential_default', e.target.checked)} />{w.tConfidential}</label>
        <label className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={f.is_active} onChange={e => set('is_active', e.target.checked)} />{w.tActive}</label>
      </div>
      {msg && <p className="text-xs text-red-600" dir="auto" role="alert">{msg}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{initial.id ? w.tSave : w.tAdd}</Button>
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel}>{w.cancel}</Button>}
      </div>
    </form>
  )
}

export function DocumentTypes() {
  const { sectionLevel } = useAuth()
  const level = sectionLevel('documents')
  const { t: w, lang, dir } = useT(DW)
  const base = useDocumentsBase()
  const { ws, typesById } = base
  const [docs, setDocs] = useState(null)
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [msg, setMsg] = useState({ ok: '', error: '' })
  const [busy, setBusy] = useState(false)
  const today = riyadhToday()

  useEffect(() => {
    if (!ws) return
    fetchDocuments(ws).then(r => setDocs(r.rows))
  }, [ws])

  const types = base.base?.types
  // Documents in use per type, and whether the company holds one in force (his "present").
  const stats = useMemo(() => {
    const s = {}
    for (const d of docs || []) {
      const x = (s[d.type_id] ||= { count: 0, held: false })
      if (!d.archived_at) x.count += 1
      if (d.confirmed_at && !d.archived_at && ['valid', 'expiring', 'no_expiry'].includes(docState(d, typesById[d.type_id], today))) x.held = true
    }
    return s
  }, [docs, typesById, today])

  if (!level) return <NoAccess />
  if (level === 'view') return <NoAccess />
  if (!types) return <div className="max-w-6xl"><Skeleton className="h-64" /></div>
  const nextSequence = Math.max(0, ...types.map(t => t.sequence || 0)) + 10

  async function suggest() {
    setBusy(true)
    const out = await suggestTypes(ws)
    setBusy(false)
    if (out.error) { setMsg({ ok: '', error: out.error }); return }
    setMsg({ ok: w.suggestDone(out.added), error: '' })
    base.reload()
  }
  const done = text => { setEditing(null); setAdding(false); setMsg({ ok: text, error: '' }); base.reload() }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.typesTitle} subtitle={w.typesSubtitle}>
        <Button size="sm" variant="secondary" onClick={suggest} disabled={busy}>{w.suggestBtn}</Button>
        <Button size="sm" onClick={() => setAdding(true)}>{w.newType}</Button>
      </PageHeader>
      {(msg.ok || msg.error || base.error) && <p className={`text-xs ${msg.ok ? 'text-emerald-700' : 'text-red-600'}`} dir="auto" role="alert">{msg.ok || msg.error || base.error}</p>}

      <div className="bg-white border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
            {['type', 'links', 'fields', 'alerts', 'task', 'required', 'docs'].map(c => <th key={c} className="text-start font-medium px-3 py-2">{w.tCols[c]}</th>)}
            <th />
          </tr></thead>
          <tbody className="divide-y divide-border">
            {types.map(t => {
              const required = REQUIRED_FIELDS.filter(([flag]) => t[flag]).map(([, name]) => w.fieldWord[name])
              return (
                <tr key={t.id} className={`align-top ${t.is_active ? '' : 'text-text-tertiary'}`}>
                  <td className="px-3 py-2">
                    <bdi>{typeName(t, lang)}</bdi>
                    {t.code && <span className="ms-1.5 text-[10px] rounded border border-border px-1 py-px">{w.suggested}</span>}
                    {!t.is_active && <span className="ms-1.5 text-[10px] rounded border border-stone-300 bg-stone-100 px-1 py-px">{w.stopped}</span>}
                    {t.confidential_default && <div className="text-[11px] text-text-tertiary">{w.confidentialDefault}</div>}
                  </td>
                  <td className="px-3 py-2">{t.link_kinds.map(k => w.links[k]).join('، ')}</td>
                  <td className="px-3 py-2">{required.join('، ') || '—'}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{t.alert_days?.length ? t.alert_days.join(', ') : '—'}</td>
                  <td className="px-3 py-2 tabular-nums" dir="ltr">{t.task_days_before ?? '—'}</td>
                  <td className="px-3 py-2">{t.is_required ? (stats[t.id]?.held ? `✓ ${w.held}` : <span className="text-red-700">{w.missingShort}</span>) : '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{stats[t.id]?.count || 0}</td>
                  <td className="px-3 py-2"><Button size="xs" variant="secondary" onClick={() => setEditing(t)}>{w.edit}</Button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && <Dialog title={typeName(editing, lang)} onClose={() => setEditing(null)} wide><TypeForm initial={fromType(editing)} ws={ws} types={types} nextSequence={nextSequence} onDone={done} onCancel={() => setEditing(null)} /></Dialog>}
      {adding && <Dialog title={w.newType} onClose={() => setAdding(false)} wide><TypeForm initial={blank()} ws={ws} types={types} nextSequence={nextSequence} onDone={done} onCancel={() => setAdding(false)} /></Dialog>}
    </div>
  )
}
