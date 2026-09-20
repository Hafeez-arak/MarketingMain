import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/index'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { publishComposed } from '../../lib/publishPost'
import { composedCaption, optionsFor, composerFromPost } from '../../lib/composerState'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { mayPublishTo, protectionReason } from '../../lib/platformSafety'
import { PostComposer } from './PostComposer'
import { postLock } from '../../lib/postLock'
import { projectionFor } from '../../lib/mediaOrder'

// ─── The Create-post button, and everything behind it ──────────────────────
// Both platform pages mount this rather than each wiring its own composer, so
// "create a post" behaves identically wherever it is pressed and there is one
// place to fix when it does not.
//
// A composed post becomes a real row in generated_posts BEFORE it is
// published, always — even for Post-now. The publish workflow claims that row
// atomically to guarantee a post cannot go out twice, and a publish with no
// row to claim skips that guarantee entirely. So the order is: save, then
// publish the saved row.

function rowFrom(state, workspaceId, status) {
  const opts = optionsFor(state)

  return {
    workspace_id: workspaceId,
    platform: state.platform,
    caption: composedCaption(state),
    hashtags: state.hashtags || '',
    first_comment: opts.firstComment || '',
    format: state.format,
    // `media` (ordered, mixed) plus the legacy columns derived from it, in one
    // spread. This used to split state.media into images and videos by hand
    // and write media_type: videos.length ? 'video' : … — which is how a
    // carousel of two pictures and a clip was stored as a video post, and how
    // reopening it and saving wrote image_urls: [] over the pictures.
    ...projectionFor(state.media),
    cover_image_url: state.coverImageUrl || '',
    campaign_id: state.campaignId || null,
    // The whole per-platform block, stored as it will be sent. Round-tripping
    // a draft through the database therefore needs no translation layer — see
    // the platform_options column comment.
    platform_options: state.options || {},
    tags: state.tags || [],
    scheduled_date: state.scheduledFor ? state.scheduledFor.slice(0, 10) : null,
    publish_time: state.scheduledFor ? state.scheduledFor.slice(11, 16) : '',
    status,
    source: 'manual',
    publish_provider: 'zernio',
  }
}

// One row per post, whether it was composed here or generated elsewhere.
//
// A post opened from Approvals ALREADY has a row, and inserting a second one
// would leave the original sitting in the review queue while its edited twin
// published — two rows, one intention, and no way to tell afterwards which was
// which. So an existing postId updates in place and only a genuinely new
// composition inserts.
async function writePost(accessToken, row, { postId, postTable = 'generated_posts' } = {}) {
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  }
  const url = postId
    ? `${SUPABASE_URL}/rest/v1/${postTable}?id=eq.${postId}`
    : `${SUPABASE_URL}/rest/v1/generated_posts`

  // workspace_id is dropped on update: it is the tenant key, it cannot
  // legitimately change, and sending it invites a row to be moved between
  // workspaces by a payload rather than by a decision.
  let body = row
  if (postId) {
    // Copy-and-delete rather than a destructure-to-discard: the latter reads
    // as an unused binding to both a linter and a person.
    body = { ...row }
    delete body.workspace_id
  }

  const res = await fetch(url, { method: postId ? 'PATCH' : 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) return { error: (await res.text()).slice(0, 300) || `Save failed (${res.status}).` }
  const rows = await res.json().catch(() => [])
  const saved = rows[0] || (postId ? { id: postId } : null)
  if (!saved) return { error: 'Saved, but the row did not come back.' }
  return { post: saved }
}

