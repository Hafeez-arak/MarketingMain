import { describe, it, expect } from 'vitest'
import { buildContext } from './brandContextCore.js'
import { rowToProfile, cleanVisualText, visualLines } from './brandBrainCore.js'

// ─── What the picture models read, on the real Arak brand ──────────────────
//
// PR #77 kept copywriting out of image prompts on the legacy path only, while
// Arak had no structured fields. Arak now has 24, the schema path runs, and
// every untagged field — the guardrails, the client list, compliance — went
// back into every picture prompt: 2,548 characters, about 15% of it visual,
// plus an asset summary naming photos no image call ever attaches.
//
// This pins the fix against the brand's actual shape rather than a toy one,
// because the toy one is what let it regress.

// ─── Arak's real Brand Brain, as it stood on 2026-10-14 ─────────────────────
// Read-only SELECT of brand_profile / brand_fields / brand_sections /
// brand_assets for the Arak Lighting workspace. Sanitized: the analytics
// property id, site routing table and HQ street address are left out; every
// field that reaches a prompt is verbatim.
const F = (section_key, key, label, prompt_label, storage_column, tasks, include_in_prompt = true) =>
  ({ section_key, key, label, prompt_label, storage_column, tasks, include_in_prompt, enabled: true })

const ARAK_FIELDS = [
  F('identity_voice', 'brand_name', 'Brand Name', '', '', [], false),
  F('identity_voice', 'brand_descriptor', 'One-Line Descriptor', '', '', [], false),
  F('identity_voice', 'mission', 'Mission', 'Mission', 'mission', ['plan', 'caption', 'chat']),
  F('identity_voice', 'positioning', 'Market Positioning', 'Market positioning', 'positioning', ['plan', 'caption', 'research', 'chat']),
  F('identity_voice', 'value_proposition', 'Value Proposition', 'Value proposition', 'value_proposition', ['plan', 'caption', 'chat']),
  F('identity_voice', 'brand_story', 'Brand Story', 'Brand story', 'brand_story', ['plan', 'caption', 'chat']),
  F('identity_voice', 'company_facts', 'Company Facts', 'Facts the brand can state', 'company_facts', ['plan', 'caption', 'research', 'chat']),
  F('identity_voice', 'voice_descriptors', 'Brand Voice', 'Brand voice', 'voice_descriptors', ['plan', 'caption', 'chat']),
  F('guardrails', 'tone_dos', 'Always Do', 'Always do', 'tone_dos', []),
  F('guardrails', 'tone_donts', 'Never Do', 'Never do', 'tone_donts', []),
  F('audience', 'target_personas', 'Target Personas', 'Target audience', 'target_personas', ['plan', 'caption', 'research', 'chat']),
  F('audience', 'icp_summary', 'Ideal Customer (ICP)', 'Ideal customer (from our own won and lost deals)', '', ['plan', 'caption', 'research', 'chat']),
  F('audience', 'client_pains', 'Client Problems We Solve', 'Client problems to speak to (from real deals)', '', ['plan', 'caption', 'research', 'chat']),
  F('market_references', 'market_context', 'Market Context', 'Market context', 'market_context', ['plan', 'research', 'chat']),
  F('market_references', 'key_projects', 'Key Projects & Clients to Reference', 'Reference when relevant', 'key_projects', []),
  F('market_references', 'product_index_summary', 'Product Range Summary', 'Product range (ask for the full sheet for specifics)', 'product_index', ['plan', 'caption', 'chat']),
  F('market_references', 'geography', 'Market / Geography', '', '', [], false),
  F('market_references', 'sales_motion', 'How we sell', '', '', [], false),
  F('visual', 'visual_identity', 'Visual Identity', 'Visual identity', 'visual_identity', ['image', 'video']),
  F('visual', 'brand_colors', 'Brand Colours', 'Brand colours', 'brand_colors', ['image', 'video']),
  F('visual', 'visual_style_notes', 'AI Image Style Defaults', 'Visual style defaults', 'visual_style_notes', ['image', 'video']),
  F('knowledge_centre', 'contact_info', 'Contact & Conversion', 'Contact & conversion details', 'contact_info', ['caption', 'chat']),
  F('knowledge_centre', 'languages', 'Languages', 'Languages', 'languages', ['caption', 'chat']),
  F('knowledge_centre', 'offers_ctas', 'Offers & CTAs', 'Offers & calls-to-action to push', 'offers_ctas', ['plan', 'caption', 'chat']),
  F('knowledge_centre', 'compliance_notes', 'Compliance', 'Compliance rules (esp. WhatsApp/email)', 'compliance_notes', []),
]

