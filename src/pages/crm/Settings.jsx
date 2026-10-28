import { useState } from 'react'
import { useAuth } from '../../store/auth'
import { Button, PageHeader, Skeleton } from '../../components/ui/index'
import { useT } from '../../lib/i18n'
import { LIST_KINDS, AUTO_EVENTS, TAG_COLORS, settingsOrder, nextSequence, validateListItem, listName } from '../../lib/crm/logic'
import { saveListItem, toggleListItem, suggestStages } from '../../lib/crm/client'
import { RW } from './words'
import { useCrmBase, fieldInline } from './useCrmBase'
import { NoAccess } from './parts'

// ─── CRM → Settings (v2) ───────────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Musa's CRM settings: the company's sales
// stages (with their order and the quotation-cycle event that moves an
// opportunity there), sources, loss reasons and tags (with a colour). Names
// only; an item in use is switched off, never deleted. Everyone with the
// CRM reads them; managing changes them (his crm.settings). With no stage
// yet, one click creates his five suggested ones.

const KIND_KEY = { stages: 'stages', sources: 'sources', reasons: 'reasons', tags: 'tags' }

function Row({ kind, item, items, ws, onDone }) {
  const { t: w } = useT(RW)
  const [f, setF] = useState({ ...item, name_en: item.name_en || '', auto_event: item.auto_event || '' })
  const [msg, setMsg] = useState(null) // { ok?, error? }
  const [busy, setBusy] = useState(false)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setMsg(null) }
  const errors = validateListItem(kind, { ...f, sequence: kind === 'stages' ? f.sequence : '' }, items)

  async function save(e) {
    e.preventDefault()
    if (Object.keys(errors).length) { setMsg({ error: Object.entries(errors).map(([k, c]) => `${k === 'name' ? w.name : k === 'name_en' ? w.nameEn : k === 'sequence' ? w.sequence : w.autoEvent}: ${w.errors[c]}`).join(' · ') }); return }
    setBusy(true)
    // Switching on or off is its own button: the row never sends it.
    const fields = { name: f.name, name_en: f.name_en, sequence: f.sequence, auto_event: f.auto_event, color: f.color }
    const out = await saveListItem(ws, kind, item.id, fields)
    setBusy(false)
    setMsg(out.error ? { error: out.error } : { ok: w.saved })
    if (!out.error) onDone()
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-1.5">
      {kind === 'stages' && (
        <input type="number" min={0} max={9999} value={f.sequence} onChange={e => set('sequence', e.target.value)} className={`${fieldInline} w-20`} dir="ltr" aria-label={w.sequence} />
      )}
      {kind === 'tags' && <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: TAG_COLORS[f.color] || TAG_COLORS[0] }} aria-hidden="true" />}
      <input value={f.name} onChange={e => set('name', e.target.value)} maxLength={120} className={`${fieldInline} w-44`} dir="auto" aria-label={w.name} required />
      <input value={f.name_en} onChange={e => set('name_en', e.target.value)} maxLength={120} className={`${fieldInline} w-44`} dir="ltr" placeholder={w.nameEn} aria-label={w.nameEn} />
      {kind === 'stages' && (
        <select value={f.auto_event} onChange={e => set('auto_event', e.target.value)} className={fieldInline} aria-label={w.autoEvent}>
          <option value="">{w.noAuto}</option>
          {AUTO_EVENTS.map(ev => <option key={ev} value={ev}>{w.events[ev]}</option>)}
        </select>
      )}
      {kind === 'tags' && (
        <select value={f.color} onChange={e => set('color', Number(e.target.value))} className={fieldInline} aria-label={w.color}>
          {TAG_COLORS.map((hex, i) => <option key={hex} value={i} style={{ color: hex }}>● {w.colorN(i + 1)}</option>)}
        </select>
      )}
      <Button type="submit" size="xs" variant="secondary" disabled={busy}>{w.save}</Button>
      {msg && <span className={`text-[11px] ${msg.error ? 'text-red-600' : 'text-emerald-700'}`} dir="auto">{msg.error || msg.ok}</span>}
    </form>
  )
}

