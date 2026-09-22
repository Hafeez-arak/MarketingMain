import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Card, Button, Input, Textarea, Select, Modal, Spinner, Empty, Skeleton,
  PageHeader, Toggle, ConfirmDialog, PlatformPill,
} from '../../components/ui/index'
import { useAuth } from '../../store/auth'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { PLATFORM_META } from '../../lib/utils'
import {
  fetchAutoReplies, saveAutoReply, deleteAutoReply, fetchAutoReplyLogs,
  canAutoReply,
} from '../../lib/zernioConnect'

// ─── Auto-replies ──────────────────────────────────────────────────────────
//
// "When someone comments a certain word, send them a message." Zernio runs all
// of it — it watches the comments, matches the keywords, sends the DMs and
// keeps the logs — so this screen is a view onto records we do not own. That
// is why nothing here is cached: there is no local copy that could be right,
// and a stale one would claim an automation is on after somebody paused it at
// zernio.com.
//
// ── WHY IT IS HERE AND NOT IN BRAND BRAIN ──
//
// It was asked for next to Message Templates. Brand Brain is reference the AI
// READS while writing — nothing in it acts on its own. This sends real
// messages to real people the moment a comment lands, which is a different
// kind of thing entirely, and burying a live outbound action inside the
// reference section is how somebody edits a "template" and accidentally
// changes what strangers receive. It sits beside the account it runs on.
//
// ── THE TWO LIMITS THIS SCREEN HAS TO SAY OUT LOUD ──
//
//   1. Instagram and Facebook only. That is Zernio's limit, not ours, and
//      LinkedIn — this brand's best-performing channel — is not on the list.
//      Saying so beats letting somebody build an automation that never fires.
//   2. `misses`. A keyword that matches nothing produces NO log rows, so an
//      empty log is indistinguishable from "nobody commented". The count of
//      non-matching comments is the only evidence that the keywords are wrong,
//      and it is shown next to the log rather than left in the API.

const BLANK = {
  id: '',
  name: '',
  keywords: '',
  match_mode: 'contains',
  exclude_keywords: '',
  typo_tolerance: false,
  dm_message: '',
  comment_reply: '',
  also_match_in_dms: false,
  is_active: true,
}

const DM_LIMIT = 1000

/** An automation as the editor holds it — lists become text boxes. */
const toDraft = a => ({
  id: a.id,
  name: a.name,
  keywords: (a.keywords || []).join(', '),
  match_mode: a.match_mode || 'contains',
  exclude_keywords: (a.exclude_keywords || []).join(', '),
  typo_tolerance: !!a.typo_tolerance,
  dm_message: a.dm_message || '',
  comment_reply: a.comment_reply || '',
  also_match_in_dms: !!a.also_match_in_dms,
  is_active: a.is_active !== false,
})

/** What the editor sends. The server splits and validates; this only shapes. */
const fromDraft = (d, accountId) => ({
  ...(d.id ? { id: d.id } : { account_id: accountId }),
  name: d.name,
  keywords: d.keywords,
  match_mode: d.match_mode,
  exclude_keywords: d.exclude_keywords,
  typo_tolerance: d.typo_tolerance,
  dm_message: d.dm_message,
  comment_reply: d.comment_reply,
  also_match_in_dms: d.also_match_in_dms,
  is_active: d.is_active,
})

const when = iso => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
}

const STATUS_TONE = {
  sent:    'bg-sage-100 text-sage-700',
  pending: 'bg-amber-100 text-amber-700',
  failed:  'bg-red-50 text-red-600',
  skipped: 'bg-stone-100 text-text-tertiary',
  gated:   'bg-sky-50 text-sky-700',
}

// What triggered one send. Zernio calls a story reply and a plain DM different
// sources, and "they messaged us" reads very differently from "they commented".
const SOURCE_LABEL = { comment: 'Comment', story_reply: 'Story reply', dm: 'Direct message' }

