import { useEffect, useState } from 'react'
import { Card, Button, ConfirmDialog, Skeleton, Spinner } from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { defaultWebhookUrl } from '../../lib/n8nWebhooks'
import { saveCampaign, markWeeklyOption, fetchBrandKit } from '../../lib/email/client'
import { designFromText } from '../../lib/email/design'
import { optionBody, weekOf } from '../../lib/email/weekly'
import { Notice, EIcon } from './parts'
import { shortDate, dateTime } from './format'

// ─── This week's AI drafts ─────────────────────────────────────────────────
// Written every Monday on the n8n box (server/agentHandlers/emailWeekly.js),
// read here. Nothing on this card calls a model directly: "Write now" goes
// through the same n8n workflow, so the AI only ever runs on the box.
//
// Opening an option makes an ordinary draft campaign — designed or plain —
// that the person edits and sends like any other. The option remembers which
// campaign it became, so opening it twice does not make two drafts.

export function WeeklyDrafts({ workspaceId, data, reload, setTab }) {
  const { accessToken } = useAuth()
  const row = data.aiDrafts
  const thisWeek = weekOf()
  const current = row && row.week_of === thisWeek ? row : null
  const [requesting, setRequesting] = useState(false)
  const [error, setError] = useState('')
  const [confirmAgain, setConfirmAgain] = useState(false)
  const [lang, setLang] = useState({})
  const [opening, setOpening] = useState(-1)

  // While the box is writing, look again every 10s until it is done.
  const running = current?.status === 'running' || requesting
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(() => reload(), 10_000)
    return () => clearInterval(t)
  }, [running, reload])

  async function writeNow() {
    setRequesting(true)
    setError('')
    // The row flips to 'running' within a second or two; show it without
    // waiting for the whole call.
    setTimeout(() => reload(), 2500)
    try {
      const res = await fetch(defaultWebhookUrl('emailWeekly'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ access_token: accessToken, workspace_id: workspaceId }),
      })
      const out = await res.json().catch(() => null)
      if (!out) setError(`The server returned ${res.status} with nothing in it. The drafts may still arrive; this card refreshes itself.`)
      else if (out.ok === false) setError(out.error || 'The drafts could not be written.')
    } catch (err) {
      setError(`Could not reach the server: ${err.message}`)
    } finally {
      setRequesting(false)
      reload()
    }
  }

  async function open(option, index, { designed }) {
    if (option.used_campaign_id && data.campaigns.some(c => c.id === option.used_campaign_id)) {
      setTab('marketing', { campaign: option.used_campaign_id })
      return
    }
    setOpening(index)
    setError('')
    try {
      const language = lang[index] === 'ar' ? 'ar' : 'en'
      const ar = language === 'ar'
      const body = optionBody(option, language)
      const group = data.groups.find(g => g.audience === 'marketing' && g.name.toLowerCase() === String(option.audience || '').toLowerCase())
      let design = null
      if (designed) {
        const kit = await fetchBrandKit(workspaceId).catch(() => null)
        design = designFromText({ body, logo: kit?.logos?.[0]?.public_url || '' })
      }
      const campaign = await saveCampaign(workspaceId, {
        audience: 'marketing',
        name: option.angle || option.subject,
        subject: ar ? option.ar_subject || option.subject : option.subject,
        preheader: ar ? option.ar_preheader || option.preheader : option.preheader,
        body,
        language,
        group_ids: group ? [group.id] : [],
        design,
      })
      await markWeeklyOption(workspaceId, current, index, { used_campaign_id: campaign.id })
      await reload()
      setTab('marketing', { campaign: campaign.id })
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setOpening(-1)
    }
  }

  async function dismiss(index) {
    try { await markWeeklyOption(workspaceId, current, index, { dismissed: true }); await reload() }
    catch (err) { setError(err.message) }
  }

  const visible = (current?.options || []).map((o, i) => ({ o, i })).filter(x => !x.o.dismissed)

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b border-border">
        <div className="min-w-0">
          <h3 className="font-semibold text-text text-sm flex items-center gap-2"><EIcon name="spark" /> This week's AI drafts</h3>
          <p className="text-xs text-text-tertiary mt-1">
            {current?.status === 'ready'
              ? `Week of ${shortDate(current.week_of)} · written ${dateTime(current.finished_at)} from your Brand Brain, the latest research, the calendar and past emails.`
              : 'Every Monday at 10:30 Riyadh time, three options for the week\'s email, from your Brand Brain, the latest research, the calendar and how past emails did.'}
          </p>
        </div>
        {current?.status === 'ready' ? (
          <Button size="xs" variant="ghost" onClick={() => setConfirmAgain(true)} disabled={running}>Write again</Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={writeNow} disabled={running}>
            {running ? <><Spinner size="sm" /> Writing…</> : 'Write this week\'s drafts now'}
          </Button>
        )}
      </div>

      <div className="p-5 space-y-3">
        {error && <Notice tone="red">{error}</Notice>}

        {running && (
          <div className="grid md:grid-cols-3 gap-3">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-48 w-full" />)}
            <p className="md:col-span-3 text-[11px] text-text-tertiary">Writing on the server. This takes about a minute; you can leave this page.</p>
          </div>
        )}

        {!running && current?.status === 'failed' && (
          <Notice tone="amber" title="This week's drafts were not written">
            {current.error || 'Something went wrong.'} Press “Write this week's drafts now” to try again.
          </Notice>
        )}

        {!running && !current && row && (
          <p className="text-xs text-text-tertiary">Last drafts were for the week of {shortDate(row.week_of)}. This week's arrive on Monday, or write them now.</p>
        )}

        {!running && current?.status === 'ready' && (
          <>
            {current.note && <p className="text-xs text-text-secondary"><strong className="text-text">Note:</strong> {current.note}</p>}
            {visible.length === 0 ? (
              <p className="text-xs text-text-tertiary">All three dismissed. Write again for new ones.</p>
            ) : (
              <div className="grid md:grid-cols-3 gap-3">
                {visible.map(({ o, i }) => {
                  const hasAr = Boolean(o.ar_body)
                  const ar = lang[i] === 'ar' && hasAr
                  return (
                    <div key={i} className="border border-border flex flex-col">
                      <div className="px-3 py-2.5 border-b border-border bg-surface-subtle">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary">{o.angle || `Option ${i + 1}`}</p>
                          {hasAr && (
                            <div className="flex text-[10px]">
                              {['en', 'ar'].map(l => (
                                <button key={l} type="button" onClick={() => setLang(s => ({ ...s, [i]: l }))}
                                  className={`px-1.5 py-0.5 border -ml-px first:ml-0 ${(lang[i] || 'en') === l ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-text-secondary border-border'}`}>
                                  {l === 'en' ? 'EN' : 'عربي'}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-text mt-1" dir={ar ? 'rtl' : 'ltr'}>{ar ? o.ar_subject : o.subject}</p>
                        {(ar ? o.ar_preheader : o.preheader) && <p className="text-[11px] text-text-tertiary mt-0.5" dir={ar ? 'rtl' : 'ltr'}>{ar ? o.ar_preheader : o.preheader}</p>}
                      </div>
                      <p className="px-3 pt-2 text-[11px] text-text-secondary"><span className="font-semibold text-text">Why now:</span> {o.why_now}</p>
                      <p className="px-3 pt-1 text-[11px] text-text-secondary"><span className="font-semibold text-text">For:</span> {o.audience}</p>
                      <p className="px-3 py-2 text-xs text-text-secondary whitespace-pre-wrap flex-1 max-h-40 overflow-y-auto scrollbar-thin" dir={ar ? 'rtl' : 'ltr'}>
                        {ar ? o.ar_body : o.body}
                      </p>
                      {o.cta_url && <p className="px-3 pb-2 text-[11px] text-text-tertiary">Button: {(ar && o.ar_cta_label) || o.cta_label} → {o.cta_url}</p>}
                      <div className="px-3 py-2 border-t border-border flex flex-wrap items-center gap-2">
                        {o.used_campaign_id ? (
                          <Button size="xs" variant="secondary" onClick={() => open(o, i, { designed: true })}>Open the draft</Button>
                        ) : (
                          <>
                            <Button size="xs" onClick={() => open(o, i, { designed: true })} disabled={opening >= 0}>
                              {opening === i ? 'Opening…' : 'Open as design'}
                            </Button>
                            <Button size="xs" variant="ghost" onClick={() => open(o, i, { designed: false })} disabled={opening >= 0}>Plain text</Button>
                            <div className="flex-1" />
                            <button type="button" onClick={() => dismiss(i)} className="text-[11px] text-text-tertiary hover:text-text">Dismiss</button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}

        {!running && !current && !row && (
          <p className="text-xs text-text-tertiary">No drafts yet. The first arrive on Monday, or write them now.</p>
        )}
      </div>

      <ConfirmDialog open={confirmAgain} onClose={() => setConfirmAgain(false)} title="Write this week's drafts again?"
        message="Three new options replace these ones (drafts you already opened are kept as campaigns). It counts against the monthly AI budget, a few cents."
        onConfirm={writeNow} />
    </Card>
  )
}

export function WeeklyDraftsSkeleton() {
  return <Card className="p-5"><Skeleton className="h-40 w-full" /></Card>
}
