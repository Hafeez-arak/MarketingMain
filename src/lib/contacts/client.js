import { supabase } from '../supabaseClient'
import { getLang } from '../i18n'
import { orgRow, personRow } from './logic'

// ─── Contacts: the browser's reads and writes ──────────────────────────────
// 2026-10-28, dev/erp-pilot/CONTACTS.md. Straight to the database with the
// person's own login: RLS (the contacts section grant) and the triggers in
// 20261120_contacts_2_rules.sql decide what goes through. Every query names
// its company: RLS is membership, not isolation.

const ORG_COLS = 'id,workspace_id,kind,name,name_ar,roles,status,vat_number,cr_number,country,nat_building_no,nat_street,nat_district,city,nat_postal_code,nat_additional_no,phone,email,website,notes,archived_at,archived_by,created_by,created_at,updated_at'
const PERSON_COLS = 'id,workspace_id,org_id,name,name_ar,job_title,phone,email,is_primary,notes,created_at,updated_at'

// The API returns at most 1,000 rows a request; a company's book is read whole.
const PAGE = 1000

async function readAll(build) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) return { rows, error }
    rows.push(...(data || []))
    if (!data || data.length < PAGE) return { rows, error: null }
  }
}

// What the database's refusals mean, in both languages. Each code is raised
// by 20261120_contacts_2_rules.sql (the detail names the other record or
// the missing fields); the rest are Postgres's own.
export const ERROR_WORDS = {
  en: {
    CONTACTS_DUPLICATE_VAT: d => `Another organisation already has this VAT number${d ? `: ${d}` : ''}.`,
    CONTACTS_DUPLICATE_CR: d => `Another organisation already has this CR number${d ? `: ${d}` : ''}.`,
    CONTACTS_ADDRESS_REQUIRED: d => `A client company registered for VAT needs its full national address. Missing: ${d}.`,
    CONTACTS_ARCHIVED: d => `${d || 'This organisation'} is archived. Restore it first.`,
    CONTACTS_NEEDS_MANAGE: () => 'Archiving, restoring and importing need Manage access to Contacts.',
    CONTACTS_WORKSPACE_FIXED: () => 'A contact cannot move to another company.',
    CONTACTS_IMPORT_TOO_BIG: () => 'At most 2,000 rows can be imported at once.',
    inUse: () => 'It is still in use (it has contact persons), so it cannot be deleted. Archive it instead.',
    notAllowed: () => 'You do not have access to do that in Contacts.',
    notFound: () => 'That record is not there any more, or you cannot see it.',
    failed: () => 'It did not work. Try again.',
    fields: { nat_building_no: 'building number', nat_street: 'street', nat_district: 'district', city: 'city', nat_postal_code: 'postal code' },
  },
  ar: {
    CONTACTS_DUPLICATE_VAT: d => `يوجد سجل آخر بنفس الرقم الضريبي${d ? `: ${d}` : ''}.`,
    CONTACTS_DUPLICATE_CR: d => `يوجد سجل آخر بنفس رقم السجل التجاري${d ? `: ${d}` : ''}.`,
    CONTACTS_ADDRESS_REQUIRED: d => `العميل المسجّل في ضريبة القيمة المضافة يحتاج عنوانه الوطني كاملًا. الناقص: ${d}.`,
    CONTACTS_ARCHIVED: d => `${d || 'هذه الجهة'} مؤرشفة. استعدها أولًا.`,
    CONTACTS_NEEDS_MANAGE: () => 'الأرشفة والاستعادة والاستيراد تحتاج صلاحية الإدارة في جهات الاتصال.',
    CONTACTS_WORKSPACE_FIXED: () => 'لا يمكن نقل جهة اتصال إلى شركة أخرى.',
    CONTACTS_IMPORT_TOO_BIG: () => 'يمكن استيراد 2,000 صف كحد أقصى في المرة الواحدة.',
    inUse: () => 'ما زالت مستخدمة (لها أشخاص اتصال)، فلا يمكن حذفها. أرشفها بدلًا من ذلك.',
    notAllowed: () => 'ليست لديك صلاحية لهذا في جهات الاتصال.',
    notFound: () => 'هذا السجل لم يعد موجودًا، أو لا يمكنك رؤيته.',
    failed: () => 'لم ينجح ذلك. حاول مجددًا.',
    fields: { nat_building_no: 'رقم المبنى', nat_street: 'الشارع', nat_district: 'الحي', city: 'المدينة', nat_postal_code: 'الرمز البريدي' },
  },
}

