import { describe, it, expect, vi } from 'vitest'
import {
  ruleReason, stickyToSonnet, chooseTier, parseTier, routeInput, STICKY_MS, ROUTE_SCHEMA,
} from './chatRoute'

describe('ruleReason — the questions that go to Sonnet without asking', () => {
  it.each([
    ['what should we do about the LinkedIn followers?', 'judgement'],
    ['how can we make sure this campaign is good', 'judgement'],
    ['suggest 3 linkedin and insta posts for the next three weeks', 'judgement'],
    ['ماذا نفعل بخصوص المتابعين؟', 'judgement'],
    ['ما رأيك في هذا المشروع', 'judgement'],
    ['do better', 'pushback'],
    ['not good, try again', 'pushback'],
    ['المشاريع التي تقترحها ضعيفه وكبيره جدا', 'pushback'],
    ['write a caption for this in both languages', 'writing'],
    ['analyze this email', 'writing'],
    ['اكتب منشور عن المشروع', 'writing'],
  ])('%s → %s', (question, reason) => {
    expect(ruleReason({ question })).toBe(reason)
  })

  it('sends any attachment to Sonnet', () => {
    expect(ruleReason({ question: 'what is this?', attachments: [{ kind: 'image' }] })).toBe('attachment')
  })

  it('sends a pasted document to Sonnet', () => {
    expect(ruleReason({ question: 'x'.repeat(1_500) })).toBe('long_paste')
  })

  it('keeps a request near Haiku\'s 100k rate step off Haiku', () => {
    expect(ruleReason({ question: 'how many leads?', promptTokens: 85_000 })).toBe('large_prompt')
  })

  it.each([
    'how many leads came in this week?',
    'what did instagram do last week, give me the numbers',
    'assign this to Ammar',
    'file it',
    'كم عدد المتابعين؟',
  ])('has nothing to say about "%s", so the sorting call decides', question => {
    expect(ruleReason({ question })).toBe('')
  })
})

describe('stickyToSonnet — keep Sonnet while its cache is warm', () => {
  const now = Date.parse('2026-11-02T10:00:00Z')
  const ago = ms => new Date(now - ms).toISOString()

  it('sticks for five minutes after a Sonnet answer', () => {
    expect(stickyToSonnet({ model: 'claude-sonnet-5-5', created_at: ago(60_000) }, now)).toBe(true)
    expect(stickyToSonnet({ model: 'claude-sonnet-5-5', created_at: ago(STICKY_MS + 1) }, now)).toBe(false)
  })

  it('does not stick after a Haiku answer, or with no answer yet', () => {
    expect(stickyToSonnet({ model: 'claude-haiku-5-5', created_at: ago(1_000) }, now)).toBe(false)
    expect(stickyToSonnet(null, now)).toBe(false)
  })
})

describe('chooseTier — the whole decision', () => {
  it('answers an easy question on Haiku when the sorting call says easy', async () => {
    const r = await chooseTier({ question: 'how many leads this week?', classify: async () => 'easy' })
    expect(r).toEqual({ tier: 'easy', job: 'chat_easy', reason: 'classified' })
  })

  it('does not spend the sorting call when a rule already decided', async () => {
    const classify = vi.fn(async () => 'easy')
    const r = await chooseTier({ question: 'what should we do next quarter?', classify })
    expect(r.job).toBe('chat')
    expect(classify).not.toHaveBeenCalled()
  })

  it('stays on Sonnet for a follow-up inside the cache window', async () => {
    const now = Date.now()
    const classify = vi.fn(async () => 'easy')
    const r = await chooseTier({
      question: 'how many leads?', now, classify,
      last: { model: 'claude-sonnet-5-5', created_at: new Date(now - 30_000).toISOString() },
    })
    expect(r).toMatchObject({ tier: 'hard', reason: 'sticky' })
    expect(classify).not.toHaveBeenCalled()
  })

  it('answers on Sonnet when the sorting call fails', async () => {
    const r = await chooseTier({ question: 'how many leads?', classify: async () => { throw new Error('down') } })
    expect(r).toMatchObject({ tier: 'hard', reason: 'classifier_failed' })
  })
})

describe('the sorting call', () => {
  it('reads anything but a clean "easy" as hard', () => {
    expect(parseTier('{"tier":"easy"}')).toBe('easy')
    expect(parseTier('{"tier":"hard"}')).toBe('hard')
    expect(parseTier('not json')).toBe('hard')
    expect(parseTier('')).toBe('hard')
  })

  it('sees the start of the last answer and the new message, trimmed', () => {
    const text = routeInput({ question: 'and last week?', lastAnswer: 'a'.repeat(2_000) })
    expect(text).toMatch(/and last week\?/)
    expect(text.length).toBeLessThan(800)
  })

  it('has a schema the API accepts: one required enum', () => {
    expect(ROUTE_SCHEMA.schema.required).toEqual(['tier'])
    expect(ROUTE_SCHEMA.schema.additionalProperties).toBe(false)
  })
})
