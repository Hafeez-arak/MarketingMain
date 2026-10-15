import { Link, useSearchParams } from 'react-router-dom'
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
// Two layers, in the order a marketer asks the questions:
//
//   1. AT A GLANCE   one card: when, whether the run worked, the headline as a
//                    short lead, three or four takeaways lifted from the
//                    report's own top items, and counts that open the detail
//   2. THE DETAIL    one tab per kind of work — do next, content ideas, leads,
//                    competitors, market and events, sources and method —
//                    each with a count. A tab with nothing in it is not shown.
//
// It used to be one long scroll with a sticky jump bar, which covered the
// headings it jumped to and still left the reader scrolling past empty cards.
// Tabs keep one kind of work on screen at a time; the open tab is in the URL
// (?section=, because ?tab= already picks Research vs What We Learned).
//
// Every card has the same shape: a title cut to two lines, a one-line
// summary, "why it matters" and "what to do" as labelled blocks, and the
// detail and sources behind Show more. Printing renders every tab and every
// Show more in full — paper has no tabs to click.
//
// A team filter and a business filter narrow every tab at once. Every section
// is built by src/lib/marketReport.js, which the printable brief also uses, so
// the screen and the PDF never disagree about what the run said.
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

/**
 * The first sentence of a finding, for the at-a-glance list. Cut from the
 * report's own words — never rewritten — and only when what is left still
 * says something (a stub like "Huda." keeps the whole line).
 */
function firstSentence(text) {
  const s = String(text || '').trim()
  const m = s.match(/^(.{40,}?[.!?])(\s|$)/)
  return m ? m[1] : s
}

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
    <span title={title} className={`inline-flex items-center max-w-full truncate px-1.5 py-0.5 border text-[11px] font-semibold whitespace-nowrap ${tone}`}>
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

const CLAMP = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3', 4: 'line-clamp-4' }

// Long text, cut to a few lines with a way to read the rest. On paper it is
// always whole: a printed "Read more" is a dead end.
function Clamp({ text, lines = 3, className = '' }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = String(text).length > lines * 95
  return (
    <div className="min-w-0">
      <p dir="auto" className={`break-words ${!open && long ? `${CLAMP[lines]} print:line-clamp-none` : ''} ${className}`}>{text}</p>
      {long && (
        <button data-print-hide onClick={() => setOpen(o => !o)}
          className="text-xs font-medium text-text-secondary underline underline-offset-2 hover:text-text mt-1">
          {open ? 'Show less' : 'Read more'}
        </button>
      )}
    </div>
  )
}

/** "Why it matters" / "What to do" — a labelled block, so the two never run together. */
function Block({ label, children, act = false, lines = 3 }) {
  if (!children) return null
  return (
    <div className={act ? 'border-l-2 border-amber-600 bg-amber-50/70 px-3 py-2' : 'border-l-2 border-border px-3 py-0.5'}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <div className="mt-0.5">
        <Clamp text={children} lines={lines} className="text-[15px] leading-relaxed text-text" />
      </div>
    </div>
  )
}

/** A line of detail behind Show more: "Why we think so: …". */
function Detail({ label, children }) {
  if (!children) return null
  return (
    <p dir="auto" className="text-sm text-text-secondary leading-relaxed break-words">
      {label && <span className="font-semibold text-text">{label}: </span>}{children}
    </p>
  )
}

