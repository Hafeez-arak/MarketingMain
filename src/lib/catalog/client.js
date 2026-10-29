import { supabase } from '../supabaseClient'
import { getLang } from '../i18n'
import { itemRow, fieldRow, diffSpecs, storedName } from './logic'

// ─── Catalog: the browser's reads and writes (v2) ──────────────────────────
// 2026-10-30, dev/erp-pilot/CATALOG.md. Straight to the database with the
// person's own login: RLS (the catalog section grant) and the triggers in
// 20261130_catalog_1_tables.sql decide what goes through. Every query names
// its company: RLS is membership, not isolation. Items and fields are never
// deleted, only switched off.

const ITEM_COLS = 'id,workspace_id,code,name,brand,model_no,category,unit,description,stocked,active,datasheet_path,image_path,created_by,created_at,updated_at'
const FIELD_COLS = 'id,workspace_id,name,name_en,unit,sequence,active,created_at,updated_at'
const SPEC_COLS = 'id,item_id,field_id,value'
const BUCKET = 'catalog-files'

// The API returns at most 1,000 rows a request; a company's catalog is read whole.
const PAGE = 1000

async function readAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { rows, error: errorText(error) }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { rows, error: null }
  }
}

export const ERROR_WORDS = {
  en: {
    CATALOG_WORKSPACE_FIXED: () => 'An item cannot move to another company.',
    codeTaken: () => 'Another item in this company already has that code.',
    fieldTaken: () => 'There is already a specification field with that name.',
    notAllowed: () => 'You do not have access to do that in the Catalog.',
    notFound: () => 'That record is not there any more, or you cannot see it.',
    fileType: () => 'That file type is not allowed here.',
    fileSize: () => 'That file is too large (20 MB at most).',
    failed: () => 'It did not work. Try again.',
  },
  ar: {
    CATALOG_WORKSPACE_FIXED: () => 'لا يمكن نقل صنف إلى شركة أخرى.',
    codeTaken: () => 'يوجد صنف آخر في هذه الشركة بنفس الرمز.',
    fieldTaken: () => 'يوجد حقل مواصفات بهذا الاسم.',
    notAllowed: () => 'ليست لديك صلاحية لهذا في الكتالوج.',
    notFound: () => 'هذا السجل لم يعد موجودًا، أو لا يمكنك رؤيته.',
    fileType: () => 'نوع هذا الملف غير مسموح هنا.',
    fileSize: () => 'هذا الملف كبير جدًا (20 ميغابايت كحد أقصى).',
    failed: () => 'لم ينجح ذلك. حاول مجددًا.',
  },
}

/** A refusal from the database (or a code) in the reader's language. */
export function errorText(err, lang = getLang()) {
  const W = ERROR_WORDS[lang] || ERROR_WORDS.en
  const msg = String(err?.message || err || '')
  if (W[msg]) return W[msg]()
  if (msg.includes('catalog_items_code_uq')) return W.codeTaken()
  if (msg.includes('catalog_spec_fields_name_uq')) return W.fieldTaken()
  if (err?.code === '42501' || msg.includes('row-level security') || msg.includes('violates row-level')) return W.notAllowed()
  if (msg.includes('mime type')) return W.fileType()
  if (msg.includes('exceeded the maximum') || msg.includes('too large')) return W.fileSize()
  return msg && !/^[A-Z_]+$/.test(msg) ? msg : W.failed()
}

const fail = error => ({ error: errorText(error) })

// ── Reads ──

export const fetchItems = ws =>
  readAll(() => supabase.from('catalog_items').select(ITEM_COLS).eq('workspace_id', ws).order('code'))

