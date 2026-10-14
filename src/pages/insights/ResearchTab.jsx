import { Link } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, Button, Empty, PillSelect, Skeleton } from '../../components/ui/index'
import { AgentSteering } from '../../components/AgentSteering'
import { SendIdeasToPlan } from '../../components/SendIdeasToPlan'
import { RunProgress } from '../../components/RunProgress'
import { useAuth } from '../../store/auth'
import {
  partitionByClock, deadlineLabel, lensStates, pct, marketDirection,
} from '../../lib/researchBrief'
import {
  TEAMS, sectionVisible, forTeam, topThree, salesRows, competitorMoves, movesByLine,
  globalView, lineView, socialActivity, eventsView,
  marketNotes, asNote, marketingRecommendations, newCompetitors, sourceList, domainOf, teamsOf,
  openItems, runFaults, freshnessLabel, searchDemand, linesIn, forLine, linesOfRefs, matchesLine,
} from '../../lib/marketReport'
import { fetchIntel, updateOpportunity, updateEventDecision } from '../../lib/marketIntel'
import { fetchAgenda, setAgendaStatus } from '../../lib/agentAgenda'
import { OPPORTUNITY_STATUSES, EVENT_DECISIONS } from '../../lib/agent/intel'
import { isLive } from '../../lib/agent/progress'
import { explainFacts } from '../../lib/agent/websiteExplain'
import { fetchWebsiteExplanation } from '../../lib/websiteSearch'
import { ageLabel, daysSinceRun } from '../../lib/learnedSummary'
import { ExplainPoints } from '../analytics/WebsiteDetail'
import {
  plainRunProblem, partRun, runStatus, TOPIC_STATE, readingLine, emptyReason, PRIORITY_LABEL, TEAM_LABEL,
} from './plainWords'

// ─── The Research tab — the weekly market report ───────────────────────────
// Read top to bottom, in the order a marketer asks the questions:
//
//   1. WHAT DID IT FIND?      one card: the headline, when, and whether the
//                             run worked — with counts that jump to the detail
//   2. WHAT DO I DO WITH IT?  the sections that carry an action: top
//                             priorities, leads, content ideas (send to a
//                             plan), competitor moves, events to decide on,
//                             new competitors to accept or reject
//   3. THE DETAIL, BY TOPIC   website, social, market news, global industry,
//                             smart poles, all sources — each folded shut
//   4. ABOUT THIS RESEARCH    how the run went, open questions, and what the
//                             research watches — folded, for whoever needs it
//
// A team filter and a business filter narrow every section at once. Every
// section is built by src/lib/marketReport.js, which the printable brief also
// uses, so the screen and the PDF never disagree about what the run said.
//
// Leads and events read the STORE rather than the brief — a lead found three
// weeks ago and still open belongs on this week's list — and say so.
//
// Follower counts appear nowhere. What competitors are doing is the point.

