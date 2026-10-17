import { db } from './_supabase.js'
import {
  ADMIN_EDIT_TABLES, AGENDA_KINDS, AGENDA_STATUSES, SOURCE_TYPES, RULE_STATUS_FOR,
  IDEA_STATUSES_ALLOWED, mergeConfig,
} from '../../src/lib/agent/adminTools.js'
import { MEMORY_SCOPES, deDash } from '../../src/lib/agent/writeTools.js'
import { COLUMN_TO_PROFILE_KEY, slugKey, nextSortOrder } from '../../src/lib/brandSchemaCore.js'
import { normaliseIcp } from '../../src/lib/sales/icp.js'

// ─── Executing a direct edit ───────────────────────────────────────────────
// The admin belt from src/lib/agent/adminTools.js. Read that header first: the
// role gate and the ownership checks happen in runTool BEFORE anything here
// runs, so every function below may assume (a) the caller is a verified admin
// of (b) this workspace, and (c) every id in `args` belongs to it.
//
// Every executor still filters every query by workspace_id itself. Not belt
// and braces — RLS is not isolation in this app (the operators belong to every
// workspace), and the service key bypasses RLS anyway. The filter IS the
// isolation, on writes exactly as on reads.
//
// ── ONE PATH FOR EVERY CHANGE ──
//
// No executor writes a row directly. They all describe the change and hand it
// to applyChange(), which reads the row before, writes it, and records the
// before/after in agent_edit_log. That is what makes "every direct edit is
// audited" a property of the code rather than of each executor's author
// remembering — and what makes undo one generic function rather than nine.

const clip = (v, n) => String(v ?? '').slice(0, n)
const ws = workspaceId => `workspace_id=eq.${encodeURIComponent(workspaceId)}`
const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/** The columns every table manages itself and an edit or undo never writes. */
const MANAGED = new Set(['id', 'workspace_id', 'created_at'])

/**
 * The before/after of an update, reduced to the columns the patch touched.
 *
 * Kept narrow on purpose. A full-row `before` replayed by an undo would also
 * roll back columns somebody changed by hand in the meantime; the touched
 * columns are the change, and only the change should be reversible.
 */
function pick(row, keys) {
  const out = {}
  for (const k of keys) out[k] = row?.[k] === undefined ? null : row[k]
  return out
}

/** The filter that addresses one row: by id, or by workspace for 1-per-workspace tables. */
function rowFilter(table, workspaceId, rowId) {
  // sales_icp is keyed by workspace_id; brand_profile is unique on it. Both
  // are addressed by the workspace so a stale or invented id cannot point one
  // workspace's undo at another's row.
  if (table === 'sales_icp' || table === 'brand_profile') return ws(workspaceId)
  return `id=eq.${encodeURIComponent(rowId)}&${ws(workspaceId)}`
}

async function readRow(table, workspaceId, rowId) {
  const rows = await db(`${table}?${rowFilter(table, workspaceId, rowId)}&select=*&limit=1`)
  return Array.isArray(rows) ? rows[0] || null : null
}

/**
 * Write one change and audit it. The only function in this file that writes a
 * target table.
 *
 * @param {object} c
 * @param {string} c.workspaceId  verified session
 * @param {object} c.session      { userId, chatId } — verified session
 * @param {string} c.tool         which tool asked, for the log
 * @param {string} c.table        must be in ADMIN_EDIT_TABLES
 * @param {'create'|'update'|'delete'} c.action
 * @param {string} [c.rowId]      for update/delete
 * @param {object} [c.values]     the row (create) or the patch (update)
 * @param {object} [c.before]     the row as already read, to save a round trip
 * @returns {Promise<{ok:true, edit_id:string, row:object|null}|{error:string}>}
 */
