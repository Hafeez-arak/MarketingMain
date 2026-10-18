import { db } from './_supabase.js'
import { matchPerson, REQUEST_KINDS, REQUEST_STATUSES } from '../../src/lib/agent/requestTools.js'
import { nameIndex } from '../../src/lib/agent/company.js'

// ─── Requests from the chat: the executors ─────────────────────────────────
// Definitions and the reasoning are in src/lib/agent/requestTools.js.
//
// Every executor takes the VERIFIED session as its third argument: who is
// asking decides whose requests "mine" means, who the request is created by,
// and whether they may move one. Nothing about the person comes from the
// model's arguments.
//
// Notifications are written by the requests_notify trigger, never here, so
// `updated_by` must be set on every write: it is how the trigger knows who
// acted (the service key has no auth.uid()) and not to notify them about
// their own change.

const ws = workspaceId => `workspace_id=eq.${encodeURIComponent(workspaceId)}`
const clip = (v, n) => String(v ?? '').trim().slice(0, n)

async function taggable(workspaceId) {
  const [people, access] = await Promise.all([
    db(`request_people?${ws(workspaceId)}&can_be_tagged=eq.true&select=user_id,label`),
    db('user_access?status=eq.approved&select=user_id,email,full_name'),
  ])
  const names = nameIndex(access || [])
  return (people || [])
    .filter(p => names.has(p.user_id))
    .map(p => ({ user_id: p.user_id, name: names.get(p.user_id), label: p.label || '' }))
}

const kindOf = k => (REQUEST_KINDS.includes(k) ? k : 'improvement')

async function insertRequest(workspaceId, session, fields) {
  const rows = await db('requests', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      workspace_id: workspaceId,
      created_by: session?.userId || null,
      updated_by: session?.userId || null,
      chat_id: session?.chatId || null,
      ...fields,
    },
  })
  return rows?.[0] || null
}

async function fileRequest(workspaceId, args, session) {
  const title = clip(args?.title, 120)
  if (!title) return { error: 'A request needs a title.' }
  const row = await insertRequest(workspaceId, session, {
    title,
    body: clip(args?.details, 4000),
    kind: kindOf(args?.kind),
    page: clip(args?.page, 200),
  })
  if (!row) return { error: 'The request could not be saved.' }
  const handlers = await db(`request_people?${ws(workspaceId)}&gets_new_requests=eq.true&select=user_id`)
  const access = await db('user_access?select=user_id,email,full_name')
  const names = nameIndex(access || [])
  return {
    filed: true,
    id: row.id,
    title: row.title,
    status: row.status,
    seen_by: (handlers || []).map(h => names.get(h.user_id)).filter(Boolean),
    where: 'the Requests page',
  }
}

async function tagPerson(workspaceId, args, session) {
  const people = await taggable(workspaceId)
  const person = matchPerson(args?.person, people)
  if (!person) {
    return {
      error: `"${clip(args?.person, 40)}" is not on the tag list for this company. ` +
             `People who can be tagged: ${people.map(p => p.name).join(', ') || 'nobody yet'}.`,
    }
  }
  const title = clip(args?.title, 120)
  if (!title) return { error: 'Say what the work is.' }
  const row = await insertRequest(workspaceId, session, {
    title,
    brief: clip(args?.brief, 4000),
    body: clip(args?.details, 4000),
    kind: kindOf(args?.kind || 'task'),
    page: clip(args?.page, 200),
    assigned_to: person.user_id,
  })
  if (!row) return { error: 'The request could not be saved.' }
  return { tagged: person.name, id: row.id, title: row.title, status: row.status, notified: person.user_id !== session?.userId }
}

