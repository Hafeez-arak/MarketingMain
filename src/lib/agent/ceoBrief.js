// ─── The CEO's brief ───────────────────────────────────────────────────────
// 2026-10-18. The CEO asked for the important points in one or two pages.
// He does not want numbers every time; he cares about leads, money and how
// social media is doing.
//
// So the page has two parts, and they are made differently on purpose:
//
//   1. A strip of four one-line numbers (ceoKpis): computed here, in code,
//      from the facts. The model never writes a number into the strip.
//   2. The brief: what we found this week, what needs him, what to watch.
//      Written by the model FROM the same facts, in Arabic and English at
//      once so the language switch is instant. It is told to use at most one
//      number per point, and only numbers that appear in the facts.
//
// Pure: no IO. The gathering is in api/agent/_ceoBrief.js.

export const AREAS = ['leads', 'money', 'social', 'email', 'market', 'team']
export const TONES = ['good', 'watch', 'bad']

const DAY = 86_400_000

/** The week the brief covers: the seven days up to `now`, and the seven before. */
export function briefWindow(now = new Date()) {
  const to = now.getTime()
  return {
    days: 7,
    from: new Date(to - 7 * DAY).toISOString(),
    prevFrom: new Date(to - 14 * DAY).toISOString(),
    to: new Date(to).toISOString(),
  }
}

// ── Formatting, in both languages ──
// Western digits in Arabic too: it is how Saudi business writes figures, and
// it keeps a number identical across the two languages.

const group = n => Math.round(Number(n) || 0).toLocaleString('en-US')

/** SAR 30,355,000 -> { en: 'SAR 30.4M', ar: '30.4 مليون ريال' } */
export function money(sar) {
  const n = Number(sar) || 0
  const abs = Math.abs(n)
  const [v, en, ar] = abs >= 1e9 ? [n / 1e9, 'B', 'مليار']
    : abs >= 1e6 ? [n / 1e6, 'M', 'مليون']
      : abs >= 1e3 ? [n / 1e3, 'K', 'ألف']
        : [n, '', '']
  const num = abs >= 1e3 ? (Math.round(v * 10) / 10).toString() : group(n)
  return { en: `SAR ${num}${en}`, ar: `${num}${ar ? ` ${ar}` : ''} ريال` }
}

const signed = n => (n > 0 ? `+${group(n)}` : group(n))

/**
 * The four numbers across the top. Each is { key, label, value, sub, tone },
 * with label/value/sub as { ar, en }. A tile whose source is missing says so
 * rather than showing a zero.
 */
