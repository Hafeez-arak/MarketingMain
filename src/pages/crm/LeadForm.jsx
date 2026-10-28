import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { emptyLead, validateLead, listName, orgName, TAG_COLORS } from '../../lib/crm/logic'
import { fetchLead, fetchLeadTags, createLead, updateLead, errorText } from '../../lib/crm/client'
import { RW } from './words'
import { useCrmBase, field, leadHref } from './useCrmBase'
import { Field, NoAccess } from './parts'

// ─── CRM → New / edit opportunity (v2) ─────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Musa's opportunity form, his sections in
// his order: the title and priority; who it is with (a registered client,
// an organisation or a contact: one is enough); the consultant and the
// project's owner; the tender; the follow-up (stage, source, owner, dates,
// value, probability); tags; notes. Opened from "+ New" (with a stage from
// a pipeline column, or a client from its Contacts page) and from Edit. A
// closed opportunity is not edited (his rule; the database refuses too).

const byOrder = (a, b) => (a.sequence - b.sequence) || String(a.created_at).localeCompare(String(b.created_at))

export function CrmLeadForm() {
  const { canSection, user } = useAuth()
  const { t: w, lang, dir } = useT(RW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const { ws, base, clientsById, error: baseError } = useCrmBase()
  const [initial, setInitial] = useState(id ? undefined : null) // undefined loading · null new · row editing
  const [f, setF] = useState(null)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Editing: the opportunity and its tags.
  useEffect(() => {
    if (!ws || !id) return
    let off = false
    Promise.all([fetchLead(ws, id), fetchLeadTags(ws, { leadId: id })]).then(([l, t]) => {
      if (off) return
      setInitial(l.lead ? { ...l.lead, tag_ids: t.rows.map(r => r.tag_id) } : false)
      if (l.error) setError(l.error)
    })
    return () => { off = true }
  }, [ws, id])

  // The form's starting values, once what it needs has loaded.
  useEffect(() => {
    if (!base || f || initial === undefined) return
    if (initial) {
      const start = { ...emptyLead(), ...initial }
      for (const k of Object.keys(start)) if (start[k] === null) start[k] = ''
      queueMicrotask(() => setF(start))
      return
    }
    const stage = params.get('stage')
    const firstStage = base.stages.filter(s => s.is_active).sort(byOrder)[0]
    const client = clientsById[params.get('client')]
    const me = base.people.some(p => p.user_id === user?.id) ? user.id : ''
    queueMicrotask(() => setF({
      ...emptyLead(),
      stage_id: base.stages.some(s => s.id === stage && s.is_active) ? stage : firstStage?.id || '',
      assigned_to: me,
      ...(client && client.status === 'active' ? {
        client_org_id: client.id, organization: orgName(client, lang), phone: client.phone || '', email: client.email || '', city: client.city || '',
      } : {}),
    }))
  }, [base, initial, f, params, clientsById, user?.id, lang])

  const options = useMemo(() => {
    if (!base) return null
    const keep = (rows, cur) => rows.filter(r => r.is_active || r.id === cur)
    return {
      stages: keep(base.stages, initial?.stage_id).sort(byOrder),
      sources: keep(base.sources, initial?.source_id).sort((a, b) => listName(a, lang).localeCompare(listName(b, lang))),
      tags: base.tags.filter(t => t.is_active || initial?.tag_ids?.includes(t.id)).sort((a, b) => listName(a, lang).localeCompare(listName(b, lang))),
      clients: base.clients.filter(c => c.status === 'active' || c.id === initial?.client_org_id)
        .sort((a, b) => orgName(a, lang).localeCompare(orgName(b, lang))),
    }
  }, [base, initial, lang])

  if (!canSection('crm', 'work')) return <NoAccess />
  const back = id ? leadHref(id) : '/crm'
  if (initial === false) return <p className="text-sm text-text-secondary" dir={dir}>{w.leadGone}</p>
  if (initial && initial.status !== 'open') {
    return (
      <div className="space-y-3" dir={dir} lang={lang}>
        <Link to={back} className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
        <p className="text-sm text-red-700">{errorText(initial.status === 'won' ? 'CRM_LEAD_WON' : 'CRM_LEAD_LOST', lang)}</p>
      </div>
    )
  }
  if (base && !id && !base.stages.some(s => s.is_active)) {
    return (
      <div className="space-y-3" dir={dir} lang={lang}>
        <Link to="/crm" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
        <p className="text-sm text-red-700">{w.needStagesFirst}</p>
        {canSection('crm', 'manage') && <Link to="/crm/settings" className="text-xs underline">{w.settingsLink}</Link>}
      </div>
    )
  }
  if (!f || !options) return <Skeleton className="h-96 max-w-4xl" />

  const errors = validateLead(f)
  const err = k => (tried && errors[k] ? w.errors[errors[k]] : '')
  const set = (k, v) => setF(x => ({ ...x, [k]: v }))
  const toggleTag = t => set('tag_ids', f.tag_ids.includes(t) ? f.tag_ids.filter(x => x !== t) : [...f.tag_ids, t])

  async function submit(e) {
    e.preventDefault()
    setTried(true)
    if (Object.keys(errors).length) { setError(w.fixFields); return }
    setBusy(true); setError('')
    const out = id ? await updateLead(ws, id, f) : await createLead(ws, f)
    setBusy(false)
    if (out.error && !out.lead) { setError(out.error); return }
    navigate(leadHref(out.lead.id))
  }

  const text = (k, label, props = {}) => (
    <Field label={label} error={err(k)} hint={props.hint} className={props.className}>
      <input type={props.type || 'text'} value={f[k] ?? ''} onChange={e => set(k, e.target.value)} className={field} dir={props.dir || 'auto'}
        placeholder={props.placeholder} inputMode={props.inputMode} autoFocus={props.autoFocus} aria-invalid={Boolean(err(k))}
        min={props.min} max={props.max} step={props.step} />
    </Field>
  )
  const h2 = s => <h2 className="text-xs font-semibold text-text-secondary">{s}</h2>

  return (
    <form onSubmit={submit} className="max-w-4xl space-y-4" dir={dir} lang={lang} noValidate>
      <Link to={back} className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
      <h1 className="text-lg font-semibold text-text">{id ? w.editTitle : w.newTitle}{id && initial?.lead_no && <span className="text-sm font-normal text-text-tertiary ms-2"><bdi dir="ltr">{initial.lead_no}</bdi></span>}</h1>

      <section className="bg-white border border-border p-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('title', `${w.fTitle} *`, { autoFocus: true, placeholder: w.fTitlePh })}
          <fieldset>
            <legend className="text-[11px] text-text-secondary">{w.priority}</legend>
            <div className="mt-1 inline-flex border border-border rounded-md overflow-hidden" role="radiogroup" aria-label={w.priority}>
              {[0, 1, 2, 3].map(n => (
                <label key={n} className={`text-xs px-3 py-1.5 cursor-pointer ${Number(f.priority) === n ? 'bg-stone-900 text-white' : 'bg-white text-text hover:bg-stone-50'}`}>
                  <input type="radio" name="priority" className="sr-only" checked={Number(f.priority) === n} onChange={() => set('priority', n)} />
                  {n ? '★'.repeat(n) : w.normal}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {h2(w.party)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={w.registeredClient}>
            <select value={f.client_org_id} onChange={e => set('client_org_id', e.target.value)} className={field}>
              <option value="">{w.notClientYet}</option>
              {options.clients.map(c => <option key={c.id} value={c.id}>{orgName(c, lang)} ({c.contact_no})</option>)}
            </select>
          </Field>
          {text('organization', w.f.organization)}
          {text('contact_name', w.f.contact)}
          {text('phone', w.f.phone, { dir: 'ltr', inputMode: 'tel' })}
          {text('email', w.f.email, { dir: 'ltr', inputMode: 'email' })}
          {text('city', w.f.city)}
        </div>
        <p className="text-[11px] text-text-tertiary">{w.partyHint}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('consultant', w.f.consultant, { placeholder: w.consultantPh, hint: w.consultantHint })}
          {text('project_owner', w.f.owner, { placeholder: w.ownerPh })}
        </div>

        {h2(w.tender)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {text('bid_due_date', w.f.bidDate, { type: 'date', dir: 'ltr', hint: w.bidHint })}
          {text('tender_ref', w.f.tenderRef, { placeholder: w.tenderPh })}
        </div>

        {h2(w.followUp)}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={`${w.stage} *`} error={err('stage_id')}>
            <select value={f.stage_id} onChange={e => set('stage_id', e.target.value)} className={field}>
              {!f.stage_id && <option value="" />}
              {options.stages.map(s => <option key={s.id} value={s.id}>{listName(s, lang)}</option>)}
            </select>
          </Field>
          <Field label={w.source}>
            <select value={f.source_id} onChange={e => set('source_id', e.target.value)} className={field}>
              <option value="">—</option>
              {options.sources.map(s => <option key={s.id} value={s.id}>{listName(s, lang)}</option>)}
            </select>
          </Field>
          <Field label={w.f.assignee}>
            <select value={f.assigned_to} onChange={e => set('assigned_to', e.target.value)} className={field}>
              <option value="">{w.noOwnerOpt}</option>
              {base.people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
            </select>
          </Field>
          {text('expected_close_date', w.f.closeDate, { type: 'date', dir: 'ltr' })}
          {text('expected_revenue', w.valueLabel, { type: 'number', dir: 'ltr', inputMode: 'decimal', min: 0, step: '0.01', hint: w.valueHint })}
          {text('probability', w.probabilityLabel, { type: 'number', dir: 'ltr', inputMode: 'numeric', min: 0, max: 100, step: 1, hint: w.probabilityHint })}
        </div>

        <fieldset>
          <legend className="text-[11px] text-text-secondary">{w.tags}</legend>
          {!options.tags.length ? <p className="text-[11px] text-text-tertiary mt-1">{w.noTags}</p> : (
            <div className="mt-1 flex flex-wrap gap-1.5">
              {options.tags.map(t => {
                const on = f.tag_ids.includes(t.id)
                const c = TAG_COLORS[t.color] || TAG_COLORS[0]
                return (
                  <label key={t.id} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md border cursor-pointer select-none"
                    style={on ? { background: c, borderColor: c, color: '#fff' } : { borderColor: `${c}66`, color: c }}>
                    <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleTag(t.id)} />
                    <bdi>{listName(t, lang)}</bdi>
                  </label>
                )
              })}
            </div>
          )}
        </fieldset>

        <Field label={w.notesField} error={err('notes')}>
          <textarea value={f.notes} onChange={e => set('notes', e.target.value)} rows={3} className={field} dir="auto" />
        </Field>
      </section>

      {(error || baseError) && <p className="text-xs text-red-600" dir="auto" role="alert">{error || baseError}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>{busy ? w.saving : w.save}</Button>
        <Button variant="secondary" size="sm" onClick={() => navigate(back)}>{w.cancel}</Button>
      </div>
    </form>
  )
}
