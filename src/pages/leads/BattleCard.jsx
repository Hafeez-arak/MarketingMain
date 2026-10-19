import { useEffect, useState } from 'react'
import { Button, Skeleton, Spinner } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'
import { when } from '../../lib/leads/view'
import { FACTS, DECISIONS, CARD_KINDS, cardChips, normaliseLeadCard, matchCompetitors } from '../../lib/sales/leadCard'

// ─── A lead's battle card ──────────────────────────────────────────────────
// The owner's design (2026-10-12), laid out again on 2026-10-18 the way the
// Agent Brief's card is ("that one was better, easy to see what to do and
// where the data goes"), with less in it: three numbered steps.
//   1 Before the call   filled from the email and our records, editable
//   2 On the call       three questions with their answers, likely pushback
//   3 After the call    the decision, the dates, who decides, who else is
//                       quoting, and the next step with its follow-up date
// One Save keeps the lot. The next step and follow-up date are the lead's
// (the Pipeline lists them); the rest is the card's.

const CHIP_TONE = {
  kind: 'bg-text text-white font-semibold',
  good: 'bg-sage-50 text-sage-700 font-semibold',
  warn: 'bg-red-50 text-red-600 font-semibold',
  '': 'bg-stone-100 text-stone-700',
}

const afterOf = (row, lead) => ({
  decision: row?.decision || '', quote_due: row?.quote_due || '', target_price: row?.target_price || '', decides: row?.decides || '', competitors: row?.competitors || '',
  next_step: lead?.next_step || '', follow_up: lead?.follow_up || '',
})

const FIT_BANDS = { strong: 'Strong fit', possible: 'Possible fit', weak: 'Weak fit', '': 'No fit shown' }

const input = 'w-full border border-border bg-white text-text text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400'
const shown = 'text-xs text-text bg-surface-subtle border border-border px-3 py-2 leading-relaxed whitespace-pre-line min-h-[2rem]'

function Step({ n, label, who }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 h-6 flex items-center justify-center bg-stone-800 text-white text-[11px] font-bold flex-shrink-0">{n}</span>
      <h4 className="text-sm font-bold text-text">{label}</h4>
      {who && <span className="text-[10px] text-text-tertiary">{who}</span>}
      <span className="flex-1 h-px bg-border" />
    </div>
  )
}

