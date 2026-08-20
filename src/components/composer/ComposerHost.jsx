import { useCallback, useState } from 'react'
import { Button } from '../ui/index'
import { useAuth } from '../../store/auth'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../lib/supabaseClient'
import { publishComposed } from '../../lib/publishPost'
import { composedCaption, optionsFor } from '../../lib/composerState'
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

async function insertPost(accessToken, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/generated_posts`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${accessToken || SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(row),
  })
  if (!res.ok) return { error: (await res.text()).slice(0, 300) || `Save failed (${res.status}).` }
  const rows = await res.json().catch(() => [])
  return { post: rows[0] || null }
}

export function ComposerHost({ platform, campaigns = [], onDone, label = 'Create post' }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const { accounts } = useConnectedAccounts(platform)
  const [open, setOpen]   = useState(false)
  const [busy, setBusy]   = useState(false)
  const [note, setNote]   = useState('')

  const close = useCallback(() => { setOpen(false); setBusy(false) }, [])

  const saveDraft = useCallback(async (state) => {
    setBusy(true)
    const { error } = await insertPost(accessToken, rowFrom(state, activeWorkspaceId, 'draft'))
    setBusy(false)
    if (error) { setNote(error); return }
    setNote('Saved as a draft.')
    close()
    onDone?.()
  }, [accessToken, activeWorkspaceId, close, onDone])

  const send = useCallback(async (state, { schedule }) => {
    setBusy(true)
    setNote('')

    // Row first. The workflow's duplicate guard is a filtered claim on this
    // row, and it is the only thing standing between a double-click and the
    // same post appearing twice on a real account.
    const { post, error } = await insertPost(
      accessToken, rowFrom(state, activeWorkspaceId, schedule ? 'scheduled' : 'pending_publish'))
    if (error || !post) { setBusy(false); setNote(error || 'Could not save the post.'); return }

    const res = await publishComposed(state, {
      postId: post.id, postTable: 'generated_posts', workspaceId: activeWorkspaceId,
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
      <Button onClick={() => { setNote(''); setOpen(true) }}>
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" />
        </svg>
        {label}
      </Button>

      {note && <p className="text-xs text-text-secondary mt-2">{note}</p>}

      <PostComposer
        open={open}
        platform={platform}
        accounts={accounts}
        campaigns={campaigns}
        busy={busy}
        onClose={close}
        onSaveDraft={saveDraft}
        onSchedule={state => send(state, { schedule: true })}
        onPublish={state => send(state, { schedule: false })}
      />
    </>
  )
}
