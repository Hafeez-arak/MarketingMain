import { describe, it, expect } from 'vitest'
import {
  toEnvelope, emailKind, maskText, maskedEnquiry, findDuplicate, parseTime,
  systemPrompt, userPrompt, buildMessages, parseVerdict, sheetColumns, CATEGORIES, VERDICT_SCHEMA,
  openRouterRequest, QUALIFIER_MODEL, verdictColumns, websiteDomain, websiteLine, PHILIPS, CRITERIA_VERSION, cleanPhone,
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
  it('drops a phone cell that is a spreadsheet error or has no digits', () => {
    expect(form({ phone: '#ERROR!' }).phone).toBe('')
    expect(form({ phone: '#NAME?' }).phone).toBe('')
    expect(form({ phone: 'n/a' }).phone).toBe('')
    expect(form().phone).toBe('+966 50 111 2233')
    expect(toEnvelope('email', { sourceRef: 'x', phone: ' #ERROR! ' }).phone).toBe('')
    expect(cleanPhone(' 0501112233 ')).toBe('0501112233')
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
    expect(t).toBe('Mail me at [EMAIL@firm.com] or see [LINK:firm.com], call [PHONE], [PHONE] or [PHONE].')
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
  const reply = (o) => JSON.stringify({ category: 'quotation_request', confidence: 'high', reason: 'Asks for prices.', summary: '40 downlights', details: { products: 'downlights', quantity: '40' }, ask_next: ['a', 'b', 'c', 'd'], source_check: 'verified', sender_type: 'contractor', sender_confidence: 'high', philips: 'none', ...o })
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

describe('the sales team\'s criteria (2026-10-11)', () => {
  const reply = (o) => JSON.stringify({
    category: 'quotation_request', confidence: 'high', reason: 'Asks for prices.', summary: 's', details: {}, ask_next: [],
    sender_type: 'contractor', sender_confidence: 'high', sender_evidence: 'Procurement, Nour Contracting',
    source_check: 'verified', source_evidence: 'signature', project_type: 'not_stated', project_evidence: '',
    request_type: 'requirement', philips: 'none', ...o,
  })
  it('Philips only is not a lead; Philips with other items, or "or equivalent", is', () => {
    expect(parseVerdict(reply({ philips: 'only' }))).toMatchObject({ verdict: 'unqualified', rule: 'philips_only' })
    expect(parseVerdict(reply({ philips: 'mixed' })).verdict).toBe('qualified')
    expect(parseVerdict(reply({ philips: 'or_equivalent' })).verdict).toBe('qualified')
  })
  it('a trader from the market is a lead, labelled as one (the owner, 2026-10-11)', () => {
    expect(parseVerdict(reply({ sender_type: 'trader' }))).toMatchObject({ verdict: 'qualified', rule: '', senderType: 'trader' })
  })
  it('a source nobody can verify goes to a person, never out', () => {
    expect(parseVerdict(reply({ source_check: 'not_verified' }))).toMatchObject({ verdict: 'needs_review', rule: 'unverified' })
    expect(parseVerdict(reply({ source_check: undefined })).verdict).toBe('needs_review')
  })
  it('the rules only touch would-be leads: a pitch stays a pitch', () => {
    expect(parseVerdict(reply({ category: 'vendor_pitch', philips: 'only', source_check: 'not_verified' }))).toMatchObject({ verdict: 'unqualified', rule: '' })
  })
  it('a phase with no words behind it is not stated; unknown values fall back safely', () => {
    expect(parseVerdict(reply({ project_type: 'tender', project_evidence: '' })).projectType).toBe('not_stated')
    expect(parseVerdict(reply({ project_type: 'jih', project_evidence: 'project awarded' })).projectType).toBe('jih')
    expect(parseVerdict(reply({ sender_type: 'wizard', request_type: 'x', philips: 'maybe' }))).toMatchObject({ senderType: 'unknown', requestType: 'none', philips: 'none' })
  })
  it('the stored columns: empty phase for sales to fill, the rule in the reason, folder and email kind', () => {
    const v = parseVerdict(reply({ source_check: 'not_verified', request_type: 'inquiry' }))
    const c = verdictColumns(v, { site: { domain: 'nour.sa', ok: true }, folder: 'junk', email: 'a@gmail.com' })
    expect(c).toMatchObject({ verdict: 'needs_review', rule: 'unverified', project_type: '', request_type: 'inquiry', website: 'nour.sa', folder: 'junk', email_kind: 'free', criteria_version: CRITERIA_VERSION })
    expect(c.reason).toBe('Source not verified. Asks for prices.')
  })
  it('the schema asks for every criteria field', () => {
    for (const k of ['sender_type', 'source_check', 'project_type', 'request_type', 'philips']) expect(VERDICT_SCHEMA.schema.required).toContain(k)
    expect(VERDICT_SCHEMA.schema.properties.philips.enum).toEqual(PHILIPS)
  })
})

describe('websiteDomain', () => {
  const env = (email, message = '') => toEnvelope('email', { sourceRef: 'x', email, message })
  it("is the sender's own domain when it is a company address", () => {
    expect(websiteDomain(env('buyer@Besix.com'))).toBe('besix.com')
  })
  it('for a free-mail sender, is the company site named in the signature, skipping social links', () => {
    expect(websiteDomain(env('ali@gmail.com', 'Regards\nlinkedin.com/in/ali\nwww.nour-contracting.sa'))).toBe('nour-contracting.sa')
    expect(websiteDomain(env('ali@gmail.com', 'Regards, Ali (ali.n@nour-contracting.sa)'))).toBe('nour-contracting.sa')
    expect(websiteDomain(env('ali@gmail.com', 'need price'))).toBe('')
  })
  it('never one of our own domains', () => {
    expect(websiteDomain(env('ali@gmail.com', 'sent to info@example-co.sa'), { ownDomains: ['example-co.sa'] })).toBe('')
  })
})

describe('the website line in the prompt', () => {
  it('says what was checked, or why nothing was', () => {
    expect(websiteLine(null)).toContain('(none')
    expect(websiteLine({ domain: 'x.sa', ok: false })).toBe('Website checked: x.sa (could not be opened)')
    expect(websiteLine({ domain: 'x.sa', ok: true, title: 'Nour Contracting', description: 'MEP contractor', text: 'Projects' })).toContain('Website says: Nour Contracting | MEP contractor | Projects')
  })
  it('reaches the model with domains kept but personal details masked', () => {
    const sent = JSON.stringify(buildMessages(form({ brief: 'Omar Haddad, omar@nourcontracting.sa, www.nourcontracting.sa' }), {}, { domain: 'nourcontracting.sa', ok: true, title: 'Nour' }))
    expect(sent).not.toMatch(/Omar|Haddad|omar@/)
    expect(sent).toContain('[EMAIL@nourcontracting.sa]')
    expect(sent).toContain('[LINK:nourcontracting.sa]')
    expect(sent).toContain('Website checked: nourcontracting.sa')
  })
})

describe('extractPhones', () => {
  it('lists every number in a signature once, in order, keeping how it was written', async () => {
    const { extractPhones } = await import('./qualify.js')
    const sig = 'Best regards,\nOmar\nT: +966 11 465 0000 | M: 055 325 1417\nMob. 0553251417\nFax 011-465-0001'
    expect(extractPhones(sig)).toEqual(['+966 11 465 0000', '055 325 1417', '011-465-0001'])
  })
  it('reads Arabic digits and Arabic labels', async () => {
    const { extractPhones } = await import('./qualify.js')
    expect(extractPhones('جوال: ٠٥٥٣٢٥١٤١٧')).toEqual(['0553251417'])
  })
  it('leaves RFQ, PO and product numbers, dates and quantities alone', async () => {
    const { extractPhones } = await import('./qualify.js')
    expect(extractPhones('RFQ 4500997042, PO 450099, item WTSTD14-27-90-10-1050, deadline 2026-10-20, 300 pcs')).toEqual([])
  })
})

describe('phones from signature pictures', () => {
  it('asks for the numbers in at most three images, privately, by schema', async () => {
    const { phonesFromImagesRequest, PHONES_SCHEMA } = await import('./qualify.js')
    const body = phonesFromImagesRequest([1, 2, 3, 4].map((i) => ({ contentType: 'image/png', base64: `AAA${i}` })))
    expect(body.messages[0].content.filter((c) => c.type === 'image_url')).toHaveLength(3)
    expect(body.messages[0].content[1].image_url.url).toBe('data:image/png;base64,AAA1')
    expect(body.provider.data_collection).toBe('deny')
    expect(body.response_format.json_schema).toBe(PHONES_SCHEMA)
  })
  it('keeps only real numbers from the reply, and merges lists without repeats', async () => {
    const { parsePhones, mergePhones } = await import('./qualify.js')
    expect(parsePhones('{"phones":["+966 55 325 1417","2026-10-20","Riyadh"]}')).toEqual(['+966 55 325 1417'])
    expect(parsePhones('not json')).toEqual([])
    expect(mergePhones(['+966553251417'], ['055 325 1417', '011 465 0000'])).toEqual(['+966553251417', '011 465 0000'])
  })
})

describe('warning signs, checked in code (2026-10-25)', async () => {
  const { senderAddress, redirectLinks, baseDomain, namesSomething, warningSigns, decidedBeforeModel, codeVerdict, SENDER_FITS } = await import('./qualify.js')
  const phish = await import('./fixtures/phishingRfq.js')
  const reply = (o = {}) => JSON.stringify({ ...phish.MODEL_REPLY, ...o })

  describe('senderAddress', () => {
    it('keeps one real address, lower-cased, and cleans harmless wrapping', () => {
      expect(senderAddress('Omar@NourContracting.sa')).toEqual({ email: 'omar@nourcontracting.sa', problem: '' })
      expect(senderAddress('<omar@nour.sa>')).toEqual({ email: 'omar@nour.sa', problem: '' })
      expect(senderAddress('mailto:omar@nour.sa.')).toEqual({ email: 'omar@nour.sa', problem: '' })
      expect(senderAddress('first.last+rfq@mail.besix.com.sa').email).toBe('first.last+rfq@mail.besix.com.sa')
    })
    it('rejects the phishing chain outright, never "repairing" it to the address at its end', () => {
      expect(senderAddress(phish.RAW_FROM)).toEqual({ email: '', problem: 'not_an_address' })
    })
    it('rejects slashes, URL encoding, query strings, two @, spaces and tracking hosts', () => {
      for (const bad of ['a/b@x.sa', 'a%40b@x.sa', 'a?x=1@x.sa', 'a@b@x.sa', 'a b@x.sa', 'click@awstrack.me', 'https://x.sa/a@x.sa', 'a@x', 'a..b@x.sa']) {
        expect(senderAddress(bad).problem).toBe('not_an_address')
      }
      expect(senderAddress('').problem).toBe('missing')
    })
  })

  describe('redirectLinks', () => {
    it('finds tracking services and links that carry another site in their path', () => {
      expect(redirectLinks(phish.RAW_FROM)).toContain('x1abc2d3.r.us_west_2.awstrack.me')
      expect(redirectLinks('Pay here: https://track.example-mail.com/l0/%2f%2fspectrumbusiness.net%2fbilling%2f')).toEqual(['track.example-mail.com'])
      expect(redirectLinks('See https://u123.ct.sendgrid.net/ls/click?upn=abc')).toEqual(['u123.ct.sendgrid.net'])
    })
    it('ignores ordinary links, links back to the same site, and the link scanners', () => {
      expect(redirectLinks('Drawings: Download<https://example-my.sharepoint.com/:f:/g/drawings>\nwww.nour.sa<http://www.nour.sa>')).toEqual([])
      expect(redirectLinks('https://service.ariba.com/Supplier.aw/ad/login?returnUrl=https%3A%2F%2Fservice.ariba.com%2Fx')).toEqual([])
      expect(redirectLinks('https://urldefense.com/v3/__https://nour.sa/rfq__;!!abc')).toEqual([])
    })
    it('looks inside Microsoft Safe Links instead of flagging every link it wraps', () => {
      const wrap = (u) => `https://nam02.safelinks.protection.outlook.com/?url=${encodeURIComponent(u)}&data=05`
      expect(redirectLinks(wrap('https://nour.sa/boq.pdf'))).toEqual([])
      expect(redirectLinks(wrap('https://x9.awstrack.me/l0/abc'))).toEqual(['x9.awstrack.me'])
    })
  })

  it('baseDomain groups a company\'s own sub-domains', () => {
    expect(baseDomain('mail.besix.com.sa')).toBe('besix.com.sa')
    expect(baseDomain('eu.mail.example.com')).toBe('example.com')
  })

  it('namesSomething: products, quantities, places and documents count; "project" and "pricing" do not', () => {
    expect(namesSomething({}, `Request for Quotation\n${phish.BODY}`)).toBe(false)
    expect(namesSomething({}, 'Please quote 30 downlights for our villa')).toBe(true)
    expect(namesSomething({}, 'RFQ attached, BOQ for the hospital')).toBe(true)
    expect(namesSomething({}, 'نحتاج عرض سعر إنارة خارجية')).toBe(true)
    expect(namesSomething({ details: { location: 'Jeddah' } }, '')).toBe(true)
    expect(namesSomething({ projectEvidence: 'project awarded' }, '')).toBe(true)
  })

  describe('the phishing RFQ from Junk', () => {
    const junk = { flags: [], folder: 'junk', hasAttachments: false, text: `Request for Quotation\n${phish.BODY}` }

    it('is rejected in code before any model call: bad sender and tracking links', () => {
      const checks = { ...junk, flags: ['bad_sender', 'tracking_links'] }
      expect(decidedBeforeModel(checks)).toBe(true)
      const v = codeVerdict(checks)
      expect(v).toMatchObject({ verdict: 'unqualified', rule: 'bad_sender', category: 'spam', sourceCheck: 'not_verified' })
      const c = verdictColumns(v, { folder: 'junk', email: '' })
      expect(c).toMatchObject({ verdict: 'unqualified', rule: 'bad_sender', source_check: 'not_verified', folder: 'junk', email_kind: 'none' })
      expect(c.reason).toBe('Rejected: the sender address is not real. The sender address is not a real address (a chain of links); its links go through redirect or tracking services; it sat in Junk and names no product, scope, location or project.')
    })

    it('even with a clean sender, the model\'s own answer can no longer make it a lead', () => {
      // What Luna actually said: quotation_request, medium, Verified.
      const v = parseVerdict(reply(), junk)
      expect(v).toMatchObject({ verdict: 'unqualified', rule: 'warning_signs', warnings: ['junk_vague'] })
      expect(v.reason).toMatch(/^It sat in Junk and names no product, scope, location or project\./)
    })

    it('"Verified" is never kept when the sender\'s organisation is unrelated', () => {
      const v = parseVerdict(reply({ sender_fit: 'unrelated' }), junk)
      expect(v).toMatchObject({ verdict: 'unqualified', sourceCheck: 'not_verified', senderFit: 'unrelated' })
      expect(v.warnings).toEqual(['junk_vague', 'unrelated_org'])
      expect(v.sourceEvidence).toMatch(/nothing to do with construction or lighting/)
      // Same answer from the Inbox: still not a lead, it waits for a person.
      const inbox = parseVerdict(reply({ sender_fit: 'unrelated' }), { ...junk, folder: 'inbox' })
      expect(inbox).toMatchObject({ verdict: 'needs_review', rule: 'warning_signs', sourceCheck: 'not_verified' })
    })
  })

  describe('one sign at a time', () => {
    const good = (o) => JSON.stringify({ ...phish.MODEL_REPLY, confidence: 'high', details: { products: 'downlights', quantity: '40' }, sender_fit: 'fits', ...o })
    it('a Reply-To on another domain, or tracking links, in the Inbox: needs review, not verified', () => {
      expect(parseVerdict(good(), { flags: ['reply_to_mismatch'], folder: 'inbox' })).toMatchObject({ verdict: 'needs_review', rule: 'warning_signs', sourceCheck: 'not_verified' })
      expect(parseVerdict(good(), { flags: ['tracking_links'], folder: 'inbox' })).toMatchObject({ verdict: 'needs_review', rule: 'warning_signs' })
      expect(decidedBeforeModel({ flags: ['reply_to_mismatch'], folder: 'inbox' })).toBe(false)
    })
    it('the same sign in Junk rejects; two signs reject anywhere; a bad sender always does', () => {
      expect(decidedBeforeModel({ flags: ['tracking_links'], folder: 'junk', hasAttachments: false })).toBe(true)
      expect(decidedBeforeModel({ flags: ['tracking_links', 'reply_to_mismatch'], folder: 'inbox' })).toBe(true)
      expect(decidedBeforeModel({ flags: ['bad_sender'], folder: 'inbox' })).toBe(true)
    })
    it('a Junk email with attachments and nothing named in the text goes to a person, not out', () => {
      const v = parseVerdict(good({ details: {} }), { flags: [], folder: 'junk', hasAttachments: true, text: 'RFQ\nPlease see attached.' })
      expect(v).toMatchObject({ verdict: 'needs_review', warnings: ['junk_vague'] })
    })
    it('a real enquiry in Junk that names what it wants is still a lead', () => {
      expect(warningSigns({ details: {} }, { folder: 'junk', text: 'Please quote 30 downlights for our villa' })).toEqual([])
      expect(parseVerdict(good(), { flags: [], folder: 'junk', text: 'Please quote 40 downlights' })).toMatchObject({ verdict: 'qualified', rule: '', warnings: [] })
    })
    it('no checks (the website form, Try it): the rules are as before', () => {
      expect(parseVerdict(good())).toMatchObject({ verdict: 'qualified', rule: '' })
    })
  })

  it('the model is asked for sender_fit, and the prompt says what an unrelated sender means', () => {
    expect(VERDICT_SCHEMA.schema.required).toContain('sender_fit')
    expect(VERDICT_SCHEMA.schema.properties.sender_fit.enum).toEqual(SENDER_FITS)
    expect(systemPrompt()).toMatch(/when sender_fit is unrelated, source_check is not_verified/)
    expect(systemPrompt()).toMatch(/phishing from a hijacked mailbox: use spam/)
  })
})
