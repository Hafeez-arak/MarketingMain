import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { PageHeader, Button, Modal, Skeleton, Empty, Textarea, Input, Select } from '../../components/ui/index'
import { timeAgo } from '../../lib/utils'
import {
  STATUS_LABEL, KIND_LABEL, columnOf, filterRequests,
  fetchRequests, fetchEvents, fetchPeople, fetchTaggable, updateRequest, addComment,
} from '../../lib/requests'
import { askAssistant, assistantMounted } from '../../lib/askAssistant'

// ─── Requests ──────────────────────────────────────────────────────────────
// 2026-10-18, PR 2 of docs/CEO-ASSISTANT-PLAN.md. Where "this isn't good,
// change it" lands when the assistant cannot make the change itself, and
// where tagged work for Shadia or Junaid lives. Requests are made from the
// assistant's chat; this page is for seeing and moving them.
//
// What each person sees is RLS's call: admins the whole board, everyone else
// what they asked for or what is theirs to do. Moving a request notifies the
// asker through a database trigger, not from here.

const COLUMNS = [
  { key: 'new', label: 'New' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'closed', label: 'Done' },
]

const VIEWS = [
  { key: 'all', label: 'Everything I can see' },
  { key: 'mine', label: 'Asked by me' },
  { key: 'assigned', label: 'Assigned to me' },
]

const STATUS_TONE = {
  new: 'text-amber-800 bg-amber-50 border-amber-200',
  in_progress: 'text-sky-800 bg-sky-50 border-sky-200',
  done: 'text-green-800 bg-green-50 border-green-200',
  declined: 'text-text-tertiary bg-surface-subtle border-border',
}

// Requests and notes mix Arabic and English. `plaintext` sets each paragraph's
// direction from its own first letter, so an Arabic paragraph reads right to
// left (full stop on the left) even when the one above it is English.
const MIXED_TEXT = { unicodeBidi: 'plaintext', textAlign: 'start' }

