// ─── Research idea → planner idea ──────────────────────────────────────────
// The missing arc. RESEARCH-AGENT.md §8c calls it "the part that makes it feel
// like an employee rather than a dashboard", and it was the one hop of the
// loop nobody built:
//
//   research → IDEA → post → analytics → insights → rule → research
//
// Every other piece of that circle exists. Without this one, an idea the agent
// proposed was a sentence on a page that a person had to read, understand and
// retype into the planner — so in practice nobody did, and the run's most
// actionable output evaporated every week.
//
// ── WHAT THIS DELIBERATELY IS NOT ──
//
// It is not an approval. A promoted idea lands as `status = 'proposed'`, which
// is exactly where the planner's own generated ideas land, and it faces the
// same approve/reject the planner already has. The agent gets a seat at the
// table, not a vote.
//
// `plan_id` is required by the table and that is not worked around. An idea
// must belong to a plan, so promoting one means choosing which month it is
// for — a decision only a person can make, and the reason this is a button
// rather than something the run does by itself.

/** Where a promoted idea says it came from. `plan_ideas.source`, no check constraint. */
export const RESEARCH_SOURCE = 'research'

const clean = v => String(v ?? '').trim()

/**
 * Has this idea already been sent to this plan?
 *
 * Matched on the title, normalised. Not an id, because a research idea has no
 * id — it lives inside the run's report JSON, not in a table of its own.
 *
 * The alternative was marking the report as "sent", which fails the moment two
 * people have the page open: both read an unsent report, both click, and the
 * plan gets the idea twice. Checking the destination is the only place the
 * answer is actually true.
 */
export function alreadySent(idea, existingIdeas = []) {
  const key = clean(idea?.title).toLowerCase()
  if (!key) return false
  return (existingIdeas || []).some(e =>
    clean(e?.title).toLowerCase() === key || clean(e?.topic).toLowerCase() === key)
}

/**
 * One research idea, in the shape plan_ideas wants.
 *
 * Only the fields the research half actually knows are set. Everything the
 * planner fills in later — format, aspect ratio, image mode, captions — is
 * left at the table's own defaults rather than guessed here, because a guessed
 * default looks identical to a chosen one on the planner screen and someone
 * will ship it.
 *
 * `rationale` carries the finding across, which is the whole point of the
 * traceability: three months from now, when this post's analytics come back,
 * the reason it existed is still attached to it.
 */
export function researchIdeaToPlanIdea(idea, { workspaceId, planId, position = 0, platform = 'instagram' } = {}) {
  const title = clean(idea?.title) || clean(idea?.angle)
  return {
    workspace_id: workspaceId,
    plan_id: planId,
    platform,
    title,
    topic: title,
    angle: clean(idea?.angle),
    rationale: clean(idea?.rationale),
    // AI telemetry only — the planner's own `format` field is what generation
    // reads, and it stays empty so a person chooses it.
    suggested_format: clean(idea?.suggested_format),
    // The same status the planner's own ideas arrive in. Not 'approved'.
    status: 'proposed',
    source: RESEARCH_SOURCE,
    position,
  }
}

/**
 * Everything worth sending, positioned after what the plan already holds.
 *
 * Returns the rows AND what it skipped, because "nothing happened" and
 * "everything was already there" look the same to someone who just clicked a
 * button, and only one of them is a problem.
 */
export function promotable(ideas, existingIdeas, { workspaceId, planId, platform = 'instagram' } = {}) {
  const start = (existingIdeas || []).reduce(
    (max, e) => Math.max(max, Number(e?.position) || 0), -1) + 1

  const rows = []
  const skipped = []
  let i = 0
  for (const idea of ideas || []) {
    if (!clean(idea?.title) && !clean(idea?.angle)) continue
    if (alreadySent(idea, existingIdeas)) { skipped.push(clean(idea?.title)); continue }
    rows.push(researchIdeaToPlanIdea(idea, {
      workspaceId, planId, platform, position: start + i,
    }))
    i += 1
  }
  return { rows, skipped }
}

/** The sentence to show after sending, which has to distinguish three outcomes. */
export function promotionNote({ sent = 0, skipped = 0, planName = '' } = {}) {
  const where = planName ? ` to ${planName}` : ''
  if (sent && skipped) return `Sent ${sent}${where}. ${skipped} was already there.`
  if (sent) return `Sent ${sent} idea${sent === 1 ? '' : 's'}${where}. Approve them in the planner.`
  if (skipped) return `Already in that plan — nothing new to send.`
  return 'Nothing to send.'
}
