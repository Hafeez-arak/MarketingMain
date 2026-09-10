import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { Card, SectionHead, Button } from './ui/index'
import {
  fetchAgenda, setHandleByHand, setAgendaStatus, addAgendaRow,
  deleteAgendaRow, watchlistReadiness, resolveHandles,
} from '../lib/agentAgenda'

// ─── What the agent watches, and what it is told to ask ────────────────────
// AGENT.md §5b. The agent is not a scheduled report you receive — it is meant
// to sit beside whoever is doing the work, so everything it watches and
// believes is editable by a person, in the place they are already looking.
//
// The competitor half matters most right now: only two of Arak's six rivals
// have a handle the pipeline will trust, and until that changes a run measures
// two companies. Correcting one by hand is a single field.

const STATUS_LABEL = {
  resolved: 'verified',
  human_set: 'set by hand',
  unresolved: 'unverified guess',
  not_found: 'no account found',
  private: 'private account',
}

function HandleRow({ row, accessToken, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(row.ig_handle || '')
  const [saving, setSaving] = useState(false)

  const measurable = row.ig_status === 'resolved' || row.ig_status === 'human_set'
  const weak = row.ig_status === 'unresolved' && row.ig_handle

  const save = async () => {
    setSaving(true)
    await setHandleByHand(accessToken, row.id, value)
    setSaving(false)
    setEditing(false)
    onChanged()
  }

  return (
    <li className="py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-2">
        <span
          title={STATUS_LABEL[row.ig_status] || row.ig_status}
          className={`mt-1 text-xs ${measurable ? 'text-emerald-600' : weak ? 'text-amber-500' : 'text-slate-300'}`}
        >
          ●
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-slate-800">{row.subject}</div>
          {editing ? (
            <div className="mt-1 flex gap-1.5">
              <input
                autoFocus
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                placeholder="their instagram handle"
                className="flex-1 text-xs px-2 py-1 rounded border border-slate-300 focus:outline-none focus:ring-1 focus:ring-slate-400"
              />
              <button onClick={save} disabled={saving} className="text-xs px-2 text-slate-700 hover:underline">
                {saving ? '…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="text-xs px-1 text-slate-400">✕</button>
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              {row.ig_handle ? (
                <a
                  href={`https://instagram.com/${row.ig_handle}`}
                  target="_blank" rel="noreferrer"
                  className="font-mono text-slate-600 hover:underline"
                >
                  @{row.ig_handle}
                </a>
              ) : (
                <span className="text-slate-400">no handle</span>
              )}
              <span className={weak ? 'text-amber-600' : 'text-slate-400'}>
                {STATUS_LABEL[row.ig_status] || row.ig_status}
                {row.ig_confidence != null && !measurable ? ` · ${Number(row.ig_confidence).toFixed(2)}` : ''}
              </span>
              <button onClick={() => { setValue(row.ig_handle || ''); setEditing(true) }}
                      className="text-slate-400 hover:text-slate-700">
                {row.ig_handle ? 'correct' : 'set'}
              </button>
            </div>
          )}
          {/* The case worth calling out loudly. A weak candidate stored as a
              suggestion is useful; a weak candidate silently measured as fact
              is the kind of wrong that does not look wrong. */}
          {weak ? (
            <div className="mt-1 text-[11px] text-amber-700">
              Not measured until someone confirms it — the pipeline only trusts a verified
              or hand-set handle.
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}

export function AgentSteering() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [agenda, setAgenda] = useState({ questions: [], competitors: [] })
  const [reload, setReload] = useState(0)
  const [newQuestion, setNewQuestion] = useState('')
  const [newCompetitor, setNewCompetitor] = useState('')
  const [finding, setFinding] = useState(false)
  const [findNote, setFindNote] = useState('')

  const refresh = useCallback(() => setReload(n => n + 1), [])

  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return undefined
    let cancelled = false
    fetchAgenda(activeWorkspaceId, accessToken).then(a => { if (!cancelled) setAgenda(a) })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken, reload])

  const readiness = watchlistReadiness(agenda.competitors)

  const addQuestion = async () => {
    if (!newQuestion.trim()) return
    await addAgendaRow(activeWorkspaceId, accessToken, { kind: 'question', subject: newQuestion })
    setNewQuestion('')
    refresh()
  }
  const addCompetitor = async () => {
    if (!newCompetitor.trim()) return
    await addAgendaRow(activeWorkspaceId, accessToken, { kind: 'competitor', subject: newCompetitor })
    setNewCompetitor('')
    refresh()
  }

  const findHandles = async () => {
    setFinding(true)
    setFindNote('')
    const out = await resolveHandles({ workspaceId: activeWorkspaceId, accessToken })
    setFindNote(
      out.ok
        ? `Checked ${out.checked}: ${out.resolved} verified, ${out.suggested} to confirm, ${out.not_found} not found.` +
          (out.note ? ` ${out.note}` : '')
        : out.error || 'Could not search.',
    )
    setFinding(false)
    refresh()
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <SectionHead
          title="Competitors it watches"
          subtitle={readiness.note}
          action={
            <Button size="sm" variant="ghost" onClick={findHandles} disabled={finding}>
              {finding ? 'Searching…' : 'Find handles'}
            </Button>
          }
        />
        {findNote ? <p className="mt-1 text-xs text-slate-600">{findNote}</p> : null}
        <ul className="mt-2">
          {agenda.competitors.map(row => (
            <HandleRow key={row.id} row={row} accessToken={accessToken} onChanged={refresh} />
          ))}
        </ul>
        <div className="mt-3 flex gap-2">
          <input
            value={newCompetitor}
            onChange={e => setNewCompetitor(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCompetitor()}
            placeholder="Add a competitor by name…"
            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <Button size="sm" variant="ghost" onClick={addCompetitor}>Add</Button>
        </div>
        {/* Deliberately allowed to differ from the Brand Brain's competitor
            directory. That difference is information, not a sync bug. */}
        <p className="mt-2 text-[11px] text-slate-400">
          This list is the agent's own and may differ from the Brand Brain directory.
        </p>
      </Card>

      <Card className="p-4">
        <SectionHead
          title="Standing questions"
          subtitle="Asked every run, so one week stays comparable to the last."
        />
        {agenda.questions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            None yet. Without these the agent decides for itself what to chase each week.
          </p>
        ) : (
          <ul className="mt-2">
            {agenda.questions.map(q => (
              <li key={q.id} className="py-2 border-b border-slate-100 last:border-0 flex items-start gap-2">
                <span className={`mt-1 text-xs ${q.status === 'active' ? 'text-emerald-600' : 'text-slate-300'}`}>●</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-800">{q.subject}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
                    <span>{q.status}</span>
                    {/* created_by is why this column exists: a question the
                        agent proposed must never be mistaken for one a person
                        asked for. */}
                    {q.created_by === 'agent' ? <span className="text-slate-500">suggested by the agent</span> : null}
                    {q.status !== 'active' ? (
                      <button onClick={async () => { await setAgendaStatus(accessToken, q.id, 'active'); refresh() }}
                              className="text-emerald-600 hover:underline">accept</button>
                    ) : (
                      <button onClick={async () => { await setAgendaStatus(accessToken, q.id, 'retired'); refresh() }}
                              className="hover:text-slate-700">pause</button>
                    )}
                    <button onClick={async () => { await deleteAgendaRow(accessToken, q.id); refresh() }}
                            className="hover:text-red-600">delete</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex gap-2">
          <input
            value={newQuestion}
            onChange={e => setNewQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addQuestion()}
            placeholder="e.g. Is anyone pushing tunnel lighting?"
            className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-slate-400"
          />
          <Button size="sm" variant="ghost" onClick={addQuestion}>Add</Button>
        </div>
      </Card>
    </div>
  )
}
