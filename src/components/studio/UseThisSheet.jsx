import { useState } from 'react'
import { Modal, Button, Input, Textarea, Spinner } from '../ui/index'
import { sendVersionToPosts, markIdeaMediaReady, SENDABLE_PLATFORMS } from '../../lib/studioBridge'
import { requestCaptionStudio } from '../../lib/campaignPlanner'
import { publishPost } from '../../lib/zernio'
import { BrandContextPanel } from '../BrandContextPanel'

// ─── "Use this →" ───────────────────────────────────────────────────────────
// The step that turns a finished Studio asset into real posts. Everything the
// app already knows how to do downstream — review, schedule, publish, measure —
// is reached from here, so this sheet is deliberately the ONLY new surface in
// that path rather than a new pipeline beside it.
//
// One sheet, not a wizard: pick where it goes, get a caption, say when. A
// separate page per step was the alternative and it loses the thing that makes
// this worth using — that the asset is right there while you decide.
//
// Nothing here talks to a platform directly. Rows are written by
// studioBridge#sendVersionToPosts and publishing goes through zernio.js so
// there stays exactly one path out, with one duplicate guard on it.

const PLATFORM_LABEL = {
  instagram: 'Instagram', tiktok: 'TikTok', snapchat: 'Snapchat',
}

// 9:16 covers Reel, TikTok and Spotlight at once — the whole reason targets are
// chosen before generating. A mismatch is a warning rather than a block: the
// operator may well know better than the catalog, and refusing outright would
// mean re-rendering to post something that would have been fine.
const NATIVE_RATIO = { instagram: ['4:5', '1:1', '9:16', '1.91:1'], tiktok: ['9:16'], snapchat: ['9:16'] }

