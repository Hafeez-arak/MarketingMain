import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../store/auth'
import { Card, SectionHead, Button, Skeleton } from './ui/index'
import {
  fetchAgenda, setHandleByHand, setAgendaStatus, addAgendaRow,
  deleteAgendaRow, watchlistReadiness, resolveHandles, discoverCompetitors,
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
    <li className="py-2 border-b border-border-light last:border-0">
      <div className="flex items-start gap-2">
        <span
          title={STATUS_LABEL[row.ig_status] || row.ig_status}
          className={`mt-1 text-xs ${measurable ? 'text-sage-600' : weak ? 'text-amber-500' : 'text-text-tertiary'}`}
        >
          ●
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm text-text">{row.subject}</div>
          {editing ? (
            <div className="mt-1 flex gap-1.5">
              <input
                autoFocus
                value={value}
                onChange={e => setValue(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                placeholder="their instagram handle"
                className="flex-1 text-xs px-2 py-1 rounded border border-stone-400 focus:outline-none focus:ring-1 focus:ring-amber-700 focus:border-amber-700"
              />
              <button onClick={save} disabled={saving} className="text-xs px-2 text-text hover:underline">
                {saving ? '…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="text-xs px-1 text-text-tertiary">✕</button>
            </div>
          ) : (
            <div className="mt-0.5 flex items-center gap-2 text-xs">
              {row.ig_handle ? (
                <a
                  href={`https://instagram.com/${row.ig_handle}`}
                  target="_blank" rel="noreferrer"
                  className="font-mono text-text-secondary hover:underline"
                >
                  @{row.ig_handle}
                </a>
              ) : (
                <span className="text-text-tertiary">no handle</span>
              )}
              <span className={weak ? 'text-amber-600' : 'text-text-tertiary'}>
                {STATUS_LABEL[row.ig_status] || row.ig_status}
                {row.ig_confidence != null && !measurable ? ` · ${Number(row.ig_confidence).toFixed(2)}` : ''}
              </span>
              <button onClick={() => { setValue(row.ig_handle || ''); setEditing(true) }}
                      className="text-text-tertiary hover:text-text">
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

// A rival the agent proposed and nobody has decided on. It is NOT measured in
// this state — gather filters on status=active — so Accept is the only thing
// that puts it on the watchlist. Reject retires the row rather than deleting
// it: the run checks every name on the agenda whatever its status, so a
// retired row is what stops the same company being suggested again next week.
function SuggestionRow({ row, accessToken, onChanged }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const decide = async status => {
    setBusy(true)
    setError('')
    const out = await setAgendaStatus(accessToken, row.id, status)
    setBusy(false)
    if (out?.error) { setError(`Could not save: ${out.error}`); return }
    onChanged()
  }
  return (
    <li className="py-2 border-b border-amber-100 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-text">{row.subject}</div>
          {row.why ? <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary break-words">{row.why}</p> : null}
          {error ? <p className="mt-0.5 text-[11px] text-red-600">{error}</p> : null}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button size="sm" onClick={() => decide('active')} disabled={busy}>Accept</Button>
          <Button size="sm" variant="ghost" onClick={() => decide('retired')} disabled={busy}>Reject</Button>
        </div>
      </div>
    </li>
  )
}

function RowsSkeleton() {
  return (
    <div className="mt-2 space-y-3 py-1" aria-busy="true" aria-label="Loading">
      {[0, 1].map(i => (
        <div key={i} className="space-y-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      ))}
    </div>
  )
}

export function AgentSteering() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [agenda, setAgenda] = useState({ questions: [], competitors: [] })
  // The empty agenda above is a starting value, not an answer. Until the first
  // fetch lands, both cards used to state "No competitors are being watched
  // yet" and "None yet" about a brand that has both.
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [newQuestion, setNewQuestion] = useState('')
  const [newCompetitor, setNewCompetitor] = useState('')
  const [finding, setFinding] = useState(false)
  const [findNote, setFindNote] = useState('')

  const refresh = useCallback(() => setReload(n => n + 1), [])

  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return undefined
    let cancelled = false
    fetchAgenda(activeWorkspaceId, accessToken).then(a => {
      if (cancelled) return
      setAgenda(a)
      setLoaded(true)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken, reload])

  // ── Retired competitors are history, not a watchlist ──
  //
  // This panel rendered every competitor row whatever its status, so the 11
  // rivals retired on 2026-09-16 kept sitting under the 17 the sales team
  // actually named — and the list read as though the agent were still watching
  // companies nobody had asked about.
  //
  // They are hidden rather than deleted, and the difference matters: the run
  // decides a competitor is NEW by checking every name on the agenda
  // regardless of status (see priorCompetitors in _investigate.js), so a
  // retired row is exactly what stops the agent rediscovering it and proposing
  // it again next week. Delete them and they come back.
  const watched = (agenda.competitors || []).filter(c => c.status !== 'retired')
  const retiredCount = (agenda.competitors || []).length - watched.length
  const suggested = watched.filter(c => c.status === 'proposed')
  const onList = watched.filter(c => c.status !== 'proposed')

  const readiness = watchlistReadiness(watched)

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

  // Finding WHO to watch, which is a different question from finding their
  // Instagram account. Alo Kheyatah has no competitor list at all, so for that
  // workspace this is the first useful thing the agent can do.
  const findRivals = async () => {
    setFinding(true)
    setFindNote('')
    const out = await discoverCompetitors({ workspaceId: activeWorkspaceId, accessToken })
    setFindNote(
      out.ok
        ? (out.proposed
          ? `Suggested ${out.proposed} to accept or reject below${out.already_watching ? `, ${out.already_watching} already watched` : ''}.`
          : out.note || 'Nothing new found.')
        : out.error || 'Could not search.',
    )
    setFinding(false)
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
      <Card>
        <SectionHead
          title="Competitors it watches"
          subtitle={loaded ? readiness.note : 'Loading the watchlist…'}
          action={
            <span className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={findRivals} disabled={finding}>
                {finding ? 'Searching…' : 'Find rivals'}
              </Button>
              <Button size="sm" variant="ghost" onClick={findHandles} disabled={finding}>
                Find handles
              </Button>
            </span>
          }
        />
        <div className="px-5 py-4 [&>*:first-child]:mt-0">
          {findNote ? <p className="mt-1 text-xs text-text-secondary">{findNote}</p> : null}
          {loaded ? (
            <>
              {suggested.length > 0 && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2">
                  <p className="text-xs font-medium text-amber-800">
                    Suggested by the agent — accept to watch, reject to drop
                  </p>
                  <ul className="mt-1">
                    {suggested.map(row => (
                      <SuggestionRow key={row.id} row={row} accessToken={accessToken} onChanged={refresh} />
                    ))}
                  </ul>
                </div>
              )}
              <ul className="mt-2">
                {onList.map(row => (
                  <HandleRow key={row.id} row={row} accessToken={accessToken} onChanged={refresh} />
                ))}
              </ul>
              {retiredCount > 0 && (
                // Counted rather than listed. Saying nothing at all would make a
                // retired rival look like one that was never there, and the
                // number is what tells someone the list was pruned on purpose.
                <p className="mt-2 text-[11px] text-text-secondary">
                  {retiredCount} retired {retiredCount === 1 ? 'competitor is' : 'competitors are'} hidden. We keep
                  them on record so the agent does not find them again and suggest them back.
                </p>
              )}
            </>
          ) : <RowsSkeleton />}
          <div className="mt-3 flex gap-2">
            <input
              value={newCompetitor}
              onChange={e => setNewCompetitor(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addCompetitor()}
              placeholder="Add a competitor by name…"
              className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-amber-700 focus:border-amber-700"
            />
            <Button size="sm" variant="ghost" onClick={addCompetitor}>Add</Button>
          </div>
          {/* Deliberately allowed to differ from the Brand Brain's competitor
              directory. That difference is information, not a sync bug. */}
          <p className="mt-2 text-[11px] text-text-tertiary">
            This list is the agent's own and may differ from the Brand Brain directory.
          </p>
        </div>
      </Card>

      <Card>
        <SectionHead
          title="Standing questions"
          subtitle="Asked every run, so one week stays comparable to the last."
        />
        <div className="px-5 py-4 [&>*:first-child]:mt-0">
          {!loaded ? (
            <RowsSkeleton />
          ) : agenda.questions.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">
              None yet. Without these the agent decides for itself what to chase each week.
            </p>
          ) : (
            <ul className="mt-2">
              {agenda.questions.map(q => (
                <li key={q.id} className="py-2 border-b border-border-light last:border-0 flex items-start gap-2">
                  <span className={`mt-1 text-xs ${q.status === 'active' ? 'text-sage-600' : 'text-text-tertiary'}`}>●</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-text">{q.subject}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-text-tertiary">
                      <span>{q.status}</span>
                      {/* created_by is why this column exists: a question the
                          agent proposed must never be mistaken for one a person
                          asked for. */}
                      {q.created_by === 'agent' ? <span className="text-text-secondary">suggested by the agent</span> : null}
                      {q.status !== 'active' ? (
                        <button onClick={async () => { await setAgendaStatus(accessToken, q.id, 'active'); refresh() }}
                                className="text-sage-600 hover:underline">accept</button>
                      ) : (
                        <button onClick={async () => { await setAgendaStatus(accessToken, q.id, 'retired'); refresh() }}
                                className="hover:text-text">pause</button>
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
              className="flex-1 text-xs px-2.5 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-amber-700 focus:border-amber-700"
            />
            <Button size="sm" variant="ghost" onClick={addQuestion}>Add</Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
