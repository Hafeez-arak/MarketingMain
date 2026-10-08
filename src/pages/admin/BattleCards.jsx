import { useEffect, useState } from 'react'
import { Button, Skeleton } from '../../components/ui/index'
import { fetchBattleCards } from '../../lib/sales/client'
import { normaliseCard, hasCard, byPhase, cardCounts, cardAsText } from '../../lib/sales/battleCard'

// ─── Admin → Agent Brief → Battle cards ────────────────────────────────────
// The two cards as a salesperson would hold them: empty, to fill in on a
// deal, and filled, to show what a good answer looks like. Both are drawn
// from one definition in the database (sales_icp.battle_cards), so the
// example can never drift from the card it illustrates.
//
// Laid out to be read in call order (2026-10-08, after "it looks messy"):
// one column per phase, an even two-column grid of fields, plain answer
// boxes instead of dashed lines, choices as chips, hints only on the empty
// card, and each objection as its own card with the answer first.

const KINDS = [
  { key: 'outbound', label: 'Outbound' },
  { key: 'inbound', label: 'Inbound' },
]
const VIEWS = [
  { key: 'empty', label: 'Empty card' },
  { key: 'example', label: 'Filled example' },
]

function Segmented({ items, value, onChange }) {
  return (
    <div className="inline-flex border border-border bg-white">
      {items.map((it, i) => (
        <button key={it.key} type="button" onClick={() => onChange(it.key)}
          className={`px-3 py-1.5 text-xs font-semibold transition-colors ${i ? 'border-l border-border' : ''} ${value === it.key
            ? 'bg-stone-800 text-white' : 'text-text-secondary hover:bg-surface-subtle'}`}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

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
  if (!cards) return <div className="p-5 space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full" />)}</div>

  const raw = cards[kind]
  const card = normaliseCard(raw)
  const filled = view === 'example'
  const counts = cardCounts(card)
  const [lead, ...more] = card.purpose.split('\n')

  async function copy() {
    try {
      await navigator.clipboard.writeText(cardAsText(card, { filled }))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked; nothing to do */ }
  }

  return (
    <div className="p-5 space-y-6">
      {/* ── Controls ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <Segmented items={KINDS} value={kind} onChange={setKind} />
          <Segmented items={VIEWS} value={view} onChange={setView} />
        </div>
        {hasCard(raw) && <Button variant="secondary" size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy as text'}</Button>}
      </div>

      {!hasCard(raw) ? (
        <p className="py-12 text-sm text-text-tertiary text-center">This card has not been written yet.</p>
      ) : (
        <>
          {/* ── Header ── */}
          <div className="max-w-3xl">
            <h2 className="text-lg font-bold text-text">{card.title}</h2>
            {lead && <p className="text-sm text-text-secondary mt-1.5 leading-relaxed">{lead}</p>}
            {more.length > 0 && <p className="text-xs text-text-tertiary mt-2 leading-relaxed">{more.join(' ')}</p>}
            <p className="text-xs text-text-tertiary mt-3 flex items-center gap-2 flex-wrap">
              <span>{counts.fields} questions</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1.5"><RequiredTag /> {counts.required} must be answered before the deal goes into the CRM</span>
            </p>
          </div>

          {filled && card.example_label && (
            <div className="border-l-2 border-sky-600 bg-sky-50 px-4 py-2.5 text-xs text-sky-900 leading-relaxed max-w-3xl">
              <span className="font-semibold">Example only. </span>{card.example_label}
            </div>
          )}

          {/* ── Phases ── */}
          {byPhase(card).map((p, i) => (
            <section key={p.key} className="space-y-3">
              <PhaseHeading n={i + 1} label={p.label} />
              {p.sections.map(s => <Section key={s.key} s={s} filled={filled} />)}
            </section>
          ))}

          {/* ── Objections ── */}
          {card.objections.length > 0 && (
            <section className="space-y-3">
              <PhaseHeading n={byPhase(card).length + 1} label="Objections and how we answer" />
              <p className="text-xs text-text-tertiary -mt-1">What clients say, our answer, what to show them, and when to stop spending time. The “why” comes from our own won and lost deals.</p>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                {card.objections.map((o, i) => <Objection key={o.objection} n={i + 1} o={o} filled={filled} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}

function PhaseHeading({ n, label }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-6 h-6 flex items-center justify-center bg-stone-800 text-white text-[11px] font-bold flex-shrink-0">{n}</span>
      <h3 className="text-sm font-bold text-text">{label}</h3>
      <span className="flex-1 h-px bg-border" />
    </div>
  )
}

function RequiredTag() {
  return <span className="inline-block px-1.5 py-px text-[9px] font-bold uppercase tracking-wide bg-amber-100 text-amber-900">Required</span>
}

function Section({ s, filled }) {
  return (
    <div className="border border-border bg-white">
      <div className="px-4 py-3 border-b border-border flex items-baseline gap-2 flex-wrap">
        <p className="text-sm font-semibold text-text">{s.title}</p>
        {s.intro && <p className="text-xs text-text-tertiary">{s.intro}</p>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 p-4">
        {s.fields.map(f => <Field key={f.label} f={f} filled={filled} />)}
      </div>
    </div>
  )
}

function Field({ f, filled }) {
  const wide = f.type === 'long' || ((f.type === 'choice' || f.type === 'check') && f.options.length > 4)
  return (
    <div className={`min-w-0 ${wide ? 'md:col-span-2' : ''}`}>
      <div className="flex items-start gap-2">
        <p className="text-xs font-semibold text-text leading-snug">{f.label}</p>
        {f.required && <RequiredTag />}
      </div>
      {!filled && f.hint && <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{f.hint}</p>}
      <div className="mt-1.5">
        {filled ? (
          <p className="text-xs text-text bg-sky-50 border border-sky-100 px-3 py-2 leading-relaxed whitespace-pre-line" dir="auto">{f.example || '—'}</p>
        ) : f.type === 'choice' || f.type === 'check' ? (
          <div className="flex flex-wrap gap-1.5">
            {(f.options.length ? f.options : ['Yes', 'No']).map(o => (
              <span key={o} className="px-2.5 py-1 text-[11px] text-text-secondary border border-border bg-surface-subtle">{o}</span>
            ))}
          </div>
        ) : (
          <div className={`border border-border bg-surface-subtle ${f.type === 'long' ? 'h-16' : 'h-8'}`} />
        )}
      </div>
    </div>
  )
}

function Objection({ n, o, filled }) {
  return (
    <div className="border border-border bg-white flex flex-col">
      <div className="px-4 py-3 border-b border-border flex items-start gap-3">
        <span className="text-[11px] font-bold text-text-tertiary tabular-nums mt-0.5">{String(n).padStart(2, '0')}</span>
        <p className="text-sm font-semibold text-text leading-snug">“{o.objection}”</p>
      </div>
      <div className="px-4 py-3 space-y-3 flex-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-sage-700">We answer</p>
          <p className="text-xs text-text mt-1 leading-relaxed">{o.answer}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {o.proof && o.proof !== '—' && <Line label="Show them" text={o.proof} />}
          {o.walk_away && o.walk_away !== '—' && <Line label="Walk away if" text={o.walk_away} tone="text-red-700" />}
        </div>
        {o.why && <Line label="Why it happens" text={o.why} muted />}
      </div>
      {filled && o.example && (
        <div className="px-4 py-2.5 border-t border-sky-100 bg-sky-50 text-xs text-sky-900">
          <span className="font-semibold">On this deal: </span>{o.example}
        </div>
      )}
    </div>
  )
}

function Line({ label, text, tone = 'text-text-tertiary', muted = false }) {
  return (
    <div>
      <p className={`text-[10px] font-bold uppercase tracking-wide ${tone}`}>{label}</p>
      <p className={`text-xs mt-1 leading-relaxed ${muted ? 'text-text-tertiary' : 'text-text-secondary'}`}>{text}</p>
    </div>
  )
}
