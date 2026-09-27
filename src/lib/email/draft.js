// ─── AI drafts for the Email section ───────────────────────────────────────
// Three options at a time, written from the Brand Brain (the cached brand
// block, via buildContext on the server) and whatever the research agent has
// found. Pure: the server builds the call from this, the tests check it.
//
// Two lanes, two very different jobs:
//   marketing  a short letter to people who know us — news, a project, an
//              event. Can carry a link and a little formatting.
//   cold       a first message to a stranger about THEIR project. Short, plain,
//              one question, no attachments, no hype. The research is the
//              whole reason for writing, so it leads.

export const DRAFT_IDENTITY = [
  'You write emails for one B2B company, in its own voice, from its Brand Brain.',
  '',
  'Rules that always apply:',
  '- Never invent facts: no made-up projects, clients, numbers, awards, prices or',
  '  dates. Use only what the brand block and the research notes say. If a detail',
  '  would help and you do not have it, write around it.',
  '- Never state prices. Never promise delivery times or discounts.',
  '- Write like a person at the company, not like an advertisement. No exclamation',
  '  marks in subject lines, no ALL CAPS, no "Dear Sir/Madam", no spam words',
  '  ("free", "guarantee", "act now", "limited time").',
  '- Formatting available in the body: blank line between paragraphs, **bold**,',
  '  [label](https://url), and "- " bullets. Nothing else: no HTML, no headings.',
  '- Merge tags available: {{first_name}}, {{company}}, {{job_title}}, {{city}}.',
  '  Give a fallback for a name, e.g. {{first_name|there}}. Use no other tags.',
  '- Do not write a signature block or an unsubscribe line. They are added when',
  '  the email is sent.',
  '- Arabic, when asked for, is natural Gulf business Arabic (فصحى مبسطة), not a',
  '  translation of English sentence structure.',
].join('\n')

export const DRAFT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['options'],
    properties: {
      options: {
        type: 'array',
        description: 'Exactly three distinct options: different angles, not rewordings of one email.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['angle', 'subject', 'preheader', 'body'],
          properties: {
            angle: { type: 'string', description: 'Four to eight words naming the angle, for the person choosing.' },
            subject: { type: 'string', description: 'Under 60 characters.' },
            preheader: { type: 'string', description: 'Marketing: the inbox preview line, under 90 characters. Cold: empty string.' },
            body: { type: 'string', description: 'The email body in the allowed formatting.' },
          },
        },
      },
    },
  },
}

function list(items, fmt, max) {
  return (items || []).slice(0, max).map(fmt).filter(Boolean).map(s => `- ${s}`).join('\n')
}

/**
 * The user turn for a draft request.
 *
 * @param {object} args
 * @param {'marketing'|'cold'} args.audience
 * @param {'en'|'ar'} args.language
 * @param {string} args.brief          what the person wants this email to do (may be empty)
 * @param {string} [args.current]      the draft already in the composer, to improve
 * @param {object} [args.contact]      cold: the prospect being written to
 * @param {object} [args.opportunity]  cold: the research lead behind them
 * @param {object} [args.research]     { opportunities, events, signals } recent findings
 */
export function draftPrompt({ audience, language = 'en', brief = '', current = null, contact = null, opportunity = null, research = {} }) {
  const lang = language === 'ar' ? 'Arabic' : 'English'
  const parts = []

  if (audience === 'cold') {
    parts.push(
      `Write three options for a FIRST cold email, in ${lang}, to a business prospect who has never heard from us.`,
      '',
      'A cold email that works here:',
      '- 60 to 120 words. Plain text. At most one link, and usually none.',
      '- Opens with THEIR situation (their project, tender, company), not with us.',
      '- One sentence on why we are relevant, grounded in the brand block.',
      '- Ends with one easy question (a short call, whether they are the right person,',
      '  whether lighting is decided yet). Never "buy now".',
      '- Subject: short, lower-key, specific, like a colleague would write. No emojis.',
      '- preheader must be an empty string.',
    )
  } else {
    parts.push(
      `Write three options for a marketing email, in ${lang}, to people who already know the company: customers, partners, consultants and contractors we have worked with.`,
      '',
      'What works here:',
      '- 90 to 200 words. One idea per email, one clear next step (a link or a reply).',
      '- Useful before promotional: a project, an application insight, an event, news.',
      '- Subject under 60 characters; preheader adds to it rather than repeating it.',
    )
  }

  if (brief.trim()) parts.push('', 'What the person asked for:', brief.trim())

  if (contact) {
    parts.push('', 'The prospect:', list([
      [contact.first_name, contact.last_name].filter(Boolean).join(' ') && `Name: ${[contact.first_name, contact.last_name].filter(Boolean).join(' ')}`,
      contact.job_title && `Role: ${contact.job_title}`,
      contact.company && `Company: ${contact.company}`,
      contact.contact_type && `Type: ${contact.contact_type}`,
      contact.city && `City: ${contact.city}`,
      contact.notes && `Notes: ${contact.notes}`,
    ], s => s, 10))
    parts.push('Write this one for them specifically: use their details directly rather than merge tags.')
  }

  if (opportunity) {
    parts.push('', 'The project behind this email (from our research):', list([
      `${opportunity.name}${opportunity.headline ? ` — ${opportunity.headline}` : ''}`,
      opportunity.client && `Client: ${opportunity.client}`,
      opportunity.contractor && `Contractor: ${opportunity.contractor}`,
      opportunity.consultant && `Consultant: ${opportunity.consultant}`,
      opportunity.location && `Location: ${opportunity.location}`,
      opportunity.stage && `Stage: ${opportunity.stage}`,
      opportunity.scope && `Scope: ${opportunity.scope}`,
    ], s => s, 10))
  }

  const r = research || {}
  const notes = [
    list(r.opportunities, o => `${o.name}${o.headline ? `: ${o.headline}` : ''}${o.location ? ` (${o.location})` : ''}`, 6),
    list(r.events, e => `${e.name}${e.start_date ? `, ${e.start_date}` : ''}${e.city ? `, ${e.city}` : ''}${e.recommendation ? ` — ${e.recommendation}` : ''}`, 5),
    list(r.signals, s => s.summary, 6),
  ].filter(Boolean)
  if (notes.length && audience === 'marketing') {
    parts.push('', 'This week from the research agent (use only if it fits; never name a competitor):', ...notes)
  }

  if (current && (current.subject || current.body)) {
    parts.push('', 'The current draft, to improve on (keep what is good about it):',
      `Subject: ${current.subject || ''}`, current.body || '')
  }

  parts.push('', 'Return exactly three options with different angles.')
  return parts.join('\n')
}

/** Parse and clean the model's JSON. Returns { ok, options, error }. */
export function parseDrafts(text) {
  let json
  try { json = JSON.parse(text) } catch { return { ok: false, options: [], error: 'The draft came back unreadable. Try again.' } }
  const options = (Array.isArray(json?.options) ? json.options : [])
    .map(o => ({
      angle: String(o?.angle || '').trim(),
      subject: String(o?.subject || '').trim(),
      preheader: String(o?.preheader || '').trim(),
      body: String(o?.body || '').trim(),
    }))
    .filter(o => o.subject && o.body)
    .slice(0, 3)
  return options.length
    ? { ok: true, options, error: '' }
    : { ok: false, options: [], error: 'No usable draft came back. Try again with a clearer brief.' }
}
