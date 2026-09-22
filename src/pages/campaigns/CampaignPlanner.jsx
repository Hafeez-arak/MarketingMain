import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, Button, Input, Textarea, Select, Spinner, Toggle, PostImage } from '../../components/ui/index'
import { uid, formatDate } from '../../lib/utils'
import { isBrandProfileEmpty, useBrandProfileSync, getBrandBrainSections } from '../../lib/brandBrain'
import { buildContext, fetchBrandMemory, logIdeaEvent, logIdeaEvents, ideaSnapshot } from '../../lib/brandContext'
import { fetchBrandSchema, fetchDirectoryRows } from '../../lib/brandSchema'
import { fetchBrandAssets } from '../../lib/brandAssets'
import { startCampaignPlan, normalizePlanPosts, elongateIdea, requestDraftCopy, triggerVideoRenders } from '../../lib/campaignPlanner'
import {
  formatsFor, defaultFormat, defaultAspectRatio, slideRange, aspectLabel,
  derivePostKind,
} from '../../lib/postFormats'
import { groupByWeek, monthOptions, normalizeAiIdea, distributeDates, formatTime, DEFAULT_POST_TIME, pollProblems, firstPlaceableDay } from './planModel'
import { brandTodayKey } from '../../lib/brandTime'
import { GOALS, OTHER_GOAL, isCustomGoal, WEEKDAYS, DEFAULT_DRAFT, isUntouchedSelection, targetLabel } from './planConstants'
import { IdeaCard } from './IdeaCard'
import { CaptionCard } from './CaptionCard'
import { GenerateMoreModal, CalendarView } from './plannerParts'
import { momentsInRange, dbIdeaToDraft } from '../../lib/campaignPlan'
import { PostComposer } from '../../components/composer/PostComposer'
import { composerFromIdea, slidesFromComposerMedia, flatOptionsFromComposer } from '../../lib/composerState'
import {
  createPlan, insertIdeas, updateIdea, setAllIdeaStatus, deleteIdea, updatePlan, markIdeasProcessing,
  markIdeasGenerated, fetchPastIdeas, fetchPlanWithIdeas, markIdeasDrafting, fetchIdeaDrafts, markIdeaDraftFailed,
  fetchPlannerMemory, fetchResearchIdeas, fetchUsedResearchKeys, readPlanGeneration, settlePlanGeneration,
  PLAN_GENERATION_TIMEOUT_MS,
} from '../../lib/contentPlans'
import { ResearchIdeaPicker } from './ResearchIdeaPicker'
import { BrandContextPanel } from '../../components/BrandContextPanel'
import { openStudioForIdea, publishIdeasAsPosts } from '../../lib/studioBridge'
import { slidesFor, slideUrls, legacyFieldsFor, hasOwnSlides } from '../../lib/planSlides'
import { fetchScheduledPosts } from '../../lib/scheduledPosts'
import { postLock } from '../../lib/postLock'
import { schedulePlanPosts } from '../../lib/planScheduling'
import { useConnectedAccounts } from '../../lib/useConnectedAccounts'
import { MediaViewer, SlideStrip } from '../../components/PostMediaViewer'
import { ImageFitter } from '../../components/media/ImageFitter'
import { refitSlides } from '../../lib/refitSlides'

// The five stages, in order. `media` is the pictures step and `captions` the
// words written against them — captions come after the picture on purpose, so
// they can describe what is actually in it.
const STEPS = [
  { key: 'setup',    label: 'Setup' },
  { key: 'review',   label: 'Review ideas' },
  { key: 'media',    label: 'Pictures' },
  { key: 'captions', label: 'Captions' },
  { key: 'done',     label: 'Done' },
]

function useDraft() {
  const { state, dispatch } = useApp()
  // Merge over DEFAULT_DRAFT (not a plain `||` fallback) so an older persisted
  // draft missing newer fields (e.g. ideas, planId) can't leave them undefined.
  const draft = { ...DEFAULT_DRAFT, ...(state.campaignPlanDraft || {}) }
  // Patches merge against the CURRENT draft, not the one this render captured.
  // Two dispatches from one render (set the step, then update ideas) would
  // otherwise have the second carry the old step along and undo the first.
  //
  // A patch may also be a FUNCTION of the current draft, for the same reason
  // one step further out: generation finishes minutes after it was started,
  // so the code appending its ideas must append to whatever the board holds
  // when the write lands, not to the array it captured at the click.
  const update = patch => dispatch(actions.setCampaignPlanDraft(
    prev => {
      const base = { ...DEFAULT_DRAFT, ...(prev || {}) }
      return { ...base, ...(typeof patch === 'function' ? patch(base) : patch) }
    },
  ))
  const clear  = () => dispatch(actions.setCampaignPlanDraft(null))
  return { draft, update, clear, state, dispatch }
}

// The finished picture a caption should be written from. Never a video — the
// clip is not sent to the model — and at most two images for a carousel. The
// workflow enforces the same limits; they are applied here too so the payload
// says what will actually be looked at.
function captionImagesFor(idea) {
  if (idea.mediaType === 'video' || idea.mediaType === 'none') return []
  if (idea.previewImageUrl) return [idea.previewImageUrl]
  if (idea.imageMode === 'use_reference') return (idea.references || []).filter(Boolean).slice(0, 2)
  return []
}

// A post that carries no picture or video at all — a LinkedIn text post or
// poll. It has no pictures step to go through: its words ARE the post.
const isTextOnly = idea => idea.mediaType === 'none'

// What stands in for the post on a card: the accepted Studio picture, or the
// image the operator attached. Reading only previewImageUrl showed a blank
// placeholder next to "✓ Your image" for every attached picture.
function thumbFor(idea) {
  if (isTextOnly(idea)) return ''
  if (idea.previewImageUrl) return idea.previewImageUrl
  if (idea.imageMode === 'use_reference') return (idea.references || [])[0] || ''
  return ''
}

// Every picture the post carries, in the order it goes out — all of a
// carousel's slides, not just the first.
function mediaUrlsFor(idea) {
  if (isTextOnly(idea)) return []
  // One ordered list, whatever each slide was made by. This used to return
  // `[idea.previewImageUrl]` when a Studio render existed and the uploads
  // otherwise — so a mixed carousel could only ever show one of its halves.
  return slideUrls(idea)
}

