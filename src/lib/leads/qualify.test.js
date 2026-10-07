import { describe, it, expect } from 'vitest'
import {
  toEnvelope, emailKind, maskText, maskedEnquiry, findDuplicate, parseTime,
  systemPrompt, userPrompt, buildMessages, parseVerdict, sheetColumns, CATEGORIES, VERDICT_SCHEMA,
  openRouterRequest, QUALIFIER_MODEL,
} from './qualify.js'

// Made-up enquiries only: this repo is public, real ones never go in it.
const form = (over = {}) => toEnvelope('website_form', {
  received: '2026-09-13 11:32:33', name: 'Omar Haddad', company: 'Nour Contracting',
  email: 'Omar@NourContracting.sa', phone: '+966 50 111 2233', projectType: 'Commercial / office',
  brief: 'We need a quote for 40 downlights for our office in Riyadh.', lang: 'en', ...over,
})

describe('toEnvelope', () => {
  it('maps the website form and lower-cases the email', () => {
    const e = form()
    expect(e).toMatchObject({ source: 'website_form', email: 'omar@nourcontracting.sa', subject: 'Commercial / office', language: 'en' })
    expect(e.sourceRef).toBe('2026-09-13 11:32:33|omar@nourcontracting.sa')
  })
  it('treats anything but "ar" as English', () => {
    expect(form({ lang: 'ar' }).language).toBe('ar')
    expect(form({ lang: '' }).language).toBe('en')
  })
})

describe('emailKind', () => {
  it('tells company, free and missing apart', () => {
    expect(emailKind('a@besix.com')).toBe('company')
    expect(emailKind('a@Gmail.com')).toBe('free')
    expect(emailKind('')).toBe('none')
  })
})

describe('maskText', () => {
  it('removes emails, links and phone numbers in every common shape', () => {
    const t = maskText('Mail me at x.y@firm.com or see www.firm.com, call +966 55 325 1417, 0553251417 or 011-465-0000.')
    expect(t).toBe('Mail me at [EMAIL] or see [LINK] call [PHONE], [PHONE] or [PHONE].')
  })
  it('keeps product codes, quantities, voltages and dates', () => {
    const t = 'Product Code: EE-TA-WT/WTSTD14-27-90-10-1050, Qty: 4 PCS, 110-220VAC, 2160LM, 300 PCS, deadline 2026-10-20'
    expect(maskText(t)).toBe(t)
  })
  it("removes the sender's own name wherever it appears, any case, any script", () => {
    expect(maskText('Best regards,\nBILAL Ulubay\nFounder', { name: 'Bilal ULUBAY' })).toBe('Best regards,\n[NAME] [NAME]\nFounder')
    expect(maskText('مع تحيات محمد الظاهر', { name: 'محمد الظاهر' })).toBe('مع تحيات [NAME] [NAME]')
  })
  it('does not eat words that merely contain the name', () => {
    expect(maskText('Omari Street project', { name: 'Omar' })).toBe('Omari Street project')
  })
})

describe('maskedEnquiry', () => {
  it('never carries the name, address or phone, but keeps company and domain', () => {
    const m = maskedEnquiry(form({ brief: 'Omar here, call me on 0501112233. Quote for 40 downlights.' }))
    expect(JSON.stringify(m)).not.toMatch(/Omar|0501112233|omar@|111 2233/)
    expect(m).toMatchObject({ company: 'Nour Contracting', emailDomain: 'nourcontracting.sa', emailKind: 'company', gavePhone: true })
    expect(m.message).toBe('[NAME] here, call me on [PHONE]. Quote for 40 downlights.')
  })
})

describe('parseTime', () => {
  it('reads single-digit hours as Riyadh time', () => {
    expect(new Date(parseTime('2026-09-10 9:18:46')).toISOString()).toBe('2026-09-10T06:18:46.000Z')
  })
})

describe('findDuplicate', () => {
  const first = form()
  it('catches the same sender sending the same text a minute later', () => {
    expect(findDuplicate(form({ received: '2026-09-13 11:33:38' }), [first])).toBe(first)
  })
  it('ignores itself, other senders, different messages and old ones', () => {
    expect(findDuplicate(first, [first])).toBeNull()
    expect(findDuplicate(form({ received: '2026-09-13 11:40:00', email: 'other@x.sa' }), [first])).toBeNull()
    expect(findDuplicate(form({ received: '2026-09-13 12:00:00', brief: 'Do you install KNX in villas?' }), [first])).toBeNull()
    expect(findDuplicate(form({ received: '2026-10-01 10:00:00' }), [first])).toBeNull()
  })
  it('catches a resend with a typo, in English or Arabic spelling variants', () => {
    const a = form({ brief: 'outdoor lightng for villa' })
    expect(findDuplicate(form({ brief: 'outdoor lighting for villa', received: '2026-09-13 12:02:00' }), [a])).toBe(a)
    const b = form({ brief: 'انارة خارجية' })
    expect(findDuplicate(form({ brief: 'انارات خارجيه', received: '2026-09-13 12:02:00' }), [b])).toBe(b)
  })
  it('two short but different requests are not duplicates', () => {
    const a = form({ brief: 'outdoor lighting' })
    expect(findDuplicate(form({ brief: 'indoor lighting', received: '2026-09-13 12:02:00' }), [a])).toBeNull()
  })
  it('falls back to the phone when there is no email', () => {
    const a = form({ email: '' })
    expect(findDuplicate(form({ email: '', received: '2026-09-13 12:00:00' }), [a])).toBe(a)
  })
})

