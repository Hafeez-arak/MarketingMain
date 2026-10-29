import { supabase } from '../supabaseClient'
import { getLang } from '../i18n'

// ─── Pricing: the browser's reads and writes (v2) ──────────────────────────
// 2026-12-01, dev/erp-pilot/PRICING.md. Straight to the database with the
// person's own login: RLS (the pricing section grant), the guards and the
// functions of 20261201_pricing_*.sql decide what goes through. Every query
// names its company: RLS is membership, not isolation. A sheet's status is
// never written here, only through the four transition functions.

const SHEET_COLS = 'id,workspace_id,sheet_no,lead_id,title,status,notes,margin_note,min_margin_pct,submitted_at,submitted_by,approved_at,approved_by,cancelled_at,cancelled_by,cancel_reason,created_by,created_at,updated_at'
const LINE_COLS = 'id,sheet_id,line_no,boq_ref,description,quantity,unit,catalog_item_id,unit_price,selected_quote_line_id,notes,cost_category'
const QUOTE_COLS = 'id,workspace_id,quote_no,sheet_id,supplier_id,status,requested_on,received_on,supplier_ref,valid_until,currency,fx_rate,freight_amount,customs_amount,other_charges,notes,created_by,created_at'
const QLINE_COLS = 'id,quote_id,pricing_line_id,offered_description,brand,model_no,catalog_item_id,quantity,unit_price,is_alternative,lead_time_days,notes'

// The API returns at most 1,000 rows a request; a company's sheets are read whole.
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
    PRICING_TRANSITION: () => 'That step is not possible from the sheet’s state: a sheet is submitted before it is approved, and only a submitted sheet is returned to draft.',
    PRICING_LEAD_CLOSED: () => 'A pricing sheet cannot be created on a closed opportunity.',
    PRICING_LOCKED: () => 'The sheet is submitted, approved or cancelled and cannot be edited. Return a submitted sheet to draft; an approved one can only be cancelled, with a written reason.',
    PRICING_BLOCKED: () => 'The sheet has blocking checks (a line without a price, a supplier or a known cost, an expired supplier quote, or a margin below the limit without a reason). Resolve them and try again.',
    PRICING_NOT_DRAFT: () => 'Lines and supplier quotes change only while the sheet is a draft; return it to draft first.',
    PRICING_SELECTION: () => 'Choose a priced offer for this line from a received supplier quote.',
    PRICING_QUOTE_LINE: () => 'A supplier quote can only answer lines of the same sheet.',
    PRICING_QUOTE_SELECTED: () => 'This quote or offer is chosen for lines of the sheet; unselect it first.',
    PRICING_DELETE_NOT_DRAFT: () => 'Only a draft is deleted. A submitted or approved sheet is cancelled with a reason instead.',
    PRICING_SUPPLIER: () => 'Choose an active organisation that is a supplier in Contacts.',
    PRICING_CURRENCY: () => 'That currency is not available.',
    PRICING_NOT_ALLOWED: () => 'You do not have the access for that in Pricing.',
    PRICING_NOT_FOUND: () => 'That sheet is not there any more, or you cannot see it.',
    PRICING_REASON: () => 'Write the reason first.',
    PRICING_NO_ROWS: () => 'There is nothing to save.',
    PRICING_NO_LINES: () => 'Enter the BOQ lines first, then ask suppliers to quote them.',
    PRICING_LINE_MISSING: () => 'One of those lines is not on this sheet any more. Reload and try again.',
    PRICING_ITEM: () => 'Choose an active catalog item.',
    receivedDate: () => 'A received quote needs the date it was received.',
    validity: () => 'The quote cannot be valid until before the day it was received.',
    notAllowed: () => 'You do not have access to do that in Pricing.',
    failed: () => 'It did not work. Try again.',
  },
  ar: {
    PRICING_TRANSITION: () => 'هذه الخطوة غير ممكنة من حالة الملف الحالية: يُرسل الملف للاعتماد قبل أن يُعتمد، ولا يُعاد إلى مسودة إلا الملف المُرسل.',
    PRICING_LEAD_CLOSED: () => 'لا يُنشأ ملف تسعير على فرصة مغلقة.',
    PRICING_LOCKED: () => 'ملف التسعير مُرسل أو معتمد أو ملغى: لا يُعدَّل. المُرسل يُعاد إلى مسودة، والمعتمد يُلغى بسبب مكتوب.',
    PRICING_BLOCKED: () => 'في الملف موانع (بند بلا سعر أو بلا مورد أو بتكلفة مجهولة، عرض مورد منتهٍ، أو هامش دون الحد بلا مبرر). عالجها ثم أعد المحاولة.',
    PRICING_NOT_DRAFT: () => 'البنود وعروض الموردين تتغير فقط والملف مسودة؛ أعده إلى مسودة أولًا.',
    PRICING_SELECTION: () => 'اختر عرضًا مسعَّرًا لهذا البند من عرض مورد مستلم.',
    PRICING_QUOTE_LINE: () => 'عرض المورد يجيب على بنود الملف نفسه فقط.',
    PRICING_QUOTE_SELECTED: () => 'هذا العرض مختار لبنود في الملف؛ ألغِ الاختيار أولًا.',
    PRICING_DELETE_NOT_DRAFT: () => 'لا يُحذف إلا المسودة. الملف المُرسل أو المعتمد يُلغى بسبب مكتوب.',
    PRICING_SUPPLIER: () => 'اختر جهة نشطة مصنّفة مورّدًا في جهات الاتصال.',
    PRICING_CURRENCY: () => 'هذه العملة غير متاحة.',
    PRICING_NOT_ALLOWED: () => 'ليست لديك صلاحية لهذا في التسعير.',
    PRICING_NOT_FOUND: () => 'هذا الملف لم يعد موجودًا، أو لا يمكنك رؤيته.',
    PRICING_REASON: () => 'اكتب السبب أولًا.',
    PRICING_NO_ROWS: () => 'لا يوجد ما يُحفظ.',
    PRICING_NO_LINES: () => 'أدخل بنود جدول الكميات أولًا، ثم اطلب عروض الموردين عليها.',
    PRICING_LINE_MISSING: () => 'أحد هذه البنود لم يعد في الملف. أعد التحميل وحاول مجددًا.',
    PRICING_ITEM: () => 'اختر صنفًا نشطًا من الكتالوج.',
    receivedDate: () => 'العرض المستلم يحتاج تاريخ استلامه.',
    validity: () => 'لا يمكن أن يكون العرض صالحًا حتى تاريخ قبل يوم استلامه.',
    notAllowed: () => 'ليست لديك صلاحية لهذا في التسعير.',
    failed: () => 'لم ينجح ذلك. حاول مجددًا.',
  },
}