const ARAK_SECTIONS = [
  { key: 'identity_voice', kind: 'fields', title: 'Identity & Voice', tasks: [], enabled: true },
  { key: 'guardrails', kind: 'fields', title: 'Guardrails', tasks: [], enabled: true },
  { key: 'audience', kind: 'fields', title: 'Audience', tasks: [], enabled: true },
  { key: 'market_references', kind: 'fields', title: 'Market & References', tasks: [], enabled: true },
  { key: 'visual', kind: 'fields', title: 'Visual', tasks: [], enabled: true },
  { key: 'knowledge_centre', kind: 'fields', title: 'Knowledge Centre', tasks: [], enabled: true },
  { key: 'asset_library', kind: 'assets', title: 'Asset Library', tasks: [], enabled: true },
  { key: 'products', kind: 'directory', title: 'Products', tasks: [], enabled: true },
  { key: 'message_templates', kind: 'directory', title: 'Message Templates', tasks: ['caption', 'chat'], enabled: true },
  { key: 'suppliers', kind: 'directory', title: 'Suppliers', tasks: ['plan', 'research', 'chat'], enabled: true },
  { key: 'competitors', kind: 'directory', title: 'Competitor Watch', tasks: ['plan', 'research', 'chat'], enabled: false },
]

const ARAK_ROW = {
  custom_fields: {
    brand_name: 'Arak Lighting',
    brand_descriptor: "Saudi Arabia's leading architectural lighting and smart-building company (founded 1976; landmark projects incl. King Fahad International Airport, Solitaire Mall, Ritz Carlton Riyadh)",
    geography: 'Saudi Arabia — Riyadh and the Central Region',
    sales_motion: 'specification',
    icp_summary: 'Our best customers: contractors who already hold the job, and owners or developers buying direct.\nWhat: hotels and resorts, schools and universities, private villas and palaces, offices and corporate fit-outs, and lighting-control (DALI, KNX, GRMS) jobs.\nWhere: Riyadh and the Central Region.\nSize: lighting packages under about 2M SAR, best under 500k.\nGrowth: fit-out and interiors companies, larger hospitality and mixed-use developments, hospitals and public buildings.\nConsultants and lighting designers decide the brand: content should help them specify us.',
    client_pains: 'Submittals and approvals take weeks and get rejected → approved technical data and complete submittal packs.\nThey need proof before committing → sample boards, mock-ups, real installed projects.\nLux calculations and lighting design → design and lux studies with the supply.\nA specified brand they must follow → C°LB and our brands, fully certified, as approved alternatives.\nBudget pressure against imported brands → value engineering with a C°LB option.\nCertificates and prequalification (SASO, UL, ISO) → every certificate in one place.\nLighting and controls from different suppliers → lighting and control from one company, one point of responsibility.\nKeeping installed control systems running → maintenance contracts.',
  },
  mission: 'To always offer state-of-the-art products and service in compliance with the highest of international standards.',
  positioning: "Saudi Arabia's leading national lighting company — carrying 41 international lighting and smart-building brands as a certified partner, trusted on landmark hospitality, retail, banking and infrastructure projects across the Kingdom.",
  value_proposition: '45+ years of know-how, leadership and "big love for lights" — premium lighting and smart automation solutions engineered to the highest international standards and tailored to each project\'s environment.',
  brand_story: "Founded in 1976 as an extension of Abdul Rahman Al-Abdul Kadir Corporation, ARAK is a pioneering Saudi establishment with 50 years of experience in lighting and smart building automation. What began as a local lighting supplier has grown into the Kingdom's go-to partner for landmark projects — from King Fahad International Airport to the Ritz Carlton Riyadh, Cartier's Riyadh boutique, Solitaire Mall, and a facade lighting partnership with Seder Group. Vision: to become the leading lighting company nationally and regionally, and KSA's go-to Smart Lighting Solutions provider, continuing to expand through international brand partnerships and product diversification.",
  company_facts: 'Founded 1976, an extension of Abdul Rahman Al-Abdul Kadir Corporation\n50 years in the lighting industry (since 1976)\nCarries 41 international lighting & smart-building brands, from Italian decorative makers to European emergency and control platforms (KNX, DALI, GRMS)\nRegistered vendor / prequalified with (arak-sa.com/about): Saudi Aramco, Saudi Electricity Company, Diriyah Gate Development Authority, NEOM, Qiddiya, Roshn, The Red Sea Development Company, Riyadh Airports, STC, Riyad Bank, National Water Company, National Housing Company, Royal Commission for Jubail & Yanbu, Ministry of National Guard Health Affairs\nNotable projects: King Fahad International Airport (Dammam), Ritz Carlton Riyadh, Cartier Riyadh, Solitaire Mall Riyadh, Seder Group Riyadh\nNotable clients: Four Seasons, Mövenpick, Sheraton Four Points, Burj Rafal Hotel Kempinski, Panda, Al Rajhi Bank, Al Salam Bank, Bank Al Jazira, Emirates NBD, Prince Sultan University',
  voice_descriptors: 'professional, aspirational, heritage-led, confident, premium — formal but warm, never casual',
  tone_dos: 'Reference the 45+ years of heritage and Saudi roots when relevant\nName landmark projects/clients when it strengthens credibility (Ritz Carlton, Cartier, King Fahad Airport, Solitaire Mall)\nEmphasize compliance with international standards and technical expertise\nSpeak as "we" — ARAK is an established institution, not a startup',
  tone_donts: 'Casual or startup-y language ("hey!", excessive exclamation marks)\nGeneric stock-photo lighting clichés\nOverclaiming beyond verifiable facts\nPositioning as cheap/budget — ARAK is a premium, certified-partner brand',
  target_personas: 'Architects and interior designers specifying lighting for landmark and hospitality projects\nMEP contractors and engineering firms evaluating lighting suppliers\nHotel operators and hospitality brands needing lighting + smart room automation (GRMS)\nReal estate developers and mall operators\nBanks and financial institutions fitting out branches/HQs\nGovernment and infrastructure bodies (airports, public projects)\nLuxury retail brands\nEducational institutions',
  market_context: 'KSA Vision 2030 giga-projects and infrastructure expansion driving demand for large-scale lighting and smart building automation\nGrowing demand for KNX/EIB smart automation in hospitality (Guest Room Management Systems) and commercial buildings\nRising expectations for facade and outdoor lighting on landmark developments\nSaudi-first positioning matters — ARAK is a 45-year local establishment, not a foreign import',
  key_projects: 'The Ritz-Carlton, Riyadh — premium light fittings for a luxury hotel\nFour Points by Sheraton, Riyadh — hotel; supply and commissioning of KNX lighting control\nRiyadh Air Head Office, Riyadh — corporate headquarters office; supply, testing and commissioning of the lighting control system\nSeder Head Quarter Building, Riyadh — headquarters office; indoor and outdoor light fittings, exterior lighting with a leading MEP firm\nSolitaire Mall, Riyadh — retail mall; indoor, outdoor and smart pole lighting\nCartier, Riyadh — luxury retail boutique; indoor light fittings\nAthletic Showroom, Riyadh — retail showroom; indoor and track light fittings\nDelfino Mayfair Restaurant, Riyadh — restaurant; EIB / KNX lighting control system\nMilling Company MC-2, Riyadh — supply and commissioning of KNX lighting control systems\nLADUN Center, Riyadh — supply of light fittings\nKing Fahad International Airport, Dammam — airport; supply and installation of light fittings',
  product_index: 'Indoor lighting, outdoor lighting, facade lighting, lighting design services, lighting installation & project management, home & building automation (KNX/EIB), Guest Room Management Systems (hospitality), Smart Pole systems (IoT/city infrastructure), Central Battery Systems (emergency backup lighting).\n\nBrands we carry (41, as listed on arak-sa.com; details in the Suppliers list):\n- Own line: C°LB (Arak\'s own range; also our smart poles)\n- Architectural & decorative: Artemide, Reggiani, PHOS, LEDS C4, ACB, Arkoslight, Nova Luce, Viokef Lighting, Hormen, Lucio, p.u.k., planlicht, Niviss, Forma Lighting, LEDFlex\n- Outdoor, road & industrial: Disano Illuminazione, Siteco, LUG, RZB Lighting, Trevos, Zalux, GEWISS\n- Lamps & general lighting: Ledvance, Sylvania\n- Emergency & central battery: Eaton, Inotec, TM Technologie, ESP, EML\n- Lighting control & building automation (KNX, DALI, GRMS): ABB, Lutron, Zennio, Hager, Leviton, Interra\n- Also on the site: espica, Flexxica, Nexia, AFO, Denko\nWe also quote approved equivalents and the brand a project specifies, so a brand missing from this list never makes a request outside what we sell.',
  visual_identity: 'Logo: a stylised "A" formed from a hanging pendant light fixture, paired with a clean geometric "ARAK" wordmark. Primary logo file is white/transparent, designed for dark backgrounds — a dark-on-light variant was not found on the live site; confirm with the client if one is needed. No confirmed brand accent color found on the current site (base palette reads black/white/premium-neutral) — flagging rather than guessing; confirm directly with Arak.',
  brand_colors: '', visual_style_notes: '', compliance_notes: '', contact_info: '', languages: '', offers_ctas: '',
}