export async function fetchItem(ws, id) {
  const { data, error } = await supabase.from('catalog_items').select(ITEM_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? { item: null, error: errorText(error) } : { item: data }
}

export const fetchFields = ws =>
  readAll(() => supabase.from('catalog_spec_fields').select(FIELD_COLS).eq('workspace_id', ws).order('sequence').order('name'))

export async function fetchSpecs(ws, itemId) {
  const { data, error } = await supabase.from('catalog_item_specs').select(SPEC_COLS).eq('workspace_id', ws).eq('item_id', itemId)
  return error ? { rows: [], error: errorText(error) } : { rows: data || [] }
}

/** The history of one item (its own changes and its specs'), newest first. */
export async function fetchAudit(ws, itemId) {
  const { data, error } = await supabase.from('catalog_audit')
    .select('id,table_name,row_id,item_id,action,changed_by,changed_at,old_data,new_data')
    .eq('workspace_id', ws).eq('item_id', itemId).order('id', { ascending: false }).limit(100)
  return error ? { rows: [], error: errorText(error) } : { rows: data || [] }
}

/** Names of the company's people (for "changed by"), anyone in the company. */
export async function fetchPeople(ws) {
  const { data, error } = await supabase.rpc('task_people', { ws })
  return error ? { rows: [] } : { rows: data || [] }
}

// ── Items ──

/** Writes the spec values of one item: given ones saved, blanked ones deleted. */
async function saveSpecs(ws, itemId, existing, values) {
  const { upserts, deletes } = diffSpecs(existing, values)
  if (deletes.length) {
    const { error } = await supabase.from('catalog_item_specs').delete().eq('workspace_id', ws).eq('item_id', itemId).in('id', deletes)
    if (error) return fail(error)
  }
  for (const u of upserts) {
    const { error } = u.id
      ? await supabase.from('catalog_item_specs').update({ value: u.value }).eq('workspace_id', ws).eq('id', u.id)
      : await supabase.from('catalog_item_specs').insert({ workspace_id: ws, item_id: itemId, field_id: u.field_id, value: u.value })
    if (error) return fail(error)
  }
  return {}
}

/**
 * Add (id empty) or change an item with its spec values { fieldId: text }.
 * Returns { item } or { error }. `existingSpecs` are the rows the form started from.
 */
export async function saveItem(ws, id, fields, values, existingSpecs = []) {
  const row = itemRow(fields)
  let item
  if (id) {
    const { data, error } = await supabase.from('catalog_items').update(row).eq('workspace_id', ws).eq('id', id).select(ITEM_COLS).maybeSingle()
    if (error) return fail(error)
    if (!data) return { error: errorText('notAllowed') }
    item = data
  } else {
    const me = (await supabase.auth.getUser()).data.user?.id || null
    const { data, error } = await supabase.from('catalog_items').insert({ ...row, workspace_id: ws, created_by: me }).select(ITEM_COLS).single()
    if (error) return fail(error)
    item = data
  }
  const specs = await saveSpecs(ws, item.id, existingSpecs, values)
  return specs.error ? { error: specs.error, item } : { item }
}

/** Stop (false) or start (true) an item. */
export async function setItemActive(ws, id, active) {
  const { data, error } = await supabase.from('catalog_items').update({ active }).eq('workspace_id', ws).eq('id', id).select(ITEM_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { item: data } : { error: errorText('notAllowed') }
}

/**
 * Upload a datasheet or picture and make it the item's. The previous file
 * stays in storage (Musa keeps it); only the item's path changes.
 */
export async function uploadItemFile(ws, itemId, kind, file) {
  const path = `${ws}/${itemId}/${storedName(file.name, Date.now().toString(36))}`
  const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false })
  if (up.error) return fail(up.error)
  const column = kind === 'image' ? 'image_path' : 'datasheet_path'
  const { data, error } = await supabase.from('catalog_items').update({ [column]: path }).eq('workspace_id', ws).eq('id', itemId).select(ITEM_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { item: data } : { error: errorText('notAllowed') }
}

/** A short-lived link to open a file. */
export async function fileUrl(path) {
  const r = await supabase.storage.from(BUCKET).createSignedUrl(path, 300)
  return r.error ? { error: errorText(r.error) } : { url: r.data.signedUrl }
}

// ── Specification fields ──

export async function saveField(ws, id, fields) {
  const row = fieldRow(fields)
  const { data, error } = id
    ? await supabase.from('catalog_spec_fields').update(row).eq('workspace_id', ws).eq('id', id).select(FIELD_COLS).maybeSingle()
    : await supabase.from('catalog_spec_fields').insert({ ...row, workspace_id: ws }).select(FIELD_COLS).single()
  if (error) return fail(error)
  return data ? { field: data } : { error: errorText('notAllowed') }
}

export async function setFieldActive(ws, id, active) {
  const { data, error } = await supabase.from('catalog_spec_fields').update({ active }).eq('workspace_id', ws).eq('id', id).select(FIELD_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { field: data } : { error: errorText('notAllowed') }
}