async function getRequests(workspaceId, args, session) {
  const scope = ['mine', 'assigned_to_me', 'open', 'all'].includes(args?.scope) ? args.scope : 'mine'
  const limit = Math.min(Math.max(Math.floor(Number(args?.limit) || 15), 1), 50)
  const me = encodeURIComponent(session?.userId || '00000000-0000-0000-0000-000000000000')
  const filter = {
    mine: `&created_by=eq.${me}`,
    assigned_to_me: `&assigned_to=eq.${me}`,
    open: '&status=in.(new,in_progress)',
    all: '',
  }[scope]
  const q = clip(args?.search, 80).replace(/[(),*]/g, ' ').trim()
  // Two OR groups (the search, and who may see what) must both hold, so they
  // go inside one and=() rather than as two or= parameters.
  const groups = []
  if (q) groups.push(`or(title.ilike.*${encodeURIComponent(q)}*,body.ilike.*${encodeURIComponent(q)}*)`)
  // Non-admins see what they asked for or own, like the requests_read policy;
  // the service key would otherwise show them the whole board.
  if (session?.isAdmin !== true) groups.push(`or(created_by.eq.${me},assigned_to.eq.${me})`)
  const where = groups.length ? `&and=(${groups.join(',')})` : ''
  const [rows, access] = await Promise.all([
    db(`requests?${ws(workspaceId)}${filter}${where}&order=updated_at.desc&limit=${limit}` +
       '&select=id,kind,title,body,brief,status,resolution,link,created_by,assigned_to,created_at,updated_at,closed_at'),
    db('user_access?select=user_id,email,full_name'),
  ])
  const names = nameIndex(access || [])
  const who = id => (id ? names.get(id) || 'someone no longer listed' : '')
  const ids = (rows || []).map(r => r.id)
  const events = ids.length
    ? await db(`request_events?request_id=in.(${ids.join(',')})&order=created_at.asc&select=request_id,kind,body,actor,to_status,created_at`)
    : []
  return {
    scope,
    count: (rows || []).length,
    requests: (rows || []).map(r => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      status: r.status,
      asked_by: who(r.created_by),
      assigned_to: who(r.assigned_to) || 'not assigned (on the board for the builders)',
      their_words: clip(r.body, 400),
      brief: clip(r.brief, 400),
      closing_note: r.resolution || '',
      link: r.link || '',
      asked_at: r.created_at,
      last_change: r.updated_at,
      closed_at: r.closed_at,
      history: (events || []).filter(e => e.request_id === r.id).slice(-8).map(e => ({
        when: e.created_at, who: who(e.actor), what: e.kind === 'status' ? `status → ${e.to_status}` : e.kind,
        note: clip(e.body, 200),
      })),
    })),
    note: (rows || []).length ? '' : 'No requests match.',
  }
}

async function updateRequest(workspaceId, args, session) {
  const id = String(args?.id || '').trim()
  if (!id) return { error: 'Give the request id from get_requests.' }
  const rows = await db(`requests?id=eq.${encodeURIComponent(id)}&${ws(workspaceId)}&select=id,title,created_by,assigned_to,status&limit=1`)
  const r = rows?.[0]
  if (!r) return { error: 'No request with that id in this company.' }
  const me = session?.userId
  if (!(session?.isAdmin === true || (me && (r.created_by === me || r.assigned_to === me)))) {
    return { error: 'Only an administrator, the person who asked, or the person it is assigned to can change this request.' }
  }

  const patch = { updated_by: me || null }
  if (args?.status) {
    if (!REQUEST_STATUSES.includes(args.status)) return { error: `Status must be one of ${REQUEST_STATUSES.join(', ')}.` }
    patch.status = args.status
  }
  if (args?.note != null && String(args.note).trim()) patch.resolution = clip(args.note, 2000)
  if (args?.link != null && String(args.link).trim()) patch.link = clip(args.link, 500)
  if (args?.assign_to) {
    const person = matchPerson(args.assign_to, await taggable(workspaceId))
    if (!person) return { error: `"${clip(args.assign_to, 40)}" is not on the tag list for this company.` }
    patch.assigned_to = person.user_id
  }

  const changed = Object.keys(patch).length > 1
  if (changed) {
    await db(`requests?id=eq.${encodeURIComponent(id)}&${ws(workspaceId)}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' })
  }
  if (args?.comment && String(args.comment).trim()) {
    await db('request_events', {
      method: 'POST',
      prefer: 'return=minimal',
      body: { request_id: id, workspace_id: workspaceId, actor: me || null, kind: 'comment', body: clip(args.comment, 2000) },
    })
  }
  if (!changed && !args?.comment) return { error: 'Nothing to change: give a status, note, link, assign_to or comment.' }
  return { updated: true, id, title: r.title, status: patch.status || r.status }
}

export const REQUEST_EXECUTORS = {
  file_request:   fileRequest,
  tag_person:     tagPerson,
  get_requests:   getRequests,
  update_request: updateRequest,
}
