import { describe, it, expect } from 'vitest'
import { buildInstructionsString } from './brandBrainCore.js'

// ─── The legacy blob's task scoping ────────────────────────────────────────
//
// A workspace with structured Brand Brain fields is scoped by each field's own
// `tasks` tag. A workspace with none of them falls down buildInstructionsString's
// legacy path, which had no scoping at all — so the picture models were handed
// the brand's copywriting rules, its phone number and its client list.
//
// That is not a style complaint. On 2026-09-16 nano-banana-2 rejected such a
// request outright (fal 422, "the input cannot be processed as the requested
// output type") on a brief gpt-image-2 rendered without complaint, and the
// marketer retried the dead lane three times.

const legacy = {
  fieldDefs: [],
  mission: 'Light the Kingdom',
  companyFacts: 'Founded 1976',
  toneDos: 'Speak as "we"',
  toneDonts: 'No generic stock-photo lighting clichés',
  keyProjects: 'Ritz Carlton Hotel, Riyadh',
  contactInfo: 'Call 800-000-0000',
  offersCtas: 'Book a lighting consultation',
  visualIdentity: 'A stylised "A" formed from a pendant light',
  brandColors: 'Black, white, premium neutral',
  visualStyleNotes: 'Dusk exteriors, warm linear light',
  languages: 'Arabic and English',
}

describe('buildInstructionsString, scoped by task', () => {
  it('sends the whole blob to a task that writes', () => {
    const text = buildInstructionsString(legacy, '', 'caption')
    expect(text).toContain('Founded 1976')
    expect(text).toContain('Call 800-000-0000')
    expect(text).toContain('Ritz Carlton')
  })

  it('sends only the visual columns to a task that draws', () => {
    for (const task of ['image', 'video']) {
      const text = buildInstructionsString(legacy, '', task)
      expect(text).toContain('stylised "A"')
      expect(text).toContain('Dusk exteriors')
      expect(text).toContain('Arabic and English')
      // The half that made an image model read the request as a writing job.
      expect(text).not.toContain('Founded 1976')
      expect(text).not.toContain('Call 800-000-0000')
      expect(text).not.toContain('Book a lighting consultation')
      expect(text).not.toContain('Ritz Carlton')
      expect(text).not.toContain('Light the Kingdom')
    }
  })

  // A person's free-text never-do list is half visual, and code cannot split a
  // paragraph by key. Dropping it would lose a real rule about how the brand's
  // pictures may look, so it is sent.
  it('keeps the guardrails', () => {
    const text = buildInstructionsString(legacy, '', 'image')
    expect(text).toContain('stock-photo lighting clichés')
    expect(text).toContain('Speak as "we"')
  })

  it('is unchanged when no task is given, so every existing caller behaves the same', () => {
    expect(buildInstructionsString(legacy, '')).toBe(buildInstructionsString(legacy, '', null))
    expect(buildInstructionsString(legacy, '')).toContain('Call 800-000-0000')
  })

  it('leaves a workspace with real field definitions to the schema path', () => {
    const structured = {
      ...legacy,
      fieldDefs: [{ key: 'contact', label: 'Contact', storage_column: 'contact_info', enabled: true }],
    }
    expect(buildInstructionsString(structured, '', 'image')).toContain('Call 800-000-0000')
  })

  it('still honours platform notes on a drawing task', () => {
    expect(buildInstructionsString(legacy, 'Square crops only', 'image')).toContain('Square crops only')
  })
})