// ─── Main planner ───────────────────────────────────────────────────────────
export function CampaignPlanner() {
  const { draft, update, clear, state, dispatch } = useDraft()
  const navigate = useNavigate()
  const { activeWorkspaceId, accessToken, activeWorkspace } = useAuth()
  const webhookUrl = state.webhooks?.campaignPlanner || ''
  useBrandProfileSync(state, dispatch)

  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)

  // Directory data behind the Brand Brain section picker — fetched once so the
  // hidden picker can show live counts and generation can pull from it. Which
  // directories exist is per-brand (Arak has Suppliers, Aqeeq a Service Menu,
  // Alo Kheyatah Alterations), so this loads the workspace's own schema.
  const [directory, setDirectory] = useState({
    schema: { sections: [], fields: [], columns: [] }, rowsBySection: {}, assets: [],
  })
  // Active learned rules for this brand — every context build needs them.
  const [brandMemory, setBrandMemory] = useState([])
  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    Promise.all([
      fetchBrandSchema(activeWorkspaceId, accessToken),
      fetchDirectoryRows(activeWorkspaceId, accessToken),
      fetchBrandAssets(activeWorkspaceId, accessToken),
      fetchBrandMemory(activeWorkspaceId, accessToken),
    ]).then(([schema, rows, assets, memory]) => {
      if (!alive) return
      const rowsBySection = {}
      for (const r of rows) (rowsBySection[r.section_key] ||= []).push(r)
      setDirectory({ schema, rowsBySection, assets })
      setBrandMemory(memory)
      // What the AI reads by default: the brand's voice plus every directory it
      // has. For Aqeeq and Alo Kheyatah the service menu IS the subject matter.
      // Only applied while nobody has changed the selection, so a deliberate
      // choice in the hidden picker is never overridden.
      const dirKeys = (schema.sections || [])
        .filter(sec => sec.kind === 'directory' && sec.enabled !== false)
        .map(sec => sec.key)
      dispatch(actions.setCampaignPlanDraft(prev => {
        const base = { ...DEFAULT_DRAFT, ...(prev || {}) }
        if (!isUntouchedSelection(base.brandBrainSections || [])) return base
        return { ...base, brandBrainSections: ['voice', ...dirKeys] }
      }))
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  function contextFor(task, extra = {}) {
    const ctx = buildContext(state.brandProfile, directory.schema, directory, brandMemory, {
      task,
      sections: brandBrainSections,
      ...extra,
    })
    return {
      instructions: ctx.instructions,
      brand_name: ctx.brandName,
      brand_descriptor: ctx.brandDescriptor,
    }
  }

  // Review-step view controls (client-side only).
  const [statusFilter,   setStatusFilter]   = useState('all')   // all | undecided | approved | rejected
  const [seasonalOnly,   setSeasonalOnly]   = useState(false)
  const [autoEditId,     setAutoEditId]     = useState(null)     // idea to auto-open in the edit modal
  const [viewMode,       setViewMode]       = useState('list')   // 'list' | 'calendar'
  const [dayFilter,      setDayFilter]      = useState(null)     // 'YYYY-MM-DD' — set by clicking a calendar day
  function pickCalendarDay(dateKey) { setDayFilter(dateKey); setViewMode('list') }

  // The Brand Brain picker is tucked away: the defaults are right for almost
  // every plan, and a row of chips plus a context dump was the most confusing
  // thing on the page.
  const [showBrainPicker, setShowBrainPicker] = useState(false)
  // Whether the focus category is being typed rather than picked. Seeded from
  // the draft: a reopened plan whose category isn't on the list is a custom
  // one, and without this it would come back reading "General" while still
  // carrying the old value.
  const [customCategory, setCustomCategory] = useState(() => isCustomGoal(draft.goalCategory))

  // "Generate more ideas" — AI top-up on top of the existing plan.
  const [showMoreModal, setShowMoreModal] = useState(false)
  const [moreLoading,   setMoreLoading]   = useState(false)
  const [moreError,     setMoreError]     = useState('')

  // What to say while n8n is still writing. Derived rather than state: it is
  // a pure function of which kind of run is in flight, and holding it in
  // state meant setting it from inside the poll effect — a cascading render
  // for a sentence that was never independent of the draft in the first
  // place. `loading` still exists but now covers only the brief moment spent
  // handing the job over; the wait itself is not a request anyone is holding.

  const { step, month, goal, goalCategory, platforms, startDate, endDate, approxCount, includeHolidays, brandBrainSections, seedPosts, name, ideas, planId, manualResult, postingDays, aiAssist, contentMixTarget, openedFromPlanList, researchIdeaKeys, generatingPlanId, generatingMode } = draft

  // ── What the research agent proposed, for the setup step's picker ───────
  // The pull direction of the research loop. Pushing already existed (the
  // research page can send its ideas into a plan that already exists), but
  // that only helps someone who thought to read the report first. Planning a
  // month is when these are actually wanted, so they are fetched here and
  // shown where the decision is made.
  const [research, setResearch] = useState({ runDate: '', runId: '', ideas: [] })
  const [usedResearchKeys, setUsedResearchKeys] = useState([])
  useEffect(() => {
    if (!activeWorkspaceId || !accessToken) return undefined
    let alive = true
    Promise.all([
      fetchResearchIdeas(activeWorkspaceId, accessToken),
      fetchUsedResearchKeys(activeWorkspaceId, accessToken),
    ]).then(([r, used]) => {
      if (!alive) return
      setResearch(r)
      setUsedResearchKeys(used)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  // The draft as it is RIGHT NOW, for the generation poll below. That effect
  // deliberately does not list the draft in its dependencies — re-running it
  // would restart the interval and reset the guard that stops one result
  // being consumed twice — so it reads what it needs through here instead of
  // through a closure captured when the run started, minutes earlier.
  //
  // Written in an effect rather than during render: a ref mutated mid-render
  // is not safe under concurrent rendering, and the poll only ever reads this
  // long after the commit anyway.
  const draftRef = useRef(draft)
  useEffect(() => { draftRef.current = draft })

  const generationNote = !generatingPlanId ? ''
    : generatingMode === 'more'
      ? 'Writing more ideas… this keeps running if you leave the page.'
      : 'Writing the month… this keeps running if you leave the page.'

  const pickedResearchIdeas = research.ideas.filter(i => (researchIdeaKeys || []).includes(i.key))
  function toggleResearchIdea(key) {
    const on = (researchIdeaKeys || []).includes(key)
    update({ researchIdeaKeys: on ? researchIdeaKeys.filter(k => k !== key) : [...(researchIdeaKeys || []), key] })
  }

  // What the plan call will actually be given, for the preview panel inside the
  // hidden Brand Brain picker. Same builder as the payload.
  const setupContext = buildContext(state.brandProfile, directory.schema, directory, brandMemory, {
    task: 'plan', sections: brandBrainSections,
  })
  const activeRuleCount = brandMemory.filter(r => r.status === 'active').length
  const months = monthOptions()
  // Today in brand time, and the first day a post is placed on (tomorrow). A
  // plan for the month already under way still spans the whole month, but
  // nothing is placed — or offered to the AI — on a day that has gone by.
  const todayKey = brandTodayKey()
  const earliestDay = firstPlaceableDay(todayKey)
  const planFrom = earliestDay && startDate && earliestDay > startDate ? earliestDay : startDate
  const placement = { startDate, endDate, postingDays, notBefore: earliestDay }
  const dateMin = todayKey && startDate && todayKey > startDate ? todayKey : startDate
  const captionLanguage = state.brandProfile?.captionLanguage || 'both'

  // Supabase is the source of truth for a saved plan's ideas — the draft
  // persisted in localStorage can go stale (another tab, another day, the
  // Studio marking a picture ready). The instant a planId is present, pull the
  // real rows once and let them win, except for cards added locally that
  // haven't been saved yet ('new_' ids). Guarded by ref so it fires once per
  // planId, not on every render.
  const syncedPlanIdRef = useRef(null)
  useEffect(() => {
    if (!planId || !accessToken || !activeWorkspaceId) return
    if (syncedPlanIdRef.current === planId) return
    syncedPlanIdRef.current = planId
    fetchPlanWithIdeas(activeWorkspaceId, accessToken, planId).then(({ ok, plan, ideas: dbIdeas }) => {
      // Lookup failed rather than answered — a dropped request must never be
      // read as "not yours" and cost someone their in-progress board.
      if (!ok) { syncedPlanIdRef.current = null; return }
      // Answered, and the plan isn't this company's. Start clean rather than
      // keep a planId the next write would land in someone else's plan.
      if (!plan) { syncedPlanIdRef.current = null; clear(); return }
      if (!dbIdeas) return
      const dbDraftIdeas = dbIdeas.map(dbIdeaToDraft)
      const localOnly = (draft.ideas || []).filter(i => typeof i.id === 'string' && i.id.startsWith('new_'))
      update({ ideas: [...dbDraftIdeas, ...localOnly] })
    })
  }, [planId, accessToken, activeWorkspaceId])

  // ── What has already gone out ───────────────────────────────────────────
  // The post rows this plan produced, keyed by idea. An idea whose post has
  // been published (or is publishing) is read-only everywhere on this page:
  // the planner used to keep every field live, and saving again rewrote a
  // post that was already on Instagram. See lib/postLock.js.
  const { allAccounts: connectedAccounts, loading: accountsLoading } = useConnectedAccounts()
  const [planPosts, setPlanPosts] = useState({})
  const [postsTick, setPostsTick] = useState(0)
  const savedIdeaKey = ideas.filter(i => !i.isNew && !String(i.id).startsWith('new_')).map(i => i.id).join(',')
  useEffect(() => {
    if (!savedIdeaKey || !accessToken || !activeWorkspaceId) return
    let alive = true
    fetchScheduledPosts(activeWorkspaceId, accessToken, { planIdeaIds: savedIdeaKey.split(',') }).then(rows => {
      if (!alive) return
      const byIdea = {}
      for (const r of rows) (byIdea[r.plan_idea_id] ||= []).push(r)
      setPlanPosts(byIdea)
    })
    return () => { alive = false }
  }, [savedIdeaKey, accessToken, activeWorkspaceId, postsTick])

  // Locked when ANY of the idea's posts has gone out — the idea's words and
  // picture are what went out, so changing them would only make the plan
  // disagree with the platform.
  function ideaLock(idea) {
    for (const row of planPosts[idea.id] || []) {
      const lock = postLock(row)
      if (lock.locked) return { ...lock, url: row.platform_post_url || '' }
    }
    return null
  }
  const isLocked = idea => !!ideaLock(idea)

  // The full-screen picture viewer — { urls, videoUrl, start } or null.
  const [viewer, setViewer] = useState(null)
  function openMedia(idea, start = 0) {
    const urls = mediaUrlsFor(idea)
    if (!urls.length && !idea.previewVideoUrl) return
    setViewer({ urls, videoUrl: idea.previewVideoUrl || '', start })
  }

  // ── Captions ─────────────────────────────────────────────────────────────
  // Fire arak-draft-copy for a set of ideas — ONE call per idea, so a slow or
  // failed draft never blocks the rest. Captions only, and from the picture:
  // by the time this runs every approved idea has had its picture step.
  //
  // The call is fire-and-forget in the sense that nobody awaits the draft — it
  // lands in plan_ideas and the poll below picks it up. It is not
  // fire-and-forget about whether the request was accepted: a refused call
  // means no workflow is running, so the row is written 'failed' now rather
  // than left spinning (see markIdeaDraftFailed).
  async function draftCaptions(allIdeas, ids) {
    const draftCopyUrl = state.webhooks?.draftCopy
    if (!ids.length) return
    if (!draftCopyUrl) { setError('Draft Copy webhook not configured (Settings → Integrations).'); return }
    const nowIso = new Date().toISOString()
    update({ ideas: allIdeas.map(i => ids.includes(i.id) ? { ...i, draftStatus: 'drafting', draftedAt: nowIso, draftError: '', captionOptions: [] } : i) })
    await markIdeasDrafting(accessToken, ids)
    const targets = allIdeas.filter(i => ids.includes(i.id))
    const results = await Promise.allSettled(targets.map(idea => {
      // Per idea, not per batch: a large directory reaches the prompt as a
      // bare name index, so what the featured service actually is only
      // arrives if this idea's own brief is what selects it.
      const brandCtx = contextFor('caption', {
        matchText: [idea.topic, idea.title, idea.angle, idea.imageIdea],
      })
      return requestDraftCopy(draftCopyUrl, {
        plan_idea_id: idea.id, platform: idea.platform, topic: idea.topic, angle: idea.angle, tone: idea.tone,
        objective: idea.objective, cta: idea.cta, occasion: idea.occasion, content_pillar: idea.pillar,
        format: idea.postFormat, aspect_ratio: idea.aspectRatio, media_type: idea.mediaType,
        wants_caption: idea.wantsCaption, image_idea: idea.imageIdea,
        caption_language: captionLanguage, instructions: brandCtx.instructions,
        brand_name: brandCtx.brand_name, brand_descriptor: brandCtx.brand_descriptor,
        caption_only: true,
        image_urls: captionImagesFor(idea),
        // A poll's text introduces a question the post already asks, so the
        // writer is told what it is rather than inventing a second one.
        ...(idea.postFormat === 'poll' && idea.platformOptions?.poll ? { poll: idea.platformOptions.poll } : {}),
      })
    }))

    const failures = results
      .map((r, i) => ({ idea: targets[i], error: r.status === 'rejected' ? String(r.reason?.message || r.reason) : (r.value?.ok ? '' : r.value?.error || 'The Draft Copy webhook refused the request.') }))
      .filter(f => f.error)
    if (!failures.length) return
    await Promise.allSettled(failures.map(f => markIdeaDraftFailed(accessToken, f.idea.id, f.error)))
    const byId = new Map(failures.map(f => [f.idea.id, f.error]))
    // Against the CURRENT draft — the reviewer may have picked or edited
    // something while the call was in flight.
    dispatch(actions.setCampaignPlanDraft(prev => ({
      ...DEFAULT_DRAFT, ...(prev || {}),
      ideas: (prev?.ideas || []).map(i =>
        byId.has(i.id) && i.draftStatus === 'drafting'
          ? { ...i, draftStatus: 'failed', draftError: byId.get(i.id) }
          : i),
    })))
  }

  // A redraft is a rejection of the copy without a rejection of the idea.
  // Logged separately from the first draft: how often a kind of post needs a
  // second pass is invisible if both look the same in the log.
  const [redraftingId, setRedraftingId] = useState(null)
  async function redraftCaptions(target) {
    setRedraftingId(target.id)
    logIdeaEvent(activeWorkspaceId, accessToken, {
      planId, ideaId: target.id, event: 'redrafted',
      reason: target.draftStatus === 'failed' ? 'retry after failure' : 'asked for another take',
      before: ideaSnapshot(target),
    })
    const cleared = ideas.map(i => i.id === target.id ? { ...i, captionEn: '', captionAr: '' } : i)
    await draftCaptions(cleared, [target.id])
    setRedraftingId(null)
  }

  // Poll plan_ideas for cards currently 'drafting' — 4s while any are in
  // flight, stopped otherwise. A poll only overwrites a card while that card is
  // STILL locally 'drafting', so a late result never clobbers a choice.
  useEffect(() => {
    const draftingIds = ideas.filter(i => i.draftStatus === 'drafting').map(i => i.id)
    if (!draftingIds.length) return
    const timer = setInterval(async () => {
      const rows = await fetchIdeaDrafts(accessToken, draftingIds)
      if (!rows.length) return
      const now = Date.now()
      update({
        ideas: ideas.map(i => {
          if (i.draftStatus !== 'drafting') return i
          const row = rows.find(r => r.id === i.id)
          if (!row) return i
          // No drafted_at means the age is unknowable — time it out too rather
          // than wait forever on a card that can never satisfy the check.
          const staleMs = i.draftedAt ? now - new Date(i.draftedAt).getTime() : Infinity
          if (row.draft_status === 'drafting' && staleMs > 5 * 60 * 1000) {
            // Written down, not just patched locally — a local-only verdict
            // died with the tab and the next load resumed the same spinner.
            markIdeaDraftFailed(accessToken, i.id, 'Drafting timed out — no result came back from the workflow.')
            return { ...i, draftStatus: 'failed', draftError: 'Drafting timed out — try again.' }
          }
          if (row.draft_status === 'ready' || row.draft_status === 'failed') {
            return {
              ...i, draftStatus: row.draft_status, draftError: row.draft_error || '',
              captionOptions: row.caption_options || [],
            }
          }
          return i
        }),
      })
    }, 4000)
    return () => clearInterval(timer)
  }, [ideas, accessToken])

  const toggleSection  = s => update({ brandBrainSections: brandBrainSections.includes(s) ? brandBrainSections.filter(x => x !== s) : [...brandBrainSections, s] })
  const toggleDay      = d  => update({ postingDays: postingDays.includes(d) ? postingDays.filter(x => x !== d) : [...postingDays, d] })
  // ── Seed posts (specific posts the user already wants, optionally with an image) ──
  const addSeed = () => {
    const p = platforms[0] || 'instagram'
    const fmt = defaultFormat(p)
    update({ seedPosts: [...seedPosts, {
      text: '', platform: p, date: '', references: [],
      postFormat: fmt, aspectRatio: defaultAspectRatio(p, fmt), slideCount: slideRange(p, fmt)?.default || 1,
      // A topic to write from. Captions are chosen or typed on their own step.
      copyMode: 'ai',
    }] })
  }
  const updateSeed = (i, patch)  => update({ seedPosts: seedPosts.map((s, idx) => idx === i ? { ...s, ...patch } : s) })
  const removeSeed = i           => update({ seedPosts: seedPosts.filter((_, idx) => idx !== i) })
  function pickMonth(ym) {
    const opt = months.find(m => m.value === ym)
    if (!opt) return
    update({ month: ym, startDate: opt.start, endDate: opt.end, name: name || `${opt.label} Content Plan` })
  }

  function validateSetup() {
    if (!month) return 'Pick which month this plan is for.'
    const hasSeeds = seedPosts.some(s => s.text.trim())
    if (!aiAssist && !hasSeeds) return 'Add at least one post, or turn on "Also let AI suggest more posts."'
    return ''
  }

  const defaultGoal = () =>
    `A well-rounded month of brand content for ${activeWorkspace?.name || 'this brand'} — a mix of service and product highlights, educational content, and the seasonal/cultural moments falling in this month, all in the brand's own voice.`

  // ── The seed posts, in both the shapes the plan needs ───────────────────
  // Extracted from handleGeneratePlan because generation is now asynchronous:
  // the run finishes minutes after the button was pressed, possibly in a
  // different page lifetime after a reload, so the code that assembles the
  // board cannot close over values from the click. It reads the persisted
  // draft instead, and this is the one place that turns it into ideas.
  function buildSeeds(from = seedPosts) {
    const filledSeeds = from.filter(s => s.text.trim())
    // An attached image IS the post's picture. Without one, the picture is
    // made in the Studio on the pictures step.
    const seedImageMode = s => (s.references || []).length ? 'use_reference' : 'studio'
    const cleanSeeds = filledSeeds.map(s => ({
      text: s.text.trim(), platform: s.platform, format: s.postFormat || defaultFormat(s.platform), date: s.date || null,
      image_mode: seedImageMode(s), reference_image_urls: s.references || [],
    }))
    const seedIdeas = filledSeeds.map(s => {
      const postFormat = s.postFormat || defaultFormat(s.platform)
      const mediaType = formatsFor(s.platform).find(f => f.id === postFormat)?.media || 'image'
      const ownCopy = s.copyMode === 'own'
      // A manual seed's text is BOTH the caption and the title. The title is
      // what every card labels itself with, so a long caption is truncated
      // there; topic still carries the full text for history and the mix bar.
      const title = ownCopy && s.text.trim().length > 80
        ? `${s.text.trim().slice(0, 77)}…`
        : s.text.trim()
      return {
        platform: s.platform, date: s.date, time: DEFAULT_POST_TIME, title, topic: s.text,
        tone: 'professional',
        rationale: ownCopy ? '' : 'You added this as a specific post you wanted.',
        imageMode: seedImageMode(s), references: s.references,
        postFormat, aspectRatio: s.aspectRatio || defaultAspectRatio(s.platform, postFormat), mediaType,
        slideCount: s.slideCount || slideRange(s.platform, postFormat)?.default || 1,
        wantsCaption: true,
        postKind: derivePostKind({ platform: s.platform, format: postFormat, wantsCaption: true, slideCount: s.slideCount }),
        copyMode: ownCopy ? 'own' : 'ai',
        captionEn: ownCopy ? s.text.trim() : '',
      }
    })
    return { cleanSeeds, seedIdeas }
  }

  // The research ideas this month is being built around, in the shape the
  // workflow's prompt reads. Distinct from the `research` block that
  // fetchPlannerMemory already sends: that one is the whole latest run as
  // BACKGROUND, offered for the model to use if it fits. This is the
  // shortlist a person ticked, and the prompt treats it as an instruction —
  // which is the difference between the agent having a voice and having a
  // say.
  function chosenResearchPayload() {
    if (!pickedResearchIdeas.length) return null
    return {
      date: research.runDate,
      ideas: pickedResearchIdeas.map(i => ({
        title: i.title, angle: i.angle, rationale: i.rationale,
        answers: i.answers, suggested_format: i.suggested_format,
      })),
    }
  }

  async function handleGeneratePlan() {
    const v = validateSetup()
    if (v) { setError(v); return }
    // The AI planner webhook is only needed when AI-assist is actually on —
    // a plan of only your own posts never calls it.
    if (aiAssist && !webhookUrl) { setError('Campaign Planner webhook not configured (Settings → Integrations).'); return }
    setError(''); setLoading(true)

    const { cleanSeeds, seedIdeas } = buildSeeds()
    const effectiveGoal = aiAssist ? (goal.trim() || defaultGoal()) : ''

    // ── The plan row is created FIRST, and that ordering is the fix ───────
    // It used to be created last, after the webhook had answered with the
    // ideas. That made the open HTTP request the ONLY place a running plan
    // existed — so when a month took longer than the proxy in front of n8n
    // survives, the request 504'd, n8n finished into a socket nobody held,
    // and an Opus-priced month was discarded with nothing to show for it.
    // Creating the row first gives the run somewhere to land that does not
    // depend on anyone still waiting.
    const startedAt = new Date().toISOString()
    const planRes = await createPlan(activeWorkspaceId, accessToken, {
      name: name || `${months.find(m => m.value === month)?.label || 'Monthly'} Content Plan`,
      month, start_date: startDate, end_date: endDate,
      goal: effectiveGoal, goal_category: goalCategory || '', platforms,
      status: aiAssist ? 'generating' : 'draft',
      posting_days: postingDays, default_time: DEFAULT_POST_TIME,
      content_mix_target: contentMixTarget || null,
      ...(aiAssist ? {
        generation_started_at: startedAt, generation_mode: 'new', generation_error: '',
      } : {}),
    })
    if (planRes.error) { setLoading(false); setError(`Plan couldn't be saved: ${planRes.error}`); return }
    const newPlanId = planRes.plan.id

    // A plan of only your own posts never calls n8n, so there is nothing to
    // wait for — it is finished here, exactly as it always was.
    if (!aiAssist) {
      setLoading(false)
      await finishGeneration(newPlanId, planRes.plan.name, seedIdeas, [])
      return
    }

    // What the planner plans against beyond the Brand Brain: every idea from
    // other plans (anti-repetition), the latest research, the research
    // agent's memory, and the posts actually made lately.
    const [pastIdeas, memory] = await Promise.all([
      fetchPastIdeas(activeWorkspaceId, accessToken, null),
      fetchPlannerMemory(activeWorkspaceId, accessToken),
    ])
    const brandCtx = contextFor('plan')

    const started = await startCampaignPlan(webhookUrl, {
      plan_id: newPlanId,
      goal: effectiveGoal,
      goal_category: goalCategory || null,
      platforms,
      start_date: planFrom,
      end_date: endDate,
      approx_post_count: approxCount ? Number(approxCount) : null,
      include_holidays: includeHolidays,
      brand_brain_sections: brandBrainSections,
      instructions: brandCtx.instructions || null,
      brand_name: brandCtx.brand_name,
      brand_descriptor: brandCtx.brand_descriptor,
      seed_posts: cleanSeeds,
      content_mix_target: contentMixTarget || null,
      past_ideas: pastIdeas,
      research: memory.research,
      chosen_research_ideas: chosenResearchPayload(),
      agent_memory: memory.agentMemory,
      recent_posts: memory.recentPosts,
      posting_days: postingDays,
      posting_time: DEFAULT_POST_TIME,
    })
    setLoading(false)
    if (started.error) {
      // n8n never took the job, so nothing will ever write to this row. Put it
      // back to a plain draft rather than leaving a plan that polls forever.
      await settlePlanGeneration(accessToken, newPlanId, { error: '' })
      setError(started.error)
      return
    }

    // From here the run belongs to the plan row, not to this page. Recording
    // the id in the draft is what lets the wait be picked back up after a
    // reload or a navigation away.
    syncedPlanIdRef.current = newPlanId
    update({
      planId: newPlanId,
      name: planRes.plan.name,
      generatingPlanId: newPlanId,
      generatingMode: 'new',
      step: 'review',
    })
    // No captions here. They are written on the captions step, from the
    // picture each post actually ends up with.
  }

  // ── Turning a finished run into the board ───────────────────────────────
  // Shared by both paths onto the review step: a plan with no AI at all
  // (which is finished the moment it is created) and one whose ideas arrived
  // minutes later from n8n.
  async function finishGeneration(targetPlanId, planName, seedIdeas, aiPosts) {
    // Your posts first, AI suggestions after. Anything without a date is
    // spread evenly through the month, around the ones that have one.
    // A date the model gave that has already passed is placed again; a date
    // you typed on a post is kept (the picker never offers a past day).
    const allIdeas = distributeDates([...seedIdeas, ...aiPosts.map(i => ({ ...i, date: i.date && i.date < earliestDay ? '' : i.date }))], placement)
      .map(i => ({ ...i, time: i.time || DEFAULT_POST_TIME }))

    const ideasRes = await insertIdeas(activeWorkspaceId, accessToken, targetPlanId, allIdeas)
    if (ideasRes.error) { setError(`Ideas generated but couldn't be saved: ${ideasRes.error}`); return }

    // Created in this tab — the ideas are already fresh, so the mount-sync
    // effect does not need to re-fetch them.
    syncedPlanIdRef.current = targetPlanId
    update({
      planId: targetPlanId,
      ideas: ideasRes.rows.map(dbIdeaToDraft),
      name: planName,
      step: 'review',
      generatingPlanId: null,
    })
  }

  // Top up the existing plan with more AI ideas — same webhook, with the
  // plan's current ideas sent so the workflow steers away from repeating them.
  async function handleGenerateMore({ count, focus }) {
    if (!webhookUrl) { setMoreError('Campaign Planner webhook not configured (Settings → Integrations).'); return }
    setMoreError(''); setMoreLoading(true)

    const brandCtx = contextFor('plan')
    const effectiveGoal = focus.trim() || goal.trim() || defaultGoal()
    const existingIdeas = ideas.slice(-60).map(i => ({
      platform: i.platform, date: i.date, topic: i.topic || i.title, pillar: i.pillar,
    }))
    const [pastIdeas, memory] = await Promise.all([
      fetchPastIdeas(activeWorkspaceId, accessToken, planId),
      fetchPlannerMemory(activeWorkspaceId, accessToken),
    ])

    // Same async contract as the first generation: the plan row already
    // exists here, so it only has to be put back into 'generating' for n8n to
    // write onto. A top-up is a smaller ask than a whole month but runs on the
    // same Opus call, so it hit the same timeout and lost the same way.
    const marked = await updatePlan(accessToken, planId, {
      status: 'generating',
      generation_result: null,
      generation_error: '',
      generation_started_at: new Date().toISOString(),
      generation_mode: 'more',
    })
    if (marked.error) { setMoreLoading(false); setMoreError(`Couldn't start: ${marked.error}`); return }

    const started = await startCampaignPlan(webhookUrl, {
      plan_id: planId,
      goal: effectiveGoal,
      goal_category: goalCategory || null,
      platforms,
      start_date: planFrom,
      end_date: endDate,
      approx_post_count: count,
      include_holidays: includeHolidays,
      brand_brain_sections: brandBrainSections,
      instructions: brandCtx.instructions || null,
      brand_name: brandCtx.brand_name,
      brand_descriptor: brandCtx.brand_descriptor,
      existing_ideas: existingIdeas,
      past_ideas: pastIdeas,
      research: memory.research,
      // NO chosen_research_ideas here, unlike the first generation.
      //
      // The ticks live in the draft and are not cleared once they have been
      // built, so sending them again would re-state "each of these MUST
      // become a post" about ideas that ARE already posts in this plan — at
      // the same time as existing_ideas says not to repeat what is already
      // there. Two contradictory orders about the same three ideas, with the
      // louder one arriving later: the top-up would duplicate the month's
      // spine instead of adding to it.
      //
      // Nothing is lost by leaving it out. `research` above still carries the
      // whole run, including those ideas, as background — so the model can
      // still complement them, it just cannot be ordered to rebuild them.
      // A specific research angle wanted in a top-up goes in the modal's
      // focus field, which is what that field is for.
      agent_memory: memory.agentMemory,
      recent_posts: memory.recentPosts,
      posting_days: postingDays,
      posting_time: DEFAULT_POST_TIME,
    })
    setMoreLoading(false)
    if (started.error) {
      await settlePlanGeneration(accessToken, planId, { error: '' })
      setMoreError(started.error)
      return
    }
    update({ generatingPlanId: planId, generatingMode: 'more' })
    setShowMoreModal(false)
  }

  // ── Waiting on a run that outlives this page ────────────────────────────
  // The only thing holding a running plan is the row itself, so this polls it
  // rather than an open request. That is what makes the wait survivable: it
  // restarts on mount from the persisted draft, so a reload, a tab switch, or
  // wandering off to another page mid-generation all pick the plan back up
  // instead of stranding it.
  //
  // ── Consuming a result exactly once ─────────────────────────────────────
  // A non-null generation_result means "work nobody has picked up yet", so
  // two readers both acting on it insert the same month twice — a whole
  // duplicate board, from one paid run.
  //
  // `settled` closes that within one effect instance (two ticks racing). It
  // is not enough on its own: StrictMode mounts every effect twice in dev, so
  // there are two instances with two separate flags. `consumingRef` is the
  // guard that spans them — it names the plan currently being consumed, and
  // it is a ref rather than state precisely because it must be true the
  // instant it is set, not after a re-render.
  const consumingRef = useRef(null)
  useEffect(() => {
    if (!generatingPlanId || !accessToken || !activeWorkspaceId) return undefined
    let alive = true
    let settled = false
    // A wall clock of our own, alongside the row's generation_started_at. The
    // row's timestamp cannot expire a run whose reads are ALL failing, and a
    // poll that can never conclude is the failure mode this whole change
    // exists to remove. Read on the first tick rather than here: the clock is
    // impure, and an effect body must stay free of that.
    let giveUpAt = 0

    // Both flags are set BEFORE the first await inside fn, so a second caller
    // arriving mid-consume is turned away rather than joining in. Deliberately
    // not cleared on the way out: the run is over, and the only thing that
    // starts another is a new generatingPlanId.
    async function finish(fn) {
      if (settled || !alive) return
      if (consumingRef.current === generatingPlanId) return
      settled = true
      consumingRef.current = generatingPlanId
      await fn()
    }

    async function tick() {
      if (!giveUpAt) giveUpAt = Date.now() + PLAN_GENERATION_TIMEOUT_MS
      const r = await readPlanGeneration(activeWorkspaceId, accessToken, generatingPlanId)
      if (!alive || settled) return

      if (r.state === 'ready') {
        await finish(async () => {
          const norm = normalizePlanPosts(r.result, { platforms })
          if (norm.error) {
            await settlePlanGeneration(accessToken, generatingPlanId, { error: '' })
            update({ generatingPlanId: null })
            ;(r.mode === 'more' ? setMoreError : setError)(norm.error)
            return
          }
          const aiPosts = norm.posts.map(normalizeAiIdea)
          // Clear the row BEFORE inserting. A consumed result that is still
          // sitting there is indistinguishable from a fresh one, and the next
          // mount would replay the whole month into the plan a second time.
          await settlePlanGeneration(accessToken, generatingPlanId, { error: '' })
          const live = draftRef.current
          if (r.mode === 'more') {
            const more = distributeDates(aiPosts, { ...placement, replacePast: true })
              .map(i => ({ ...i, time: i.time || DEFAULT_POST_TIME }))
            const ideasRes = await insertIdeas(activeWorkspaceId, accessToken, generatingPlanId, more, live.ideas.length)
            if (ideasRes.error) {
              update({ generatingPlanId: null })
              setMoreError(`Generated but couldn't be saved: ${ideasRes.error}`)
            } else {
              // Appended functionally, against whatever the board holds when
              // the write lands — not the array this effect started with.
              const fresh = ideasRes.rows.map(dbIdeaToDraft)
              update(prev => ({ generatingPlanId: null, ideas: [...(prev?.ideas || []), ...fresh] }))
            }
          } else {
            await finishGeneration(generatingPlanId, live.name, buildSeeds(live.seedPosts).seedIdeas, aiPosts)
          }
        })
        return
      }

      if (r.state === 'failed') {
        await finish(async () => {
          await settlePlanGeneration(accessToken, generatingPlanId, { error: '' })
          update({ generatingPlanId: null })
          ;(r.mode === 'more' ? setMoreError : setError)(r.error)
        })
        return
      }

      if (r.state === 'gone' || r.state === 'stale' || Date.now() > giveUpAt) {
        await finish(async () => {
          if (r.state !== 'gone') await settlePlanGeneration(accessToken, generatingPlanId, { error: '' })
          update({ generatingPlanId: null })
          ;(r.mode === 'more' ? setMoreError : setError)(
            'The planner stopped answering and nothing was saved. Nothing was charged twice — ' +
            'the run is over. Try generating again.')
        })
      }
      // 'working' and 'unknown' both mean keep waiting. 'unknown' is a failed
      // READ, not a failed run, and treating one dropped request as a dead
      // plan would throw away a month that is still being written.
    }

    tick()
    const id = setInterval(tick, 5000)
    return () => { alive = false; clearInterval(id) }
    // `ideas` and `name` are read inside but deliberately not dependencies:
    // re-running this effect would restart the interval and, worse, reset the
    // `settled` guard that stops a result being consumed twice. The values it
    // needs at completion are re-read from the draft at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatingPlanId, generatingMode, accessToken, activeWorkspaceId])

  function onIdeaChange(updated) {
    update({ ideas: ideas.map(i => i.id === updated.id ? updated : i) })
  }

  // The pictures and captions steps work on approved ideas only.
  const approvedIdeas = ideas.filter(i => i.status === 'approved')
  // An idea using its own image already HAS its picture — it was attached, not
  // made, so counting only Studio-accepted media would show "0 of 4 ready".
  // "Is any of this yours?" — asked of the slide list rather than of a mode,
  // because a mixed carousel is both Studio's and yours and the old
  // single-mode question had no true answer for it.
  const hasOwnMedia = i => hasOwnSlides(i)
  const hasMedia = i => i.mediaStatus === 'ready' || slidesFor(i).length > 0
  // Only posts that take a picture go through the pictures step. A plan of
  // nothing but LinkedIn text posts and polls skips it entirely.
  const mediaIdeas = approvedIdeas.filter(i => !isTextOnly(i))
  const mediaReadyCount = mediaIdeas.filter(hasMedia).length
  // Nothing approved yet reads as the usual next step, not as a skip.
  const afterReview = mediaIdeas.length || !approvedIdeas.length ? 'media' : 'captions'

  // Captions: a post is ready when it needs no caption, carries your own, or
  // has one chosen from the options.
  const needsAiCaption = i => i.wantsCaption !== false && i.copyMode !== 'own'
  const hasCaption = i => !!((i.captionEn || '').trim() || (i.captionAr || '').trim())
  // A poll is not finished until its question and answers are, whatever its
  // text says — LinkedIn cannot edit a poll once it is published.
  const pollReady = i => i.postFormat !== 'poll' || pollProblems(i.platformOptions?.poll).length === 0
  const captionReady = i => (i.wantsCaption === false || hasCaption(i)) && pollReady(i)
  const captionsMissing = approvedIdeas.filter(i => !isLocked(i) && !captionReady(i))
  // What saving the plan will write: approved posts that haven't gone out.
  const toSchedule = approvedIdeas.filter(i => !isLocked(i))
  const captionsDrafting = approvedIdeas.some(i => i.draftStatus === 'drafting')

  // Arriving on the captions step writes the options for every post that still
  // needs them — once per idea per visit, never for your own words, and never
  // over options already there (those get "↻ New options" instead).
  const autoDraftedRef = useRef(new Set())
  const approvedDraftKey = approvedIdeas.map(i => `${i.id}:${i.draftStatus}`).join(',')
  useEffect(() => {
    if (step !== 'captions' || !accessToken) return
    const todo = approvedIdeas.filter(i =>
      !isLocked(i) && needsAiCaption(i) && !hasCaption(i) && !autoDraftedRef.current.has(i.id) &&
      (i.draftStatus === 'not_started' || !i.draftStatus || (i.draftStatus === 'ready' && !(i.captionOptions || []).length)))
    if (!todo.length) return
    todo.forEach(i => autoDraftedRef.current.add(i.id))
    draftCaptions(ideas, todo.map(i => i.id))
  }, [step, accessToken, approvedDraftKey])


  // A new picture makes caption options written for the old one stale. The
  // chosen caption is left alone — it may well still fit, and it is the
  // reviewer's to change.
  const staleCaptionPatch = idea => needsAiCaption(idea) && !hasCaption(idea) && (idea.captionOptions || []).length
    ? { db: { caption_options: [], draft_status: 'not_started' }, local: { captionOptions: [], draftStatus: 'not_started' } }
    : { db: {}, local: {} }

  // ── Saving an idea's slides ──────────────────────────────────────────────
  // The ONE writer. Everything that changes a picture — the media picker, a
  // reorder, a removal, a Studio render coming back — goes through here, and
  // it writes the slide list plus the legacy columns derived from it. Two
  // writers would have meant two chances for `slides` and
  // preview_image_url/reference_image_urls to disagree about the same post,
  // and the older screens still read the derived ones.
  async function saveSlides(idea, slides, { clearStaleCaption = true } = {}) {
    if (!idea) return { ok: true }
    if (isLocked(idea)) return { error: 'This post has already gone out, so its picture can’t be changed.' }
    const stale = clearStaleCaption ? staleCaptionPatch(idea) : { db: {}, local: {} }
    const legacy = legacyFieldsFor(slides)
    const result = await updateIdea(accessToken, idea.id, { slides, ...legacy, ...stale.db })
    if (result.error) return { error: result.error }
    if (clearStaleCaption) autoDraftedRef.current.delete(idea.id)
    onIdeaChange({
      ...idea,
      slides,
      references: legacy.reference_image_urls,
      previewImageUrl: legacy.preview_image_url,
      previewVideoUrl: legacy.preview_video_url,
      imageMode: legacy.image_mode,
      mediaType: legacy.media_type,
      slideCount: legacy.slide_count,
      ...stale.local,
    })
    return { ok: true }
  }

  // ── Editing a post from the pictures step ────────────────────────────────
  // The same "Create a post" composer the Instagram page opens, deliberately
  // — this popup and that one write captions in only one place, and the
  // picture, the caption-authorship choice and the platform extras (first
  // comment, collaborators, alt text, AI disclosure) are all decisions made
  // WHILE looking at the picture.
  const [editIdea, setEditIdea] = useState(null)
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState('')
  async function saveIdeaFromComposer(state) {
    const idea = editIdea
    if (!idea) return
    setEditSaving(true); setEditError('')
    const nextSlides = slidesFromComposerMedia(slidesFor(idea), state.media)
    const pictureChanged = slideUrls({ slides: nextSlides }).join('|') !== slideUrls(idea).join('|')
    const own = state.copyMode === 'own'
    const legacy = legacyFieldsFor(nextSlides)
    const stale = pictureChanged ? staleCaptionPatch(idea) : { db: {}, local: {} }
    const aspectRatio = defaultAspectRatio(state.platform, state.format)
    // plan_ideas.platform_options is flat (scoped to the idea's one active
    // platform), unlike generated_posts' — see composerFromIdea's comment.
    const flatOptions = flatOptionsFromComposer(state)
    const firstComment = flatOptions.firstComment || ''
    const result = await updateIdea(accessToken, idea.id, {
      platform: state.platform, format: state.format, aspect_ratio: aspectRatio,
      hashtags: state.hashtags || '', first_comment: firstComment,
      platform_options: flatOptions,
      copy_mode: own ? 'own' : 'ai',
      caption_en: own ? state.caption.trim() : '',
      caption_ar: own ? (state.captionAr || '').trim() : '',
      slides: nextSlides, ...legacy, ...stale.db,
    })
    setEditSaving(false)
    if (result.error) { setEditError(result.error); return }
    const before = ideaSnapshot(idea)
    const after  = { ...idea, platform: state.platform, postFormat: state.format, hashtags: state.hashtags, copyMode: own ? 'own' : 'ai' }
    onIdeaChange({
      ...idea,
      platform: state.platform, postFormat: state.format, aspectRatio,
      hashtags: state.hashtags || '', firstComment,
      platformOptions: flatOptions,
      copyMode: own ? 'own' : 'ai',
      captionEn: own ? state.caption.trim() : '', captionAr: own ? (state.captionAr || '').trim() : '',
      slides: nextSlides,
      references: legacy.reference_image_urls, previewImageUrl: legacy.preview_image_url,
      previewVideoUrl: legacy.preview_video_url, imageMode: legacy.image_mode,
      mediaType: legacy.media_type, slideCount: legacy.slide_count,
      ...stale.local,
    })
    setEditIdea(null)
    // Same signal the review step records: what a human changed about the
    // AI's suggestion is worth more than the final text on its own.
    logIdeaEvent(activeWorkspaceId, accessToken, {
      planId: idea.planId, ideaId: idea.id, event: 'edited', before, after,
    })
  }

  // A carousel's slides, put in a new order from the pictures step. Saved at
  // once — the order is what goes out. Reordering is not a new picture, so it
  // leaves the drafted captions alone.
  async function reorderSlides(idea, urls) {
    const by = new Map(slidesFor(idea).map(s => [s.url, s]))
    const next = urls.map(url => by.get(url) || { url, type: 'image', source: 'upload' })
    const res = await saveSlides(idea, next, { clearStaleCaption: false })
    if (res.error) setError(`Couldn't save the slide order: ${res.error}`)
  }

  // ── Adjusting one slide's shape, from the card ───────────────────────────
  //
  // A carousel went out to Instagram with a 1239 × 488 slide in it and came
  // back refused — "Aspect ratio 2.5389:1 is outside Instagram's allowed range
  // (0.5625 to 1.91)" — after the row had been claimed as pending_publish, and
  // draft_status only ever closes from n8n, so the spinner outlived the error.
  // The strip on this card is where you SEE that a slide is the wrong shape;
  // until now the only way to fix it was to reopen the composer and find the
  // slide again.
  //
  // Held as ids rather than as the idea object: the fitter's upload takes a
  // second or two, a poll can replace the ideas array underneath it in that
  // time, and applying the result to a captured stale object would write back
  // a slide list that has since moved on.
  const [adjusting, setAdjusting] = useState(null)   // { ideaId, index }
  const [refitting, setRefitting] = useState(false)

  const adjustingIdea = adjusting ? ideas.find(i => i.id === adjusting.ideaId) || null : null
  const adjustingSlides = adjustingIdea ? slidesFor(adjustingIdea) : []
  const adjustingSlide = adjusting ? adjustingSlides[adjusting.index] || null : null

  async function applyAdjustedSlide(fitted, { ratio, mode, applyToAll }) {
    const idea = adjustingIdea
    const at = adjusting?.index
    setAdjusting(null)
    if (!idea || at == null) return

    const current = slidesFor(idea)
    // `source: 'library'` — the fitter uploaded the rendered result to the
    // media library, so that is honestly where this picture now lives. Keeping
    // 'studio' would send "reopen in Studio" back to a session that made the
    // picture BEFORE it was cropped.
    const next = current.map((s, i) => (i === at
      ? { ...s, url: fitted.url, type: 'image', source: 'library' }
      : s))

    // clearStaleCaption: false, the same as reordering. A crop reframes the
    // picture that was already there; it does not make a caption written about
    // it wrong, and silently throwing away approved copy over a shape change
    // is a worse surprise than a caption that is slightly loosely framed.
    const res = await saveSlides(idea, next, { clearStaleCaption: false })
    if (res.error) { setError(`Couldn't save the adjusted slide: ${res.error}`); return }
    if (!applyToAll) return

    // The fitter always offers "apply to every slide" here — this strip only
    // draws at all past the first slide — so the tick has to mean something.
    setRefitting(true)
    try {
      const refitted = await refitSlides(next, at, ratio, mode, {
        workspaceId: activeWorkspaceId, accessToken, platform: idea.platform,
      })
      // Re-resolved through draftRef rather than reusing the `idea` captured
      // above: every slide in there was just re-rendered and uploaded, which
      // is seconds, and saveSlides writes the whole idea back. Saving the
      // stale copy would revert anything the poll changed while we waited.
      const live = draftRef.current?.ideas?.find(i => i.id === idea.id) || idea
      const after = await saveSlides(live, refitted, { clearStaleCaption: false })
      if (after.error) setError(`The other slides could not be saved: ${after.error}`)
    } finally {
      setRefitting(false)
    }
  }

  // Open (or reopen) Creative Studio for one idea. An idea with a session goes
  // straight to it; one without goes to ?ideaId=, where the Studio pre-fills
  // its composer and creates the session at the first generation. The Studio's
  // "Back to plan" returns to the pictures step.
  async function openStudio(idea) {
    if (isLocked(idea)) return
    const result = await openStudioForIdea(accessToken, idea)
    if (result.error) { setError(result.error); return }
    onIdeaChange({ ...idea, imageMode: 'studio', mediaStatus: idea.mediaStatus === 'ready' ? 'ready' : 'in_studio' })
    if (result.session) {
      navigate(`/studio?session=${result.session.id}`)
    } else {
      navigate(`/studio?ideaId=${idea.id}`)
    }
  }

  async function onIdeaRemove(idea) {
    if (isLocked(idea)) return
    update({ ideas: ideas.filter(i => i.id !== idea.id) })
    // isNew ideas never made it to the database — nothing to delete.
    if (idea.isNew) return
    // Logged BEFORE the delete: the event is the only remaining record of what
    // was thrown away.
    logIdeaEvent(activeWorkspaceId, accessToken, {
      planId, ideaId: idea.id, event: 'deleted', before: ideaSnapshot(idea),
    })
    await deleteIdea(accessToken, idea.id)
  }

  // Called once the "+ Add idea" editor's Save is clicked — the only point a
  // manually-added idea is written to the database.
  async function onIdeaCreate(tempIdea, patch) {
    const merged = { ...tempIdea, ...patch }
    const res = await insertIdeas(activeWorkspaceId, accessToken, planId, [{
      platform: merged.platform, date: merged.date, time: merged.time || DEFAULT_POST_TIME, title: merged.title || merged.topic || 'New idea',
      topic: merged.topic, angle: merged.angle, tone: merged.tone,
      suggestedStyle: merged.suggestedStyle, imageIdea: merged.imageIdea,
      objective: merged.objective, cta: merged.cta,
      hashtags: merged.hashtags, firstComment: merged.firstComment, series: merged.series,
      postFormat: merged.postFormat, aspectRatio: merged.aspectRatio, mediaType: merged.mediaType,
      wantsCaption: merged.wantsCaption,
      postKind: merged.postKind, slideCount: merged.slideCount,
      copyMode: merged.copyMode, captionEn: merged.captionEn, captionAr: merged.captionAr,
    }], ideas.length)
    if (res.error || !res.rows?.[0]) return { error: res.error || 'Could not save idea.' }
    let created = dbIdeaToDraft(res.rows[0])

    // A manually-typed idea only has a thin topic — ask AI to flesh it out
    // into a real brief before it is approved. Best-effort, and skipped when
    // the operator writes their own copy: their post is not sent to a model
    // they opted out of.
    const elongateUrl = created.copyMode === 'own' ? '' : state.webhooks?.elongateIdea
    if (elongateUrl) {
      const brandCtx = contextFor('plan')
      const elongated = await elongateIdea(elongateUrl, {
        instructions: brandCtx.instructions,
        brand_name: brandCtx.brand_name, brand_descriptor: brandCtx.brand_descriptor,
        idea: { platform: created.platform, topic: created.topic, tone: created.tone, date: created.date },
      })
      if (elongated.ok) {
        const dbPatch = {
          topic: elongated.topic || created.topic,
          angle: elongated.angle || '',
          tone: elongated.tone || created.tone,
          objective: elongated.objective || '',
          cta: elongated.cta || '',
          image_idea: elongated.image_idea || created.imageIdea || '',
          occasion: elongated.occasion || '',
          content_pillar: elongated.content_pillar || '',
          hashtags: elongated.hashtags || created.hashtags || '',
        }
        const patchRes = await updateIdea(accessToken, created.id, dbPatch)
        if (patchRes.ok && patchRes.idea) created = dbIdeaToDraft(patchRes.idea)
      }
    }

    update({ ideas: ideas.map(i => i.id === tempIdea.id ? created : i) })
    // Re-open the editor on the enriched idea so the brief can be adjusted.
    setAutoEditId(created.id)
    setTimeout(() => setAutoEditId(null), 400)
    return { ok: true, idea: created }
  }

  async function bulkStatus(status) {
    setBusy(true)
    // A post that has gone out keeps its approval — "Reset" must not pull it
    // back to undecided.
    const lockedIds = ideas.filter(isLocked).map(i => i.id)
    await setAllIdeaStatus(accessToken, planId, status, { exceptIds: lockedIds })
    // Same scoping as the DB write: "Reset" touches everything, Approve all /
    // Reject all only ideas still 'proposed'.
    const touches = i => !lockedIds.includes(i.id) && (status === 'proposed' || i.status === 'proposed')
    const affected = ideas.filter(i => !i.isNew && touches(i))
    update({ ideas: ideas.map(i => touches(i) ? { ...i, status } : i) })
    logIdeaEvents(activeWorkspaceId, accessToken, affected.map(i => ({
      planId, ideaId: i.id,
      event: status === 'rejected' ? 'rejected' : status === 'approved' ? 'approved' : 'edited',
      reason: status === 'proposed' ? 'reset to undecided' : 'bulk action',
      before: { status: i.status }, after: { status },
    })))
    setBusy(false)
  }

  // Add a blank, unsaved idea card and open its editor.
  function addIdea() {
    const p = platforms[0] || 'instagram'
    const fmt = defaultFormat(p)
    const draftIdea = {
      id: `new_${uid()}`, isNew: true, status: 'proposed',
      platform: p,
      date: '', time: DEFAULT_POST_TIME, title: '', topic: '', angle: '',
      postFormat: fmt, aspectRatio: defaultAspectRatio(p, fmt), mediaType: formatsFor(p).find(f => f.id === fmt)?.media || 'image',
      wantsCaption: true, slideCount: slideRange(p, fmt)?.default || 1,
      tone: 'professional',
    }
    setStatusFilter('all'); setSeasonalOnly(false)
    setAutoEditId(draftIdea.id)
    update({ ideas: [...ideas, draftIdea] })
    setTimeout(() => setAutoEditId(null), 400)
  }

  // ── Captions step: per-post writes ──────────────────────────────────────
  function patchLocal(idea, patch) { if (!isLocked(idea)) onIdeaChange({ ...idea, ...patch }) }
  async function saveIdeaFields(idea, dbPatch) {
    if (isLocked(idea)) return
    const res = await updateIdea(accessToken, idea.id, dbPatch)
    if (res.error) setError(`Couldn't save: ${res.error}`)
  }
  function pickCaption(idea, opt) {
    const patch = { captionAr: opt.caption_ar || '', captionEn: opt.caption_en || '' }
    patchLocal(idea, patch)
    saveIdeaFields(idea, { caption_ar: patch.captionAr, caption_en: patch.captionEn })
  }
  function clearCaptionChoice(idea) {
    patchLocal(idea, { captionAr: '', captionEn: '' })
    saveIdeaFields(idea, { caption_ar: '', caption_en: '' })
  }

  // Saving the plan turns approved ideas into real post rows — from what each
  // idea carries: its picture, its chosen (or own) caption, its date and time —
  // and then books each one at Zernio for that date and time. There is no
  // second approval: the captions step is where every post was checked.
  //
  // Posts that have already gone out are never written or re-booked. A post
  // already booked is re-booked only when this save changed what it publishes.
  // Nothing is chosen on anyone's behalf — the button stays disabled until
  // every post that needs a caption has one.
  async function finalizePlan() {
    const approved = ideas.filter(i => i.status === 'approved' && !isLocked(i))
    if (approved.length === 0) { setError(approvedIdeas.length ? 'Every approved post has already gone out.' : 'Approve at least one idea first.'); return }
    if (approved.some(i => !captionReady(i))) { setError('Pick a caption for every post, and finish every poll, first.'); return }
    setError(''); setBusy(true)

    await markIdeasProcessing(accessToken, planId, { copyMode: 'ai' })

    // Any post still without a date or time gets one now, the same way setup
    // places them, so nothing is left unscheduled by accident.
    // Never onto a day already gone; a date already set is left for the
    // queue to flag rather than moved behind anyone's back.
    const readyIdeas = distributeDates(approved, placement)
      .map(i => ({ ...i, time: i.time || DEFAULT_POST_TIME }))

    const res = await publishIdeasAsPosts(activeWorkspaceId, accessToken, planId, readyIdeas)
    if (res.error) {
      await markIdeasGenerated(accessToken, readyIdeas.map(i => i.id), { status: 'failed', error: res.error })
      setBusy(false); setError(`The posts couldn't be saved: ${res.error}`); return
    }
    const posts = res.posts || []
    const skipped = res.skipped || []

    // An idea whose post went out between loading and saving was marked
    // processing above like the rest; it is finished, not failed.
    const wroteRow = new Set([...posts.map(p => p.ideaId), ...skipped.map(p => p.ideaId)])
    await markIdeasGenerated(accessToken, [...wroteRow])
    const noRow = readyIdeas.filter(i => !wroteRow.has(i.id)).map(i => i.id)
    if (noRow.length) await markIdeasGenerated(accessToken, noRow, { status: 'failed', error: 'No post row was written for this idea.' })

    await updatePlan(accessToken, planId, { status: 'active' })

    // Book them. Read back fresh rather than trusted from the write, because
    // booking decides from publish state the write never touched.
    const rows = await fetchScheduledPosts(activeWorkspaceId, accessToken, { ids: posts.map(p => p.id).filter(Boolean) })
    const booking = await schedulePlanPosts({
      rows, accounts: connectedAccounts, workspaceId: activeWorkspaceId,
      changedIds: new Set(posts.filter(p => !p.wasScheduled || p.changed).map(p => p.id)),
    })

    // Video renders still run in the background, each polling for its own
    // cover image before firing — only for ideas whose video does not already
    // exist.
    triggerVideoRenders({
      webhooks: state.webhooks,
      videoIdeas: readyIdeas.filter(i => i.mediaType === 'video' && i.copyMode !== 'own' && !i.previewVideoUrl),
      accessToken,
    })

    setBusy(false)
    setPostsTick(t => t + 1)
    const ideaTitle = row => (ideas.find(i => i.id === row.plan_idea_id)?.title) || row.topic || 'Untitled post'
    update({
      step: 'done',
      manualResult: {
        count: posts.length,
        warnings: [...(res.errors || [])],
        booked: booking.booked.length + booking.kept.length,
        attention: booking.attention.map(a => ({ title: ideaTitle(a.row), platform: a.row.platform, reason: a.reason })),
        wentOut: skipped.length + booking.skipped.length,
      },
    })
  }

  const brandReady = state.brandProfile && !isBrandProfileEmpty(state.brandProfile)
  const proposedCount = ideas.filter(i => i.status === 'proposed').length
  const approvedCount = approvedIdeas.length
  const rejectedCount = ideas.filter(i => i.status === 'rejected').length
  const seasonalCount = ideas.filter(i => i.occasion).length
  const reviewedCount = approvedCount + rejectedCount

  // Content-mix breakdown across everything still in play.
  const pillarBreakdown = (() => {
    const counts = {}
    let unlabeled = 0
    for (const i of ideas) {
      if (i.status === 'rejected') continue
      const p = (i.pillar || '').trim()
      if (!p) { unlabeled++; continue }
      counts[p] = (counts[p] || 0) + 1
    }
    return { sorted: Object.entries(counts).sort((a, b) => b[1] - a[1]), unlabeled }
  })()

  const filteredIdeas = ideas.filter(i => {
    const want = statusFilter === 'undecided' ? 'proposed' : statusFilter
    if (statusFilter !== 'all' && i.status !== want) return false
    if (seasonalOnly && !i.occasion) return false
    if (dayFilter && i.date !== dayFilter) return false
    return true
  })
  const weekGroups = groupByWeek(filteredIdeas)
  const setupMoments = includeHolidays ? momentsInRange(startDate, endDate) : []
  const stepIndex = STEPS.findIndex(s => s.key === step)
  const brainSections = getBrandBrainSections(directory.schema).filter(s => s.value !== 'assets')
  const brainSummary = [
    ...brainSections.filter(s => brandBrainSections.includes(s.value)).map(s => s.label),
    ...(activeRuleCount ? [`${activeRuleCount} learned rule${activeRuleCount === 1 ? '' : 's'}`] : []),
  ]

  return (
    <div className="max-w-4xl space-y-4">
      <div className="border border-border border-l-2 border-l-amber-700 bg-white p-5">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 bg-amber-700 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36l-2.12 2.12M8.76 15.24l-2.12 2.12m12.72 0l-2.12-2.12M8.76 8.76L6.64 6.64"/></svg>
          </div>
          <div className="min-w-0">
            <p className="eyebrow text-text-tertiary mb-1.5">Monthly planning</p>
            <h1 className="text-lg font-bold text-text tracking-tight mb-2">Plan the month before it starts.</h1>
            <p className="text-xs text-text-secondary leading-relaxed max-w-xl">
              Add the posts you want — and let AI suggest more if you like. Approve the ideas, give each one
              a picture, then pick a caption written from that picture.
            </p>
          </div>
        </div>
      </div>

      {/* Step indicator — segments of one continuous bar. */}
      <div className="flex text-[10px] font-bold uppercase tracking-[0.08em]">
        {STEPS.map((s, i) => {
          const active = stepIndex === i
          const done = stepIndex > i
          return (
            <span key={s.key}
              className={`px-3 py-1.5 border -ml-px first:ml-0
                ${active ? 'bg-amber-700 text-white border-amber-700 relative z-10'
                  : done ? 'bg-sage-100 text-sage-800 border-sage-200'
                  : 'bg-white text-text-tertiary border-border'}`}>
              {done ? '✓ ' : ''}{s.label}
            </span>
          )
        })}
      </div>

      {!brandReady && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-700">
          <span className="font-medium">No Brand Brain profile set.</span> The plan works without it but will be generic.
          <button onClick={() => navigate('/brand-brain')} className="underline font-medium hover:text-amber-800 ml-1">Set it up first</button> for on-brand ideas.
        </div>
      )}

      {/* ── STEP: SETUP ── */}
      {step === 'setup' && (
        <Card className="p-6 space-y-5">
          <Select label="Which month? *" value={month} onChange={e => pickMonth(e.target.value)}>
            <option value="">Select month…</option>
            {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          {month && planFrom && planFrom !== startDate && planFrom <= endDate && (
            <p className="text-[11px] text-text-tertiary -mt-2">
              This month is already under way — posts are placed from {formatDate(planFrom)} onwards.
            </p>
          )}

          {/* Which platform a post is FOR is chosen per post now — a seed's
              own selector, an AI idea's own field, or the Pictures step's
              Edit/Add images popup — not once for the whole month. A month
              is never short a platform to plan for, so there is nothing to
              ask here any more. */}
          <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-100 px-3 py-2 -mt-2">
            LinkedIn posts are planned, pictured and captioned here like any other, and land in Approvals as drafts.
            Nothing in this app posts to the LinkedIn page.
          </p>

          {/* ── Cadence: shared by your posts and AI posts alike ── */}
          <div>
            <p className="text-xs font-medium text-text-secondary mb-2">Which days do you post? (optional)</p>
            <div className="flex gap-1.5">
              {WEEKDAYS.map(d => (
                <button key={d.value} onClick={() => toggleDay(d.value)} title={d.weekend ? 'Saudi weekend' : ''}
                  className={`w-9 h-9 rounded-xl border text-[11px] font-semibold transition-all ${postingDays.includes(d.value) ? 'bg-amber-700 text-white border-amber-700' : d.weekend ? 'bg-stone-50 border-border text-text-tertiary hover:border-amber-400' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-text-tertiary mt-1.5">
              Posts without a date are spread evenly across the month{postingDays.length ? ' on these days' : ''}.
              Each one's exact date and time can be changed on the captions step.
            </p>
          </div>

          <Toggle checked={includeHolidays} onChange={e => update({ includeHolidays: e.target.checked })}
            label="Flag Saudi seasonal & cultural moments in range (Ramadan, Eid al-Fitr, Eid al-Adha, Founding Day, National Day)" />

          {month && setupMoments.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap rounded-xl bg-amber-50/60 border border-amber-100 px-3.5 py-2.5">
              <span className="text-[11px] font-semibold text-amber-800">Falls in this month:</span>
              {setupMoments.map((m, i) => (
                <span key={i} className="text-[10px] font-semibold px-1.5 py-0.5 leading-[1.4] bg-amber-100 text-amber-800 border border-amber-200">★ {m.name}</span>
              ))}
              <span className="text-[11px] text-amber-700/80">— worth a post yourself, or let AI cover it below.</span>
            </div>
          )}
          {month && includeHolidays && setupMoments.length === 0 && (
            <p className="text-[11px] text-text-tertiary px-1">No major Saudi moments fall in this month.</p>
          )}

          <div className="h-px bg-border" />

          {/* ── PRIMARY: your own posts ── */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-text">Your posts</p>
              {seedPosts.some(s => s.text.trim()) && (
                <span className="text-[11px] text-text-tertiary">{seedPosts.filter(s => s.text.trim()).length} added</span>
              )}
            </div>
            <p className="text-[11px] text-text-tertiary mb-2.5">The posts you already know you want this month. Add as many as you like.</p>

            {seedPosts.length > 0 && (
              <div className="space-y-2.5 mb-2.5">
                {seedPosts.map((s, i) => (
                  // Only the idea itself. Platform, format, orientation, date
                  // and pictures are each decided on a later step, so asking
                  // for them here made the same choice in two places.
                  <div key={i} className="rounded-xl border border-border p-3 bg-white">
                    <textarea
                      className="w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:border-amber-400 resize-none"
                      rows={2}
                      placeholder="What is this post about? e.g. Announce the new Riyadh showroom opening"
                      value={s.text} onChange={e => updateSeed(i, { text: e.target.value })}
                    />
                    <div className="flex justify-end mt-1.5">
                      <button onClick={() => removeSeed(i)} className="text-[11px] px-2 py-1 text-text-tertiary hover:text-red-500" title="Remove">Remove</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <button onClick={addSeed}
              className="w-full text-center text-sm font-semibold text-amber-700 hover:text-amber-800 px-3 py-2.5 rounded-xl border-2 border-dashed border-amber-200 hover:border-amber-300 hover:bg-amber-50/50 transition-colors">
              + Add a post
            </button>
          </div>

          {/* ── SECONDARY: AI suggestions, off by default ── */}
          <div className="rounded-2xl border border-border bg-surface-subtle p-4 space-y-4">
            <Toggle checked={aiAssist} onChange={e => update({ aiAssist: e.target.checked })}
              label="Also let AI suggest more posts this month" />
            <p className="text-[11px] text-text-tertiary -mt-2.5">
              {aiAssist
                ? 'The AI plans around your posts, using your latest research, past posts and learned rules so it doesn\'t repeat itself.'
                : 'Leave off for a plan that is exactly the posts you added.'}
            </p>
            {aiAssist && !webhookUrl && (
              <p className="text-[11px] text-amber-700">The Campaign Planner webhook isn't configured — add it in Settings → Integrations.</p>
            )}

            {aiAssist && (
              <div className="space-y-4 pt-3 border-t border-border">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="Roughly how many AI posts? (optional)"
                    type="number" min="1" placeholder="Let AI decide"
                    value={approxCount} onChange={e => update({ approxCount: e.target.value })} />
                  <div className="space-y-2">
                    <Select
                      label="Focus category (optional)"
                      value={customCategory ? OTHER_GOAL : goalCategory}
                      onChange={e => {
                        if (e.target.value === OTHER_GOAL) { setCustomCategory(true); update({ goalCategory: '' }) }
                        else { setCustomCategory(false); update({ goalCategory: e.target.value }) }
                      }}>
                      <option value="">General</option>
                      {GOALS.map(g => <option key={g} value={g}>{g}</option>)}
                      <option value={OTHER_GOAL}>Other — write my own…</option>
                    </Select>
                    {customCategory && (
                      <Input
                        placeholder="Name this month's focus — e.g. 'Smart poles for municipalities'"
                        value={goalCategory} onChange={e => update({ goalCategory: e.target.value })}
                        autoFocus />
                    )}
                  </div>
                </div>

                <Textarea
                  label="Focus for the month (optional)"
                  placeholder="Leave blank for a well-rounded month, or steer it — e.g. 'Push our facade & landscape lighting for hospitality developers ahead of Q2 projects.'"
                  value={goal} onChange={e => update({ goal: e.target.value })} rows={3}
                />

                <Input
                  label="Target content mix (optional)"
                  placeholder="e.g. 40% product, 20% educational, 20% trust/testimonials, 20% engagement"
                  value={contentMixTarget} onChange={e => update({ contentMixTarget: e.target.value })}
                />

                {/* What the research agent proposed. Inside the AI block on
                    purpose: a ticked idea is an instruction to the planning
                    call, so it has nothing to steer when AI is off. */}
                <ResearchIdeaPicker
                  research={research}
                  selectedKeys={researchIdeaKeys}
                  onToggle={toggleResearchIdea}
                  usedKeys={usedResearchKeys}
                />
              </div>
            )}
          </div>

          {/* ── What the AI reads from the Brand Brain — hidden until asked.
              Applies to AI suggestions and to the captions written later. ── */}
          <div>
            <button onClick={() => setShowBrainPicker(v => !v)}
              className="text-[11px] font-medium text-text-tertiary hover:text-text transition-colors text-left">
              {showBrainPicker ? '▾' : '▸'} Change what the AI reads from your Brand Brain
              {!showBrainPicker && brainSummary.length > 0 && (
                <span className="text-text-disabled"> — now: {brainSummary.join(' · ')}</span>
              )}
            </button>
            {showBrainPicker && (
              <div className="mt-2.5 space-y-2.5 border border-border bg-surface-subtle/50 p-3">
                <div className="flex gap-2 flex-wrap">
                  {brainSections.map(s => {
                    const count = (directory.rowsBySection[s.value] || []).length
                    const active = brandBrainSections.includes(s.value)
                    return (
                      <button key={s.value} onClick={() => toggleSection(s.value)}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${active ? 'bg-amber-700 text-white border-amber-700' : 'bg-white border-border text-text-secondary hover:border-amber-400'}`}>
                        {s.label}{count > 0 && <span className={active ? 'opacity-75 ml-1' : 'text-text-tertiary ml-1'}>({count})</span>}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-text-tertiary">
                  {activeRuleCount > 0 ? `${activeRuleCount} learned rule${activeRuleCount === 1 ? ' is' : 's are'} always included. ` : ''}
                  Your saved Brand Brain is not changed.
                </p>
                <BrandContextPanel context={setupContext} task="plan" />
              </div>
            )}
          </div>

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" onClick={() => { clear(); navigate('/campaigns') }}>Cancel</Button>
            <Button onClick={handleGeneratePlan} disabled={loading}>
              {loading ? <><Spinner size="sm" /> Building the plan…</> : aiAssist ? 'Create plan with AI ideas' : 'Create plan'}
            </Button>
          </div>
        </Card>
      )}

      {/* ── STEP: REVIEW IDEAS ── */}
      {step === 'review' && (
        <div className="space-y-4">
          {/* ── A run that is still being written ──────────────────────────
              Says plainly that leaving is safe, because the thing this whole
              change fixes is people re-running a plan that was still coming.
              The old behaviour trained exactly that: the request timed out,
              the page showed an error, and generating again was the only
              move — which paid Opus twice for one month. */}
          {generatingPlanId && (
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <Spinner size="sm" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text">{generationNote || 'Writing the month…'}</p>
                  <p className="text-[11px] text-text-secondary leading-relaxed mt-1">
                    This takes a few minutes. It is running on the server, not in this tab — you can close the
                    page, switch tabs or go elsewhere in the app and the ideas will be here when you come back.
                    Don&apos;t start another plan for this month: the one running will still finish, and you would
                    be charged for both.
                  </p>
                </div>
              </div>
            </Card>
          )}

          <Card className="p-5 space-y-4">
            <Input label="Plan name" value={name} onChange={e => update({ name: e.target.value })} />

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Reviewed</span>
                <span className="text-[11px] font-bold text-text">{reviewedCount} / {ideas.length}{seasonalCount > 0 && <span className="text-amber-700 font-semibold ml-2">★ {seasonalCount} seasonal</span>}</span>
              </div>
              <div className="h-1.5 bg-stone-100 border border-border overflow-hidden flex">
                <div className="h-full bg-sage-400 transition-all duration-300" style={{ width: `${ideas.length ? (approvedCount / ideas.length) * 100 : 0}%` }} />
                <div className="h-full bg-red-300 transition-all duration-300" style={{ width: `${ideas.length ? (rejectedCount / ideas.length) * 100 : 0}%` }} />
              </div>
            </div>

            {(pillarBreakdown.sorted.length > 0 || contentMixTarget) && (
              <div className="bg-surface-subtle border border-border px-3 py-2.5">
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="font-semibold text-text-secondary">Mix:</span>
                  {pillarBreakdown.sorted.map(([pillar, n]) => (
                    <span key={pillar} className="px-1.5 py-0.5 leading-[1.4] border bg-white border-border text-text-secondary">
                      {n} {pillar}
                    </span>
                  ))}
                  {pillarBreakdown.unlabeled > 0 && (
                    <span className="px-1.5 py-0.5 leading-[1.4] border bg-white border-border text-text-tertiary">
                      {pillarBreakdown.unlabeled} unlabeled
                    </span>
                  )}
                </div>
                {contentMixTarget && (
                  <p className="text-[11px] text-text-tertiary mt-1.5"><span className="font-medium">Target:</span> {contentMixTarget}</p>
                )}
              </div>
            )}

            <div className="flex items-center gap-1.5 flex-wrap">
              {[['all', 'All', ideas.length], ['undecided', 'Undecided', proposedCount], ['approved', 'Approved', approvedCount], ['rejected', 'Rejected', rejectedCount]].map(([val, label, n]) => (
                <button key={val} onClick={() => setStatusFilter(val)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${statusFilter === val ? 'bg-amber-700 text-white border border-amber-700' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                  {label}{n > 0 && <span className={statusFilter === val ? 'opacity-75 ml-1' : 'text-text-tertiary ml-1'}>{n}</span>}
                </button>
              ))}
              {seasonalCount > 0 && (
                <button onClick={() => setSeasonalOnly(v => !v)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${seasonalOnly ? 'bg-amber-100 text-amber-800 border border-amber-300' : 'bg-white border border-border text-text-secondary hover:border-amber-300'}`}>
                  ★ Seasonal
                </button>
              )}
              {dayFilter && (
                <button onClick={() => setDayFilter(null)}
                  className="px-2.5 py-1 text-[11px] font-semibold bg-amber-700 text-white flex items-center gap-1">
                  {formatDate(dayFilter)} ✕
                </button>
              )}
              <div className="flex items-center rounded-lg border border-border overflow-hidden ml-auto">
                <button onClick={() => setViewMode('list')}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${viewMode === 'list' ? 'bg-amber-700 text-white' : 'bg-white text-text-secondary hover:bg-surface-subtle'}`}>
                  List
                </button>
                <button onClick={() => setViewMode('calendar')}
                  className={`px-2.5 py-1 text-[11px] font-semibold transition-colors ${viewMode === 'calendar' ? 'bg-amber-700 text-white' : 'bg-white text-text-secondary hover:bg-surface-subtle'}`}>
                  Calendar
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
              <span className="text-[11px] text-text-tertiary pt-2">Bulk:</span>
              <Button variant="secondary" size="xs" onClick={() => bulkStatus('approved')} disabled={busy}>Approve all</Button>
              <Button variant="secondary" size="xs" onClick={() => bulkStatus('rejected')} disabled={busy}>Reject all</Button>
              <Button variant="secondary" size="xs" onClick={() => bulkStatus('proposed')} disabled={busy}>Reset</Button>
              <Button variant="ghost" size="xs" onClick={() => setShowMoreModal(true)} disabled={busy} className="ml-auto">Suggest more with AI</Button>
              <Button variant="ghost" size="xs" onClick={addIdea} disabled={busy}>+ Add idea</Button>
            </div>
          </Card>

          {showMoreModal && (
            <GenerateMoreModal defaultCount={5} loading={moreLoading} error={moreError}
              onClose={() => { setShowMoreModal(false); setMoreError('') }} onGenerate={handleGenerateMore} />
          )}

          {viewMode === 'calendar' && ideas.length > 0 && (
            <CalendarView ideas={ideas} startDate={startDate} endDate={endDate} selectedDay={dayFilter} onDayClick={pickCalendarDay} />
          )}

          {viewMode === 'calendar' ? null : ideas.length === 0 ? (
            <Card className="p-6"><p className="text-xs text-text-tertiary text-center">No ideas left — add one, or suggest more with AI.</p></Card>
          ) : filteredIdeas.length === 0 ? (
            <Card className="p-6"><p className="text-xs text-text-tertiary text-center">No ideas match this filter.</p></Card>
          ) : (
            <div className="space-y-5">
              {weekGroups.map(group => (
                <div key={group.key} className="space-y-2.5">
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] font-bold text-stone-500 uppercase tracking-wide">{group.label}</span>
                    <span className="text-[10px] text-text-tertiary">{group.ideas.length} post{group.ideas.length !== 1 ? 's' : ''}</span>
                    <div className="h-px bg-border flex-1" />
                  </div>
                  {group.ideas.map(idea => (
                    <IdeaCard key={idea.id} idea={idea} index={ideas.indexOf(idea)} accessToken={accessToken} workspaceId={activeWorkspaceId}
                      todayKey={todayKey}
                      autoEdit={idea.id === autoEditId} lock={ideaLock(idea)}
                      onChange={onIdeaChange} onRemove={onIdeaRemove} onCreate={onIdeaCreate} />
                  ))}
                </div>
              ))}
            </div>
          )}

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="sticky bottom-0 -mx-1 px-1 pb-1">
            <div className="flex items-center gap-3 bg-white border border-border shadow-dropdown px-5 py-3.5">
              {/* A plan opened from the list never had its setup filled in this
                  session — "back" to a blank setup form would be unrelated to
                  this plan, so those go back to the list. */}
              <Button variant="secondary" onClick={() => openedFromPlanList ? navigate('/campaigns') : update({ step: 'setup' })}>Back</Button>
              <Button onClick={() => { setError(''); update({ step: afterReview }) }} disabled={approvedCount === 0}>
                {afterReview === 'media' ? 'Next — pictures' : 'Next — captions'} ({approvedCount} approved)
              </Button>
              <p className="text-xs text-text-tertiary flex-1">
                {approvedCount > 0 && afterReview === 'captions'
                  ? 'None of these posts takes a picture, so the next step is their words.'
                  : 'Next, give each approved idea a picture. Captions are written after, from the picture.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: PICTURES ──
          A worklist, not a progress bar: every card is either your own image
          or a door into the Studio, where a picture is worked on until it is
          right. Nothing here generates anything. */}
      {step === 'media' && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-baseline justify-between gap-4 mb-3">
              <div>
                <h2 className="text-base font-bold text-text tracking-tight">Give each post a picture</h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Use an image from your Brand Brain or upload your own — or make one in the Studio.
                </p>
              </div>
              <p className="text-sm font-semibold text-text flex-shrink-0">
                {mediaReadyCount} of {mediaIdeas.length} ready
              </p>
            </div>
            <div className="h-1.5 bg-surface-subtle overflow-hidden">
              <div className="h-full bg-sage-500 transition-all"
                style={{ width: `${mediaIdeas.length ? (mediaReadyCount / mediaIdeas.length) * 100 : 0}%` }} />
            </div>
            {mediaIdeas.length < approvedIdeas.length && (
              <p className="text-[11px] text-text-tertiary mt-2">
                {approvedIdeas.length - mediaIdeas.length} text post{approvedIdeas.length - mediaIdeas.length === 1 ? '' : 's'} or poll{approvedIdeas.length - mediaIdeas.length === 1 ? '' : 's'} need no picture — {approvedIdeas.length - mediaIdeas.length === 1 ? 'it goes' : 'they go'} straight to captions.
              </p>
            )}
          </Card>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {mediaIdeas.map(idea => {
              const ownMedia = hasOwnMedia(idea)
              const lock = ideaLock(idea)
              const st = lock ? 'sent' : hasMedia(idea) ? 'ready' : (idea.mediaStatus || 'none')
              const thumb = thumbFor(idea)
              const urls = mediaUrlsFor(idea)
              // The records those urls came from, so the strip can be told
              // which of them is the video without re-deriving the list once
              // per thumbnail.
              const slides = slidesFor(idea)
              const refCount = (idea.references || []).length
              const canOpen = urls.length > 0 || !!idea.previewVideoUrl
              return (
                <Card key={idea.id} className={`p-3 flex flex-col gap-2.5 ${st === 'ready' || st === 'sent' ? 'border-sage-200 bg-sage-50/30' : ''}`}>
                  <div className="flex items-start gap-3">
                    {thumb ? (
                      <button type="button" onClick={() => openMedia(idea)} disabled={!canOpen} title="Open the picture"
                        className="relative w-20 h-20 border border-border hover:border-amber-400 overflow-hidden flex-shrink-0">
                        <PostImage src={thumb} alt="" className="w-full h-full object-cover" />
                        {urls.length > 1 && (
                          <span className="absolute top-1 right-1 text-[9px] font-bold bg-black/65 text-white px-1.5 leading-[1.6]">{urls.length}</span>
                        )}
                      </button>
                    ) : (
                      <div className="w-20 h-20 border border-dashed border-border bg-surface-subtle flex items-center justify-center flex-shrink-0 text-text-disabled text-xl">
                        {idea.mediaType === 'video' ? '▶' : '▢'}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-text leading-snug line-clamp-2">{idea.title || idea.topic || 'Untitled idea'}</p>
                      {/* The topic, which is what the picture actually has to
                          be OF. The card showed a title and a format and left
                          you to remember the rest — so choosing a picture
                          meant going back a step to read the idea again. */}
                      {idea.topic && idea.topic !== idea.title && (
                        <p className="text-[11px] text-text-secondary mt-0.5 leading-relaxed line-clamp-2">{idea.topic}</p>
                      )}
                      <p className="text-[11px] text-text-secondary mt-1">
                        {idea.date ? formatDate(idea.date) : 'Date set on save'}
                        {' · '}{formatTime(idea.time || DEFAULT_POST_TIME)}
                      </p>
                      <p className="text-[10px] text-text-tertiary mt-0.5">
                        {formatsFor(idea.platform).find(f => f.id === idea.postFormat)?.label || 'Feed image'} · {aspectLabel(idea.aspectRatio)}
                        {' · '}{(idea.platforms?.length ? idea.platforms : [idea.platform]).map(targetLabel).join(' + ')}
                      </p>
                      {/* The same chips the review step judges an idea by. A
                          picture for a National Day post is a different brief
                          from a picture for a product post, and this step used
                          to hide that distinction entirely. */}
                      {(idea.occasion || idea.pillar || idea.objective || idea.source === 'research') && (
                        <div className="flex items-center gap-1 flex-wrap mt-1.5">
                          {idea.source === 'research' && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 leading-[1.4] border bg-sage-50 text-sage-700 border-sage-200"
                              title="Built from an idea the research agent proposed">◆ Research</span>
                          )}
                          {idea.occasion && <span className="text-[9px] font-semibold px-1.5 py-0.5 leading-[1.4] border bg-amber-100 text-amber-800 border-amber-200">★ {idea.occasion}</span>}
                          {idea.pillar && <span className="text-[9px] font-medium px-1.5 py-0.5 leading-[1.4] border bg-stone-100 text-text-secondary border-border">{idea.pillar}</span>}
                          {idea.objective && <span className="text-[9px] font-medium px-1.5 py-0.5 leading-[1.4] border bg-sky-50 text-sky-700 border-sky-100">{idea.objective}</span>}
                        </div>
                      )}
                      <span className={`inline-block mt-1.5 text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] ${
                        st === 'ready' || st === 'sent' ? 'bg-sage-100 text-sage-700'
                        : st === 'in_studio' ? 'bg-clay-50 text-clay-700'
                        : 'bg-stone-100 text-text-tertiary'}`}>
                        {lock ? (lock.state === 'publishing' ? '↗ Publishing' : '✓ Published') : ownMedia ? `✓ Your image${refCount > 1 ? `s (${refCount})` : ''}` : st === 'ready' ? '✓ Made in Studio' : st === 'in_studio' ? '🎬 In Studio' : 'Needs a picture'}
                      </span>
                    </div>
                  </div>
                  {/* Every slide, in the order it goes out. Reordering is for
                      your own images — a Studio picture is one image.
                      Adjusting is NOT limited that way: a Studio render can be
                      the wrong shape for the platform just as easily as an
                      upload, and it is the shape Instagram refuses. */}
                  {urls.length > 1 && (
                    <div>
                      <p className="text-[10px] text-text-tertiary mb-1">
                        {lock ? 'Slides, as they went out' : ownMedia ? 'Slide order — drag or use ‹ › to move' : 'Slides'}
                      </p>
                      <SlideStrip urls={urls} onOpen={i => openMedia(idea, i)}
                        onReorder={!lock && ownMedia ? next => reorderSlides(idea, next) : undefined}
                        onAdjust={!lock ? i => setAdjusting({ ideaId: idea.id, index: i }) : undefined}
                        canAdjust={i => slides[i]?.type === 'image'} />
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-auto pt-1 flex-wrap">
                    {lock ? (
                      <>
                        {canOpen && <Button size="xs" variant="secondary" onClick={() => openMedia(idea)}>View</Button>}
                        {lock.url && <a href={lock.url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-amber-700 hover:underline">View post ↗</a>}
                        <span className="text-[10px] text-text-tertiary">Gone out — can’t be changed.</span>
                      </>
                    ) : (
                      // One door in: the same modal the review step opens now
                      // also picks the picture (Brand Brain or upload),
                      // launches the Studio, and asks who writes the caption
                      // — three buttons that each opened a different editor
                      // for the same idea, down to the one that actually
                      // matters here.
                      <Button size="xs" variant={st === 'ready' ? 'secondary' : 'primary'} onClick={() => setEditIdea(idea)}>
                        Edit/Add images
                      </Button>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          {editIdea && (
            <PostComposer
              open variant="idea"
              platform={editIdea.platform || 'instagram'}
              accounts={connectedAccounts} accountsLoading={accountsLoading}
              initial={composerFromIdea(editIdea)}
              busy={editSaving} saveError={editError}
              onClose={() => { setEditIdea(null); setEditError('') }}
              onSaveIdea={saveIdeaFromComposer}
              onDesignInStudio={() => { const idea = editIdea; setEditIdea(null); openStudio(idea) }}
            />
          )}

          <div className="sticky bottom-0 -mx-1 px-1 pb-1">
            <div className="flex items-center gap-3 bg-white border border-border shadow-dropdown px-5 py-3.5">
              <Button variant="secondary" onClick={() => update({ step: 'review' })}>Back to ideas</Button>
              <Button onClick={() => { setError(''); update({ step: 'captions' }) }} disabled={approvedCount === 0}>
                Next — captions
              </Button>
              {/* A soft gate: there are real reasons to move on with a picture
                  still outstanding. */}
              <p className="text-xs text-text-tertiary flex-1">
                {mediaReadyCount < mediaIdeas.length
                  ? `${mediaIdeas.length - mediaReadyCount} still without a picture — their captions will be written from the idea alone.`
                  : 'Every post has its picture. Captions are written from them next.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: CAPTIONS ── */}
      {step === 'captions' && (
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-text tracking-tight">Pick a caption for each post</h2>
                <p className="text-xs text-text-secondary mt-0.5">
                  Three options written from each picture and its idea. Choose one, edit it if you like,
                  and check the date and time — this is the last check before the posts are scheduled.
                </p>
              </div>
              <p className="text-sm font-semibold text-text flex-shrink-0">
                {approvedIdeas.length - captionsMissing.length} of {approvedIdeas.length} ready
              </p>
            </div>
          </Card>

          <div className="space-y-3">
            {approvedIdeas.map(idea => (
              <CaptionCard key={idea.id} idea={idea} thumbUrl={thumbFor(idea)} language={captionLanguage}
                mediaUrls={mediaUrlsFor(idea)} onOpenMedia={i => openMedia(idea, i)} lock={ideaLock(idea)}
                dateMin={dateMin} dateMax={endDate} todayKey={todayKey} redrafting={redraftingId === idea.id}
                onPick={opt => pickCaption(idea, opt)}
                onEdit={patch => patchLocal(idea, patch)}
                onSaveField={(field, value) => saveIdeaFields(idea, { [field]: value })}
                onClearChoice={() => clearCaptionChoice(idea)}
                onRedraft={() => redraftCaptions(idea)}
                onDate={date => { patchLocal(idea, { date }); saveIdeaFields(idea, { scheduled_date: date || null }) }}
                onTime={time => { patchLocal(idea, { time }); saveIdeaFields(idea, { publish_time: time || '' }) }}
                onPollEdit={poll => patchLocal(idea, { platformOptions: { ...(idea.platformOptions || {}), poll } })}
                onPollSave={poll => saveIdeaFields(idea, { platform_options: { ...(idea.platformOptions || {}), poll } })}
              />
            ))}
          </div>

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="sticky bottom-0 -mx-1 px-1 pb-1">
            <div className="flex items-center gap-3 bg-white border border-border shadow-dropdown px-5 py-3.5">
              <Button variant="secondary" onClick={() => update({ step: afterReview === 'media' ? 'media' : 'review' })}>
                {afterReview === 'media' ? 'Back to pictures' : 'Back to ideas'}
              </Button>
              <Button onClick={finalizePlan} disabled={busy || accountsLoading || toSchedule.length === 0 || captionsMissing.length > 0}>
                {busy ? <><Spinner size="sm" /> Scheduling your posts…</>
                  : toSchedule.length === 0 ? 'Everything has gone out'
                  : `Schedule ${toSchedule.length} post${toSchedule.length === 1 ? '' : 's'}`}
              </Button>
              <p className="text-xs text-text-tertiary flex-1">
                {captionsMissing.length > 0
                  ? captionsDrafting
                    ? 'Writing captions…'
                    : captionsMissing.some(i => hasCaption(i) || i.wantsCaption === false)
                      ? `Finish ${captionsMissing.length} more post${captionsMissing.length === 1 ? '' : 's'} — a caption, or a poll's question and answers.`
                      : `Pick a caption for ${captionsMissing.length} more post${captionsMissing.length === 1 ? '' : 's'}.`
                  : 'Each post is booked for its date and time (KSA). Anything that can’t be booked waits in the Post Queue.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: DONE ── */}
      {step === 'done' && (
        <Card className="p-8 space-y-4">
          <div className="text-center space-y-3">
            <div className="w-12 h-12 border border-sage-200 bg-sage-100 flex items-center justify-center mx-auto">
              <svg className="w-7 h-7 text-sage-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <h2 className="text-lg font-bold text-text tracking-tight">
              {manualResult?.booked > 0 ? 'Plan saved — your posts are scheduled.' : 'Plan saved.'}
            </h2>
            <p className="text-sm text-text-secondary max-w-md mx-auto">
              <span className="font-semibold text-text">{name}</span>
              {manualResult?.booked > 0 && <>: <span className="font-semibold text-text">{manualResult.booked} post{manualResult.booked === 1 ? '' : 's'}</span> booked for {manualResult.booked === 1 ? 'its' : 'their'} date and time</>}
              {manualResult?.wentOut > 0 && <>, {manualResult.wentOut} already gone out and left as {manualResult.wentOut === 1 ? 'it was' : 'they were'}</>}
              . Reschedule, edit or cancel any of them from the Post Queue.
            </p>
          </div>
          {manualResult?.attention?.length > 0 && (
            <div className="border border-amber-200 bg-amber-50/60 p-4 max-w-xl mx-auto">
              <p className="text-xs font-semibold text-amber-800 mb-2">
                {manualResult.attention.length} post{manualResult.attention.length === 1 ? '' : 's'} not scheduled — {manualResult.attention.length === 1 ? 'it waits' : 'they wait'} in the Post Queue under “Needs attention”:
              </p>
              <ul className="space-y-1">
                {manualResult.attention.map((a, i) => (
                  <li key={i} className="text-[11px] text-text-secondary leading-relaxed">
                    <span className="font-semibold text-text">{a.title}</span> <span className="text-text-tertiary">({targetLabel(a.platform)})</span> — {a.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {manualResult?.warnings?.length > 0 && (
            <p className="text-xs text-red-600 max-w-md mx-auto text-center">
              Needs a look: {manualResult.warnings.join(' · ')}
            </p>
          )}
          <div className="flex items-center justify-center gap-3 pt-2 flex-wrap">
            <Button onClick={() => navigate('/social/approvals')}>Open Post Queue</Button>
            <Button variant="secondary" onClick={() => navigate('/campaigns')}>View all plans</Button>
            <Button variant="secondary" onClick={() => { clear(); navigate('/campaigns/plan') }}>Plan another month</Button>
          </div>
        </Card>
      )}

      {viewer && <MediaViewer {...viewer} onClose={() => setViewer(null)} />}

      {/* Cropping one slide of a carousel, opened from the strip on its card.
          The same dialog the composer opens, deliberately — a second cropper
          would be a second set of aspect ratios to keep in step with what each
          platform actually accepts. */}
      <ImageFitter
        open={!!adjustingSlide}
        onClose={() => setAdjusting(null)}
        media={adjustingSlide}
        platform={adjustingIdea?.platform || 'instagram'}
        format={adjustingIdea?.postFormat || 'feed_image'}
        index={adjusting?.index ?? null}
        total={adjustingSlides.length}
        onApply={applyAdjustedSlide} />

      {/* The other slides are re-rendered and re-uploaded one at a time after
          the dialog closes, which is seconds of work with nothing on screen to
          show for it. Saying so beats a strip that changes on its own. */}
      {refitting && (
        <div className="fixed bottom-4 right-4 z-[60] bg-white border border-border shadow-lg px-4 py-3 flex items-center gap-2.5">
          <Spinner size="sm" />
          <span className="text-xs text-text-secondary">Matching the other slides to that shape…</span>
        </div>
      )}
    </div>
  )
}