/** A refusal from the database (or a code) in the reader's language. */
export function errorText(err, lang = getLang()) {
  const W = ERROR_WORDS[lang] || ERROR_WORDS.en
  const msg = String(err?.message || err || '')
  if (W[msg]) return W[msg]()
  if (msg.includes('supplier_quotes_received')) return W.receivedDate()
  if (msg.includes('supplier_quotes_validity')) return W.validity()
  if (err?.code === '42501' || msg.includes('row-level security') || msg.includes('violates row-level') || msg.includes('permission denied')) return W.notAllowed()
  return msg && !/^[A-Z_]+$/.test(msg) ? msg : W.failed()
}

const fail = error => ({ error: errorText(error) })
const done = ({ data, error }) => (error ? fail(error) : { data })

// ── Reads ──

/** Every sheet of the company with its totals (a total is null while any line is unknown). */
export async function fetchSheets(ws) {
  const [s, t] = await Promise.all([
    readAll(() => supabase.from('pricing_sheets').select(SHEET_COLS).eq('workspace_id', ws).order('sheet_no', { ascending: false })),
    readAll(() => supabase.from('pricing_sheet_totals').select('sheet_id,line_count,unpriced_count,uncosted_count,sell_total,cost_total').eq('workspace_id', ws)),
  ])
  const totals = Object.fromEntries(t.rows.map(r => [r.sheet_id, r]))
  return { rows: s.rows.map(r => ({ ...r, totals: totals[r.id] || null })), error: s.error || t.error }
}

