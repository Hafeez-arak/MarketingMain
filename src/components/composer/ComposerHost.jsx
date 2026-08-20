import { useCallback, useEffect, useState } from 'react'
import { Button } from '../ui/index'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { publishComposed } from '../../lib/publishPost'
import { composedCaption, optionsFor, composerFromPost } from '../../lib/composerState'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { PostComposer } from './PostComposer'

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
  const videos = state.media.filter(m => m.type === 'video')
  const images = state.media.filter(m => m.type === 'image')

  return {
    workspace_id: workspaceId,
    platform: state.platform,
    caption: composedCaption(state),
    hashtags: state.hashtags || '',
    first_comment: opts.firstComment || '',
    format: state.format,
    media_type: videos.length ? 'video' : images.length ? 'image' : 'none',
    image_url: images[0]?.url || '',
    image_urls: images.map(m => m.url),
    video_url: videos[0]?.url || '',
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
  const { accounts } = useConnectedAccounts(platform)
  const [open, setOpen]       = useState(false)
  const [busy, setBusy]       = useState(false)
  const [note, setNote]       = useState('')
  const [initial, setInitial] = useState(null)

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
      setInitial(composerFromPost(openPost))
      setNote('')
      setOpen(true)
    })
    return () => { cancelled = true }
  }, [openPost])

  const close = useCallback(() => {
    setOpen(false)
    setBusy(false)
    setInitial(null)
    onOpenPostHandled?.()
  }, [onOpenPostHandled])

  const saveDraft = useCallback(async (state) => {
    setBusy(true)
    const { error } = await writePost(
      accessToken, rowFrom(state, activeWorkspaceId, 'draft'),
      { postId: state.postId, postTable: state.postTable })
    setBusy(false)
    if (error) { setNote(error); return }
    setNote('Saved as a draft.')
    close()
    onDone?.()
  }, [accessToken, activeWorkspaceId, close, onDone])

  const send = useCallback(async (state, { schedule }) => {
    setBusy(true)
    setNote('')

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
  }, [accessToken, activeWorkspaceId, close, onDone])

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
