import { useEffect, useMemo, useState } from 'react'
import { Button, Skeleton, Spinner } from '../../components/ui/index'
import { leadsApi } from '../../lib/leads/client'
import { CATEGORIES, PLAYBOOK_SIGNALS, searchPlaybook, playbookStages, needsReview, reviewedOn } from '../../lib/sales/playbook'

// ─── The sales playbook ────────────────────────────────────────────────────
// The owner's template (2026-11-03), built 2026-11-07: a library of battle
// cards, one per situation on a call. Searchable by words, category and
// stage; a card opens in full on the right. A sales admin (or the access
// admin) edits a card and marks it reviewed; an edited card is a draft again.
// The same cards show on each lead's battle card when they fit it.

const CAT_TONE = {
  discovery: 'text-sky-700 bg-sky-50',
  objection: 'text-red-700 bg-red-50',
  competitor: 'text-violet-700 bg-violet-50',
  persona: 'text-sage-700 bg-sage-50',
  closing: 'text-amber-800 bg-amber-50',
}

const input = 'w-full border border-border bg-white text-text text-xs px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400'

export function CategoryTag({ category }) {
  return <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 ${CAT_TONE[category] || 'bg-stone-100 text-stone-700'}`}>{CATEGORIES[category] || category}</span>
}

function StatusTag({ card }) {
  if (card.status !== 'approved') return <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-orange-100 text-orange-800">Draft</span>
  if (needsReview(card)) return <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 bg-stone-100 text-stone-700">Review due</span>
  return null
}

function Section({ label, children, tone = '' }) {
  if (!children) return null
  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <p className="text-[10px] font-bold uppercase tracking-wide text-text-tertiary mb-1">{label}</p>
      <div className={`text-xs leading-relaxed whitespace-pre-line ${tone}`} dir="auto">{children}</div>
    </div>
  )
}

/** One card in full: the template's fields, in its order. */
export function PlaybookCardView({ card }) {
  return (
    <div>
      <Section label="When to use">{card.trigger}</Section>
      <Section label="Customer says"><span className="italic">{card.statement}</span></Section>
      <Section label="Sales objective">{card.objective}</Section>
      <Section label="Recommended response"><p className="border-l-2 border-amber-500 bg-surface-subtle px-3 py-2">{card.response}</p></Section>
      <Section label="Follow-up question"><p className="border-l-2 border-amber-500 bg-surface-subtle px-3 py-2">{card.follow_up}</p></Section>
      <Section label="Evidence (our own deals)">
        {card.evidence ? <p className="bg-sage-50 px-3 py-2">{card.evidence}{card.source ? <span className="block mt-1 text-[10px] font-semibold text-sage-700">Source: {card.source}</span> : null}</p> : null}
      </Section>
      <Section label="Recommended next step">{card.next_step}</Section>
      <Section label="Avoid">
        {card.avoid?.length ? <ul className="bg-red-50 px-3 py-2 space-y-1">{card.avoid.map((a, i) => <li key={i} className="before:content-['✕_'] before:text-red-600">{a}</li>)}</ul> : null}
      </Section>
    </div>
  )
}

const EMPTY = { title: '', category: 'objection', stage: '', trigger: '', statement: '', objective: '', response: '', follow_up: '', evidence: '', source: '', next_step: '', avoid: [], signals: [], owner_label: '' }

function CardForm({ card, onCancel, onSaved, workspaceId }) {
  const [f, setF] = useState(() => ({ ...EMPTY, ...card, avoid: (card?.avoid || []).join('\n') }))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const toggle = (s) => setF((x) => ({ ...x, signals: x.signals.includes(s) ? x.signals.filter((y) => y !== s) : [...x.signals, s] }))
  async function save() {
    setSaving(true); setError('')
    const r = await leadsApi('playbook_save', workspaceId, { ...f, id: card?.id, avoid: f.avoid.split('\n') })
    setSaving(false)
    if (r.error) return setError(r.error)
    onSaved(r.card)
  }
  const field = (k, label, rows = 2) => (
    <label className="block">
      <span className="text-[11px] font-semibold text-text">{label}</span>
      {rows === 1
        ? <input value={f[k]} onChange={set(k)} className={`${input} mt-1`} dir="auto" />
        : <textarea rows={rows} value={f[k]} onChange={set(k)} className={`${input} mt-1 resize-y`} dir="auto" />}
    </label>
  )
  return (
    <div className="space-y-3">
      {field('title', 'Title (the situation or objection)', 1)}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-[11px] font-semibold text-text">Category</span>
          <select value={f.category} onChange={set('category')} className={`${input} mt-1`}>
            {Object.entries(CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        {field('stage', 'Sales stage', 1)}
      </div>
      {field('trigger', 'When to use')}
      {field('statement', 'What the customer says')}
      {field('objective', 'Sales objective')}
      {field('response', 'Recommended response', 3)}
      {field('follow_up', 'Follow-up question')}
      {field('evidence', 'Supporting evidence', 3)}
      {field('source', 'Where the evidence comes from', 1)}
      {field('next_step', 'Recommended next step')}
      {field('avoid', 'Avoid (one per line)', 3)}
      {field('owner_label', 'Owner', 1)}
      <div>
        <p className="text-[11px] font-semibold text-text">Show it on leads with</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {Object.entries(PLAYBOOK_SIGNALS).map(([k, l]) => (
            <button key={k} type="button" onClick={() => toggle(k)}
              className={`text-[11px] px-2 py-0.5 border ${f.signals.includes(k) ? 'border-amber-600 bg-amber-50 text-amber-900 font-semibold' : 'border-border text-text-secondary'}`}>{l}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button size="xs" onClick={save} disabled={saving}>{saving ? <Spinner size="sm" /> : null}{saving ? 'Saving…' : 'Save card'}</Button>
        <Button size="xs" variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
        {error && <span className="text-[11px] text-red-600">{error}</span>}
      </div>
      <p className="text-[10px] text-text-tertiary">A saved change makes the card a draft again until it is marked reviewed.</p>
    </div>
  )
}

export default function Playbook({ workspaceId }) {
  const [cards, setCards] = useState(null)
  const [canEdit, setCanEdit] = useState(false)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [stage, setStage] = useState('')
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null) // a card, or {} for a new one
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    let live = true
    leadsApi('playbook', workspaceId, {}).then((r) => {
      if (!live) return
      if (r.error) return setError(r.error)
      setCards(r.cards || [])
      setCanEdit(Boolean(r.can_edit))
    })
    return () => { live = false }
  }, [workspaceId])

  const shown = useMemo(() => searchPlaybook(cards || [], q, { category, stage }), [cards, q, category, stage])
  const stages = useMemo(() => playbookStages(cards || []), [cards])
  const open = (cards || []).find((c) => c.id === openId) || null
  const drafts = (cards || []).filter((c) => c.status !== 'approved').length

  const replace = (card) => setCards((cs) => (cs.some((c) => c.id === card.id) ? cs.map((c) => (c.id === card.id ? card : c)) : [...cs, card]))

  async function review(card, approved) {
    setBusy(true); setNote('')
    const r = await leadsApi('playbook_review', workspaceId, { id: card.id, approved })
    setBusy(false)
    if (r.error) return setNote(r.error)
    replace(r.card)
  }
  async function remove(card) {
    if (!window.confirm(`Remove "${card.title}" from the playbook?`)) return
    setBusy(true); setNote('')
    const r = await leadsApi('playbook_delete', workspaceId, { id: card.id })
    setBusy(false)
    if (r.error) return setNote(r.error)
    setCards((cs) => cs.filter((c) => c.id !== card.id)); setOpenId(null)
  }

  if (error) return <p className="px-4 py-6 text-xs text-red-600">Could not open the playbook: {error}</p>
  if (!cards) return <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-28 w-full" />)}</div>

  const counts = Object.fromEntries(Object.keys(CATEGORIES).map((k) => [k, cards.filter((c) => c.category === k).length]))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text">Playbook</p>
          <p className="text-xs text-text-secondary">{cards.length} battle cards: what to say, what to ask, what to avoid.{drafts ? ` ${drafts} still draft, waiting for the sales manager's review.` : ''}</p>
        </div>
        {canEdit && <Button size="xs" variant="secondary" onClick={() => { setEditing({}); setOpenId(null) }}>+ New card</Button>}
      </div>

      <div className="flex flex-wrap gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: price, Lutron, submittal, tender, vendor list…" aria-label="Search the playbook"
          className="flex-1 min-w-[14rem] border border-border bg-white text-text text-xs px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400" />
        <select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Sales stage" className="border border-border bg-white text-text text-xs px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-amber-400">
          <option value="">Every stage</option>
          {stages.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setCategory('')} className={`text-[11px] px-2.5 py-1 border ${category === '' ? 'border-text text-text font-semibold' : 'border-border text-text-secondary'}`}>All {cards.length}</button>
        {Object.entries(CATEGORIES).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setCategory(k)} className={`text-[11px] px-2.5 py-1 border ${category === k ? 'border-text text-text font-semibold' : 'border-border text-text-secondary'}`}>{l} {counts[k]}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {shown.length ? shown.map((c) => (
            <button key={c.id} type="button" onClick={() => { setOpenId(c.id); setEditing(null) }}
              className={`text-left border bg-white px-3 py-2.5 space-y-1.5 hover:border-amber-500 ${openId === c.id ? 'border-amber-600 ring-1 ring-amber-500' : 'border-border'}`}>
              <div className="flex flex-wrap items-center gap-1.5"><CategoryTag category={c.category} /><StatusTag card={c} /></div>
              <p className="text-xs font-semibold text-text leading-snug" dir="auto">{c.title}</p>
              {c.statement && <p className="text-[11px] italic text-text-secondary line-clamp-2" dir="auto">{c.statement}</p>}
              <p className="text-[10px] text-text-tertiary">{c.stage || 'Any stage'}</p>
            </button>
          )) : (
            <p className="sm:col-span-2 border border-dashed border-border px-4 py-8 text-center text-xs text-text-tertiary">
              {cards.length ? `No card matches “${q}”.` : 'The playbook is empty.'}
            </p>
          )}
        </div>

        <div className="border border-border bg-white lg:sticky lg:top-4">
          {editing ? (
            <div className="p-4">
              <p className="text-sm font-semibold text-text mb-3">{editing.id ? 'Edit card' : 'New card'}</p>
              <CardForm card={editing.id ? editing : null} workspaceId={workspaceId} onCancel={() => setEditing(null)}
                onSaved={(card) => { replace(card); setEditing(null); setOpenId(card.id) }} />
            </div>
          ) : open ? (
            <div>
              <div className="px-4 pt-3 pb-3 border-b border-border">
                <div className="flex flex-wrap items-center gap-1.5"><CategoryTag category={open.category} /><StatusTag card={open} /></div>
                <p className="mt-1.5 text-base font-semibold text-text leading-snug" dir="auto">{open.title}</p>
                <p className="text-[11px] text-text-tertiary">Stage: {open.stage || 'Any'}</p>
              </div>
              <div className="px-4"><PlaybookCardView card={open} /></div>
              <div className="px-4 py-3 border-t border-border flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
                <span>Owner: <b className="text-text">{open.owner_label || 'Not named'}</b></span>
                <span>· Last reviewed: <b className="text-text">{reviewedOn(open.reviewed_at) || 'never (draft)'}</b></span>
                {canEdit && (
                  <span className="ml-auto flex gap-2">
                    <Button size="xs" variant="ghost" onClick={() => remove(open)} disabled={busy}>Remove</Button>
                    <Button size="xs" variant="secondary" onClick={() => setEditing(open)} disabled={busy}>Edit</Button>
                    {open.status === 'approved'
                      ? <Button size="xs" variant="secondary" onClick={() => review(open, true)} disabled={busy}>Reviewed again today</Button>
                      : <Button size="xs" onClick={() => review(open, true)} disabled={busy}>Mark reviewed</Button>}
                  </span>
                )}
                {note && <span className="w-full text-red-600">{note}</span>}
              </div>
            </div>
          ) : (
            <p className="px-4 py-10 text-center text-xs text-text-tertiary">Pick a card to see it in full.</p>
          )}
        </div>
      </div>
    </div>
  )
}
