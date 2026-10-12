import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { toRow } from '../../api/leads/_export.js'

// The leads workbook's script (LeadsMaster.gs), run against a sheet kept in
// memory: what an upgrade does to a tab the team already works in, and that
// the agent's refresh never overwrites what the team owns. Rows come from the
// real export (toRow), so the script's FIELD names are checked against it.

const SOURCE = readFileSync(new URL('./LeadsMaster.gs', import.meta.url), 'utf8')

function fakeSheet(name, rows) {
  const meta = []
  const width = () => (rows[0] || []).length
  const pad = (r) => { while (r.length < width()) r.push(''); return r }
  const range = (r, c, nr = 1, nc = 1) => ({
    // Like Sheets: a range past the data reads as blank cells.
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (rows[r - 1 + i] || [])[c - 1 + j] ?? '')),
    getDisplayValues() { return this.getValues().map((row) => row.map(String)) },
    setValues(vals) {
      vals.forEach((v, i) => {
        while (rows.length < r + i) rows.push(new Array(width()).fill(''))
        v.forEach((x, j) => { pad(rows[r - 1 + i])[c - 1 + j] = x })
      })
      return this
    },
    setValue(v) { return this.setValues([[v]]) },
    sort({ column, ascending }) {
      const body = rows.splice(r - 1, nr)
      body.sort((a, b) => (String(a[column - 1]) < String(b[column - 1]) ? -1 : 1) * (ascending ? 1 : -1))
      rows.splice(r - 1, 0, ...body)
    },
  })
  return {
    rows,
    getName: () => name,
    setName(n) { name = n; return this },
    getDeveloperMetadata: () => meta.map(([k, v]) => ({ getKey: () => k, getValue: () => v })),
    addDeveloperMetadata: (k, v) => meta.push([k, v]),
    getLastColumn: width,
    getLastRow: () => rows.length,
    getMaxRows: () => rows.length + 100,
    getRange: range,
    insertColumnAfter: (col) => rows.forEach((row) => pad(row).splice(col, 0, '')),
    deleteRow: (r) => rows.splice(r - 1, 1),
    insertRowsAfter: () => {},
    setRowHeightsForced: () => {},
  }
}

function load(sheets) {
  const globals = {
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => sheets, insertSheet: (n) => { const s = fakeSheet(n, []); sheets.push(s); return s } }) },
    PropertiesService: {}, ScriptApp: {}, UrlFetchApp: {}, LockService: {}, console,
  }
  return new Function(...Object.keys(globals), `${SOURCE}\nreturn { setupTab_, apply_, HEADERS, FIELD }`)(...Object.values(globals))
}

const OLD = ['Received', 'Source', 'Name', 'Company', 'Email', 'Phone', 'Brief', 'AI verdict', 'Decision', 'Type', 'AI reason', 'Link', 'Status', 'Assigned to', 'Notes', 'Lead ID']
const ID = '33333333-3333-4333-8333-333333333333'
const at = (sheet, header, row = 2) => sheet.rows[row - 1][sheet.rows[0].indexOf(header)]

function oldTab() {
  const row = new Array(OLD.length).fill('')
  row[OLD.indexOf('Received')] = '2026-10-06 13:00'
  row[OLD.indexOf('Status')] = 'Contacted'
  row[OLD.indexOf('Notes')] = 'Called Ahmed, site visit Sunday'
  row[OLD.indexOf('Lead ID')] = ID
  return fakeSheet('New leads', [OLD.slice(), row])
}

const lead = (over = {}) => ({
  ...toRow({
    id: ID, source: 'email', mailbox: 'info@clb-sa.com', received_at: '2026-10-06T10:00:00Z', folder: 'junk', email_kind: 'company',
    criteria_version: 2, sender_type: 'contractor', source_check: 'verified', request_type: 'requirement', project_type: 'tender',
    phones: ['+966 55 123 4567', '+966 11 222 3333'], verdict: 'qualified', category: 'project_enquiry', subject: 'Tower', message: 'Facade lighting',
  }),
  ...over,
})

describe('upgrading a tab the team already works in', () => {
  it('slots every new column in beside its neighbour; the team\'s cells stay on their row', () => {
    const tab = oldTab()
    const gs = load([tab])
    gs.setupTab_('New leads')
    expect(tab.rows[0]).toEqual(['Received', 'Came in', 'Folder', 'Source', 'Name', 'Company', 'Email', 'Email type', 'Phone',
      'Who', 'Verified', 'Request', 'Project', 'Philips', 'Brief', 'AI verdict', 'Decision', 'Type', 'AI reason', 'Link',
      'Status', 'Assigned to', 'Notes', 'Lead ID'])
    expect(at(tab, 'Status')).toBe('Contacted')
    expect(at(tab, 'Notes')).toBe('Called Ahmed, site visit Sunday')
    expect(at(tab, 'Lead ID')).toBe(ID)
  })

  it('a brand-new tab gets HEADERS as they are, and every header but the team\'s has a field the export sends', () => {
    // A new workbook has one blank tab, which becomes "New leads".
    const first = fakeSheet('Sheet1', [])
    const gs = load([first])
    gs.setupTab_('New leads')
    expect(first.getName()).toBe('New leads')
    expect(first.rows[0]).toEqual(gs.HEADERS)
    const row = lead()
    for (const h of gs.HEADERS) {
      if (['Decision', 'Status', 'Assigned to', 'Notes'].includes(h)) continue
      expect(gs.FIELD[h], h).toBeTruthy()
      expect(row, h).toHaveProperty(gs.FIELD[h])
    }
  })
})

describe('the refresh', () => {
  it('fills the criteria on a known row and leaves the team\'s columns alone', () => {
    const tab = oldTab()
    const gs = load([tab])
    gs.setupTab_('New leads')
    gs.apply_([lead()])
    expect(at(tab, 'Came in')).toBe('CLB email')
    expect(at(tab, 'Folder')).toBe('Junk')
    expect(at(tab, 'Who')).toBe('Contractor')
    expect(at(tab, 'Verified')).toBe('Verified')
    expect(at(tab, 'Project')).toBe('Tender')
    expect(at(tab, 'Type')).toBe('project enquiry')
    expect(at(tab, 'Phone')).toBe("'+966 55 123 4567\n+966 11 222 3333")
    expect(at(tab, 'Status')).toBe('Contacted')
    expect(at(tab, 'Notes')).toBe('Called Ahmed, site visit Sunday')
  })

  it('never overwrites a Project the team filled in, and never clears one', () => {
    const tab = oldTab()
    const gs = load([tab])
    gs.setupTab_('New leads')
    tab.rows[1][tab.rows[0].indexOf('Project')] = 'JIH'
    gs.apply_([lead()])
    expect(at(tab, 'Project')).toBe('JIH')
    gs.apply_([lead({ project: '' })])
    expect(at(tab, 'Project')).toBe('JIH')
  })

  it('a new lead the email says nothing about arrives with Project empty, for the team', () => {
    const tab = oldTab()
    const gs = load([tab])
    gs.setupTab_('New leads')
    const other = toRow({ id: '44444444-4444-4444-8444-444444444444', source: 'website_form', received_at: '2026-10-07T10:00:00Z', criteria_version: 2, verdict: 'needs_review', email_kind: 'free' })
    gs.apply_([other])
    expect(tab.rows).toHaveLength(3)
    // Newest first.
    expect(at(tab, 'Lead ID', 2)).toBe(other.id)
    expect(at(tab, 'Project', 2)).toBe('')
    expect(at(tab, 'Came in', 2)).toBe('Arak website')
    expect(at(tab, 'Email type', 2)).toBe('Free email')
  })
})