export async function applyChange({ workspaceId, session = {}, tool, table, action, rowId, values = {}, before }) {
  if (!ADMIN_EDIT_TABLES.includes(table)) return { error: `${table} cannot be edited from the chat.` }

  let after = null
  let logBefore = null
  let logAfter = null
  let id = rowId || ''

  if (action === 'create') {
    const body = { ...values, workspace_id: workspaceId }
    const rows = await db(table, { method: 'POST', prefer: 'return=representation', body })
    after = rows?.[0] || null
    id = after?.id || after?.workspace_id || ''
    logAfter = after
  } else if (action === 'update') {
    const prior = before === undefined ? await readRow(table, workspaceId, rowId) : before
    if (!prior) return { error: 'That row no longer exists in this workspace.' }
    const patch = { ...values }
    for (const k of MANAGED) delete patch[k]
    const rows = await db(`${table}?${rowFilter(table, workspaceId, rowId)}`, {
      method: 'PATCH', prefer: 'return=representation', body: patch,
    })
    after = rows?.[0] || null
    if (!after) return { error: 'The row could not be updated (it may have just been deleted).' }
    id = prior.id || prior.workspace_id || rowId
    logBefore = pick(prior, Object.keys(patch))
    logAfter = pick(after, Object.keys(patch))
  } else if (action === 'delete') {
    const prior = before === undefined ? await readRow(table, workspaceId, rowId) : before
    if (!prior) return { error: 'That row no longer exists in this workspace.' }
    await db(`${table}?${rowFilter(table, workspaceId, rowId)}`, { method: 'DELETE', prefer: 'return=minimal' })
    logBefore = prior
  } else {
    return { error: `Unknown action ${action}.` }
  }

  // ── The audit row, or no edit at all ──
  // Written after the change because `after` is only known then. If it cannot
  // be written — the table missing because the migration has not been applied,
  // a transient failure — the change is put back. An edit with no log row is
  // one nobody can see or undo, and that is worse than the edit not happening.
  try {
    const [log] = await db('agent_edit_log', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        workspace_id: workspaceId,
        user_id: session.userId || null,
        chat_id: session.chatId || null,
        tool: tool || '',
        table_name: table,
        row_id: String(id || ''),
        action,
        before: logBefore,
        after: logAfter,
      },
    })
    return { ok: true, edit_id: log?.id || '', row: after }
  } catch (err) {
    const revert = await revertChange({ workspaceId, table, action, rowId: id, before: logBefore, after: logAfter })
    console.error(`[agent/admin] audit write failed for ${table} ${action}: ${err?.message || err}; reverted: ${revert.ok}`)
    return {
      error: 'The change could not be recorded in the edit log, so it was ' +
        (revert.ok ? 'reverted and nothing changed.' : `NOT reverted (${revert.error}) — tell the person to check this row by hand.`),
    }
  }
}

/**
 * Put one change back. Shared by undo_edit and by applyChange's own rollback.
 */
async function revertChange({ workspaceId, table, action, rowId, before, after }) {
  if (!ADMIN_EDIT_TABLES.includes(table)) return { ok: false, error: `${table} is not an editable table.` }
  try {
    if (action === 'create') {
      await db(`${table}?${rowFilter(table, workspaceId, rowId)}`, { method: 'DELETE', prefer: 'return=minimal' })
    } else if (action === 'update') {
      const patch = { ...(before || {}) }
      for (const k of MANAGED) delete patch[k]
      await db(`${table}?${rowFilter(table, workspaceId, rowId)}`, { method: 'PATCH', prefer: 'return=minimal', body: patch })
    } else if (action === 'delete') {
      // Back with its own id, so anything that pointed at it points at it again.
      await db(table, { method: 'POST', prefer: 'return=minimal', body: { ...(before || {}), workspace_id: workspaceId } })
    } else {
      return { ok: false, error: `Cannot revert a "${action}".` }
    }
    return { ok: true, after }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) }
  }
}

/** "Confirm first" — the speed bump for overwrites and removals. */
function needsConfirm(args, what) {
  if (args?.confirmed === true) return ''
  return `This ${what}. Tell the person exactly what will change, wait for a yes, then call again with confirmed: true.`
}

const isBlank = v => v === undefined || v === null || String(v).trim() === ''

// ─── Reads for the admin belt ──────────────────────────────────────────────

async function getBrandBrain(workspaceId, args) {
  const only = args?.section_key ? `&section_key=eq.${encodeURIComponent(args.section_key)}` : ''
  const onlySection = args?.section_key ? `&key=eq.${encodeURIComponent(args.section_key)}` : ''
  const [sections, fields, columns, rows, profiles] = await Promise.all([
    db(`brand_sections?${ws(workspaceId)}${onlySection}&select=id,key,title,kind,description,enabled,sort_order&order=sort_order.asc`),
    db(`brand_fields?${ws(workspaceId)}${only}&select=id,key,label,section_key,storage_column,include_in_prompt,enabled,hint&order=sort_order.asc`),
    db(`brand_directory_columns?${ws(workspaceId)}${only}&select=section_key,key,label,in_prompt&order=sort_order.asc`),
    db(`brand_directory_rows?${ws(workspaceId)}${only}&select=id,section_key,data,sort_order&order=sort_order.asc,created_at.asc&limit=500`),
    db(`brand_profile?${ws(workspaceId)}&select=*&limit=1`),
  ])
  const profile = profiles?.[0] || {}
  return {
    sections: sections || [],
    fields: (fields || []).map(f => ({
      ...f,
      value: f.storage_column ? (profile[f.storage_column] ?? '') : (profile.custom_fields?.[f.key] ?? ''),
    })),
    directory_columns: columns || [],
    directory_rows: rows || [],
    note: profiles?.[0] ? '' : 'No Brand Brain profile row exists for this workspace yet.',
  }
}

