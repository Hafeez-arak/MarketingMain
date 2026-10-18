import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
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

// ─── CEO ───────────────────────────────────────────────────────────────────
// 2026-10-18. One page for the CEO: four one-line numbers, the week's brief
// in a page (Arabic first, English on a switch), his requests, and the
// assistant built in beside it rather than in a corner.
//
// He asked for the important points, not numbers every time. So the numbers
// are one line each and computed in code (ceoKpis), and the brief is words,
// written once a week (Sunday 07:00 Riyadh) or when he asks. See
// src/lib/agent/ceoBrief.js.

const LANG_KEY = 'arak.ceo.lang'

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

const TONE_DOT = { good: 'bg-green-600', watch: 'bg-amber-500', bad: 'bg-red-600' }
const TONE_TILE = { good: 'border-t-green-600', watch: 'border-t-amber-500', bad: 'border-t-red-600' }

function readLang() {
  try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ar' } catch { return 'ar' }
}

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

export function CeoPage() {
  const { activeWorkspaceId, accessToken, user } = useAuth()
  const [lang, setLang] = useState(readLang)
  const t = T[lang]
  const [brief, setBrief] = useState(undefined) // undefined = loading, null = none
  const [loadError, setLoadError] = useState('')
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState('')
  const [requests, setRequests] = useState(null)
  const chat = useAgentChat()

  const switchLang = l => { setLang(l); try { localStorage.setItem(LANG_KEY, l) } catch { /* private window */ } }

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

  // The requests tile is the viewer's own, read live, not the stored one.
  const kpis = useMemo(() => {
    const stored = brief?.kpis || []
    if (!requests) return stored
    const open = requests.filter(r => ['new', 'in_progress'].includes(r.status)).length
    // "This week" is the brief's week, which also keeps the render pure.
    const since = Date.parse(brief?.period_start || '') || 0
    const done = requests.filter(r => r.status === 'done' && Date.parse(r.closed_at || '') >= since).length
    return stored.map(k => (k.key !== 'requests' ? k : {
      ...k,
      value: { en: String(open), ar: String(open) },
      sub: { en: `${done} done this week`, ar: `${done} أُنجزت هذا الأسبوع` },
      tone: open && !done ? 'watch' : 'good',
    }))
  }, [brief, requests])

  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <div className="max-w-7xl space-y-4" dir={dir} lang={lang}>
      <header className="flex flex-wrap items-end justify-between gap-3 pb-4 border-b border-border">
        <div className="min-w-0">
          <h1 className="text-lg font-bold text-text tracking-tight leading-none">{t.title}</h1>
          {brief && (
            <p className="text-xs text-text-secondary mt-2">
              {t.week(day(brief.period_start, lang), day(brief.period_end, lang))} · {t.written} {ago(brief.created_at, lang)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2" dir="ltr">
          <div className="flex border border-border" role="group" aria-label="Language">
            {[['ar', 'العربية'], ['en', 'English']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => switchLang(k)} aria-pressed={lang === k}
                className={`px-3 py-1.5 text-xs ${lang === k ? 'bg-amber-700 text-white' : 'bg-white text-text-secondary hover:text-text'}`}>
                {label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="secondary" onClick={fresh} disabled={writing || !accessToken}>
            {writing ? <><Spinner size="sm" /> {t.writing}</> : t.fresh}
          </Button>
        </div>
      </header>
      {writeError && <p className="text-xs text-red-600" dir="auto">{writeError}</p>}

      {brief === undefined ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : loadError ? (
        <p className="text-xs text-red-600 border border-red-200 bg-red-50 px-3 py-2">{t.failed}: {loadError}</p>
      ) : brief && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map(k => (
            <div key={k.key} className={`bg-white border border-border border-t-2 ${TONE_TILE[k.tone] || ''} px-4 py-3 min-w-0`}>
              <p className="text-[11px] text-text-tertiary truncate">{k.label?.[lang]}</p>
              <p className="text-xl font-bold text-text tabular-nums mt-1" dir="ltr" style={{ textAlign: lang === 'ar' ? 'right' : 'left' }}>{k.value?.[lang]}</p>
              <p className="text-[11px] text-text-secondary mt-0.5 truncate">{k.sub?.[lang]}</p>
            </div>
          ))}
        </div>
      )}

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
