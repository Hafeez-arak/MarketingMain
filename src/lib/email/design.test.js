import { describe, it, expect } from 'vitest'
import {
  renderDesign, designChecks, designFromText, normalizeDesign, makeBlock, templates, brandSwatches, safeColor,
} from './design.js'

const img = 'https://cdn.example.com/photo.jpg'

describe('renderDesign', () => {
  it('renders every block type into table-based email HTML with the footer always present', () => {
    const design = { blocks: [
      makeBlock('logo', { src: img }),
      makeBlock('heading', { text: 'Hello {{first_name}}' }),
      makeBlock('text', { text: 'Para **bold**\n\n- one\n- two' }),
      makeBlock('image', { src: img, alt: 'A lobby', href: 'https://arak-sa.com/p' }),
      makeBlock('button', { label: 'See it', href: 'https://arak-sa.com' }),
      makeBlock('columns', { src: img, alt: 'Side', text: 'Beside' }),
      makeBlock('divider'),
      makeBlock('spacer', { height: 30 }),
      makeBlock('social', { links: [{ label: 'LinkedIn', href: 'https://linkedin.com/x' }, { label: 'Empty', href: 'https://' }] }),
    ] }
    const { html, text, subject } = renderDesign({
      design, subject: 'Hi {{first_name}}', contact: { first_name: 'Sara' },
      sender: { from_name: 'Arak', company_address: 'Riyadh' }, unsubscribeUrl: 'https://app/u?t=1',
    })
    expect(subject).toBe('Hi Sara')
    expect(html).toContain('Hello Sara')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('alt="A lobby"')
    expect(html).toContain('href="https://arak-sa.com"')
    expect(html).toContain('height:30px')
    expect(html).toContain('LinkedIn')
    expect(html).not.toContain('>Empty<')
    expect(html).toContain('https://app/u?t=1')
    expect(html).toContain('Riyadh')
    expect(text).toContain('See it: https://arak-sa.com')
    expect(text).toContain('https://app/u?t=1')
  })

  it('leaves out an image with no picture and a button with no link', () => {
    const { html } = renderDesign({ design: { blocks: [makeBlock('image'), makeBlock('button', { href: 'https://' })] }, subject: 's' })
    expect(html).not.toContain('<img')
    expect(html).not.toContain('Learn more')
  })

  it('refuses non-https pictures, script links and non-colour colours', () => {
    const { html } = renderDesign({ design: {
      style: { accent: 'red;background:url(x)' },
      blocks: [
        makeBlock('image', { src: 'http://insecure.example/x.jpg' }),
        makeBlock('button', { label: 'x', href: 'javascript:alert(1)' }),
        makeBlock('text', { text: '<script>bad()</script>' }),
      ] }, subject: 's' })
    expect(html).not.toContain('insecure.example')
    expect(html).not.toContain('javascript:')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('url(x)')
  })

  it('lays Arabic out right to left and mirrors left/right alignment', () => {
    const { html } = renderDesign({ design: { blocks: [makeBlock('text', { text: 'مرحبا', align: 'left' })] }, subject: 's', language: 'ar' })
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('text-align:right')
  })
})

describe('designChecks', () => {
  it('blocks an empty design and a button without a link', () => {
    expect(designChecks({ blocks: [] }).problems).toHaveLength(1)
    expect(designChecks({ blocks: [makeBlock('button')] }).problems[0]).toMatch(/needs a link/)
  })
  it('warns about missing alt text and picture-heavy emails, without blocking them', () => {
    const r = designChecks({ blocks: [makeBlock('image', { src: img }), makeBlock('image', { src: img, alt: 'x' })] })
    expect(r.problems).toEqual([])
    expect(r.warnings.some(w => /alt text/.test(w))).toBe(true)
    expect(r.warnings.some(w => /Mostly pictures/.test(w))).toBe(true)
  })
})

describe('designFromText', () => {
  it('turns a written email into blocks, and a lone link line into a button', () => {
    const d = designFromText({ subject: 'News', logo: img, body: 'Hi,\n\nPara one.\n\n[See the project](https://arak-sa.com/p)\n\nBye' })
    expect(d.blocks.map(b => b.type)).toEqual(['logo', 'heading', 'text', 'button', 'text'])
    expect(d.blocks[3]).toMatchObject({ label: 'See the project', href: 'https://arak-sa.com/p' })
  })
})

describe('templates and brand', () => {
  it('puts the Brand Brain logo at the top of every template when there is one', () => {
    for (const t of templates({ logo: img })) expect(t.design.blocks[0]).toMatchObject({ type: 'logo', src: img })
    for (const t of templates({})) expect(t.design.blocks[0].type).not.toBe('logo')
  })
  it('reads hex colours out of free-text brand notes', () => {
    expect(brandSwatches('Sage #A8B78C primary\nBurgundy #7A1F2B and #a8b78c again')).toEqual(['#a8b78c', '#7a1f2b'])
  })
  it('normalises unknown blocks and bad colours away', () => {
    const d = normalizeDesign({ style: { background: 'nope' }, blocks: [{ type: 'mystery' }, { type: 'text', text: 'ok' }] })
    expect(d.blocks).toHaveLength(1)
    expect(d.style.background).toBe('#f4f3f0')
    expect(safeColor('#ABC', '#000')).toBe('#ABC')
  })
})
