import { describe, it, expect } from 'vitest'
import {
  ATTACH_LIMITS, validateAttachments, userContent, storedAttachments, attachmentNote, kindOf,
} from './attachments'
import { attachmentPayload } from '../agentChat'

const b64 = n => 'A'.repeat(n)
const img = (extra = {}) => ({ name: 'site.jpg', media_type: 'image/jpeg', data: b64(400), thumb: 'data:image/jpeg;base64,QUJD', ...extra })
const pdf = (extra = {}) => ({ name: 'brief.pdf', media_type: 'application/pdf', data: b64(400), ...extra })

describe('validateAttachments — the server boundary', () => {
  it('nothing attached is fine and changes nothing', () => {
    expect(validateAttachments(undefined)).toEqual({ ok: true, attachments: [], error: '' })
    expect(validateAttachments(null).attachments).toEqual([])
  })

  it('accepts images and PDFs and tags their kind', () => {
    const out = validateAttachments([img(), pdf()])
    expect(out.ok).toBe(true)
    expect(out.attachments.map(a => a.kind)).toEqual(['image', 'pdf'])
  })

  it('strips a data: prefix the browser left on', () => {
    const out = validateAttachments([img({ data: `data:image/jpeg;base64,${b64(8)}` })])
    expect(out.attachments[0].data).toBe(b64(8))
  })

  it('refuses the whole set rather than silently dropping one file', () => {
    const out = validateAttachments([img(), { name: 'x.exe', media_type: 'application/x-msdownload', data: b64(8) }])
    expect(out.ok).toBe(false)
    expect(out.attachments).toEqual([])
    expect(out.error).toMatch(/only images/)
  })

  it('refuses too many, too large together, and a PDF over its cap', () => {
    expect(validateAttachments(Array.from({ length: ATTACH_LIMITS.maxCount + 1 }, () => img())).ok).toBe(false)
    const half = Math.ceil(ATTACH_LIMITS.maxTotalBase64 / 2) + 8
    expect(validateAttachments([img({ data: b64(half) }), img({ data: b64(half) })]).error).toMatch(/too large together/)
    const bigPdf = b64(Math.ceil(ATTACH_LIMITS.maxPdfBytes * 4 / 3) + 100)
    expect(validateAttachments([pdf({ data: bigPdf })]).error).toMatch(/PDFs can be at most/)
  })

  it('refuses data that is not base64', () => {
    expect(validateAttachments([img({ data: 'not base64 at all!' })]).ok).toBe(false)
    expect(validateAttachments([img({ data: '' })]).ok).toBe(false)
  })

  it('keeps a small, well-formed thumbnail and drops anything else', () => {
    expect(validateAttachments([img()]).attachments[0].thumb).toMatch(/^data:image\/jpeg;base64,/)
    expect(validateAttachments([img({ thumb: 'javascript:alert(1)' })]).attachments[0].thumb).toBe('')
    const huge = `data:image/jpeg;base64,${b64(ATTACH_LIMITS.maxThumbChars)}`
    expect(validateAttachments([img({ thumb: huge })]).attachments[0].thumb).toBe('')
  })

  it('the request stays under Vercel\'s 4.5 MB body cap at the limits', () => {
    const worst = ATTACH_LIMITS.maxTotalBase64 + ATTACH_LIMITS.maxCount * ATTACH_LIMITS.maxThumbChars
    expect(worst).toBeLessThan(4_500_000 - 100_000)
  })
})

describe('userContent — what the model receives', () => {
  it('stays a plain string when nothing is attached, byte-identical to before', () => {
    expect(userContent('hello', [])).toBe('hello')
    expect(userContent('hello')).toBe('hello')
  })

  it('puts files first as image / document blocks, then the words', () => {
    const { attachments } = validateAttachments([img(), pdf()])
    const content = userContent('what is this?', attachments)
    expect(content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(400) } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(400) }, title: 'brief.pdf' },
      { type: 'text', text: 'what is this?' },
    ])
  })
})

describe('what is stored and replayed', () => {
  it('stores the name, type and thumbnail — never the file', () => {
    const { attachments } = validateAttachments([img()])
    const stored = storedAttachments(attachments)
    expect(stored).toEqual([{ name: 'site.jpg', media_type: 'image/jpeg', kind: 'image', thumb: 'data:image/jpeg;base64,QUJD' }])
    expect(JSON.stringify(stored)).not.toContain(b64(400))
  })

  it('replays a note in place of the file, saying it is not re-sent', () => {
    const note = attachmentNote([{ name: 'site.jpg', kind: 'image' }, { name: 'brief.pdf', kind: 'pdf' }])
    expect(note).toMatch(/site\.jpg \(image\), brief\.pdf \(PDF\)/)
    expect(note).toMatch(/not re-sent/)
    expect(attachmentNote([])).toBe('')
    expect(attachmentNote(null)).toBe('')
  })

  it('kindOf', () => {
    expect(kindOf('image/png')).toBe('image')
    expect(kindOf('application/pdf')).toBe('pdf')
    expect(kindOf('text/plain')).toBe('')
  })
})

describe('attachmentPayload — the browser side of the request', () => {
  it('sends only the four fields the server reads', () => {
    const out = attachmentPayload([{ id: 'a1', name: 'n.jpg', media_type: 'image/jpeg', kind: 'image', data: 'QUJD', thumb: 't', junk: 1 }])
    expect(out).toEqual([{ name: 'n.jpg', media_type: 'image/jpeg', data: 'QUJD', thumb: 't' }])
  })

  it('omits the field entirely when there is nothing to send', () => {
    expect(attachmentPayload([])).toBeUndefined()
    expect(attachmentPayload(undefined)).toBeUndefined()
    expect(attachmentPayload([{ name: 'empty' }])).toBeUndefined()
  })

  it('what it builds passes the server check', () => {
    const payload = attachmentPayload([{ id: 'a1', name: 'n.jpg', media_type: 'image/jpeg', data: b64(12), thumb: '' }])
    expect(validateAttachments(payload).ok).toBe(true)
  })
})
