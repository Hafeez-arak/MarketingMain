import { describe, it, expect } from 'vitest'
import { crc32, zipStored, buildXlsx } from './xlsx'

const dec = new TextDecoder()

/** The files of a stored zip, read back through its central directory. */
function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  expect(v.getUint32(end, true)).toBe(0x06054b50)
  const count = v.getUint16(end + 10, true)
  let at = v.getUint32(end + 16, true)
  const files = {}
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50)
    const size = v.getUint32(at + 20, true)
    const nameLen = v.getUint16(at + 28, true)
    const offset = v.getUint32(at + 42, true)
    const name = dec.decode(bytes.slice(at + 46, at + 46 + nameLen))
    const localName = v.getUint16(offset + 26, true)
    const data = bytes.slice(offset + 30 + localName, offset + 30 + localName + size)
    expect(crc32(data)).toBe(v.getUint32(at + 16, true))
    files[name] = dec.decode(data)
    at += 46 + nameLen
  }
  return files
}

describe('xlsx', () => {
  it('computes the zip checksum', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('writes a zip whose files read back exactly', () => {
    expect(unzip(zipStored({ 'a.txt': 'hello', 'ب.txt': 'عربي' }))).toEqual({ 'a.txt': 'hello', 'ب.txt': 'عربي' })
  })

  it('writes a sheet with text, numbers, styles and right to left', () => {
    const files = unzip(buildXlsx({ sheet: 'الحضور', rtl: true, widths: [20, 8], rows: [[{ v: 'Daily <attendance>', s: 'title' }], [{ v: 'Name', s: 'head' }, 'Hours'], ['سارة', 8.5], [null, '']] }))
    expect(Object.keys(files)).toContain('xl/worksheets/sheet1.xml')
    const sheet = files['xl/worksheets/sheet1.xml']
    expect(sheet).toContain('rightToLeft="1"')
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Daily &lt;attendance&gt;</t></is></c>')
    expect(sheet).toContain('<c r="B3"><v>8.5</v></c>')
    expect(sheet).toContain('<t xml:space="preserve">سارة</t>')
    expect(sheet).toContain('<col min="1" max="1" width="20" customWidth="1"/>')
    expect(files['xl/workbook.xml']).toContain('name="الحضور"')
  })
})