const fmtDate = iso => {
  if (!iso) return ''
  const d = new Date(String(iso).length === 10 ? `${iso}T00:00:00Z` : iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
const fmtLongDate = iso => {
  const t = Date.parse(iso || '')
  return Number.isFinite(t) ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const TEAM_TONE = {
  marketing: 'bg-sage-50 text-sage-700 border-sage-200',
  sales: 'bg-amber-50 text-amber-800 border-amber-200',
  technical: 'bg-surface-muted text-text border-border',
}
const RELEVANCE_TONE = {
  high: 'bg-red-50 text-red-700 border-red-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-surface-subtle text-text-secondary border-border',
}
const CHANNEL_LABEL = {
  website: 'Website', linkedin: 'LinkedIn', instagram: 'Instagram', tiktok: 'TikTok', x: 'X', youtube: 'YouTube',
  news: 'News', jobs: 'Job ads', tender_portal: 'Tenders', event_site: 'Event site', government: 'Government', other: 'Other',
}
const BASIS = { instagram: 'Instagram numbers', web: 'web research', our_analytics: 'our own analytics', calendar: 'the calendar' }
const LEAD_TYPE = { lead: 'Lead', tender: 'Tender', project: 'Project' }

function Chip({ children, tone = 'bg-surface-subtle text-text-secondary border-border', title }) {
  return (
    <span title={title} className={`inline-flex items-center max-w-full truncate px-1.5 py-0.5 border text-[10px] font-semibold whitespace-nowrap ${tone}`}>
      {children}
    </span>
  )
}

const TeamChip = ({ team }) => (team ? <Chip tone={TEAM_TONE[team]}>{TEAM_LABEL[team] || team}</Chip> : null)
const RelevanceChip = ({ value }) => (value ? <Chip tone={RELEVANCE_TONE[value]}>{PRIORITY_LABEL[value] || value}</Chip> : null)

function NewChip({ isNew, changed }) {
  if (changed) return <Chip tone="bg-sky-50 text-sky-700 border-sky-200" title={changed}>Updated</Chip>
  if (isNew) return <Chip tone="bg-sage-50 text-sage-700 border-sage-200">New</Chip>
  return null
}

/** A labelled line inside a card: "What to do: …". */
function Line({ label, children, strong = false }) {
  if (!children) return null
  return (
    <p className={`text-xs leading-relaxed mt-2 ${strong ? 'text-text' : 'text-text-secondary'}`}>
      <span className="font-semibold text-text">{label}: </span>{children}
    </p>
  )
}

// ── Sources, one click away ──
// Behind a toggle so a card reads as a finding and an action, not a list of
// links. Native <details>: survives re-render, works with find-in-page, and is
// keyboard accessible. An uncited finding says so in the open, because that is
// a fact about the finding rather than one of its sources.
function SourcesToggle({ sources = [], pieces = [], uncited = false }) {
  const links = sources.slice(0, 8)
  const count = pieces.length || links.length
  if (uncited) {
    return <p className="text-[11px] text-amber-700 mt-2">No source could be confirmed for this one — treat it as an observation.</p>
  }
  if (!count) return null
  return (
    <details className="mt-2.5 group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden inline-flex items-center gap-1 text-[11px] font-medium text-text-tertiary hover:text-text">
        <span className="inline-block transition-transform group-open:rotate-90">›</span>
        Sources ({count})
      </summary>
      {pieces.length ? (
        <ul className="mt-2 space-y-1.5">{pieces.map((p, i) => <Piece key={i} p={p} />)}</ul>
      ) : (
        <ul className="mt-2 space-y-1">
          {links.map((s, i) => {
            const url = typeof s === 'string' ? s : s.url
            const title = typeof s === 'string' ? '' : (s.title || '')
            return (
              <li key={i} className="text-[11px] leading-relaxed min-w-0">
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-text-secondary underline underline-offset-2 hover:text-text break-words">
                  {title || domainOf(url)}
                </a>
                {title && <span className="text-text-tertiary"> · {domainOf(url)}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </details>
  )
}

// One small piece of evidence behind a combined claim: where it was seen, and
// a link to it.
function Piece({ p }) {
  return (
    <li className="flex items-start gap-2 text-[11px] leading-relaxed min-w-0">
      <span className="shrink-0 mt-px max-w-[40%]"><Chip>{CHANNEL_LABEL[p.channel] || p.channel || 'Source'}</Chip></span>
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

const Quiet = ({ children }) => <p className="text-xs text-text-tertiary leading-relaxed max-w-3xl">{children}</p>

const CountBadge = ({ n }) => (n != null
  ? <span className="ml-2 inline-flex items-center justify-center min-w-[20px] px-1.5 py-px bg-surface-muted text-text-secondary text-[10px] font-semibold tabular-nums align-[1px]">{n}</span>
  : null)

// ── The three layers of the page ──

/** A group heading: "What to do next", "Everything it found, by topic". */
function Group({ title, helper }) {
  return (
    <div className="pt-4">
      <h2 className="text-[15px] font-bold text-text tracking-tight">{title}</h2>
      {helper && <p className="text-xs text-text-secondary mt-1 leading-relaxed max-w-3xl">{helper}</p>}
    </div>
  )
}

/** An action section: always open, a heading, a one-line explanation, then the items. */
function Section({ id, title, helper, count, action, children }) {
  return (
    <section id={`brief-${id}`} data-zone={id} className="scroll-mt-32">
      <Card className="p-0 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-border">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-text leading-tight">{title}<CountBadge n={count} /></h3>
            {helper && <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed max-w-3xl">{helper}</p>}
          </div>
          {action}
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </Card>
    </section>
  )
}

/** A topic of detail: folded shut until someone opens it, or jumps to it. */
function Fold({ id, title, helper, count, open = false, children }) {
  return (
    <section id={`brief-${id}`} data-zone={id} data-fold className="scroll-mt-32">
      <Card className="p-0 overflow-hidden">
        <details open={open} className="group">
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-surface-subtle">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text leading-tight">{title}<CountBadge n={count} /></h3>
              {helper && <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed max-w-3xl">{helper}</p>}
            </div>
            <span className="shrink-0 text-[11px] font-medium text-text-tertiary mt-0.5">
              <span className="group-open:hidden">Show</span>
              <span className="hidden group-open:inline">Hide</span>
            </span>
          </summary>
          <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-border">{children}</div>
        </details>
      </Card>
    </section>
  )
}

// Long text, cut to a few lines with a way to read the rest.
function Clamp({ text, lines = 4 }) {
  const [open, setOpen] = useState(false)
  if (!text) return <span className="text-text-tertiary">—</span>
  const long = text.length > 220
  return (
    <span>
      <span className={!open && long ? (lines === 3 ? 'line-clamp-3' : 'line-clamp-4') : ''}>{text}</span>
      {long && (
        <button onClick={() => setOpen(o => !o)} className="text-[10px] text-text-tertiary underline underline-offset-2 hover:text-text mt-0.5">
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </span>
  )
}

const Sub = ({ children }) => <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mb-2">{children}</p>

// ─── Sticky bar: who is reading, and where to jump ─────────────────────────

function Pills({ options, value, onChange }) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(o => (
        <button key={o.key} onClick={() => onChange(o.key)} aria-pressed={value === o.key}
          className={`px-2.5 py-1 text-xs font-semibold border transition-colors ${
            value === o.key ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-text-secondary border-border hover:text-text'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ReaderBar({ team, onTeam, lines = [], line = 'all', onLine, untagged = 0, sections, active, onJump }) {
  const groups = [
    { key: 'act', label: 'Do next' },
    { key: 'detail', label: 'Detail' },
    { key: 'about', label: '' },
  ]
  return (
    <div data-print-hide className="sticky top-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-surface-muted/95 backdrop-blur border-b border-border space-y-2">
      <div className="flex items-center gap-x-4 gap-y-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Show items for</span>
          <Pills options={TEAMS} value={team} onChange={onTeam} />
        </div>
        {/* Only when the run found more than one business line. A brand with
            one undivided business never sees a control that does nothing. */}
        {lines.length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">Business</span>
            <Pills options={[{ key: 'all', label: 'All' }, ...lines]} value={line} onChange={k => onLine?.(k)} />
          </div>
        )}
      </div>
      {line !== 'all' && untagged > 0 && (
        <p className="text-[10px] text-text-tertiary">
          {plural(untagged, 'finding')} could not be tied to one business and only show under All.
        </p>
      )}
      <nav aria-label="Jump to a section" className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {groups.map(g => {
          const items = sections.filter(s => s.group === g.key)
          if (!items.length) return null
          return (
            <div key={g.key} className="flex items-center gap-1 shrink-0">
              {g.key !== 'act' && <span aria-hidden="true" className="w-px h-4 bg-border mx-1" />}
              {g.label && <span className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide mr-0.5">{g.label}</span>}
              {items.map(z => (
                <button key={z.key} onClick={() => onJump(z.key)}
                  className={`shrink-0 px-2 py-1 text-[11px] font-medium transition-colors ${
                    active === z.key ? 'bg-white text-text shadow-sm' : 'text-text-tertiary hover:text-text hover:bg-white/70'}`}>
                  {z.label}
                  {z.count != null && <span className="ml-1 tabular-nums text-text-tertiary">{z.count}</span>}
                </button>
              ))}
            </div>
          )
        })}
      </nav>
    </div>
  )
}

// ─── Cards ─────────────────────────────────────────────────────────────────

function TopThree({ items }) {
  if (!items.length) return <Quiet>Nothing stood out above the rest this week for this team.</Quiet>
  return (
    <ol className="space-y-4">
      {items.map((t, i) => {
        // A piece that IS the finding would repeat the headline word for word —
        // only its link is worth keeping then.
        const pieces = t.pieces.filter(p => p.summary !== t.finding)
        const links = t.pieces.filter(p => p.summary === t.finding && p.url).map(p => ({ url: p.url }))
        return (
          <li key={i} className="flex gap-3">
            <span className="shrink-0 w-6 h-6 bg-amber-700 text-white text-xs font-bold flex items-center justify-center tabular-nums">{i + 1}</span>
            <div className="min-w-0 flex-1 max-w-3xl">
              <div className="flex items-center gap-1.5 flex-wrap mb-1"><TeamChip team={t.team} /></div>
              <p className="text-sm font-semibold text-text leading-snug">{t.finding}</p>
              <Line label="What to do" strong>{t.action}</Line>
              <SourcesToggle pieces={pieces} sources={pieces.length ? [] : links} />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function SalesTable({ rows, canEdit, onStatus, busyId }) {
  return (
    <div className="overflow-x-auto -mx-4 sm:-mx-5">
      <table className="w-full min-w-[760px] text-left text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
            <th className="font-semibold py-2 pl-4 sm:pl-5 pr-3 w-[26%]">Opening</th>
            <th className="font-semibold py-2 pr-3 w-[24%]">Details</th>
            <th className="font-semibold py-2 pr-3 w-[13%]">Deadline</th>
            <th className="font-semibold py-2 pr-3 w-[25%]">What to do</th>
            <th className="font-semibold py-2 pr-4 sm:pr-5 w-[14%]">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id || `f${i}`} className="border-b border-border last:border-0 align-top">
              <td className="py-3 pl-4 sm:pl-5 pr-3">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <Chip>{LEAD_TYPE[r.type] || r.type}</Chip><RelevanceChip value={r.relevance} /><NewChip isNew={r.isNew} changed={r.changed} />
                </div>
                <p className="text-[13px] font-semibold text-text leading-snug">{r.name}</p>
                {r.headline && r.headline !== r.name && <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed"><Clamp text={r.headline} lines={3} /></p>}
                {r.changed && <p className="text-[11px] text-sky-700 mt-1">Updated: {r.changed}</p>}
              </td>
              <td className="py-3 pr-3 text-text-secondary leading-relaxed">
                {r.details.length ? r.details.map((d, j) => <div key={j}>{d}</div>) : <span className="text-text-tertiary">—</span>}
                {r.url && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="block mt-1 text-[10px] text-text-tertiary underline underline-offset-2 hover:text-text">
                    Source: {domainOf(r.url)}
                  </a>
                )}
              </td>
              {/* A published date when one exists, and otherwise the window the
                  stage implies — labelled as an estimate. */}
              <td className="py-3 pr-3">
                <p className={`font-semibold tabular-nums ${r.days != null && r.days >= 0 && r.days <= 7 ? 'text-red-700' : r.days != null && r.days < 0 ? 'text-text-tertiary' : 'text-text'}`}>
                  {r.deadline ? fmtDate(r.deadline) : ''}
                </p>
                <p className="text-[10px] text-text-secondary leading-relaxed">{r.window.label}</p>
                {r.window.basis === 'stage' && <p className="text-[10px] text-text-tertiary">estimated, not published</p>}
              </td>
              <td className="py-3 pr-3 text-text-secondary leading-relaxed"><Clamp text={r.action} /></td>
              <td className="py-3 pr-4 sm:pr-5">
                {r.tracked && canEdit ? (
                  <PillSelect value={r.status} onChange={e => onStatus(r, e.target.value)} className="w-full">
                    {OPPORTUNITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </PillSelect>
                ) : (
                  <span className="text-[10px] text-text-tertiary leading-relaxed block">
                    {r.tracked ? r.status : 'Tracked from the next research'}
                  </span>
                )}
                {busyId && busyId === r.id && <p className="text-[10px] text-text-tertiary mt-1">Saving…</p>}
                {r.firstSeen && <p className="text-[10px] text-text-tertiary mt-1">First seen {fmtDate(r.firstSeen)}</p>}
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
    <div className="border border-border bg-white p-3.5 flex flex-col">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <p className="text-sm font-semibold text-text">{m.competitor}</p>
        <div className="flex gap-1 flex-wrap">
          <RelevanceChip value={m.relevance} />
          {m.freshness && m.freshness !== 'standing' && <Chip tone="bg-sage-50 text-sage-700 border-sage-200">{freshnessLabel(m.freshness)}</Chip>}
        </div>
      </div>
      {m.whatChanged && <p className="text-[13px] text-text mt-1.5 leading-snug">{m.whatChanged}</p>}
      {m.effect && (
        <p className="text-xs text-text mt-2.5 leading-relaxed bg-amber-50/60 border-l-2 border-amber-600 px-2.5 py-1.5">
          <span className="font-semibold">What it means for us: </span>{m.effect}
        </p>
      )}
      {m.picture && <Line label="Why we think so">{m.picture}</Line>}
      {(m.channels.length > 0 || m.freshness === 'standing') && (
        <p className="text-[10px] text-text-tertiary mt-2">
          {[m.channels.length ? `Seen on ${m.channels.map(c => CHANNEL_LABEL[c] || c).join(', ')}` : '',
            m.freshness === 'standing' ? 'nothing new this week' : ''].filter(Boolean).join(' · ')}
        </p>
      )}
      <SourcesToggle pieces={m.pieces} />
    </div>
  )
}

/** "Best: a carousel post" — never "Best: untitled". */
function bestLine(p) {
  if (!p.best_post) return p.weak ? 'Too few posts to judge' : 'Measured'
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
          <p className="text-xs font-semibold text-text">{plural(p.posts, 'post')} · {p.avg_engagement ?? '—'} interactions each</p>
          <p className={`text-[10px] ${p.change ? (p.change.direction === 'up' ? 'text-sage-600' : 'text-red-600') : 'text-text-tertiary'}`}>
            {p.change ? `${p.change.direction === 'up' ? '+' : '−'}${p.change.change_pct}% vs before` : p.weak ? 'too few to compare' : 'no comparison yet'}
          </p>
        </div>
      )}
    </div>
  )
}

// One table for all three bands. A past event swaps the exhibitor-deadline
// column for what came of it.
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
            <th className={`font-semibold py-2 pr-4 sm:pr-5 ${recent ? 'w-[37%]' : 'w-[26%]'}`}>{recent ? 'What came of it' : 'Our recommendation'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e, i) => (
            <tr key={e.id || `${e.kind}${i}`} className="border-b border-border last:border-0 align-top">
              <td className="py-3 pl-4 sm:pl-5 pr-3">
                <div className="flex items-center gap-1.5 flex-wrap mb-1">
                  <NewChip isNew={e.isNew} changed={e.changed} />
                </div>
                {e.url
                  ? <a href={e.url} target="_blank" rel="noopener noreferrer" className="text-[13px] font-semibold text-text leading-snug hover:underline">{e.name}</a>
                  : <p className="text-[13px] font-semibold text-text leading-snug">{e.name}</p>}
                {e.organizer && <p className="text-[10px] text-text-tertiary mt-0.5">{e.organizer}</p>}
              </td>
              <td className="py-3 pr-3 tabular-nums text-text">
                {e.start ? `${fmtDate(e.start)}${e.end && e.end !== e.start ? ` – ${fmtDate(e.end)}` : ''}` : 'To be confirmed'}
              </td>
              <td className="py-3 pr-3 text-text-secondary">{e.venue || '—'}</td>
              {!recent && <td className="py-3 pr-3">
                {e.exhibitorDeadline ? (
                  <>
                    <p className={`font-semibold tabular-nums ${e.deadlineDays != null && e.deadlineDays >= 0 && e.deadlineDays <= 14 ? 'text-red-700' : 'text-text'}`}>{fmtDate(e.exhibitorDeadline)}</p>
                    <p className="text-[10px] text-text-tertiary">{e.deadlineStatus}</p>
                  </>
                ) : <span className="text-text-tertiary text-[11px]">{e.deadlineStatus || 'not known yet'}</span>}
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

// A search row. The business chip shows only when the row matched a business
// line — an unclassified row shows nothing rather than a made-up "General".
function SearchRow({ r, lineLabel }) {
  return (
    <div className="border border-border bg-white p-3.5 max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-text leading-snug" dir="auto">{r.headline}</p>
        {r.line && lineLabel(r.line) && <Chip>{lineLabel(r.line)}</Chip>}
      </div>
      {r.detail && <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{r.detail}</p>}
      <Line label="What to do">{r.action}</Line>
    </div>
  )
}

function WebsiteRead({ read }) {
  return (
    <div className="mb-4 space-y-3">
      <p className="text-sm text-text leading-relaxed max-w-3xl" dir="auto">{read.summary}</p>
      {read.numbers.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {read.numbers.map((x, i) => (
            <div key={i} className="border border-border bg-white p-3">
              <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide">{x.label}</p>
              <p className="text-lg font-semibold text-text tabular-nums mt-0.5">{x.value}</p>
              {x.meaning && <p className="text-[11px] text-text-secondary leading-snug mt-1">{x.meaning}</p>}
            </div>
          ))}
        </div>
      )}
      {read.suggestions.length > 0 && (
        <div className="max-w-3xl">
          <Sub>What to do</Sub>
          <ul className="space-y-1">
            {read.suggestions.map((t, i) => (
              <li key={i} className="text-xs text-text leading-relaxed before:content-['▸_'] before:text-amber-700" dir="auto">{t}</li>
            ))}
          </ul>
        </div>
      )}
      <Link to="/analytics?channel=website" className="inline-block text-[11px] text-text-secondary hover:text-text underline">
        See every website number on the Analytics page →
      </Link>
    </div>
  )
}

function Note({ n, now }) {
  return (
    <div className="border border-border bg-white p-3.5 max-w-3xl">
      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
        {n.teams.map(t => <TeamChip key={t} team={t} />)}
        <RelevanceChip value={n.relevance} />
        {n.store?.state === 'seen' && <Chip>Already known</Chip>}
        {n.days != null && n.days >= 0 && (
          <Chip tone="bg-white text-text border-border">{deadlineLabel({ perishable_until: dateIn(n.days, now) }, now)}</Chip>
        )}
      </div>
      <p className="text-sm text-text leading-snug">{n.headline}</p>
      {n.detail && <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{n.detail}</p>}
      <Line label="For marketing">{n.action}</Line>
      <Line label="For the technical team">{n.technicalNote}</Line>
      {n.confidence != null && <p className="text-[10px] text-text-tertiary mt-2">Confidence {pct(n.confidence)}</p>}
      <SourcesToggle sources={n.sources || []} uncited={n.uncited} />
    </div>
  )
}

const dateIn = (days, now) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)

function IdeaCard({ idea, under = false }) {
  const ref = idea.answers_ref
  return (
    <div className={`border border-border bg-white p-3 ${under ? 'border-l-2 border-l-sage-400' : ''}`}>
      <p className="text-xs font-semibold text-text">
        {!under && idea.n ? <span className="tabular-nums">{idea.n}. </span> : null}{idea.title || idea.angle}
      </p>
      {idea.angle && idea.title && <p className="text-[11px] text-text-secondary mt-1.5 leading-relaxed">{idea.angle}</p>}
      {!under && ref?.kind === 'finding' && ref.headline && (
        <p className="text-[11px] text-sage-700 mt-2 leading-relaxed"><span className="font-semibold">Based on: </span>{ref.headline}</p>
      )}
      {idea.rationale && <p className="text-[11px] text-text-tertiary mt-2 leading-relaxed">{idea.rationale}</p>}
      {idea.suggested_format && <p className="mt-2"><Chip>{idea.suggested_format}</Chip></p>}
    </div>
  )
}

function GapBlock({ block }) {
  const { gap, ideas } = block
  return (
    <div className="border border-border bg-white p-3.5">
      <p className="text-sm font-semibold text-text leading-snug">
        {block.n ? <span className="tabular-nums">{block.n}. </span> : null}{gap.gap}
      </p>
      <Line label="Where we stand">{gap.our_position}</Line>
      <Line label="What to do" strong>{gap.suggested_response}</Line>
      {BASIS[gap.basis] && <p className="text-[10px] text-text-tertiary mt-2">Based on {BASIS[gap.basis]}</p>}
      {ideas.length > 0 && (
        <div className="mt-3 pt-3 border-t border-border space-y-2">
          <Sub>Content ideas for this</Sub>
          {ideas.map((idea, i) => <IdeaCard key={i} idea={idea} under />)}
        </div>
      )}
    </div>
  )
}

function StatButton({ n, label, onClick }) {
  return (
    <button onClick={onClick}
      className="text-left border border-border bg-white px-3 py-2 hover:border-stone-400 hover:bg-surface-subtle transition-colors min-w-0">
      <span className="block text-lg font-bold text-text tabular-nums leading-tight">{n}</span>
      <span className="block text-[11px] text-text-secondary leading-snug">{label}</span>
    </button>
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
  // Remembered per reader, like the team.
  const [line, setLine] = useState(() => {
    try { return localStorage.getItem('research.line') || 'all' } catch { return 'all' }
  })
  const chooseLine = useCallback(l => {
    setLine(l)
    try { localStorage.setItem('research.line', l) } catch { /* private window */ }
  }, [])

  // The lead tracker, events and the watchlist. Loaded here rather than by the
  // page because only this tab reads them. Until they land, the sections that
  // depend on them show a skeleton — never "no leads", which would be a false
  // claim about the market made from a request still in flight.
  const [intel, setIntel] = useState({ signals: [], opportunities: [], events: [], available: false })
  const [agendaCompetitors, setAgendaCompetitors] = useState([])
  const [storeLoaded, setStoreLoaded] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // The one paid control on this tab: a three-sentence summary of the search
  // results, written on request rather than on every page view. It uses the
  // same route and renderer as the Analytics tab so the two never drift apart.
  const [explain, setExplain] = useState({ state: 'idle', points: [], error: '', cost: 0, capped: false, forRun: null })
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
  const moves = useMemo(
    () => competitorMoves(report, { watchlist: agendaCompetitors }),
    [report, agendaCompetitors])
  // Only the rivals still being watched. A failed agenda load reads as "no
  // filter" instead of blanking the section.
  const watching = useMemo(
    () => (agendaCompetitors.length ? agendaCompetitors.filter(c => c.status !== 'retired').map(c => c.subject) : null),
    [agendaCompetitors])
  const social = useMemo(
    () => socialActivity({ report, signals: intel.signals, watching, now }),
    [report, intel.signals, watching, now])
  const events = useMemo(() => eventsView({ report, events: intel.events, runId: run?.id, now }), [report, intel.events, run?.id, now])
  const notes = useMemo(() => marketNotes(report, now), [report, now])
  const search = useMemo(() => searchDemand(report), [report])
  const lines = useMemo(() => linesIn(report), [report])
  const world = useMemo(() => globalView(report), [report])
  const poles = useMemo(() => lineView(report, 'poles'), [report])
  // How much of the run carries no business line. Shown rather than swallowed,
  // so switching to one business does not look like the page emptying out.
  const untagged = useMemo(
    () => (report.findings || []).filter(f => !String(f?.line || '').trim()).length,
    [report])
  const lineLabel = useCallback(
    key => search.byLine.find(l => l.key === key)?.label || '',
    [search.byLine])
  const plan = useMemo(() => marketingRecommendations(report), [report])
  const candidates = useMemo(() => newCompetitors({ report, agendaCompetitors }), [report, agendaCompetitors])
  const sources = useMemo(() => sourceList(report), [report])
  const direction = useMemo(() => marketDirection(report), [report])
  const states = useMemo(() => lensStates(report), [report])
  // Across runs: an item raised three weeks running and never closed.
  const open = useMemo(() => openItems({ runs }), [runs])
  const faults = useMemo(() => runFaults(report), [report])
  const site = report.website || null

  // Stamped with the run it describes, so switching reports cannot leave last
  // week's summary sitting above this week's results.
  const explainFor = explain.forRun === run?.id ? explain : { state: 'idle', points: [], error: '', cost: 0, capped: false }

  const runExplain = useCallback(async () => {
    if (!activeWorkspaceId || !accessToken || !run?.id) return
    // CTR and position arrive as null and must stay null: a zero would tell
    // the model the site ranks first for everything.
    const facts = explainFacts({
      summary: {
        impressions: search.summary?.all?.impressions,
        clicks: search.summary?.all?.clicks,
        ctr: search.summary?.all?.ctr,
        position: search.summary?.all?.position,
        brand: search.summary?.brand,
        nonBrand: search.summary?.nonBrand,
        baseline: search.summary?.baseline,
      },
      findings: [...search.opportunities, ...search.movers],
    })
    setExplain({ state: 'loading', points: [], error: '', cost: 0, capped: false, forRun: run.id })
    const res = await fetchWebsiteExplanation(activeWorkspaceId, accessToken, facts, 'research')
    setExplain({
      state: res?.ok ? 'done' : 'error',
      points: res?.points || [],
      error: res?.ok ? '' : (res?.error || ''),
      cost: res?.cost || 0,
      capped: !!res?.capped,
      forRun: run.id,
    })
  }, [activeWorkspaceId, accessToken, run, search])
  const { passed } = useMemo(() => partitionByClock(report.findings || [], now), [report, now])
  const live = isLive(run)

  // Both filters, independently: a salesperson in controls wants sales items
  // about controls. Model-written sections carry refs rather than a line, so
  // the line is read back off the findings they cite.
  const visibleTop = top.items
    .filter(t => team === 'all' || t.team === team)
    .filter(t => matchesLine(line, linesOfRefs(t.refs, report)))
  // `m.lines` rather than linesOfRefs: a move derived in code carries no refs.
  const visibleMoves = moves.items
    .filter(m => forTeam(team, m.teams))
    .filter(m => matchesLine(line, m.lines || []))
  const moveGroups = useMemo(
    () => (line === 'all' ? movesByLine(visibleMoves, lines) : []),
    [line, visibleMoves, lines])
  const visibleSales = useMemo(
    () => ({ ...sales, open: sales.open.filter(r => forLine(line, r.line)) }),
    [sales, line])
  const visibleNotes = notes
    .filter(n => forTeam(team, n.teams))
    .filter(n => matchesLine(line, linesOfRefs([n.ref].filter(Boolean), report)))
  const proposedCandidates = candidates.filter(c => c.status === 'proposed')

  // `group` places a section on the page: act = what to do next, detail = the
  // topics, about = how the research was done.
  const sections = useMemo(() => [
    { key: 'top', group: 'act', label: 'Top priorities', count: visibleTop.length },
    { key: 'sales', group: 'act', label: 'Leads', count: storeLoaded ? visibleSales.open.length : null },
    { key: 'recs', group: 'act', label: 'Content ideas', count: plan.blocks.length + plan.loose.length },
    { key: 'competitors', group: 'act', label: 'Competitors', count: visibleMoves.length },
    { key: 'events', group: 'act', label: 'Events', count: storeLoaded ? events.count : null },
    { key: 'newcomp', group: 'act', label: 'New competitors', count: storeLoaded ? proposedCandidates.length : null },
    { key: 'search', group: 'detail', label: 'Website', count: search.opportunities.length + search.movers.length },
    { key: 'social', group: 'detail', label: 'Social', count: social.theirs.length + social.ours.length },
    { key: 'market', group: 'detail', label: 'Market news', count: visibleNotes.length },
    { key: 'global', group: 'detail', label: 'Global', count: world.items.length },
    { key: 'poles', group: 'detail', label: 'Smart poles', count: poles.items.length },
    { key: 'sources', group: 'detail', label: 'Sources', count: sources.length },
    { key: 'about', group: 'about', label: 'About this research' },
  ].filter(s => s.key === 'about' || sectionVisible(s.key, team)),
  [team, storeLoaded, visibleTop, visibleSales, visibleMoves, social, events, search, visibleNotes, plan, proposedCandidates, sources, world, poles])

  const [activeZone, setActiveZone] = useState('top')
  const rootRef = useRef(null)
  const active = sections.some(z => z.key === activeZone) ? activeZone : sections[0]?.key

  // A folded topic opens when someone jumps to it — landing on a shut fold
  // reads as "the link did nothing".
  const jump = useCallback(key => {
    const el = document.getElementById(`brief-${key}`)
    if (el?.dataset.fold !== undefined) {
      const d = el.querySelector('details')
      if (d) d.open = true
    }
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      setSaveNote('That status could not be saved. Please try again.')
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
      setSaveNote('That decision could not be saved. Please try again.')
    }
  }, [intel.events, activeWorkspaceId, accessToken])

  const onCandidate = useCallback(async (c, status) => {
    if (!c.agendaId) return
    setBusyId(c.agendaId)
    const out = await setAgendaStatus(accessToken, c.agendaId, status)
    if (out?.error) setSaveNote(`${c.name} could not be updated. Please try again.`)
    else setAgendaCompetitors(list => list.map(a => (a.id === c.agendaId ? { ...a, status } : a)))
    setBusyId(null)
  }, [accessToken])

  if (!runs.length) {
    return (
      <Card>
        <Empty
          title="No research yet"
          description="Research looks for leads, events, competitor activity and market news for this brand. Each week it reports what changed since the last time."
          action={<Button onClick={onRun} disabled={running}>Run research</Button>}
        />
      </Card>
    )
  }

  const counts = report.intel
  const status = runStatus(run)
  const isLatest = run?.id === runs[0]?.id
  const age = daysSinceRun(run, now)
  const failedRun = run.status === 'failed'
  const nothing = !failedRun && !report.headline && !(report.findings || []).length
  const reading = readingLine(states)
  const show = key => sections.some(s => s.key === key)
  const heroStats = [
    show('top') && visibleTop.length ? { key: 'top', n: visibleTop.length, label: visibleTop.length === 1 ? 'top priority' : 'top priorities' } : null,
    show('sales') && storeLoaded && visibleSales.open.length ? { key: 'sales', n: visibleSales.open.length, label: visibleSales.open.length === 1 ? 'open lead or tender' : 'open leads and tenders' } : null,
    show('recs') && plan.total ? { key: 'recs', n: plan.total, label: plan.total === 1 ? 'content idea' : 'content ideas' } : null,
    show('competitors') && visibleMoves.length ? { key: 'competitors', n: visibleMoves.length, label: visibleMoves.length === 1 ? 'competitor move' : 'competitor moves' } : null,
    show('events') && storeLoaded && events.soon.length ? { key: 'events', n: events.soon.length, label: 'events in the next 90 days' } : null,
  ].filter(Boolean)

  return (
    <div ref={rootRef} className="space-y-4">
      {live && <RunProgress run={run} lensRows={lensRows} now={now} plain />}

      {/* ── 1. What the research found ── */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
              {isLatest ? 'Latest research' : 'Earlier research'}
            </p>
            <p className="text-xs text-text-secondary mt-1">
              {[
                fmtLongDate(run.started_at),
                age != null ? ageLabel(age) : '',
                report.period?.start ? `covers ${fmtDate(report.period.start)} – ${fmtDate(report.period.end)}` : '',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {status && <Chip tone={status.tone}>{status.label}</Chip>}
            {runs.length > 1 && (
              <PillSelect value={selectedId || runs[0].id} onChange={e => onSelectRun(e.target.value)} className="max-w-[220px]">
                {runs.map((r, i) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.started_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {i === 0 ? ' (latest)' : ''}
                    {r.status === 'failed' ? ' — did not finish' : partRun(r) ? ' — partly finished' : ''}
                  </option>
                ))}
              </PillSelect>
            )}
          </div>
        </div>

        <h2 className="text-lg font-semibold text-text mt-3 leading-snug max-w-3xl" dir="auto">
          {failedRun ? 'This research run did not finish.' : report.headline || 'This research has no summary.'}
        </h2>

        {(failedRun || partRun(run)) && (
          <p className="text-xs text-amber-800 bg-amber-50/60 border-l-2 border-amber-600 px-2.5 py-1.5 mt-3 leading-relaxed max-w-3xl">
            {plainRunProblem(run.error)} {failedRun ? 'Anything it found before it stopped is below.' : 'Only our own numbers were updated this time.'}
          </p>
        )}
        {!failedRun && !partRun(run) && faults.length > 0 && (
          <p className="text-xs text-amber-800 mt-3 leading-relaxed max-w-3xl">
            Part of this research did not complete, so some sections may be thinner than usual.{' '}
            <button className="underline underline-offset-2" onClick={() => jump('about')}>What happened</button>
          </p>
        )}
        {nothing && !live && <p className="text-sm text-text-secondary mt-3 leading-relaxed max-w-3xl">{emptyReason(report, states)}</p>}

        {heroStats.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-4">
            {heroStats.map(s => <StatButton key={s.key} n={s.n} label={s.label} onClick={() => jump(s.key)} />)}
          </div>
        )}
        {!storeLoaded && (show('sales') || show('events')) && (
          <div className="flex gap-2 mt-2" aria-busy="true" aria-label="Loading leads and events">
            <Skeleton className="h-12 w-32" /><Skeleton className="h-12 w-32" />
          </div>
        )}
        {counts && (counts.opportunities_new > 0 || counts.events_new > 0 || counts.opportunities_changed > 0) && (
          <p className="text-[11px] text-text-tertiary mt-3">
            New since the research before:{' '}
            {[
              counts.opportunities_new ? plural(counts.opportunities_new, 'lead') : '',
              counts.opportunities_changed ? `${counts.opportunities_changed} updated` : '',
              counts.events_new ? plural(counts.events_new, 'event') : '',
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </Card>

      {saveNote && <Card className="p-3 border-red-200 bg-red-50/50"><p className="text-xs text-red-700">{saveNote}</p></Card>}

      <ReaderBar team={team} onTeam={chooseTeam} lines={lines} line={line} onLine={chooseLine}
        untagged={untagged} sections={sections} active={active} onJump={jump} />

      {/* ── 2. What to do with it ── */}
      <Group title="What to do next" helper="The actions this research points to, most important first." />

      <Section id="top" title="Top priorities" count={visibleTop.length}
        helper="The things that most need doing this week, with what to do about each.">
        <TopThree items={visibleTop} />
      </Section>

      {show('sales') && (
        <Section id="sales" title="Leads, tenders and projects" count={storeLoaded ? visibleSales.open.length : null}
          helper={sales.trackerAvailable
            ? 'Every open opening we are tracking, not only this week’s. Set the status as you work each one — the research never changes it.'
            : 'Openings found in this research. From the next research they are tracked week to week with a status you set.'}>
          {!storeLoaded ? (
            <div className="space-y-2" aria-busy="true"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
          ) : visibleSales.open.length ? (
            <SalesTable rows={visibleSales.open} canEdit={intel.available} onStatus={onStatus} busyId={busyId} />
          ) : <Quiet>No open leads, tenders or projects right now.</Quiet>}
          {storeLoaded && sales.closed.length > 0 && (
            <p className="text-[11px] text-text-tertiary mt-3 max-w-3xl">
              Closed: {sales.closed.map(c => `${c.name} (${c.status})`).join('; ')}.
            </p>
          )}
        </Section>
      )}

      {show('recs') && (
        <Section id="recs" title="Content ideas" count={plan.total}
          helper="Where what the market wants and what we say do not line up, with content to close the gap. Send the ideas to a content plan to start on them.">
          {plan.blocks.length || plan.loose.length ? (
            <>
              <div className="space-y-3 max-w-3xl">{plan.blocks.map(block => <GapBlock key={block.gap.id} block={block} />)}</div>
              {plan.loose.length > 0 && (
                <div className="mt-3 space-y-2 max-w-3xl">
                  {plan.blocks.length > 0 && <div className="pt-3 border-t border-border"><Sub>More ideas from this research</Sub></div>}
                  {plan.loose.map((idea, i) => <IdeaCard key={i} idea={idea} />)}
                </div>
              )}
              {plan.ideaCount > 0 && <SendIdeasToPlan ideas={plan.ordered} />}
              {(report.repeated_ideas || []).length > 0 && (
                <p className="text-[11px] text-text-tertiary mt-3">
                  {plural(report.repeated_ideas.length, 'idea')} left out because {report.repeated_ideas.length === 1 ? 'it repeats' : 'they repeat'} an earlier suggestion.
                </p>
              )}
            </>
          ) : <Quiet>No content ideas this time.</Quiet>}
        </Section>
      )}

      {show('competitors') && (
        <Section id="competitors" title="Competitor moves" count={visibleMoves.length}
          helper="What each competitor is doing, pieced together from their website, LinkedIn, job ads, social posts and the press — and what it means for us.">
          {visibleMoves.length ? (
            // Grouped by business line: a lighting supplier and a controls
            // integrator are never in the same room. One group means one
            // business, and then the heading would be noise.
            moveGroups.length > 1
              ? (
                <div className="space-y-5">
                  {moveGroups.map(g => (
                    <div key={g.key || 'unlined'}>
                      <Sub>{g.label} · {plural(g.items.length, 'competitor')}</Sub>
                      <div className="grid gap-2.5 md:grid-cols-2">
                        {g.items.map((m, i) => <CompetitorMove key={i} m={m} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )
              : <div className="grid gap-2.5 md:grid-cols-2">{visibleMoves.map((m, i) => <CompetitorMove key={i} m={m} />)}</div>
          ) : <Quiet>No competitor did anything new that we found this week.</Quiet>}
          {!direction.derived && direction.items.length > 0 && (
            <div className="mt-5 pt-4 border-t border-border max-w-3xl">
              <Sub>Where the market is heading</Sub>
              <ul className="space-y-2">
                {direction.items.map((d, i) => (
                  <li key={i} className="text-xs text-text leading-relaxed">
                    {d.movement}{d.so_what && <span className="text-text-secondary"> <span className="font-semibold">For us:</span> {d.so_what}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>
      )}

      {show('events') && (
        <Section id="events" title="Events and expos" count={storeLoaded ? events.count : null}
          helper="Shows and conferences where our buyers gather. Mark whether we are going so the team knows.">
          {!storeLoaded ? (
            <div className="space-y-2" aria-busy="true"><Skeleton className="h-10 w-full" /></div>
          ) : events.count ? (
            <div className="space-y-5">
              <div>
                <Sub>Next 90 days</Sub>
                {events.soon.length
                  ? <EventsTable rows={events.soon} canEdit={intel.available} onDecision={onDecision} />
                  : <Quiet>Nothing dated in the next 90 days.</Quiet>}
              </div>
              {events.later.length > 0 && (
                <div>
                  <Sub>Later this year — stands and deadlines to book now</Sub>
                  <EventsTable rows={events.later} canEdit={intel.available} onDecision={onDecision} />
                </div>
              )}
              {events.recent.length > 0 && (
                <div>
                  <Sub>Recently — what happened</Sub>
                  <EventsTable rows={events.recent} recent />
                </div>
              )}
            </div>
          ) : <Quiet>No expo, conference or awards are coming up yet.</Quiet>}
          {/* Holidays and seasonal dates, kept out of the expo tables: nobody
              exhibits at a public holiday. */}
          {events.dates.length > 0 && (
            <div className="mt-5 max-w-3xl">
              <Sub>Dates to plan content around</Sub>
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

      {show('newcomp') && (
        <Section id="newcomp" title="New competitors to review" count={storeLoaded ? proposedCandidates.length : null}
          helper="Companies acting like competitors that we do not watch yet. Accept to watch them from the next research; reject and they are not suggested again.">
          {!storeLoaded ? <Skeleton className="h-10 w-full" /> : candidates.length ? (
            <ul className="divide-y divide-border max-w-3xl">
              {candidates.map(c => (
                <li key={c.name} className="py-2.5 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-text">
                      {c.name}{c.thisRun && <span className="ml-1.5"><Chip tone="bg-sage-50 text-sage-700 border-sage-200">This week</Chip></span>}
                    </p>
                    {c.why && <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed">{c.why}</p>}
                    {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-text-tertiary underline underline-offset-2">{domainOf(c.url)}</a>}
                  </div>
                  {c.agendaId && c.status === 'proposed' ? (
                    <div className="flex gap-1.5 shrink-0">
                      <Button size="sm" onClick={() => onCandidate(c, 'active')} disabled={busyId === c.agendaId}>Accept</Button>
                      <Button size="sm" variant="secondary" onClick={() => onCandidate(c, 'retired')} disabled={busyId === c.agendaId}>Reject</Button>
                    </div>
                  ) : (
                    <span className="text-[10px] text-text-tertiary shrink-0">
                      {!c.agendaId ? 'Not saved yet' : c.status === 'active' ? 'Now watched' : c.status === 'retired' ? 'Rejected' : c.status}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : <Quiet>No new competitors turned up.</Quiet>}
        </Section>
      )}

      {/* ── 3. The detail, by topic ── */}
      <Group title="Everything it found, by topic" helper="Open a topic to read the detail. Each item’s sources are one click away." />

      {show('search') && (
        <Fold id="search" title="Website and search" count={search.opportunities.length + search.movers.length}
          helper="How our website did over the last 28 days on Google, and what to do about it.">
          {site?.summary && <WebsiteRead read={site} />}
          {site?.error && !site?.summary && (
            <p className="text-[11px] text-text-tertiary mb-3">The website numbers could not be read this time.</p>
          )}
          {!search.present ? (
            <Quiet>No Google search data came in with this research.</Quiet>
          ) : (
            <div className="space-y-3">
              {/* A summary on request, never on page view: nobody should be
                  charged again just for opening the tab. */}
              {!site?.summary && (
                <div className="border border-border bg-surface-subtle max-w-3xl">
                  <div className="px-3 py-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-text-secondary">
                      {explainFor.state === 'done' && explainFor.points.length
                        ? 'What this adds up to'
                        : 'Want the short version? Get the results below summed up in three sentences.'}
                    </p>
                    <Button size="sm" variant="secondary" onClick={runExplain} disabled={explainFor.state === 'loading'}>
                      {explainFor.state === 'loading' ? 'Summarising…' : (explainFor.state === 'idle' ? 'Summarise' : 'Summarise again')}
                    </Button>
                  </div>
                  {explainFor.state === 'done' && (explainFor.points.length
                    ? <div className="border-t border-border bg-surface"><ExplainPoints points={explainFor.points} /></div>
                    : <p className="px-3 pb-2 text-[11px] text-text-tertiary">Nothing here adds up to more than the items below.</p>
                  )}
                  {explainFor.state === 'error' && (
                    <p className={`px-3 pb-2 text-[11px] ${explainFor.capped ? 'text-amber-700' : 'text-red-600'}`}>
                      {explainFor.capped
                        ? 'This month’s research budget has been used up, so a summary cannot be written right now.'
                        : 'The summary could not be written. Please try again later.'}
                    </p>
                  )}
                </div>
              )}
              {site?.summary && <Sub>From Google Search</Sub>}
              {search.note && <p className="text-sm text-text leading-snug max-w-3xl" dir="auto">{search.note}</p>}
              {search.byLine.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {search.byLine.map(l => (
                    <span key={l.key || 'none'} className="text-[11px] px-2 py-1 bg-surface-muted text-text-secondary">
                      {l.label}: <span className="tabular-nums font-semibold">{l.impressions}</span> times seen in Google
                    </span>
                  ))}
                </div>
              )}
              {search.opportunities.length > 0 && (
                <div className="space-y-2.5">
                  <Sub>Searches we show up for but do not win</Sub>
                  {search.opportunities.map((r, i) => <SearchRow key={i} r={r} lineLabel={lineLabel} />)}
                </div>
              )}
              {search.movers.length > 0 && (
                <div className="space-y-2.5 pt-1">
                  <Sub>What changed</Sub>
                  {search.movers.map((r, i) => <SearchRow key={i} r={r} lineLabel={lineLabel} />)}
                </div>
              )}
              {!search.opportunities.length && !search.movers.length && (
                <Quiet>Nothing in the search numbers changed enough to report this time.</Quiet>
              )}
            </div>
          )}
        </Fold>
      )}

      {show('social') && (
        <Fold id="social" title="Social media" count={social.theirs.length + social.ours.length}
          helper="How our own channels did, and what competitors are posting about.">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <Sub>Our channels</Sub>
              {social.ours.length ? social.ours.map(p => <OurChannel key={p.platform} p={p} />) : <Quiet>No numbers for our channels in this research.</Quiet>}
            </div>
            <div>
              <Sub>Competitors</Sub>
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
              ) : <Quiet>No competitor posts turned up.</Quiet>}
            </div>
          </div>
        </Fold>
      )}

      {show('market') && (
        <Fold id="market" title="Market and technical news" count={visibleNotes.length}
          helper="Regulations, standards, technology and giga-projects — with what marketing and the technical team should do.">
          {visibleNotes.length ? (
            <div className="space-y-2.5">{visibleNotes.map((note, i) => <Note key={i} n={note} now={now} />)}</div>
          ) : <Quiet>No regulation, technology or giga-project news this week.</Quiet>}
        </Fold>
      )}

      {show('global') && (
        <Fold id="global" title="Global industry" count={world.items.length}
          helper="What international manufacturers, prices and standards are doing elsewhere — usually a sign of what reaches us later.">
          {world.items.length ? (
            <div className="space-y-2.5">{world.items.map((f, i) => <Note key={i} n={asNote(f, now)} now={now} />)}</div>
          ) : <Quiet>Nothing from the wider industry this week.</Quiet>}
        </Fold>
      )}

      {show('poles') && (
        <Fold id="poles" title="Smart poles" count={poles.items.length}
          helper="Our municipal line, kept on its own because its buyer is a city rather than an architect or consultant.">
          {poles.items.length ? (
            <div className="space-y-2.5">{poles.items.map((f, i) => <Note key={i} n={asNote(f, now)} now={now} />)}</div>
          ) : (
            <Quiet>
              Nothing on smart poles this week.{poles.rivals === 0 && ' No competitor we watch sells smart poles, so this' +
              ' topic relies on general market news. Add one under “What the research watches” below to change that.'}
            </Quiet>
          )}
        </Fold>
      )}

      <Fold id="sources" title="All sources" count={sources.length}
        helper={`Every page this research quotes, checked on ${fmtDate(run.started_at)}.`}>
        {sources.length ? (
          <ul className="space-y-1.5">
            {sources.map(s => (
              <li key={s.url} className="text-[11px] leading-relaxed flex gap-2 min-w-0">
                <span className="text-text-tertiary shrink-0 w-[130px] truncate">{s.domain}</span>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-text underline underline-offset-2 min-w-0 truncate">
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        ) : <Quiet>This research does not quote any web pages.</Quiet>}
      </Fold>

      {/* ── 4. About this research ── */}
      <Group title="About this research" helper="How the research went, what is still unanswered, and what it keeps an eye on." />

      <Fold id="about" title="How this research went"
        helper={[status?.label, reading].filter(Boolean).join(' · ')}
        open={states.some(s => s.state === 'failed')}>
        <div className="space-y-5 pt-2">
          {report.repetition && <p className="text-xs text-amber-700 max-w-3xl">{report.repetition}</p>}
          {faults.length > 0 && (
            <div className="max-w-3xl">
              <Sub>What did not complete</Sub>
              <ul className="space-y-1.5">{faults.map((f, i) => <li key={i} className="text-xs text-text-secondary leading-relaxed">{f}</li>)}</ul>
            </div>
          )}
          {states.length > 0 && (
            <div>
              <Sub>Topics it checked</Sub>
              <div className="space-y-1.5">
                {states.map(s => (
                  <div key={s.key} className="flex items-baseline gap-3 text-xs min-w-0">
                    <span className={`px-1.5 py-0.5 border text-[10px] font-semibold shrink-0 w-[150px] text-center ${TOPIC_STATE[s.state]?.tone || ''}`}>{TOPIC_STATE[s.state]?.label || s.state}</span>
                    <span className="text-text font-medium w-[150px] shrink-0 truncate">{s.label}</span>
                    <span className="text-text-tertiary truncate hidden sm:block">{s.state === 'failed' ? 'Could not be checked this time.' : s.question}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {open.length > 0 && (
            <div className="max-w-3xl">
              <Sub>Still unanswered</Sub>
              <p className="text-[11px] text-text-tertiary mb-2">Raised by earlier research and not yet resolved.</p>
              <ul className="space-y-2">
                {open.map((item, i) => (
                  <li key={i} className="text-xs text-text-secondary leading-relaxed">
                    {item.text}
                    <span className="text-text-tertiary">
                      {' '}· first raised {fmtDate(item.firstRaised)}
                      {item.runs > 1 ? ` · raised ${item.runs} times` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {passed.length > 0 && (
            <div className="max-w-3xl">
              <Sub>Deadlines that have passed</Sub>
              <div className="space-y-1.5">
                {passed.map((f, i) => (
                  <p key={i} className="text-xs text-text-tertiary"><span className="line-through">{f.headline}</span> · {deadlineLabel(f, now)} · {teamsOf(f).map(t => TEAM_LABEL[t] || t).join(', ')}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      </Fold>

      <section id="brief-watch" className="scroll-mt-32">
        <Card className="p-0 overflow-hidden">
          <details className="group">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-surface-subtle">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-text leading-tight">What the research watches</h3>
                <p className="text-[11px] text-text-tertiary mt-1 leading-relaxed">The competitors and standing questions the next research will look at. Add, accept or remove them here.</p>
              </div>
              <span className="shrink-0 text-[11px] font-medium text-text-tertiary mt-0.5">
                <span className="group-open:hidden">Show</span>
                <span className="hidden group-open:inline">Hide</span>
              </span>
            </summary>
            <div className="p-4 sm:p-5 border-t border-border bg-surface-subtle"><AgentSteering /></div>
          </details>
        </Card>
      </section>
    </div>
  )
}
