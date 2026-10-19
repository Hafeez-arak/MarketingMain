import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Spinner, Skeleton } from '../../components/ui/index'
import { useAgentChat } from '../../lib/useAgentChat'
import { useChatAttachments } from '../../lib/useChatAttachments'
import { useFollowBottom } from '../../lib/useFollowBottom'
import { useTaggable } from '../../lib/useTaggable'
import { describePage } from '../../lib/pageContext'
import { AgentMarkdown } from '../../components/AgentMarkdown'
import AskInput from '../../components/AskInput'
import PastConversations from '../../components/PastConversations'
import { AttachButton, AttachmentTray, TurnAttachments } from '../../components/ChatAttachments'
import { fetchLatestBrief, writeBrief, requestFrom } from '../../lib/ceo'
import { fetchRequests, STATUS_LABEL } from '../../lib/requests'
import { timeAgo } from '../../lib/utils'
import { fetchControl, assignLead, remindOwner, accountContacted, sendToSales, saveTargets, saveRouting, odooSync } from '../../lib/control'
import { CT } from './strings'
import { HomeTab, TeamTab, AccountsTab, OpportunitiesTab, MarketingTab } from './Control'
import { TargetsTab } from './Targets'
import { useLang, setLang, hasChoice } from '../../lib/i18n'

// ─── CEO ───────────────────────────────────────────────────────────────────
// 2026-10-18 (#243). One page for the CEO: four one-line numbers, the week's brief
// in a page (Arabic first, English on a switch), his requests, and the
// assistant built in beside it rather than in a corner.
//
// He asked for the important points, not numbers every time. So the numbers
// are one line each and computed in code (ceoKpis), and the brief is words,
// written once a week (Sunday 07:00 Riyadh) or when he asks. See
// src/lib/agent/ceoBrief.js.


const T = {
  ar: {
    title: 'المدير التنفيذي',
    week: (a, b) => `أسبوع ${a} – ${b}`,
    fresh: 'اكتب ملخصًا جديدًا',
    writing: 'جارٍ الكتابة… نحو دقيقة',
    written: 'كُتب',
    noBrief: 'لا يوجد ملخص بعد',
    noBriefSub: 'يُكتب ملخص كل أحد صباحًا. يمكنك كتابة أول ملخص الآن.',
    needs: 'يحتاج قرارك',
    found: 'أهم ما وجدناه هذا الأسبوع',
    watch: 'للمتابعة',
    ask: 'اسأل عنه',
    toRequest: 'حوّله إلى طلب',
    requested: 'أُضيف إلى الطلبات',
    requests: 'طلباتك',
    noRequests: 'لا طلبات بعد. اطلب أي تغيير من المساعد وسيظهر هنا.',
    allRequests: 'كل الطلبات',
    assistant: 'مساعد أراك',
    assistantSub: 'اسأل عن أي شيء في الشركة، أو اذكر زميلًا بـ @',
    placeholder: 'اكتب سؤالك…',
    newChat: 'محادثة جديدة',
    send: 'اسأل',
    stop: 'إيقاف',
    starters: ['ما الذي يجب أن أقلق بشأنه هذا الأسبوع؟', 'أي الاستفسارات تحتاج مسؤولًا اليوم؟', 'كيف أداؤنا على وسائل التواصل؟', 'ما آخر أخبار طلباتي؟'],
    askAbout: t => `أخبرني أكثر عن هذا وما الذي تقترحه: ${t}`,
    failed: 'تعذّر تحميل الملخص',
    area: { leads: 'الاستفسارات', money: 'المال', social: 'التواصل', email: 'البريد', market: 'السوق', team: 'الفريق' },
  },
  en: {
    title: 'CEO',
    week: (a, b) => `Week of ${a} – ${b}`,
    fresh: 'Write a fresh brief',
    writing: 'Writing… about a minute',
    written: 'Written',
    noBrief: 'No brief yet',
    noBriefSub: 'A brief is written every Sunday morning. You can write the first one now.',
    needs: 'Needs you',
    found: 'What we found this week',
    watch: 'Keep an eye on',
    ask: 'Ask about it',
    toRequest: 'Make it a request',
    requested: 'Added to requests',
    requests: 'Your requests',
    noRequests: 'No requests yet. Ask the assistant for any change and it shows up here.',
    allRequests: 'All requests',
    assistant: 'Arak assistant',
    assistantSub: 'Ask anything about the company, or @ to tag someone',
    placeholder: 'Ask anything…',
    newChat: 'New conversation',
    send: 'Ask',
    stop: 'Stop',
    starters: ['What should I worry about this week?', 'Which enquiries need an owner today?', 'How is our social media doing?', 'What happened to my requests?'],
    askAbout: t => `Tell me more about this and what you suggest: ${t}`,
    failed: 'The brief could not be loaded',
    area: { leads: 'Leads', money: 'Money', social: 'Social', email: 'Email', market: 'Market', team: 'Team' },
  },
}