async function getAgenda(workspaceId, args) {
  const kind = AGENDA_KINDS.includes(args?.kind) ? `&kind=eq.${args.kind}` : ''
  const rows = await db(
    `research_agenda?${ws(workspaceId)}${kind}&order=kind.asc,tier.asc.nullslast,subject.asc` +
    '&select=id,kind,subject,why,status,cadence,tier,source_type,ig_handle,ig_status,created_by&limit=500',
  )
  return { items: rows || [], count: (rows || []).length }
}

async function getIcp(workspaceId) {
  const rows = await db(`sales_icp?${ws(workspaceId)}&select=config,updated_at&limit=1`)
  return {
    config: rows?.[0]?.config || {},
    updated_at: rows?.[0]?.updated_at || null,
    note: rows?.[0] ? '' : 'No ideal customer profile has been written for this workspace yet.',
  }
}

async function getEditLog(workspaceId, args) {
  const n = Math.min(Math.max(Math.floor(Number(args?.limit) || 10), 1), 50)
  const rows = await db(
    `agent_edit_log?${ws(workspaceId)}&order=created_at.desc&limit=${n}` +
    '&select=id,tool,table_name,row_id,action,before,after,user_id,undoes,undone_at,created_at',
  )
  return {
    edits: (rows || []).map(r => ({ edit_id: r.id, ...r, id: undefined })),
    note: (rows || []).length ? 'undo_edit takes an edit_id from this list.' : 'No direct edits have been made from the chat in this workspace.',
  }
}

// ─── Brand Brain ───────────────────────────────────────────────────────────

async function setBrandField(workspaceId, args, session) {
  const key = clip(args.field_key, 100).trim()
  const value = clip(args.value, 20_000)
  if (!key) return { error: 'field_key is required. Call get_brand_brain for the keys.' }

  const fields = await db(
    `brand_fields?${ws(workspaceId)}&key=eq.${encodeURIComponent(key)}&select=id,key,label,storage_column&limit=1`,
  )
  const field = fields?.[0]
  if (!field) return { error: `There is no Brand Brain field with key "${key}" in this workspace. Call get_brand_brain.` }

  // A storage column outside the known map is refused rather than written:
  // the map is the list of brand_profile text columns, and a typo'd
  // storage_column must not become a write to an arbitrary column.
  const column = field.storage_column || ''
  if (column && !COLUMN_TO_PROFILE_KEY[column]) {
    return { error: `Field "${key}" stores into an unknown column (${column}); edit it in the Brand Brain page.` }
  }

  const profile = await readRow('brand_profile', workspaceId)
  const current = column ? (profile?.[column] ?? '') : (profile?.custom_fields?.[key] ?? '')
  const next = args.mode === 'append' && !isBlank(current) ? `${String(current).replace(/\s+$/, '')}\n${value}` : value

  if (args.mode !== 'append' && !isBlank(current) && current !== next) {
    const stop = needsConfirm(args, `overwrites the existing "${field.label}" text`)
    if (stop) return { error: `${stop} Current text: ${JSON.stringify(clip(current, 2000))}` }
  }

  const values = column
    ? { [column]: next, updated_at: new Date().toISOString() }
    : { custom_fields: { ...(profile?.custom_fields || {}), [key]: next }, updated_at: new Date().toISOString() }

  const out = profile
    ? await applyChange({ workspaceId, session, tool: 'set_brand_field', table: 'brand_profile', action: 'update', rowId: profile.id, values, before: profile })
    : await applyChange({ workspaceId, session, tool: 'set_brand_field', table: 'brand_profile', action: 'create', values })
  if (out.error) return out
  return { ok: true, edit_id: out.edit_id, field: field.label, was: current, now: next }
}

