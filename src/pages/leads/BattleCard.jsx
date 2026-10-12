import { useEffect, useState } from 'react'
import { Button, Input, Select, Skeleton, Spinner, Textarea } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'
import { when } from '../../lib/leads/view'
import { FACTS, DECISIONS, CARD_KINDS, cardChips, normaliseLeadCard } from '../../lib/sales/leadCard'

// ─── An approved lead's battle card ────────────────────────────────────────
// The owner's design (2026-10-12): one screen the salesperson works from
// until the deal moves to the CRM. What we know and what our history says
// are built from the email and our own records (no model call); the three
// questions and the four after-call fields are the call. Every part can be
// edited here, as it could in the CRM. One Save keeps the lot.

const CHIP_TONE = {
  kind: 'bg-text text-white font-semibold',
  good: 'bg-sage-50 text-sage-700 font-semibold',
  warn: 'bg-red-50 text-red-600 font-semibold',
  '': 'bg-stone-100 text-stone-700',
}

const EMPTY_AFTER = { decision: '', quote_due: '', target_price: '', decides: '' }
const afterOf = (row) => ({
  decision: row?.decision || '', quote_due: row?.quote_due || '', target_price: row?.target_price || '', decides: row?.decides || '',
})

function Block({ title, who, children }) {
  return (
    <section className="py-3 border-t border-border first:border-t-0 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="eyebrow">{title}</h4>
        {who && <span className="text-[10px] text-text-tertiary">{who}</span>}
      </div>
      {children}
    </section>
  )
}

const missing = <span className="text-text-tertiary italic">Not in the email</span>

