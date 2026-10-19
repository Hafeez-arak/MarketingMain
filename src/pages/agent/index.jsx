import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Card, PageHeader, SectionHead, Button, Spinner, Empty, Skeleton, ConfirmDialog } from '../../components/ui/index'
import { useAgentChat } from '../../lib/useAgentChat'
import { describePage, suggestionsFor } from '../../lib/pageContext'
import { startResearchRun, fetchRuns, fetchLensResults } from '../../lib/agentRun'
import { RunProgress } from '../../components/RunProgress'
import { isLive } from '../../lib/agent/progress'
import { AgentSteering } from '../../components/AgentSteering'
import PastConversations from '../../components/PastConversations'
import { AgentMarkdown } from '../../components/AgentMarkdown'
import AskInput from '../../components/AskInput'
import { useTaggable } from '../../lib/useTaggable'
import { JumpToLatest } from '../../components/AssistantDrawer'
import { useFollowBottom } from '../../lib/useFollowBottom'
import { AttachButton, AttachmentTray, TurnAttachments } from '../../components/ChatAttachments'
import { useChatAttachments } from '../../lib/useChatAttachments'
import { useT, fmtDay } from '../../lib/i18n'

// The page's words (lib/i18n.js). The research run's progress and the
// steering box below it are Insights' and stay English for now.
const PW = {
  en: {
    noWorkspace: 'No workspace selected', pickWorkspace: 'Pick a workspace to talk to its assistant.',
    title: 'Assistant', subtitle: n => `Ask about ${n || 'this brand'} — its posts, its numbers, its market.`,
    newConversation: 'New conversation', measuring: 'Measuring…', runResearch: 'Run research',
    confirmTitle: 'Run research now?', confirmBody: 'This searches the web on every research topic, takes about 5–10 minutes and is paid from the monthly agent budget.',
    runStarted: 'Measuring — the numbers are committed. The investigation continues in the background.', runFailed: 'The run failed.',
    stopped: s => ` · stopped: ${s}`, help: 'What can I help with?', placeholder: 'Ask anything about the company, or @ to tag someone…',
    stop: 'Stop', ask: 'Ask',
    footA: 'It reads this workspace only, answers from tools rather than memory, and will say when a sample is too small to mean anything.',
    footAdmin: 'For you it can also change the Brand Brain, rules, research sources, the sales profile and drafts when asked, and every change can be undone.',
    footMember: 'It can propose rules, ideas and drafts.',
    footB: 'It cannot publish or schedule anything. Attach images or PDFs with the clip, or paste a screenshot.',
    weekly: 'Weekly research', weeklySub: 'Measures every competitor with a verified Instagram handle, then investigates what moved. The numbers are computed in code, never by a model.',
    loadingRuns: 'Loading runs', runsFailed: e => `The runs could not be loaded (${e}). Nothing has been lost.`, tryAgain: 'Try again', noRuns: 'No run has been started for this brand yet.',
  },
  ar: {
    noWorkspace: 'لم تُختر شركة', pickWorkspace: 'اختر شركة للتحدث مع مساعدها.',
    title: 'المساعد', subtitle: n => `اسأل عن ${n || 'هذه الشركة'}: منشوراتها وأرقامها وسوقها.`,
    newConversation: 'محادثة جديدة', measuring: 'جارٍ القياس…', runResearch: 'تشغيل البحث',
    confirmTitle: 'تشغيل البحث الآن؟', confirmBody: 'يبحث في الويب عن كل موضوع بحث، ويستغرق نحو ٥–١٠ دقائق، ويُدفع من ميزانية الوكيل الشهرية.',
    runStarted: 'جارٍ القياس، والأرقام محفوظة. يستمر التحقيق في الخلفية.', runFailed: 'فشل التشغيل.',
    stopped: s => ` · توقف: ${s}`, help: 'كيف يمكنني المساعدة؟', placeholder: 'اسأل أي شيء عن الشركة، أو اذكر أحدًا بـ @…',
    stop: 'إيقاف', ask: 'اسأل',
    footA: 'يقرأ هذه الشركة فقط، ويجيب من الأدوات لا من الذاكرة، ويخبرك إن كانت العينة أصغر من أن تعني شيئًا.',
    footAdmin: 'ويمكنه لك أيضًا تعديل هوية العلامة والقواعد ومصادر البحث وملف المبيعات والمسودات عندما تطلب، ويمكن التراجع عن كل تغيير.',
    footMember: 'ويمكنه اقتراح القواعد والأفكار والمسودات.',
    footB: 'لا ينشر ولا يجدول شيئًا. أرفق صورًا أو ملفات PDF بالمشبك، أو الصق لقطة شاشة.',
    weekly: 'البحث الأسبوعي', weeklySub: 'يقيس كل منافس له حساب إنستغرام موثّق، ثم يتحقق مما تغيّر. الأرقام تُحسب بالبرمجة، لا بالنموذج.',
    loadingRuns: 'جارٍ تحميل عمليات البحث', runsFailed: e => `تعذّر تحميل عمليات البحث (${e}). لم يضع شيء.`, tryAgain: 'حاول مجددًا', noRuns: 'لم يبدأ أي بحث لهذه الشركة بعد.',
  },
}

