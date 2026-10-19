import { describe, it, expect } from 'vitest'
import { tidyEmail, emailSegments, emailLinks, isFileLink, fileSize, hostOf } from './emailText'
import { realAttachments } from '../../../api/leads/_mail.js'

// Shapes Microsoft's plain-text bodies really take (made-up companies).
describe('the email as a person reads it', () => {
  it('drops the picture placeholders and doubled mail links', () => {
    expect(tidyEmail('Best Regards,\n\n[cid:195874d0-d5e4-47e7-8fb9-adec9825c390]\n\n\n\nAli\nali@example.com<mailto:ali@example.com>'))
      .toBe('Best Regards,\n\nAli\nali@example.com')
    expect(tidyEmail('Ali<mailto:ali@example.com>')).toBe('Ali (ali@example.com)')
  })
  it('makes one link of a doubled one, and keeps a link\'s own words', () => {
    expect(emailSegments('See www.example.com<http://www.example.com> today')).toEqual([
      { text: 'See ' }, { link: 'www.example.com', href: 'http://www.example.com', host: 'example.com' }, { text: ' today' },
    ])
    expect(emailSegments('Files: Download<https://example.sharepoint.com/:f:/s/rfq>.')).toEqual([
      { text: 'Files: Download ' }, { link: 'example.sharepoint.com', href: 'https://example.sharepoint.com/:f:/s/rfq', host: 'example.sharepoint.com' }, { text: '.' },
    ])
  })
  it('links bare addresses, without the full stop after them', () => {
    expect(emailSegments('Drawings at https://we.tl/t-abc123. Thanks')).toEqual([
      { text: 'Drawings at ' }, { link: 'https://we.tl/t-abc123', href: 'https://we.tl/t-abc123', host: 'we.tl' }, { text: '. Thanks' },
    ])
    expect(emailSegments('visit www.example.sa')[1]).toEqual({ link: 'www.example.sa', href: 'https://www.example.sa', host: 'example.sa' })
  })
  it('never makes a link of anything but http(s)', () => {
    expect(emailSegments('javascript:alert(1)<javascript:alert(1)>').every((p) => !p.href)).toBe(true)
  })
  it('lists each link once, and tells shared files from websites', () => {
    const links = emailLinks('www.example.com<http://www.example.com> and http://www.example.com/ and https://example-my.sharepoint.com/x')
    expect(links.map((l) => l.href)).toEqual(['http://www.example.com', 'https://example-my.sharepoint.com/x'])
    expect(isFileLink('https://example-my.sharepoint.com/x')).toBe(true)
    expect(isFileLink('https://example.com/boq.pdf')).toBe(true)
    expect(isFileLink('http://www.example.com')).toBe(false)
    expect(hostOf('nope')).toBe('')
    expect(fileSize(1_234_567)).toBe('1.2 MB')
    expect(fileSize(340_000)).toBe('340 KB')
  })
})

describe('the attachments worth showing', () => {
  it('leaves out pictures in the text and small logos; marks the too-large and the links', () => {
    const list = [
      { id: '1', name: 'BOQ.xlsx', contentType: 'application/vnd.ms-excel', size: 80_000, isInline: false, '@odata.type': '#microsoft.graph.fileAttachment' },
      { id: '2', name: 'image001.png', contentType: 'image/png', size: 9_000, isInline: false },
      { id: '3', name: 'logo.png', contentType: 'image/png', size: 60_000, isInline: true },
      { id: '4', name: 'Site photo.jpg', contentType: 'image/jpeg', size: 900_000, isInline: false },
      { id: '5', name: 'Drawings.zip', contentType: 'application/zip', size: 9_000_000, isInline: false },
      { id: '6', name: 'RFQ', contentType: '', size: 0, isInline: false, '@odata.type': '#microsoft.graph.referenceAttachment' },
    ]
    expect(realAttachments(list).map((a) => [a.name, a.kind, a.tooBig])).toEqual([
      ['BOQ.xlsx', 'file', false], ['Site photo.jpg', 'file', false], ['Drawings.zip', 'file', true], ['RFQ', 'link', false],
    ])
  })
})