const TONE_DOT = { good: 'bg-green-500', watch: 'bg-yellow-500', bad: 'bg-red-500' }


/** "5h ago" / "منذ 5 ساعات", coarse like timeAgo. */
function ago(iso, lang) {
  if (lang !== 'ar') return timeAgo(iso)
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso || '')) / 60_000))
  if (!Number.isFinite(mins)) return ''
  if (mins < 60) return mins <= 1 ? 'الآن' : `منذ ${mins} دقيقة`
  const h = Math.round(mins / 60)
  if (h < 24) return h === 1 ? 'منذ ساعة' : `منذ ${h} ساعات`
  const d = Math.round(h / 24)
  return d === 1 ? 'أمس' : `منذ ${d} أيام`
}

const day = (iso, lang) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short' })
}

// ─── The page: the control panel's tabs (2026-10-18) ───────────────────────
// The CEO's requirements: a home screen of six numbers and at most three
// decisions, then the sales team, key accounts, new projects, marketing in
// three numbers, and his targets. The brief and the assistant from #243 are
// the last tab. ?tab= keeps the tab across a refresh and makes it linkable.

const TABS = ['home', 'team', 'accounts', 'opportunities', 'marketing', 'targets', 'brief']

export function CeoPage() {
  const { activeWorkspaceId, accessToken, canSection } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'home'
  // The app's one language (lib/i18n.js). The CEO page is Arabic first:
  // a browser that never chose a language starts in Arabic here.
  const lang = useLang()
  useEffect(() => { if (!hasChoice()) setLang('ar') }, [])
  const t = CT[lang]
  const [data, setData] = useState(undefined) // undefined = loading
  const [error, setError] = useState('')
  const [loadedAt, setLoadedAt] = useState(null)

  const switchLang = l => setLang(l)
  const openTab = k => setParams(p => { const n = new URLSearchParams(p); if (k === 'home') n.delete('tab'); else n.set('tab', k); return n }, { replace: true })

  const load = useCallback(async () => {
    if (!activeWorkspaceId || !accessToken) return
    const out = await fetchControl(activeWorkspaceId, accessToken)
    if (out.error) { setError(out.error); setData(d => d ?? null); return }
    setError('')
    setData(out)
    setLoadedAt(out.at)
  }, [activeWorkspaceId, accessToken])

  useEffect(() => {
    const id = setTimeout(load, 0)
    return () => clearTimeout(id)
  }, [load])

  const calls = useMemo(() => ({
    assign: (leadId, userId) => assignLead(activeWorkspaceId, accessToken, leadId, userId),
    remind: leadId => remindOwner(activeWorkspaceId, accessToken, leadId),
    contacted: accountId => accountContacted(activeWorkspaceId, accessToken, accountId),
    sendToSales: (oppId, userId) => sendToSales(activeWorkspaceId, accessToken, oppId, userId),
    saveTargets: form => saveTargets(activeWorkspaceId, accessToken, form),
    saveRouting: rules => saveRouting(activeWorkspaceId, accessToken, rules),
    odooSync: () => odooSync(activeWorkspaceId, accessToken),
  }), [activeWorkspaceId, accessToken])

  // A button's work, then the panel again: the server's word, not a guess.
  const act = useCallback(async fn => {
    const out = await fn()
    if (!out?.error) setTimeout(load, 1200)
    return out
  }, [load])

  const dir = lang === 'ar' ? 'rtl' : 'ltr'
  const props = { data, lang, t, act, calls }

  return (
    <div className="max-w-5xl space-y-3" dir={dir} lang={lang}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text tracking-tight leading-none">{T[lang].title}</h1>
          {loadedAt && tab !== 'brief' && <p className="text-[11px] text-text-tertiary mt-1">{t.updated} {ago(loadedAt, lang)}</p>}
        </div>
        <div className="flex border border-border rounded-md overflow-hidden" role="group" aria-label="Language" dir="ltr">
          {[['ar', 'العربية'], ['en', 'English']].map(([k, label]) => (
            <button key={k} type="button" onClick={() => switchLang(k)} aria-pressed={lang === k}
              className={`px-3 py-1.5 text-xs ${lang === k ? 'bg-stone-900 text-white' : 'bg-white text-text-secondary hover:text-text'}`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-border -mx-1 px-1" aria-label={T[lang].title}>
        {TABS.map(k => (
          <button key={k} type="button" onClick={() => openTab(k)} aria-current={tab === k ? 'page' : undefined}
            className={`whitespace-nowrap px-3 py-2 text-xs border-b-2 -mb-px ${tab === k ? 'border-stone-900 text-text font-medium' : 'border-transparent text-text-secondary hover:text-text'}`}>
            {t.tabs[k]}
          </button>
        ))}
      </nav>

      {tab === 'brief' ? <BriefTab lang={lang} /> : data === undefined ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : !data ? (
        <div className="border border-red-200 bg-red-50 px-3 py-3 text-xs text-red-700 space-y-2">
          <p dir="auto">{t.loadFailed}: {error}</p>
          <Button size="xs" variant="secondary" onClick={load}>{t.retry}</Button>
        </div>
      ) : (
        <>
          {error && <p className="text-xs text-red-600" dir="auto">{error}</p>}
          {tab === 'home' && <HomeTab {...props} />}
          {tab === 'team' && <TeamTab {...props} />}
          {tab === 'accounts' && <AccountsTab {...props} />}
          {tab === 'opportunities' && <OpportunitiesTab {...props} />}
          {tab === 'marketing' && <MarketingTab {...props} />}
          {tab === 'targets' && <TargetsTab key={loadedAt} {...props} canEdit={canSection('ceo', 'manage')} onSaved={load} />}
        </>
      )}
    </div>
  )
}

/** The week's brief, his requests and the assistant: the page as #243 built it. */
function BriefTab({ lang }) {
  const { activeWorkspaceId, accessToken, user } = useAuth()
  const t = T[lang]
  const [brief, setBrief] = useState(undefined) // undefined = loading, null = none
  const [loadError, setLoadError] = useState('')
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [requests, setRequests] = useState(null)
  const chat = useAgentChat()

  const loadRequests = useCallback(async () => {
    const { rows } = await fetchRequests(activeWorkspaceId)
    setRequests(rows.filter(r => r.created_by === user?.id))
  }, [activeWorkspaceId, user?.id])

  useEffect(() => {
    let cancelled = false
    fetchLatestBrief(activeWorkspaceId).then(({ brief: b, error }) => {
      if (cancelled) return
      setLoadError(error || '')
      setBrief(b)
    })
    const r = setTimeout(loadRequests, 0)
    return () => { cancelled = true; clearTimeout(r) }
  }, [activeWorkspaceId, loadRequests])

  async function fresh() {
    setWriting(true); setWriteError('')
    const out = await writeBrief(activeWorkspaceId, accessToken)
    setWriting(false)
    if (out.error) { setWriteError(out.error); return }
    setBrief(out.brief)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-text-secondary">
          {brief ? <>{t.week(day(brief.period_start, lang), day(brief.period_end, lang))} · {t.written} {ago(brief.created_at, lang)}</> : null}
        </p>
        <Button size="sm" variant="secondary" onClick={fresh} disabled={writing || !accessToken}>
          {writing ? <><Spinner size="sm" /> {t.writing}</> : t.fresh}
        </Button>
      </div>
      {writeError && <p className="text-xs text-red-600" dir="auto">{writeError}</p>}

      {/* The six numbers are on Home now (the CEO's limit is six); the
          brief's own four stay stored in ceo_briefs.kpis but are not drawn. */}
      {loadError && <p className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-2">{t.failed}: {loadError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start">
        <div className="lg:col-span-3 space-y-4 min-w-0">
          {brief === undefined ? <Skeleton className="h-96" /> : !brief ? (
            <section className="border border-dashed border-border bg-surface-muted px-6 py-10 text-center">
              <h2 className="font-semibold text-text text-sm">{t.noBrief}</h2>
              <p className="text-xs text-text-secondary mt-1.5 mb-4">{t.noBriefSub}</p>
              <Button onClick={fresh} disabled={writing}>{writing ? t.writing : t.fresh}</Button>
            </section>
          ) : (
            <Brief brief={brief.brief} lang={lang} t={t} chat={chat} workspaceId={activeWorkspaceId} userId={user?.id} onRequested={loadRequests} />
          )}
          <MyRequests rows={requests} t={t} lang={lang} />
        </div>
        <div className="lg:col-span-2 lg:sticky lg:top-4 min-w-0">
          <CeoChat chat={chat} t={t} lang={lang} />
        </div>
      </div>
    </div>
  )
}

function Brief({ brief, lang, t, chat, workspaceId, userId, onRequested }) {
  const [made, setMade] = useState({})
  const ask = text => chat.ask(t.askAbout(text), { route: '/ceo' }, [])

  async function makeRequest(key, n) {
    setMade(m => ({ ...m, [key]: 'busy' }))
    const out = await requestFrom(workspaceId, userId, {
      title: n.title.en || n.title.ar,
      body: `${n.title.ar}\n${n.action.ar}\n\n${n.title.en}\n${n.action.en}`,
    })
    setMade(m => ({ ...m, [key]: out.error ? `error:${out.error}` : 'done' }))
    if (!out.error) onRequested()
  }

  return (
    <article className="bg-white border border-border px-5 py-5 space-y-6">
      <p className="text-base font-semibold text-text leading-relaxed">{brief.headline?.[lang]}</p>

      {brief.needs_you?.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3">{t.needs}</h2>
          <ol className="space-y-3">
            {brief.needs_you.map((n, i) => {
              const key = `n${i}`
              const state = made[key]
              return (
                <li key={key} className="border border-amber-200 bg-amber-50/40 px-4 py-3">
                  <div className="flex gap-3">
                    <span className="text-amber-800 font-bold tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text leading-relaxed">{n.title?.[lang]}</p>
                      <p className="text-sm text-text-secondary leading-relaxed mt-1">{lang === 'ar' ? '←' : '→'} {n.action?.[lang]}</p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs">
                        <button type="button" className="text-amber-800 hover:underline" onClick={() => ask(n.title?.[lang])}>{t.ask}</button>
                        {state === 'done' ? <span className="text-green-700">{t.requested}</span> : (
                          <button type="button" className="text-amber-800 hover:underline disabled:opacity-50" disabled={state === 'busy'} onClick={() => makeRequest(key, n)}>{t.toRequest}</button>
                        )}
                        {state?.startsWith?.('error:') && <span className="text-red-600" dir="auto">{state.slice(6)}</span>}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        </section>
      )}

      {brief.found?.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3">{t.found}</h2>
          <ul className="space-y-3">
            {brief.found.map((f, i) => (
              <li key={i} className="flex gap-3">
                <span className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${TONE_DOT[f.tone] || TONE_DOT.watch}`} />
                <div className="min-w-0">
                  <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{t.area[f.area] || f.area}</span>
                  <p className="text-sm text-text leading-relaxed">{f.text?.[lang]}</p>
                  <button type="button" className="text-xs text-amber-800 hover:underline mt-0.5" onClick={() => ask(f.text?.[lang])}>{t.ask}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {brief.watch?.length > 0 && (
        <section>
          <h2 className="eyebrow mb-2">{t.watch}</h2>
          <ul className="space-y-1.5 list-disc ps-5 text-sm text-text-secondary leading-relaxed">
            {brief.watch.map((w, i) => <li key={i}>{w?.[lang]}</li>)}
          </ul>
        </section>
      )}
    </article>
  )
}

function MyRequests({ rows, t, lang }) {
  const shown = (rows || []).slice(0, 8)
  return (
    <section className="bg-white border border-border">
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <h2 className="eyebrow">{t.requests}</h2>
        <Link to="/requests" className="text-xs text-amber-800 hover:underline">{t.allRequests}</Link>
      </header>
      {rows === null ? <div className="p-4"><Skeleton className="h-10" /></div> : shown.length === 0 ? (
        <p className="px-4 py-4 text-xs text-text-tertiary">{t.noRequests}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map(r => (
            <li key={r.id}>
              <Link to={`/requests?id=${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-subtle">
                <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 border ${r.status === 'done' ? 'text-green-800 border-green-200 bg-green-50' : r.status === 'in_progress' ? 'text-sky-800 border-sky-200 bg-sky-50' : r.status === 'declined' ? 'text-text-tertiary border-border' : 'text-amber-800 border-amber-200 bg-amber-50'}`}>
                  {lang === 'ar' ? ({ new: 'جديد', in_progress: 'قيد التنفيذ', done: 'منجز', declined: 'مرفوض' }[r.status]) : STATUS_LABEL[r.status]}
                </span>
                <span className="text-sm text-text flex-1 min-w-0 truncate" dir="auto">{r.title}</span>
                <span className="text-[11px] text-text-tertiary flex-shrink-0">{ago(r.updated_at, lang)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function CeoChat({ chat, t, lang }) {
  const { activeWorkspaceId } = useAuth()
  const location = useLocation()
  const people = useTaggable(activeWorkspaceId)
  const files = useChatAttachments()
  const { turns, busy, ask, reset, stop, ready, threadId, openThread } = chat
  const [question, setQuestion] = useState('')
  const boxRef = useRef(null)
  const { onScroll } = useFollowBottom(boxRef, turns, String(turns.length))
  const context = useMemo(() => describePage(location), [location])

  const send = useCallback(text => {
    const chip = typeof text === 'string'
    const q = chip ? text : question
    const attached = chip ? [] : files.items
    if (!q?.trim() && !attached.length) return
    if (files.preparing) return
    if (!chip) { setQuestion(''); files.clear() }
    ask(q, context, attached)
  }, [question, ask, context, files])

  return (
    <section className="bg-white border border-border flex flex-col h-[calc(100dvh-8rem)] min-h-[28rem]">
      <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-border">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text">{t.assistant}</h2>
          <p className="text-[11px] text-text-tertiary truncate">{t.assistantSub}</p>
        </div>
        {turns.length > 0 && <Button size="xs" variant="ghost" onClick={reset}>{t.newChat}</Button>}
      </header>

      <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-4 py-3 space-y-4" dir="auto">
        {turns.length === 0 ? (
          <div className="flex flex-col gap-2 pt-2">
            {t.starters.map(s => (
              <button key={s} type="button" onClick={() => send(s)} disabled={!ready}
                className="text-start text-sm px-3 py-2 border border-border text-text-secondary hover:border-stone-400 hover:text-text transition-colors">
                {s}
              </button>
            ))}
          </div>
        ) : turns.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex flex-col items-end' : ''}>
            {m.role === 'user' ? (
              <>
                <TurnAttachments items={m.attachments} />
                {m.text && <div className="inline-block bg-surface-muted px-3 py-2 text-sm text-text max-w-[90%] whitespace-pre-wrap" dir="auto">{m.text}</div>}
              </>
            ) : (
              <>
                <AgentMarkdown>{m.text}</AgentMarkdown>
                {!m.text && !m.error && busy && i === turns.length - 1 ? <Spinner size="sm" /> : null}
              </>
            )}
            {m.error && <div className="mt-1 text-sm text-red-600" dir="auto">{m.error}</div>}
          </div>
        ))}
      </div>

      <form onSubmit={e => { e.preventDefault(); send() }} className="border-t border-border px-3 py-3 flex flex-wrap gap-2 items-end" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <AttachmentTray items={files.items} error={files.error} preparing={files.preparing} onRemove={files.remove} />
        <PastConversations activeThreadId={threadId} onOpen={openThread} onDeleteActive={reset} />
        <AttachButton onFiles={files.add} disabled={!ready || busy} />
        <AskInput value={question} onChange={setQuestion} onSubmit={send} onPaste={files.onPaste}
          canSubmitEmpty={files.items.length > 0} mentions={people} placeholder={t.placeholder} disabled={!ready} />
        {busy
          ? <Button variant="secondary" onClick={stop}>{t.stop}</Button>
          : <Button type="submit" disabled={(!question.trim() && !files.items.length) || files.preparing || !ready}>{t.send}</Button>}
      </form>
    </section>
  )
}
