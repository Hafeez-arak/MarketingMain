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
import { fetchAgenda, setAgendaStatus, SOURCE_TYPES } from '../../lib/agentAgenda'
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
// One page, read top to bottom, in the order a marketer asks the questions:
//
//   1. AT A GLANCE   one card: when, whether the run worked, the headline,
//                    the key takeaways and counts that jump to the detail
//   2. THE DETAIL    every section on the same page — do next, content ideas,
//                    website, leads, competitors, market and events, sources
//                    and method — with a contents list down the side that
//                    shows the counts and jumps to each one.
//
// Rebuilt 2026-10-15 on the owner's brief: keep all the depth, lose the mess.
// Tabs (#224) hid each kind of work behind a click and "Read more" / "Show
// more" hid the detail behind another, so reading one finding could take
// three. Now every finding is shown whole; only its source links fold away,
// and those print in full regardless. "Why it matters" and "What to do" sit
// side by side on a wide screen, which is most of what keeps the page short.
//
// A team filter and a business filter, in one small Filter menu, narrow every
// section at once. Every section is built by src/lib/marketReport.js, which
// the printable brief also uses, so the screen and the PDF never disagree.
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

/** "Why it matters" / "What to do" — a labelled block, so the two never run together. */
function Block({ label, children, act = false }) {
  if (!children) return null
  return (
    <div className={act ? 'border-l-2 border-amber-600 bg-amber-50/70 px-3 py-2' : 'border-l-2 border-border px-3 py-0.5'}>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
      <p dir="auto" className="mt-0.5 text-sm leading-relaxed text-text break-words">{children}</p>
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
  const [open, setOpen] = useState(false)
  const links = sources.slice(0, 8)
  if (!pieces.length && !links.length) return null
  const n = pieces.length || links.length
  return (
    <div>
      <button data-print-hide type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-semibold text-text-tertiary hover:text-text">
        {open ? 'Hide sources' : `Sources (${n})`}
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <p className="hidden print:block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1.5">Sources</p>
      <div className={`${open ? 'mt-1.5' : 'hidden'} print:block`}>
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
// Everything is on the card: the whole title, the whole summary, "why it
// matters" and "what to do" side by side on a wide screen, then any detail.
// Only source links fold away (see Sources). Nothing is cut short, so no
// finding takes a click to read.

function ItemCard({ badges, title, titleHref, summary, meta, why, whyLabel = 'Why it matters', todo, todoLabel = 'What to do', aside, more, footer, number, children }) {
  const indent = number != null ? 'sm:ml-9' : ''
  const heading = <h4 dir="auto" className="text-[15px] font-semibold text-text leading-snug break-words">{title}</h4>
  return (
    <article data-print-keep className="bg-white border border-border p-4 min-w-0">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        {number != null && (
          <span className="shrink-0 w-6 h-6 bg-amber-700 text-white text-xs font-bold flex items-center justify-center tabular-nums">{number}</span>
        )}
        <div className="min-w-0 flex-1">
          {badges && <div className="flex items-center gap-1.5 flex-wrap mb-1.5">{badges}</div>}
          {titleHref
            ? <a href={titleHref} target="_blank" rel="noopener noreferrer" className="hover:underline">{heading}</a>
            : heading}
          {summary && <p dir="auto" className="text-sm text-text-secondary mt-1 leading-relaxed break-words">{summary}</p>}
          {meta && <div className="mt-1">{meta}</div>}
        </div>
        {aside && <div className="shrink-0 sm:max-w-[200px] min-w-0">{aside}</div>}
      </div>
      {(why || todo) && (
        <div className={`mt-3 grid gap-2.5 ${why && todo ? 'lg:grid-cols-2' : ''} ${indent}`}>
          <Block label={whyLabel}>{why}</Block>
          <Block label={todoLabel} act>{todo}</Block>
        </div>
      )}
      {children && <div className={`mt-3 ${indent}`}>{children}</div>}
      {more && <div className={`mt-3 space-y-2 ${indent}`}>{more}</div>}
      {footer && <div className={`mt-2.5 text-xs text-text-tertiary ${indent}`}>{footer}</div>}
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
      ) : e.id && !recent && e.decision && e.decision !== 'undecided' ? (
        // Read only (the sales app): what marketing decided, as a fact.
        <p className="text-xs text-text-tertiary sm:text-right sm:w-[180px]">We are {e.decision}</p>
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

// The search rows, as one list rather than a card each: a query is a line of
// numbers and a fix, and eleven cards of it was most of the page's length.
// Nothing is cut — the finding, its detail and what to do are all there. The
// business chip shows only when the row matched a business line — an
// unclassified row shows nothing rather than a made-up "General".
function SearchList({ rows, lineLabel }) {
  // Rows of the same kind carry the model's explanation word for word ("Google
  // already treats us as a candidate…"), so it is said once per group, above
  // the rows it explains, instead of once per row. Order is kept: a group sits
  // where its first row was.
  const groups = []
  for (const r of rows) {
    const g = r.detail && groups.find(x => x.detail === r.detail)
    if (g) g.rows.push(r)
    else groups.push({ detail: r.detail || '', rows: [r] })
  }
  return (
    <ul className="bg-white border border-border divide-y divide-border-light">
      {groups.map((g, gi) => {
        const shared = g.rows.length > 1 && g.detail
        return [
          shared && (
            <li key={`g${gi}`} className="px-4 py-2 bg-surface-subtle">
              <p dir="auto" className="text-[13px] text-text-secondary leading-relaxed">{g.detail}</p>
            </li>
          ),
          ...g.rows.map((r, i) => (
            <li key={`${gi}-${i}`} data-print-keep className="px-4 py-3 grid gap-x-6 gap-y-2 lg:grid-cols-2 min-w-0">
              <div className="min-w-0">
                {r.line && lineLabel(r.line) && <div className="mb-1"><Chip>{lineLabel(r.line)}</Chip></div>}
                <p dir="auto" className="text-sm font-semibold text-text leading-snug break-words">{r.headline}</p>
                {r.detail && !shared && <p dir="auto" className="text-[13px] text-text-secondary leading-relaxed mt-0.5 break-words">{r.detail}</p>}
              </div>
              {r.action && (
                <div className="border-l-2 border-amber-600 pl-3 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">What to do</p>
                  <p dir="auto" className="text-[13px] text-text leading-relaxed mt-0.5 break-words">{r.action}</p>
                </div>
              )}
            </li>
          )),
        ]
      })}
    </ul>
  )
}

// A long list shows its first few items whole, and one button for the rest —
// one click per list, instead of one per item. Paper always gets the lot.
function Limited({ items, limit = 5, render, noun = 'items', className = 'space-y-3' }) {
  const [all, setAll] = useState(false)
  const extra = items.length - limit
  return (
    <div className="space-y-3">
      <div className={className}>
        {items.map((it, i) => (
          <div key={i} className={!all && i >= limit ? 'hidden print:block' : ''}>{render(it, i)}</div>
        ))}
      </div>
      {extra > 0 && (
        <button data-print-hide type="button" onClick={() => setAll(a => !a)} aria-expanded={all}
          className="w-full border border-dashed border-border bg-white/60 py-2 text-sm font-semibold text-text-secondary hover:text-text hover:border-border-strong">
          {all ? 'Show fewer' : `Show all ${items.length} ${noun}`}
        </button>
      )}
    </div>
  )
}

// ─── What the research watches, read only (the sales app, 2026-10-19) ──────
// The marketing page edits this list in AgentSteering; the sales team only
// needs to know where the leads come from, so here it is a plain list. The
// order is closest-to-a-lead first: a tender portal names a job, a hashtag
// only hints at one.
const WATCH_ORDER = ['tender_portal', 'government', 'exchange', 'website', 'news', 'linkedin', 'instagram', 'x', 'hashtag', 'keyword']
const WATCH_GROUP = {
  tender_portal: 'Tender portals', government: 'Government', exchange: 'Stock exchange filings', website: 'Project websites',
  news: 'News sites', linkedin: 'LinkedIn', instagram: 'Instagram', x: 'X', hashtag: 'Hashtags', keyword: 'Search phrases',
}

/** A link for a source when its subject is an address or a handle; null when it is a name or a phrase. */
function watchHref(type, subject) {
  const s = String(subject || '').trim()
  if (/^https?:\/\//i.test(s)) return s
  const handle = s.match(/^@([\w.]+)$/)?.[1]
  if (handle && type === 'instagram') return `https://instagram.com/${handle}`
  if (handle && type === 'x') return `https://x.com/${handle}`
  if (type !== 'hashtag' && type !== 'keyword' && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return `https://${s}`
  return null
}

function WatchList({ sources, competitors }) {
  const groups = WATCH_ORDER
    .concat(SOURCE_TYPES.map(([k]) => k).filter(k => !WATCH_ORDER.includes(k)))
    .map(key => ({
      key,
      rows: sources.filter(r => (r.source_type || 'website') === key)
        .sort((a, b) => (a.tier || 2) - (b.tier || 2) || String(a.subject).localeCompare(String(b.subject))),
    }))
    .filter(g => g.rows.length)
  const rivals = [...competitors].sort((a, b) => String(a.subject).localeCompare(String(b.subject)))
  return (
    <div className="space-y-6">
      {groups.length > 0 && (
        <div className="space-y-3">
          <SubHead>Where it looks for leads · {sources.length}</SubHead>
          <div className="grid gap-3 lg:grid-cols-2 items-start">
            {groups.map(g => (
              <div key={g.key} className="bg-white border border-border min-w-0">
                <p className="px-4 pt-3 pb-1 text-sm font-semibold text-text">{WATCH_GROUP[g.key] || g.key} <span className="font-normal text-text-tertiary tabular-nums">{g.rows.length}</span></p>
                <ul className="divide-y divide-border-light">
                  {g.rows.map(r => {
                    const href = watchHref(g.key, r.subject)
                    return (
                      <li key={r.id || r.subject} className="px-4 py-2 min-w-0">
                        {href
                          ? <a href={href} target="_blank" rel="noopener noreferrer" dir="auto" className="text-sm text-text underline underline-offset-2 decoration-border-strong hover:decoration-text break-words">{r.subject}</a>
                          : <span className="text-sm text-text break-words" dir="auto">{r.subject}</span>}
                        {r.why && <p className="text-xs text-text-secondary leading-relaxed mt-0.5" dir="auto">{r.why}</p>}
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
      {rivals.length > 0 && (
        <div className="space-y-3">
          <SubHead>Competitors it watches · {rivals.length}</SubHead>
          {/* Name and website only: the notes beside each rival are the
              research's own bookkeeping ("could not be identified", "renamed
              from"), not something a salesperson acts on. */}
          <ul className="bg-white border border-border grid sm:grid-cols-2 lg:grid-cols-3">
            {rivals.map(c => (
              <li key={c.id || c.subject} className="px-4 py-2 border-b border-border-light min-w-0">
                <span className="block text-sm text-text truncate" dir="auto">{c.subject}</span>
                {c.domain && <a href={`https://${c.domain}`} target="_blank" rel="noopener noreferrer" className="block text-xs text-text-tertiary underline underline-offset-2 truncate hover:text-text">{c.domain}</a>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

// Every quoted page, behind one button: a reference list, not reading.
function AllSources({ sources }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-2">
      <button data-print-hide type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1 text-sm font-semibold text-text-secondary hover:text-text">
        {open ? 'Hide the list' : `Show all ${sources.length} pages`}
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <ul className={`${open ? '' : 'hidden'} print:block bg-white border border-border divide-y divide-border-light`}>
        {sources.map(s => (
          <li key={s.url} className="px-4 py-2 text-sm leading-relaxed flex flex-col sm:flex-row sm:gap-3 min-w-0">
            <span className="text-text-tertiary shrink-0 sm:w-[160px] truncate">{s.domain}</span>
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-text-secondary hover:text-text underline underline-offset-2 min-w-0 truncate">
              {s.title || s.url}
            </a>
          </li>
        ))}
      </ul>
    </div>
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
        <p dir="auto" className="mt-0.5 text-sm text-text-secondary leading-relaxed break-words">{idea.angle}</p>
      )}
      {idea.suggested_format && <p className="mt-1"><Chip>{idea.suggested_format}</Chip></p>}
    </li>
  )
}

// The ideas that answer no single gap, as rows of one card: each is a title,
// an angle and the reason for it — reading, not a stack of boxes.
function IdeaList({ ideas }) {
  return (
    <ul className="bg-white border border-border divide-y divide-border-light">
      {ideas.map((idea, i) => {
        const ref = idea.answers_ref
        return (
          <li key={i} data-print-keep className="px-4 py-3 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <p dir="auto" className="text-sm font-semibold text-text leading-snug break-words">{idea.title || idea.angle}</p>
              {idea.suggested_format && <span className="shrink-0"><Chip>{idea.suggested_format}</Chip></span>}
            </div>
            {idea.title && idea.angle && <p dir="auto" className="text-[13px] text-text-secondary leading-relaxed mt-0.5 break-words">{idea.angle}</p>}
            {(ref?.kind === 'finding' && ref.headline) && (
              <p dir="auto" className="text-[13px] text-text-secondary leading-relaxed mt-1 break-words"><span className="font-semibold text-text">Based on: </span>{ref.headline}</p>
            )}
            {idea.rationale && (
              <p dir="auto" className="text-[13px] text-text-secondary leading-relaxed mt-1 break-words"><span className="font-semibold text-text">Why: </span>{idea.rationale}</p>
            )}
          </li>
        )
      })}
    </ul>
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

// ─── Sections and the contents list ────────────────────────────────────────

const TAB_DEFS = [
  { key: 'do', label: 'Do next', chip: n => (n === 1 ? 'thing to do next' : 'things to do next') },
  { key: 'content', label: 'Content & website', chip: n => (n === 1 ? 'content idea' : 'content ideas') },
  { key: 'leads', label: 'Leads & tenders', chip: n => (n === 1 ? 'open lead or tender' : 'open leads and tenders') },
  { key: 'competitors', label: 'Competitors', chip: n => (n === 1 ? 'competitor move' : 'competitor moves') },
  { key: 'market', label: 'Market & events', chip: n => (n === 1 ? 'market item or event' : 'market items and events') },
  { key: 'method', label: 'Sources & method', chip: null },
]

const sectionId = key => `research-${key}`

function scrollToSection(key) {
  document.getElementById(sectionId(key))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// Down the side on a wide screen, so jumping never covers a heading the way
// the old sticky bar across the top did. The counts are the sections' own.
function Contents({ tabs, active }) {
  return (
    <nav data-print-hide aria-label="Research sections" className="hidden lg:block sticky top-4 self-start">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-text-tertiary px-2 mb-1.5">On this page</p>
      <ul className="space-y-0.5">
        {tabs.map(t => (
          <li key={t.key}>
            <button type="button" onClick={() => scrollToSection(t.key)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 text-left text-sm border-l-2 transition-colors ${
                active === t.key
                  ? 'border-amber-700 text-text font-semibold bg-white'
                  : 'border-transparent text-text-secondary hover:text-text hover:bg-white'}`}>
              <span className="truncate">{t.label}</span>
              {t.count === null
                ? <span className="w-4 h-3 bg-surface-muted animate-pulse" aria-label="loading" />
                : t.count != null && t.count > 0 && <span className="text-xs tabular-nums text-text-tertiary">{t.count}</span>}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  )
}

// Both filters behind one small menu. The button says what is showing, so a
// narrowed page never passes for the whole report.
// What the sales app's Research page shows (2026-10-19): the "Sales" view
// without the two sections a salesperson cannot act on from there. Website is
// Google search numbers with a paid "Summarise" button; New competitors is an
// accept/reject queue that belongs to marketing.
const READ_ONLY_SECTIONS = ['top', 'sales', 'competitors', 'events', 'poles', 'sources']

function FilterMenu({ team, onTeam, lines, line, onLine, untagged, lockTeam = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const close = e => { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const teamLabel = TEAMS.find(t => t.key === team)?.label || 'Everyone'
  const lineName = line === 'all' ? '' : (lines.find(l => l.key === line)?.label || '')
  const narrowed = (!lockTeam && team !== 'all') || line !== 'all'
  // Locked to one team, the menu is only the business filter, so it is not
  // offered at all to a brand with one business.
  if (lockTeam && lines.length < 2) return null
  return (
    <div ref={ref} data-print-hide className="relative">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-sm transition-colors ${
          narrowed ? 'border-amber-600 bg-amber-50 text-text' : 'border-border bg-white text-text-secondary hover:text-text'}`}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M3 5h18M6 12h12M10 19h4" strokeLinecap="round" /></svg>
        {narrowed ? [lockTeam ? '' : teamLabel, lineName].filter(Boolean).join(' · ') : 'Filter'}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 border border-border bg-white p-3 shadow-sm space-y-3">
          {!lockTeam && (
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">For</span>
              <PillSelect value={team} onChange={e => onTeam(e.target.value)} className="w-full">
                {TEAMS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </PillSelect>
            </label>
          )}
          {/* Only when the run found more than one business line. A brand with
              one undivided business never sees a control that does nothing. */}
          {lines.length > 1 && (
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-tertiary mb-1">Business</span>
              <PillSelect value={line} onChange={e => onLine(e.target.value)} className="w-full">
                <option value="all">All</option>
                {lines.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}
              </PillSelect>
            </label>
          )}
          {line !== 'all' && untagged > 0 && (
            <p className="text-xs text-text-tertiary leading-relaxed">
              {plural(untagged, 'finding')} could not be tied to one business and only show under All.
            </p>
          )}
          {narrowed && (
            <button type="button" onClick={() => { if (!lockTeam) onTeam('all'); onLine('all') }}
              className="text-xs font-semibold text-text-secondary underline underline-offset-2 hover:text-text">Show everything</button>
          )}
        </div>
      )}
    </div>
  )
}

// One section of the page: a heading with its count, then its parts.
function Section({ tab, children }) {
  if (!tab) return null
  return (
    <section id={sectionId(tab.key)} className="scroll-mt-4 space-y-6 pt-6 border-t border-border first:border-t-0 first:pt-0">
      <h2 className="text-lg font-semibold text-text">
        {tab.label}
        {tab.count != null && tab.count > 0 && <span className="ml-2 text-sm font-medium text-text-tertiary tabular-nums">{tab.count}</span>}
      </h2>
      {children}
    </section>
  )
}

// ─── The tab ───────────────────────────────────────────────────────────────

/**
 * `readOnly` is the sales app's Research page: the same report, fixed to the
 * Sales view, with nothing that writes or costs money (no Run research, no
 * statuses, no event decisions, no Summarise, no watchlist).
 */
export function ResearchTab({ run, runs, lensRows, selectedId, onSelectRun, onRun, running, now, readOnly = false }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const report = useMemo(() => run?.report || {}, [run])
  const [params, setParams] = useSearchParams()

  const [team, setTeam] = useState(() => {
    if (readOnly) return 'sales'
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
  const [agendaSources, setAgendaSources] = useState([])
  const [storeLoaded, setStoreLoaded] = useState(false)
  const [busyId, setBusyId] = useState(null)
  // The one paid control on this tab: a three-sentence summary of the search
  // results, written on request rather than on every page view. It uses the
  // same route and renderer as the Analytics tab so the two never drift apart.
  const [explain, setExplain] = useState({ state: 'idle', points: [], error: '', cost: 0, capped: false, forRun: null })
  const [saveNote, setSaveNote] = useState('')
  const detailRef = useRef(null)
  const [active, setActive] = useState(null)

  useEffect(() => {
    if (!activeWorkspaceId) return undefined
    let alive = true
    Promise.all([fetchIntel(activeWorkspaceId, accessToken), fetchAgenda(activeWorkspaceId, accessToken)])
      .then(([i, a]) => {
        if (!alive) return
        setIntel(i)
        setAgendaCompetitors(a?.competitors || [])
        setAgendaSources(a?.sources || [])
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

  const show = key => (readOnly ? READ_ONLY_SECTIONS.includes(key) : sectionVisible(key, team))
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
      (show('poles') ? poles.items.length : 0) + (showEvents && storeLoaded ? events.count + (readOnly ? 0 : events.dates.length) : 0)
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
    // Read only, the last section is the sources and nothing of the method.
    return TAB_DEFS.filter(t => has[t.key]).map(t => ({
      ...t, count: counts[t.key], chipCount: chipCounts[t.key],
      ...(readOnly && t.key === 'method' ? { label: 'Sources' } : {}),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, storeLoaded, visibleTop, visibleSales, sales.closed, visibleMoves, proposedCandidates, candidates, plan,
    showSearch, searchCount, ours, theirs, showDirection, showEvents, events, visibleNotes, world, poles, sources])

  // ?section= still opens the page at a section, so an old link lands where
  // it pointed. Read once: scrolling afterwards is the reader's business.
  const asked = params.get('section')
  const askedOnce = useRef(false)
  useEffect(() => {
    if (askedOnce.current || !asked || !tabs.some(t => t.key === asked)) return
    askedOnce.current = true
    requestAnimationFrame(() => document.getElementById(sectionId(asked))?.scrollIntoView({ block: 'start' }))
    setParams(prev => { const n = new URLSearchParams(prev); n.delete('section'); return n }, { replace: true })
  }, [asked, tabs, setParams])
  const pickTab = useCallback(key => scrollToSection(key), [])

  // Which section the reader is in, for the contents list. The page scrolls
  // inside the app shell, not the window, so this listens on that scroller.
  useEffect(() => {
    let el = detailRef.current?.parentElement
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement
    const scroller = el || window
    const onScroll = () => {
      const top = (scroller === window ? 0 : scroller.getBoundingClientRect().top) + 120
      let current = tabs[0]?.key || null
      for (const t of tabs) {
        const node = document.getElementById(sectionId(t.key))
        if (node && node.getBoundingClientRect().top <= top) current = t.key
      }
      setActive(current)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [tabs])

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
          action={readOnly ? null : <Button onClick={onRun} disabled={running}>Run research</Button>}
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

  // The takeaways are the report's own top items, first sentence only — the
  // glance card never says anything the tabs below do not.
  const takeaways = [
    ...(show('top') ? visibleTop.map(t => ({ text: t.finding, tab: 'do' })) : []),
    ...(show('recs') ? plan.blocks.map(b => ({ text: b.gap?.gap, tab: 'content' })) : []),
    ...(show('competitors') ? visibleMoves.map(m => ({ text: m.whatChanged ? `${m.competitor}: ${m.whatChanged}` : '', tab: 'competitors' })) : []),
  ].filter(t => String(t.text || '').trim()).slice(0, 4)
  const chips = tabs.filter(t => t.chip && t.chipCount !== 0)

  const tabOf = key => tabs.find(t => t.key === key)

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

        <h2 dir="auto" className="text-lg sm:text-xl font-semibold text-text mt-3 leading-snug max-w-[75ch]">{headline}</h2>

        {(failedRun || partRun(run)) && (
          <p className="text-sm text-amber-800 bg-amber-50/60 border-l-2 border-amber-600 px-3 py-2 mt-3 leading-relaxed max-w-[72ch]">
            {plainRunProblem(run.error)} {failedRun ? 'Anything it found before it stopped is below.' : 'Only our own numbers were updated this time.'}
          </p>
        )}
        {!failedRun && !partRun(run) && faults.length > 0 && (
          <p className="text-sm text-amber-800 mt-3 leading-relaxed max-w-[72ch]">
            Part of this research did not complete, so some sections may be thinner than usual.{' '}
            <button className="underline underline-offset-2" onClick={() => pickTab('method')}>What happened</button>
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
                  <button onClick={() => pickTab(t.tab)} dir="auto"
                    className="text-left text-sm text-text leading-relaxed hover:underline underline-offset-2 decoration-border-strong">
                    {/* The first sentence only: the whole finding is in its
                        section, one click away, and the summary card stays a
                        summary. */}
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
                  <button key={t.key} onClick={() => pickTab(t.key)}
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
      <div ref={detailRef} className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-8">
        <Contents tabs={tabs} active={active} />
        <div className="min-w-0 space-y-8">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-text-secondary">The full report, section by section.</p>
          <FilterMenu team={team} onTeam={chooseTeam} lines={lines} line={line} onLine={chooseLine} untagged={untagged} lockTeam={readOnly} />
        </div>

        {/* Do next */}
        <Section tab={tabOf('do')}>
            <Part title="Top priorities" helper="What most needs doing this week, most important first.">
              <Stack>{visibleTop.map((t, i) => <TopItem key={i} t={t} n={i + 1} />)}</Stack>
            </Part>
        </Section>

        {/* Content ideas */}
        <Section tab={tabOf('content')}>
            {show('recs') && plan.total > 0 && (
              <Part title="Content ideas" count={plan.total}
                helper="Where what the market wants and what we say do not line up, with content to close the gap.">
                {/* Above the ideas, not under them: with eight cards below,
                    the one control that starts work should not be the last
                    thing on the page. */}
                {plan.ideaCount > 0 && <div data-print-hide className="max-w-[72ch] [&>div]:mt-0 [&>div]:border-t-0 [&>div]:pt-0"><SendIdeasToPlan ideas={plan.ordered} /></div>}
                <Limited items={plan.blocks} noun="content ideas" render={block => <GapBlock block={block} />} />
                {plan.loose.length > 0 && (
                  <div className="space-y-3 pt-2">
                    {plan.blocks.length > 0 && <SubHead>More ideas from this research</SubHead>}
                    <IdeaList ideas={plan.loose} />
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
                        <SearchList rows={search.opportunities} lineLabel={lineLabel} />
                      </div>
                    )}
                    {search.movers.length > 0 && (
                      <div className="space-y-3 pt-1">
                        <SubHead>What changed</SubHead>
                        <SearchList rows={search.movers} lineLabel={lineLabel} />
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
        </Section>

        {/* Leads & tenders */}
        <Section tab={tabOf('leads')}>
            <Part title="Leads, tenders and projects" count={storeLoaded ? visibleSales.open.length : null}
              helper={sales.trackerAvailable
                ? `Every open opening we are tracking, not only this week’s.${readOnly ? '' : ' Set the status as you work each one.'}`
                : 'Openings found in this research. From the next research they are tracked week to week.'}>
              {!storeLoaded ? (
                <div className="space-y-3" aria-busy="true"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
              ) : visibleSales.open.length ? (
                <Stack>
                  {visibleSales.open.map((r, i) => (
                    <LeadCard key={r.id || `f${i}`} r={r} canEdit={intel.available && !readOnly} onStatus={onStatus} busyId={busyId} />
                  ))}
                </Stack>
              ) : <Quiet>No open leads, tenders or projects right now.</Quiet>}
              {storeLoaded && sales.closed.length > 0 && (
                <p className="text-sm text-text-tertiary max-w-[72ch]">
                  Closed: {sales.closed.map(c => `${c.name} (${c.status})`).join('; ')}.
                </p>
              )}
            </Part>
        </Section>

        {/* Competitors */}
        <Section tab={tabOf('competitors')}>
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
                          {c.why && <p dir="auto" className="mt-0.5 text-sm text-text-secondary leading-relaxed break-words">{c.why}</p>}
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
        </Section>

        {/* Market & events */}
        <Section tab={tabOf('market')}>
            {showEvents && !storeLoaded && (
              <Part title="Events and expos">
                <div aria-busy="true" className="space-y-3"><Skeleton className="h-24 w-full" /></div>
              </Part>
            )}
            {showEvents && storeLoaded && events.count > 0 && (
              <Part title="Events and expos" count={events.count}
                helper={`Shows and conferences where our buyers gather.${readOnly ? '' : ' Mark whether we are going so the team knows.'}`}>
                {events.soon.length > 0 && (
                  <div className="space-y-3"><SubHead>Next 90 days</SubHead>
                    <Stack>{events.soon.map((e, i) => <EventCard key={e.id || `s${i}`} e={e} canEdit={intel.available && !readOnly} onDecision={onDecision} />)}</Stack>
                  </div>
                )}
                {events.later.length > 0 && (
                  <div className="space-y-3 pt-2"><SubHead>Later this year — stands and deadlines to book now</SubHead>
                    <Stack>{events.later.map((e, i) => <EventCard key={e.id || `l${i}`} e={e} canEdit={intel.available && !readOnly} onDecision={onDecision} />)}</Stack>
                  </div>
                )}
                {events.recent.length > 0 && (
                  <div className="space-y-3 pt-2"><SubHead>Recently — what happened</SubHead>
                    <Limited items={events.recent} limit={3} noun="past events" render={e => <EventCard e={e} recent />} />
                  </div>
                )}
              </Part>
            )}
            {/* Holidays and seasonal dates, kept apart from the expos: nobody
                exhibits at a public holiday. */}
            {showEvents && !readOnly && storeLoaded && events.dates.length > 0 && (
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
                <Limited items={visibleNotes} noun="news items" render={note => <Note n={note} now={now} />} />
              </Part>
            )}
            {show('global') && world.items.length > 0 && (
              <Part title="Global industry" count={world.items.length}
                helper="What international manufacturers, prices and standards are doing — usually a sign of what reaches us later.">
                <Limited items={world.items} limit={3} noun="global items" render={f => <Note n={asNote(f, now)} now={now} />} />
              </Part>
            )}
            {show('poles') && poles.items.length > 0 && (
              <Part title="Smart poles" count={poles.items.length}
                helper="Our municipal line, kept on its own because its buyer is a city rather than an architect or consultant.">
                <Limited items={poles.items} limit={3} noun="smart pole items" render={f => <Note n={asNote(f, now)} now={now} />} />
              </Part>
            )}
        </Section>

        {/* Sources & method */}
        <Section tab={tabOf('method')}>
          {/* The run's housekeeping (what failed, what is still unanswered) is
              for the people who run the research, not for the sales app. */}
          {!readOnly && <Part title="How this research went" helper={[status?.label, reading].filter(Boolean).join(' · ')}>
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
          </Part>}

          {readOnly && storeLoaded && (agendaSources.some(r => r.status === 'active') || agendaCompetitors.some(c => c.status === 'active')) && (
            <Part title="What the research watches"
              helper="The places it reads for leads and tenders every week before searching the open web, and the competitors it follows.">
              <WatchList
                sources={agendaSources.filter(r => r.status === 'active')}
                competitors={agendaCompetitors.filter(c => c.status === 'active')} />
            </Part>
          )}

          <Part title="All sources" count={sources.length || null}
            helper={sources.length ? `Every page this research quotes, checked on ${fmtDate(run.started_at)}.` : null}>
            {sources.length ? (
              <AllSources sources={sources} />
            ) : <Quiet>This research does not quote any web pages.</Quiet>}
          </Part>

          {!readOnly && <section data-print-hide>
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
          </section>}
        </Section>
        </div>
      </div>
    </div>
  )
}