/** A refusal from the database (or a code) in the reader's language. */
export function errorText(err, lang = getLang()) {
  const W = ERROR_WORDS[lang] || ERROR_WORDS.en
  const msg = String(err?.message || err || '')
  const detail = err?.details || err?.detail || ''
  if (msg === 'CONTACTS_ADDRESS_REQUIRED') return W[msg](detail.split(',').map(f => W.fields[f] || f).join(lang === 'ar' ? '، ' : ', '))
  if (W[msg]) return W[msg](detail)
  // Postgres's own: a race past the duplicate guard, a delete blocked by people, RLS.
  if (msg.includes('contacts_orgs_vat_uq')) return W.CONTACTS_DUPLICATE_VAT('')
  if (msg.includes('contacts_orgs_cr_uq')) return W.CONTACTS_DUPLICATE_CR('')
  if (err?.code === '23503' || msg.includes('contacts_people_org_fk')) return W.inUse()
  if (err?.code === '42501' || msg.includes('row-level security')) return W.notAllowed()
  return msg && !/^[A-Z_]+$/.test(msg) ? msg : W.failed()
}

const fail = error => ({ error: errorText(error) })

/** Every organisation of the company, archived ones too (the screen filters). */
export async function fetchOrgs(ws) {
  if (!ws) return { rows: [] }
  const { rows, error } = await readAll(() => supabase.from('contacts_orgs').select(ORG_COLS).eq('workspace_id', ws).order('name').order('id'))
  return error ? { rows, ...fail(error) } : { rows }
}

export async function fetchOrg(ws, id) {
  const { data, error } = await supabase.from('contacts_orgs').select(ORG_COLS).eq('workspace_id', ws).eq('id', id).maybeSingle()
  return error ? fail(error) : { org: data }
}

export async function createOrg(ws, fields) {
  const { data, error } = await supabase.from('contacts_orgs').insert({ ...orgRow(fields), workspace_id: ws }).select(ORG_COLS).single()
  return error ? fail(error) : { org: data }
}

export async function updateOrg(ws, id, fields) {
  const { data, error } = await supabase.from('contacts_orgs').update(orgRow(fields)).eq('workspace_id', ws).eq('id', id).select(ORG_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { org: data } : { error: errorText('notAllowed') }
}

/** Archive ('archived') or restore ('active'). Managing only; the database stamps who and when. */
export async function setOrgStatus(ws, id, status) {
  const { data, error } = await supabase.from('contacts_orgs').update({ status }).eq('workspace_id', ws).eq('id', id).select(ORG_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { org: data } : { error: errorText('notAllowed') }
}

/** Delete an organisation nobody uses (no people). Managing only. */
export async function deleteOrg(ws, id) {
  const { data, error } = await supabase.from('contacts_orgs').delete().eq('workspace_id', ws).eq('id', id).select('id')
  if (error) return fail(error)
  return data?.length ? {} : { error: errorText('notAllowed') }
}

/** People: one organisation's (`orgId`), or everyone in the company. */
export async function fetchPeople(ws, { orgId = '' } = {}) {
  if (!ws) return { rows: [] }
  const { rows, error } = await readAll(() => {
    let q = supabase.from('contacts_people').select(PERSON_COLS).eq('workspace_id', ws)
    if (orgId) q = q.eq('org_id', orgId)
    return q.order('is_primary', { ascending: false }).order('name').order('id')
  })
  return error ? { rows, ...fail(error) } : { rows }
}

export async function createPerson(ws, fields) {
  const { data, error } = await supabase.from('contacts_people').insert({ ...personRow(fields), workspace_id: ws }).select(PERSON_COLS).single()
  return error ? fail(error) : { person: data }
}

export async function updatePerson(ws, id, fields) {
  const { data, error } = await supabase.from('contacts_people').update(personRow(fields)).eq('workspace_id', ws).eq('id', id).select(PERSON_COLS).maybeSingle()
  if (error) return fail(error)
  return data ? { person: data } : { error: errorText('notAllowed') }
}

/** Managing only. */
export async function deletePerson(ws, id) {
  const { data, error } = await supabase.from('contacts_people').delete().eq('workspace_id', ws).eq('id', id).select('id')
  if (error) return fail(error)
  return data?.length ? {} : { error: errorText('notAllowed') }
}

/**
 * Import organisations (already parsed and checked on screen). Managing
 * only. Each row goes in or is refused on its own: [{ line_no, org_id, error }].
 */
export async function importOrgs(ws, rows) {
  const { data, error } = await supabase.rpc('contacts_import_orgs', { ws, items: rows.map(orgRow) })
  if (error) return fail(error)
  return {
    results: (data || []).map(r => ({
      line_no: r.line_no, org_id: r.org_id,
      error: r.error_code ? errorText({ message: r.error_code, details: r.error_detail || '' }) : null,
    })),
  }
}