// ─── /agent — the assistant, full page ─────────────────────────────────────
// The same agent, the same tools and the SAME conversation as the drawer —
// useAgentChat holds the thread outside component state precisely so these two
// surfaces cannot drift into separate threads.
//
// This page exists for the two things a 400px drawer is bad at: reading a long
// answer, and starting and reviewing a research run.

function ToolTrace({ steps }) {
  if (!steps?.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {steps.map((s, i) => (
        <span
          key={i}
          className={`text-[10px] px-1.5 py-0.5 font-mono ${
            s.ok === false ? 'bg-red-50 text-red-600' : 'bg-surface-muted text-text-secondary'
          }`}
        >
          {s.name}
        </span>
      ))}
    </div>
  )
}

export default function AgentPage() {
  const location = useLocation()
  const { activeWorkspaceId, activeWorkspace, accessToken, isAccessAdmin } = useAuth()
  const { t: w, lang, dir } = useT(PW)
  const taggable = useTaggable(activeWorkspaceId)
  const { turns, busy, ask, reset, stop, ready, threadId, openThread } = useAgentChat()
  const files = useChatAttachments()
  const [question, setQuestion] = useState('')
  const [runs, setRuns] = useState([])
  // Separate from `runs.length`, which is also 0 before the first answer — and
  // the page used to say "No run has been started" in that gap.
  const [runsLoaded, setRunsLoaded] = useState(false)
  const [runsError, setRunsError] = useState('')
  const [lensRows, setLensRows] = useState([])
  const [running, setRunning] = useState(false)
  const [runNote, setRunNote] = useState('')

  const context = useMemo(() => describePage(location), [location])
  const suggestions = useMemo(() => suggestionsFor(context), [context])

  const boxRef = useRef(null)
  const { onScroll, following, jumpToLatest } = useFollowBottom(boxRef, turns, turns.length)

  // A new chat is a question in the middle of the card; once there is a
  // conversation the composer docks at the bottom under it.
  const empty = turns.length === 0
  const composerRef = useRef(null)
  const messagesRef = useRef(null)
  const composerTop = useRef(null)
  const wasEmpty = useRef(empty)

  // The switch between the two is animated by moving the composer from where
  // it was to where it now is (and fading the messages in), rather than by
  // easing the layout itself. The layout snaps to its final size at once, so
  // the message box never resizes under the follow-the-answer logic — a box
  // growing during a transition clamps its scroll position upward, which
  // useFollowBottom would read as the reader scrolling away.
  // offsetTop is relative to the card, so scrolling the page in between does
  // not throw the starting point off. Runs after every render because the
  // empty layout can also shift (the window resizing) while nothing changes.
  useLayoutEffect(() => {
    const el = composerRef.current
    if (!el) return
    const top = el.offsetTop
    const from = composerTop.current
    composerTop.current = top
    if (wasEmpty.current === empty) return
    wasEmpty.current = empty
    if (from == null || from === top || typeof el.animate !== 'function') return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const timing = { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
    el.animate([{ transform: `translateY(${from - top}px)` }, { transform: 'translateY(0)' }], timing)
    messagesRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], timing)
  })

  // `reload` is a counter rather than a callback dependency so that starting a
  // run can ask for a refresh without the effect re-subscribing on every
  // render.
  const [reload, setReload] = useState(0)
  const loadRuns = useCallback(() => setReload(n => n + 1), [])

  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return undefined
    let cancelled = false
    fetchRuns(activeWorkspaceId, accessToken, 5, { throwOnError: true }).then(async rows => {
      // Guarded so a slow response cannot land after the page has gone, or
      // after the person has switched to another brand.
      if (cancelled) return
      setRuns(rows)
      setRunsError('')
      setRunsLoaded(true)
      const latest = rows?.[0]
      if (!latest) { setLensRows([]); return }
      const lr = await fetchLensResults(activeWorkspaceId, latest.id, accessToken)
      if (!cancelled) setLensRows(lr)
    }).catch(err => {
      // A failed read is not "no run has been started".
      if (cancelled) return
      setRunsError(String(err?.message || err))
      setRunsLoaded(true)
    })
    return () => { cancelled = true }
  }, [activeWorkspaceId, accessToken, reload])

  // A run in flight is the one thing on this page that changes without the
  // person doing anything, so it is the one thing worth polling for — and only
  // while it is actually live. Polling a finished run forever is how a page
  // quietly costs a database a request every ten seconds all day.
  const latestRun = runs[0] || null
  const watching = isLive(latestRun)
  useEffect(() => {
    if (!watching) return undefined
    const t = setInterval(() => setReload(n => n + 1), 8_000)
    return () => clearInterval(t)
  }, [watching])

  const [confirmRun, setConfirmRun] = useState(false)
  const runResearch = useCallback(async () => {
    if (running) return
    setRunning(true)
    setRunNote('')
    const out = await startResearchRun({ workspaceId: activeWorkspaceId, accessToken })
    // "Already running" is a success, not a failure — a second press attaches
    // to the run already going rather than starting a second agent on the same
    // period and doubling the bill.
    // The run answers once the numbers are committed; the lenses and the brief
    // carry on in the background, so there is no headline to show yet.
    setRunNote(
      out.already_running ? out.reason
        : out.ok
          ? w.runStarted
          : out.error || w.runFailed,
    )
    setRunning(false)
    loadRuns()
  }, [running, activeWorkspaceId, accessToken, loadRuns, w])

  // Same rule as the drawer: a suggestion chip never carries pending files.
  const send = useCallback((text) => {
    const chip = typeof text === 'string'
    const q = chip ? text : question
    const attached = chip ? [] : files.items
    if (!q?.trim() && !attached.length) return
    if (files.preparing) return
    if (!chip) { setQuestion(''); files.clear() }
    ask(q, context, attached)
  }, [question, ask, context, files])

  if (!activeWorkspaceId) {
    return <Empty title={w.noWorkspace} description={w.pickWorkspace} />
  }

  return (
    <div className="space-y-4" dir={dir} lang={lang}>
      <PageHeader title={w.title} subtitle={w.subtitle(activeWorkspace?.name)}>
        {turns.length ? <Button variant="ghost" onClick={reset}>{w.newConversation}</Button> : null}
        {/* Asked first, as on the Research page: a run spends money and takes minutes. */}
        <Button variant="secondary" onClick={() => setConfirmRun(true)} disabled={running}>
          {running ? w.measuring : w.runResearch}
        </Button>
      </PageHeader>

      <ConfirmDialog
        open={confirmRun} onClose={() => setConfirmRun(false)}
        title={w.confirmTitle}
        message={w.confirmBody}
        onConfirm={runResearch}
      />

      {/* The conversation comes first: it is what most people open this page
          for. Sized to the window so a new chat can sit in the middle of it and
          a running one can dock its composer at the bottom, with the research
          below for whoever scrolls on. */}
      <Card className="relative flex flex-col h-[calc(100dvh-11rem)] min-h-[28rem]">
        {empty ? null : (
          <div ref={messagesRef} className="relative flex-1 min-h-0 flex flex-col">
          <div ref={boxRef} onScroll={onScroll} className="flex-1 overflow-y-auto space-y-4 px-4 pt-4 pb-2">
            {turns.map((t, i) => (
              <div key={i} className={t.role === 'user' ? 'text-end' : ''}>
                {t.role === 'user' ? (
                  <>
                    <TurnAttachments items={t.attachments} />
                    {t.text ? (
                      <div className="inline-block bg-surface-muted px-3.5 py-2 text-sm text-text max-w-[85%] text-start whitespace-pre-wrap" dir="auto">
                        {t.text}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div dir="auto"><AgentMarkdown>{t.text}</AgentMarkdown></div>
                    {!t.text && !t.error && busy && i === turns.length - 1 ? <Spinner size="sm" /> : null}
                  </>
                )}
                {t.error ? <div className="mt-1 text-sm text-red-600">{t.error}</div> : null}
                {t.role === 'assistant' ? <ToolTrace steps={t.steps} /> : null}
                {t.role === 'assistant' && t.cost ? (
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    ${t.cost.toFixed(4)}
                    {t.stoppedBy && t.stoppedBy !== 'answered' ? w.stopped(t.stoppedBy) : ''}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {!following ? <JumpToLatest onClick={jumpToLatest} /> : null}
          </div>
        )}

        {/* ONE composer for both layouts, always in the same slot — the
            optional pieces around it are nulls rather than a different tree.
            Sending the first question swaps the layout under the cursor, and a
            remounted textarea would drop the focus mid-conversation. */}
        <div
          data-composer={empty ? 'centered' : 'docked'}
          className={empty
            ? 'flex-1 flex flex-col items-center justify-center px-6 py-10'
            : 'shrink-0 border-t border-border-light px-4 pt-3 pb-6'}
        >
          {empty ? (
            <h2 className="text-xl font-semibold text-text tracking-tight mb-5 text-center">{w.help}</h2>
          ) : null}
          {/* items-end so the buttons stay level with the last line of a
              composer that has grown, rather than centring against it. */}
          <form
            ref={composerRef}
            onSubmit={e => { e.preventDefault(); send() }}
            className={`flex flex-wrap gap-2 items-end w-full ${empty ? 'max-w-2xl' : ''}`}
          >
            <AttachmentTray items={files.items} error={files.error} preparing={files.preparing} onRemove={files.remove} />
            {/* Beside the composer rather than up in the page header: this is a
                thing you reach for while reading a conversation, not a page-level
                action, and the header already carries the two that are. */}
            <PastConversations activeThreadId={threadId} onOpen={openThread} onDeleteActive={reset} />
            <AttachButton onFiles={files.add} disabled={!ready || busy} />
            <AskInput
              value={question}
              onChange={setQuestion}
              onSubmit={send}
              onPaste={files.onPaste}
              canSubmitEmpty={files.items.length > 0}
              mentions={taggable}
              placeholder={w.placeholder}
              disabled={!ready}
            />
            {busy ? (
              <Button variant="secondary" onClick={stop}>{w.stop}</Button>
            ) : (
              <Button type="submit" disabled={(!question.trim() && !files.items.length) || files.preparing || !ready}>{w.ask}</Button>
            )}
          </form>
          {empty && suggestions.length ? (
            <div className="mt-4 flex flex-wrap justify-center gap-2 max-w-2xl">
              {suggestions.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  dir="auto"
                  className="text-xs px-2.5 py-1.5 border border-border bg-white text-text-secondary hover:border-stone-400 hover:text-text transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          ) : null}
          {empty ? (
            <p className="mt-6 text-xs text-text-tertiary text-center max-w-xl leading-relaxed">
              {w.footA} {isAccessAdmin ? w.footAdmin : w.footMember} {w.footB}
            </p>
          ) : null}
        </div>
      </Card>

      {/* Above the weekly research, deliberately: while a run is going this is
          the only thing on the page that is changing, and afterwards it is the
          fastest way to see whether the brief below is built on five answers
          or on two. */}
      <div dir="ltr"><RunProgress run={latestRun} lensRows={lensRows} /></div>

      <Card>
        <SectionHead
          title={w.weekly}
          subtitle={w.weeklySub}
        />
        <div className="px-5 py-4 [&>*:first-child]:mt-0">
          {runNote ? <p className="mt-2 text-sm text-text">{runNote}</p> : null}
          {!runsLoaded ? (
            <div className="mt-3 space-y-2" aria-busy="true" aria-label={w.loadingRuns}>
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-4 w-full max-w-md" />)}
            </div>
          ) : runsError && runs.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">{w.runsFailed(runsError)}{' '}
              <button type="button" className="underline" onClick={loadRuns}>{w.tryAgain}</button></p>
          ) : runs.length === 0 ? (
            <p className="mt-2 text-sm text-text-secondary">{w.noRuns}</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {runs.map(r => (
                <li key={r.id} className="text-sm flex items-baseline gap-2">
                  <span className={
                    r.status === 'complete' ? 'text-sage-600'
                      : r.status === 'failed' ? 'text-red-600' : 'text-amber-600'
                  }>●</span>
                  <span className="text-text-secondary text-xs w-36 shrink-0">
                    {fmtDay(r.started_at, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-text" dir="auto">
                    {r.error || r.report?.headline || `${r.status} · ${r.stage || ''}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <div dir="ltr"><AgentSteering /></div>
    </div>
  )
}