export default function AutoReplies() {
  const navigate = useNavigate()
  const { activeWorkspaceId } = useAuth()
  const { allAccounts, loading: loadingAccounts } = useConnectedAccounts()

  const [automations, setAutomations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)      // a draft, or null
  const [confirming, setConfirming] = useState(null)
  const [logsFor, setLogsFor] = useState(null)
  const [busyId, setBusyId] = useState('')

  // Only the accounts Zernio can actually automate. Held separately from
  // `allAccounts` so the empty state can tell the two apart: "nothing
  // connected" and "LinkedIn connected, which cannot do this" need different
  // sentences and the same list would give them the same one.
  const usable = useMemo(
    () => allAccounts.filter(a => canAutoReply(a) && a.is_active !== false),
    [allAccounts],
  )
  const blocked = useMemo(
    () => allAccounts.filter(a => !canAutoReply(a) && a.is_active !== false),
    [allAccounts],
  )

  // Plain async, called directly after a save/pause/delete — those run from a
  // click, where setting state immediately is exactly right.
  const load = useCallback(async () => {
    if (!activeWorkspaceId) return
    setLoading(true)
    const res = await fetchAutoReplies(activeWorkspaceId)
    setError(res.error || '')
    setAutomations(res.automations || [])
    setLoading(false)
  }, [activeWorkspaceId])

  // The first load is deferred out of the effect body — setting state
  // synchronously there is a cascading render. Same shape as useResearch and
  // MediaPicker, which is why `load` itself stays undeferred.
  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => { if (!cancelled) load() })
    return () => { cancelled = true }
  }, [load])

  const accountOf = id => allAccounts.find(a => a.zernio_account_id === id) || null

  async function persist(draft, accountId) {
    setBusyId(draft.id || 'new')
    const res = await saveAutoReply(activeWorkspaceId, fromDraft(draft, accountId))
    setBusyId('')
    if (res.error) return res.error
    setEditing(null)
    await load()
    return ''
  }

  // Pausing is a save of one field. It goes through the same endpoint rather
  // than a dedicated one so there is exactly one place that can write an
  // automation, and no second path that could forget the ownership check.
  async function togglePaused(a) {
    setBusyId(a.id)
    const res = await saveAutoReply(activeWorkspaceId, { id: a.id, ...fromDraft(toDraft(a)), is_active: !a.is_active })
    setBusyId('')
    if (res.error) { setError(res.error); return }
    await load()
  }

  async function remove(a) {
    setConfirming(null)
    setBusyId(a.id)
    const res = await deleteAutoReply(activeWorkspaceId, a.id)
    setBusyId('')
    if (res.error) { setError(res.error); return }
    await load()
  }

  const nothingUsable = !loadingAccounts && usable.length === 0

  return (
    <div className="max-w-5xl space-y-4">
      <PageHeader
        title="Auto-replies"
        subtitle="When someone comments a word you choose, they get a message back automatically.">
        {usable.length > 0 && (
          <Button onClick={() => setEditing({ ...BLANK, account_id: usable[0].zernio_account_id })}>
            New auto-reply
          </Button>
        )}
      </PageHeader>

      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-sm text-red-700">{error}</p>
        </Card>
      )}

      {/* The platform limit, stated before anything else, because it is the
          first question somebody has looking at a LinkedIn-heavy account list. */}
      {blocked.length > 0 && (
        <Card className="p-3 bg-surface-muted border-dashed">
          <p className="text-xs text-text-secondary">
            Auto-replies work on Instagram and Facebook only — that is Zernio's limit, not a setting.{' '}
            {blocked.map(a => PLATFORM_META[a.platform]?.label || a.platform).filter((v, i, s) => s.indexOf(v) === i).join(' and ')}
            {blocked.length === 1 ? ' cannot' : ' cannot'} run one.
          </p>
        </Card>
      )}

      {loadingAccounts || loading ? (
        <div className="space-y-3">
          {[0, 1].map(i => <Card key={i} className="p-4"><Skeleton className="h-16 w-full" /></Card>)}
        </div>
      ) : nothingUsable ? (
        <Card><Empty
          title="No account that can do this yet"
          description={
            allAccounts.length === 0
              ? 'Connect an Instagram or Facebook account and you can set up keyword replies here.'
              : 'Auto-replies need an Instagram or Facebook account. Connect one to get started.'
          }
          action={<Button onClick={() => navigate('/social')}>Connect an account</Button>} /></Card>
      ) : automations.length === 0 ? (
        <Card><Empty
          title="No auto-replies yet"
          description="Pick a word — “price”, “catalogue”, “كتالوج” — and write what should be sent when somebody comments it."
          action={
            <Button onClick={() => setEditing({ ...BLANK, account_id: usable[0].zernio_account_id })}>
              Create the first one
            </Button>
          } /></Card>
      ) : (
        <div className="space-y-3">
          {automations.map(a => (
            <AutomationCard key={a.id} automation={a} account={accountOf(a.account_id)}
              busy={busyId === a.id}
              onEdit={() => setEditing({ ...toDraft(a), account_id: a.account_id })}
              onToggle={() => togglePaused(a)}
              onLogs={() => setLogsFor(a)}
              onDelete={() => setConfirming(a)} />
          ))}
        </div>
      )}

      {editing && (
        <EditorModal
          draft={editing}
          accounts={usable}
          saving={busyId === (editing.id || 'new')}
          onClose={() => setEditing(null)}
          onSave={persist} />
      )}

      {logsFor && (
        <LogsModal automation={logsFor} workspaceId={activeWorkspaceId} onClose={() => setLogsFor(null)} />
      )}

      <ConfirmDialog
        open={!!confirming}
        onClose={() => setConfirming(null)}
        onConfirm={() => remove(confirming)}
        danger
        title="Delete this auto-reply?"
        message={`"${confirming?.name || ''}" and all of its history will be removed. Anyone who already received a message keeps it.`} />
    </div>
  )
}

