import { ALL_PAGES, SECTIONS, canOpen, canVisit } from '../modules'
import { normalizeSearch } from '../contacts/logic'

// ─── The universal search (Ctrl/Cmd+K), v2 shell ───────────────────────────
// 2026-10-28, docs/SHELL.md. One entry, search(query, who, ctx), asks a list
// of PROVIDERS, one per module, and returns their results in groups:
//
//   pages      every page the person may visit (lib/modules.js), in the
//              browser, at once
//   sales      leads                      ┐ one SQL function each
//   crm        opportunities              │
//   catalog    items                      │ (20261127_shell_2_search.sql),
//   contacts   organisations and people   │ run as the person so the
//   hr         employees                  │ module's own RLS decides, and
//   tasks      tasks                      │ asked only when the person can
//   requests   requests                   ┘ open that module at all
//
// A new module adds one provider here (and one SQL function): nothing in
// the palette changes.
//
// MODES is where the palette's modes live. Today there is one, 'search'.
// The company assistant's "ask" mode (built last, by the owner's order) is
// a second entry with its own runner over the same input; the palette
// already reads its runner from here, so adding it is not a rewrite.
//
// Pure apart from the injected `ctx.call(rpc, query, limit)`, so ranking,
// grouping and access filtering are tested (search.test.js) without a
// database; lib/shell/client.js supplies the real call.

/** Shortest query sent to the database: one letter matches half the book. */
export const MIN_RECORD_QUERY = 2
/** At most this many results in a group. */
export const PER_GROUP = 5
export const PAGES_MAX = 6

/** The groups, in the order the palette shows them. */
export const GROUPS = [
  { key: 'pages', en: 'Pages', ar: 'الصفحات' },
  { key: 'leads', en: 'Leads', ar: 'العملاء المحتملون' },
  { key: 'opportunities', en: 'Opportunities', ar: 'الفرص البيعية' },
  { key: 'items', en: 'Catalog items', ar: 'أصناف الكتالوج' },
  { key: 'organisations', en: 'Organisations', ar: 'الجهات' },
  { key: 'people', en: 'People', ar: 'الأشخاص' },
  { key: 'employees', en: 'Employees', ar: 'الموظفون' },
  { key: 'tasks', en: 'Tasks', ar: 'المهام' },
  { key: 'requests', en: 'Requests', ar: 'الطلبات' },
]

const q = encodeURIComponent
const pick = (lang, en, ar) => (lang === 'ar' && ar ? ar : en || '')

/**
 * Record providers: which module, which SQL function, and how one of its
 * rows becomes a result (its group, words and the page that opens it).
 */
export const PROVIDERS = [
  {
    key: 'sales', section: 'sales', rpc: 'shell_search_leads',
    // A lead on the pipeline opens there; one still in the inbox opens the
    // Leads list searched for it (it has no page of its own).
    item: (r, lang) => ({
      group: 'leads', icon: 'funnel', title: r.title, detail: pick(lang, r.detail, r.detail_ar),
      to: r.meta?.stage ? `/sales/leads?view=pipeline&lead=${r.id}`
        : `/sales/leads?q=${q(r.meta?.email || r.meta?.company || r.meta?.name || r.title || '')}`,
    }),
  },
  {
    key: 'crm', section: 'crm', rpc: 'shell_search_crm',
    item: (r, lang) => ({ group: 'opportunities', icon: 'kanban', title: r.title, detail: pick(lang, r.detail, r.detail_ar), to: `/crm/lead?id=${r.id}` }),
  },
  {
    key: 'catalog', section: 'catalog', rpc: 'shell_search_catalog',
    item: (r, lang) => ({ group: 'items', icon: 'box', title: r.title, detail: pick(lang, r.detail, r.detail_ar), to: `/catalog/item?id=${r.id}` }),
  },
  {
    key: 'contacts', section: 'contacts', rpc: 'shell_search_contacts',
    // A person opens their organisation's page; one on their own, the
    // People list searched for them.
    item: (r, lang) => r.kind === 'org'
      ? { group: 'organisations', icon: 'contacts', title: pick(lang, r.title, r.title_ar), detail: pick(lang, r.detail, r.detail_ar), to: `/contacts/org?id=${r.id}` }
      : { group: 'people', icon: 'users', title: pick(lang, r.title, r.title_ar), detail: pick(lang, r.detail, r.detail_ar),
          to: r.meta?.org_id ? `/contacts/org?id=${r.meta.org_id}` : `/contacts/people?q=${q(r.title || '')}` },
  },
  {
    key: 'hr', section: 'hr', rpc: 'shell_search_hr',
    item: (r, lang) => ({ group: 'employees', icon: 'id-card', title: pick(lang, r.title, r.title_ar), detail: pick(lang, r.detail, r.detail_ar), to: `/hr/employee?id=${r.id}` }),
  },
  {
    key: 'tasks', section: null, rpc: 'shell_search_tasks',
    item: r => ({ group: 'tasks', icon: 'check-circle', title: r.title, detail: '', to: `/tasks?id=${r.id}` }),
  },
  {
    key: 'requests', section: null, rpc: 'shell_search_requests',
    item: r => ({ group: 'requests', icon: 'check-square', title: r.title, detail: '', to: `/requests?id=${r.id}` }),
  },
]

