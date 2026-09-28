import { describe, it, expect } from 'vitest'
import { applyMergeTags, renderEmail, subscribeButton, textDirection, unknownMergeTags } from './render.js'
import { coldProblems } from './cold.js'

const URL = 'https://app.test/api/email/subscribe?t=abc'
const sara = { first_name: 'Sara', email: 'sara@x.com' }

describe('the sign-up link in a cold email', () => {
  it('is a known tag, filled per recipient', () => {
    expect(unknownMergeTags('{{subscribe_url}}')).toEqual([])
    expect(applyMergeTags('[Go]({{subscribe_url}})', sara, { subscribeUrl: URL })).toBe(`[Go](${URL})`)
    expect(coldProblems({ subject: 's', body: subscribeButton('Send me the guide'), follow_ups: [] })).toEqual([])
  })

  it('leaves the words, never "[label]()", when there is no link to give', () => {
    expect(applyMergeTags('[Send me the guide]({{subscribe_url}})', sara)).toBe('Send me the guide')
  })

  it('is drawn as a button when it stands alone, and plain text says where it goes', () => {
    const r = renderEmail({ audience: 'cold', subject: 'Hi', body: `Hello.\n\n${subscribeButton('Send me the free guide →')}`, contact: sara, subscribeUrl: URL })
    expect(r.html).toContain(`<a href="${URL.replace(/&/g, '&amp;')}" style="display:inline-block`)
    expect(r.html).toContain('Send me the free guide →</a>')
    expect(r.text).toContain(`Send me the free guide → (${URL})`)
  })

  it('refuses a javascript: button', () => {
    const r = renderEmail({ audience: 'cold', subject: 'Hi', body: '[Click](javascript:alert(1))', contact: sara })
    expect(r.html).not.toContain('javascript:')
  })
})

describe('one email in English and Arabic', () => {
  const body = 'Have you ever wondered?\n\n- A project breakdown\n\nهل تساءلت يومًا؟\n\n- تفاصيل مشروع'

  it('gives each paragraph its own direction', () => {
    expect(textDirection('Hello')).toBe('ltr')
    expect(textDirection('هل تساءلت')).toBe('rtl')
    expect(textDirection('[اشترك الآن](https://x.test)')).toBe('rtl')
    expect(textDirection('{{first_name}} مرحباً')).toBe('rtl')
    expect(textDirection('— 1976 —', 'rtl')).toBe('rtl')
    const { html } = renderEmail({ audience: 'cold', subject: 's', body, language: 'en', contact: sara })
    expect(html).toContain('<p dir="ltr" style="text-align:left">Have you ever wondered?</p>')
    expect(html).toContain('<p dir="rtl" style="text-align:right">هل تساءلت يومًا؟</p>')
    expect(html).toContain('<ul dir="rtl" style="text-align:right"><li>تفاصيل مشروع</li></ul>')
  })

  it('carries the opt-out in both languages', () => {
    const r = renderEmail({ audience: 'cold', subject: 's', body, language: 'en', contact: sara })
    expect(r.text).toMatch(/reply "stop"/)
    expect(r.text).toMatch(/توقف/)
    const one = renderEmail({ audience: 'cold', subject: 's', body: 'Hello there.', language: 'en', contact: sara })
    expect(one.text).not.toMatch(/توقف/)
  })
})