export function ceoKpis(facts = {}) {
  const tiles = []
  const L = facts.leads || {}
  const q = L.this_week?.qualified ?? null
  const qPrev = L.last_week?.qualified ?? null
  const unowned = L.this_week?.qualified_unassigned ?? 0
  tiles.push({
    key: 'leads',
    label: { en: 'Good enquiries this week', ar: 'استفسارات جيدة هذا الأسبوع' },
    value: q === null ? { en: '—', ar: '—' } : { en: group(q), ar: group(q) },
    sub: q === null
      ? { en: 'Leads could not be read', ar: 'تعذّرت قراءة الاستفسارات' }
      : {
          en: `${group(qPrev)} last week · ${unowned ? `${group(unowned)} with no owner` : 'all have an owner'}`,
          ar: `${group(qPrev)} الأسبوع الماضي · ${unowned ? `${group(unowned)} بلا مسؤول` : 'جميعها لها مسؤول'}`,
        },
    tone: q === null ? 'watch' : unowned > 0 ? 'bad' : q >= (qPrev || 0) ? 'good' : 'watch',
  })

  const M = facts.money || {}
  const open = M.targets?.open_value_sar
  const fresh = (M.opportunities_this_week || []).length
  tiles.push({
    key: 'money',
    label: { en: 'Open with key accounts', ar: 'فرص مفتوحة مع العملاء الرئيسيين' },
    value: open == null ? { en: '—', ar: '—' } : money(open),
    sub: {
      en: `${group(fresh)} new project${fresh === 1 ? '' : 's'} found this week`,
      ar: fresh === 1 ? 'مشروع جديد واحد هذا الأسبوع' : `${group(fresh)} مشاريع جديدة هذا الأسبوع`,
    },
    tone: open == null ? 'watch' : (M.targets?.next_step_overdue || 0) > 0 ? 'watch' : 'good',
  })

  const S = facts.social || {}
  if (S.available) {
    const followers = (S.instagram?.followers || 0) + (S.linkedin?.followers || 0)
    const growth = (S.instagram?.growth || 0) + (S.linkedin?.growth || 0)
    const posts = S.posts_this_week ?? 0
    tiles.push({
      key: 'social',
      label: { en: 'Social followers', ar: 'المتابعون على المنصات' },
      value: { en: group(followers), ar: group(followers) },
      sub: {
        en: `${signed(growth)} recently · ${posts ? `${group(posts)} post${posts === 1 ? '' : 's'} this week` : 'nothing posted this week'}`,
        ar: `${signed(growth)} مؤخرًا · ${posts ? `${group(posts)} منشور هذا الأسبوع` : 'لا منشورات هذا الأسبوع'}`,
      },
      tone: posts ? (growth > 0 ? 'good' : 'watch') : 'bad',
    })
  } else {
    tiles.push({
      key: 'social',
      label: { en: 'Social followers', ar: 'المتابعون على المنصات' },
      value: { en: '—', ar: '—' },
      sub: { en: 'Live social numbers are unavailable right now', ar: 'أرقام المنصات غير متاحة حاليًا' },
      tone: 'watch',
    })
  }

  const R = facts.requests || {}
  const openReq = (R.open || []).length
  const doneReq = (R.done_this_week || []).length
  tiles.push({
    key: 'requests',
    label: { en: 'Your open requests', ar: 'طلباتك المفتوحة' },
    value: { en: group(openReq), ar: group(openReq) },
    sub: { en: `${group(doneReq)} done this week`, ar: `${group(doneReq)} أُنجزت هذا الأسبوع` },
    tone: openReq && !doneReq ? 'watch' : 'good',
  })
  return tiles
}

// ── What the model returns ──

const bi = description => ({
  type: 'object',
  additionalProperties: false,
  required: ['ar', 'en'],
  description,
  properties: {
    ar: { type: 'string', description: 'In Arabic: Modern Standard Arabic, the register of a Saudi business memo.' },
    en: { type: 'string', description: 'The same point in plain English.' },
  },
})

export const CEO_BRIEF_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'needs_you', 'found', 'watch'],
    properties: {
      headline: bi('One sentence: how the week went for the company, the way you would say it to the CEO in the corridor.'),
      needs_you: {
        type: 'array',
        description: 'Up to three things that need the CEO himself: a decision, a push, a person to call. Not operational detail a manager should handle. Empty if nothing does.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['area', 'title', 'action'],
          properties: {
            area: { type: 'string', enum: AREAS },
            title: bi('What it is, in one short line.'),
            action: bi('What you suggest he does, in one line, starting with a verb.'),
          },
        },
      },
      found: {
        type: 'array',
        description: 'Three to six of the most important things found this week, most important first. Leads, money and social media matter most to him.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['area', 'tone', 'text'],
          properties: {
            area: { type: 'string', enum: AREAS },
            tone: { type: 'string', enum: TONES, description: 'good news, worth watching, or bad news.' },
            text: bi('One or two plain sentences. At most one number, and only a number that appears in the facts.'),
          },
        },
      },
      watch: {
        type: 'array',
        description: 'Up to three risks or things coming up that he should keep in mind. Empty if none.',
        items: bi('One sentence.'),
      },
    },
  },
}

/** Stable text for the cached prefix: who reads this and how to write for him. */
export const CEO_BRIEF_IDENTITY = [
  'You write the weekly brief for the CEO of this company.',
  '',
  'Who he is and what he wants:',
  '- He is busy. He wants the important points in one page, not data.',
  '- He cares most about leads (new business coming in and whether it is answered),',
  '  money (deals, pipeline, projects worth chasing) and how social media is doing.',
  '- He reads Arabic first. Every point is written in Arabic and in English.',
  '',
  'How to write:',
  '- Plain words. Short sentences. Say what it means for the business, not what the',
  '  table says. "We answered nobody new this week" beats "assignment rate 0%".',
  '- At most one number per point, and only numbers that appear in the facts you',
  '  are given. Never estimate, round up or invent a figure. If something is not in',
  '  the facts, leave it out rather than guess.',
  '- Western digits in both languages.',
  '- Arabic is written as a Saudi executive would read it, not as a translation of',
  '  the English. Company and project names stay as they are written in the facts.',
  '- Most important first. If the week was quiet, say so in one line; do not pad.',
  '- "Needs you" is only for what the CEO himself should decide or push: a person',
  '  to give ownership to, a client to call, a priority to set. Not tasks for staff.',
  '- If live social numbers are missing, do not mention social performance at all.',
].join('\n')