describe('prompts', () => {
  it('system prompt names every category and holds nothing per enquiry', () => {
    const p = systemPrompt({ companyName: 'ARAK', offering: 'Indoor lighting, KNX automation' })
    for (const c of Object.keys(CATEGORIES)) expect(p).toContain(`- ${c}:`)
    expect(p).toContain('Indoor lighting, KNX automation')
    expect(p).not.toMatch(/20\d\d/)
  })
  it('the messages sent to the model contain no personal details', () => {
    const sent = JSON.stringify(buildMessages(form({ brief: 'Omar Haddad, omar@nourcontracting.sa, +966501112233: need 40 downlights' })))
    expect(sent).not.toMatch(/Omar|Haddad|omar@|501112233/)
    expect(sent).toContain('need 40 downlights')
  })
  it('user prompt marks missing fields plainly', () => {
    const u = userPrompt(maskedEnquiry(form({ company: '', email: 'a@gmail.com', phone: '' })))
    expect(u).toContain('Company: (not given)')
    expect(u).toContain('gmail.com (free email)')
    expect(u).toContain('Gave a phone number: no')
  })
  it('schema enum is exactly the category list', () => {
    expect(VERDICT_SCHEMA.schema.properties.category.enum).toEqual(Object.keys(CATEGORIES))
  })
})

describe('openRouterRequest', () => {
  it('asks GPT-6 Luna, privately, for the schema, with no temperature and no personal details', () => {
    const body = openRouterRequest(form(), { companyName: 'ARAK', offering: 'Indoor lighting' })
    expect(body.model).toBe(QUALIFIER_MODEL)
    expect(QUALIFIER_MODEL).toBe('openai/gpt-6-luna')
    expect(body).not.toHaveProperty('temperature')
    expect(body.provider).toEqual({ data_collection: 'deny', require_parameters: true })
    expect(body.response_format.json_schema).toBe(VERDICT_SCHEMA)
    expect(JSON.stringify(body)).not.toMatch(/Omar|Haddad|omar@|111 2233/)
  })
  it('lets a caller try another model', () => {
    expect(openRouterRequest(form(), {}, { model: 'z-ai/glm-5.3-flash' }).model).toBe('z-ai/glm-5.3-flash')
  })
})

describe('parseVerdict', () => {
  const reply = (o) => JSON.stringify({ category: 'quotation_request', confidence: 'high', reason: 'Asks for prices.', summary: '40 downlights', details: { products: 'downlights', quantity: '40' }, ask_next: ['a', 'b', 'c', 'd'], ...o })
  it('derives the verdict from the category', () => {
    expect(parseVerdict(reply()).verdict).toBe('qualified')
    expect(parseVerdict(reply({ category: 'vendor_pitch' })).verdict).toBe('unqualified')
    expect(parseVerdict(reply({ category: 'partnership_offer' })).verdict).toBe('unqualified')
    expect(parseVerdict(reply({ category: 'existing_customer_support' })).verdict).toBe('needs_review')
  })
  it('low confidence either way goes to a person instead', () => {
    expect(parseVerdict(reply({ category: 'job_or_recruitment', confidence: 'low' })).verdict).toBe('needs_review')
    expect(parseVerdict(reply({ category: 'project_enquiry', confidence: 'low' })).verdict).toBe('needs_review')
    expect(parseVerdict(reply({ category: 'project_enquiry', confidence: 'medium' })).verdict).toBe('qualified')
  })
  it('pitches, partnerships and marketing offers stay unqualified even when unsure', () => {
    for (const category of ['vendor_pitch', 'marketing_pitch', 'partnership_offer']) {
      expect(parseVerdict(reply({ category, confidence: 'low' })).verdict).toBe('unqualified')
    }
  })
  it('fills missing detail keys, trims ask_next to three, and strips code fences', () => {
    const v = parseVerdict('```json\n' + reply() + '\n```')
    expect(v.details).toEqual({ products: 'downlights', brands: '', quantity: '40', location: '', stage: '', urgency: '' })
    expect(v.ask_next).toEqual(['a', 'b', 'c'])
    expect(v.valid).toBe(true)
  })
  it('an unknown category or broken reply never throws and lands with a person', () => {
    expect(parseVerdict(reply({ category: 'buyer' }))).toMatchObject({ verdict: 'needs_review', category: 'unclear', valid: false })
    expect(parseVerdict('sorry, I cannot')).toMatchObject({ verdict: 'needs_review', valid: false })
  })
})

describe('sheetColumns', () => {
  it('writes two short cells', () => {
    expect(sheetColumns(parseVerdict(JSON.stringify({ category: 'vendor_pitch', confidence: 'high', reason: 'Sells chandeliers to us.' }))))
      .toEqual(['unqualified', 'vendor pitch: Sells chandeliers to us.'])
    expect(sheetColumns(null, { receivedAt: '2026-09-13 11:32:33' })[0]).toBe('duplicate')
  })
})
