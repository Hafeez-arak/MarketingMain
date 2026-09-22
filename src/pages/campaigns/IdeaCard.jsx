// ─── One idea, as a card and as an edit modal ──────────────────────────────
// The review step's unit of work: deciding whether an idea is worth making —
// approve, reject with a reason, reword the idea.
//
// Deliberately nothing about the picture or the caption. Those are the next
// two steps, and they used to be offered here too (an image picker, a Studio
// button, image-option generation, three drafted captions per card) — so the
// same decision could be made in three places, and captions were paid for
// before anyone knew what picture they would sit under.
//
// The card and the modal move together because they are one feature: the card
// owns the idea, the modal is how it gets edited.

import { useState } from 'react'
import { Button, Input, Textarea, Spinner, Modal } from '../../components/ui/index'
import { formatDate } from '../../lib/utils'
import { formatsFor, aspectLabel } from '../../lib/postFormats'
import { logIdeaEvent, ideaSnapshot } from '../../lib/brandContext'
import { updateIdea } from '../../lib/contentPlans'
import { reviseIdea } from '../../lib/agentAgenda'
import { targetLabel, REJECT_REASONS, rejectReasonLabel } from './planConstants'

// Chip styling, and the review statuses an idea moves between. Local on
// purpose: the status set here (proposed / approved / rejected) is a REVIEW
// state, not the publish state that utils.js exports under the same name.
const OCCASION_STYLE = 'bg-amber-100 text-amber-800 border-amber-200'
const RESEARCH_STYLE = 'bg-sage-100 text-sage-800 border-sage-200'
const PILLAR_STYLE   = 'bg-clay-50 text-clay-700 border-clay-100'
const OWN_COPY_STYLE = 'bg-sage-100 text-sage-700 border-sage-200'
const STATUS_META = {
  proposed: { label: 'Proposed', cls: 'bg-stone-100 text-stone-600' },
  approved: { label: 'Approved', cls: 'bg-sage-100 text-sage-700' },
  rejected: { label: 'Rejected', cls: 'bg-red-50 text-red-500 line-through' },
}

// A post the operator wrote on the setup page. Distinct from an idea they
// merely typed a topic for: its words ARE the post.
const isOwnPost = idea => idea.copyMode === 'own'