async function editBrandStructure(workspaceId, args, session) {
  const { target, action } = args
  if (target === 'section') {
    if (action === 'delete') {
      return { error: 'Sections are never deleted from the chat. Hide it with action "update" and enabled: false.' }
    }
    if (action === 'create') {
      const title = clip(args.title, 120).trim()
      if (!title) return { error: 'A new section needs a title.' }
      const existing = await db(`brand_sections?${ws(workspaceId)}&select=key,sort_order`)
      const values = {
        key: slugKey(title, (existing || []).map(s => s.key)),
        title,
        description: clip(args.description, 1000),
        kind: args.kind === 'directory' ? 'directory' : 'fields',
        sort_order: nextSortOrder(existing || []),
        enabled: args.enabled !== false,
      }
      const out = await applyChange({ workspaceId, session, tool: 'edit_brand_structure', table: 'brand_sections', action: 'create', values })
      return out.error ? out : { ok: true, edit_id: out.edit_id, section: out.row }
    }
    if (!args.section_id) return { error: 'section_id is required to update a section. Call get_brand_brain.' }
    const values = {}
    if (args.title !== undefined) values.title = clip(args.title, 120)
    if (args.description !== undefined) values.description = clip(args.description, 1000)
    if (args.enabled !== undefined) values.enabled = Boolean(args.enabled)
    if (!Object.keys(values).length) return { error: 'Nothing to change.' }
    if (values.enabled === false || values.title !== undefined) {
      const stop = needsConfirm(args, values.enabled === false ? 'hides a whole Brand Brain section' : 'renames a Brand Brain section')
      if (stop) return { error: stop }
    }
    const out = await applyChange({ workspaceId, session, tool: 'edit_brand_structure', table: 'brand_sections', action: 'update', rowId: args.section_id, values })
    return out.error ? out : { ok: true, edit_id: out.edit_id, section: out.row }
  }

  if (target === 'field') {
    if (action === 'create') {
      const label = clip(args.label, 120).trim()
      const sectionKey = clip(args.section_key, 100).trim()
      if (!label || !sectionKey) return { error: 'A new field needs a label and a section_key.' }
      const sections = await db(`brand_sections?${ws(workspaceId)}&key=eq.${encodeURIComponent(sectionKey)}&select=key,kind&limit=1`)
      if (!sections?.[0]) return { error: `There is no section "${sectionKey}" in this workspace.` }
      if (sections[0].kind !== 'fields') return { error: `"${sectionKey}" is a ${sections[0].kind} section; fields go in a fields section.` }
      const existing = await db(`brand_fields?${ws(workspaceId)}&select=key,sort_order,section_key`)
      const values = {
        section_key: sectionKey,
        key: slugKey(label, (existing || []).map(f => f.key)),
        label,
        hint: clip(args.hint, 500),
        input_type: args.input_type === 'text' ? 'text' : 'textarea',
        include_in_prompt: args.include_in_prompt !== false,
        enabled: args.enabled !== false,
        // Custom field: the value lives in brand_profile.custom_fields under
        // the key. A new field never claims one of the legacy columns.
        storage_column: '',
        sort_order: nextSortOrder((existing || []).filter(f => f.section_key === sectionKey)),
      }
      const out = await applyChange({ workspaceId, session, tool: 'edit_brand_structure', table: 'brand_fields', action: 'create', values })
      return out.error ? out : { ok: true, edit_id: out.edit_id, field: out.row }
    }
    if (!args.field_id) return { error: 'field_id is required. Call get_brand_brain.' }
    if (action === 'delete') {
      const stop = needsConfirm(args, 'deletes a Brand Brain field definition (its stored value is kept)')
      if (stop) return { error: stop }
      const out = await applyChange({ workspaceId, session, tool: 'edit_brand_structure', table: 'brand_fields', action: 'delete', rowId: args.field_id })
      return out.error ? out : { ok: true, edit_id: out.edit_id, deleted: true }
    }
    const values = {}
    if (args.label !== undefined) values.label = clip(args.label, 120)
    if (args.hint !== undefined) values.hint = clip(args.hint, 500)
    if (args.input_type !== undefined) values.input_type = args.input_type === 'text' ? 'text' : 'textarea'
    if (args.include_in_prompt !== undefined) values.include_in_prompt = Boolean(args.include_in_prompt)
    if (args.enabled !== undefined) values.enabled = Boolean(args.enabled)
    if (!Object.keys(values).length) return { error: 'Nothing to change.' }
    const out = await applyChange({ workspaceId, session, tool: 'edit_brand_structure', table: 'brand_fields', action: 'update', rowId: args.field_id, values })
    return out.error ? out : { ok: true, edit_id: out.edit_id, field: out.row }
  }
  return { error: 'target must be "section" or "field".' }
}

/** Directory cell values: text only, trimmed to a sane size. */
function cleanData(data) {
  const out = {}
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out
  for (const [k, v] of Object.entries(data).slice(0, 60)) {
    const key = clip(k, 80).trim()
    if (!key) continue
    out[key] = v === null ? null : clip(v, 5000)
  }
  return out
}

