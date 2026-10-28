import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import {
  ROLES, validateOrg, validatePerson, needsAddress, findDuplicates, emptyOrg, emptyPerson,
  displayName, csvToOrgs, CSV_TEMPLATE,
} from '../../lib/contacts/logic'
import { importOrgs } from '../../lib/contacts/client'
import { CW, ROLE_NAMES } from './words'
import { field } from './useContactsBook'

// ─── Contacts: the pieces the pages share ──────────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. The dialog, role badges, the
// organisation and person forms (with the duplicate guard as you type) and
// the CSV import. The database has the last word on every rule; these say
// it first, next to the field.

export function Dialog({ title, onClose, children, wide = false }) {
  const { lang, dir } = useT(CW)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div dir={dir} lang={lang} className={`relative w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[88vh] overflow-y-auto bg-white border border-border rounded-xl shadow-dropdown p-5 animate-fade-scale`}>
        <h2 className="text-sm font-semibold text-text mb-3">{title}</h2>
        {children}
      </div>
    </div>
  )
}

const ROLE_TONE = {
  client: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  supplier: 'bg-sky-50 text-sky-800 border-sky-200',
  main_contractor: 'bg-amber-50 text-amber-900 border-amber-200',
  subcontractor: 'bg-orange-50 text-orange-800 border-orange-200',
  consultant: 'bg-violet-50 text-violet-800 border-violet-200',
  sister_company: 'bg-stone-100 text-stone-700 border-stone-300',
}

export function RoleBadges({ roles = [] }) {
  const { t: w } = useT(CW)
  if (!roles.length) return <span className="text-text-tertiary">—</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {roles.map(r => <span key={r} className={`text-[11px] leading-4 px-1.5 py-px rounded border whitespace-nowrap ${ROLE_TONE[r] || ''}`}>{w.roles[r] || r}</span>)}
    </span>
  )
}

function Field({ label, error, help, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-[11px] text-text-secondary">{label}</span>
      {children}
      {error ? <span className="block text-[11px] text-red-600 mt-0.5">{error}</span>
        : help ? <span className="block text-[11px] text-text-tertiary mt-0.5">{help}</span> : null}
    </label>
  )
}

