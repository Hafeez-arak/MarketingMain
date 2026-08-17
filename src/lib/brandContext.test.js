import { describe, it, expect } from 'vitest'
import { matchFeaturedRows, matchesTask, buildContext } from './brandContext'

// ─── matchesTask ────────────────────────────────────────────────────────────

describe('matchesTask', () => {
  it('matches everything when tags are empty or missing', () => {
    expect(matchesTask([], 'image')).toBe(true)
    expect(matchesTask(null, 'image')).toBe(true)
    expect(matchesTask(undefined, 'image')).toBe(true)
  })

  it('matches everything when no task is given', () => {
    expect(matchesTask(['image'], null)).toBe(true)
    expect(matchesTask(['image'], undefined)).toBe(true)
  })

  it('matches when the task is in the tag list', () => {
    expect(matchesTask(['image', 'video'], 'image')).toBe(true)
  })

  it('fails closed on an unknown tag rather than leaking to every task', () => {
    expect(matchesTask(['image'], 'caption')).toBe(false)
  })
})

// ─── matchFeaturedRows ──────────────────────────────────────────────────────

function directorySchema({ threshold = 15 } = {}) {
  return {
    sections: [
      { key: 'services', kind: 'directory', title: 'Services', enabled: true },
      { key: 'small', kind: 'directory', title: 'Small List', enabled: true },
      { key: 'notes', kind: 'text', title: 'Notes', enabled: true },
    ],
    columns: [
      { key: 'name', label: 'Name', section_key: 'services', enabled: true, in_prompt: true },
      { key: 'name_ar', label: 'الاسم', section_key: 'services', enabled: true, in_prompt: true },
      { key: 'price', label: 'Price', section_key: 'services', enabled: true, in_prompt: false },
      { key: 'name', label: 'Name', section_key: 'small', enabled: true, in_prompt: true },
    ],
  }
}

function makeRows(count, overrides = {}) {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    data: { name: `Service ${i}`, name_ar: `خدمة ${i}` },
    ...overrides,
  }))
}

describe('matchFeaturedRows', () => {
  it('returns nothing for empty text', () => {
    const schema = directorySchema()
    const directory = { rowsBySection: { services: makeRows(20) } }
    expect(matchFeaturedRows(schema, directory, '', null, undefined)).toEqual({})
  })

  it('matches an English-column row named in an English brief', () => {
    const schema = directorySchema()
    const rows = makeRows(20)
    const directory = { rowsBySection: { services: rows } }
    const result = matchFeaturedRows(schema, directory, 'Come try our Service 3 this week')
    expect(result.services).toEqual(['Service 3'])
  })

  it('matches Arabic briefs against name_ar — the bug this session fixed', () => {
    const schema = directorySchema()
    const rows = makeRows(20)
    const directory = { rowsBySection: { services: rows } }
    // Brief is written entirely in Arabic; only name_ar aliases should match.
    const result = matchFeaturedRows(schema, directory, 'جربوا خدمة 5 معنا هذا الأسبوع')
    expect(result.services).toEqual(['Service 5'])
  })

  it('skips sections at or under the index threshold — a small directory is already sent whole', () => {
    const schema = directorySchema()
    const rows = makeRows(10) // DIRECTORY_INDEX_THRESHOLD is 12
    const directory = { rowsBySection: { small: rows } }
    const result = matchFeaturedRows(schema, directory, 'Service 3 is great')
    expect(result).toEqual({})
  })

  it('ignores non-directory sections', () => {
    const schema = directorySchema()
    const directory = { rowsBySection: {} }
    const result = matchFeaturedRows(schema, directory, 'Service 3')
    expect(result.notes).toBeUndefined()
  })

  it('ignores aliases shorter than 3 characters to avoid matching inside unrelated words', () => {
    const schema = directorySchema()
    const rows = makeRows(20, {})
    rows[0].data = { name: 'A4', name_ar: 'أ4' }
    const directory = { rowsBySection: { services: rows } }
    const result = matchFeaturedRows(schema, directory, 'We printed an A4 flyer today')
    expect(result.services).toBeUndefined()
  })

  it('caps results at MAX_FEATURED_ROWS (6)', () => {
    const schema = directorySchema()
    const rows = makeRows(20)
    const directory = { rowsBySection: { services: rows } }
    const names = rows.slice(0, 10).map(r => r.data.name).join(', ')
    const result = matchFeaturedRows(schema, directory, `Featuring: ${names}`)
    expect(result.services).toHaveLength(6)
  })

  it('is case-insensitive and whitespace-tolerant', () => {
    const schema = directorySchema()
    const rows = makeRows(20)
    const directory = { rowsBySection: { services: rows } }
    const result = matchFeaturedRows(schema, directory, 'SERVICE   3 is amazing')
    expect(result.services).toEqual(['Service 3'])
  })
})

