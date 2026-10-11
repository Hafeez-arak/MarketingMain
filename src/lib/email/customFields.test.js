import { describe, it, expect } from 'vitest'
import { parseCsv, rowsToContacts, customKey } from './csv.js'
import { applyMergeTags, unknownMergeTags, customKeysOf, renderEmail } from './render.js'
import { coldProblems } from './cold.js'

describe('list columns kept as custom fields', () => {
  it('turns headers into tag keys, and refuses what cannot be one', () => {
    expect(customKey('Ice breaker')).toBe('ice_breaker')
    expect(customKey('Project Name ')).toBe('project_name')
    expect(customKey('2025 revenue')).toBe('col_2025_revenue')
    expect(customKey('Café')).toBe('cafe')
    expect(customKey('المشروع')).toBe('')
    expect(customKey('company')).toBe('')   // a standard field is never shadowed
  })

  it('keeps every unmapped column on each contact, empty where the cell is', () => {
    const csv = 'Email,First name,Ice breaker,Project,المشروع\na@x.sa,Ali,Loved the tower,Tower 1,برج\nb@x.sa,Bea,,Tower 2,برج'
    const out = rowsToContacts(parseCsv(csv), { audience: 'cold' })
    expect(out.custom.map(c => c.key)).toEqual(['ice_breaker', 'project'])
    expect(out.dropped).toEqual(['المشروع'])
    expect(out.contacts[0].custom).toEqual({ ice_breaker: 'Loved the tower', project: 'Tower 1' })
    expect(out.contacts[1].custom).toEqual({ ice_breaker: '', project: 'Tower 2' })
  })

  it('a headerless list of addresses has no custom fields', () => {
    const out = rowsToContacts(parseCsv('a@x.sa\nb@x.sa'), { audience: 'cold' })
    expect(out.contacts).toHaveLength(2)
    expect(out.contacts[0].custom).toBeUndefined()
  })
})

describe('merging custom fields', () => {
  const c = { first_name: 'Ali', custom: { ice_breaker: 'Loved the tower', project: '' } }

  it('fills a custom field the contact has, with the fallback when it is empty', () => {
    expect(applyMergeTags('{{ice_breaker}} / {{project|your project}}', c)).toBe('Loved the tower / your project')
  })

  it('leaves an unknown tag visible in a preview, but never sends it raw', () => {
    expect(applyMergeTags('Hi {{nickname}}', c)).toBe('Hi {{nickname}}')
    expect(applyMergeTags('Hi {{nickname|there}}', c, {}, { anyCustom: true })).toBe('Hi there')
    expect(applyMergeTags('Hi {{nickname}}!', c, {}, { anyCustom: true })).toBe('Hi!')
  })

  it('knows a tag is fine when any recipient has that column', () => {
    const keys = customKeysOf([c, { custom: { industry: 'Hotels' } }, {}])
    expect(keys).toEqual(['ice_breaker', 'industry', 'project'])
    expect(unknownMergeTags('{{industry}} {{nickname}}', keys)).toEqual(['nickname'])
    const camp = { subject: 'Hi', body: '{{industry}} and {{nickname}}', follow_ups: [] }
    expect(coldProblems(camp, { customKeys: keys }).join(' ')).toMatch(/\{\{nickname\}\}/)
    expect(coldProblems({ ...camp, body: '{{industry}}' }, { customKeys: keys })).toEqual([])
  })

  it('a cold email resolves choices with its seed and keeps them stable', () => {
    const args = { audience: 'cold', subject: '{Hi|Hello} {{first_name}}', body: '{One|Two|Three}. {{ice_breaker}}', contact: c, spinSeed: 'camp:0:k' }
    const a = renderEmail(args)
    expect(a.subject).toMatch(/^(Hi|Hello) Ali$/)
    expect(a.text).toMatch(/^(One|Two|Three)\. Loved the tower/)
    expect(renderEmail(args)).toEqual(a)
    // A newsletter never treats braces as choices.
    expect(renderEmail({ ...args, audience: 'marketing' }).subject).toBe('{Hi|Hello} Ali')
  })
})

describe('versions in the launch check', () => {
  it('an extra version needs its own subject and body', () => {
    const camp = { subject: 'A', body: 'Body', follow_ups: [], variants: [{ subject: '', body: '' }] }
    expect(coldProblems(camp)).toEqual(['Version B needs a subject line.', 'Version B is empty: write it or remove it.'])
  })
})