// ─── One automation ────────────────────────────────────────────────────────

function AutomationCard({ automation: a, account, busy, onEdit, onToggle, onLogs, onDelete }) {
  const stats = a.stats || {}
  return (
    <Card className={`p-4 ${a.is_active ? '' : 'bg-surface-muted'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-text text-sm">{a.name || 'Untitled'}</h3>
            {a.platform && <PlatformPill platform={a.platform} />}
            {!a.is_active && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] bg-stone-100 text-text-tertiary">Paused</span>
            )}
          </div>
          <p className="text-[11px] text-text-tertiary mt-0.5">
            {account ? (account.username ? `@${account.username}` : account.display_name) : a.account_id}
            {' · '}
            {/* Absent platformPostId means every post, which is the common
                case and reads as a blank if it is not named. */}
            {a.platform_post_id ? (a.post_title || 'One post') : 'Every post'}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {busy && <Spinner size="sm" />}
          <Button size="xs" variant="secondary" onClick={onLogs}>History</Button>
          <Button size="xs" variant="secondary" onClick={onEdit} disabled={busy}>Edit</Button>
          <Button size="xs" variant="secondary" onClick={onToggle} disabled={busy}>
            {a.is_active ? 'Pause' : 'Resume'}
          </Button>
          <Button size="xs" variant="secondary" onClick={onDelete} disabled={busy}>Delete</Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {a.keywords.length === 0 ? (
          // An empty keyword list is legal and means "any comment". It has to
          // be said, loudly — it is the setting most likely to surprise.
          <span className="text-[11px] font-semibold px-2 py-1 leading-[1.4] bg-amber-100 text-amber-800">
            Any comment triggers this
          </span>
        ) : a.keywords.map(k => (
          <span key={k} className="text-[11px] font-medium px-2 py-1 leading-[1.4] bg-surface-subtle border border-border text-text">
            {k}
          </span>
        ))}
        {a.exclude_keywords.map(k => (
          <span key={k} className="text-[11px] font-medium px-2 py-1 leading-[1.4] bg-red-50 border border-red-200 text-red-700 line-through">
            {k}
          </span>
        ))}
      </div>

      <p className="text-xs text-text-secondary mt-2.5 line-clamp-2 leading-relaxed">{a.dm_message}</p>

      <div className="mt-3 pt-2.5 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1">
        <Stat label="Triggered" value={stats.triggered} />
        <Stat label="Sent" value={stats.dmsSent} />
        {stats.dmsFailed > 0 && <Stat label="Failed" value={stats.dmsFailed} bad />}
        <Stat label="People" value={stats.uniqueContacts} />
        {a.also_match_in_dms && (
          <span className="text-[11px] text-text-tertiary ml-auto">Also answers direct messages</span>
        )}
      </div>
    </Card>
  )
}

function Stat({ label, value, bad = false }) {
  return (
    <span className="text-[11px] text-text-tertiary">
      {label}{' '}
      <span className={`font-bold tabular-nums ${bad ? 'text-red-600' : 'text-text'}`}>{value ?? 0}</span>
    </span>
  )
}

// ─── The editor ────────────────────────────────────────────────────────────

function EditorModal({ draft, accounts, saving, onClose, onSave }) {
  const [d, setD] = useState(draft)
  const [accountId, setAccountId] = useState(draft.account_id || accounts[0]?.zernio_account_id || '')
  const [err, setErr] = useState('')
  const set = (k, v) => setD(prev => ({ ...prev, [k]: v }))

  const isNew = !d.id
  const over = d.dm_message.length > DM_LIMIT
  const noKeywords = !d.keywords.trim()

  async function submit() {
    setErr('')
    const message = await onSave(d, accountId)
    if (message) setErr(message)
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'New auto-reply' : 'Edit auto-reply'} width="max-w-2xl">
      <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
        {err && <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2">{err}</p>}

        {isNew && accounts.length > 1 && (
          <Select label="Which account?" value={accountId} onChange={e => setAccountId(e.target.value)}>
            {accounts.map(a => (
              <option key={a.zernio_account_id} value={a.zernio_account_id}>
                {(PLATFORM_META[a.platform]?.label || a.platform)} — {a.username ? `@${a.username}` : a.display_name}
              </option>
            ))}
          </Select>
        )}

        <Input label="Name" placeholder="e.g. Catalogue requests"
          hint="Only you see this — it is how you find it in the list."
          value={d.name} onChange={e => set('name', e.target.value)} autoFocus />

        <div>
          <Input label="Trigger words" placeholder="catalogue, price, كتالوج"
            hint="Separated by commas. Someone commenting any one of them gets the message."
            value={d.keywords} onChange={e => set('keywords', e.target.value)} />
          {noKeywords && (
            // Legal, and occasionally wanted — but it must never be reached by
            // accident, because it answers everybody.
            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1.5 mt-1.5">
              With no trigger words, <strong>every comment</strong> on this account gets this message.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label="How to match" value={d.match_mode} onChange={e => set('match_mode', e.target.value)}>
            <option value="contains">Anywhere in the comment</option>
            <option value="word">Only as a whole word</option>
          </Select>
          <div className="flex items-end pb-1">
            {/* Zernio applies this to whole-word matching only, so offering it
                the rest of the time would be a switch that does nothing. */}
            {d.match_mode === 'word' ? (
              <Toggle checked={d.typo_tolerance} onChange={e => set('typo_tolerance', e.target.checked)}
                label="Also catch close misspellings" />
            ) : (
              <p className="text-[11px] text-text-tertiary leading-snug">
                “price” would also fire on “pricing” and “priceless”. Switch to whole-word to stop that.
              </p>
            )}
          </div>
        </div>

        <Input label="Never reply to comments containing (optional)" placeholder="job, hiring, complaint"
          hint="Checked first — a comment with one of these is ignored even if it also has a trigger word."
          value={d.exclude_keywords} onChange={e => set('exclude_keywords', e.target.value)} />

        <div>
          <Textarea label="The message they receive" rows={4}
            placeholder="Thanks for your interest! Here is our latest catalogue: …"
            value={d.dm_message} onChange={e => set('dm_message', e.target.value)} />
          <p className={`text-[11px] mt-1 tabular-nums ${over ? 'text-red-600 font-semibold' : 'text-text-tertiary'}`}>
            {d.dm_message.length} / {DM_LIMIT}
            {over && ' — Instagram will refuse this'}
          </p>
        </div>

        <Textarea label="Public reply on the comment (optional)" rows={2}
          hint="Posted under their comment, where everyone can see it. The message above stays private."
          value={d.comment_reply} onChange={e => set('comment_reply', e.target.value)} />

        <div className="pt-1 border-t border-border space-y-2">
          {/* `e.target.checked`, not the bare argument: Toggle wires onChange
              straight to its <input>, so it hands back an EVENT. Two other
              callers in this repo pass `v => set(field, v)` and are storing a
              SyntheticEvent — which is always truthy, so those toggles can
              never be switched off. */}
          <Toggle checked={d.also_match_in_dms}
            onChange={e => set('also_match_in_dms', e.target.checked)}
            label="Also answer people who send the word as a message" />
          {d.also_match_in_dms && noKeywords && (
            <p className="text-[11px] text-red-600">
              This needs at least one trigger word, or every message you receive gets an automatic reply.
            </p>
          )}
        </div>
      </div>

      <div className="px-6 py-3 border-t border-border flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving || over}>
          {saving ? <><Spinner size="sm" /> Saving…</> : isNew ? 'Create' : 'Save'}
        </Button>
      </div>
    </Modal>
  )
}

// ─── History ───────────────────────────────────────────────────────────────

function LogsModal({ automation, workspaceId, onClose }) {
  const [state, setState] = useState({ loading: true, logs: [], misses: null, error: '' })

  useEffect(() => {
    let alive = true
    queueMicrotask(() => { if (alive) setState(s => ({ ...s, loading: true })) })
    fetchAutoReplyLogs(workspaceId, automation.id).then(res => {
      if (!alive) return
      setState({ loading: false, logs: res.logs || [], misses: res.misses || null, error: res.error || '' })
    })
    return () => { alive = false }
  }, [workspaceId, automation.id])

  const { loading, logs, misses, error } = state

  return (
    <Modal open onClose={onClose} title={`History — ${automation.name}`} width="max-w-2xl">
      <div className="p-6 space-y-3 max-h-[70vh] overflow-y-auto">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Shown ABOVE the log, and shown even when the log is empty — this is
            the only thing that distinguishes "nobody commented" from "the
            keywords are catching nothing", and the empty log looks identical
            in both cases. */}
        {!loading && misses && misses.total > 0 && (
          <Card className="p-3 bg-amber-50 border-amber-200">
            <p className="text-xs text-amber-900">
              <strong>{misses.total}</strong> comment{misses.total === 1 ? '' : 's'} in the last{' '}
              {misses.retentionDays} day{misses.retentionDays === 1 ? '' : 's'} reached this auto-reply and
              matched none of its words.
            </p>
            {misses.samples.length > 0 && (
              <ul className="mt-1.5 space-y-0.5">
                {misses.samples.map((s, i) => (
                  <li key={i} className="text-[11px] text-amber-800 truncate">“{s}”</li>
                ))}
              </ul>
            )}
          </Card>
        )}

        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : logs.length === 0 ? (
          <p className="text-sm text-text-secondary">
            Nothing has triggered this yet.
            {misses && misses.total > 0 && ' Comments are arriving — the words above may need changing.'}
          </p>
        ) : (
          <div className="divide-y divide-border border border-border">
            {logs.map(l => (
              <div key={l.id} className="p-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-text">{l.commenterName || 'Someone'}</p>
                  <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">“{l.commentText}”</p>
                  <p className="text-[10px] text-text-tertiary mt-1">
                    {SOURCE_LABEL[l.source] || l.source} · {when(l.createdAt)}
                    {l.status === 'pending' && l.nextDueAt ? ` · sends ${when(l.nextDueAt)}` : ''}
                  </p>
                  {l.error && <p className="text-[11px] text-red-600 mt-1">{l.error}</p>}
                </div>
                <span className={`text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] flex-shrink-0
                  ${STATUS_TONE[l.status] || 'bg-stone-100 text-text-tertiary'}`}>
                  {l.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}
