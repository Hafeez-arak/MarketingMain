import { describe, it, expect } from 'vitest'
import {
  greeting, cleanBlank, fillLine, buildReply, parseReply, replyRequest, replyUserPrompt, replyHtml,
  REPLY_SCHEMA, REPLY_TEMPLATE, REPLY_SIGNATURE,
} from './autoReply.js'
import { toEnvelope } from './qualify.js'

// Made-up leads only: this repo is public, real ones never go in it.
const company = { name: 'Arak Lighting' }
const emailLead = (over = {}) => ({ source: 'email', name: 'Omar Haddad', subject: 'RFQ – Lighting – Nour Towers', ...over })

describe('greeting', () => {
  it('uses a plain name, title-cased when it came in one case', () => {
    expect(greeting('Omar Haddad')).toBe('Dear Omar Haddad,')
    expect(greeting('OMAR HADDAD')).toBe('Dear Omar Haddad,')
    expect(greeting('omar al-haddad')).toBe('Dear Omar Al-Haddad,')
  })
  it('turns "Last, First" round and drops a "Company |" prefix', () => {
    expect(greeting('Haddad, Omar')).toBe('Dear Omar Haddad,')
    expect(greeting('Nour | OMAR HADDAD')).toBe('Dear Omar Haddad,')
  })
  it('shortens a long name to first and family name', () => {
    expect(greeting('Omar Saleh Ahmed Haddad')).toBe('Dear Omar Haddad,')
  })
  it('keeps an engineer or doctor title', () => {
    expect(greeting('eng.omar haddad')).toBe('Dear Eng. Omar Haddad,')
    expect(greeting('Dr Omar Haddad')).toBe('Dear Dr. Omar Haddad,')
  })
  it('falls back to Sir or Madam for anything that is not clearly a person', () => {
    for (const n of ['', null, 'omar@nour.sa', 'Nour Sales', 'Procurement Dept', 'Info', 'Omar 2', 'A B C D E F'])
      expect(greeting(n)).toBe('Dear Sir or Madam,')
  })
})

describe('cleanBlank', () => {
  it('keeps a plain topic and trims a trailing full stop', () => {
    expect(cleanBlank(' the lighting fixtures for Nour Towers. ')).toBe('the lighting fixtures for Nour Towers')
  })
  it('drops money, stock and delivery talk', () => {
    for (const s of ['a discount on 40 downlights', 'downlights at SAR 120 each', 'fixtures in stock', 'the delivery to Jeddah', '10% off', 'the best price'])
      expect(cleanBlank(s)).toBe('')
  })
  it('drops anything that carries a mask, markup or is too long', () => {
    expect(cleanBlank('the order for [NAME]')).toBe('')
    expect(cleanBlank('see [LINK:nour.sa]')).toBe('')
    expect(cleanBlank('<b>x</b>')).toBe('')
    expect(cleanBlank('x'.repeat(141))).toBe('')
  })
})

describe('fillLine', () => {
  it('uses the first complete alternative, else the next, else nothing', () => {
    expect(fillLine('About {topic}. || About it.', { topic: 'x' })).toBe('About x.')
    expect(fillLine('About {topic}. || About it.', { topic: '' })).toBe('About it.')
    expect(fillLine('Only {topic}.', { topic: '' })).toBeNull()
  })
})

describe('buildReply', () => {
  it('is the sales team\'s acknowledgement, "as soon as possible"', () => {
    const r = buildReply({ topic: 'the lighting fixtures for Nour Towers' }, emailLead(), { company })
    expect(r.text).toBe([
      'Dear Omar Haddad,',
      'Thank you for your enquiry regarding the lighting fixtures for Nour Towers.',
      'We have received your request, and our sales team is reviewing it now. A sales engineer will contact you as soon as possible.',
    ].join('\n\n'))
    expect(r.text).not.toMatch(/working day/)
  })
  it('says just "Thank you for your enquiry." with no topic', () => {
    expect(buildReply({ topic: '' }, emailLead(), { company }).text).toContain('Thank you for your enquiry.\n\nWe have received')
  })
  it('answers an email on its thread and a website enquiry with a new subject', () => {
    expect(buildReply({}, emailLead({ subject: 'FW: RE: RFQ 12' }), { company }).subject).toBe('RE: RFQ 12')
    expect(buildReply({}, { source: 'website_form', name: 'Omar' }, { company }).subject).toBe('Your enquiry to Arak Lighting')
  })
  it('the template is two paragraphs', () => {
    expect(REPLY_TEMPLATE).toHaveLength(2)
  })
})

describe('replyHtml', () => {
  it('ends with the info@ account\'s own signature, in its style', () => {
    const html = replyHtml('Dear Omar,\n\nThank you & welcome.')
    expect(html).toContain('>Dear Omar,</div>')
    expect(html).toContain('>Thank you &amp; welcome.</div>')
    expect(html.endsWith('>Best Regards,</div><div style="font-family:Aptos,Aptos_EmbeddedFont,Aptos_MSFontService,Calibri,Helvetica,sans-serif;font-size:12pt;color:rgb(0,0,0)">ARAK Lighting</div>')).toBe(true)
    expect(REPLY_SIGNATURE).toEqual(['Best Regards,', 'ARAK Lighting'])
  })
  it('never lets the text inject markup', () => {
    expect(replyHtml('<script>x</script>')).not.toContain('<script>')
  })
})

describe('the model call', () => {
  const env = toEnvelope('email', { name: 'Omar Haddad', email: 'omar@nour.sa', subject: 'RFQ', message: 'Dear team, please quote. Omar Haddad +966 50 111 2233' })
  it('never sends the name, address or phone', () => {
    const p = replyUserPrompt(env, { summary: 'Quote fixtures.' })
    expect(p).not.toMatch(/Omar|Haddad|111 2233|omar@/)
    expect(p).toContain('Summary: Quote fixtures.')
  })
  it('asks DeepSeek for the schema, with no temperature', () => {
    const body = replyRequest(env, {}, { companyName: 'Arak Lighting' })
    expect(body.model).toBe('deepseek/deepseek-v4.1-flash')
    expect(body.response_format.json_schema).toBe(REPLY_SCHEMA)
    expect(body).not.toHaveProperty('temperature')
    expect(body.messages[0].content).toContain('Arak Lighting')
  })
  it('reads the topic; an unsafe or unreadable one is empty', () => {
    expect(parseReply('```json\n{"topic":"a KNX system."}\n```')).toEqual({ topic: 'a KNX system', dropped: false, valid: true })
    expect(parseReply('{"topic":"the best price for 40 downlights"}')).toEqual({ topic: '', dropped: true, valid: true })
    expect(parseReply('sorry')).toMatchObject({ topic: '', valid: false })
  })
})
