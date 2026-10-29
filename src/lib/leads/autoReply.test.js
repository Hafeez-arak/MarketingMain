import { describe, it, expect } from 'vitest'
import {
  greeting, cleanBlank, checkFields, fillLine, buildReply, parseReply, replyRequest, replyUserPrompt,
  ARAK_FORMATS, FORMAT_IDS, REPLY_SCHEMA,
} from './autoReply.js'
import { toEnvelope } from './qualify.js'

// Made-up leads only: this repo is public, real ones never go in it.
const company = { name: 'Arak Lighting', phone: '+966 11 000 0000' }
const emailLead = (over = {}) => ({ source: 'email', name: 'Omar Haddad', subject: 'RFQ – Lighting – Nour Towers', ...over })
const fields = (over = {}) => ({ topic: '', documents: '', submission_date: '', missing: [], ...over })

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

describe('checkFields', () => {
  it('keeps good blanks and records the ones it dropped', () => {
    const r = checkFields({ kind: 'project_package', topic: 'the Nour Towers lighting package', documents: 'BOQ', submission_date: '5 Nov, best price', missing: [] })
    expect(r.format).toBe('next_steps')
    expect(r.fields).toEqual({ topic: 'the Nour Towers lighting package', documents: 'BOQ', submission_date: '', missing: [] })
    expect(r.dropped).toEqual(['submission_date'])
  })
  it('picks the reply from the kind of enquiry, in code', () => {
    expect(checkFields({ kind: 'control_system', landmark: true }).format).toBe('call')
    expect(checkFields({ kind: 'project_package', landmark: true }).format).toBe('introduce')
    expect(checkFields({ kind: 'project_package', landmark: false }).format).toBe('next_steps')
    expect(checkFields({ kind: 'items', landmark: true }).format).toBe('acknowledge')
    expect(checkFields({ kind: 'unclear', missing: ['the quantities'] }).format).toBe('missing_details')
  })
  it('turns "unclear" with nothing safe to ask, or an unknown kind, into acknowledge', () => {
    expect(checkFields({ kind: 'unclear', missing: ['the price list'] }).format).toBe('acknowledge')
    expect(checkFields({ kind: 'sell_harder' })).toMatchObject({ kind: 'items', format: 'acknowledge' })
  })
  it('takes only a real date as the deadline, and softens capitals', () => {
    expect(checkFields({ submission_date: 'ASAP' })).toMatchObject({ fields: { submission_date: '' }, dropped: ['submission_date'] })
    expect(checkFields({ submission_date: '27 OCT 2026' }).fields.submission_date).toBe('27 Oct 2026')
    expect(checkFields({ submission_date: 'NOVEMBER 12, 2026' }).fields.submission_date).toBe('November 12, 2026')
  })
  it('keeps at most three missing items', () => {
    expect(checkFields({ kind: 'unclear', missing: ['the a', 'the b', 'the c', 'the d'] }).fields.missing).toHaveLength(3)
  })
})

describe('fillLine', () => {
  it('uses the first complete alternative, else the next, else nothing', () => {
    expect(fillLine('About {topic}. || About it.', { topic: 'x' })).toBe('About x.')
    expect(fillLine('About {topic}. || About it.', { topic: '' })).toBe('About it.')
    expect(fillLine('Date {submission_date}.', { submission_date: '' })).toBeNull()
  })
  it('turns a list blank into one line per item', () => {
    expect(fillLine('• {missing}', { missing: ['the a', 'the b'] })).toBe('• the a\n• the b')
  })
})

describe('buildReply', () => {
  it('writes every format with no blank left unfilled', () => {
    const full = fields({ topic: 'the Nour Towers lighting', documents: 'BOQ', submission_date: '5 November', missing: ['the quantities'] })
    for (const format of FORMAT_IDS) {
      const r = buildReply({ format, fields: full }, emailLead(), { company })
      expect(r.text).not.toMatch(/[{}]|\|\|/)
      expect(r.text.startsWith('Dear Omar Haddad,\n\n')).toBe(true)
    }
  })
  it('falls back to the plain wording when a blank is empty', () => {
    const r = buildReply({ format: 'next_steps', fields: fields() }, emailLead(), { company })
    expect(r.text).toContain('Thank you for your request for quotation. Here is what happens next:')
    expect(r.text).toContain('1. Our engineers review your requirements against the brands we carry.')
    expect(r.text).not.toContain('submission date')
  })
  it('fills the company name and phone', () => {
    expect(buildReply({ format: 'call', fields: fields() }, emailLead(), { company }).text).toContain('call us on +966 11 000 0000.')
    expect(buildReply({ format: 'introduce', fields: fields() }, emailLead(), { company }).text).toContain('Thank you for considering Arak Lighting.')
  })
  it('answers an email on its thread and a website enquiry with a new subject', () => {
    expect(buildReply({ format: 'acknowledge', fields: fields() }, emailLead({ subject: 'FW: RE: RFQ 12' }), { company }).subject).toBe('RE: RFQ 12')
    expect(buildReply({ format: 'acknowledge', fields: fields() }, { source: 'website_form', name: 'Omar' }, { company }).subject).toBe('Your enquiry to Arak Lighting')
  })
  it('has the five formats the owner approved', () => {
    expect(Object.keys(ARAK_FORMATS)).toEqual(FORMAT_IDS)
  })
})

describe('the model call', () => {
  const env = toEnvelope('email', { name: 'Omar Haddad', email: 'omar@nour.sa', subject: 'RFQ', message: 'Dear team, please quote. Omar Haddad +966 50 111 2233' })
  it('never sends the name, address or phone', () => {
    const p = replyUserPrompt(env, { summary: 'Quote fixtures.' })
    expect(p).not.toMatch(/Omar|Haddad|111 2233|omar@/)
    expect(p).toContain('Summary: Quote fixtures.')
  })
  it('asks for the schema, with no temperature (Luna refuses one)', () => {
    const body = replyRequest(env, {}, { companyName: 'Arak Lighting' })
    expect(body.response_format.json_schema).toBe(REPLY_SCHEMA)
    expect(body).not.toHaveProperty('temperature')
    expect(body.messages[0].content).toContain('Arak Lighting')
  })
  it('reads the answer, and an unreadable one is the plain acknowledgement', () => {
    expect(parseReply('```json\n{"kind":"control_system","landmark":false,"topic":"a KNX system","documents":"","missing":[],"submission_date":"","why":"controls"}\n```'))
      .toMatchObject({ format: 'call', kind: 'control_system', fields: { topic: 'a KNX system' }, why: 'controls', valid: true })
    expect(parseReply('sorry')).toMatchObject({ format: 'acknowledge', valid: false })
  })
})