const ARAK_ASSETS = [
  { kind: 'project_photo', project: ' King Fahad International Airport, Dammam', tags: [] },
  { kind: 'logo', project: '', tags: [] },
  { kind: 'project_photo', project: 'Cartier, Riyadh', tags: [] },
  { kind: 'project_photo', project: 'seder', tags: [] },
  { kind: 'project_photo', project: 'Ritz Carlton Hotel, Riyadh', tags: [] },
  { kind: 'project_photo', project: 'Solitaire Mall, Riyadh', tags: [] },
  { kind: 'logo', project: '', tags: [] },
]

const profile = rowToProfile(ARAK_ROW, ARAK_FIELDS)
const schema = { sections: ARAK_SECTIONS, fields: ARAK_FIELDS, columns: [] }
const directory = { rowsBySection: {}, assets: ARAK_ASSETS }
const ctx = task => buildContext(profile, schema, directory, [], { task, matchText: ['warm hotel lobby at dusk', ''] })

describe('a drawing task gets only how the brand looks', () => {
  for (const task of ['image', 'video']) {
    it(`${task}: identity line plus the visual never-do rule, nothing else`, () => {
      const { instructions, blocks } = ctx(task)
      expect(instructions).toBe(
        "BRAND: Arak Lighting — Saudi Arabia's leading architectural lighting and smart-building company " +
        '(founded 1976; landmark projects incl. King Fahad International Airport, Solitaire Mall, Ritz Carlton Riyadh)' +
        '\n\nNever do: Generic stock-photo lighting clichés',
      )
      expect(blocks.map(b => b.key)).toEqual(['voice'])
    })

    it(`${task}: no copywriting, client list, asset summary or staff notes`, () => {
      const { instructions } = ctx(task)
      expect(instructions).not.toMatch(/Speak as "we"/)
      expect(instructions).not.toMatch(/exclamation marks/)
      expect(instructions).not.toMatch(/Overclaiming/)
      expect(instructions).not.toMatch(/Always do/)
      expect(instructions).not.toMatch(/Reference when relevant/)
      expect(instructions).not.toMatch(/Delfino Mayfair/)
      expect(instructions).not.toMatch(/Visual assets on hand/)
      expect(instructions).not.toMatch(/picked separately/)
      expect(instructions).not.toMatch(/confirm/i)
      expect(instructions).not.toMatch(/flagging rather than guessing/)
      // Logos go on afterwards as a real layer; a described one gets painted.
      expect(instructions).not.toMatch(/wordmark/)
    })
  }

  it('sends the visual fields once they are filled in, tagged or not', () => {
    const fields = [
      ...ARAK_FIELDS,
      // An untagged field whose name says it is visual — another workspace's shape.
      { section_key: 'market_references', key: 'photography_style', label: 'Photography style', prompt_label: '',
        storage_column: '', tasks: [], include_in_prompt: true, enabled: true },
    ]
    const filled = rowToProfile({
      ...ARAK_ROW,
      brand_colors: 'Black, white and brushed brass',
      visual_style_notes: 'Dusk exteriors, warm linear light, no people',
      custom_fields: { ...ARAK_ROW.custom_fields, photography_style: 'Architectural, symmetrical, long exposure' },
    }, fields)
    const { instructions } = buildContext(filled, { ...schema, fields }, directory, [], { task: 'image' })
    expect(instructions).toContain('Brand colours: Black, white and brushed brass')
    expect(instructions).toContain('Visual style defaults: Dusk exteriors, warm linear light, no people')
    expect(instructions).toContain('Photography style: Architectural, symmetrical, long exposure')
    expect(instructions).not.toContain('Ritz-Carlton, Riyadh — premium')
  })

  it('is a fraction of what it was', () => {
    expect(ctx('image').instructions.length).toBeLessThan(300)
  })
})

