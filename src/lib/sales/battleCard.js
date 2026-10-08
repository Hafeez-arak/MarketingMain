// ─── Battle cards ──────────────────────────────────────────────────────────
// The salesperson's one-page "gun" for a deal: what to know before the call,
// what to find out on it, how to answer the objections our own won and lost
// deals keep raising, and what to record afterwards so the CRM finally holds
// the reason a deal was won or lost.
//
// The card is data (sales_icp.battle_cards), one outbound and one inbound per
// company. This file only knows the SHAPE — sections of fields, plus an
// objection table — so a second company writes its own card without code, and
// no playbook or client name sits in this public repository.
//
// Every field carries an `example`, which is how one definition draws both
// the empty card a salesperson fills in and the filled example that shows
// what a good answer looks like.
//
// Pure. No network.

export const CARD_KINDS = ['outbound', 'inbound']
export const PHASES = [
  ['before', 'Before the call'],
  ['during', 'On the call'],
  ['after', 'After the call'],
]
export const phaseLabel = key => PHASES.find(([k]) => k === key)?.[1] || ''

const FIELD_TYPES = ['text', 'long', 'choice', 'check']
const str = v => String(v ?? '').trim()
const list = v => (Array.isArray(v) ? v : [])

/** A complete card, whatever was stored. */
export function normaliseCard(raw = {}) {
  const c = raw && typeof raw === 'object' ? raw : {}
  return {
    title: str(c.title),
    purpose: str(c.purpose),
    example_label: str(c.example_label),
    sections: list(c.sections)
      .map((s, i) => ({
        key: str(s?.key) || `s${i + 1}`,
        title: str(s?.title),
        phase: PHASES.some(([k]) => k === s?.phase) ? s.phase : 'during',
        intro: str(s?.intro),
        fields: list(s?.fields)
          .map(f => ({
            label: str(f?.label),
            hint: str(f?.hint),
            example: str(f?.example),
            type: FIELD_TYPES.includes(f?.type) ? f.type : 'text',
            options: list(f?.options).map(str).filter(Boolean),
            // A field the salesperson must not leave empty before the deal
            // goes to the CRM.
            required: Boolean(f?.required),
          }))
          .filter(f => f.label),
      }))
      .filter(s => s.title && s.fields.length),
    objections: list(c.objections)
      .map(o => ({
        objection: str(o?.objection),
        why: str(o?.why),
        answer: str(o?.answer),
        proof: str(o?.proof),
        walk_away: str(o?.walk_away),
        example: str(o?.example),
      }))
      .filter(o => o.objection && o.answer),
  }
}

export const hasCard = raw => normaliseCard(raw).sections.length > 0

/** The card's sections grouped by phase, in call order, empty phases dropped. */
export function byPhase(card) {
  const c = normaliseCard(card)
  return PHASES
    .map(([key, label]) => ({ key, label, sections: c.sections.filter(s => s.phase === key) }))
    .filter(p => p.sections.length)
}

/** How many fields, and how many must be filled before the CRM. */
export function cardCounts(card) {
  const fields = normaliseCard(card).sections.flatMap(s => s.fields)
  return { fields: fields.length, required: fields.filter(f => f.required).length }
}

/**
 * The card as plain text, empty or filled — for pasting into WhatsApp, an
 * email or a note when the salesperson is not at the app.
 */
export function cardAsText(card, { filled = false } = {}) {
  const c = normaliseCard(card)
  const out = [c.title.toUpperCase(), c.purpose, '']
  for (const p of byPhase(c)) {
    out.push(`== ${p.label.toUpperCase()} ==`)
    for (const s of p.sections) {
      out.push(`-- ${s.title}`)
      for (const f of s.fields) {
        const mark = f.required ? '*' : ''
        const value = filled ? (f.example || '—') : (f.type === 'choice' && f.options.length ? `[${f.options.join(' / ')}]` : '______')
        out.push(`${mark}${f.label}: ${value}`)
      }
      out.push('')
    }
  }
  if (c.objections.length) {
    out.push('== OBJECTIONS ==')
    for (const o of c.objections) {
      out.push(`"${o.objection}" → ${o.answer}${o.proof ? ` (proof: ${o.proof})` : ''}${o.walk_away ? ` · walk away if: ${o.walk_away}` : ''}`)
      if (filled && o.example) out.push(`   on this deal: ${o.example}`)
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