// ── Sources ──
// Inside Show more, so a card reads as a finding and an action rather than a
// list of links. An uncited finding says so in the open, because that is a
// fact about the finding rather than one of its sources.
function Sources({ sources = [], pieces = [] }) {
  const links = sources.slice(0, 8)
  if (!pieces.length && !links.length) return null
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">Sources</p>
      {pieces.length ? (
        <ul className="space-y-1.5">{pieces.map((p, i) => <Piece key={i} p={p} />)}</ul>
      ) : (
        <ul className="space-y-1">
          {links.map((s, i) => {
            const url = typeof s === 'string' ? s : s.url
            const title = typeof s === 'string' ? '' : (s.title || '')
            return (
              <li key={i} className="text-[13px] leading-relaxed min-w-0">
                <a href={url} target="_blank" rel="noopener noreferrer" className="text-text-secondary underline underline-offset-2 hover:text-text break-words">
                  {title || domainOf(url)}
                </a>
                {title && <span className="text-text-tertiary"> · {domainOf(url)}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// One small piece of evidence behind a combined claim: where it was seen, and
// a link to it.
function Piece({ p }) {
  return (
    <li className="flex items-start gap-2 text-[13px] leading-relaxed min-w-0">
      <span className="shrink-0 mt-px max-w-[40%]"><Chip>{CHANNEL_LABEL[p.channel] || p.channel || 'Source'}</Chip></span>
      <span className="text-text-secondary min-w-0 break-words" dir="auto">
        {p.summary}
        {p.date && <span className="text-text-tertiary"> · {fmtDate(p.date)}</span>}
        {p.url && (
          <> · <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-text-tertiary underline underline-offset-2 hover:text-text break-all">{domainOf(p.url)}</a></>
        )}
      </span>
    </li>
  )
}

const Uncited = () => (
  <p className="text-[13px] text-amber-700">No source could be confirmed for this one — treat it as an observation.</p>
)

const Quiet = ({ children }) => <p className="text-sm text-text-tertiary leading-relaxed max-w-[72ch]">{children}</p>

// ─── The one card shape every item uses ────────────────────────────────────
// Title cut to two lines, a summary cut to two, the two labelled blocks, and
// everything else behind Show more — which also lifts the cuts, so the whole
// title can always be read without leaving the card.

function ItemCard({ badges, title, titleHref, summary, meta, why, whyLabel = 'Why it matters', todo, todoLabel = 'What to do', aside, more, footer, number, children }) {
  const [open, setOpen] = useState(false)
  const cut = open ? '' : 'print:line-clamp-none'
  const hasMore = !!more || String(title || '').length > 140 || String(summary || '').length > 180
  const heading = (
    <h4 dir="auto" className={`text-base font-semibold text-text leading-snug break-words ${open ? '' : `line-clamp-2 ${cut}`}`}>{title}</h4>
  )
  return (
    <article data-print-keep className="bg-white border border-border p-4 sm:p-5 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        {number != null && (
          <span className="shrink-0 w-7 h-7 bg-amber-700 text-white text-sm font-bold flex items-center justify-center tabular-nums">{number}</span>
        )}
        <div className="min-w-0 flex-1 max-w-[72ch]">
          {badges && <div className="flex items-center gap-1.5 flex-wrap mb-2">{badges}</div>}
          {titleHref
            ? <a href={titleHref} target="_blank" rel="noopener noreferrer" className="hover:underline">{heading}</a>
            : heading}
          {summary && (
            <p dir="auto" className={`text-sm text-text-secondary mt-1.5 leading-relaxed break-words ${open ? '' : `line-clamp-2 ${cut}`}`}>{summary}</p>
          )}
          {meta && <div className="mt-1.5">{meta}</div>}
        </div>
        {aside && <div className="shrink-0 sm:max-w-[220px] min-w-0">{aside}</div>}
      </div>
      {(why || todo) && (
        <div className={`mt-3.5 space-y-2.5 max-w-[72ch] ${number != null ? 'sm:ml-10' : ''}`}>
          <Block label={whyLabel}>{why}</Block>
          <Block label={todoLabel} act>{todo}</Block>
        </div>
      )}
      {children && <div className={`mt-3.5 max-w-[72ch] ${number != null ? 'sm:ml-10' : ''}`}>{children}</div>}
      {more && (
        <div className={`${open ? '' : 'hidden print:block'} mt-3.5 pt-3 border-t border-border-light max-w-[72ch] space-y-2.5 ${number != null ? 'sm:ml-10' : ''}`}>
          {more}
        </div>
      )}
      {(footer || hasMore) && (
        <div className={`mt-3 flex items-center justify-between gap-3 flex-wrap ${number != null ? 'sm:ml-10' : ''}`}>
          <div className="min-w-0 text-xs text-text-tertiary">{footer}</div>
          {hasMore && (
            <button data-print-hide onClick={() => setOpen(o => !o)} aria-expanded={open}
              className="inline-flex items-center gap-1 text-xs font-semibold text-text-secondary hover:text-text">
              {open ? 'Show less' : 'Show more'}
              <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
            </button>
          )}
        </div>
      )}
    </article>
  )
}

/** A part of a tab: a heading, one short line, then its items. */
function Part({ title, helper, count, action, children }) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-text">
            {title}{count != null && <span className="ml-2 text-sm font-medium text-text-tertiary tabular-nums">{count}</span>}
          </h3>
          {helper && <p className="text-sm text-text-secondary mt-0.5 leading-relaxed max-w-[72ch]">{helper}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

const Stack = ({ children }) => <div className="space-y-3">{children}</div>
const SubHead = ({ children }) => <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{children}</p>

// ─── Cards ─────────────────────────────────────────────────────────────────

function TopItem({ t, n }) {
  // A piece that IS the finding would repeat the headline word for word —
  // only its link is worth keeping then.
  const pieces = t.pieces.filter(p => p.summary !== t.finding)
  const links = t.pieces.filter(p => p.summary === t.finding && p.url).map(p => ({ url: p.url }))
  const hasSources = pieces.length || links.length
  return (
    <ItemCard
      number={n}
      badges={<TeamChip team={t.team} />}
      title={t.finding}
      todo={t.action}
      more={hasSources ? <Sources pieces={pieces} sources={pieces.length ? [] : links} /> : null}
    />
  )
}

function LeadCard({ r, canEdit, onStatus, busyId }) {
  const soon = r.days != null && r.days >= 0 && r.days <= 7
  const gone = r.days != null && r.days < 0
  const more = [
    r.headline && r.headline !== r.name ? <Detail key="h">{r.headline}</Detail> : null,
    r.details.length ? <ul key="d" className="space-y-0.5">{r.details.map((d, j) => <li key={j}><Detail>{d}</Detail></li>)}</ul> : null,
    r.changed ? <p key="c" className="text-sm text-sky-700">Updated: {r.changed}</p> : null,
  ].filter(Boolean)
  return (
    <ItemCard
      badges={<><Chip>{LEAD_TYPE[r.type] || r.type}</Chip><RelevanceChip value={r.relevance} /><NewChip isNew={r.isNew} changed={r.changed} /></>}
      title={r.name}
      meta={(
        /* A published date when one exists, and otherwise the window the stage
            implies — labelled as an estimate. */
        <p className="text-sm leading-relaxed">
          <span className="font-semibold text-text">Deadline: </span>
          {r.deadline && (
            <span className={`font-semibold tabular-nums ${soon ? 'text-red-700' : gone ? 'text-text-tertiary' : 'text-text'}`}>{fmtDate(r.deadline)} · </span>
          )}
          <span className="text-text-secondary">{r.window.label}</span>
          {r.window.basis === 'stage' && <span className="text-text-tertiary"> (estimated, not published)</span>}
        </p>
      )}
      aside={(
        <div className="sm:text-right sm:w-[180px]">
          {r.tracked && canEdit ? (
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Status</span>
              <PillSelect value={r.status} onChange={e => onStatus(r, e.target.value)} className="w-full">
                {OPPORTUNITY_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </PillSelect>
            </label>
          ) : (
            <span className="text-xs text-text-tertiary leading-relaxed block">
              {r.tracked ? r.status : 'Tracked from the next research'}
            </span>
          )}
          {busyId && busyId === r.id && <p className="text-xs text-text-tertiary mt-1">Saving…</p>}
          {r.firstSeen && <p className="text-xs text-text-tertiary mt-1">First seen {fmtDate(r.firstSeen)}</p>}
        </div>
      )}
      todo={r.action}
      more={more.length ? more : null}
      footer={r.url && (
        <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text">
          Source: {domainOf(r.url)}
        </a>
      )}
    />
  )
}

function CompetitorMove({ m }) {
  const seen = [
    m.channels.length ? `Seen on ${m.channels.map(c => CHANNEL_LABEL[c] || c).join(', ')}` : '',
    m.freshness === 'standing' ? 'nothing new this week' : '',
  ].filter(Boolean).join(' · ')
  const more = [
    m.picture ? <Detail key="p" label="Why we think so">{m.picture}</Detail> : null,
    m.pieces?.length ? <Sources key="s" pieces={m.pieces} /> : null,
  ].filter(Boolean)
  return (
    <ItemCard
      badges={(m.relevance || (m.freshness && m.freshness !== 'standing')) ? (
        <>
          <RelevanceChip value={m.relevance} />
          {m.freshness && m.freshness !== 'standing' && <Chip tone="bg-sage-50 text-sage-700 border-sage-200">{freshnessLabel(m.freshness)}</Chip>}
        </>
      ) : null}
      title={m.competitor}
      summary={m.whatChanged}
      why={m.effect} whyLabel="What it means for us"
      more={more.length ? more : null}
      footer={seen}
    />
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
    <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-3 py-3 border-b border-border last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-text">
          {p.label}{p.username && <span className="font-normal text-text-tertiary"> @{p.username}</span>}
        </p>
        <p className="text-[13px] text-text-secondary mt-0.5 break-words">
          {p.state === 'measured' ? bestLine(p) : p.note}
        </p>
      </div>
      {p.state === 'measured' && (
        <div className="sm:text-right shrink-0 tabular-nums">
          <p className="text-sm font-semibold text-text">{plural(p.posts, 'post')} · {p.avg_engagement ?? '—'} interactions each</p>
          <p className={`text-xs ${p.change ? (p.change.direction === 'up' ? 'text-sage-600' : 'text-red-600') : 'text-text-tertiary'}`}>
            {p.change ? `${p.change.direction === 'up' ? '+' : '−'}${p.change.change_pct}% vs before` : p.weak ? 'too few to compare' : 'no comparison yet'}
          </p>
        </div>
      )}
    </div>
  )
}

// One card per event. A past event swaps the exhibitor deadline for what
// came of it.
function EventCard({ e, canEdit, onDecision, recent = false }) {
  const when = e.start ? `${fmtDate(e.start)}${e.end && e.end !== e.start ? ` – ${fmtDate(e.end)}` : ''}` : 'Dates to be confirmed'
  const near = e.deadlineDays != null && e.deadlineDays >= 0 && e.deadlineDays <= 14
  return (
    <ItemCard
      badges={(e.isNew || e.changed) ? <NewChip isNew={e.isNew} changed={e.changed} /> : null}
      title={e.name}
      titleHref={e.url || undefined}
      summary={[when, e.venue, e.organizer].filter(Boolean).join(' · ')}
      aside={e.id && canEdit && !recent ? (
        <label className="block sm:w-[180px]">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">We are</span>
          <PillSelect value={e.decision} onChange={ev => onDecision(e, ev.target.value)} className="w-full">
            {EVENT_DECISIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </PillSelect>
        </label>
      ) : null}
      todo={recent ? (e.takeaway || e.recommendation) : e.recommendation}
      todoLabel={recent ? 'What came of it' : 'Our recommendation'}
      more={recent && e.takeaway && e.recommendation ? <Detail label="For us">{e.recommendation}</Detail> : null}
      footer={[
        !recent && (e.exhibitorDeadline
          ? <span key="d" className={near ? 'text-red-700 font-semibold' : ''}>Exhibitor deadline {fmtDate(e.exhibitorDeadline)}{e.deadlineStatus ? ` · ${e.deadlineStatus}` : ''}</span>
          : <span key="d">Exhibitor deadline {e.deadlineStatus || 'not known yet'}</span>),
        e.competitors.length ? <span key="c">{recent ? 'Competitors there' : 'Competitors going'}: {e.competitors.join(', ')}</span> : null,
      ].filter(Boolean).reduce((acc, x, i) => (i ? [...acc, ' · ', x] : [x]), [])}
    />
  )
}

// A search row. The business chip shows only when the row matched a business
// line — an unclassified row shows nothing rather than a made-up "General".
function SearchRow({ r, lineLabel }) {
  return (
    <ItemCard
      badges={r.line && lineLabel(r.line) ? <Chip>{lineLabel(r.line)}</Chip> : null}
      title={r.headline}
      summary={r.detail}
      todo={r.action}
    />
  )
}

function WebsiteRead({ read }) {
  return (
    <div className="space-y-3">
      <p className="text-[15px] text-text leading-relaxed max-w-[72ch]" dir="auto">{read.summary}</p>
      {read.numbers.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {read.numbers.map((x, i) => (
            <div key={i} className="border border-border bg-white p-3">
              <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{x.label}</p>
              <p className="text-lg font-semibold text-text tabular-nums mt-0.5">{x.value}</p>
              {x.meaning && <p className="text-[13px] text-text-secondary leading-snug mt-1">{x.meaning}</p>}
            </div>
          ))}
        </div>
      )}
      {read.suggestions.length > 0 && (
        <div className="max-w-[72ch] border-l-2 border-amber-600 bg-amber-50/70 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">What to do</p>
          <ul className="mt-1 space-y-1">
            {read.suggestions.map((t, i) => (
              <li key={i} className="text-[15px] text-text leading-relaxed" dir="auto">{t}</li>
            ))}
          </ul>
        </div>
      )}
      <Link to="/analytics?channel=website" className="inline-block text-sm text-text-secondary hover:text-text underline underline-offset-2">
        See every website number on the Analytics page →
      </Link>
    </div>
  )
}

function Note({ n, now }) {
  const more = [
    n.technicalNote ? <Detail key="t" label="For the technical team">{n.technicalNote}</Detail> : null,
    n.confidence != null ? <p key="c" className="text-xs text-text-tertiary">Confidence {pct(n.confidence)}</p> : null,
    n.uncited ? <Uncited key="u" /> : (n.sources || []).length ? <Sources key="s" sources={n.sources} /> : null,
  ].filter(Boolean)
  return (
    <ItemCard
      badges={(
        <>
          {n.teams.map(t => <TeamChip key={t} team={t} />)}
          <RelevanceChip value={n.relevance} />
          {n.store?.state === 'seen' && <Chip>Already known</Chip>}
          {n.days != null && n.days >= 0 && (
            <Chip tone="bg-white text-text border-border">{deadlineLabel({ perishable_until: dateIn(n.days, now) }, now)}</Chip>
          )}
        </>
      )}
      title={n.headline}
      summary={n.detail}
      todo={n.action}
      more={more.length ? more : null}
    />
  )
}

const dateIn = (days, now) => new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)

/** An idea under a gap: compact, because the gap above it carries the why. */
function IdeaLine({ idea }) {
  return (
    <li className="border-l-2 border-sage-400 pl-3 py-0.5">
      <p className="text-sm font-semibold text-text leading-snug" dir="auto">{idea.title || idea.angle}</p>
      {idea.angle && idea.title && (
        <div className="mt-0.5"><Clamp text={idea.angle} lines={2} className="text-sm text-text-secondary leading-relaxed" /></div>
      )}
      {idea.suggested_format && <p className="mt-1"><Chip>{idea.suggested_format}</Chip></p>}
    </li>
  )
}

function IdeaCard({ idea }) {
  const ref = idea.answers_ref
  const more = [
    ref?.kind === 'finding' && ref.headline ? <Detail key="b" label="Based on">{ref.headline}</Detail> : null,
    idea.rationale ? <Detail key="r" label="Why">{idea.rationale}</Detail> : null,
  ].filter(Boolean)
  return (
    <ItemCard
      badges={idea.suggested_format ? <Chip>{idea.suggested_format}</Chip> : null}
      title={idea.title || idea.angle}
      summary={idea.title ? idea.angle : null}
      more={more.length ? more : null}
    />
  )
}

function GapBlock({ block }) {
  const { gap, ideas } = block
  return (
    <ItemCard
      number={block.n || null}
      title={gap.gap}
      why={gap.our_position} whyLabel="Where we stand"
      todo={gap.suggested_response}
      footer={BASIS[gap.basis] ? `Based on ${BASIS[gap.basis]}` : null}
    >
      {ideas.length > 0 && (
        <div>
          <SubHead>Content ideas for this</SubHead>
          <ul className="mt-2 space-y-2.5">{ideas.map((idea, i) => <IdeaLine key={i} idea={idea} />)}</ul>
        </div>
      )}
    </ItemCard>
  )
}

// ─── The tabs ──────────────────────────────────────────────────────────────

const TAB_DEFS = [
  { key: 'do', label: 'Do next', chip: n => (n === 1 ? 'thing to do next' : 'things to do next') },
  { key: 'content', label: 'Content ideas', chip: n => (n === 1 ? 'content idea' : 'content ideas') },
  { key: 'leads', label: 'Leads & tenders', chip: n => (n === 1 ? 'open lead or tender' : 'open leads and tenders') },
  { key: 'competitors', label: 'Competitors', chip: n => (n === 1 ? 'competitor move' : 'competitor moves') },
  { key: 'market', label: 'Market & events', chip: n => (n === 1 ? 'market item or event' : 'market items and events') },
  { key: 'method', label: 'Sources & method', chip: null },
]

function TabBar({ tabs, active, onPick }) {
  // On a phone the row scrolls sideways; keep the open tab in view so a
  // takeaway or chip that switches tabs never lands on a hidden one.
  const rowRef = useRef(null)
  useEffect(() => {
    const row = rowRef.current
    const el = row?.querySelector('[aria-selected="true"]')
    if (el && row.scrollWidth > row.clientWidth) {
      row.scrollTo({ left: Math.max(0, el.offsetLeft - 16), behavior: 'smooth' })
    }
  }, [active])
  return (
    <div ref={rowRef} data-print-hide role="tablist" aria-label="Research sections"
      className="flex overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map(t => (
        <button key={t.key} role="tab" aria-selected={active === t.key} onClick={() => onPick(t.key)}
          className={`shrink-0 -mb-px px-2.5 py-2.5 text-sm border-b-2 transition-colors ${
            active === t.key
              ? 'border-amber-700 text-text font-semibold'
              : 'border-transparent text-text-secondary font-medium hover:text-text hover:border-border-strong'}`}>
          {t.label}
          {t.count === null
            ? <span className="ml-1.5 inline-block align-middle w-5 h-3 bg-surface-muted animate-pulse" aria-label="loading" />
            : t.count != null && (
              <span className={`ml-1.5 px-1.5 py-px text-xs tabular-nums ${active === t.key ? 'bg-amber-700 text-white' : 'bg-surface-muted text-text-secondary'}`}>{t.count}</span>
            )}
        </button>
      ))}
    </div>
  )
}

function Filters({ team, onTeam, lines, line, onLine, untagged }) {
  return (
    <div data-print-hide className="flex items-center gap-x-5 gap-y-2 flex-wrap">
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        For
        <PillSelect value={team} onChange={e => onTeam(e.target.value)}>
          {TEAMS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </PillSelect>
      </label>
      {/* Only when the run found more than one business line. A brand with
          one undivided business never sees a control that does nothing. */}
      {lines.length > 1 && (
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          Business
          <PillSelect value={line} onChange={e => onLine(e.target.value)}>
            <option value="all">All</option>
            {lines.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
          </PillSelect>
        </label>
      )}
      {line !== 'all' && untagged > 0 && (
        <p className="text-xs text-text-tertiary">
          {plural(untagged, 'finding')} could not be tied to one business and only show under All.
        </p>
      )}
    </div>
  )
}

// ─── The tab ───────────────────────────────────────────────────────────────

export function ResearchTab({ run, runs, lensRows, selectedId, onSelectRun, onRun, running, now }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const report = useMemo(() => run?.report || {}, [run])
  const [params, setParams] = useSearchParams()

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
  const [headlineOpen, setHeadlineOpen] = useState(false)
  const tabsRef = useRef(null)

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

  const show = key => sectionVisible(key, team)
  const showSearch = show('search') && (search.present || !!site?.summary)
  const searchCount = search.opportunities.length + search.movers.length
  const ours = show('social') ? social.ours : []
  const theirs = show('social') ? social.theirs : []
  const showDirection = show('competitors') && !direction.derived && direction.items.length > 0
  const showEvents = show('events')

  // What each tab holds. `count` is what the badge says (null while the store
  // is still loading); `has` decides whether the tab is offered at all, so a
  // tab with nothing in it never takes a place in the row.
  const tabs = useMemo(() => {
    const doCount = show('top') ? visibleTop.length : 0
    // Ideas when there are any; the search rows are counted only when they are
    // all the tab holds, so the badge and the glance chip say the same number.
    const ideaCount = show('recs') ? plan.total : 0
    const contentCount = ideaCount || (showSearch ? searchCount : 0)
    const leadsCount = show('sales') ? (storeLoaded ? visibleSales.open.length : null) : 0
    const compCount = (show('competitors') ? visibleMoves.length : 0) + (show('newcomp') && storeLoaded ? proposedCandidates.length : 0)
    const marketCount = (show('market') ? visibleNotes.length : 0) + (show('global') ? world.items.length : 0) +
      (show('poles') ? poles.items.length : 0) + (showEvents && storeLoaded ? events.count + events.dates.length : 0)
    const has = {
      do: doCount > 0,
      content: contentCount > 0 || showSearch || ours.length > 0,
      leads: show('sales') && (!storeLoaded || visibleSales.open.length > 0 || sales.closed.length > 0),
      competitors: compCount > 0 || showDirection || theirs.length > 0 || (show('newcomp') && (!storeLoaded || candidates.length > 0)),
      market: marketCount > 0 || (showEvents && !storeLoaded),
      method: true,
    }
    // A tab whose total still waits on the store shows a placeholder, not a
    // number that grows a second later.
    const pending = !storeLoaded
    const counts = {
      do: doCount, content: contentCount, leads: leadsCount,
      competitors: pending && show('newcomp') ? null : compCount,
      market: pending && showEvents ? null : marketCount,
      method: sources.length,
    }
    // The glance card's chips name one kind of thing each, so they count only
    // that kind: "8 content ideas", not ideas and search rows added together.
    const chipCounts = { ...counts, content: ideaCount, competitors: show('competitors') ? visibleMoves.length : 0 }
    return TAB_DEFS.filter(t => has[t.key]).map(t => ({ ...t, count: counts[t.key], chipCount: chipCounts[t.key] }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, storeLoaded, visibleTop, visibleSales, sales.closed, visibleMoves, proposedCandidates, candidates, plan,
    showSearch, searchCount, ours, theirs, showDirection, showEvents, events, visibleNotes, world, poles, sources])

  const asked = params.get('section')
  const activeTab = tabs.some(t => t.key === asked) ? asked : tabs[0]?.key
  const pickTab = useCallback((key, scroll = false) => {
    setParams(prev => { const n = new URLSearchParams(prev); n.set('section', key); return n }, { replace: true })
    if (scroll) tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [setParams])

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
  const headline = failedRun ? 'This research run did not finish.' : report.headline || 'This research has no summary.'
  const longHeadline = headline.length > 150

  // The takeaways are the report's own top items, first sentence only — the
  // glance card never says anything the tabs below do not.
  const takeaways = [
    ...(show('top') ? visibleTop.map(t => ({ text: t.finding, tab: 'do' })) : []),
    ...(show('recs') ? plan.blocks.map(b => ({ text: b.gap?.gap, tab: 'content' })) : []),
    ...(show('competitors') ? visibleMoves.map(m => ({ text: m.whatChanged ? `${m.competitor}: ${m.whatChanged}` : '', tab: 'competitors' })) : []),
  ].filter(t => String(t.text || '').trim()).slice(0, 4)
  const chips = tabs.filter(t => t.chip && t.chipCount !== 0)

  const panel = key => `${activeTab === key ? '' : 'hidden print:block'} space-y-8`
  const printTitle = key => (
    <h2 className="hidden print:block text-lg font-bold text-text pt-4">{TAB_DEFS.find(t => t.key === key)?.label}</h2>
  )

  return (
    <div className="space-y-5">
      {live && <RunProgress run={run} lensRows={lensRows} now={now} plain />}

      {/* ── 1. This week at a glance ── */}
      <Card className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex items-center gap-2 flex-wrap">
            <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
              {!isLatest ? 'Earlier research' : age != null && age <= 7 ? 'This week at a glance' : 'Latest research at a glance'}
            </p>
            {status && <Chip tone={status.tone}>{status.label}</Chip>}
            <p className="text-xs text-text-tertiary basis-full sm:basis-auto">
              {[
                fmtLongDate(run.started_at),
                age != null ? ageLabel(age) : '',
                report.period?.start ? `covers ${fmtDate(report.period.start)} – ${fmtDate(report.period.end)}` : '',
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
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

        <h2 dir="auto" className={`text-lg sm:text-xl font-semibold text-text mt-3 leading-snug max-w-[68ch] ${
          longHeadline && !headlineOpen ? 'line-clamp-2 print:line-clamp-none' : ''}`}>
          {headline}
        </h2>
        {longHeadline && (
          <button data-print-hide onClick={() => setHeadlineOpen(o => !o)}
            className="text-xs font-medium text-text-secondary underline underline-offset-2 hover:text-text mt-1">
            {headlineOpen ? 'Show less' : 'Read more'}
          </button>
        )}

        {(failedRun || partRun(run)) && (
          <p className="text-sm text-amber-800 bg-amber-50/60 border-l-2 border-amber-600 px-3 py-2 mt-3 leading-relaxed max-w-[72ch]">
            {plainRunProblem(run.error)} {failedRun ? 'Anything it found before it stopped is below.' : 'Only our own numbers were updated this time.'}
          </p>
        )}
        {!failedRun && !partRun(run) && faults.length > 0 && (
          <p className="text-sm text-amber-800 mt-3 leading-relaxed max-w-[72ch]">
            Part of this research did not complete, so some sections may be thinner than usual.{' '}
            <button className="underline underline-offset-2" onClick={() => pickTab('method', true)}>What happened</button>
          </p>
        )}
        {nothing && !live && <p className="text-[15px] text-text-secondary mt-3 leading-relaxed max-w-[72ch]">{emptyReason(report, states)}</p>}

        {takeaways.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border-light">
            <SubHead>Key takeaways</SubHead>
            <ul className="mt-2 space-y-2 max-w-[72ch]">
              {takeaways.map((t, i) => (
                <li key={i} className="flex gap-2.5">
                  <span aria-hidden="true" className="shrink-0 mt-[9px] w-1.5 h-1.5 bg-amber-600" />
                  <button onClick={() => pickTab(t.tab, true)} dir="auto"
                    className="text-left text-[15px] text-text leading-relaxed line-clamp-2 print:line-clamp-none hover:underline underline-offset-2 decoration-border-strong">
                    {firstSentence(t.text)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {chips.length > 0 && (
          <div data-print-hide className="flex flex-wrap gap-2 mt-4">
            {chips.map(t => (
              t.chipCount === null
                ? <Skeleton key={t.key} className="h-8 w-40" />
                : (
                  <button key={t.key} onClick={() => pickTab(t.key, true)}
                    className="inline-flex items-baseline gap-1.5 border border-border bg-white px-3 py-1.5 text-sm hover:border-stone-400 hover:bg-surface-subtle transition-colors">
                    <span className="font-bold text-text tabular-nums">{t.chipCount}</span>
                    <span className="text-text-secondary">{t.chip(t.chipCount)}</span>
                  </button>
                )
            ))}
          </div>
        )}
        {counts && (counts.opportunities_new > 0 || counts.events_new > 0 || counts.opportunities_changed > 0) && (
          <p className="text-xs text-text-tertiary mt-3">
            New since the research before:{' '}
            {[
              counts.opportunities_new ? plural(counts.opportunities_new, 'lead') : '',
              counts.opportunities_changed ? `${counts.opportunities_changed} updated` : '',
              counts.events_new ? plural(counts.events_new, 'event') : '',
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </Card>

      {saveNote && <Card className="p-3 border-red-200 bg-red-50/50"><p className="text-sm text-red-700">{saveNote}</p></Card>}

      {/* ── 2. The detail, one tab at a time ── */}
      <div ref={tabsRef} className="scroll-mt-4 space-y-5">
        <TabBar tabs={tabs} active={activeTab} onPick={k => pickTab(k)} />
        {activeTab !== 'method' && (
          <Filters team={team} onTeam={chooseTeam} lines={lines} line={line} onLine={chooseLine} untagged={untagged} />
        )}

        {/* Do next */}
        {tabs.some(t => t.key === 'do') && (
          <div role="tabpanel" className={panel('do')}>
            {printTitle('do')}
            <Part title="Top priorities" helper="What most needs doing this week, most important first.">
              <Stack>{visibleTop.map((t, i) => <TopItem key={i} t={t} n={i + 1} />)}</Stack>
            </Part>
          </div>
        )}

        {/* Content ideas */}
        {tabs.some(t => t.key === 'content') && (
          <div role="tabpanel" className={panel('content')}>
            {printTitle('content')}
            {show('recs') && plan.total > 0 && (
              <Part title="Content ideas" count={plan.total}
                helper="Where what the market wants and what we say do not line up, with content to close the gap.">
                {/* Above the ideas, not under them: with eight cards below,
                    the one control that starts work should not be the last
                    thing on the page. */}
                {plan.ideaCount > 0 && <div data-print-hide className="max-w-[72ch] [&>div]:mt-0 [&>div]:border-t-0 [&>div]:pt-0"><SendIdeasToPlan ideas={plan.ordered} /></div>}
                <Stack>{plan.blocks.map(block => <GapBlock key={block.gap.id} block={block} />)}</Stack>
                {plan.loose.length > 0 && (
                  <div className="space-y-3 pt-2">
                    {plan.blocks.length > 0 && <SubHead>More ideas from this research</SubHead>}
                    <Stack>{plan.loose.map((idea, i) => <IdeaCard key={i} idea={idea} />)}</Stack>
                  </div>
                )}
                {(report.repeated_ideas || []).length > 0 && (
                  <p className="text-xs text-text-tertiary">
                    {plural(report.repeated_ideas.length, 'idea')} left out because {report.repeated_ideas.length === 1 ? 'it repeats' : 'they repeat'} an earlier suggestion.
                  </p>
                )}
              </Part>
            )}

            {showSearch && (
              <Part title="Website and search" count={searchCount || null}
                helper="How our website did over the last 28 days on Google, and what to do about it.">
                {site?.summary && <WebsiteRead read={site} />}
                {site?.error && !site?.summary && (
                  <p className="text-sm text-text-tertiary">The website numbers could not be read this time.</p>
                )}
                {search.present && (
                  <div className="space-y-3">
                    {/* A summary on request, never on page view: nobody should
                        be charged again just for opening the tab. */}
                    {!site?.summary && (
                      <div className="border border-border bg-white max-w-[72ch]" data-print-hide={explainFor.state === 'done' ? undefined : ''}>
                        <div className="px-3 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-sm text-text-secondary">
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
                          : <p className="px-3 pb-2 text-sm text-text-tertiary">Nothing here adds up to more than the items below.</p>
                        )}
                        {explainFor.state === 'error' && (
                          <p className={`px-3 pb-2 text-sm ${explainFor.capped ? 'text-amber-700' : 'text-red-600'}`}>
                            {explainFor.capped
                              ? 'This month’s research budget has been used up, so a summary cannot be written right now.'
                              : 'The summary could not be written. Please try again later.'}
                          </p>
                        )}
                      </div>
                    )}
                    {search.note && <p className="text-[15px] text-text leading-relaxed max-w-[72ch]" dir="auto">{search.note}</p>}
                    {search.byLine.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {search.byLine.map(l => (
                          <span key={l.key || 'none'} className="text-xs px-2 py-1 bg-white border border-border text-text-secondary">
                            {l.label}: <span className="tabular-nums font-semibold text-text">{l.impressions}</span> times seen in Google
                          </span>
                        ))}
                      </div>
                    )}
                    {search.opportunities.length > 0 && (
                      <div className="space-y-3 pt-1">
                        <SubHead>Searches we show up for but do not win</SubHead>
                        <Stack>{search.opportunities.map((r, i) => <SearchRow key={i} r={r} lineLabel={lineLabel} />)}</Stack>
                      </div>
                    )}
                    {search.movers.length > 0 && (
                      <div className="space-y-3 pt-1">
                        <SubHead>What changed</SubHead>
                        <Stack>{search.movers.map((r, i) => <SearchRow key={i} r={r} lineLabel={lineLabel} />)}</Stack>
                      </div>
                    )}
                    {!searchCount && <Quiet>Nothing in the search numbers changed enough to report this time.</Quiet>}
                  </div>
                )}
              </Part>
            )}

            {ours.length > 0 && (
              <Part title="How our channels did">
                <div className="bg-white border border-border px-4 sm:px-5">
                  {ours.map(p => <OurChannel key={p.platform} p={p} />)}
                </div>
              </Part>
            )}
          </div>
        )}

        {/* Leads & tenders */}
        {tabs.some(t => t.key === 'leads') && (
          <div role="tabpanel" className={panel('leads')}>
            {printTitle('leads')}
            <Part title="Leads, tenders and projects" count={storeLoaded ? visibleSales.open.length : null}
              helper={sales.trackerAvailable
                ? 'Every open opening we are tracking, not only this week’s. Set the status as you work each one.'
                : 'Openings found in this research. From the next research they are tracked week to week.'}>
              {!storeLoaded ? (
                <div className="space-y-3" aria-busy="true"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
              ) : visibleSales.open.length ? (
                <Stack>
                  {visibleSales.open.map((r, i) => (
                    <LeadCard key={r.id || `f${i}`} r={r} canEdit={intel.available} onStatus={onStatus} busyId={busyId} />
                  ))}
                </Stack>
              ) : <Quiet>No open leads, tenders or projects right now.</Quiet>}
              {storeLoaded && sales.closed.length > 0 && (
                <p className="text-sm text-text-tertiary max-w-[72ch]">
                  Closed: {sales.closed.map(c => `${c.name} (${c.status})`).join('; ')}.
                </p>
              )}
            </Part>
          </div>
        )}

        {/* Competitors */}
        {tabs.some(t => t.key === 'competitors') && (
          <div role="tabpanel" className={panel('competitors')}>
            {printTitle('competitors')}
            {show('competitors') && visibleMoves.length > 0 && (
              <Part title="Competitor moves" count={visibleMoves.length}
                helper="What each competitor is doing, and what it means for us.">
                {/* Grouped by business line: a lighting supplier and a controls
                    integrator are never in the same room. One group means one
                    business, and then the heading would be noise. */}
                {moveGroups.length > 1 ? (
                  <div className="space-y-6">
                    {moveGroups.map(g => (
                      <div key={g.key || 'unlined'} className="space-y-3">
                        <SubHead>{g.label} · {plural(g.items.length, 'competitor')}</SubHead>
                        <div className="grid gap-3 lg:grid-cols-2">{g.items.map((m, i) => <CompetitorMove key={i} m={m} />)}</div>
                      </div>
                    ))}
                  </div>
                ) : <div className="grid gap-3 lg:grid-cols-2">{visibleMoves.map((m, i) => <CompetitorMove key={i} m={m} />)}</div>}
              </Part>
            )}

            {showDirection && (
              <Part title="Where the market is heading">
                <ul className="space-y-3 max-w-[72ch]">
                  {direction.items.map((d, i) => (
                    <li key={i} className="bg-white border border-border p-4">
                      <p className="text-[15px] text-text leading-relaxed" dir="auto">{d.movement}</p>
                      {d.so_what && <p className="text-sm text-text-secondary leading-relaxed mt-1.5"><span className="font-semibold text-text">For us: </span>{d.so_what}</p>}
                    </li>
                  ))}
                </ul>
              </Part>
            )}

            {show('newcomp') && (!storeLoaded || candidates.length > 0) && (
              <Part title="New competitors to review" count={storeLoaded ? proposedCandidates.length : null}
                helper="Companies acting like competitors that we do not watch yet. Accept to watch them; reject and they are not suggested again.">
                {!storeLoaded ? <Skeleton className="h-16 w-full" /> : (
                  <ul className="bg-white border border-border divide-y divide-border max-w-[72ch]">
                    {candidates.map(c => (
                      <li key={c.name} className="px-4 py-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3">
                        <div className="min-w-0">
                          <p className="text-[15px] font-semibold text-text">
                            {c.name}{c.thisRun && <span className="ml-1.5 align-middle"><Chip tone="bg-sage-50 text-sage-700 border-sage-200">This week</Chip></span>}
                          </p>
                          {c.why && <div className="mt-0.5"><Clamp text={c.why} lines={2} className="text-sm text-text-secondary leading-relaxed" /></div>}
                          {c.url && <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-xs text-text-tertiary underline underline-offset-2">{domainOf(c.url)}</a>}
                        </div>
                        {c.agendaId && c.status === 'proposed' ? (
                          <div className="flex gap-1.5 shrink-0" data-print-hide>
                            <Button size="sm" onClick={() => onCandidate(c, 'active')} disabled={busyId === c.agendaId}>Accept</Button>
                            <Button size="sm" variant="secondary" onClick={() => onCandidate(c, 'retired')} disabled={busyId === c.agendaId}>Reject</Button>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary shrink-0">
                            {!c.agendaId ? 'Not saved yet' : c.status === 'active' ? 'Now watched' : c.status === 'retired' ? 'Rejected' : c.status}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Part>
            )}

            {theirs.length > 0 && (
              <Part title="What competitors are posting">
                <div className="grid gap-3 lg:grid-cols-2">
                  {theirs.map(g => (
                    <div key={g.competitor} className="bg-white border border-border p-4 min-w-0">
                      <p className="text-[15px] font-semibold text-text">{g.competitor}</p>
                      <ul className="mt-2 space-y-1.5">
                        {g.items.map((it, i) => <Piece key={i} p={{ channel: it.platform, summary: it.text, url: it.url, date: it.date }} />)}
                      </ul>
                    </div>
                  ))}
                </div>
              </Part>
            )}
          </div>
        )}

        {/* Market & events */}
        {tabs.some(t => t.key === 'market') && (
          <div role="tabpanel" className={panel('market')}>
            {printTitle('market')}
            {showEvents && !storeLoaded && (
              <Part title="Events and expos">
                <div aria-busy="true" className="space-y-3"><Skeleton className="h-24 w-full" /></div>
              </Part>
            )}
            {showEvents && storeLoaded && events.count > 0 && (
              <Part title="Events and expos" count={events.count}
                helper="Shows and conferences where our buyers gather. Mark whether we are going so the team knows.">
                {events.soon.length > 0 && (
                  <div className="space-y-3"><SubHead>Next 90 days</SubHead>
                    <Stack>{events.soon.map((e, i) => <EventCard key={e.id || `s${i}`} e={e} canEdit={intel.available} onDecision={onDecision} />)}</Stack>
                  </div>
                )}
                {events.later.length > 0 && (
                  <div className="space-y-3 pt-2"><SubHead>Later this year — stands and deadlines to book now</SubHead>
                    <Stack>{events.later.map((e, i) => <EventCard key={e.id || `l${i}`} e={e} canEdit={intel.available} onDecision={onDecision} />)}</Stack>
                  </div>
                )}
                {events.recent.length > 0 && (
                  <div className="space-y-3 pt-2"><SubHead>Recently — what happened</SubHead>
                    <Stack>{events.recent.map((e, i) => <EventCard key={e.id || `r${i}`} e={e} recent />)}</Stack>
                  </div>
                )}
              </Part>
            )}
            {/* Holidays and seasonal dates, kept apart from the expos: nobody
                exhibits at a public holiday. */}
            {showEvents && storeLoaded && events.dates.length > 0 && (
              <Part title="Dates to plan content around" count={events.dates.length}>
                <ul className="bg-white border border-border divide-y divide-border max-w-[72ch]">
                  {events.dates.map((d, i) => (
                    <li key={i} className="px-4 py-2.5 text-[15px] text-text leading-relaxed">
                      <span className="font-semibold tabular-nums">{fmtDate(d.start)}</span> · {d.name}
                      {d.recommendation && <span className="block text-sm text-text-secondary">{d.recommendation}</span>}
                    </li>
                  ))}
                </ul>
              </Part>
            )}
            {show('market') && visibleNotes.length > 0 && (
              <Part title="Market and technical news" count={visibleNotes.length}
                helper="Regulations, standards, technology and giga-projects.">
                <Stack>{visibleNotes.map((note, i) => <Note key={i} n={note} now={now} />)}</Stack>
              </Part>
            )}
            {show('global') && world.items.length > 0 && (
              <Part title="Global industry" count={world.items.length}
                helper="What international manufacturers, prices and standards are doing — usually a sign of what reaches us later.">
                <Stack>{world.items.map((f, i) => <Note key={i} n={asNote(f, now)} now={now} />)}</Stack>
              </Part>
            )}
            {show('poles') && poles.items.length > 0 && (
              <Part title="Smart poles" count={poles.items.length}
                helper="Our municipal line, kept on its own because its buyer is a city rather than an architect or consultant.">
                <Stack>{poles.items.map((f, i) => <Note key={i} n={asNote(f, now)} now={now} />)}</Stack>
              </Part>
            )}
          </div>
        )}

        {/* Sources & method */}
        <div role="tabpanel" className={panel('method')}>
          {printTitle('method')}
          <Part title="How this research went" helper={[status?.label, reading].filter(Boolean).join(' · ')}>
            <div className="bg-white border border-border p-4 sm:p-5 space-y-5">
              {report.repetition && <p className="text-sm text-amber-700 max-w-[72ch]">{report.repetition}</p>}
              {faults.length > 0 && (
                <div className="max-w-[72ch]">
                  <SubHead>What did not complete</SubHead>
                  <ul className="mt-2 space-y-1.5">{faults.map((f, i) => <li key={i} className="text-sm text-text-secondary leading-relaxed">{f}</li>)}</ul>
                </div>
              )}
              {states.length > 0 && (
                <div>
                  <SubHead>Topics it checked</SubHead>
                  <div className="mt-2 space-y-2">
                    {states.map(s => (
                      <div key={s.key} className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-3 gap-y-1 text-sm min-w-0">
                        <span className={`px-1.5 py-0.5 border text-[11px] font-semibold shrink-0 w-[150px] text-center ${TOPIC_STATE[s.state]?.tone || ''}`}>{TOPIC_STATE[s.state]?.label || s.state}</span>
                        <span className="text-text font-medium sm:w-[160px] shrink-0 truncate">{s.label}</span>
                        <span className="text-text-secondary truncate hidden md:block">{s.state === 'failed' ? 'Could not be checked this time.' : s.question}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {open.length > 0 && (
                <div className="max-w-[72ch]">
                  <SubHead>Still unanswered</SubHead>
                  <p className="text-xs text-text-tertiary mt-1 mb-2">Raised by earlier research and not yet resolved.</p>
                  <ul className="space-y-2">
                    {open.map((item, i) => (
                      <li key={i} className="text-sm text-text-secondary leading-relaxed">
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
                <div className="max-w-[72ch]">
                  <SubHead>Deadlines that have passed</SubHead>
                  <div className="mt-2 space-y-1.5">
                    {passed.map((f, i) => (
                      <p key={i} className="text-sm text-text-tertiary"><span className="line-through">{f.headline}</span> · {deadlineLabel(f, now)} · {teamsOf(f).map(t => TEAM_LABEL[t] || t).join(', ')}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Part>

          <Part title="All sources" count={sources.length || null}
            helper={sources.length ? `Every page this research quotes, checked on ${fmtDate(run.started_at)}.` : null}>
            {sources.length ? (
              <ul className="bg-white border border-border divide-y divide-border-light">
                {sources.map(s => (
                  <li key={s.url} className="px-4 py-2 text-sm leading-relaxed flex flex-col sm:flex-row sm:gap-3 min-w-0">
                    <span className="text-text-tertiary shrink-0 sm:w-[160px] truncate">{s.domain}</span>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-text underline underline-offset-2 min-w-0 truncate">
                      {s.title || s.url}
                    </a>
                  </li>
                ))}
              </ul>
            ) : <Quiet>This research does not quote any web pages.</Quiet>}
          </Part>

          <section data-print-hide>
            <Card className="p-0 overflow-hidden">
              <details className="group">
                <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3 hover:bg-surface-subtle">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-text leading-tight">What the research watches</h3>
                    <p className="text-sm text-text-secondary mt-1 leading-relaxed">The competitors and standing questions the next research will look at. Add, accept or remove them here.</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-text-secondary mt-0.5">
                    <span className="group-open:hidden">Show</span>
                    <span className="hidden group-open:inline">Hide</span>
                  </span>
                </summary>
                <div className="p-4 sm:p-5 border-t border-border bg-surface-subtle"><AgentSteering /></div>
              </details>
            </Card>
          </section>
        </div>
      </div>
    </div>
  )
}
