import { useState } from 'react'
import { Modal, Button, Input, Select, Textarea } from './ui/index'
import { useAuth } from '../store/auth'
import { recordDealOutcome, DECIDED_BY } from '../lib/marketIntel'

// ─── Recording a bid we contested ──────────────────────────────────────────
//
// The one thing in the research store that no amount of research can produce.
// Who beat us, and on what, is not written on any website — only the people
// who bid know it — and until this form existed the business view's first
// block could never fill, however many runs happened.
//
// ── WHY IT IS THIS SHORT ──
//
// Six fields, one of them required. A form that asks for exact contract values
// and full consultant details is one that gets filled in for a fortnight and
// then quietly stops, and half-remembered beats nothing at all. The price gap
// is deliberately labelled "roughly" for the same reason: waiting for the real
// number is how a log like this dies.
export function RecordBid({ open, onClose, onSaved, lines = [] }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [form, setForm] = useState({ outcome: 'lost', decided_by: 'unknown' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const save = async () => {
    setSaving(true); setError('')
    const out = await recordDealOutcome(activeWorkspaceId, accessToken, form)
    setSaving(false)
    if (!out.ok) { setError(out.error); return }
    setForm({ outcome: 'lost', decided_by: 'unknown' })
    onSaved?.()
    onClose?.()
  }

  return (
    <Modal open={open} onClose={onClose} title="Record a bid">
      <div className="space-y-3">
        <p className="text-xs text-text-secondary leading-relaxed">
          Add any bid where we were up against a named competitor — won or lost. This is the only
          part of the research the agent cannot find on its own.
        </p>

        <Input label="Project" placeholder="Riyadh hotel tower"
          value={form.project || ''} onChange={e => set('project', e.target.value)} />

        <div className="grid grid-cols-2 gap-3">
          <Input label="Who were we up against?" placeholder="Al Nasser Group"
            value={form.competitor || ''} onChange={e => set('competitor', e.target.value)} />
          <Select label="What happened?" value={form.outcome} onChange={e => set('outcome', e.target.value)}>
            <option value="lost">We lost it</option>
            <option value="won">We won it</option>
            <option value="open">Still open</option>
            <option value="no_bid">We did not bid</option>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="What decided it?" value={form.decided_by} onChange={e => set('decided_by', e.target.value)}>
            {DECIDED_BY.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </Select>
          <Select label="Which side of the business?" value={form.line || ''} onChange={e => set('line', e.target.value)}>
            <option value="">Not sure</option>
            {lines.map(l => <option key={l} value={l}>{l[0].toUpperCase() + l.slice(1)}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Input label="How far off were we on price?" hint="Roughly, in percent. Leave blank if you do not know."
            placeholder="12" inputMode="decimal"
            value={form.price_delta_pct || ''} onChange={e => set('price_delta_pct', e.target.value)} />
          <Input label="Consultant" hint="Who specified it, if you know."
            placeholder="Dar Al-Omran"
            value={form.consultant || ''} onChange={e => set('consultant', e.target.value)} />
        </div>

        <Textarea label="Anything else worth knowing" rows={2}
          value={form.note || ''} onChange={e => set('note', e.target.value)} />

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !String(form.project || '').trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