// ─── buildContext ───────────────────────────────────────────────────────────

function baseSchema() {
  return {
    fields: [
      { key: 'brand_name', section_key: 'identity', tasks: [] },
      { key: 'video_notes', section_key: 'identity', tasks: ['video'] },
    ],
    sections: [
      { key: 'identity', tasks: [] },
      { key: 'services', kind: 'directory', title: 'Services', enabled: true, tasks: [] },
    ],
    columns: [
      { key: 'name', label: 'Name', section_key: 'services', enabled: true, in_prompt: true },
      { key: 'desc', label: 'Description', section_key: 'services', enabled: true, in_prompt: true },
    ],
  }
}

function baseProfile() {
  return {
    customFields: {
      brand_name: 'Aqeeq',
      brand_descriptor: 'Riyadh spa & wellness',
      video_notes: 'Keep clips under 15s',
    },
    fieldDefs: [
      { key: 'brand_name', section_key: 'identity', label: 'Brand name', include_in_prompt: true },
      { key: 'video_notes', section_key: 'identity', label: 'Video notes', include_in_prompt: true },
    ],
  }
}

describe('buildContext', () => {
  it('produces an identity line from brand_name/brand_descriptor', () => {
    const { identityLine } = buildContext(baseProfile(), baseSchema(), { rowsBySection: {} }, [], {})
    expect(identityLine).toBe('BRAND: Aqeeq — Riyadh spa & wellness')
  })

  it('omits the identity line entirely when there is no brand name', () => {
    const profile = { customFields: {}, fieldDefs: [] }
    const { identityLine, instructions } = buildContext(profile, baseSchema(), { rowsBySection: {} }, [], {})
    expect(identityLine).toBe('')
    expect(instructions.startsWith('BRAND:')).toBe(false)
  })

  it('scopes fields by task: an image call does not see video-only fields', () => {
    const { blocks: imageBlocks } = buildContext(baseProfile(), baseSchema(), { rowsBySection: {} }, [], { task: 'image' })
    const voiceImage = imageBlocks.find(b => b.key === 'voice')
    expect(voiceImage?.text || '').not.toContain('Keep clips under 15s')

    const { blocks: videoBlocks } = buildContext(baseProfile(), baseSchema(), { rowsBySection: {} }, [], { task: 'video' })
    const voiceVideo = videoBlocks.find(b => b.key === 'voice')
    expect(voiceVideo?.text || '').toContain('Keep clips under 15s')
  })

  it('respects mutedKeys by flagging (not dropping) the block', () => {
    const { blocks, instructions } = buildContext(baseProfile(), baseSchema(), { rowsBySection: {} }, [], { mutedKeys: ['voice'] })
    const voice = blocks.find(b => b.key === 'voice')
    expect(voice?.muted).toBe(true)
    expect(instructions).not.toContain('Keep clips under 15s')
  })

  it('only injects active, task-matching memory rows', () => {
    const memory = [
      { rule: 'Always mention free parking', status: 'active', tasks: [] },
      { rule: 'Proposed but unapproved rule', status: 'proposed', tasks: [] },
      { rule: 'Video-only rule', status: 'active', tasks: ['video'] },
    ]
    const { instructions } = buildContext(baseProfile(), baseSchema(), { rowsBySection: {} }, memory, { task: 'caption' })
    expect(instructions).toContain('Always mention free parking')
    expect(instructions).not.toContain('Proposed but unapproved rule')
    expect(instructions).not.toContain('Video-only rule')
  })

  it('merges matchText-derived featured rows with explicit featuredRows, explicit winning', () => {
    const schema = baseSchema()
    const rows = Array.from({ length: 15 }, (_, i) => ({
      id: `s${i}`,
      data: { name: `Treatment ${i}`, desc: `Detail for ${i}` },
    }))
    const directory = { rowsBySection: { services: rows } }

    const { blocks } = buildContext(baseProfile(), schema, directory, [], {
      matchText: 'Book Treatment 2 today',
      featuredRows: { services: ['Treatment 9'] },
    })
    const featured = blocks.find(b => b.key === 'services__featured')
    // Explicit featuredRows replaces (not merges into) matched keys per section
    expect(featured?.text).toContain('Treatment 9')
    expect(featured?.text).not.toContain('Treatment 2')
  })

  it('every block considered is present in blocks[], muted or not, for the preview panel', () => {
    const { blocks } = buildContext(baseProfile(), baseSchema(), { rowsBySection: {} }, [], { mutedKeys: ['voice'] })
    expect(blocks.some(b => b.key === 'voice' && b.muted)).toBe(true)
  })
})