function Box({ title, children }) {
  return (
    <div className="border border-border bg-white">
      {title && <p className="px-4 py-2.5 border-b border-border text-xs font-semibold text-text">{title}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-4">{children}</div>
    </div>
  )
}

function Field({ label, wide, children }) {
  return (
    <div className={`min-w-0 ${wide ? 'md:col-span-2' : ''}`}>
      <p className="text-xs font-semibold text-text leading-snug mb-1.5">{label}</p>
      {children}
    </div>
  )
}

const missing = <span className="text-text-tertiary italic">Not in the email</span>

export default function BattleCard({ lead, workspaceId, onLeadChange }) {
  const [row, setRow] = useState(null)
  const [error, setError] = useState('')
  const [card, setCard] = useState(null)        // the card as being edited
  const [after, setAfter] = useState(() => afterOf(null, lead))
  const [base, setBase] = useState(() => afterOf(null, lead))
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState('')
  const [rivals, setRivals] = useState([]) // the competitor watchlist, for who else is quoting

  useEffect(() => {
    // One card per opened row: the row's lead never changes under it.
    let live = true
    leadsApi('card', workspaceId, { lead_id: lead.id }).then((r) => {
      if (!live) return
      if (r.error) return setError(r.error)
      setRow(r.card)
      setCard(normaliseLeadCard(r.card.card))
      setAfter(afterOf(r.card, lead))
      setBase(afterOf(r.card, lead))
      setRivals(Array.isArray(r.watchlist) ? r.watchlist : [])
    })
    return () => { live = false }
  }, [lead.id, workspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="px-4 py-6 text-xs text-red-600">Could not open the battle card: {error}</p>
  if (!row || !card) return <div className="p-4 space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>

  const savedCard = normaliseLeadCard(row.card)
  const dirty = JSON.stringify({ card, after }) !== JSON.stringify({ card: savedCard, after: base })

  const setFact = (k) => (e) => setCard((c) => ({ ...c, facts: { ...c.facts, [k]: e.target.value } }))
  const setAsk = (i, k) => (e) => setCard((c) => ({ ...c, ask: c.ask.map((a, j) => (j === i ? { ...a, [k]: e.target.value } : a)) }))
  const setPush = (i, k) => (e) => setCard((c) => ({ ...c, pushback: c.pushback.map((p, j) => (j === i ? { ...p, [k]: e.target.value } : p)) }))
  const setAfterField = (k) => (e) => setAfter((a) => ({ ...a, [k]: e.target.value }))

  async function save() {
    setSaving(true); setNote('')
    const r = await leadsApi('card_save', workspaceId, { lead_id: lead.id, card, ...after })
    setSaving(false)
    if (r.error) return setNote(r.error)
    const nextLead = r.lead || { ...lead, next_step: after.next_step, follow_up: after.follow_up || null }
    setRow(r.card)
    setCard(normaliseLeadCard(r.card.card))
    setAfter(afterOf(r.card, nextLead))
    setBase(afterOf(r.card, nextLead))
    if (r.lead) onLeadChange?.(r.lead)
    setEditing(false)
    setNote('Saved.')
  }
  function cancel() {
    setCard(savedCard); setAfter(base); setEditing(false); setNote('')
  }

  const list = (items, key, hint, empty) => (editing ? (
    <textarea rows={Math.max(2, items.length)} value={items.join('\n')} aria-label={hint}
      onChange={(e) => setCard({ ...card, [key]: e.target.value.split('\n') })} className={`${input} resize-y`} placeholder="One per line" />
  ) : items.length ? (
    <ul className={`${shown} space-y-1`}>{items.map((h, i) => <li key={i} className="before:content-['▸_'] before:text-amber-700">{h}</li>)}</ul>
  ) : (
    <p className={shown}><span className="text-text-tertiary italic">{empty}</span></p>
  ))

  return (
    <div className="px-4 pb-4 pt-3 md:pl-[8.25rem] text-xs space-y-5">
      {/* ── Header ── */}
      <div>
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
          ? <textarea className={`${input} mt-2 resize-y`} rows={2} value={card.headline} onChange={(e) => setCard({ ...card, headline: e.target.value })} aria-label="The deal in one line" />
          : <p className="mt-2 text-sm font-semibold text-text leading-snug" dir="auto">{card.headline || missing}</p>}
        {editing ? (
          <div className="mt-2 grid grid-cols-1 sm:grid-cols-[9rem_1fr] gap-2">
            <select aria-label="ICP fit" value={card.fit.band} onChange={(e) => setCard({ ...card, fit: { ...card.fit, band: e.target.value } })} className={input}>
              {Object.entries(FIT_BANDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <textarea rows={2} value={card.fit.text} onChange={(e) => setCard({ ...card, fit: { ...card.fit, text: e.target.value } })} aria-label="Why it fits" className={`${input} resize-y`} />
          </div>
        ) : card.fit.text ? (
          <p className="mt-1 text-text-secondary leading-relaxed">{card.fit.text}</p>
        ) : null}
      </div>

      {/* ── 1 Before the call ── */}
      <section className="space-y-3">
        <Step n={1} label="Before the call" who="filled from the email and our records" />
        <Box>
          {FACTS.map(([k, label]) => (
            <Field key={k} label={label} wide={k === 'wants'}>
              {editing
                ? <textarea rows={k === 'wants' ? 3 : 2} value={card.facts[k]} onChange={setFact(k)} aria-label={label} className={`${input} resize-y`} dir="auto" />
                : <p className={shown} dir="auto">{card.facts[k] || missing}</p>}
            </Field>
          ))}
          <Field label="Our history with them" wide>{list(card.history, 'history', 'Our history with them', 'Nothing on record.')}</Field>
          <Field label="Proof to name" wide>{list(card.references, 'references', 'Proof to name', 'No project of ours in this segment yet.')}</Field>
        </Box>
      </section>

      {/* ── 2 On the call ── */}
      <section className="space-y-3">
        <Step n={2} label="On the call" who="write their answers in" />
        <div className="border border-border bg-white">
          <p className="px-4 py-2.5 border-b border-border text-xs font-semibold text-text">Ask these 3 first</p>
          <ol className="p-4 space-y-3">
            {card.ask.map((a, i) => (
              <li key={i} className="grid grid-cols-[1.25rem_1fr] gap-x-2 gap-y-1.5">
                <span className="font-bold text-amber-700 tabular-nums">{i + 1}</span>
                {editing
                  ? <input value={a.q} onChange={setAsk(i, 'q')} aria-label={`Question ${i + 1}`} className={`${input} font-semibold`} />
                  : <span className="font-semibold text-text leading-snug" dir="auto">{a.q}</span>}
                <input value={a.a} onChange={setAsk(i, 'a')} placeholder="Their answer" aria-label={`Answer to question ${i + 1}`}
                  className={`${input} col-start-2 bg-surface-subtle`} dir="auto" />
              </li>
            ))}
          </ol>
        </div>
        {card.pushback.length > 0 && (
          <div className="border border-border bg-white">
            <p className="px-4 py-2.5 border-b border-border text-xs font-semibold text-text">If they push back</p>
            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {card.pushback.map((p, i) => (editing ? (
                <div key={i} className="space-y-1">
                  <input value={p.objection} onChange={setPush(i, 'objection')} aria-label={`Objection ${i + 1}`} className={`${input} font-semibold`} />
                  <textarea rows={3} value={p.answer} onChange={setPush(i, 'answer')} aria-label={`Answer to objection ${i + 1}`} className={`${input} resize-y`} />
                </div>
              ) : (
                <div key={i} className="border border-border">
                  <p className="px-3 py-2 border-b border-border font-semibold text-text leading-snug">“{p.objection}”</p>
                  <div className="px-3 py-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-sage-700">We answer</p>
                    <p className="mt-1 text-text-secondary leading-relaxed">{p.answer}</p>
                  </div>
                </div>
              )))}
            </div>
          </div>
        )}
      </section>

      {/* ── 3 After the call ── */}
      <section className="space-y-3">
        <Step n={3} label="After the call" who="what was decided, and what happens next" />
        <Box>
          <Field label="Decision">
            <select aria-label="Decision" value={after.decision} onChange={setAfterField('decision')} className={input}>
              <option value="">Not decided</option>
              {Object.entries(DECISIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Quote due">
            <input type="date" aria-label="Quote due" value={after.quote_due} onChange={setAfterField('quote_due')} className={input} />
          </Field>
          <Field label="Target price">
            <input aria-label="Target price" placeholder='SAR, or "not shared"' value={after.target_price} onChange={setAfterField('target_price')} maxLength={200} className={input} />
          </Field>
          <Field label="Who decides">
            <input aria-label="Who decides" placeholder="Name and role" value={after.decides} onChange={setAfterField('decides')} maxLength={300} className={input} />
          </Field>
          <Field label="Who else is quoting" wide>
            <input aria-label="Who else is quoting" placeholder="Competitors on this deal" list={`rivals-${lead.id}`}
              value={after.competitors} onChange={setAfterField('competitors')} maxLength={300} className={input} />
            <datalist id={`rivals-${lead.id}`}>{rivals.map((c) => <option key={c.name} value={c.name} />)}</datalist>
            {matchCompetitors(after.competitors, rivals).map((c) => (
              <div key={c.name} className="mt-2 border border-border px-3 py-2 space-y-0.5">
                <p className="font-semibold text-text">{c.name}{c.city ? <span className="font-normal text-text-tertiary"> · {c.city}</span> : null}{c.lines?.length ? <span className="font-normal text-text-tertiary"> · {c.lines.join(', ')}</span> : null}</p>
                {c.note && <p className="text-text-secondary">{c.note}</p>}
                {c.brands?.length > 0 && <p className="text-text-secondary">Holds: {c.brands.map((b) => `${b.brand}${b.relationship === 'exclusive' ? ' (exclusive)' : ''}`).join(', ')}</p>}
              </div>
            ))}
          </Field>
          <Field label="Next step">
            <input aria-label="Next step" placeholder="e.g. Send the quote, call the PM" value={after.next_step} onChange={setAfterField('next_step')} maxLength={500} className={input} dir="auto" />
          </Field>
          <Field label="Follow-up date">
            <input type="date" aria-label="Follow-up date" value={after.follow_up} onChange={setAfterField('follow_up')} className={input} />
          </Field>
        </Box>
      </section>

      {/* ── Save ── */}
      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-border">
        <Button size="xs" onClick={save} disabled={!dirty || saving}>{saving ? <Spinner size="sm" /> : null}{saving ? 'Saving…' : 'Save card'}</Button>
        {editing
          ? <Button size="xs" variant="ghost" onClick={cancel} disabled={saving}>Cancel</Button>
          : <Button size="xs" variant="secondary" onClick={() => { setEditing(true); setNote('') }}>Edit step 1 and the questions</Button>}
        {dirty && !saving && <span className="text-[11px] text-amber-800">Unsaved changes</span>}
        {note && <span className={`text-[11px] ${note === 'Saved.' ? 'text-sage-700' : 'text-red-600'}`}>{note}</span>}
        <span className="text-[10px] text-text-tertiary ml-auto">
          Card made {when(row.built_at)}{row.updated_at && row.updated_at !== row.built_at ? ` · last saved ${when(row.updated_at)}` : ''}
        </span>
      </div>
    </div>
  )
}