// ─── One idea in the review list, with inline approve/reject + edit ─────────
export function IdeaCard({ idea, index, accessToken, workspaceId, onChange, onRemove, onCreate, autoEdit = false, lock = null, todayKey = '' }) {
  const [editing, setEditing] = useState(autoEdit)
  const [saving,  setSaving]  = useState(false)
  const [saveError, setSaveError] = useState('')
  const [showRejectReasons, setShowRejectReasons] = useState(false)
  const targets = idea.platforms?.length ? idea.platforms : [idea.platform]
  const own = isOwnPost(idea)
  const formatLabel = formatsFor(idea.platform).find(f => f.id === idea.postFormat)?.label || 'Feed image'

  async function setStatus(status, rejectReason = '') {
    setSaving(true)
    // Approving (or re-approving after a rejection) clears any old reason —
    // it shouldn't linger once the idea is no longer rejected.
    const result = await updateIdea(accessToken, idea.id, { status, reject_reason: rejectReason })
    setSaving(false)
    if (result.ok) {
      onChange({ ...idea, status, rejectReason })
      // Append-only decision log. plan_ideas is overwritten in place, so
      // without this the fact that an idea was rejected — and for what
      // reason — is lost the moment anyone re-approves or edits it. This is
      // the raw material the learning loop reads.
      logIdeaEvent(workspaceId, accessToken, {
        planId: idea.planId, ideaId: idea.id,
        event: status === 'rejected' ? 'rejected' : status === 'approved' ? 'approved' : 'edited',
        reason: rejectReason,
        before: { status: idea.status }, after: ideaSnapshot({ ...idea, status }),
      })
    }
  }

  // The idea's wording is all that is edited here. Platform, format, date and
  // the rest are settled on the later steps, so a save writes nothing else.
  async function saveEdits(patch) {
    setSaving(true)
    setSaveError('')
    // A card created via "+ Add idea" isn't in the database yet — it only
    // gets written on Save, so Cancel can discard it with zero backend trace.
    if (idea.isNew) {
      const result = await onCreate(idea, patch)
      setSaving(false)
      if (result.ok) setEditing(false)
      else setSaveError(result.error || 'Could not save idea.')
      return
    }
    const result = await updateIdea(accessToken, idea.id, {
      title: patch.title, topic: patch.topic, angle: patch.angle,
    })
    setSaving(false)
    if (!result.ok) { setSaveError('Could not save the change.'); return }
    const before = ideaSnapshot(idea)
    const after  = ideaSnapshot({ ...idea, ...patch })
    onChange({ ...idea, ...patch }); setEditing(false)
    // What a human changed about an AI's suggestion is the single most
    // direct signal of where the brief was wrong — worth more than the
    // final text on its own, which is why both sides are stored.
    logIdeaEvent(workspaceId, accessToken, {
      planId: idea.planId, ideaId: idea.id, event: 'edited', before, after,
    })
  }

  const st = STATUS_META[idea.status] || STATUS_META.proposed
  const rejected = idea.status === 'rejected'
  const chip = 'text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] border'

  return (
    <div className={`rounded-2xl border transition-all ${rejected ? 'border-border bg-surface-subtle opacity-70' : idea.status === 'approved' ? 'border-sage-200 bg-sage-50/30' : 'border-border bg-white'}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-[11px] font-bold text-text-disabled w-5 flex-shrink-0 text-right pt-0.5">{index + 1}</span>
          <div className="flex-1 min-w-0">
            {/* Title first — it is what the reviewer is judging. */}
            <p className="text-sm font-semibold text-text leading-snug">{idea.title || idea.topic || 'Untitled idea'}</p>
            {!own && idea.topic && idea.topic !== idea.title && (
              <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{idea.topic}</p>
            )}

            {/* One quiet line of facts: when, where, what shape. */}
            <p className="text-[11px] text-text-tertiary mt-1">
              {idea.date ? formatDate(idea.date) : 'Date set automatically'}
              {!lock?.locked && idea.date && todayKey && idea.date < todayKey && <span className="text-red-600 font-semibold"> (date has passed)</span>}
              {' · '}{targets.map(targetLabel).join(' + ')}
              {' · '}{formatLabel}{idea.aspectRatio ? ` ${aspectLabel(idea.aspectRatio)}` : ''}
              {(idea.postFormat === 'carousel' || idea.postFormat === 'photo_carousel' || idea.postFormat === 'multi_image') && idea.slideCount > 1 ? ` · ${idea.slideCount} ${idea.postFormat === 'multi_image' ? 'images' : 'slides'}` : ''}
            </p>

            {/* Your own post needs one label and nothing else — there is no
                AI reasoning to show for words you wrote. AI ideas keep the
                chips a reviewer judges them by. */}
            {own ? (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                <span className={`${chip} ${OWN_COPY_STYLE}`}>✎ Your caption</span>
              </div>
            ) : (idea.occasion || idea.pillar || idea.series || idea.objective || idea.source === 'research') && (
              <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
                {/* First, because it is the strongest thing that can be said
                    about an idea on this board: this one is not a slot the
                    planner filled, it traces back to something the research
                    agent found and a person chose to act on. The `Why:` line
                    below carries that finding across. */}
                {idea.source === 'research' && (
                  <span className={`${chip} ${RESEARCH_STYLE}`} title="Built from an idea the research agent proposed">
                    ◆ From research
                  </span>
                )}
                {idea.occasion && <span className={`${chip} ${OCCASION_STYLE}`}>★ {idea.occasion}</span>}
                {idea.pillar && <span className={`${chip} font-medium ${PILLAR_STYLE}`}>{idea.pillar}</span>}
                {idea.series && <span className={`${chip} bg-clay-50 text-clay-700 border-clay-100`} title="Deliberate recurring series — not flagged as repetition across months">{idea.series}</span>}
                {idea.objective && <span className={`${chip} font-medium bg-sky-50 text-sky-700 border-sky-100`}>{idea.objective}</span>}
              </div>
            )}

            {!own && idea.rationale && (
              <p className="text-[11px] text-text-tertiary mt-1.5 leading-relaxed"><span className="font-semibold text-text-secondary">Why:</span> {idea.rationale}</p>
            )}
            {!own && idea.cta && (
              <p className="text-[11px] text-sky-700 mt-1 leading-relaxed"><span className="font-semibold">CTA:</span> {idea.cta}</p>
            )}
            {rejected && idea.rejectReason && (
              <p className="text-[11px] text-red-500 mt-1 leading-relaxed"><span className="font-semibold">Rejected:</span> {rejectReasonLabel(idea.rejectReason)}</p>
            )}
          </div>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] flex-shrink-0 ${st.cls}`}>{st.label}</span>
        </div>

        {/* Actions — Reject reveals one-tap reason chips instead of rejecting blind.
            A post that has gone out has none: un-approving, editing or deleting
            the idea would not change what is already on the platform, only
            make the plan disagree with it. */}
        {lock?.locked ? (
          <div className="flex items-center gap-2 mt-3 pl-8 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] px-1.5 py-0.5 leading-[1.4] bg-sage-100 text-sage-700">
              {lock.state === 'publishing' ? '↗ Publishing' : '✓ Published'}
            </span>
            {lock.url && <a href={lock.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-700 hover:underline">View post ↗</a>}
            <span className="text-[11px] text-text-tertiary">Gone out — it can no longer be changed here.</span>
          </div>
        ) : showRejectReasons ? (
          <div className="flex items-center gap-1.5 mt-3 pl-8 flex-wrap">
            <span className="text-[11px] text-text-tertiary mr-1">Why?</span>
            {REJECT_REASONS.map(r => (
              <button key={r.value} onClick={() => { setShowRejectReasons(false); setStatus('rejected', r.value) }}
                className="text-[11px] font-medium px-2.5 py-1 rounded-lg border border-border text-text-secondary hover:border-red-300 hover:text-red-600 hover:bg-red-50 transition-colors">
                {r.label}
              </button>
            ))}
            <button onClick={() => setShowRejectReasons(false)} className="text-[11px] text-text-tertiary hover:text-text ml-1">Cancel</button>
          </div>
        ) : (
        <div className="flex items-center gap-2 mt-3 pl-8">
          <button onClick={() => setStatus('approved')} disabled={saving || idea.isNew || idea.status === 'approved'}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${idea.status === 'approved' ? 'bg-sage-100 text-sage-700 border-sage-200' : 'border-border text-text-secondary hover:border-sage-300 hover:text-sage-700 hover:bg-sage-50'}`}>
            ✓ Approve
          </button>
          <button onClick={() => setShowRejectReasons(true)} disabled={saving || idea.isNew || idea.status === 'rejected'}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors ${idea.status === 'rejected' ? 'bg-red-50 text-red-500 border-red-200' : 'border-border text-text-secondary hover:border-red-200 hover:text-red-500 hover:bg-red-50'}`}>
            ✕ Reject
          </button>
          {!idea.isNew && <button onClick={() => setEditing(true)} className="text-[11px] font-medium px-2.5 py-1 rounded-lg text-text-tertiary hover:text-text hover:bg-surface-subtle transition-colors">Edit</button>}
          <button onClick={() => onRemove(idea)} className="text-[11px] font-medium px-2.5 py-1 rounded-lg text-text-tertiary hover:text-red-500 transition-colors ml-auto">
            {idea.isNew ? 'Discard' : 'Delete'}
          </button>
        </div>
        )}
      </div>

      {editing && (
        <IdeaEditModal idea={idea} saving={saving} saveError={saveError} workspaceId={workspaceId} accessToken={accessToken}
          onClose={() => { if (idea.isNew) onRemove(idea); else setEditing(false) }} onSave={saveEdits} />
      )}
    </div>
  )
}

// Reword the idea by hand, or ask AI to. The AI never saves: it fills the
// boxes, and the person reads them and presses Save like any other edit.
export function IdeaEditModal({ idea, saving, saveError, onClose, onSave, workspaceId, accessToken }) {
  const [title, setTitle] = useState(idea.title || idea.topic || '')
  const [topic, setTopic] = useState(idea.topic || '')
  const [angle, setAngle] = useState(idea.angle || '')
  const [asking, setAsking] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [revising, setRevising] = useState(false)
  const [reviseError, setReviseError] = useState('')

  async function askAi() {
    if (!instruction.trim() || revising) return
    setRevising(true); setReviseError('')
    const res = await reviseIdea({ workspaceId, accessToken, idea: { title, topic, angle }, instruction })
    setRevising(false)
    if (!res.ok) { setReviseError(res.error || 'The rewrite failed.'); return }
    if (res.title) setTitle(res.title)
    if (res.topic) setTopic(res.topic)
    setAngle(res.angle || '')
    setAsking(false); setInstruction('')
  }

  // A brand-new idea has one box: what the post is about is also its title.
  const fresh = idea.isNew
  const empty = fresh ? !title.trim() : !title.trim() && !topic.trim()

  return (
    <Modal open onClose={onClose} title={fresh ? 'Add idea' : 'Edit idea'} width="max-w-xl">
      <div className="p-6 space-y-4">
        {fresh ? (
          <Textarea label="What is this post about?" rows={3} autoFocus value={title}
            onChange={e => setTitle(e.target.value)} />
        ) : (
          <>
            <Input label="Idea" value={title} onChange={e => setTitle(e.target.value)} />
            <Textarea label="What it's about" rows={3} value={topic} onChange={e => setTopic(e.target.value)} />
            <Textarea label="Angle (optional)" rows={2} value={angle} onChange={e => setAngle(e.target.value)} />

            {asking ? (
              <div className="rounded-xl border border-border bg-surface-subtle p-3 space-y-2">
                <Textarea label="How do you want it changed?" rows={2} autoFocus
                  placeholder="e.g. Make it about the Riyadh showroom, and less salesy"
                  value={instruction} onChange={e => setInstruction(e.target.value)} />
                {reviseError && <p className="text-xs text-red-600">{reviseError}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" size="xs" onClick={() => { setAsking(false); setReviseError('') }} disabled={revising}>Cancel</Button>
                  <Button size="xs" onClick={askAi} disabled={revising || !instruction.trim()}>
                    {revising ? <><Spinner size="sm" /> Rewriting…</> : 'Rewrite'}
                  </Button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAsking(true)}
                className="text-[11px] font-semibold text-amber-700 hover:text-amber-800">
                Change with AI
              </button>
            )}
          </>
        )}

        {saveError && <p className="text-xs text-red-600">{saveError}</p>}
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="secondary" onClick={onClose}>{fresh ? 'Discard' : 'Cancel'}</Button>
          <Button disabled={saving || revising || empty}
            onClick={() => onSave(fresh
              ? { title: title.trim(), topic: title.trim(), angle: '' }
              : { title: title.trim(), topic: topic.trim(), angle: angle.trim() })}>
            {saving ? <><Spinner size="sm" /> Saving…</> : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
