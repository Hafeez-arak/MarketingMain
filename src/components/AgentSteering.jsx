import { useCallback, useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../store/auth'
import { Card, SectionHead, Button, Skeleton } from './ui/index'
import {
  fetchAgenda, setHandleByHand, setAgendaStatus, addAgendaRow, updateAgendaRow,
  deleteAgendaRow, watchlistReadiness, resolveHandles, discoverCompetitors,
  SOURCE_TYPES, sourceTypeLabel,
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
              Not measured until someone confirms it — only a verified or hand-set handle
              is counted.
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



// ─── Collapsible cards (2026-10-17) ─────────────────────────────────────────
// The three cards got long — 31 sources alone fill a screen — so each folds to
// its head. The subtitle stays visible folded, so a closed card still says
// what it holds. Remembered per person in this browser; storage that throws
// (private window) just means every card starts closed.
function useOpen(key) {
  const storageKey = `agentSteering.open.${key}`
  const [open, setOpen] = useState(() => {
    try { return window.localStorage.getItem(storageKey) === '1' } catch { return false }
  })
  const toggle = useCallback(() => setOpen(o => {
    try { window.localStorage.setItem(storageKey, o ? '0' : '1') } catch { /* not remembered, still works */ }
    return !o
  }), [storageKey])
  return [open, toggle]
}

/** The card title as a button that folds the card. */
function FoldTitle({ open, onToggle, children, count }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open}
            className="flex items-center gap-1.5 text-left hover:text-amber-800">
      <ChevronRight size={14} className={`flex-shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
      <span>{children}</span>
      {count != null && !open ? <span className="font-normal text-text-tertiary">({count})</span> : null}
    </button>
  )
}

const INPUT = 'text-xs px-2.5 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-1 focus:ring-amber-700 focus:border-amber-700'

const PLACEHOLDER = {
  website: 'e.g. saudigulfprojects.com',
  news: 'e.g. constructionweekonline.com',
  tender_portal: 'e.g. tenders.etimad.sa',
  exchange: 'e.g. saudiexchange.sa',
  government: 'e.g. rcrc.gov.sa',
  instagram: 'e.g. @addadruh or an instagram.com link',
  linkedin: 'e.g. linkedin.com/company/…',
  x: 'e.g. @account',
  hashtag: 'e.g. #مشاريع_الرياض',
  keyword: 'e.g. ترسية عقد تشطيب الرياض',
}

const shortDate = iso => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Riyadh' })

/**
 * What the sweep made of a source: when it was last checked, what came back,
 * and when it last led to a project finding. Says "not checked yet" rather
 * than nothing, so a source the run never reached can be told apart from one
 * that came back empty — the exact thing nobody could tell before.
 */
function SourceRecordLine({ record }) {
  if (!record?.checkedAt) {
    return <div className="mt-0.5 text-xs text-text-tertiary">Not checked yet. The next run checks it.</div>
  }
  if (record.status === 'failed') {
    return <div className="mt-0.5 text-xs text-amber-700">Could not be checked on {shortDate(record.checkedAt)}.</div>
  }
  const parts = [`Checked ${shortDate(record.checkedAt)}`,
    !record.results ? 'nothing came back'
      : record.fresh != null ? `${record.fresh} new of ${record.results}`
        : `${record.results} result${record.results === 1 ? '' : 's'}`]
  if (record.lastHitAt) parts.push(`led to a project ${shortDate(record.lastHitAt)}`)
  else if (record.runs >= 3) parts.push(`no project from it in ${record.runs} checks`)
  return <div className="mt-0.5 text-xs text-text-tertiary">{parts.join(' · ')}</div>
}

/** One source: what it is, what it carries, how closely it is read, and what it has given. */
function SourceRow({ row, accessToken, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [why, setWhy] = useState(row.why || '')
  const act = async fn => { await fn(); onChanged() }
  return (
    <li className="py-2 border-b border-border-light last:border-0 flex items-start gap-2">
      <span className={`mt-1 text-xs ${row.status === 'active' ? 'text-sage-600' : 'text-text-tertiary'}`}>●</span>
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
            {sourceTypeLabel(row.source_type)}
          </span>
          <span className="text-sm text-text break-all" dir="auto">{row.subject}</span>
        </div>
        {editing ? (
          <div className="mt-1 flex gap-2">
            <input value={why} onChange={e => setWhy(e.target.value)} dir="auto"
                   onKeyDown={e => e.key === 'Enter' && act(async () => { await updateAgendaRow(accessToken, row.id, { why }); setEditing(false) })}
                   placeholder="What it carries" className={`flex-1 ${INPUT}`} />
            <Button size="sm" variant="ghost" onClick={() => act(async () => { await updateAgendaRow(accessToken, row.id, { why }); setEditing(false) })}>Save</Button>
          </div>
        ) : row.why ? (
          <div className="mt-0.5 text-xs text-text-secondary" dir="auto">{row.why}</div>
        ) : null}
        {row.status === 'active' ? <SourceRecordLine record={row.record} /> : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
          {/* Every active source is checked every run (sourceSweep.js); the
              tier is how closely, no longer how often. */}
          <select value={row.tier || 2} aria-label="How closely it is read"
                  onChange={e => act(() => updateAgendaRow(accessToken, row.id, { tier: e.target.value }))}
                  className="bg-transparent text-xs text-text-tertiary hover:text-text">
            <option value={1}>read closely</option>
            <option value={2}>read</option>
            <option value={3}>skim</option>
          </select>
          <span>{row.status === 'retired' ? 'paused' : row.status}</span>
          {row.created_by === 'agent' ? <span className="text-text-secondary">suggested by the agent</span> : null}
          {row.status !== 'active' ? (
            <button onClick={() => act(() => setAgendaStatus(accessToken, row.id, 'active'))}
                    className="text-sage-600 hover:underline">{row.status === 'proposed' ? 'accept' : 'resume'}</button>
          ) : (
            <button onClick={() => act(() => setAgendaStatus(accessToken, row.id, 'retired'))}
                    className="hover:text-text">pause</button>
          )}
          <button onClick={() => setEditing(e => !e)} className="hover:text-text">{editing ? 'cancel' : 'edit note'}</button>
          <button onClick={() => act(() => deleteAgendaRow(accessToken, row.id))}
                  className="hover:text-red-600">delete</button>
        </div>
      </div>
    </li>
  )
}

/**
 * "Where to look" — the sites, accounts, hashtags and phrases the project
 * lenses read before searching openly (2026-10-17). Since 2026-10-19 the code
 * checks every active one each run, before the lenses start (sourceSweep.js). Same table, same RLS and
 * the same accept/pause/delete as the standing questions beside it; see
 * sourcesBlock() in src/lib/agent/lensPrompts.js for how a run uses them.
 */
function SourcesCard({ sources, loaded, error, accessToken, workspaceId, onChanged }) {
  const [type, setType] = useState('website')
  const [subject, setSubject] = useState('')
  const [why, setWhy] = useState('')
  const [filter, setFilter] = useState('')
  const add = async () => {
    if (!subject.trim()) return
    await addAgendaRow(workspaceId, accessToken, { kind: 'source', subject, why, source_type: type, tier: 2 })
    setSubject('')
    setWhy('')
    onChanged()
  }
  const sorted = [...sources]
    .filter(r => !filter || r.source_type === filter)
    .sort((a, b) => (a.status === 'proposed' ? -1 : 0) - (b.status === 'proposed' ? -1 : 0)
      || (a.tier ?? 9) - (b.tier ?? 9) || String(a.subject).localeCompare(String(b.subject)))
  const active = sources.filter(r => r.status === 'active').length
  const types = SOURCE_TYPES.filter(([k]) => sources.some(r => r.source_type === k))
  const [open, toggle] = useOpen('sources')
  return (
    <Card className="md:col-span-2">
      <SectionHead
        bordered={open}
        title={<FoldTitle open={open} onToggle={toggle} count={loaded ? active : null}>Where to look</FoldTitle>}
        subtitle={!loaded ? 'Loading the sources…'
          : error ? 'The sources could not be loaded. Nothing has been lost.'
            : `${active} source${active === 1 ? '' : 's'}, all checked every run before the agent searches openly for projects. It also builds its own hashtags and keywords each run.`}
      />
      {open ? (
      <div className="px-5 py-4 [&>*:first-child]:mt-0">
        {loaded && types.length > 1 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {[['', 'All'], ...types].map(([k, label]) => (
              <button key={k || 'all'} onClick={() => setFilter(k)}
                      className={`rounded-full px-2 py-0.5 text-xs ${filter === k ? 'bg-amber-700 text-white' : 'bg-surface-muted text-text-secondary hover:text-text'}`}>
                {label}
              </button>
            ))}
          </div>
        ) : null}
        {!loaded ? <RowsSkeleton /> : sorted.length === 0 ? (
          <p className="mt-2 text-sm text-text-secondary">
            None yet. Without these the agent takes whatever a search engine ranks first.
          </p>
        ) : (
          <ul className="mt-2">
            {sorted.map(r => <SourceRow key={r.id} row={r} accessToken={accessToken} onChanged={onChanged} />)}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <select value={type} onChange={e => setType(e.target.value)} aria-label="Kind of source" className={INPUT}>
            {SOURCE_TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <input value={subject} onChange={e => setSubject(e.target.value)} dir="auto"
                 onKeyDown={e => e.key === 'Enter' && add()}
                 placeholder={PLACEHOLDER[type]} className={`flex-1 ${INPUT}`} />
          <input value={why} onChange={e => setWhy(e.target.value)} dir="auto"
                 onKeyDown={e => e.key === 'Enter' && add()}
                 placeholder="What it carries (optional)" className={`flex-1 ${INPUT}`} />
          <Button size="sm" variant="ghost" onClick={add}>Add</Button>
        </div>
      </div>
      ) : null}
    </Card>
  )
}

export function AgentSteering() {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [agenda, setAgenda] = useState({ questions: [], competitors: [], sources: [] })
  // The empty agenda above is a starting value, not an answer. Until the first
  // fetch lands, both cards used to state "No competitors are being watched
  // yet" and "None yet" about a brand that has both.
  const [loaded, setLoaded] = useState(false)
  const [reload, setReload] = useState(0)
  const [newQuestion, setNewQuestion] = useState('')
  const [newCompetitor, setNewCompetitor] = useState('')
  const [finding, setFinding] = useState(false)
  const [findNote, setFindNote] = useState('')
  const [competitorsOpen, toggleCompetitors] = useOpen('competitors')
  const [questionsOpen, toggleQuestions] = useOpen('questions')

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
    // items-start: a folded card keeps its own height instead of stretching to
    // match an open one beside it.
    <div className="grid gap-4 md:grid-cols-2 items-start">
      <Card>
        <SectionHead
          bordered={competitorsOpen}
          title={<FoldTitle open={competitorsOpen} onToggle={toggleCompetitors} count={loaded ? watched.length : null}>Competitors it watches</FoldTitle>}
          subtitle={!loaded ? 'Loading the watchlist…' : agenda.error ? `The watchlist could not be loaded (${agenda.error}). Nothing has been lost.` : readiness.note}
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
        {competitorsOpen ? (
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
            This list belongs to the research and may differ from the competitors listed in Brand Brain.
          </p>
        </div>
        ) : null}
      </Card>

      <Card>
        <SectionHead
          bordered={questionsOpen}
          title={<FoldTitle open={questionsOpen} onToggle={toggleQuestions} count={loaded ? agenda.questions.length : null}>Standing questions</FoldTitle>}
          subtitle="Asked every run, so one week stays comparable to the last."
        />
        {questionsOpen ? (
        <div className="px-5 py-4 [&>*:first-child]:mt-0">
          {!loaded ? (
            <RowsSkeleton />
          ) : agenda.error ? (
            <p className="mt-2 text-sm text-text-secondary">
              The questions could not be loaded. Nothing has been lost.{' '}
              <button type="button" className="underline" onClick={refresh}>Try again</button>
            </p>
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
        ) : null}
      </Card>

      <SourcesCard
        sources={agenda.sources || []}
        loaded={loaded}
        error={agenda.error}
        accessToken={accessToken}
        workspaceId={activeWorkspaceId}
        onChanged={refresh}
      />
    </div>
  )
}