export default function BattleCard({ lead, workspaceId }) {
  const [row, setRow] = useState(null)
  const [error, setError] = useState('')
  const [card, setCard] = useState(null)        // the card as being edited
  const [after, setAfter] = useState(EMPTY_AFTER)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    // One card per opened row: the row's lead never changes under it.
    let live = true
    leadsApi('card', workspaceId, { lead_id: lead.id }).then((r) => {
      if (!live) return
      if (r.error) return setError(r.error)
      setRow(r.card)
      setCard(normaliseLeadCard(r.card.card))
      setAfter(afterOf(r.card))
    })
    return () => { live = false }
  }, [lead.id, workspaceId])

  if (error) return <p className="px-4 py-6 text-xs text-red-600">Could not open the battle card: {error}</p>
  if (!row || !card) return <div className="p-4 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>

  const saved = { card: normaliseLeadCard(row.card), after: afterOf(row) }
  const dirty = JSON.stringify({ card, after }) !== JSON.stringify(saved)

  const setFact = (k) => (e) => setCard((c) => ({ ...c, facts: { ...c.facts, [k]: e.target.value } }))
  const setAsk = (i, k) => (e) => setCard((c) => ({ ...c, ask: c.ask.map((a, j) => (j === i ? { ...a, [k]: e.target.value } : a)) }))
  const setPush = (i, k) => (e) => setCard((c) => ({ ...c, pushback: c.pushback.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)) }))
  const setAfterField = (k) => (e) => setAfter((a) => ({ ...a, [k]: e.target.value }))

  async function save() {
    setSaving(true); setNote('')
    const r = await leadsApi('card_save', workspaceId, { lead_id: lead.id, card, ...after })
    setSaving(false)
    if (r.error) return setNote(r.error)
    setRow(r.card)
    setCard(normaliseLeadCard(r.card.card))
    setAfter(afterOf(r.card))
    setEditing(false)
    setNote('Saved.')
  }
  function cancel() {
    setCard(saved.card); setAfter(saved.after); setEditing(false); setNote('')
  }

  const field = 'w-full border border-border bg-white text-text text-xs px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400'

  return (
    <div className="px-4 pb-4 pt-3 md:pl-[8.25rem] text-xs">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {editing ? (
          <select aria-label="Card type" value={card.kind} onChange={(e) => setCard({ ...card, kind: e.target.value })} className="text-xs border border-border px-1.5 py-0.5 bg-white">
            {Object.entries(CARD_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        ) : null}
        {cardChips(lead, card).filter((c) => !(editing && c.tone === 'kind')).map((c) => (
          <span key={c.text} className={`text-[11px] px-2 py-0.5 ${CHIP_TONE[c.tone] || CHIP_TONE['']}`}>{c.text}</span>
        ))}
      </div>
      {editing
        ? <Textarea className="mt-2" rows={2} value={card.headline} onChange={(e) => setCard({ ...card, headline: e.target.value })} aria-label="The deal in one line" />
        : <p className="mt-2 text-sm font-semibold text-text leading-snug" dir="auto">{card.headline || missing}</p>}

      <div className="mt-2">
        {/* ── What we know ── */}
        <Block title="What we know" who="from the email">
          <dl className="grid grid-cols-1 sm:grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5">
            {FACTS.map(([k, label]) => (
              <div key={k} className="contents">
                <dt className="text-text-tertiary pt-0.5">{label}</dt>
                <dd className="min-w-0 text-text" dir="auto">
                  {editing
                    ? <textarea rows={k === 'scope' || k === 'also_want' ? 2 : 1} value={card.facts[k]} onChange={setFact(k)} aria-label={label} className={`${field} resize-y`} />
                    : (card.facts[k] || missing)}
                </dd>
              </div>
            ))}
          </dl>
        </Block>

        {/* ── History ── */}
        <Block title="What our history says" who="our records">
          {editing ? (
            <Textarea rows={4} value={card.history.join('\n')} hint="One point per line."
              onChange={(e) => setCard({ ...card, history: e.target.value.split('\n') })} aria-label="What our history says" />
          ) : (
            <ul className="bg-amber-50 px-3 py-2 space-y-1">
              {card.history.map((h, i) => <li key={i} className="text-text before:content-['▸_'] before:text-amber-700">{h}</li>)}
            </ul>
          )}
        </Block>

        {/* ── The call ── */}
        <Block title="Ask these 3 first" who="answers: the salesperson">
          <ol className="space-y-2.5">
            {card.ask.map((a, i) => (
              <li key={i} className="grid grid-cols-[1.25rem_1fr] gap-x-2 gap-y-1">
                <span className="font-semibold text-amber-700 tabular-nums">{i + 1}</span>
                {editing
                  ? <input value={a.q} onChange={setAsk(i, 'q')} aria-label={`Question ${i + 1}`} className={field} />
                  : <span className="text-text" dir="auto">{a.q}</span>}
                <input value={a.a} onChange={setAsk(i, 'a')} placeholder="Their answer" aria-label={`Answer to question ${i + 1}`}
                  className={`${field} col-start-2 border-dashed`} dir="auto" />
              </li>
            ))}
          </ol>
        </Block>

        {card.pushback.length > 0 && (
          <Block title="Likely pushback" who="our playbook">
            <div className="space-y-2">
              {card.pushback.map((p, i) => (editing ? (
                <div key={i} className="space-y-1">
                  <input value={p.objection} onChange={setPush(i, 'objection')} aria-label={`Objection ${i + 1}`} className={`${field} font-semibold`} />
                  <textarea rows={2} value={p.answer} onChange={setPush(i, 'answer')} aria-label={`Answer to objection ${i + 1}`} className={`${field} resize-y`} />
                </div>
              ) : (
                <p key={i}><span className="font-semibold text-text">"{p.objection}"</span> <span className="text-text-secondary">{p.answer}</span></p>
              )))}
            </div>
          </Block>
        )}

        <Block title="After the first call" who="the salesperson">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            <Select label="Decision" value={after.decision} onChange={setAfterField('decision')}>
              <option value="">Not decided</option>
              {Object.entries(DECISIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
            <Input label="Quote due" type="date" value={after.quote_due} onChange={setAfterField('quote_due')} />
            <Input label="Target price" placeholder='SAR, or "not shared"' value={after.target_price} onChange={setAfterField('target_price')} maxLength={200} />
            <Input label="Who decides" placeholder="Name and role" value={after.decides} onChange={setAfterField('decides')} maxLength={300} />
          </div>
        </Block>
      </div>

      {/* ── Save ── */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
        <Button size="xs" onClick={save} disabled={!dirty || saving}>{saving ? <Spinner size="sm" /> : null}{saving ? 'Saving…' : 'Save card'}</Button>
        {editing
          ? <Button size="xs" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
          : <Button size="xs" variant="secondary" onClick={() => { setEditing(true); setNote('') }}>Edit card</Button>}
        {dirty && !saving && <span className="text-[11px] text-amber-800">Unsaved changes</span>}
        {note && <span className={`text-[11px] ${note === 'Saved.' ? 'text-sage-700' : 'text-red-600'}`}>{note}</span>}
        <span className="text-[10px] text-text-tertiary ml-auto">
          Card made {when(row.built_at)}{row.updated_at && row.updated_at !== row.built_at ? ` · last saved ${when(row.updated_at)}` : ''}
        </span>
      </div>
    </div>
  )
}