// `brandContextFor` is Studio's own builder, passed down rather than rebuilt
// here — Studio has already loaded the schema, directory and memory for its
// generate panel, and a second loader would fetch the same rows again just to
// draft one caption.
export function UseThisSheet({ open, onClose, version, session, workspaceId, accessToken, webhooks, brandContextFor, onSent }) {
  const briefPlatforms = session?.brief?.platforms?.filter(p => SENDABLE_PLATFORMS.includes(p))
  const [targets, setTargets] = useState(briefPlatforms?.length ? briefPlatforms : ['instagram'])
  const [caption, setCaption] = useState(session?.brief?.caption || '')
  const [hashtags, setHashtags] = useState('')
  const [mode, setMode] = useState('queue')          // queue | schedule | now
  const [at, setAt] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [mutedKeys, setMutedKeys] = useState([])

  // Built here, from the mute state this sheet owns, so the panel below and
  // the payload in draftCaption are the same assembly — see CaptionStudio for
  // the same contract.
  const brandContext = brandContextFor
    ? brandContextFor({
        mutedKeys,
        // Same brief the caption request below is built from, so a service
        // named in the idea reaches the writer with its real detail.
        matchText: [
          session?.brief?.topic || session?.title || version?.user_prompt,
          session?.brief?.angle,
          session?.brief?.objective,
        ],
      })
    : null
  const toggleBlock = key => setMutedKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  const isVideo = version?.media_type === 'video' || !!version?.video_url

  // Two modes, because two things happen here.
  //
  // From a plan: the picture is one stage of a month's work. She has iterated
  // until she is happy, and all that is left is to say so — the caption and
  // the schedule belong to later stages, over the whole plan, once every
  // picture is done. Asking for them now would mean answering the same
  // questions twelve times, out of order, before the copy stage even runs.
  //
  // Standalone: there is no plan to go back to, so this IS the whole flow and
  // the full sheet is right.
  const fromPlan = !!session?.plan_idea_id
  const ratio = version?.aspect_ratio || session?.aspect_ratio || ''
  const mismatched = targets.filter(p => ratio && NATIVE_RATIO[p] && !NATIVE_RATIO[p].includes(ratio))

  function toggle(p) {
    setTargets(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])
  }

  // Reuses the Caption Studio webhook rather than adding one. It is
  // synchronous, already deployed, already brand-aware, and already knows the
  // per-platform shape — there was nothing here worth building again.
  async function draftCaption() {
    setDrafting(true); setError('')
    const res = await requestCaptionStudio(webhooks?.captionStudio, {
      mode: 'variants',
      platform: targets[0] || 'instagram',
      language: 'both',
      context: {
        topic: session?.brief?.topic || session?.title || version?.user_prompt || '',
        angle: session?.brief?.angle || '',
        tone: session?.brief?.tone || '',
        objective: session?.brief?.objective || '',
        cta: session?.brief?.cta || '',
        instructions: brandContext?.instructions || '',
        brand_name: brandContext?.brandName || '',
        brand_descriptor: brandContext?.brandDescriptor || '',
      },
      controls: {},
    })
    setDrafting(false)
    if (res.error) { setError(res.error); return }
    const v = (res.variants || [])[0]
    if (!v) { setError('Caption Studio returned nothing to use.'); return }
    // caption_* is the shape every platform returns now.
    const text = v.caption_en || v.caption_ar
      || [v.hook_en || v.hook_ar, v.body_en || v.body_ar].filter(Boolean).join('\n')
    setCaption(text || '')
    if (v.hashtags) setHashtags(v.hashtags)
  }

  // Plan mode: mark the idea's media done and fill the media into whatever
  // post row already exists for it. No caption is sent — plan generation may
  // have written one already, and sendVersionToPosts leaves copy alone when
  // none is supplied.
  async function confirmForPlan() {
    setBusy(true); setError('')
    const res = await sendVersionToPosts(workspaceId, accessToken, {
      version, session, targets: session?.brief?.platforms?.length ? session.brief.platforms : targets,
      caption: '', hashtags: '', captionAr: '', captionEn: '',
      when: { mode: 'queue' }, attachOnly: true,
    })
    if (res.error) { setBusy(false); setError(res.error); return }
    // Marked after the row is written, so the board can never say "ready"
    // about media that failed to attach to anything.
    const marked = await markIdeaMediaReady(accessToken, session.plan_idea_id, { version })
    setBusy(false)
    setDone({ posts: res.posts, failures: [], warning: marked.error || res.warning, plan: true })
    onSent?.(res.posts)
  }

  async function confirm() {
    setBusy(true); setError('')
    const res = await sendVersionToPosts(workspaceId, accessToken, {
      version, session, targets, caption, hashtags,
      captionAr: '', captionEn: '',
      when: { mode, at: mode === 'schedule' && at ? new Date(at).toISOString() : null },
    })
    if (res.error) { setBusy(false); setError(res.error); return }

    // Publishing is a second, separate call on purpose — one path to the
    // platform, and the duplicate guard lives on it. A row that fails to
    // publish is still a saved post the operator can retry from Approvals,
    // which is why a publish error here does not undo the send.
    const failures = []
    if (mode === 'now' || mode === 'schedule') {
      for (const p of res.posts) {
        const out = await publishPost(webhooks?.publishPost, {
          postId: p.id, postTable: p.table, workspaceId, platform: p.platform,
          caption, hashtags,
          imageUrl: version.image_url || '', videoUrl: version.video_url || '',
          coverImageUrl: isVideo ? (version.image_url || '') : '',
          scheduledFor: mode === 'schedule' && at ? new Date(at).toISOString() : undefined,
        })
        if (out.error) failures.push(`${PLATFORM_LABEL[p.platform] || p.platform}: ${out.error}`)
      }
    }
    setBusy(false)
    setDone({ posts: res.posts, failures, warning: res.warning })
    onSent?.(res.posts)
  }

  const canConfirm = targets.length > 0 && !busy && (mode !== 'schedule' || !!at)

  return (
    <Modal open={open} onClose={onClose} title={fromPlan ? "Use in plan" : "Use this"} width="max-w-xl">
      <div className="p-5 space-y-4">
        {done ? (
          <div className="space-y-3">
            {done.plan ? (
              <p className="text-sm font-semibold text-sage-700">
                Picture saved — this idea's media is done. Back to the plan to finish the rest.
              </p>
            ) : (
            <p className="text-sm font-semibold text-sage-700">
              {done.posts.length === 1 ? '1 post' : `${done.posts.length} posts`}{' '}
              {done.posts.some(p => p.updated) ? 'updated' : 'created'}
              {mode === 'queue' ? ' — waiting in Approvals.' : mode === 'schedule' ? ' — scheduled.' : ' — publishing.'}
            </p>
            )}
            <ul className="text-xs text-text-secondary space-y-1">
              {done.posts.map(p => (
                <li key={p.platform}>· {PLATFORM_LABEL[p.platform] || p.platform}{p.updated ? ' (filled in the planned post)' : ''}</li>
              ))}
            </ul>
            {done.warning && <p className="text-[11px] text-amber-700">{done.warning}</p>}
            {done.failures?.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-800">Saved, but publishing did not go through:</p>
                <p className="text-[11px] text-amber-700 mt-0.5">{done.failures.join(' · ')}</p>
                <p className="text-[11px] text-amber-700 mt-1">The post is in Approvals — you can retry from there.</p>
              </div>
            )}
            <div className="flex justify-end pt-1"><Button onClick={onClose}>Done</Button></div>
          </div>
        ) : fromPlan ? (
          /* From a plan — one decision, not five. The caption and the
             schedule are stages of their own, run over the whole month once
             every picture is finished. */
          <div className="space-y-4">
            <div className="border border-violet-200 bg-violet-50 px-4 py-3">
              <p className="text-[11px] font-semibold text-violet-800">
                For: {session?.brief?.title || session?.title || 'this plan idea'}
              </p>
              <p className="text-[11px] text-violet-700 mt-0.5 leading-relaxed">
                This marks the picture done and attaches it to the planned post. The caption comes
                later, once every idea in the plan has its media — so it can be written to match
                what is actually in the shot.
              </p>
            </div>
            {mismatched.length > 0 && (
              <p className="text-[11px] text-amber-700">
                This is {ratio}. {mismatched.map(p => PLATFORM_LABEL[p]).join(' and ')} expect
                {mismatched.length === 1 ? 's' : ''} 9:16 — it will still post, but it may be cropped.
              </p>
            )}
            {error && (
              <div className="border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[11px] text-red-700">{error}</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={onClose} disabled={busy}>Not yet</Button>
              <Button onClick={confirmForPlan} disabled={busy}>
                {busy ? <><Spinner size="sm" /> Saving…</> : "✓ This one's it"}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Where */}
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1.5">Where does this go?</p>
              <div className="flex flex-wrap gap-1.5">
                {SENDABLE_PLATFORMS.map(p => (
                  <button key={p} onClick={() => toggle(p)}
                    className={`text-[11px] font-semibold px-2.5 py-1 border transition-colors ${
                      targets.includes(p)
                        ? 'border-amber-500 bg-amber-50 text-amber-800'
                        : 'border-border text-text-secondary hover:border-amber-300'}`}>
                    {targets.includes(p) ? '✓ ' : ''}{PLATFORM_LABEL[p]}
                  </button>
                ))}
              </div>
              {mismatched.length > 0 && (
                <p className="text-[11px] text-amber-700 mt-1.5">
                  This is {ratio}. {mismatched.map(p => PLATFORM_LABEL[p]).join(' and ')} expect{mismatched.length === 1 ? 's' : ''} 9:16 —
                  it will still post, but it may be cropped.
                </p>
              )}
            </div>

            {/* Caption */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-text-secondary">Caption</p>
                <button onClick={draftCaption} disabled={drafting}
                  className="text-[11px] font-medium text-amber-700 hover:text-amber-800 disabled:opacity-50">
                  {drafting ? <><Spinner size="sm" /> Writing…</> : '✨ Draft it for me'}
                </button>
              </div>
              {brandContext && (
                <div className="mb-2">
                  <BrandContextPanel context={brandContext} mutedKeys={mutedKeys} onToggleBlock={toggleBlock} task="caption" />
                </div>
              )}
              <Textarea rows={4} autoGrow value={caption} onChange={e => setCaption(e.target.value)}
                placeholder="What should this post say?" />
              <Input className="mt-2" value={hashtags} onChange={e => setHashtags(e.target.value)}
                placeholder="#hashtags (optional)" />
            </div>

            {/* When */}
            <div>
              <p className="text-xs font-medium text-text-secondary mb-1.5">When?</p>
              <div className="flex flex-wrap gap-1.5">
                {[
                  { v: 'queue',    l: 'Send to Approvals' },
                  { v: 'schedule', l: 'Schedule' },
                  { v: 'now',      l: 'Publish now' },
                ].map(o => (
                  <button key={o.v} onClick={() => setMode(o.v)}
                    className={`text-[11px] font-semibold px-2.5 py-1 border transition-colors ${
                      mode === o.v ? 'border-amber-500 bg-amber-50 text-amber-800' : 'border-border text-text-secondary hover:border-amber-300'}`}>
                    {o.l}
                  </button>
                ))}
              </div>
              {mode === 'schedule' && (
                <Input type="datetime-local" className="mt-2" value={at} onChange={e => setAt(e.target.value)} />
              )}
              {mode === 'now' && (
                <p className="text-[11px] text-text-tertiary mt-1.5">Goes live immediately on the platforms above.</p>
              )}
            </div>

            {error && (
              <div className="border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[11px] text-red-700">{error}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button onClick={confirm} disabled={!canConfirm}>
                {busy ? <><Spinner size="sm" /> Sending…</> : mode === 'now' ? 'Publish' : mode === 'schedule' ? 'Schedule' : 'Send to Approvals'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
