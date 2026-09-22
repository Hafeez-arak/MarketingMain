import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, Button, Empty, Badge, PillSelect, Skeleton } from '../../components/ui/index'
import { AgentSteering } from '../../components/AgentSteering'
import { SendIdeasToPlan } from '../../components/SendIdeasToPlan'
import { RunProgress } from '../../components/RunProgress'
import { useAuth } from '../../store/auth'
import {
  partitionByClock, deadlineLabel, lensStates, lensHeadline, runEffort, emptiness, pct, marketDirection, basisLabel,
} from '../../lib/researchBrief'
import {
  TEAMS, sectionVisible, forTeam, topThree, salesRows, competitorMoves, socialActivity, eventsView,
  marketNotes, marketingRecommendations, newCompetitors, sourceList, domainOf, teamsOf,
  openItems, freshnessLabel, searchDemand, linesIn, forLine, linesOfRefs, matchesLine,
} from '../../lib/marketReport'
import { fetchIntel, updateOpportunity, updateEventDecision } from '../../lib/marketIntel'
import { fetchAgenda, setAgendaStatus } from '../../lib/agentAgenda'
import { OPPORTUNITY_STATUSES, EVENT_DECISIONS } from '../../lib/agent/intel'
import { isLive } from '../../lib/agent/progress'

// ─── The Research tab — the weekly market report, for three teams ──────────
// Marketing, sales and the technical team read this, and each needs a
// different slice. The page follows the operating spec's order:
//
//   Top 3 · Sales: act now · Competitor moves · Social activity · Events
//   · Market & technical · Marketing recommendations · New competitors
//   · Sources
//
// with a team filter that hides what a team does not act on. Every section
// is built by src/lib/marketReport.js, which the printable brief also uses.
//
// Two sections read the STORE rather than the brief — the lead tracker and
// the events list — because a lead found three weeks ago and still open
// belongs on this week's list. They are the current state, across all runs,
// and are labelled that way so nobody reads them as this run's slice.
//
// Follower counts appear nowhere. What competitors are doing, assembled from
// small signals across channels, is the point.

const fmtDate = iso => {
  if (!iso) return ''
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const TEAM_TONE = {
  marketing: 'bg-sage-50 text-sage-700 border-sage-200',
  sales: 'bg-amber-50 text-amber-800 border-amber-200',
  technical: 'bg-slate-100 text-slate-700 border-slate-200',
}
const RELEVANCE_TONE = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-500 border-slate-200',
}
const LENS_STATE = {
  found: { tone: 'text-emerald-700 bg-emerald-50', label: 'found something' },
  // Amber, not grey: a lens that read forty pages and reported none of them
  // has not had a quiet week, it has thrown a pass away.
  searched: { tone: 'text-amber-700 bg-amber-50', label: 'read, reported nothing' },
  quiet: { tone: 'text-slate-500 bg-slate-100', label: 'looked, found nothing' },
  failed: { tone: 'text-red-700 bg-red-50', label: 'could not answer' },
}
const CHANNEL_LABEL = {
  website: 'Website', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', youtube: 'YouTube',
  news: 'News', jobs: 'Jobs', tender_portal: 'Tenders', event_site: 'Event site', government: 'Government', other: 'Other',
}

function Chip({ children, tone = 'bg-slate-50 text-slate-600 border-slate-200', title }) {
  return (
    <span title={title} className={`inline-flex items-center max-w-full truncate px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap ${tone}`}>
      {children}
    </span>
  )
}

const TeamChip = ({ team }) => <Chip tone={TEAM_TONE[team]}>{team}</Chip>
const RelevanceChip = ({ value }) => (value ? <Chip tone={RELEVANCE_TONE[value]}>{value}</Chip> : null)

function NewChip({ isNew, changed }) {
  if (changed) return <Chip tone="bg-blue-50 text-blue-700 border-blue-200" title={changed}>changed</Chip>
  if (isNew) return <Chip tone="bg-emerald-50 text-emerald-700 border-emerald-200">new</Chip>
  return null
}

// Sources are the difference between a finding and an opinion, so they are
// always visible — never behind a disclosure. An uncited finding says so.
function Sources({ sources, uncited }) {
  if (uncited) {
    return <p className="text-[11px] text-amber-700 mt-2">No source survived verification — an observation, not evidence.</p>
  }
  if (!sources?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.slice(0, 5).map((s, i) => {
        const url = typeof s === 'string' ? s : s.url
        return (
          <a key={i} href={url} target="_blank" rel="noopener noreferrer"
            className="text-[10px] px-1.5 py-0.5 rounded border border-border text-text-tertiary hover:text-text hover:border-slate-400 truncate max-w-[220px]"
            title={(typeof s === 'string' ? s : s.quote || s.title || url) || ''}>
            {domainOf(url)}
          </a>
        )
      })}
    </div>
  )
}

// One small piece of evidence behind a combined claim: where it was seen, and
// a link to it. The channel is shown first because "three channels agree" is
// what makes a competitor move believable.
function Piece({ p }) {
  return (
    <li className="flex items-start gap-2 text-[11px] leading-relaxed min-w-0">
      <span className="shrink-0 mt-px max-w-[40%]"><Chip>{CHANNEL_LABEL[p.channel] || p.channel || 'source'}</Chip></span>
      <span className="text-text-secondary min-w-0">
        {p.summary}
        {p.date && <span className="text-text-tertiary"> · {fmtDate(p.date)}</span>}
        {p.url && (
          <> · <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-text-tertiary underline underline-offset-2 hover:text-text break-all">{domainOf(p.url)}</a></>
        )}
      </span>
    </li>
  )
}

// Native <details>: survives re-render, works with find-in-page, keyboard
// accessible, and needs no state of its own.
function Fold({ title, subtitle, count, children, open = false }) {
  return (
    <Card className="p-0 overflow-hidden">
      <details open={open} className="group">
        <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">{title}</p>
            {subtitle && <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{subtitle}</p>}
          </div>
          <span className="shrink-0 text-[11px] text-text-tertiary tabular-nums">
            {count != null ? `${count} ` : ''}
            <span className="group-open:hidden">show</span>
            <span className="hidden group-open:inline">hide</span>
          </span>
        </summary>
        <div className="px-4 pb-4 -mt-1">{children}</div>
      </details>
    </Card>
  )
}