async function editDirectoryRow(workspaceId, args, session) {
  if (args.action === 'create') {
    const sectionKey = clip(args.section_key, 100).trim()
    if (!sectionKey) return { error: 'section_key is required to add a row.' }
    const sections = await db(`brand_sections?${ws(workspaceId)}&key=eq.${encodeURIComponent(sectionKey)}&select=key,kind&limit=1`)
    if (sections?.[0]?.kind !== 'directory') return { error: `There is no directory section "${sectionKey}" in this workspace.` }
    const data = Object.fromEntries(Object.entries(cleanData(args.data)).filter(([, v]) => v !== null))
    if (!Object.keys(data).length) return { error: 'A new row needs some data.' }
    const existing = await db(`brand_directory_rows?${ws(workspaceId)}&section_key=eq.${encodeURIComponent(sectionKey)}&select=sort_order`)
    const out = await applyChange({
      workspaceId, session, tool: 'edit_directory_row', table: 'brand_directory_rows', action: 'create',
      values: { section_key: sectionKey, data, sort_order: nextSortOrder(existing || []) },
    })
    return out.error ? out : { ok: true, edit_id: out.edit_id, row: out.row }
  }
  if (!args.row_id) return { error: 'row_id is required. Call get_brand_brain.' }
  const prior = await readRow('brand_directory_rows', workspaceId, args.row_id)
  if (!prior) return { error: 'That row no longer exists in this workspace.' }
  if (args.action === 'delete') {
    const stop = needsConfirm(args, 'deletes a Brand Brain directory row')
    if (stop) return { error: `${stop} The row now: ${JSON.stringify(prior.data || {}).slice(0, 2000)}` }
    const out = await applyChange({ workspaceId, session, tool: 'edit_directory_row', table: 'brand_directory_rows', action: 'delete', rowId: args.row_id, before: prior })
    return out.error ? out : { ok: true, edit_id: out.edit_id, deleted: prior.data }
  }
  if (args.action === 'update') {
    const patch = cleanData(args.data)
    if (!Object.keys(patch).length) return { error: 'Nothing to change.' }
    const overwrites = Object.entries(patch).some(([k, v]) => !isBlank(prior.data?.[k]) && prior.data[k] !== v)
    if (overwrites) {
      const stop = needsConfirm(args, 'overwrites existing text in a directory row')
      if (stop) return { error: `${stop} The row now: ${JSON.stringify(prior.data || {}).slice(0, 2000)}` }
    }
    const data = mergeConfig(prior.data || {}, patch)
    const out = await applyChange({ workspaceId, session, tool: 'edit_directory_row', table: 'brand_directory_rows', action: 'update', rowId: args.row_id, values: { data }, before: prior })
    return out.error ? out : { ok: true, edit_id: out.edit_id, row: out.row }
  }
  return { error: 'action must be create, update or delete.' }
}

// ─── The rule book ─────────────────────────────────────────────────────────

async function editRule(workspaceId, args, session) {
  const action = args.action
  if (action === 'add') {
    const rule = clip(args.rule, 500).trim()
    if (!rule) return { error: 'A rule needs text.' }
    const existing = await db(`brand_memory?${ws(workspaceId)}&select=id,rule,status&limit=500`)
    const clash = (existing || []).find(r => norm(r.rule) === norm(rule))
    if (clash) return { error: `That rule already exists with status "${clash.status}" (id ${clash.id}). Use accept or edit instead.` }
    const scope = MEMORY_SCOPES.includes(args.scope) ? args.scope : 'global'
    const out = await applyChange({
      workspaceId, session, tool: 'edit_rule', table: 'brand_memory', action: 'create',
      // 'human': a person dictated it. Not 'research' — that marks a rule the
      // machine proposed, and this one was not proposed, it was decided.
      values: { rule, detail: clip(args.detail, 2000), scope, status: 'active', source: 'human' },
    })
    return out.error ? out : { ok: true, edit_id: out.edit_id, id: out.row?.id, status: 'active' }
  }

  if (!args.rule_id) return { error: 'rule_id is required. Call get_memory.' }
  if (RULE_STATUS_FOR[action]) {
    if (action !== 'accept') {
      const stop = needsConfirm(args, 'switches a rule off')
      if (stop) return { error: stop }
    }
    const out = await applyChange({
      workspaceId, session, tool: 'edit_rule', table: 'brand_memory', action: 'update',
      rowId: args.rule_id, values: { status: RULE_STATUS_FOR[action] },
    })
    return out.error ? out : { ok: true, edit_id: out.edit_id, status: RULE_STATUS_FOR[action] }
  }
  if (action === 'edit') {
    const values = {}
    if (!isBlank(args.rule)) values.rule = clip(args.rule, 500).trim()
    if (args.detail !== undefined) values.detail = clip(args.detail, 2000)
    if (args.scope !== undefined) {
      if (!MEMORY_SCOPES.includes(args.scope)) return { error: `Scope must be one of: ${MEMORY_SCOPES.join(', ')}.` }
      values.scope = args.scope
    }
    if (!Object.keys(values).length) return { error: 'Nothing to change.' }
    const stop = needsConfirm(args, 'rewrites an existing rule')
    if (stop) return { error: stop }
    const out = await applyChange({ workspaceId, session, tool: 'edit_rule', table: 'brand_memory', action: 'update', rowId: args.rule_id, values })
    return out.error ? out : { ok: true, edit_id: out.edit_id, rule: out.row }
  }
  return { error: 'action must be add, accept, reject, retire or edit.' }
}

