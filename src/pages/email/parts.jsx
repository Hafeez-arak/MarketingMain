import { InfoDot, Skeleton } from '../../components/ui/index'
import { STATUSES } from '../../lib/email/contacts'
import { GROUP_COLORS } from './format'

// ─── Small pieces shared by the Email tabs ─────────────────────────────────

const AUDIENCE_TAG = {
  marketing: 'bg-sage-100 text-sage-700',
  cold: 'bg-sky-50 text-sky-700',
}

export function AudienceTag({ audience }) {
  return (
    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap ${AUDIENCE_TAG[audience] || 'bg-stone-100 text-stone-600'}`}>
      {audience === 'cold' ? 'Outreach' : 'Newsletter'}
    </span>
  )
}

const STATUS_TONE = {
  green: 'bg-sage-100 text-sage-700', gray: 'bg-stone-100 text-stone-600', red: 'bg-red-50 text-red-600',
}

export function ContactStatus({ status }) {
  const s = STATUSES[status] || STATUSES.active
  return (
    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap ${STATUS_TONE[s.tone]}`}>
      {s.label}
    </span>
  )
}

const CAMPAIGN_STATUS = {
  draft:     { label: 'Draft',     cls: 'bg-stone-100 text-stone-600' },
  scheduled: { label: 'Scheduled', cls: 'bg-sky-50 text-sky-700' },
  sending:   { label: 'Sending',   cls: 'bg-amber-100 text-amber-800' },
  sent:      { label: 'Sent',      cls: 'bg-sage-100 text-sage-700' },
  paused:    { label: 'Paused',    cls: 'bg-stone-100 text-stone-600' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-600' },
}

export function CampaignStatus({ status }) {
  const s = CAMPAIGN_STATUS[status] || CAMPAIGN_STATUS.draft
  return <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] leading-[1.4] whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

export function GroupChip({ group }) {
  if (!group) return null
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-semibold bg-surface-subtle text-text-secondary border border-border whitespace-nowrap max-w-[140px]">
      <span className={`w-1.5 h-1.5 flex-shrink-0 ${GROUP_COLORS[group.color] || GROUP_COLORS.steel}`} />
      <span className="truncate">{group.name}</span>
    </span>
  )
}

/** A KPI tile. `hint` is never optional: a number needs to say what it counts. */
export function Stat({ label, value, hint, info, loading = false, tone = '' }) {
  return (
    <div className="bg-white px-4 py-3 min-w-0">
      <p className="text-[10px] font-semibold text-text-tertiary uppercase tracking-wide flex items-center gap-1">
        {label}{info && <InfoDot label={label} what={info} />}
      </p>
      {loading
        ? <Skeleton className="h-6 w-16 mt-1" />
        : <p className={`text-lg font-bold mt-0.5 tabular-nums ${tone || 'text-text'}`}>{value}</p>}
      <p className="text-[10px] text-text-tertiary mt-0.5 leading-relaxed">{hint}</p>
    </div>
  )
}

/** The second row of tabs inside a tab (Contacts: People / Groups). */
export function SubTabs({ items, value, onChange }) {
  return (
    <div className="flex gap-4 border-b border-border">
      {items.map(it => (
        <button key={it.key || 'main'} type="button" onClick={() => onChange(it.key)}
          className={`pb-2 -mb-px text-xs font-semibold border-b-2 transition-colors ${value === it.key
            ? 'border-amber-700 text-text' : 'border-transparent text-text-tertiary hover:text-text'}`}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

/** A line of text that says it is a warning, without shouting. */
export function Notice({ tone = 'amber', title, children, action }) {
  const tones = {
    amber: 'bg-amber-50 border-amber-200 border-l-amber-700',
    red: 'bg-red-50 border-red-200 border-l-red-500',
    sky: 'bg-sky-50 border-sky-200 border-l-sky-600',
    sage: 'bg-sage-50 border-sage-200 border-l-sage-600',
  }
  return (
    <div className={`border border-l-2 px-4 py-3 flex items-start justify-between gap-4 ${tones[tone]}`}>
      <div className="min-w-0 text-xs text-text-secondary leading-relaxed">
        {title && <p className="font-semibold text-text text-sm mb-0.5">{title}</p>}
        {children}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  )
}

const ICONS = {
  mail: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
  users: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  folder: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>,
  send: <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>,
  plus: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>,
  trash: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>,
  back: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>,
  spark: <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/></svg>,
}

/** The section's icons, by name. */
export function EIcon({ name }) {
  return ICONS[name] || null
}