/** The user turn: the facts, as JSON, with the week named. */
export function ceoBriefPrompt(facts = {}) {
  return [
    `Write this week's brief. The week is ${String(facts.window?.from || '').slice(0, 10)} to ${String(facts.window?.to || '').slice(0, 10)}.`,
    'Everything you know about the week is in these facts. They were computed from the company\'s own records:',
    '',
    JSON.stringify(facts),
  ].join('\n')
}

const clipBi = (v, n = 400) => ({
  ar: String(v?.ar ?? '').trim().slice(0, n),
  en: String(v?.en ?? '').trim().slice(0, n),
})
const hasText = v => Boolean(v?.ar || v?.en)

/**
 * The model's output, clamped to the shape the page renders: at most three
 * "needs you", six findings and three watch items, unknown areas and tones
 * folded to safe values, empty entries dropped.
 */
export function normaliseBrief(raw = {}) {
  const area = a => (AREAS.includes(a) ? a : 'team')
  const tone = t => (TONES.includes(t) ? t : 'watch')
  return {
    headline: clipBi(raw.headline, 300),
    needs_you: (Array.isArray(raw.needs_you) ? raw.needs_you : [])
      .map(n => ({ area: area(n?.area), title: clipBi(n?.title, 200), action: clipBi(n?.action, 240) }))
      .filter(n => hasText(n.title))
      .slice(0, 3),
    found: (Array.isArray(raw.found) ? raw.found : [])
      .map(f => ({ area: area(f?.area), tone: tone(f?.tone), text: clipBi(f?.text, 500) }))
      .filter(f => hasText(f.text))
      .slice(0, 6),
    watch: (Array.isArray(raw.watch) ? raw.watch : []).map(w => clipBi(w, 300)).filter(hasText).slice(0, 3),
  }
}

/**
 * Social facts from the live reader's output, or { available: false }.
 *
 * The CEO's requirements (2026-10-18, "Hide from CEO view") say post views,
 * profile views, impressions and Instagram engagement do not help him
 * decide; they stay on the marketing team's pages. So the brief is given
 * followers, growth, link clicks and what was posted, and never the rest.
 */
export function socialFacts(live = {}, posts = { this_week: 0, last_week: 0, top: [] }) {
  if (!live?.available) return { available: false }
  const acct = p => (live.followers?.accounts || []).find(a => a.platform === p) || null
  const ig = acct('instagram')
  const li = acct('linkedin')
  const ins = live.account_insights?.ok ? live.account_insights : null
  const lp = (live.linkedin_page_insights || []).find(x => x?.ok) || null
  return {
    available: true,
    window_days: ins?.window?.days || lp?.window?.days || null,
    instagram: ig ? { followers: ig.followers, growth: ig.growth } : null,
    linkedin: li ? { followers: li.followers, growth: li.growth, clicks: lp?.clicks ?? null } : null,
    posts_this_week: posts.this_week,
    posts_last_week: posts.last_week,
    recent_posts: posts.top,
  }
}

/** Posts from the live reader, counted into this week / last week, top few kept. */
export function postsByWeek(livePosts = [], window) {
  const inRange = (iso, a, b) => { const t = Date.parse(iso || ''); return t >= Date.parse(a) && t < Date.parse(b) }
  const all = (livePosts || []).filter(p => p?.status === 'published' || p?.published_at)
  const thisWeek = all.filter(p => inRange(p.published_at, window.from, window.to))
  const lastWeek = all.filter(p => inRange(p.published_at, window.prevFrom, window.from))
  const top = [...all]
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))
    .slice(0, 5)
    .map(p => ({
      platform: p.platform, published_at: p.published_at,
      about: String(p.content || '').replace(/\s+/g, ' ').slice(0, 120),
    }))
  return { this_week: thisWeek.length, last_week: lastWeek.length, top }
}
