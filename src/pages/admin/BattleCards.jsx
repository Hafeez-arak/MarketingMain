import { useEffect, useState } from 'react'
import { Button, Skeleton } from '../../components/ui/index'
import { Notice, SubTabs } from '../email/parts'
import { fetchBattleCards } from '../../lib/sales/client'
import { normaliseCard, hasCard, byPhase, cardCounts, cardAsText } from '../../lib/sales/battleCard'

// ─── Admin → Agent Brief → Battle cards ────────────────────────────────────
// The two cards as a salesperson would hold them: empty, to fill in on a
// deal, and filled, to show what a good answer looks like. Both are drawn
// from one definition in the database (sales_icp.battle_cards), so the
// example can never drift from the card it illustrates.

const KINDS = [
  { key: 'outbound', label: 'Outbound — we contact them' },
  { key: 'inbound', label: 'Inbound — they contact us' },
]
const VIEWS = [
  { key: 'empty', label: 'Empty card' },
  { key: 'example', label: 'Filled example' },
]

export default function BattleCards({ workspaceId }) {
  const [cards, setCards] = useState(null)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('outbound')
  const [view, setView] = useState('empty')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    let live = true
    fetchBattleCards(workspaceId).then(r => {
      if (!live) return
      if (r.error) setError(r.error)
      else setCards(r.cards)
    })
    return () => { live = false }
  }, [workspaceId])

  if (error) return <p className="px-4 py-10 text-sm text-red-600 text-center">Could not load the battle cards: {error}</p>
  if (!cards) return <div className="p-4 space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>

  const raw = cards[kind]
  const card = normaliseCard(raw)
  const filled = view === 'example'
  const counts = cardCounts(card)

  async function copy() {
    try {
      await navigator.clipboard.writeText(cardAsText(card, { filled }))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked; nothing to do */ }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-2">
          <SubTabs items={KINDS} value={kind} onChange={setKind} />
          <SubTabs items={VIEWS} value={view} onChange={setView} />
        </div>
        {hasCard(raw) && <Button variant="secondary" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy as text'}</Button>}
      </div>

      {!hasCard(raw) ? (
        <p className="py-10 text-sm text-text-tertiary text-center">This card has not been written yet.</p>
      ) : (
        <>
          <div>
            <p className="text-base font-bold text-text">{card.title}</p>
            {card.purpose && <p className="text-xs text-text-secondary mt-1 leading-relaxed whitespace-pre-line">{card.purpose}</p>}
            <p className="text-[11px] text-text-tertiary mt-1">{counts.fields} things to know · {counts.required} must be filled before the deal goes into the CRM (marked ●)</p>
          </div>
          {filled && card.example_label && <Notice tone="sky" title="Illustrative example">{card.example_label}</Notice>}

          {byPhase(card).map(p => (
            <div key={p.key} className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800 border-b border-amber-200 pb-1">{p.label}</p>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {p.sections.map(s => <Section key={s.key} s={s} filled={filled} />)}
              </div>
            </div>
          ))}

          {card.objections.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-800 border-b border-amber-200 pb-1">Objections — the guns</p>
              <p className="text-[11px] text-text-tertiary">What clients say, why it really happens (from our own won and lost deals), what we answer, what we show, and when to stop spending time.</p>
              <div className="overflow-x-auto border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-surface-subtle text-[10px] uppercase tracking-wide text-text-tertiary">
                    <tr>
                      <th className="text-left font-semibold px-3 py-2 w-[16%]">They say</th>
                      <th className="text-left font-semibold px-3 py-2 w-[20%]">Why it happens</th>
                      <th className="text-left font-semibold px-3 py-2">We answer</th>
                      <th className="text-left font-semibold px-3 py-2 w-[16%]">Show them</th>
                      <th className="text-left font-semibold px-3 py-2 w-[14%]">Walk away if</th>
                      {filled && <th className="text-left font-semibold px-3 py-2 w-[18%]">On this deal</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border align-top">
                    {card.objections.map(o => (
                      <tr key={o.objection}>
                        <td className="px-3 py-2 font-semibold text-text">“{o.objection}”</td>
                        <td className="px-3 py-2 text-text-secondary">{o.why}</td>
                        <td className="px-3 py-2 text-text">{o.answer}</td>
                        <td className="px-3 py-2 text-text-secondary">{o.proof}</td>
                        <td className="px-3 py-2 text-text-secondary">{o.walk_away}</td>
                        {filled && <td className="px-3 py-2 text-sky-800">{o.example || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Section({ s, filled }) {
  return (
    <div className="border border-border">
      <div className="px-3 py-2 bg-surface-subtle border-b border-border">
        <p className="text-xs font-bold text-text">{s.title}</p>
        {s.intro && <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{s.intro}</p>}
      </div>
      <ul className="divide-y divide-border">
        {s.fields.map(f => <Field key={f.label} f={f} filled={filled} />)}
      </ul>
    </div>
  )
}

function Field({ f, filled }) {
  return (
    <li className="px-3 py-2">
      <p className="text-xs font-semibold text-text">
        {f.required && <span className="text-amber-700 mr-1" title="Must be filled before the CRM">●</span>}
        {f.label}
      </p>
      {f.hint && <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{f.hint}</p>}
      {filled ? (
        <p className="text-xs text-sky-800 mt-1 whitespace-pre-line leading-relaxed" dir="auto">{f.example || '—'}</p>
      ) : f.type === 'choice' || f.type === 'check' ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {(f.options.length ? f.options : ['Yes', 'No']).map(o => (
            <span key={o} className="text-[11px] text-text-secondary"><span className="inline-block w-3 h-3 border border-stone-400 mr-1 align-[-2px]" />{o}</span>
          ))}
        </div>
      ) : (
        <div className={`mt-1.5 border-b border-dashed border-stone-300 ${f.type === 'long' ? 'h-12' : 'h-5'}`} />
      )}
    </li>
  )
}
