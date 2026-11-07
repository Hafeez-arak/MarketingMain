// ─── The sales playbook: situation battle cards ────────────────────────────
// The owner's template (2026-11-03, built 2026-11-07 as Part 2): a library
// of cards, one per situation a salesperson meets on a call, each with
//
//   title · category · stage · trigger (when to use) · what the customer says
//   · the objective · the response · the follow-up question · the evidence
//   · the next step · what to avoid · owner · last reviewed
//
// in five categories: discovery, objection, competitor, buyer persona,
// closing. The cards are the company's own data (playbook_cards), since they
// name real deals. A lead's battle card shows the few whose signals match
// the lead (matchPlaybook), and the Odoo brief carries them (playbookHtml).
//
// Pure. No network.

const str = (v) => String(v ?? '').trim()
const list = (v) => (Array.isArray(v) ? v : [])
const clip = (s, n) => str(s).slice(0, n)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))

export const CATEGORIES = {
  discovery: 'Discovery',
  objection: 'Objection handling',
  competitor: 'Competitor',
  persona: 'Buyer persona',
  closing: 'Closing',
}

/**
 * The signals a card can be shown on, in words (for the edit form). The keys
 * are leadSignals' (src/lib/sales/leadCard.js) and a few more from the lead's
 * state (playbookKeys).
 */
export const PLAYBOOK_SIGNALS = {
  always: 'Every lead',
  project: 'Project quote',
  quick: 'Quick quote',
  tender: 'Tender',
  bidding: 'Still bidding',
  awarded: 'Awarded (JIH)',
  price_pressure: 'Asks for a discount / best price',
  urgent: 'Urgent',
  submittals: 'Wants documents, samples, prequalification',
  controls: 'Lighting controls',
  brand_known: 'Brand named',
  brand_not_ours: 'Brand we do not carry',
  brand_equivalent: 'Equivalents accepted',
  existing_customer: 'Existing customer',
  repeat_sender: 'Wrote to us before',
  new_sender: 'New to us',
  sender_contractor: 'Contractor',
  sender_consultant: 'Consultant / designer',
  sender_developer_owner: 'Developer / owner',
  quote_sent: 'Quote sent',
  stage_negotiating: 'Negotiating',
  stage_lost: 'Lost',
  decision_decline: 'Decided to decline',
}

/**
 * The keys a lead answers to: its signals that are true, its sender type,
 * its stage and decision, and whether the quote has gone out.
 */
export function playbookKeys(signals = {}, { senderType = '', stage = '', decision = '', quoteSent = false } = {}) {
  const keys = new Set(Object.entries(signals || {}).filter(([, v]) => v === true).map(([k]) => k))
  if (str(senderType)) keys.add(`sender_${str(senderType)}`)
  if (str(stage)) keys.add(`stage_${str(stage)}`)
  if (str(decision)) keys.add(`decision_${str(decision)}`)
  if (quoteSent) keys.add('quote_sent')
  return keys
}

/**
 * The cards for one lead, best first: those with the most signals the lead
 * answers to, then by the library's order. "Every lead" alone never wins a
 * place over a card that matched something real.
 */
export function matchPlaybook(cards = [], keys = new Set(), { limit = 3 } = {}) {
  const scored = []
  for (const c of list(cards)) {
    const sig = list(c.signals).map(str).filter(Boolean)
    const hits = sig.filter((s) => s !== 'always' && keys.has(s)).length
    const always = sig.includes('always')
    if (!hits && !always) continue
    scored.push({ c, score: hits * 10 + (always ? 1 : 0) })
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.c.position ?? 0) - (b.c.position ?? 0))
    .slice(0, limit)
    .map((s) => s.c)
}

/** A card as sent by the edit form, checked. Returns { values } or { error }. */
export function playbookCardFields(body = {}) {
  const title = clip(body.title, 200)
  if (!title) return { error: 'Give the card a title.' }
  const category = str(body.category)
  if (!CATEGORIES[category]) return { error: 'Pick the card\'s category.' }
  const avoid = (Array.isArray(body.avoid) ? body.avoid : str(body.avoid).split('\n')).map((a) => clip(a, 400)).filter(Boolean).slice(0, 8)
  const signals = [...new Set(list(body.signals).map(str).filter((s) => PLAYBOOK_SIGNALS[s]))]
  return {
    values: {
      title, category,
      stage: clip(body.stage, 120),
      trigger: clip(body.trigger, 1000),
      statement: clip(body.statement, 600),
      objective: clip(body.objective, 1000),
      response: clip(body.response, 2000),
      follow_up: clip(body.follow_up, 1000),
      evidence: clip(body.evidence, 2000),
      source: clip(body.source, 200),
      next_step: clip(body.next_step, 1000),
      avoid,
      signals,
    },
  }
}

/** "3 Nov 2026" for a review date, or ''. */
export function reviewedOn(ts) {
  const d = new Date(ts || '')
  return Number.isNaN(d.getTime()) || !ts ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Riyadh' })
}

/** Does a card need a look? Draft, or not reviewed in 90 days. */
export function needsReview(card, now = new Date()) {
  if (card?.status !== 'approved' || !card?.reviewed_at) return true
  return now.getTime() - new Date(card.reviewed_at).getTime() > 90 * 86_400_000
}

/** Search the library: every word must appear somewhere on the card. */
export function searchPlaybook(cards = [], q = '', { category = '', stage = '' } = {}) {
  const words = str(q).toLowerCase().split(/\s+/).map((w) => w.replace(/["'“”]/g, '')).filter(Boolean)
  return list(cards).filter((c) => {
    if (category && c.category !== category) return false
    if (stage && !str(c.stage).toLowerCase().includes(stage.toLowerCase())) return false
    if (!words.length) return true
    const hay = [c.title, CATEGORIES[c.category], c.stage, c.trigger, c.statement, c.objective, c.response, c.follow_up, c.evidence, c.next_step, ...list(c.avoid), ...list(c.signals).map((s) => PLAYBOOK_SIGNALS[s] || s)].join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** The stages the library uses, for the filter: "RFQ → Technical submittal" counts as both. */
export function playbookStages(cards = []) {
  const out = new Set()
  for (const c of list(cards)) for (const s of str(c.stage).split(/\s*(?:\/|→|->)\s*/)) if (str(s)) out.add(str(s))
  return [...out]
}

/**
 * The matched cards for the lead's Internal Notes in Odoo: each as what to
 * say, what to ask, and what not to do. HTML, every value escaped. '' with none.
 */
export function playbookHtml(cards = []) {
  const shown = list(cards).filter((c) => str(c.title) && str(c.response))
  if (!shown.length) return ''
  const row = (label, value) => (str(value) ? `<tr><td style="padding:2px 14px 2px 0;white-space:nowrap;vertical-align:top"><b>${esc(label)}</b></td><td style="padding:2px 0">${esc(value).replace(/\n/g, '<br>')}</td></tr>` : '')
  return [
    '<p><b>3. PLAYBOOK CARDS FOR THIS LEAD</b></p>',
    ...shown.map((c) => [
      `<p><b>${esc(c.title)}</b> · ${esc(CATEGORIES[c.category] || c.category)}${c.status === 'approved' ? '' : ' · draft'}</p>`,
      `<table><tbody>${row('Say', c.response)}${row('Then ask', c.follow_up)}${row('Next step', c.next_step)}${row('Avoid', list(c.avoid).join(' · '))}</tbody></table>`,
    ].join('')),
  ].join('')
}