function AddForm({ kind, items, ws, onDone }) {
  const { t: w } = useT(RW)
  const blank = { name: '', name_en: '', sequence: '', color: 0 }
  const [f, setF] = useState(blank)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => { setF(x => ({ ...x, [k]: v })); setMsg(null) }

  async function add(e) {
    e.preventDefault()
    const errors = validateListItem(kind, f, items)
    if (Object.keys(errors).length) { setMsg({ error: Object.entries(errors).map(([k, c]) => `${k === 'name' ? w.name : k === 'sequence' ? w.sequence : w.nameEn}: ${w.errors[c]}`).join(' · ') }); return }
    setBusy(true)
    const out = await saveListItem(ws, kind, null, { ...f, sequence: String(f.sequence) === '' ? nextSequence(items) : f.sequence })
    setBusy(false)
    if (out.error) { setMsg({ error: out.error }); return }
    setF(blank)
    setMsg({ ok: w.added })
    onDone()
  }

  return (
    <form onSubmit={add} className="flex flex-wrap items-end gap-2 pt-2">
      {kind === 'stages' && (
        <label className="block"><span className="block text-[11px] text-text-secondary">{w.sequence}</span>
          <input type="number" min={0} max={9999} value={f.sequence} onChange={e => set('sequence', e.target.value)} placeholder={w.auto} className={`${fieldInline} w-24`} dir="ltr" />
        </label>
      )}
      <label className="block"><span className="block text-[11px] text-text-secondary">{w.name} *</span>
        <input value={f.name} onChange={e => set('name', e.target.value)} maxLength={120} className={`${fieldInline} w-48`} dir="auto" />
      </label>
      <label className="block"><span className="block text-[11px] text-text-secondary">{w.nameEn}</span>
        <input value={f.name_en} onChange={e => set('name_en', e.target.value)} maxLength={120} className={`${fieldInline} w-48`} dir="ltr" />
      </label>
      {kind === 'tags' && (
        <label className="block"><span className="block text-[11px] text-text-secondary">{w.color}</span>
          <select value={f.color} onChange={e => set('color', Number(e.target.value))} className={fieldInline}>
            {TAG_COLORS.map((hex, i) => <option key={hex} value={i} style={{ color: hex }}>● {w.colorN(i + 1)}</option>)}
          </select>
        </label>
      )}
      <Button type="submit" size="sm" disabled={busy}>{w.add}</Button>
      {msg && <span className={`text-[11px] ${msg.error ? 'text-red-600' : 'text-emerald-700'}`} dir="auto">{msg.error || msg.ok}</span>}
    </form>
  )
}

export function CrmSettings() {
  const { canSection } = useAuth()
  const { t: w, lang, dir } = useT(RW)
  const { ws, base, error: baseError, reload } = useCrmBase()
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  if (!canSection('crm', 'view')) return <NoAccess />
  const can = canSection('crm', 'manage')

  async function toggle(kind, item) {
    setError(''); setNote('')
    const out = await toggleListItem(ws, kind, item.id, !item.is_active)
    if (out.error) setError(out.error)
    else { setNote(item.is_active ? w.switchedOff : w.switchedOn); reload() }
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.setTitle} subtitle={w.setSubtitle} />
      {(error || baseError) && <p className="text-xs text-red-600" dir="auto" role="alert">{error || baseError}</p>}
      {note && <p className="text-xs text-emerald-700" role="status">{note}</p>}
      {!base ? <Skeleton className="h-64" /> : LIST_KINDS.map(kind => {
        const items = settingsOrder(kind, base[KIND_KEY[kind]])
        const [title, hint] = w.kinds[kind]
        return (
          <section key={kind} className="bg-white border border-border p-4 space-y-2">
            <h2 className="text-sm font-semibold text-text">{title}</h2>
            <p className="text-[11px] text-text-tertiary">{hint}</p>
            {kind === 'stages' && <p className="text-[11px] text-text-tertiary">{w.autoHint}</p>}
            {kind === 'stages' && !items.length && can && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={async () => { const out = await suggestStages(ws); if (out.error) setError(out.error); else reload() }}>{w.suggest}</Button>
                <span className="text-[11px] text-text-tertiary">{w.suggestHint}</span>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                  {!can && kind === 'stages' && <th className="text-start font-medium px-2 py-1.5">{w.sequence}</th>}
                  <th className="text-start font-medium px-2 py-1.5">{w.name}</th>
                  <th className="text-start font-medium px-2 py-1.5">{w.statusCol}</th>
                  <th />
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {!items.length && <tr><td colSpan={4} className="px-2 py-2 text-xs text-text-tertiary">{w.nothingYet}</td></tr>}
                  {items.map(it => (
                    <tr key={`${it.id}-${it.updated_at || ''}`} className="align-middle">
                      {can ? (
                        <td className="px-2 py-1.5"><Row kind={kind} item={it} items={items} ws={ws} onDone={reload} /></td>
                      ) : (
                        <>
                          {kind === 'stages' && <td className="px-2 py-1.5 tabular-nums" dir="ltr" style={{ textAlign: 'start' }}>{it.sequence}</td>}
                          <td className="px-2 py-1.5">
                            {kind === 'tags' && <span className="inline-block w-2.5 h-2.5 rounded-full me-1.5" style={{ background: TAG_COLORS[it.color] || TAG_COLORS[0] }} aria-hidden="true" />}
                            <bdi>{listName(it, lang)}</bdi>
                            {kind === 'stages' && it.auto_event && <span className="text-text-tertiary"> — {w.events[it.auto_event]}</span>}
                          </td>
                        </>
                      )}
                      <td className="px-2 py-1.5">
                        <span className={`text-[11px] px-1.5 py-0.5 rounded border ${it.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-border bg-stone-50 text-text-tertiary'}`}>
                          {it.is_active ? w.active : w.off}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-end">
                        {can && <Button size="xs" variant="ghost" onClick={() => toggle(kind, it)}>{it.is_active ? w.switchOff : w.switchOn}</Button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {can && <AddForm kind={kind} items={items} ws={ws} onDone={reload} />}
          </section>
        )
      })}
    </div>
  )
}