describe('every task that writes is unchanged', () => {
  // Lengths measured on this fixture before the drawing scope existed.
  it.each([['caption', 7511], ['plan', 7944], ['chat', 7944]])('%s', (task, length) => {
    const { instructions, blocks } = ctx(task)
    expect(instructions.length).toBe(length)
    expect(instructions).toContain('Always do:\nReference the 45+ years')
    expect(instructions).toContain('Never do:\nCasual or startup-y language')
    expect(instructions).toContain('Reference when relevant:\nThe Ritz-Carlton, Riyadh')
    expect(instructions).toContain('Visual assets on hand')
    expect(blocks.map(b => b.key)).toEqual(['voice', 'assets'])
  })
})

describe('the line and clause filters', () => {
  it('keeps only the visual lines of a rule list', () => {
    expect(visualLines(ARAK_ROW.tone_donts)).toBe('Generic stock-photo lighting clichés')
    expect(visualLines(ARAK_ROW.tone_dos)).toBe('')
  })

  it('drops trailing staff notes but keeps the fact they qualify', () => {
    expect(cleanVisualText('Matte black fittings, warm 2700K glow — palette not found on the live site; confirm with Arak.'))
      .toBe('Matte black fittings, warm 2700K glow.')
    expect(cleanVisualText('Deep navy and brass. TBC with the client.')).toBe('Deep navy and brass.')
  })

  it('reduces Arak’s visual identity to nothing, because all of it is logo or staff notes', () => {
    expect(cleanVisualText(ARAK_ROW.visual_identity)).toBe('')
  })
})