/** The record providers this person may ask: their module is open to them. */
export function providersFor(who = {}) {
  return PROVIDERS.filter(p => !p.section || canOpen(SECTIONS.find(s => s.key === p.section), who))
}

/** 0 a text is the query, 1 starts with it, 2 has a word starting with it, 3 contains it, 4 not at all. Folded. */
export function scoreText(query, texts = []) {
  const fq = normalizeSearch(query)
  if (!fq) return 4
  let best = 4
  for (const t of texts) {
    const n = normalizeSearch(t)
    if (!n) continue
    const s = n === fq ? 0 : n.startsWith(fq) ? 1 : ` ${n}`.includes(` ${fq}`) ? 2 : n.includes(fq) ? 3 : 4
    if (s < best) best = s
  }
  return best
}

/** Does every word of the query appear somewhere in these texts (folded)? */
export function hitsAll(query, texts = []) {
  const words = normalizeSearch(query).split(' ').filter(Boolean)
  const hay = normalizeSearch(texts.filter(Boolean).join(' '))
  return words.length > 0 && words.every(w => hay.includes(w))
}

/**
 * Pages this person may visit that match, best first. Searched in both
 * languages whatever the app's language, under the page's and its
 * section's names; hidden pages (reached from inside a module) are left out.
 */
export function searchPages(query, who = {}, lang = 'en') {
  const sectionOfKey = key => SECTIONS.find(s => s.key === key)
  return ALL_PAGES
    .filter(pg => !pg.hidden && canVisit(pg.to, who))
    .map((pg, i) => {
      const s = sectionOfKey(pg.section)
      const names = [pg.label, pg.ar]
      const all = [...names, s?.label, s?.ar]
      if (!hitsAll(query, all)) return null
      // A page found by its section's name ranks after every one found by its own.
      const own = scoreText(query, names)
      const score = own < 4 ? own : 4 + scoreText(query, [s?.label, s?.ar])
      return {
        key: `page:${pg.to}`, group: 'pages', icon: pg.icon, to: pg.to, score, order: i,
        title: pick(lang, pg.label, pg.ar), detail: s ? pick(lang, s.label, s.ar) : '',
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, PAGES_MAX)
}

/**
 * Results into the palette's groups, in GROUPS order, empty groups left
 * out, at most `per` in each, and only links this person may visit.
 */
export function groupResults(items = [], who = {}, lang = 'en', { per = PER_GROUP } = {}) {
  return GROUPS
    .map(g => ({
      key: g.key, label: pick(lang, g.en, g.ar),
      items: items.filter(it => it.group === g.key && canVisit(it.to.split('?')[0], who)).slice(0, g.key === 'pages' ? PAGES_MAX : per),
    }))
    .filter(g => g.items.length)
}

/** A provider's rows as results, its database rank kept as the order. */
export function recordItems(provider, rows = [], lang = 'en') {
  return rows
    .map((r, i) => ({ ...provider.item(r, lang), key: `${provider.key}:${r.kind || ''}:${r.id}`, score: Number(r.rank) || 0, order: i }))
    .filter(it => it.title)
    .sort((a, b) => a.score - b.score || a.order - b.order)
}

/**
 * The one entry. `ctx`: { lang, call(rpc, query, limit) → Promise<rows> }.
 * Resolves to { groups, failed } where `failed` lists the providers whose
 * call failed, so the palette can say so instead of showing "no results".
 * `ctx.onPages(groups)` (optional) receives the page results before the
 * database answers, so they show at once.
 */
export async function search(query, who = {}, ctx = {}) {
  const { lang = 'en', call, onPages, per = PER_GROUP } = ctx
  const text = String(query || '').trim()
  if (!text) return { groups: [], failed: [] }
  const pages = searchPages(text, who, lang)
  onPages?.(groupResults(pages, who, lang, { per }))
  if (!call || normalizeSearch(text).length < MIN_RECORD_QUERY) return { groups: groupResults(pages, who, lang, { per }), failed: [] }
  const failed = []
  const records = await Promise.all(providersFor(who).map(async p => {
    try {
      return recordItems(p, await call(p.rpc, text, per), lang)
    } catch {
      failed.push(p.key)
      return []
    }
  }))
  return { groups: groupResults([...pages, ...records.flat()], who, lang, { per }), failed }
}

/** The palette's modes. One for now; see the header for the assistant's. */
export const MODES = { search }