export function ComposerHost({
  platform, campaigns = [], onDone, label = 'Create post',
  // Opening an EXISTING post. Set `openPost` to a scheduled_posts row and the
  // composer opens prefilled from it; `onOpenPostHandled` is called when it
  // closes so the parent can clear its selection. `trigger={false}` hides the
  // built-in button for callers that open it from their own row actions.
  openPost = null, onOpenPostHandled, trigger = true,
}) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const { accounts, loading: accountsLoading } = useConnectedAccounts(platform)
  const [open, setOpen]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [note, setNote]       = useState('')
  const [initial, setInitial] = useState(null)
  // The row the composer was opened on, for its publish state. A post already
  // booked at Zernio has to be RE-booked when it changes, or the edit lands in
  // our row and Zernio still sends the old version.
  const [openedRow, setOpenedRow] = useState(null)

  // A post handed in from outside opens the composer prefilled. Converted
  // through composerFromPost rather than read field-by-field here, so the
  // generated half and the composed half agree on one shape.
  useEffect(() => {
    if (!openPost) return
    let cancelled = false
    // Deferred a tick, like every other first-load effect in this codebase:
    // setting state synchronously in an effect body is a cascading render.
    queueMicrotask(() => {
      if (cancelled) return
      // A post that has gone out is not reopened for editing at all.
      const lock = postLock(openPost)
      if (lock.locked) {
        setNote(lock.reason)
        return
      }
      setInitial(composerFromPost(openPost))
      setOpenedRow(openPost)
      setNote('')
      setOpen(true)
    })
    return () => { cancelled = true }
  }, [openPost])

  const close = useCallback(() => {
    setOpen(false)
    setBusy(false)
    setInitial(null)
    setOpenedRow(null)
    onOpenPostHandled?.()
  }, [onOpenPostHandled])

  const booked = !!openedRow?.id && openedRow?.publish_status === 'scheduled'

  const saveDraft = useCallback(async (state) => {
    // Saving a booked post as a draft would change our copy while Zernio still
    // publishes the old one at the old time. Schedule re-books it; cancelling
    // the booking in the Post Queue is how it becomes a draft again.
    if (booked && state.postId) {
      setNote('This post is scheduled — use Schedule (or Post now) to save your changes, or cancel its schedule in the Post Queue first.')
      return
    }
    setBusy(true)
    const { error } = await writePost(
      accessToken, rowFrom(state, activeWorkspaceId, 'draft'),
      { postId: state.postId, postTable: state.postTable })
    setBusy(false)
    if (error) { setNote(error); return }
    setNote('Saved as a draft.')
    close()
    onDone?.()
  }, [accessToken, activeWorkspaceId, close, onDone, booked])

  const send = useCallback(async (state, { schedule }) => {
    setBusy(true)
    setNote('')

    // ── Protected accounts, BEFORE the row is written ──
    //
    // publishComposed refuses this too, and so does the n8n workflow. What
    // both of them are too late for is the row: writing it first means a
    // refused LinkedIn publish left a post sitting in pending_publish that
    // nothing would ever pick up, and the only feedback was "Saved, but
    // publishing failed". Refusing here leaves nothing behind.
    //
    // The composer already disables both buttons on a protected account, so
    // reaching this is a second tab, a stale render, or someone calling the
    // handler directly. It still has to be safe.
    const target = accounts.find(a => a.zernio_account_id === state.accountIds[0])
      || { platform: state.platform }
    if (!mayPublishTo(target)) {
      setBusy(false)
      setNote(protectionReason(target))
      return
    }

    // Row first, always. The workflow's duplicate guard is a filtered claim on
    // this row, and it is the only thing standing between a double-click and
    // the same post appearing twice on a real account. A post opened from
    // Approvals updates its own row rather than gaining a second one.
    const { post, error } = await writePost(
      accessToken, rowFrom(state, activeWorkspaceId, schedule ? 'scheduled' : 'pending_publish'),
      { postId: state.postId, postTable: state.postTable })
    if (error || !post) { setBusy(false); setNote(error || 'Could not save the post.'); return }

    const res = await publishComposed(state, {
      postId: post.id,
      postTable: state.postTable || 'generated_posts',
      workspaceId: activeWorkspaceId,
      // The real row rather than the platform alone, so publishPost's own
      // check can honour an account marked protected as well as a protected
      // platform. Without it that layer only ever sees { platform }.
      account: target,
      // Already booked: cancel the old Zernio post and book this version.
      reschedule: booked && !!state.postId,
    })
    setBusy(false)

    if (res.error) {
      // The row survives deliberately. It is now a draft that failed to go
      // out, which is recoverable from the posts list — discarding it would
      // throw away the caption, the media choices and every option chosen.
      setNote(`Saved, but publishing failed: ${res.error}`)
      onDone?.()
      return
    }
    setNote(schedule ? 'Scheduled.' : 'Published.')
    close()
    onDone?.()
  }, [accessToken, accounts, activeWorkspaceId, close, onDone, booked])

  return (
    <>
      {trigger && (
        <Button onClick={() => { setNote(''); setInitial(null); setOpen(true) }}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path d="M12 5v14M5 12h14" />
          </svg>
          {label}
        </Button>
      )}

      {note && <p className="text-xs text-text-secondary mt-2">{note}</p>}

      <PostComposer
        open={open}
        key={initial?.postId || 'new'}
        initial={initial}
        platform={initial?.platform || platform}
        accounts={accounts}
        accountsLoading={accountsLoading}
        campaigns={campaigns}
        workspaceId={activeWorkspaceId}
        busy={busy}
        onClose={close}
        onSaveDraft={saveDraft}
        onSchedule={state => send(state, { schedule: true })}
        onPublish={state => send(state, { schedule: false })}
      />
    </>
  )
}