function Chip({ children, className = '' }) {
  return <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${className}`}>{children}</span>
}

export function Requests() {
  const { user, activeWorkspaceId, isAccessAdmin } = useAuth()
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [people, setPeople] = useState(new Map())
  const [taggable, setTaggable] = useState([])
  const [view, setView] = useState('all')

  const load = useCallback(async () => {
    const [{ rows: r, error: e }, p, t] = await Promise.all([
      fetchRequests(activeWorkspaceId), fetchPeople(activeWorkspaceId), fetchTaggable(activeWorkspaceId),
    ])
    setError(e || '')
    setRows(e ? [] : r)
    setPeople(p)
    setTaggable(t)
  }, [activeWorkspaceId])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  const openId = params.get('id') || ''
  const open = (rows || []).find(r => r.id === openId) || null
  const setOpen = id => {
    const next = new URLSearchParams(params)
    if (id) next.set('id', id); else next.delete('id')
    setParams(next, { replace: true })
  }

  const shown = useMemo(() => filterRequests(rows || [], view, user?.id), [rows, view, user?.id])
  const name = id => (id ? people.get(id) || 'Someone' : '')

  return (
    <div className="space-y-4">
      <PageHeader
        title="Requests"
        subtitle="Changes, fixes and tagged work from the assistant. Ask for something in the assistant, or tag Shadia or Junaid with @, and it lands here.">
        <Select value={view} onChange={e => setView(e.target.value)} className="w-52">
          {VIEWS.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
        </Select>
      </PageHeader>

      {error && <p className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-2">The requests could not be loaded: {error}</p>}

      {rows === null ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {COLUMNS.map(c => <Skeleton key={c.key} className="h-64" />)}
        </div>
      ) : !error && rows.length === 0 ? (
        <Empty
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>}
          title="No requests yet"
          description="Tell the assistant what should change, or tag someone with @Shadia or @Junaid. The request appears here and the right person is notified." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-start">
          {COLUMNS.map(col => {
            const list = shown.filter(r => columnOf(r.status) === col.key)
            return (
              <section key={col.key} className="border border-border bg-surface-subtle/60 min-w-0">
                <header className="flex items-center justify-between px-3 py-2 border-b border-border">
                  <p className="eyebrow">{col.label}</p>
                  <span className="text-[11px] text-text-tertiary tabular-nums">{list.length}</span>
                </header>
                <ul className="p-2 space-y-2 min-h-[120px]">
                  {list.map(r => (
                    <li key={r.id}>
                      <button onClick={() => setOpen(r.id)}
                        className="w-full text-left bg-white border border-border hover:border-stone-400 px-3 py-2.5 transition-colors">
                        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                          <Chip className="text-text-secondary bg-white border-border">{KIND_LABEL[r.kind] || r.kind}</Chip>
                          {r.status === 'declined' && <Chip className={STATUS_TONE.declined}>Declined</Chip>}
                        </div>
                        <p className="text-sm font-medium text-text leading-snug">{r.title}</p>
                        <p className="text-[11px] text-text-tertiary mt-1.5 truncate">
                          {name(r.created_by)}{r.assigned_to ? ` → ${name(r.assigned_to)}` : ''} · {timeAgo(r.updated_at)}
                        </p>
                      </button>
                    </li>
                  ))}
                  {list.length === 0 && <li className="text-[11px] text-text-tertiary px-1 py-2">Nothing here.</li>}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {open && (
        <RequestPanel
          key={open.id}
          request={open}
          name={name}
          taggable={taggable}
          canEdit={isAccessAdmin || open.created_by === user?.id || open.assigned_to === user?.id}
          userId={user?.id}
          workspaceId={activeWorkspaceId}
          onClose={() => setOpen('')}
          onChanged={load}
        />
      )}
    </div>
  )
}

function RequestPanel({ request: r, name, taggable, canEdit, userId, workspaceId, onClose, onChanged }) {
  const [events, setEvents] = useState(null)
  const [note, setNote] = useState(r.resolution || '')
  const [link, setLink] = useState(r.link || '')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const loadEvents = useCallback(async () => {
    const { rows } = await fetchEvents(r.id)
    setEvents(rows)
  }, [r.id])

  useEffect(() => {
    const t = setTimeout(loadEvents, 0)
    return () => clearTimeout(t)
  }, [loadEvents])

  async function move(patch) {
    setBusy(true); setError('')
    const e = await updateRequest(r.id, workspaceId, userId, {
      ...patch,
      resolution: note.trim(),
      link: link.trim(),
    })
    setBusy(false)
    if (e) { setError(e); return }
    await Promise.all([onChanged(), loadEvents()])
  }

  async function postComment() {
    if (!comment.trim()) return
    setBusy(true); setError('')
    const e = await addComment(r.id, workspaceId, userId, comment)
    setBusy(false)
    if (e) { setError(e); return }
    setComment('')
    loadEvents()
  }

  const describe = ev => {
    if (ev.kind === 'created') return 'asked'
    if (ev.kind === 'status') return `moved it to ${STATUS_LABEL[ev.to_status] || ev.to_status}`
    if (ev.kind === 'assigned') return 'reassigned it'
    return 'commented'
  }

  return (
    <Modal open onClose={onClose} title={r.title} width="max-w-2xl">
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip className={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
          <Chip className="text-text-secondary bg-white border-border">{KIND_LABEL[r.kind] || r.kind}</Chip>
          <span className="text-[11px] text-text-tertiary">
            Asked by {name(r.created_by)} {timeAgo(r.created_at)}
            {r.assigned_to ? ` · assigned to ${name(r.assigned_to)}` : ' · on the board for the builders'}
            {r.page ? ` · from ${r.page}` : ''}
          </span>
        </div>

        {r.body && (
          <div>
            <p className="eyebrow mb-1">In their words</p>
            <p className="text-sm text-text whitespace-pre-wrap leading-relaxed" style={MIXED_TEXT}>{r.body}</p>
          </div>
        )}
        {r.brief && (
          <div>
            <p className="eyebrow mb-1">Brief</p>
            <p className="text-sm text-text whitespace-pre-wrap leading-relaxed" style={MIXED_TEXT}>{r.brief}</p>
          </div>
        )}
        {assistantMounted() && (
          <button type="button" onClick={() => { onClose(); askAssistant({ item: { entity: 'request', id: r.id, label: `the request "${r.title}"` } }) }}
            className="text-xs text-amber-800 hover:underline">
            Ask Arak about this request
          </button>
        )}
        {r.link && (
          <p className="text-xs"><span className="text-text-tertiary">Result: </span>
            <a href={r.link} target="_blank" rel="noreferrer" className="text-amber-800 underline break-all">{r.link}</a>
          </p>
        )}

        {canEdit && (
          <div className="border border-border bg-surface-subtle/60 p-3 space-y-2">
            {/* Grows with the note so a long answer (often English then Arabic)
                can be read whole before it is sent; each paragraph takes its own
                direction, so the Arabic half reads right to left. */}
            <Textarea label="Note for the asker" rows={3} autoGrow maxHeight={480} value={note} onChange={e => setNote(e.target.value)}
              style={MIXED_TEXT} placeholder="What was done, or why not" />
            <Input label="Link (optional)" value={link} onChange={e => setLink(e.target.value)} placeholder="e.g. the pull request" />
            <div className="flex flex-wrap gap-2 pt-1">
              {r.status !== 'in_progress' && r.status !== 'done' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => move({ status: 'in_progress' })}>Start</Button>}
              {r.status !== 'done' && <Button size="sm" disabled={busy} onClick={() => move({ status: 'done' })}>Mark done</Button>}
              {r.status !== 'declined' && r.status !== 'done' && <Button size="sm" variant="danger" disabled={busy} onClick={() => move({ status: 'declined' })}>Decline</Button>}
              {(r.status === 'done' || r.status === 'declined') && <Button size="sm" variant="secondary" disabled={busy} onClick={() => move({ status: 'new' })}>Reopen</Button>}
              {taggable.length > 0 && (
                <Select value={r.assigned_to || ''} disabled={busy} className="w-44"
                  onChange={e => e.target.value && move({ assigned_to: e.target.value })}>
                  <option value="">{r.assigned_to ? 'Reassign…' : 'Assign to…'}</option>
                  {taggable.map(p => <option key={p.user_id} value={p.user_id}>{p.name}{p.label ? ` (${p.label})` : ''}</option>)}
                </Select>
              )}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        )}

        <div>
          <p className="eyebrow mb-2">History</p>
          {events === null ? <Skeleton className="h-12" /> : (
            <ul className="space-y-2">
              {events.map(ev => (
                <li key={ev.id} className="text-xs leading-relaxed">
                  <span className="font-medium text-text">{name(ev.actor) || 'Someone'}</span>{' '}
                  <span className="text-text-secondary">{describe(ev)}</span>{' '}
                  <span className="text-text-tertiary">{timeAgo(ev.created_at)}</span>
                  {ev.body && ev.kind !== 'created' && <p className="text-text-secondary whitespace-pre-wrap mt-0.5" style={MIXED_TEXT}>{ev.body}</p>}
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2 mt-3">
            <input value={comment} onChange={e => setComment(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') postComment() }}
              placeholder="Add a comment"
              className="flex-1 border border-border px-3 py-1.5 text-sm focus:outline-none focus:border-stone-400" />
            <Button size="sm" variant="secondary" disabled={busy || !comment.trim()} onClick={postComment}>Comment</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
