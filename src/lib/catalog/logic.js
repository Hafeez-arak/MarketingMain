import { normalizeSearch } from '../contacts/logic'

// ─── Catalog: the rules the screens share (v2) ─────────────────────────────
// 2026-10-30, dev/erp-pilot/CATALOG.md. Pure: no React, no IO, so it is
// tested (logic.test.js). The database repeats the rules that matter
// (20261130_catalog_1_tables.sql); these give the person the reason before
// the round trip.

export const PAGE_SIZE = 50
export const GROUPS = ['category', 'brand']
export const STATUSES = ['active', 'stopped']
export const MIME = {
  datasheet: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  image: ['image/jpeg', 'image/png', 'image/webp'],
}
export const MAX_FILE_BYTES = 20 * 1024 * 1024

const trim = v => String(v ?? '').trim()
const blank = v => trim(v) === ''
/** Empty text is no value at all (null), as the table's checks require. */
const orNull = v => (blank(v) ? null : trim(v))

/** The item form's fields, empty. */
export function emptyItem() {
  return { code: '', name: '', brand: '', model_no: '', category: '', unit: '', description: '', stocked: false }
}

/** What is wrong with an item form: { field: code }. Empty when it can be saved. */
export function validateItem(f) {
  const e = {}
  if (blank(f.code)) e.code = 'required'
  if (blank(f.name)) e.name = 'required'
  if (blank(f.unit)) e.unit = 'required'
  return e
}

/** The item form as the table's columns: trimmed, empty optional text as null. */
export function itemRow(f) {
  return {
    code: trim(f.code), name: trim(f.name), unit: trim(f.unit),
    brand: orNull(f.brand), model_no: orNull(f.model_no), category: orNull(f.category),
    description: orNull(f.description), stocked: Boolean(f.stocked),
  }
}

/** A spec field's form as the table's columns. */
export function fieldRow(f) {
  return { name: trim(f.name), name_en: orNull(f.name_en), unit: orNull(f.unit), sequence: Number.isFinite(Number(f.sequence)) ? Math.trunc(Number(f.sequence)) : 10 }
}

export function validateField(f) {
  const e = {}
  if (blank(f.name)) e.name = 'required'
  if (f.sequence !== '' && f.sequence !== undefined && !Number.isFinite(Number(f.sequence))) e.sequence = 'number'
  return e
}

/** A new field's order: the highest order plus 10 (10 for the first). */
export function nextOrder(fields = []) {
  return fields.length ? Math.max(...fields.map(f => Number(f.sequence) || 0)) + 10 : 10
}

/** A field's name in the reader's language: its English one in English when it has one. */
export const fieldName = (f, lang = 'en') => (!f ? '' : lang === 'ar' ? f.name : f.name_en || f.name)

const bySequence = (a, b) => (Number(a.sequence) || 0) - (Number(b.sequence) || 0) || String(a.name).localeCompare(String(b.name))

/**
 * The inputs of the item form: every active field, plus any switched-off
 * field the item already has a value for, in order. `values` is { fieldId: text }.
 */
export function formFields(fields = [], values = {}) {
  return fields.filter(f => f.active || !blank(values[f.id])).sort(bySequence)
}

/** The item page's specifications: every recorded value with its field, in the fields' order. */
export function specLines(fields = [], specs = []) {
  const byField = Object.fromEntries(fields.map(f => [f.id, f]))
  return specs
    .filter(s => byField[s.field_id] && !blank(s.value))
    .map(s => ({ field: byField[s.field_id], value: s.value }))
    .sort((a, b) => bySequence(a.field, b.field))
}

/** { fieldId: value } from an item's spec rows. */
export const specValues = (specs = []) => Object.fromEntries(specs.map(s => [s.field_id, s.value]))

/**
 * What saving the form's values changes: a value given is written (new or
 * changed), a value left blank deletes the row that was there. Nothing
 * unchanged is touched.
 */
export function diffSpecs(existing = [], values = {}) {
  const had = Object.fromEntries(existing.map(s => [s.field_id, s]))
  const upserts = []
  const deletes = []
  for (const [fieldId, raw] of Object.entries(values)) {
    const v = trim(raw)
    if (v === '') { if (had[fieldId]) deletes.push(had[fieldId].id); continue }
    if (!had[fieldId]) upserts.push({ field_id: fieldId, value: v, id: null })
    else if (had[fieldId].value !== v) upserts.push({ field_id: fieldId, value: v, id: had[fieldId].id })
  }
  return { upserts, deletes }
}

/** The distinct values already used in a column, for the form's suggestions. */
export function usedValues(items = [], key) {
  return [...new Set(items.map(i => trim(i[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

const SEARCH_KEYS = ['code', 'name', 'brand', 'model_no', 'category']

/** Items by status (active | stopped) and a search over code, name, brand, model and category. */
export function filterItems(items = [], { q = '', status = 'active' } = {}) {
  const words = normalizeSearch(q).split(/\s+/).filter(Boolean)
  return items.filter(i => {
    if (status === 'active' && !i.active) return false
    if (status === 'stopped' && i.active) return false
    if (!words.length) return true
    const hay = normalizeSearch(SEARCH_KEYS.map(k => i[k]).join(' '))
    return words.every(w => hay.includes(w))
  })
}

/** Items in groups by category or brand: [{ key, rows }], named groups A–Z and the empty one last. */
export function groupItems(items = [], by = '') {
  if (!GROUPS.includes(by)) return [{ key: '', rows: items }]
  const map = new Map()
  for (const i of items) {
    const key = trim(i[by])
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(i)
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))
    .map(([key, rows]) => ({ key, rows }))
}

/** Items in code order. */
export const sortItems = (items = []) => [...items].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))

/** One page of rows: { rows, page, pages }. The page is kept within range. */
export function paginate(rows = [], page = 1, size = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const p = Math.min(Math.max(1, Math.trunc(Number(page)) || 1), pages)
  return { rows: rows.slice((p - 1) * size, p * size), page: p, pages }
}

/** Is this file allowed as this kind (datasheet | image), by type and size? '' when it is. */
export function fileProblem(kind, file) {
  if (!file) return 'none'
  if (!(MIME[kind] || []).includes(file.type)) return 'type'
  if (file.size > MAX_FILE_BYTES) return 'size'
  if (file.size === 0) return 'empty'
  return ''
}

/** A stored name that is safe in a path: no folders, no spaces, nothing odd, unique by its prefix. */
export function storedName(name, stamp) {
  const clean = String(name || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file'
  return `${stamp}-${clean}`
}

// ── History ──
const QUIET = new Set(['id', 'workspace_id', 'created_at', 'created_by', 'updated_at', 'item_id'])

/** The fields a history row changed: [{ field, from, to }]. An insert or delete lists what was filled. */
export function describeChange(row) {
  const oldD = row.old_data || {}
  const newD = row.new_data || {}
  const keys = [...new Set([...Object.keys(newD), ...Object.keys(oldD)])].filter(k => !QUIET.has(k))
  if (row.action === 'update') return keys.filter(k => JSON.stringify(oldD[k]) !== JSON.stringify(newD[k])).map(k => ({ field: k, from: oldD[k] ?? null, to: newD[k] ?? null }))
  const src = row.action === 'insert' ? newD : oldD
  return keys.filter(k => src[k] !== null && src[k] !== '' && src[k] !== undefined).map(k => ({ field: k, from: null, to: src[k] }))
}