// ─── The research agenda ───────────────────────────────────────────────────

function agendaFields(args, kind) {
  const values = {}
  if (args.subject !== undefined) values.subject = clip(args.subject, 300).trim()
  if (args.why !== undefined) values.why = clip(args.why, 1000)
  if (args.cadence !== undefined) values.cadence = args.cadence === 'monthly' ? 'monthly' : 'weekly'
  if (args.tier !== undefined && args.tier !== null) {
    const tier = Math.round(Number(args.tier))
    if (!(tier >= 1 && tier <= 3)) return { error: 'tier must be 1, 2 or 3.' }
    values.tier = tier
  }
  if (args.source_type !== undefined) {
    if (kind !== 'source') return { error: 'source_type applies to sources only.' }
    if (!SOURCE_TYPES.includes(args.source_type)) return { error: `source_type must be one of: ${SOURCE_TYPES.filter(Boolean).join(', ')}.` }
    values.source_type = args.source_type
  }
  if (args.ig_handle !== undefined) {
    if (kind !== 'competitor') return { error: 'ig_handle applies to competitors only.' }
    values.ig_handle = clip(args.ig_handle, 100).replace(/^@/, '').trim()
    // A handle a person confirmed in chat is a hand-set handle — the one
    // status the snapshot step trusts without its own verification.
    values.ig_status = values.ig_handle ? 'human_set' : 'unresolved'
  }
  return { values }
}

async function editAgendaItem(workspaceId, args, session) {
  const action = args.action
  if (action === 'create') {
    const kind = AGENDA_KINDS.includes(args.kind) ? args.kind : ''
    if (!kind) return { error: `kind must be one of: ${AGENDA_KINDS.join(', ')}.` }
    const { values, error } = agendaFields(args, kind)
    if (error) return { error }
    if (!values.subject) return { error: 'subject is required.' }
    const existing = await db(`research_agenda?${ws(workspaceId)}&kind=eq.${kind}&select=id,subject,status&limit=500`)
    const clash = (existing || []).find(r => norm(r.subject) === norm(values.subject))
    if (clash) {
      return { error: `That ${kind} is already on the agenda with status "${clash.status}" (id ${clash.id}). Use update or activate instead.` }
    }
    const out = await applyChange({
      workspaceId, session, tool: 'edit_agenda_item', table: 'research_agenda', action: 'create',
      // 'human': an admin asked for it in so many words. The column exists so
      // that what a person decided is never mistaken for what the agent guessed.
      values: { kind, status: 'active', created_by: 'human', ...values },
    })
    return out.error ? out : { ok: true, edit_id: out.edit_id, id: out.row?.id, status: 'active' }
  }

  if (!args.item_id) return { error: 'item_id is required. Call get_agenda.' }
  const prior = await readRow('research_agenda', workspaceId, args.item_id)
  if (!prior) return { error: 'That agenda item no longer exists in this workspace.' }

  if (action === 'retire' || action === 'activate') {
    const status = action === 'retire' ? 'retired' : 'active'
    if (!AGENDA_STATUSES.includes(status)) return { error: 'Bad status.' }
    if (action === 'retire') {
      const stop = needsConfirm(args, `retires "${prior.subject}" from the agenda`)
      if (stop) return { error: stop }
    }
    const out = await applyChange({ workspaceId, session, tool: 'edit_agenda_item', table: 'research_agenda', action: 'update', rowId: args.item_id, values: { status }, before: prior })
    return out.error ? out : { ok: true, edit_id: out.edit_id, status }
  }
  if (action === 'update') {
    const { values, error } = agendaFields(args, prior.kind)
    if (error) return { error }
    if (values.subject === '') return { error: 'subject cannot be blank.' }
    if (!Object.keys(values).length) return { error: 'Nothing to change.' }
    const overwrites = ['subject', 'why'].some(k => values[k] !== undefined && !isBlank(prior[k]) && prior[k] !== values[k])
    if (overwrites) {
      const stop = needsConfirm(args, 'rewrites existing agenda text')
      if (stop) return { error: stop }
    }
    const out = await applyChange({ workspaceId, session, tool: 'edit_agenda_item', table: 'research_agenda', action: 'update', rowId: args.item_id, values, before: prior })
    return out.error ? out : { ok: true, edit_id: out.edit_id, item: out.row }
  }
  return { error: 'action must be create, update, retire or activate.' }
}

// ─── The sales ICP ─────────────────────────────────────────────────────────

