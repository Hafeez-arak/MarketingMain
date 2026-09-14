import { describe, it, expect } from 'vitest'
import { parseBlocks, parseInline } from './markdown.js'

describe('parseBlocks', () => {
  it('reads the answer that prompted this: bold lead, paragraph, list', () => {
    const blocks = parseBlocks([
      '**Instagram evidence (proves — but thin: n=3 posts, one competitor)**',
      'Huda Lighting is the only rival on our board.',
      '',
      'Huda, 3 posts in the period:',
      '- Cadence up 2 → 3 posts/week',
      '- Their single best post was a **reel**',
    ].join('\n'))
    expect(blocks.map(b => b.type)).toEqual(['paragraph', 'paragraph', 'list'])
    expect(blocks[0].text).toContain('\nHuda Lighting')
    expect(blocks[1].text).toBe('Huda, 3 posts in the period:')
    expect(blocks[2]).toMatchObject({ ordered: false, items: [{ depth: 0 }, { depth: 0 }] })
  })

  it('keeps one ordered list across blank lines between items', () => {
    const blocks = parseBlocks('1. one\n\n2. two\n\n3. three')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].items.map(i => i.text)).toEqual(['one', 'two', 'three'])
  })

  it('honours a list that does not start at 1', () => {
    expect(parseBlocks('4. four\n5. five')[0].start).toBe(4)
  })

  it('nests indented items and folds continuation lines into the item', () => {
    const [list] = parseBlocks('- top\n  - child\n    still the child')
    expect(list.items).toEqual([
      { text: 'top', depth: 0 },
      { text: 'child\nstill the child', depth: 1 },
    ])
  })

  it('starts a paragraph for an unindented line after a list', () => {
    expect(parseBlocks('- a\nThe honest read.').map(b => b.type)).toEqual(['list', 'paragraph'])
  })

  it('reads headings, rules, quotes', () => {
    expect(parseBlocks('## What I have\n---\n> quoted\n> more')).toEqual([
      { type: 'heading', level: 2, text: 'What I have' },
      { type: 'rule' },
      { type: 'quote', text: 'quoted\nmore' },
    ])
  })

  it('does not mistake a rule for a list item', () => {
    expect(parseBlocks('* * *')).toEqual([{ type: 'rule' }])
  })

  it('reads a table, padding nothing and trimming cells', () => {
    const [t] = parseBlocks('| Brand | Posts |\n|---|--:|\n| Huda | 3 |\n| Technolight | 0 |')
    expect(t).toEqual({ type: 'table', header: ['Brand', 'Posts'], rows: [['Huda', '3'], ['Technolight', '0']] })
  })

  it('leaves Markdown inside a code fence alone, and runs an unclosed fence to the end', () => {
    expect(parseBlocks('```\n- not a list\n```')).toEqual([{ type: 'code', text: '- not a list' }])
    expect(parseBlocks('```js\nconst a = 1')).toEqual([{ type: 'code', text: 'const a = 1' }])
  })

  it('returns nothing for empty or missing text', () => {
    expect(parseBlocks('')).toEqual([])
    expect(parseBlocks(undefined)).toEqual([])
  })
})

describe('parseInline', () => {
  it('reads bold, italic and code', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
    ])
  })

  it('does not read emphasis inside a code span or inside snake_case', () => {
    expect(parseInline('`ig_status: *not_found*`')).toEqual([{ type: 'code', text: 'ig_status: *not_found*' }])
    expect(parseInline('posts_total and ig_status')).toEqual([{ type: 'text', text: 'posts_total and ig_status' }])
  })

  it('renders a half-streamed bold marker as plain text', () => {
    expect(parseInline('the **decorative statement')).toEqual([{ type: 'text', text: 'the **decorative statement' }])
  })

  it('does not read arithmetic as emphasis', () => {
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }])
  })

  it('nests emphasis inside bold', () => {
    expect(parseInline('**not *really***')[0]).toEqual({
      type: 'strong',
      children: [{ type: 'text', text: 'not ' }, { type: 'em', children: [{ type: 'text', text: 'really' }] }],
    })
  })

  it('links only to http(s), and never to a javascript: href', () => {
    expect(parseInline('[site](https://arak-sa.com)')).toEqual([
      { type: 'link', href: 'https://arak-sa.com', children: [{ type: 'text', text: 'site' }] },
    ])
    expect(parseInline('[x](javascript:alert(1))').some(t => t.type === 'link')).toBe(false)
  })

  it('links a bare URL without eating the full stop after it', () => {
    const tokens = parseInline('See https://example.com/a.')
    expect(tokens[1]).toMatchObject({ type: 'link', href: 'https://example.com/a' })
    expect(tokens[2]).toEqual({ type: 'text', text: '.' })
  })
})