export async function fetchSheet(ws, id) {
  const { data, error } = await supabase.from('pricing_sheets').select(SHEET_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? { sheet: null, error: errorText(error) } : { sheet: data }
}

/** A company's sheets for one opportunity (the CRM page's panel). */
export async function fetchSheetsOfLead(ws, leadId) {
  const { data, error } = await supabase.from('pricing_sheets').select('id,sheet_no,title,status').eq('workspace_id', ws).eq('lead_id', leadId).order('sheet_no', { ascending: false })
  return error ? { rows: [], error: errorText(error) } : { rows: data || [] }
}

export const fetchLines = (ws, sheetId) =>
  readAll(() => supabase.from('pricing_lines').select(LINE_COLS).eq('workspace_id', ws).eq('sheet_id', sheetId).order('line_no'))

export const fetchLineCosts = (ws, sheetId) =>
  readAll(() => supabase.from('pricing_line_cost').select('pricing_line_id,line_no,unit_cost,cost_total,sell_total,margin_pct,quote_valid_until').eq('workspace_id', ws).eq('sheet_id', sheetId))

export async function fetchTotals(ws, sheetId) {
  const { data, error } = await supabase.from('pricing_sheet_totals').select('line_count,unpriced_count,uncosted_count,sell_total,cost_total').eq('workspace_id', ws).eq('sheet_id', sheetId).maybeSingle()
  return error ? { totals: null, error: errorText(error) } : { totals: data }
}

/** The database's checks for a sheet: [{ code, line_no, blocking }]. */
export async function fetchIssues(sheetId) {
  const { data, error } = await supabase.rpc('pricing_sheet_issues', { p_sheet: sheetId })
  return error ? { rows: [], error: errorText(error) } : { rows: data || [] }
}

export const fetchQuotes = (ws, sheetId) =>
  readAll(() => supabase.from('supplier_quotes').select(QUOTE_COLS).eq('workspace_id', ws).eq('sheet_id', sheetId).order('quote_no'))

export async function fetchQuote(ws, id) {
  const { data, error } = await supabase.from('supplier_quotes').select(QUOTE_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? { quote: null, error: errorText(error) } : { quote: data }
}

/** A quote's offers (main and alternatives) with their landed costs. */
export async function fetchQuoteOffers(ws, quoteId) {
  const [l, c] = await Promise.all([
    readAll(() => supabase.from('supplier_quote_lines').select(QLINE_COLS).eq('workspace_id', ws).eq('quote_id', quoteId).order('created_at').order('id')),
    readAll(() => supabase.from('pricing_supplier_quote_line_cost').select('quote_line_id,landed_unit_cost').eq('workspace_id', ws).eq('quote_id', quoteId)),
  ])
  const cost = Object.fromEntries(c.rows.map(r => [r.quote_line_id, r.landed_unit_cost]))
  return { rows: l.rows.map(r => ({ ...r, landed_unit_cost: cost[r.id] ?? null })), error: l.error || c.error }
}

/** Every offer of the received quotes of a sheet, with cost, for the comparison. */
export async function fetchSheetOffers(ws, quoteIds) {
  if (!quoteIds.length) return { rows: [] }
  const [l, c] = await Promise.all([
    readAll(() => supabase.from('supplier_quote_lines').select(QLINE_COLS).eq('workspace_id', ws).in('quote_id', quoteIds).order('id')),
    readAll(() => supabase.from('pricing_supplier_quote_line_cost').select('quote_line_id,landed_unit_cost').eq('workspace_id', ws).in('quote_id', quoteIds)),
  ])
  const cost = Object.fromEntries(c.rows.map(r => [r.quote_line_id, r.landed_unit_cost]))
  return { rows: l.rows.map(r => ({ ...r, landed_unit_cost: cost[r.id] ?? null })), error: l.error || c.error }
}

export async function fetchSettings(ws) {
  const { data, error } = await supabase.from('pricing_settings').select('min_margin_pct').eq('workspace_id', ws).maybeSingle()
  return error ? { minMargin: null, error: errorText(error) } : { minMargin: data?.min_margin_pct == null ? null : Number(data.min_margin_pct) }
}

/** A sheet's history (and its lines', quotes' and offers'), newest first. */
export async function fetchAudit(ws, sheetId) {
  const { data, error } = await supabase.from('pricing_audit')
    .select('id,table_name,row_id,sheet_id,action,changed_by,changed_at,old_data,new_data')
    .eq('workspace_id', ws).eq('sheet_id', sheetId).order('id', { ascending: false }).limit(150)
  return error ? { rows: [], error: errorText(error) } : { rows: data || [] }
}

export async function fetchCurrencies() {
  const { data, error } = await supabase.from('currencies').select('code,name_en,name_ar,active').order('code')
  return error ? { rows: [], error: errorText(error) } : { rows: data || [] }
}

const lookup = (fn, ws) => supabase.rpc(fn, { ws }).then(({ data, error }) => (error ? { rows: [], error: errorText(error) } : { rows: data || [] }))
export const fetchLeads = ws => lookup('pricing_leads', ws)
export const fetchSuppliers = ws => lookup('pricing_suppliers', ws)
export const fetchCatalogItems = ws => lookup('pricing_catalog_items', ws)
export const fetchPeople = ws => lookup('pricing_people', ws)

// ── Writes ──

/** A new sheet on an open opportunity. Returns { sheet } (with its number). */
export async function createSheet(ws, { lead_id, title, notes }) {
  const { data, error } = await supabase.from('pricing_sheets')
    .insert({ workspace_id: ws, lead_id, title: String(title).trim(), notes: String(notes || '').trim() || null }).select(SHEET_COLS).single()
  return error ? fail(error) : { sheet: data }
}

/** A draft's title, notes and margin note. */
export async function updateSheet(ws, id, { title, notes, margin_note }) {
  const { data, error } = await supabase.from('pricing_sheets')
    .update({ title: String(title).trim(), notes: String(notes || '').trim() || null, margin_note: String(margin_note || '').trim() || null })
    .eq('workspace_id', ws).eq('id', id).select(SHEET_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { sheet: data } : { error: errorText('PRICING_NOT_ALLOWED') }
}

export async function deleteSheet(ws, id) {
  const { data, error } = await supabase.from('pricing_sheets').delete().eq('workspace_id', ws).eq('id', id).select('id')
  if (error) return fail(error)
  return data?.length ? {} : { error: errorText('PRICING_NOT_ALLOWED') }
}

const FLOW = { submit: 'pricing_sheet_submit', return: 'pricing_sheet_return', approve: 'pricing_sheet_approve', cancel: 'pricing_sheet_cancel' }
/** submit | return | approve | cancel (with a reason): the only way a sheet's status changes. */
export async function transition(sheetId, action, reason = '') {
  const args = action === 'cancel' ? { p_sheet: sheetId, p_reason: reason } : { p_sheet: sheetId }
  const { error } = await supabase.rpc(FLOW[action], args)
  return error ? fail(error) : {}
}

export async function saveLines(sheetId, lines) {
  return done(await supabase.rpc('pricing_save_lines', { p_sheet: sheetId, p_lines: lines }))
}
export async function importLines(sheetId, lines) {
  return done(await supabase.rpc('pricing_import_lines', { p_sheet: sheetId, p_lines: lines }))
}
/** { lineId: price | null } */
export async function savePrices(sheetId, prices) {
  const { error } = await supabase.rpc('pricing_save_prices', { p_sheet: sheetId, p_prices: prices })
  return error ? fail(error) : {}
}
/** { lineId: offerId | null } */
export async function selectOffers(sheetId, sel) {
  const { error } = await supabase.rpc('pricing_select_offers', { p_sheet: sheetId, p_sel: sel })
  return error ? fail(error) : {}
}
export async function applyCatalog(lineId, itemId) {
  const { error } = await supabase.rpc('pricing_apply_catalog', { p_line: lineId, p_item: itemId })
  return error ? fail(error) : {}
}

/** A request to one supplier for every line of the sheet. Returns { id } of the new quote. */
export async function requestQuote(sheetId, { supplier_id, currency, requested_on, notes }) {
  const { data, error } = await supabase.rpc('pricing_request_quote', { p_sheet: sheetId, p_supplier: supplier_id, p_currency: currency, p_requested_on: requested_on || null, p_notes: notes || null })
  return error ? fail(error) : { id: data }
}
export async function saveQuote(quoteId, header, offers, alts) {
  const { error } = await supabase.rpc('pricing_save_quote', { p_quote: quoteId, p_header: header, p_offers: offers, p_alts: alts })
  return error ? fail(error) : {}
}
export async function deleteQuote(ws, id) {
  const { data, error } = await supabase.from('supplier_quotes').delete().eq('workspace_id', ws).eq('id', id).select('id')
  if (error) return fail(error)
  return data?.length ? {} : { error: errorText('PRICING_NOT_ALLOWED') }
}
/** An alternative offer (a main offer is never deleted alone). */
export async function deleteAlternative(ws, id) {
  const { data, error } = await supabase.from('supplier_quote_lines').delete().eq('workspace_id', ws).eq('id', id).eq('is_alternative', true).select('id')
  if (error) return fail(error)
  return data?.length ? {} : { error: errorText('PRICING_NOT_ALLOWED') }
}

/** The company's minimum margin, % (null switches the check off). */
export async function saveMinMargin(ws, value) {
  const { error } = await supabase.from('pricing_settings').upsert({ workspace_id: ws, min_margin_pct: value }, { onConflict: 'workspace_id' })
  return error ? fail(error) : {}
}