async function editIcp(workspaceId, args, session) {
  const patch = args.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length) {
    return { error: 'patch must be an object with at least one key.' }
  }
  const stop = needsConfirm(args, 'changes the ideal customer profile, which re-ranks every sales target')
  if (stop) return { error: stop }

  const prior = await readRow('sales_icp', workspaceId)
  const merged = mergeConfig(prior?.config || {}, patch)
  // Validated by the same normaliser the Targets page saves through, and
  // stored in its output shape — so the chat can never write an ICP the page
  // would read differently.
  const config = normaliseIcp(merged)

  // A key the normaliser does not know is DROPPED by it. Said out loud rather
  // than reported as a success: "I set X" followed by X not being there is
  // the worst kind of edit.
  const dropped = Object.keys(patch).filter(k => patch[k] !== null && !(k in config))
  if (dropped.length) {
    return { error: `The ICP does not have ${dropped.map(k => `"${k}"`).join(', ')}. Known keys: ${Object.keys(config).join(', ')}.` }
  }

  const values = { config, updated_by: session.userId || null, updated_at: new Date().toISOString() }
  const out = prior
    ? await applyChange({ workspaceId, session, tool: 'edit_icp', table: 'sales_icp', action: 'update', rowId: workspaceId, values, before: prior })
    : await applyChange({ workspaceId, session, tool: 'edit_icp', table: 'sales_icp', action: 'create', values })
  return out.error ? out : { ok: true, edit_id: out.edit_id, config }
}

// ─── Plan ideas and drafts ─────────────────────────────────────────────────

const IDEA_TEXT = { title: 200, topic: 300, angle: 1000, rationale: 1000, content_pillar: 100, suggested_format: 60 }

async function editPlanIdea(workspaceId, args, session) {
  const values = {}
  for (const [k, n] of Object.entries(IDEA_TEXT)) if (args[k] !== undefined) values[k] = clip(args[k], n)
  if (args.status !== undefined) {
    if (!IDEA_STATUSES_ALLOWED.includes(args.status)) {
      return { error: 'Status can be set to proposed or rejected only. Approving stays a person\'s click in the planner.' }
    }
    values.status = args.status
  }

  if (args.action === 'create') {
    if (!args.plan_id) return { error: 'plan_id is required. Call get_plans.' }
    if (isBlank(values.title)) return { error: 'An idea needs a title.' }
    const out = await applyChange({
      workspaceId, session, tool: 'edit_plan_idea', table: 'plan_ideas', action: 'create',
      values: { ...values, plan_id: args.plan_id, status: values.status || 'proposed', source: 'agent' },
    })
    return out.error ? out : { ok: true, edit_id: out.edit_id, id: out.row?.id }
  }

  if (!args.idea_id) return { error: 'idea_id is required. Call get_plans.' }
  const prior = await readRow('plan_ideas', workspaceId, args.idea_id)
  if (!prior) return { error: 'That idea no longer exists in this workspace.' }

  if (args.action === 'delete') {
    if (prior.status === 'approved') return { error: 'An approved idea cannot be deleted from the chat. Reject or remove it in the planner.' }
    const stop = needsConfirm(args, `deletes the idea "${prior.title}"`)
    if (stop) return { error: stop }
    const out = await applyChange({ workspaceId, session, tool: 'edit_plan_idea', table: 'plan_ideas', action: 'delete', rowId: args.idea_id, before: prior })
    return out.error ? out : { ok: true, edit_id: out.edit_id, deleted: prior.title }
  }
  if (args.action === 'update') {
    if (!Object.keys(values).length) return { error: 'Nothing to change.' }
    // Un-approving would pull a post out from under a plan that may already
    // have scheduled it. Approved ideas keep their status.
    if (prior.status === 'approved' && values.status) return { error: 'This idea is approved; its status is changed in the planner.' }
    const out = await applyChange({ workspaceId, session, tool: 'edit_plan_idea', table: 'plan_ideas', action: 'update', rowId: args.idea_id, values, before: prior })
    return out.error ? out : { ok: true, edit_id: out.edit_id, idea: out.row }
  }
  return { error: 'action must be create, update or delete.' }
}

/** Statuses a post can be edited in from the chat. Anything else is in a queue. */
const EDITABLE_POST_STATUSES = ['draft', 'pending_review']
const UNSENT_PUBLISH = ['', 'not_published', null, undefined]