// A numbered report section. scroll-mt keeps its heading clear of the sticky
// bar that just scrolled to it.
function Section({ id, n, title, note, children, action }) {
  return (
    <section id={`brief-${id}`} data-zone={id} className="scroll-mt-28">
      <Card className="p-0 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text leading-tight">
              {n != null && <span className="text-text-tertiary tabular-nums mr-2">{n}</span>}{title}
            </h2>
            {note && <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">{note}</p>}
          </div>
          {action}
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </Card>
    </section>
  )
}

// Long text, cut to a few lines with a way to read the rest. A lead's
// suggested action can run to a paragraph, and five of those made the lead
// table a wall a salesperson scrolls past instead of scanning.
function Clamp({ text, lines = 4 }) {
  const [open, setOpen] = useState(false)
  if (!text) return <span className="text-text-tertiary">—</span>
  const long = text.length > 220
  return (
    <span>
      <span className={!open && long ? (lines === 3 ? 'line-clamp-3' : 'line-clamp-4') : ''}>{text}</span>
      {long && (
        <button onClick={() => setOpen(o => !o)} className="text-[10px] text-text-tertiary underline underline-offset-2 hover:text-text mt-0.5">
          {open ? 'less' : 'more'}
        </button>
      )}
    </span>
  )
}

const Quiet = ({ children }) => <p className="text-xs text-text-tertiary leading-relaxed">{children}</p>

// ─── Sticky bar: who is reading, and where to jump ─────────────────────────

function ReaderBar({ team, onTeam, lines = [], line = 'all', onLine, untagged = 0, sections, active, onJump }) {
  return (
    <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-surface-muted/95 backdrop-blur border-b border-border space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Reading as</span>
        <div className="flex gap-1 flex-wrap">
          {TEAMS.map(t => (
            <button key={t.key} onClick={() => onTeam(t.key)} aria-pressed={team === t.key}
              className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                team === t.key ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-text-secondary border-border hover:text-text'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* Only when the run actually found more than one line. A brand with one
          undivided business should never see a control that does nothing. */}
      {lines.length > 1 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Business</span>
          <div className="flex gap-1 flex-wrap">
            {[{ key: 'all', label: 'Everything' }, ...lines].map(l => (
              <button key={l.key} onClick={() => onLine?.(l.key)} aria-pressed={line === l.key}
                className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-colors ${
                  line === l.key ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-text-secondary border-border hover:text-text'}`}>
                {l.label}
              </button>
            ))}
          </div>
          {line !== 'all' && untagged > 0 && (
            <span className="text-[10px] text-text-tertiary">
              {untagged} finding{untagged === 1 ? '' : 's'} could not be tied to a business and show under Everything only.
            </span>
          )}
        </div>
      )}
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map(z => (
          <button key={z.key} onClick={() => onJump(z.key)}
            className={`shrink-0 px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
              active === z.key ? 'bg-white text-text shadow-sm' : 'text-text-tertiary hover:text-text hover:bg-white/70'}`}>
            {z.label}
            {z.count != null && <span className="ml-1 tabular-nums text-text-tertiary">{z.count}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Sections ──────────────────────────────────────────────────────────────

function TopThree({ top }) {
  if (!top.items.length) return <Quiet>Nothing new rose above the rest this week.</Quiet>
  return (
    <ol className="space-y-3">
      {top.items.map((t, i) => (
        <li key={i} className="flex gap-3">
          <span className="shrink-0 w-6 h-6 rounded-full bg-amber-700 text-white text-xs font-bold flex items-center justify-center tabular-nums">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-text leading-snug">{t.finding}</p>
              <TeamChip team={t.team} />
            </div>
            {t.action && (
              <p className="text-xs text-text-secondary mt-1.5 leading-relaxed"><span className="font-semibold">Action: </span>{t.action}</p>
            )}
            {/* A piece that IS the finding would repeat the headline above it
                word for word — only its source is worth showing then. */}
            {t.pieces.some(p => p.summary !== t.finding) && (
              <ul className="mt-2 space-y-1">{t.pieces.filter(p => p.summary !== t.finding).map((p, j) => <Piece key={j} p={p} />)}</ul>
            )}
            {t.pieces.filter(p => p.summary === t.finding && p.url).map((p, j) => (
              <a key={`s${j}`} href={p.url} target="_blank" rel="noopener noreferrer"
                className="inline-block max-w-full truncate mt-1.5 mr-1.5 text-[10px] px-1.5 py-0.5 rounded border border-border text-text-tertiary hover:text-text">
                {domainOf(p.url)}
              </a>
            ))}
          </div>
        </li>
      ))}
    </ol>
  )
}

function SalesTable({ rows, canEdit, onStatus, busyId }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:-mx-5">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
            <th className="font-semibold py-2 pl-4 sm:pl-5 pr-3 w-[26%]">Lead / tender / project</th>
            <th className="font-semibold py-2 pr-3 w-[24%]">Details</th>
            <th className="font-semibold py-2 pr-3 w-[13%]">Window closes</th>
            <th className="font-semibold py-2 pr-3 w-[25%]">Suggested action</th>
            <th className="font-semibold py-2 pr-4 sm:pr-5 w-[14%]">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || `f${i}`} className="border-b border-border last:border-0 align-top">
              <td className="py-3 pl-4 sm:pl-5 pr-3">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Chip>{r.type}</Chip><RelevanceChip value={r.relevance} /><NewChip isNew={r.isNew} changed={r.changed} />
                </div>
                <p className="text-[13px] font-semibold text-text leading-snug">{r.name}</p>
                {r.headline && r.headline !== r.name && <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed"><Clamp text={r.headline} lines={3} /></p>}
                {r.changed && <p className="text-[11px] text-blue-700 mt-1">Changed: {r.changed}</p>}
              </td>
              <td className="py-3 pr-3 text-text-secondary leading-relaxed">
                {r.details.length ? r.details.map((d, j) => <div key={j}>{d}</div>) : <span className="text-text-tertiary">—</span>}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block mt-1 text-[10px] text-text-tertiary underline underline-offset-2 hover:text-text">
                    {domainOf(r.url)}
                  </a>
                )}
              </td>
              {/* A published date when one exists, and otherwise the window
                  the stage implies — labelled as an estimate. Every row in the
                  15 Sep report read "unconfirmed", which is honest and
                  unsortable. */}
              <td className="py-3 pr-3">
                <p className={`font-semibold tabular-nums ${r.days != null && r.days >= 0 && r.days <= 7 ? 'text-red-700' : r.days != null && r.days < 0 ? 'text-text-tertiary' : 'text-text'}`}>
                  {r.deadline ? fmtDate(r.deadline) : ''}
                </p>
                <p className="text-[10px] text-text-secondary leading-relaxed">{r.window.label}</p>
                {r.window.basis === 'stage' && <p className="text-[10px] text-text-tertiary">estimated from stage</p>}
              </td>
              <td className="py-3 pr-3 text-text-secondary leading-relaxed"><Clamp text={r.action} /></td>
              <td className="py-3 pr-4 sm:pr-5">
                {r.tracked && canEdit ? (
                  <PillSelect value={r.status} onChange={e => onStatus(r, e.target.value)} className="w-full">
                    {OPPORTUNITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </PillSelect>
                ) : (
                  <span className="text-[10px] text-text-tertiary leading-relaxed block">
                    {r.tracked ? r.status : 'Tracked from the next run'}
                  </span>
                )}
                {busyId === r.id && <p className="text-[10px] text-text-tertiary mt-1">Saving…</p>}
                {r.firstSeen && <p className="text-[10px] text-text-tertiary mt-1">since {fmtDate(r.firstSeen)}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CompetitorMove({ m }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold text-text">{m.competitor}</p>
        <div className="flex gap-1 flex-wrap">
          <RelevanceChip value={m.relevance} />
          {/* Significance and freshness are two questions, and one chip
              answering both is the reason every move read "medium". */}
          {m.freshness && <Chip>{freshnessLabel(m.freshness)}</Chip>}
          {m.channels.map(c => <Chip key={c}>{CHANNEL_LABEL[c] || c}</Chip>)}
        </div>
      </div>
      {m.whatChanged && <p className="text-[13px] text-text mt-2 leading-snug">{m.whatChanged}</p>}
      {m.picture && (
        <p className="text-xs text-text-secondary mt-2 leading-relaxed"><span className="font-semibold">The picture: </span>{m.picture}</p>
      )}
      {m.effect && (
        <p className="text-xs text-text-secondary mt-2 leading-relaxed"><span className="font-semibold">For us: </span>{m.effect}</p>
      )}
      {m.pieces.length > 0 && (
        <details className="mt-2 group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[11px] text-text-tertiary hover:text-text">
            <span className="group-open:hidden">Built from {m.pieces.length} piece{m.pieces.length === 1 ? '' : 's'} — show</span>
            <span className="hidden group-open:inline">Hide the pieces</span>
          </summary>
          <ul className="mt-2 space-y-1.5">{m.pieces.map((p, i) => <Piece key={i} p={p} />)}</ul>
        </details>
      )}
    </div>
  )
}

/** "Best: a carousel post" — never "Best: untitled", which is a null on screen. */
function bestLine(p) {
  if (!p.best_post) return p.weak ? 'Thin sample' : 'Measured'
  const named = String(p.best_post.topic || '').trim() ||
    (p.best_post.format ? `a ${p.best_post.format} post` : '')
  return `Best: ${named || 'one post'} · ${p.best_post.engagement} interactions`
}

function OurChannel({ p }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-text">
          {p.label}{p.username && <span className="font-normal text-text-tertiary"> @{p.username}</span>}
        </p>
        <p className="text-[11px] text-text-tertiary mt-0.5 truncate">
          {p.state === 'measured' ? bestLine(p) : p.note}
        </p>
      </div>
      {p.state === 'measured' && (
        <div className="text-right shrink-0 tabular-nums">
          <p className="text-xs font-semibold text-text">{p.posts} posts · {p.avg_engagement ?? '—'}/post</p>
          <p className={`text-[10px] ${p.change ? (p.change.direction === 'up' ? 'text-emerald-600' : 'text-red-600') : 'text-text-tertiary'}`}>
            {p.change ? `${p.change.direction === 'up' ? '+' : '−'}${p.change.change_pct}% vs prior` : p.weak ? 'thin sample' : 'no comparison yet'}
          </p>
        </div>
      )}
    </div>
  )
}

// One table for all three bands. A recent event swaps the exhibitor-deadline
// column for what came of it, because a deadline that passed is not what a
// reader of a finished expo needs — who showed what, and what was announced, is.
function EventsTable({ rows, canEdit, onDecision, recent = false }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:-mx-5">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
            <th className="font-semibold py-2 pl-4 sm:pl-5 pr-3 w-[25%]">Event</th>
            <th className="font-semibold py-2 pr-3 w-[12%]">Dates</th>
            <th className="font-semibold py-2 pr-3 w-[14%]">Venue</th>
            {!recent && <th className="font-semibold py-2 pr-3 w-[11%]">Exhibitor deadline</th>}
            <th className="font-semibold py-2 pr-3 w-[12%]">{recent ? 'Competitors there' : 'Competitors going'}</th>
            <th className={`font-semibold py-2 pr-4 sm:pr-5 ${recent ? 'w-[37%]' : 'w-[26%]'}`}>{recent ? 'What came of it' : 'Recommendation'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e.id || `${e.kind}${i}`} className="border-b border-border last:border-0 align-top">
              <td className="py-3 pl-4 sm:pl-5 pr-3">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Chip>{e.kind === 'calendar' ? 'calendar' : 'event'}</Chip>
                  <NewChip isNew={e.isNew} changed={e.changed} />
                </div>
                {e.url
                  ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-text leading-snug hover:underline">{e.name}</a>
                  : <p className="text-[13px] font-semibold text-text leading-snug">{e.name}</p>}
                {e.organizer && <p className="text-[10px] text-text-tertiary mt-0.5">{e.organizer}</p>}
              </td>
              <td className="py-3 pr-3 tabular-nums text-text">
                {e.start ? `${fmtDate(e.start)}${e.end && e.end !== e.start ? ` – ${fmtDate(e.end)}` : ''}` : 'TBC'}
              </td>
              <td className="py-3 pr-3 text-text-secondary">{e.venue || '—'}</td>
              {/* The deadline's STATUS, on every row, every week: open, closed,
                  or never established. A reader deciding whether to exhibit
                  needs today's position, not the diff against last week. */}
              {!recent && <td className="py-3 pr-3">
                {e.exhibitorDeadline ? (
                  <>
                    <p className={`font-semibold tabular-nums ${e.deadlineDays != null && e.deadlineDays >= 0 && e.deadlineDays <= 14 ? 'text-red-700' : 'text-text'}`}>{fmtDate(e.exhibitorDeadline)}</p>
                    <p className="text-[10px] text-text-tertiary">{e.deadlineStatus}</p>
                  </>
                ) : <span className="text-text-tertiary text-[11px]">{e.deadlineStatus || 'not established'}</span>}
              </td>}
              <td className="py-3 pr-3 text-text-secondary">{e.competitors.length ? e.competitors.join(', ') : '—'}</td>
              <td className="py-3 pr-4 sm:pr-5 text-text-secondary leading-relaxed">
                <Clamp text={recent ? e.takeaway || e.recommendation : e.recommendation} />
                {recent && e.takeaway && e.recommendation && (
                  <p className="text-[11px] text-text-tertiary mt-1.5"><span className="font-semibold">For us: </span>{e.recommendation}</p>
                )}
                {e.id && canEdit && !recent && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[10px] text-text-tertiary">We are</span>
                    <PillSelect value={e.decision} onChange={ev => onDecision(e, ev.target.value)}>
                      {EVENT_DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                    </PillSelect>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// A search row. The line chip is rendered only when the brand has configured
// business lines and this row matched one — an unclassified row shows nothing
// rather than a "General" chip, which would read as a decision nobody made.
function SearchRow({ r, lineLabel }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-text leading-snug" dir="auto">{r.headline}</p>
        {r.line && lineLabel(r.line) && (
          <span className="text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded bg-surface-muted text-text-tertiary uppercase tracking-wide">
            {lineLabel(r.line)}
          </span>
        )}
      </div>
      {r.detail && <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{r.detail}</p>}
      {r.action && <p className="text-xs text-text-secondary mt-2 leading-relaxed"><span className="font-semibold">Do: </span>{r.action}</p>}
    </div>
  )
}

function Note({ n, now }) {
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-text leading-snug">{n.headline}</p>
        {n.days != null && n.days >= 0 && (
          <span className="text-[11px] font-semibold shrink-0 tabular-nums whitespace-nowrap">{deadlineLabel({ perishable_until: dateIn(n.days, now) }, now)}</span>
        )}
      </div>
      {n.detail && <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{n.detail}</p>}
      {n.action && <p className="text-xs text-text-secondary mt-2 leading-relaxed"><span className="font-semibold">Marketing: </span>{n.action}</p>}
      {n.technicalNote && <p className="text-xs text-text-secondary mt-1.5 leading-relaxed"><span className="font-semibold">Technical: </span>{n.technicalNote}</p>}
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        {n.teams.map(t => <TeamChip key={t} team={t} />)}
        <RelevanceChip value={n.relevance} />
        {n.confidence != null && <span className="text-[10px] text-text-tertiary">confidence {pct(n.confidence)}</span>}
        {n.store?.state === 'seen' && <span className="text-[10px] text-text-tertiary">· already known</span>}
      </div>
      <Sources sources={n.sources} uncited={n.uncited} />
    </div>
  )
}

const dateIn = (days, now) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)

function IdeaCard({ idea, under = false }) {
  const ref = idea.answers_ref
  return (
    <div className={`rounded-xl border border-border bg-white p-3 ${under ? 'ml-3 border-l-2 border-l-sage-400' : ''}`}>
      <p className="text-xs font-semibold text-text">
        {!under && idea.n ? <span className="tabular-nums">{idea.n}. </span> : null}{idea.title || idea.angle}
      </p>
      {idea.angle && idea.title && <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{idea.angle}</p>}
      {!under && ref?.kind === 'finding' && ref.headline && (
        <p className="text-[11px] text-sage-700 mt-2 leading-relaxed"><span className="font-semibold">Based on: </span>{ref.headline}</p>
      )}
      {idea.rationale && <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">{idea.rationale}</p>}
      {idea.suggested_format && <p className="text-[10px] text-text-tertiary mt-1.5">{idea.suggested_format}</p>}
    </div>
  )
}

function GapBlock({ block }) {
  const { gap, ideas } = block
  return (
    <div className="rounded-xl border border-border bg-white p-3.5">
      {/* Numbered across both lists — see marketingRecommendations. An
          unnumbered recommendation reads as an afterthought. */}
      <p className="text-sm text-text leading-snug">
        {block.n ? <span className="font-semibold tabular-nums">{block.n}. </span> : null}{gap.gap}
      </p>
      {gap.our_position && <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed"><span className="font-semibold">Us: </span>{gap.our_position}</p>}
      {gap.suggested_response && <p className="text-xs text-text-secondary mt-2 leading-relaxed"><span className="font-semibold">Response: </span>{gap.suggested_response}</p>}
      {gap.basis && <p className="text-[10px] text-text-tertiary mt-2 uppercase tracking-wide">based on: {basisLabel(gap.basis) || gap.basis}</p>}
      {ideas.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Content that closes it</p>
          {ideas.map((idea, i) => <IdeaCard key={i} idea={idea} under />)}
        </div>
      )}
    </div>
  )
}

// ─── The tab ───────────────────────────────────────────────────────────────

export function ResearchTab({ run, runs, lensRows, selectedId, onSelectRun, onRun, running, now }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const report = useMemo(() => run?.report || {}, [run])

  const [team, setTeam] = useState(() => {
    try { return localStorage.getItem('research.team') || 'all' } catch { return 'all' }
  })
  const chooseTeam = useCallback(t => {
    setTeam(t)
    try { localStorage.setItem('research.team', t) } catch { /* private window */ }
  }, [])
  // Remembered per reader, like the team. Someone who works in controls opens
  // this page in controls every week.
  const [line, setLine] = useState(() => {
    try { return localStorage.getItem('research.line') || 'all' } catch { return 'all' }
  })
  const chooseLine = useCallback(l => {
    setLine(l)
    try { localStorage.setItem('research.line', l) } catch { /* private window */ }
  }, [])

  // The store and the watchlist. Loaded here rather than by the page because
  // only this tab reads them. Until they land, the two sections that depend
  // on them show a skeleton — never "no leads", which would be a false claim
  // about the market made from a request still in flight.
  const [intel, setIntel] = useState({ signals: [], opportunities: [], events: [], available: false })
  const [agendaCompetitors, setAgendaCompetitors] = useState([])
  const [storeLoaded, setStoreLoaded] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [saveNote, setSaveNote] = useState('')

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let alive = true
    Promise.all([fetchIntel(activeWorkspaceId, accessToken), fetchAgenda(activeWorkspaceId, accessToken)])
      .then(([i, a]) => {
        if (!alive) return
        setIntel(i)
        setAgendaCompetitors(a?.competitors || [])
        setStoreLoaded(true)
      })
      .catch(() => { if (alive) setStoreLoaded(true) })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, run?.id, run?.status])

  const top = useMemo(() => topThree(report, now), [report, now])
  const sales = useMemo(
    () => salesRows({ report, opportunities: intel.opportunities, runId: run?.id, now }),
    [report, intel.opportunities, run?.id, now],
  )
  const moves = useMemo(() => competitorMoves(report), [report])
  // Only the rivals still being watched. Passed explicitly rather than read
  // inside the selector, so a failed agenda load reads as "no filter" instead
  // of blanking the section.
  const watching = useMemo(
    () => (agendaCompetitors.length ? agendaCompetitors.filter(c => c.status !== 'retired').map(c => c.subject) : null),
    [agendaCompetitors])
  const social = useMemo(
    () => socialActivity({ report, signals: intel.signals, watching, now }),
    [report, intel.signals, watching, now])
  const events = useMemo(() => eventsView({ report, events: intel.events, runId: run?.id, now }), [report, intel.events, run?.id, now])
  const notes = useMemo(() => marketNotes(report, now), [report, now])
  const search = useMemo(() => searchDemand(report), [report])
  // The second axis. Built from the run, so a brand with one undivided
  // business never sees a control that does nothing.
  const lines = useMemo(() => linesIn(report), [report])
  // How much of the run carries no line at all. Shown rather than swallowed:
  // an untagged item appears only under "Everything", so without this a reader
  // switching to Controls sees sections empty out and reasonably concludes the
  // page is broken. It is not — it is telling the truth about what we know.
  const untagged = useMemo(
    () => (report.findings || []).filter(f => !String(f?.line || '').trim()).length,
    [report])
  // Labels come from the run's own byLine roll-up, so the page never has to
  // know what a brand's business lines are called.
  const lineLabel = useCallback(
    key => search.byLine.find(l => l.key === key)?.label || '',
    [search.byLine])
  const plan = useMemo(() => marketingRecommendations(report), [report])
  const candidates = useMemo(() => newCompetitors({ report, agendaCompetitors }), [report, agendaCompetitors])
  const sources = useMemo(() => sourceList(report), [report])
  const direction = useMemo(() => marketDirection(report), [report])
  const states = useMemo(() => lensStates(report), [report])
  // Across runs, not out of this one. An item raised three weeks running and
  // never closed is exactly what a per-run caveats list cannot show.
  const open = useMemo(() => openItems({ runs }), [runs])
  const empty = useMemo(() => emptiness(report), [report])
  const { passed } = useMemo(() => partitionByClock(report.findings || [], now), [report, now])
  const live = isLive(run)

  // Both axes, independently: a sales person in controls wants sales items
  // about controls. Sections written by the model carry refs rather than a
  // line, so the line is read back off the findings they cite.
  const visibleTop = top.items
    .filter(t => team === 'all' || t.team === team)
    .filter(t => matchesLine(line, linesOfRefs(t.refs, report)))
  const visibleMoves = moves.items
    .filter(m => forTeam(team, m.teams))
    .filter(m => matchesLine(line, linesOfRefs(m.refs, report)))
  // A lead carries its own line rather than refs, so it filters directly.
  // Memoised because the sections rail depends on it, and a fresh object every
  // render would rebuild that list on every keystroke elsewhere on the page.
  const visibleSales = useMemo(
    () => ({ ...sales, open: sales.open.filter(r => forLine(line, r.line)) }),
    [sales, line])
  const visibleNotes = notes
    .filter(n => forTeam(team, n.teams))
    .filter(n => matchesLine(line, linesOfRefs([n.ref].filter(Boolean), report)))

  const sections = useMemo(() => [
    { key: 'top', label: 'Top 3', count: visibleTop.length },
    { key: 'sales', label: 'Sales: act now', count: visibleSales.open.length },
    { key: 'competitors', label: 'Competitor moves', count: visibleMoves.length },
    { key: 'social', label: 'Social activity', count: social.theirs.length + social.ours.length },
    { key: 'events', label: 'Events', count: events.count + events.dates.length },
    { key: 'search', label: 'Search demand', count: search.opportunities.length + search.movers.length },
    { key: 'market', label: 'Market & technical', count: visibleNotes.length },
    { key: 'recs', label: 'Marketing recommendations', count: plan.blocks.length + plan.loose.length },
    { key: 'newcomp', label: 'New competitors', count: candidates.length },
    { key: 'sources', label: 'Sources', count: sources.length },
    { key: 'run', label: 'How this run went' },
    { key: 'watch', label: 'What it watches' },
  ].filter(s => ['run', 'watch'].includes(s.key) || sectionVisible(s.key, team)),
  [team, visibleTop, visibleSales, visibleMoves, social, events, search, visibleNotes, plan, candidates, sources])

  const [activeZone, setActiveZone] = useState('top')
  const rootRef = useRef(null)
  const active = sections.some(z => z.key === activeZone) ? activeZone : sections[0]?.key

  const jump = useCallback(key => {
    document.getElementById(`brief-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveZone(key)
  }, [])

  // Visibility is accumulated across callbacks — the observer reports only
  // what CHANGED — and the topmost visible section in document order wins.
  useEffect(() => {
    const nodes = [...(rootRef.current?.querySelectorAll('[data-zone]') || [])]
    if (!nodes.length || typeof IntersectionObserver === 'undefined') return undefined
    const seen = new Map()
    const io = new IntersectionObserver(entries => {
      for (const e of entries) seen.set(e.target, e.isIntersecting)
      const topNode = nodes.find(n => seen.get(n))
      if (topNode) setActiveZone(topNode.dataset.zone)
    }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 })
    nodes.forEach(n => io.observe(n))
    return () => io.disconnect()
  }, [run?.id, sections])

  const onStatus = useCallback(async (row, status) => {
    setBusyId(row.id); setSaveNote('')
    const prev = intel.opportunities
    setIntel(i => ({ ...i, opportunities: i.opportunities.map(o => (o.id === row.id ? { ...o, status } : o)) }))
    const out = await updateOpportunity(activeWorkspaceId, accessToken, row.id, { status })
    if (!out.ok) {
      setIntel(i => ({ ...i, opportunities: prev }))
      setSaveNote(`Could not save that status: ${out.error}`)
    }
    setBusyId(null)
  }, [intel.opportunities, activeWorkspaceId, accessToken])

  const onDecision = useCallback(async (row, decision) => {
    setSaveNote('')
    const prev = intel.events
    setIntel(i => ({ ...i, events: i.events.map(e => (e.id === row.id ? { ...e, decision } : e)) }))
    const out = await updateEventDecision(activeWorkspaceId, accessToken, row.id, decision)
    if (!out.ok) {
      setIntel(i => ({ ...i, events: prev }))
      setSaveNote(`Could not save that decision: ${out.error}`)
    }
  }, [intel.events, activeWorkspaceId, accessToken])

  const onCandidate = useCallback(async (c, status) => {
    if (!c.agendaId) return
    setBusyId(c.agendaId)
    const out = await setAgendaStatus(accessToken, c.agendaId, status)
    if (out?.error) setSaveNote(`Could not update ${c.name}: ${out.error}`)
    else setAgendaCompetitors(list => list.map(a => (a.id === c.agendaId ? { ...a, status } : a)))
    setBusyId(null)
  }, [accessToken])

  if (!runs.length) {
    return (
      <Empty
        title="No research has been run for this brand yet"
        description="A run looks for leads, events, competitor activity and market changes, and keeps what it finds so next week reports only what changed."
        action={<Button onClick={onRun} disabled={running}>Run research</Button>}
      />
    )
  }

  const counts = report.intel
  // Numbered in the order shown, so "3" is always the third section this
  // reader sees whichever team filter is on.
  const numbered = sections.filter(s => !['run', 'watch'].includes(s.key)).map(s => s.key)
  const num = key => (numbered.includes(key) ? numbered.indexOf(key) + 1 : null)

  return (
    <div ref={rootRef} className="space-y-4">
      {live && <RunProgress run={run} lensRows={lensRows} now={now} />}

      {runs.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-text-tertiary uppercase tracking-wide">Report</span>
          <PillSelect value={selectedId || runs[0].id} onChange={e => onSelectRun(e.target.value)}>
            {runs.map(r => (
              <option key={r.id} value={r.id}>
                {new Date(r.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                {' — '}
                {(r.error || r.report?.headline || r.status).slice(0, 70)}
              </option>
            ))}
          </PillSelect>
        </div>
      )}

      {/* ── Masthead ── */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] text-text-tertiary uppercase tracking-wide">
              Weekly market report · {fmtDate(report.period?.start)} – {fmtDate(report.period?.end)}
            </p>
            <p className="text-base font-semibold text-text mt-1.5 leading-snug">{run.error || report.headline || 'No headline.'}</p>
          </div>
          <Badge status={run.status === 'complete' ? 'completed' : run.status === 'failed' ? 'failed' : 'pending'} />
        </div>
        <p className="text-xs text-text-tertiary mt-3">
          {[
            lensHeadline(states),
            counts && `${counts.opportunities_new} new lead${counts.opportunities_new === 1 ? '' : 's'}` +
              `${counts.opportunities_changed ? `, ${counts.opportunities_changed} changed` : ''}`,
            counts && `${counts.signals_new} new signal${counts.signals_new === 1 ? '' : 's'} stored`,
            counts && counts.events_new ? `${counts.events_new} new event${counts.events_new === 1 ? '' : 's'}` : '',
          ].filter(Boolean).join(' · ')}
        </p>
      </Card>

      {empty.empty && <Card className="p-5"><p className="text-sm text-text-secondary leading-relaxed">{empty.reason}</p></Card>}
      {saveNote && <Card className="p-3 border-red-200 bg-red-50/50"><p className="text-xs text-red-700">{saveNote}</p></Card>}

      <ReaderBar team={team} onTeam={chooseTeam} lines={lines} line={line} onLine={chooseLine}
        untagged={untagged} sections={sections} active={active} onJump={jump} />

      {/* 1 ── Top 3 */}
      <Section id="top" n={num('top')} title="Top 3 this week"
        note={top.derived ? 'Chosen in code from this run\'s findings — this report predates the agent writing its own top three.' : 'What most needs doing, across every team. The finding, then the action.'}>
        <TopThree top={{ ...top, items: visibleTop }} />
      </Section>

      {/* 2 ── Sales: act now */}
      {sectionVisible('sales', team) && (
        <Section id="sales" n={num('sales')} title="Sales: act now"
          note={sales.trackerAvailable
            ? 'The lead tracker — every open lead across all runs, not only this week\'s. Set the status as you work them; the agent never changes it.'
            : 'Leads from this report. From the next run they are saved to a tracker and carried week to week with a status you set.'}>
          {!storeLoaded ? (
            <div className="space-y-2" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : visibleSales.open.length ? (
            <SalesTable rows={visibleSales.open} canEdit={intel.available} onStatus={onStatus} busyId={busyId} />
          ) : <Quiet>No open leads, tenders or projects.</Quiet>}
          {sales.closed.length > 0 && (
            <p className="text-[11px] text-text-tertiary mt-3">
              {sales.closed.length} closed out ({sales.closed.map(c => `${c.name} — ${c.status}`).join('; ')}).
            </p>
          )}
        </Section>
      )}

      {/* 3 ── Competitor moves */}
      <Section id="competitors" n={num('competitors')} title="Competitor moves"
        note={moves.derived
          ? 'Assembled from this report\'s competitor readings — it predates the agent combining signals across channels.'
          : 'What each competitor is doing, combined from small signals across their website, LinkedIn, job ads, social posts and the press — this week and earlier weeks.'}>
        {visibleMoves.length ? (
          <div className="grid gap-2.5 md:grid-cols-2">{visibleMoves.map((m, i) => <CompetitorMove key={i} m={m} />)}</div>
        ) : <Quiet>No competitor did anything new that was found this week.</Quiet>}
        {!direction.derived && direction.items.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Direction across the market</p>
            <ul className="space-y-2">
              {direction.items.map((d, i) => (
                <li key={i} className="text-xs text-text-secondary leading-relaxed">
                  {d.movement}{d.so_what && <span className="text-text-tertiary"> — {d.so_what}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* 4 ── Social activity */}
      {sectionVisible('social', team) && (
        <Section id="social" n={num('social')} title="Social activity"
          note="Our channels, measured from our own analytics on every platform we publish to — and what competitors are posting ABOUT, not how many follow them.">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Us</p>
              {social.ours.length ? social.ours.map(p => <OurChannel key={p.platform} p={p} />) : <Quiet>No channel data in this report.</Quiet>}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-1">Competitors</p>
              {social.theirs.length ? (
                <div className="space-y-3">
                  {social.theirs.map(g => (
                    <div key={g.competitor}>
                      <p className="text-xs font-semibold text-text">{g.competitor}</p>
                      <ul className="mt-1 space-y-1">
                        {g.items.map((it, i) => <Piece key={i} p={{ channel: it.platform, summary: it.text, url: it.url, date: it.date }} />)}
                      </ul>
                    </div>
                  ))}
                </div>
              ) : <Quiet>No competitor social posts were found.</Quiet>}
            </div>
          </div>
        </Section>
      )}

      {/* 5 ── Events */}
      {sectionVisible('events', team) && (
        <Section id="events" n={num('events')} title="Events and expos"
          note="Our own industry's shows, the expos where our buyers gather, and the conferences that shape what they ask for — plus the calendar dates marketing plans around.">
          {!storeLoaded ? (
            <div className="space-y-2" aria-busy="true"><Skeleton className="h-10 w-full" /></div>
          ) : events.count ? (
            <div className="space-y-5">
              <div>
                <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Next 90 days</p>
                {events.soon.length
                  ? <EventsTable rows={events.soon} canEdit={intel.available} onDecision={onDecision} />
                  : <Quiet>Nothing dated in the next 90 days.</Quiet>}
              </div>
              {events.later.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Later this year — book stands and deadlines now</p>
                  <EventsTable rows={events.later} canEdit={intel.available} onDecision={onDecision} />
                </div>
              )}
              {events.recent.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Recently — what happened</p>
                  <EventsTable rows={events.recent} recent />
                </div>
              )}
            </div>
          ) : <Quiet>No expo, conference or awards opening is on the books yet.</Quiet>}
          {/* Computed dates, kept out of the expo tables: a public holiday is
              not something anyone exhibits at, and listing it among the shows
              made an empty table look full. */}
          {events.dates.length > 0 && (
            <div className="mt-5">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">Dates in the calendar — not events to attend</p>
              <ul className="space-y-1.5">
                {events.dates.map((d, i) => (
                  <li key={i} className="text-xs text-text-secondary leading-relaxed">
                    <span className="font-semibold text-text tabular-nums">{fmtDate(d.start)}</span> · {d.name}
                    {d.recommendation && <span className="text-text-tertiary"> — {d.recommendation}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {/* 6 ── Search demand */}
      {sectionVisible('search', team) && (
        <Section id="search" n={num('search')} title="Search demand"
          note="What people typed on the way to our own site, measured by Google. Impressions and position, not clicks — at this volume a click count is too thin to read as movement.">
          {!search.present ? (
            <Quiet>
              This run had no search data. Either no Search Console property is configured for this brand, or the
              lens could not reach it — &ldquo;What was checked&rdquo; below says which.
            </Quiet>
          ) : (
            <div className="space-y-3">
              {search.note && <p className="text-sm text-text leading-snug" dir="auto">{search.note}</p>}
              {search.byLine.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {search.byLine.map(l => (
                    <span key={l.key || 'none'} className="text-[11px] px-2 py-1 rounded-md bg-surface-muted text-text-secondary">
                      {l.label}: <span className="tabular-nums font-semibold">{l.impressions}</span> impressions
                    </span>
                  ))}
                </div>
              )}
              {search.opportunities.length > 0 && (
                <div className="space-y-2.5">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Demand we are not converting</p>
                  {search.opportunities.map((r, i) => <SearchRow key={i} r={r} lineLabel={lineLabel} />)}
                </div>
              )}
              {search.movers.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">What moved</p>
                  {search.movers.map((r, i) => <SearchRow key={i} r={r} lineLabel={lineLabel} />)}
                </div>
              )}
              {!search.opportunities.length && !search.movers.length && (
                <Quiet>Nothing in the search data crossed the floor this period. That is a result, not a gap.</Quiet>
              )}
            </div>
          )}
        </Section>
      )}

      {/* 7 ── Market & technical */}
      {sectionVisible('market', team) && (
        <Section id="market" n={num('market')} title="Market and technical notes"
          note="Regulation, standards, technology and giga-project change. Each carries the marketing angle and what the technical team should check.">
          {visibleNotes.length ? (
            <div className="space-y-2.5">{visibleNotes.map((note, i) => <Note key={i} n={note} now={now} />)}</div>
          ) : <Quiet>No regulation, technology or giga-project change this week.</Quiet>}
        </Section>
      )}

      {/* 7 ── Marketing recommendations */}
      {sectionVisible('recs', team) && (
        <Section id="recs" n={num('recs')} title="Marketing recommendations"
          note={`Where the market and our position do not line up, and the content that answers it. Each names what it is based on. Rules are reviewed under What We Learned.${
            plan.overCap ? ` This run proposed ${plan.total}; the brief asks for two to four.` : ''}`}>
          {plan.blocks.length || plan.loose.length ? (
            <>
              <div className="space-y-3">{plan.blocks.map(block => <GapBlock key={block.gap.id} block={block} />)}</div>
              {plan.loose.length > 0 && (
                <div className="mt-3 space-y-2">
                  {plan.blocks.length > 0 && (
                    <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide pt-3 border-t border-border">Other ideas from this run</p>
                  )}
                  {plan.loose.map((idea, i) => <IdeaCard key={i} idea={idea} />)}
                </div>
              )}
              {plan.ideaCount > 0 && <SendIdeasToPlan ideas={plan.ordered} />}
              {(report.repeated_ideas || []).length > 0 && (
                <p className="text-[11px] text-text-tertiary mt-3">
                  {report.repeated_ideas.length} idea{report.repeated_ideas.length === 1 ? '' : 's'} dropped for repeating something already proposed.
                </p>
              )}
            </>
          ) : <Quiet>No recommendations this week.</Quiet>}
        </Section>
      )}

      {/* 8 ── New competitors */}
      {sectionVisible('newcomp', team) && (
        <Section id="newcomp" n={num('newcomp')} title="New competitors to review"
          note="Companies the agent found acting as competitors that are not on the watchlist. Accept adds one to the competitors it watches, from the next run; reject removes it and it is not suggested again.">
          {!storeLoaded ? <Skeleton className="h-10 w-full" /> : candidates.length ? (
            <ul className="divide-y divide-border">
              {candidates.map(c => (
                <li key={c.name} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text">
                      {c.name}{c.thisRun && <span className="ml-1.5"><Chip tone="bg-emerald-50 text-emerald-700 border-emerald-200">this week</Chip></span>}
                    </p>
                    {c.why && <p className="text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{c.why}</p>}
                    {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-tertiary underline underline-offset-2">{domainOf(c.url)}</a>}
                  </div>
                  {c.agendaId && c.status === 'proposed' ? (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" onClick={() => onCandidate(c, 'active')} disabled={busyId === c.agendaId}>Accept</Button>
                      <Button size="sm" variant="secondary" onClick={() => onCandidate(c, 'retired')} disabled={busyId === c.agendaId}>Reject</Button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-text-tertiary shrink-0">
                      {!c.agendaId ? 'added after the run saves' : c.status === 'active' ? 'on the watchlist' : c.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : <Quiet>No new competitors surfaced.</Quiet>}
        </Section>
      )}

      {/* 9 ── Sources */}
      <Section id="sources" n={num('sources')} title="Sources"
        note={`Every source this report cites, checked during the run of ${fmtDate(run.started_at)}. The refs say which items rest on each.`}>
        {sources.length ? (
          <ul className="space-y-1.5">
            {sources.map(s => (
              <li key={s.url} className="text-[11px] leading-relaxed flex gap-2">
                <span className="text-text-tertiary shrink-0 w-[130px] truncate">{s.domain}</span>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-text underline underline-offset-2 min-w-0 truncate">
                  {s.title || s.url}
                </a>
                {s.citedBy.length > 0 && <span className="text-text-tertiary shrink-0">{s.citedBy.join(', ')}</span>}
              </li>
            ))}
          </ul>
        ) : <Quiet>This report cites no web sources.</Quiet>}
      </Section>

      {/* ── How this run went ── */}
      <section id="brief-run" data-zone="run" className="scroll-mt-28 space-y-3">
        <h2 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide pt-2">How this run went</h2>
        {report.repetition && <Card className="p-3"><p className="text-xs text-amber-700">{report.repetition}</p></Card>}
        {runEffort(states) && (
          <Card className="p-3"><p className="text-xs text-text-secondary leading-relaxed">{runEffort(states)}.</p></Card>
        )}
        {states.length > 0 && (
          <Fold title="What was checked" subtitle="A lens that looked and found nothing is not the same as one that could not answer." count={states.length} open={states.some(s => s.state === 'failed' || s.state === 'searched')}>
            <div className="mt-3 space-y-1.5">
              {states.map(s => (
                <div key={s.key} className="flex items-baseline gap-3 text-xs">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 w-[130px] text-center ${LENS_STATE[s.state]?.tone || ''}`}>{LENS_STATE[s.state]?.label || s.state}</span>
                  <span className="text-text font-medium w-[120px] shrink-0">{s.label}</span>
                  <span className="text-text-tertiary truncate">{s.error || s.question}</span>
                </div>
              ))}
            </div>
          </Fold>
        )}
        {open.length > 0 && (
          <Fold title="Open items" subtitle="Raised by an earlier run and not closed. Only a person can mark one resolved." count={open.length} open>
            <ul className="mt-3 space-y-2">
              {open.map((item, i) => (
                <li key={i} className="text-xs text-text-secondary leading-relaxed">
                  {item.text}
                  <span className="text-text-tertiary">
                    {' '}· first raised {fmtDate(item.firstRaised)} · {item.runs} run{item.runs === 1 ? '' : 's'}
                    {item.thisRun ? '' : ' · not repeated this run'}
                  </span>
                </li>
              ))}
            </ul>
          </Fold>
        )}
        {(report.unanswered || []).length > 0 && (
          <Fold title="Could not answer" subtitle="A research agent that never admits a miss is one you cannot calibrate." count={report.unanswered.length}>
            <ul className="mt-3 space-y-2">{report.unanswered.map((u, i) => <li key={i} className="text-xs text-text-tertiary leading-relaxed">{u}</li>)}</ul>
          </Fold>
        )}
        {passed.length > 0 && (
          <Fold title="Deadlines that passed" subtitle="Kept rather than hidden — an expired window explains a miss." count={passed.length}>
            <div className="mt-3 space-y-1.5">
              {passed.map((f, i) => (
                <p key={i} className="text-xs text-text-tertiary"><span className="line-through">{f.headline}</span> · {deadlineLabel(f, now)} · {teamsOf(f).join(', ')}</p>
              ))}
            </div>
          </Fold>
        )}
        {!live && <RunProgress run={run} lensRows={lensRows} now={now} />}
      </section>

      {/* ── What it watches ── */}
      <section id="brief-watch" data-zone="watch" className="scroll-mt-28 space-y-3">
        <div className="pt-2">
          <h2 className="text-xs font-semibold text-text-tertiary uppercase tracking-wide">What it watches</h2>
          <p className="text-[11px] text-text-tertiary mt-0.5">Not part of this report — this is what the next one will look at.</p>
        </div>
        <AgentSteering />
      </section>
    </div>
  )
}