/** What looks like this organisation already: blocking (same VAT/CR) or a warning (similar name). */
export function Duplicates({ found, onOpen }) {
  const { t: w, lang } = useT(CW)
  if (!found.length) return null
  const blocking = found.some(d => d.blocking)
  return (
    <div className={`rounded-md border px-3 py-2 text-xs ${blocking ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`} role="status">
      <p className="font-medium">{blocking ? w.dupBlocking : w.dupSimilar}</p>
      <ul className="mt-1 space-y-0.5">
        {found.slice(0, 5).map(d => (
          <li key={d.org.id} className="flex flex-wrap gap-x-2">
            <span dir="auto" className="font-medium">{displayName(d.org, lang)}</span>
            <span className="opacity-80">({d.reasons.map(r => w.dupReasons[r]).join(lang === 'ar' ? '، ' : ', ')})</span>
            {d.org.line ? <span className="opacity-80">{w.dupLine(d.org.line)}</span>
              : <Link to={`/contacts/org?id=${d.org.id}`} onClick={onOpen} className="underline">{w.dupOpen}</Link>}
            {d.org.status === 'archived' && <span className="opacity-80">· {w.archivedTag}</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * An organisation's fields. `orgs`: the company's organisations, for the
 * duplicate guard; `selfId` when editing. onSubmit(fields) → { error? }.
 */
export function OrgForm({ initial = null, orgs = [], selfId = '', onSubmit, onCancel }) {
  const { t: w, lang, dir } = useT(CW)
  const [f, setF] = useState(() => ({ ...emptyOrg(), ...(initial || {}), roles: initial?.roles || [] }))
  const [tried, setTried] = useState(false)
  const [confirmSimilar, setConfirmSimilar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setConfirmSimilar(false) }
  const toggleRole = r => set('roles', f.roles.includes(r) ? f.roles.filter(x => x !== r) : [...f.roles, r])

  const errors = validateOrg(f)
  const shown = tried ? errors : {}
  const err = k => (shown[k] ? w.errors[shown[k]] : '')
  const dups = useMemo(() => findDuplicates(f, orgs, selfId), [f, orgs, selfId])
  const blocking = dups.some(d => d.blocking)
  const similar = dups.length > 0 && !blocking
  const address = needsAddress(f)

  async function submit(e) {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) { setError(w.fixFields); return }
    if (blocking) return
    if (similar && !confirmSimilar) { setConfirmSimilar(true); return }
    setBusy(true); setError('')
    const out = await onSubmit(f)
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  const text = (k, label, props = {}) => (
    <Field label={label} error={err(k)} help={props.help} className={props.className}>
      <input value={f[k] || ''} onChange={e => set(k, e.target.value)} className={field} dir={props.dir || 'auto'} inputMode={props.inputMode} autoFocus={props.autoFocus} aria-invalid={Boolean(err(k))} />
    </Field>
  )

  return (
    <form onSubmit={submit} className="space-y-4" dir={dir} lang={lang} noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={w.kind}>
          <select value={f.kind} onChange={e => set('kind', e.target.value)} className={field}>
            <option value="company">{w.kinds.company}</option>
            <option value="individual">{w.kinds.individual}</option>
          </select>
        </Field>
        <div className="hidden sm:block" />
        {text('name', w.name, { autoFocus: true })}
        {text('name_ar', w.nameAr, { dir: 'rtl' })}
      </div>

      <fieldset>
        <legend className="text-[11px] text-text-secondary">{w.rolesLabel}</legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {ROLES.map(r => (
            <label key={r} className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border cursor-pointer select-none ${f.roles.includes(r) ? 'border-stone-900 bg-stone-900 text-white' : 'border-border text-text hover:border-stone-400'}`}>
              <input type="checkbox" className="sr-only" checked={f.roles.includes(r)} onChange={() => toggleRole(r)} />
              {w.roles[r]}
            </label>
          ))}
        </div>
        <p className="text-[11px] text-text-tertiary mt-1">{err('roles') || w.rolesHelp}</p>
      </fieldset>

      <section>
        <h3 className="text-xs font-semibold text-text-secondary mb-1.5">{w.registration}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {text('vat_number', w.vat, { dir: 'ltr', inputMode: 'numeric', help: w.vatHelp })}
          {text('cr_number', w.cr, { dir: 'ltr' })}
          {text('country', w.country, { dir: 'ltr', help: w.countryHelp })}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-text-secondary mb-0.5">{w.nationalAddress}</h3>
        <p className={`text-[11px] mb-1.5 ${address ? 'text-amber-800' : 'text-text-tertiary'}`}>{w.addressHelp}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {text('nat_building_no', w.building, { dir: 'ltr', inputMode: 'numeric' })}
          {text('nat_street', w.street, { className: 'col-span-2 sm:col-span-2' })}
          {text('nat_district', w.district)}
          {text('city', w.city)}
          {text('nat_postal_code', w.postal, { dir: 'ltr', inputMode: 'numeric' })}
          {text('nat_additional_no', w.additional, { dir: 'ltr', inputMode: 'numeric' })}
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold text-text-secondary mb-1.5">{w.reach}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {text('phone', w.phone, { dir: 'ltr', inputMode: 'tel' })}
          {text('email', w.email, { dir: 'ltr', inputMode: 'email' })}
          {text('website', w.website, { dir: 'ltr' })}
        </div>
      </section>

      <Field label={w.notesLabel}>
        <textarea value={f.notes || ''} onChange={e => set('notes', e.target.value)} rows={3} className={field} dir="auto" />
      </Field>

      <Duplicates found={dups} onOpen={onCancel} />
      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>{w.cancel}</Button>
        <Button type="submit" size="sm" disabled={busy || blocking}>
          {busy ? w.saving : confirmSimilar ? w.saveAnyway : selfId ? w.save : w.add}
        </Button>
      </div>
    </form>
  )
}

/** A contact person's fields. `orgs`: the organisations they can be put under (active ones). */
export function PersonForm({ initial = null, orgs = [], lockOrg = false, onSubmit, onCancel }) {
  const { t: w, lang, dir } = useT(CW)
  const [p, setP] = useState(() => ({ ...emptyPerson(), ...(initial || {}), org_id: initial?.org_id || '' }))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setP(x => ({ ...x, [k]: v }))
  const errors = validatePerson(p)
  const err = k => (tried && errors[k] ? w.errors[errors[k]] : '')

  async function submit(e) {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) { setError(w.fixFields); return }
    setBusy(true); setError('')
    const out = await onSubmit(p)
    setBusy(false)
    if (out?.error) setError(out.error)
  }

  const choices = [...orgs].sort((a, b) => displayName(a, lang).localeCompare(displayName(b, lang), lang))
  return (
    <form onSubmit={submit} className="space-y-3" dir={dir} lang={lang} noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={w.personName} error={err('name')}>
          <input autoFocus value={p.name} onChange={e => set('name', e.target.value)} className={field} dir="auto" aria-invalid={Boolean(err('name'))} />
        </Field>
        <Field label={w.personNameAr}>
          <input value={p.name_ar || ''} onChange={e => set('name_ar', e.target.value)} className={field} dir="rtl" />
        </Field>
        <Field label={w.jobTitle}>
          <input value={p.job_title || ''} onChange={e => set('job_title', e.target.value)} className={field} dir="auto" />
        </Field>
        <Field label={w.org}>
          <select value={p.org_id} onChange={e => set('org_id', e.target.value)} className={field} disabled={lockOrg}>
            <option value="">{w.noOrg}</option>
            {choices.map(o => <option key={o.id} value={o.id}>{displayName(o, lang)}</option>)}
          </select>
        </Field>
        <Field label={w.phone}>
          <input value={p.phone || ''} onChange={e => set('phone', e.target.value)} className={field} dir="ltr" inputMode="tel" />
        </Field>
        <Field label={w.email} error={err('email')}>
          <input value={p.email || ''} onChange={e => set('email', e.target.value)} className={field} dir="ltr" inputMode="email" />
        </Field>
      </div>
      {p.org_id && (
        <label className="flex items-center gap-2 text-xs text-text">
          <input type="checkbox" checked={Boolean(p.is_primary)} onChange={e => set('is_primary', e.target.checked)} />
          {w.isPrimary}
        </label>
      )}
      <Field label={w.notesLabel}>
        <textarea value={p.notes || ''} onChange={e => set('notes', e.target.value)} rows={2} className={field} dir="auto" />
      </Field>
      {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>{w.cancel}</Button>
        <Button type="submit" size="sm" disabled={busy}>{busy ? w.saving : initial?.id ? w.save : w.add}</Button>
      </div>
    </form>
  )
}

/**
 * Import organisations from a CSV file: read it here, show every line with
 * what is wrong, send the ready ones. Rows with a similar name stay out
 * unless ticked in.
 */
export function ImportDialog({ ws, orgs = [], onClose, onDone }) {
  const { t: w, lang } = useT(CW)
  const [text, setText] = useState('')
  const [withSimilar, setWithSimilar] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, failed: [{ line, name, error }] } | { error }

  const parsed = useMemo(() => (text.trim() ? csvToOrgs(text, orgs, ROLE_NAMES) : null), [text, orgs])
  const status = r => (Object.keys(r.errors).length ? 'bad' : r.duplicates.some(d => d.blocking) ? 'dup' : r.duplicates.length ? 'similar' : 'ready')
  const ready = (parsed?.rows || []).filter(r => status(r) === 'ready' || (withSimilar && status(r) === 'similar'))
  const bad = (parsed?.rows.length || 0) - ready.length

  function readFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result || '')); setResult(null) }
    reader.readAsText(file)
  }

  function template() {
    const example = '"Example Co (test)","شركة مثال (تجربة)",company,"client;consultant",,,Riyadh,,,,,,+966 11 000 0000,info@example.test,example.test,'
    const blob = new Blob([`\uFEFF${CSV_TEMPLATE}\n${example}\n`], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'contacts-template.csv'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function run() {
    setBusy(true)
    const out = await importOrgs(ws, ready.map(r => r.fields))
    setBusy(false)
    if (out.error) { setResult({ error: out.error }); return }
    const failed = out.results.filter(r => r.error).map(r => ({ line: ready[r.line_no - 1]?.line, name: ready[r.line_no - 1]?.fields.name, error: r.error }))
    setResult({ ok: out.results.length - failed.length, failed })
    onDone()
  }

  const problem = r => {
    const s = status(r)
    if (s === 'bad') return Object.entries(r.errors).map(([k, code]) => `${w.fieldNames[k] || k}: ${w.errors[code] || code}`).join(' · ')
    if (s === 'dup') return `${w.dupReasons[r.duplicates[0].reasons[0]]}: ${displayName(r.duplicates[0].org, lang) || w.dupLine(r.duplicates[0].org.line)}`
    if (s === 'similar') return `${w.willWarn}: ${displayName(r.duplicates[0].org, lang) || w.dupLine(r.duplicates[0].org.line)}`
    return w.ready
  }

  return (
    <Dialog title={w.importTitle} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-text-secondary">{w.importIntro}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={template}>{w.template}</Button>
          <label className="text-xs inline-flex items-center gap-2">
            <span className="text-text-secondary">{w.chooseFile}</span>
            <input type="file" accept=".csv,text/csv" onChange={readFile} className="text-xs" />
          </label>
        </div>
        <textarea value={text} onChange={e => { setText(e.target.value); setResult(null) }} rows={4} className={`${field} font-mono text-xs`} placeholder={w.orPaste} dir="ltr" aria-label={w.orPaste} />

        {parsed && (
          <>
            {parsed.ignored.length > 0 && <p className="text-[11px] text-amber-800">{w.ignoredCols(parsed.ignored.join(', '))}</p>}
            <p className="text-xs text-text">{w.preview(ready.length, bad)}</p>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={withSimilar} onChange={e => setWithSimilar(e.target.checked)} />
              {w.includeSimilar}
            </label>
            <div className="border border-border max-h-64 overflow-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  <th className="text-start font-medium px-2 py-1.5">{w.line}</th>
                  <th className="text-start font-medium px-2 py-1.5">{w.cols.name}</th>
                  <th className="text-start font-medium px-2 py-1.5">{w.cols.roles}</th>
                  <th className="text-start font-medium px-2 py-1.5">{w.problem}</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {parsed.rows.map(r => {
                    const s = status(r)
                    return (
                      <tr key={r.line}>
                        <td className="px-2 py-1.5 tabular-nums text-text-tertiary">{r.line}</td>
                        <td className="px-2 py-1.5" dir="auto">{r.fields.name || r.fields.name_ar}</td>
                        <td className="px-2 py-1.5"><RoleBadges roles={r.fields.roles} /></td>
                        <td className={`px-2 py-1.5 ${s === 'ready' ? 'text-emerald-700' : s === 'similar' ? 'text-amber-800' : 'text-red-700'}`}>{problem(r)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {result?.error && <p className="text-xs text-red-600" dir="auto">{result.error}</p>}
        {result && !result.error && (
          <div className="text-xs space-y-1">
            <p className="text-emerald-700 font-medium">{w.imported(result.ok, result.failed.length)}</p>
            {result.failed.map(f => <p key={f.line} className="text-red-700" dir="auto">{w.line} {f.line} · {f.name}: {f.error}</p>)}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>{w.close}</Button>
          {!result && <Button size="sm" onClick={run} disabled={busy || !ready.length}>{busy ? w.importing : ready.length ? w.importN(ready.length) : w.nothingToImport}</Button>}
        </div>
      </div>
    </Dialog>
  )
}