async function editDraft(workspaceId, args, session) {
  const prior = await readRow('generated_posts', workspaceId, args.post_id)
  if (!prior) return { error: 'That post no longer exists in this workspace.' }
  // Stricter than postLock on purpose: a post scheduled for the future is
  // editable in the app, but only by re-booking the slot at Zernio. The chat
  // has no way to re-book, so it does not touch anything booked at all.
  if (!EDITABLE_POST_STATUSES.includes(prior.status) || !UNSENT_PUBLISH.includes(prior.publish_status) ||
      prior.scheduled_publish_at || prior.published_at || prior.zernio_post_id) {
    return { error: `This post is ${prior.publish_status || prior.status} and cannot be edited from the chat. Open it in the composer.` }
  }
  const values = {}
  if (args.caption !== undefined) values.caption = deDash(clip(args.caption, 4000))
  if (args.caption_ar !== undefined) values.caption_ar = deDash(clip(args.caption_ar, 4000))
  if (args.hashtags !== undefined) values.hashtags = clip(args.hashtags, 1000)
  if (args.topic !== undefined) values.topic = clip(args.topic, 300)
  if (!Object.keys(values).length) return { error: 'Nothing to change.' }
  const overwrites = Object.keys(values).some(k => !isBlank(prior[k]) && prior[k] !== values[k])
  if (overwrites) {
    const stop = needsConfirm(args, 'rewrites text on an existing draft')
    if (stop) return { error: stop }
  }
  const out = await applyChange({ workspaceId, session, tool: 'edit_draft', table: 'generated_posts', action: 'update', rowId: args.post_id, values, before: prior })
  return out.error ? out : { ok: true, edit_id: out.edit_id, note: 'Still a draft. Not scheduled, not published.' }
}

// ─── Undo ──────────────────────────────────────────────────────────────────

/** Same value, for the purposes of "has this row moved since the edit?" */
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

async function undoEdit(workspaceId, args, session) {
  const rows = await db(`agent_edit_log?id=eq.${encodeURIComponent(args.edit_id)}&${ws(workspaceId)}&select=*&limit=1`)
  const entry = rows?.[0]
  if (!entry) return { error: 'No such edit in this workspace. Call get_edit_log.' }
  if (entry.action === 'undo') return { error: 'That entry is itself an undo. Undo the original change again by making the edit afresh.' }
  if (entry.undone_at) return { error: 'That edit has already been undone.' }
  if (!ADMIN_EDIT_TABLES.includes(entry.table_name)) return { error: `${entry.table_name} is not an editable table.` }

  // ── Refuse to clobber a newer change ──
  // The row must still look the way this edit left it. If someone (or a
  // later edit) has changed it since, putting the old values back would
  // silently undo THEIR work too.
  const current = await readRow(entry.table_name, workspaceId, entry.row_id)
  if (entry.action === 'create' || entry.action === 'update') {
    if (!current) return { error: 'The row has since been deleted, so there is nothing to undo.' }
    const keys = Object.keys(entry.after || {}).filter(k => k !== 'updated_at' && !MANAGED.has(k))
    if (entry.action === 'update' && keys.some(k => !same(current[k], entry.after[k]))) {
      return { error: 'The row has been changed again since this edit. Undoing it would overwrite the newer change; edit it directly instead.' }
    }
  } else if (entry.action === 'delete' && current) {
    return { error: 'A row with that id exists again, so the deletion cannot be undone on top of it.' }
  }

  const revert = await revertChange({
    workspaceId, table: entry.table_name, action: entry.action, rowId: entry.row_id,
    before: entry.before, after: entry.after,
  })
  if (!revert.ok) return { error: `Undo failed: ${revert.error}` }

  // The undo is itself logged — an audit trail with holes where the undos
  // happened cannot answer "why does this say X again?". Failing to log it
  // does not re-apply the edit: the person asked for it gone, and it is.
  let undoId = ''
  try {
    const [log] = await db('agent_edit_log', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        workspace_id: workspaceId,
        user_id: session.userId || null,
        chat_id: session.chatId || null,
        tool: 'undo_edit',
        table_name: entry.table_name,
        row_id: entry.row_id,
        action: 'undo',
        before: entry.after,
        after: entry.before,
        undoes: entry.id,
      },
    })
    undoId = log?.id || ''
    await db(`agent_edit_log?id=eq.${encodeURIComponent(entry.id)}&${ws(workspaceId)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      body: { undone_at: new Date().toISOString(), undone_by: session.userId || null },
    })
  } catch (err) {
    console.error('[agent/admin] undo applied but not logged:', err?.message || err)
  }
  return { ok: true, undone: entry.id, edit_id: undoId, table: entry.table_name, restored: entry.before }
}

export const ADMIN_EXECUTORS = {
  get_brand_brain: getBrandBrain,
  get_agenda: getAgenda,
  get_icp: getIcp,
  get_edit_log: getEditLog,
  set_brand_field: setBrandField,
  edit_brand_structure: editBrandStructure,
  edit_directory_row: editDirectoryRow,
  edit_rule: editRule,
  edit_agenda_item: editAgendaItem,
  edit_icp: editIcp,
  edit_plan_idea: editPlanIdea,
  edit_draft: editDraft,
  undo_edit: undoEdit,
}
