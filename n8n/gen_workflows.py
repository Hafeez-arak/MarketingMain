"""
gen_workflows.py — programmatic builder for ARAK's n8n content-generation workflows.

This REPLACES a throwaway scratchpad script (gen_workflows.py) that generated the
currently-live "v2" workflows and was permanently lost — only its JSON output
survived. This version lives in the actual git repo so that never happens again.

Builds 4 workflows as n8n-importable JSON:
  - Arak Lighting – Instagram Content Generation v2   (webhook: arak-ig-plan-generation)
  - Arak Lighting – Caption Studio                     (webhook: arak-caption-studio)
  - Arak Lighting – Elongate Idea                       (webhook: arak-elongate-idea)

Zero secrets: every credential is read from n8n environment variables
(ANTHROPIC_API_KEY, REPLICATE_API_TOKEN, SUPABASE_URL, SUPABASE_KEY, optional
IMAGE_PROVIDER / FAL_KEY) via $env.* inside the generated Code/HTTP nodes —
never hardcoded here.

Usage:
    python3 gen_workflows.py

Writes output to ./workflows/<Workflow Name>.json (relative to this file).
After editing this script, re-run it and re-import the changed JSON file(s)
into n8n — never hand-edit the generated JSON.
"""
import json
import os
import uuid

# Fixed namespace for deriving stable node ids (see _assign_deterministic_ids).
_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://arak-sa.com/n8n/workflows")


def nid() -> str:
    """Placeholder node id, overwritten by _assign_deterministic_ids() before
    the workflow is written out. n8n only needs these to be unique within a
    workflow; a random placeholder here is fine since it never reaches disk."""
    return str(uuid.uuid4())


def _assign_deterministic_ids(wf: dict) -> None:
    """Replace every node's placeholder id with one derived from
    (workflow name, node name, occurrence index) so re-running the generator
    doesn't touch ids that didn't actually change, keeping `git diff` limited
    to real edits instead of full-file UUID churn. Connections reference
    nodes by name, not id, so this is safe."""
    seen: dict[str, int] = {}
    for node in wf["nodes"]:
        name = node.get("name", "")
        occurrence = seen.get(name, 0)
        seen[name] = occurrence + 1
        seed = f"{wf['name']}::{name}::{occurrence}"
        node["id"] = str(uuid.uuid5(_ID_NAMESPACE, seed))

    # The WORKFLOW's own id, derived the same way, and it fixes a real problem:
    # `n8n import:workflow` keys on this field, so a file without one made the
    # importer mint a fresh id every time and create a whole SECOND workflow
    # with the same name rather than updating the first — both published, both
    # listening on the same webhook path, with no defined winner. (That had
    # already happened to Creative Video, twice over, by 2026-08-11.) With a
    # stable id, re-importing updates in place, which is what the README's
    # wipe-and-reimport dance existed to work around.
    #
    # n8n ids are 16 characters from [A-Za-z0-9]; uuid5 over the name gives a
    # deterministic 128 bits to cut that out of.
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    n = uuid.uuid5(_ID_NAMESPACE, f"workflow::{wf['name']}").int
    chars = []
    for _ in range(16):
        n, rem = divmod(n, len(alphabet))
        chars.append(alphabet[rem])
    wf["id"] = "".join(chars)


# ============================================================
# Shared prompt scaffolding — brand identity and precedence
# ============================================================
# Every prompt in this file used to OPEN by asserting the writer worked for
# "Arak Lighting, Saudi Arabia's leading architectural lighting company",
# hardcoded in 52 places — and crucially placed ABOVE the BRAND CONTEXT
# block. So Aqeeq (an at-home spa) and Alo Kheyatah (a tailoring service)
# were told they manufactured lighting, and then handed their own brand brain
# underneath to argue with. Identity is now data, interpolated from the
# payload, like every other fact about the brand.
#
# These are JS *fragments* embedded into Code nodes, and plain strings
# embedded into the jsonBody of HTTP nodes. Keep them dependency-free.

# Derives the persona clause from whatever payload shape the workflow has.
# The fallback deliberately does NOT name an industry: a workflow that has
# lost its brand identity should defer to the BRAND CONTEXT block rather
# than invent a company, which is exactly the bug this replaces.
BRAND_PERSONA_JS = r"""
function brandPersona(src){
  const name = String((src && src.brand_name) || '').trim();
  const desc = String((src && src.brand_descriptor) || '').trim();
  if (!name) return 'the brand described in the BRAND CONTEXT below';
  return desc ? (name + ', ' + desc) : name;
}
function brandOnly(src){
  const name = String((src && src.brand_name) || '').trim();
  return name || 'this brand';
}
// Used wherever a prompt previously hardcoded '#ArakLighting'. Derives a
// tag from the brand's own name rather than naming a company that may not
// be the one posting.
function brandTag(src){
  const name = String((src && src.brand_name) || '').trim();
  // Strip an Arabic wordmark in brackets — "Aqeeq (عقيق)" tags as #Aqeeq.
  const latin = name.replace(/\([^)]*\)/g, '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (!latin) return '';
  return '#' + latin.split(/\s+/).map(w => w[0].toUpperCase() + w.slice(1)).join('');
}
"""

# The determinism fix. Without this, "make it blue" against a brand palette
# of warm bronze resolved differently run to run, because nothing in the
# prompt said which one outranked the other. The file already set this
# precedent for reference-image notes ("their own note wins ... because it is
# a specific instruction rather than a default") — this applies the same
# reasoning to the brand block.
PRECEDENCE_RULES = (
    "PRECEDENCE — when the request and the brand context disagree, resolve in this order:\n"
    "1. Brand guardrails always win. Anything the brand context lists as a never-do, "
    "a compliance rule, or a hard restriction is absolute — no request overrides it.\n"
    "2. The requester's explicit instruction beats a brand DEFAULT. If they asked for a "
    "specific colour, format, angle or tone, do that, even where the brand's usual "
    "default differs. A stated ask is a decision, not an oversight.\n"
    "3. Brand defaults fill in everything left unspecified — palette, tone, style, structure.\n"
    "When you override a brand default under rule 2, say so in one short clause in "
    "post_strategy (or the nearest explanatory field) so the choice is explainable."
)

# Blank contact_info is the normal state for a brand that has not supplied
# one yet, and an unguarded model will happily invent a booking link or phone
# number that then publishes. Facts about how to reach a business must come
# from the brand brain or not at all.
NO_INVENTED_FACTS = (
    "NEVER state a phone number, booking link, website, address, account handle, price, "
    "discount or promotional offer unless it appears verbatim in the BRAND CONTEXT. If "
    "none is given, end with a soft call to action (\"book your session\", \"send us a "
    "message\") and no specifics. Inventing a contact detail or a price is a serious error."
)

# One string, since almost every prompt wants both.
PROMPT_RULES = PRECEDENCE_RULES + "\n\n" + NO_INVENTED_FACTS


def js_str(text: str) -> str:
    """Embed a Python string as a JS template-literal-safe literal."""
    return json.dumps(text)


def _with_brand(js: str) -> str:
    """Give a Code-node body the brand helpers and the shared rule text.

    Every prompt builder needs the same two things — a persona derived from
    the payload instead of a hardcoded company, and the precedence /
    no-invented-facts rules — so they are spliced in from one place rather
    than pasted into each builder and left to drift apart.

    The placeholder is always written as `${__PROMPT_RULES__}` inside a
    template literal, so it is replaced with a bare JSON string literal —
    the surrounding `${ }` is already there. Emitting it as a JSON literal
    rather than raw text means the rules cannot terminate the template or be
    re-parsed as JS, whatever punctuation they contain.
    """
    return (
        BRAND_PERSONA_JS + "\n" + js
    ).replace('__PROMPT_RULES__', js_str(PROMPT_RULES))


# ============================================================
# Code-node JavaScript bodies (Instagram Content Generation v2)
# ============================================================


# Differs from Instagram only in the default aspect_ratio fallback
# ('1:1' for IG vs '1.91:1' for LI) — substituted via __ASPECT_DEFAULT__.


# Differs from Instagram only in the PLATFORM / BUCKET consts at the top —
# every other line (captions, image generation, upload prep, DB row shape)
# branches on the PLATFORM variable already, so substituting these two lines
# is the entire difference between the two workflows' core engine.






# ============================================================
# Sticky-note content
# ============================================================



CAPTION_STUDIO_STICKY = r"""## Arak – Caption Studio

**Zero secrets in this file.** Only needs `ANTHROPIC_API_KEY`.

On-demand caption rewriting from the Post Approvals / post-detail review screen — NOT part of the base generation pipeline (that still writes one caption per post). Fires only when the reviewer asks for alternatives, so we never 3x token cost on posts nobody edits.

**mode=variants** → 3 platform-aware alternatives (IG: caption+hashtags; LI: hook+body+hashtags).
**mode=piece** → regenerate ONE piece (caption/hook/body/hashtags), keeping the rest.

Controls: length, hook style, emoji density, hashtag count. Bilingual (Saudi Arabic + English) per the post's language setting."""

ELONGATE_IDEA_STICKY = r"""## Arak – Elongate Idea

**Zero secrets in this file.** Only needs `ANTHROPIC_API_KEY`.

Synchronous: one Sonnet 5 call, no image generation, no Supabase writes (the browser already holds the user's own access token and applies the DB patch itself via updateIdea() — same as any other manual edit).

Turns a manually-typed idea's thin topic/tone into a full brief (angle, objective, cta, design direction) before the user approves it — triggered automatically the moment a manual idea is saved (CampaignPlanner.jsx → onIdeaCreate)."""

# ============================================================
# Code-node JavaScript bodies (Caption Studio / Elongate Idea)
# ============================================================

CAPTION_STUDIO_JS = _with_brand(r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};
const ANTHROPIC = $env.ANTHROPIC_API_KEY;

// Surface the REAL upstream error (billing/rate-limit/bad-key) instead of
// n8n's generic "Request failed with status code 4xx".
async function req(opts){
  try { return await http(opts); }
  catch (e) {
    const detail = (e && (e.error || (e.response && e.response.data) || e.description)) || null;
    const real = detail
      ? (typeof detail === 'string' ? detail
        : Buffer.isBuffer(detail) ? detail.toString('utf8', 0, 300)
        : (detail.error && detail.error.message) || JSON.stringify(detail).slice(0, 400))
      : (e && e.message) || String(e);
    throw new Error(real);
  }
}

function safeJson(t){
  const c = String(t||'').replace(/```json|```/g,'').trim();
  try { return JSON.parse(c); } catch(e){
    const m = c.match(/\{[\s\S]*\}/);
    if(m){ try { return JSON.parse(m[0]); } catch(_){} }
    return {};
  }
}

const body     = ($input.first().json.body) || {};
const mode     = body.mode === 'piece' ? 'piece' : 'variants';
const platform = 'instagram';
const lang     = body.language || 'both';         // ar | en | both
const ctx      = body.context || {};              // topic, angle, tone, objective, cta, instructions
const controls = body.controls || {};             // length, hookStyle, emoji, hashtagCount
const current  = body.current || {};              // caption / hook / body / hashtags (reviewer's current draft)
const piece    = ['caption','hook','body','hashtags'].includes(body.piece) ? body.piece : 'caption';

// ── controls → plain-language instructions ──
const lengthRule = { short: 'Keep it SHORT — 1-2 punchy lines.', long: 'Make it LONGER and richer — several sentences with detail.' }[controls.length] || 'Medium length — a few tight sentences.';
const hookRule = {
  question: 'Open with a QUESTION hook.',
  bold_statement: 'Open with a BOLD, scroll-stopping statement.',
  stat: 'Open with a surprising STAT or number.',
  story: 'Open with a short STORY or scene-setting line.',
}[controls.hookStyle] || 'Open however lands best for this post.';
const emojiRule = { none: 'Use NO emojis.', rich: 'Use emojis fairly RICHLY (but still tasteful).' }[controls.emoji] || 'Use a LIGHT sprinkle of emojis.';
const hashtagRule = { none: 'Return an EMPTY hashtags string.', few: 'Return 3-5 hashtags.', many: 'Return 8-12 hashtags.' }[controls.hashtagCount] || 'Return 6-8 hashtags.';

const langRule = lang === 'ar'
  ? 'Write in SAUDI ARABIC (Gulf/Najdi dialect — natural, modern, warm; NOT stiff MSA). Fill the *_ar fields; set *_en fields to "".'
  : lang === 'en'
  ? 'Write in ENGLISH. Fill the *_en fields; set *_ar fields to "".'
  : 'Write BOTH a SAUDI ARABIC version (Gulf/Najdi dialect, not stiff MSA) in the *_ar fields AND an ENGLISH version in the *_en fields — matched in meaning, not word-for-word.';

// CACHED prefix (persona + brand + language rule) is identical across every
// call in an editing session, so the 2nd+ rewrite of the same post reads it
// at ~10% cost.
const platformName = 'Instagram';
const cachedPrefix = `You are a senior social media copywriter for ${brandPersona(ctx)}.

You are helping a marketer refine the copy for ONE ${platformName} post they are reviewing.

BRAND CONTEXT:
${ctx.instructions || 'No brand profile has been filled in yet — work only from the post facts below and make no claims about the company.'}

LANGUAGE: ${langRule}

${__PROMPT_RULES__}`;

const postFacts = `POST TOPIC: ${ctx.topic || ''}
ANGLE: ${ctx.angle || ''}
TONE: ${ctx.tone || ''}
OBJECTIVE: ${ctx.objective || ''}
CALL TO ACTION: ${ctx.cta || ''}

STYLE CONTROLS:
- ${lengthRule}
- ${hookRule}
- ${emojiRule}
- Hashtags: ${hashtagRule}`;

let variableSuffix, schema;
if (mode === 'variants') {
  schema = '{"variants":[{"caption_ar":"","caption_en":"","hashtags":""}, {…}, {…}]}';
  variableSuffix = `${postFacts}

Write THREE genuinely DIFFERENT variants of this post's copy — not three rephrasings of the same sentence. Vary the hook, structure and rhythm across them so the reviewer has a real choice.

Return ONLY valid JSON, no markdown fences, EXACTLY this shape (exactly 3 items):
${schema}`;
} else {
  // Regenerate ONE piece; hand the model the current draft so the new piece
  // fits what's staying.
  const pieceFieldMap = {
    caption: 'the caption',
    hook:    'the opening HOOK line',
    body:    'the BODY text',
    hashtags:'the hashtag set',
  };
  const currentBlock = `CURRENT DRAFT (regenerate ONLY the ${pieceFieldMap[piece]} — everything else stays as-is, so make the new piece fit it):
- Current hook: ${current.hook || '(n/a)'}
- Current body/caption: ${current.body || current.caption || '(n/a)'}
- Current hashtags: ${current.hashtags || '(none)'}`;
  schema = piece === 'hashtags'
    ? '{"value":"the new hashtag string"}'
    : '{"value_ar":"…", "value_en":"…"}';
  variableSuffix = `${postFacts}

${currentBlock}

Regenerate ONLY ${pieceFieldMap[piece]}. Keep it consistent with the parts that are staying.

Return ONLY valid JSON, no markdown fences, EXACTLY this shape:
${schema}`;
}

try {
  const resp = await req({ method:'POST', url:'https://api.anthropic.com/v1/messages',
    headers:{ 'x-api-key':ANTHROPIC, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body:{ model:'claude-sonnet-5', max_tokens:2500, messages:[{ role:'user', content:[
      { type:'text', text: cachedPrefix, cache_control:{ type:'ephemeral' } },
      { type:'text', text: variableSuffix },
    ] }] },
    json:true });
  if (!resp || resp.type === 'error' || !Array.isArray(resp.content)) {
    throw new Error('Claude caption call failed: ' + (resp && resp.error && resp.error.message ? resp.error.message : JSON.stringify(resp).slice(0, 300)));
  }
  // Claude 5-family models can return a leading `thinking` block even when
  // thinking wasn't explicitly requested — content[0] is NOT reliably the
  // text block, so find it by type instead of indexing.
  const textBlock = resp.content.find(b => b.type === 'text');
  const parsed = safeJson(textBlock && textBlock.text);
  if (mode === 'variants') {
    const variants = Array.isArray(parsed.variants) ? parsed.variants.slice(0, 3) : [];
    if (!variants.length) throw new Error('No variants returned by the model.');
    return [{ json: { ok: true, mode, platform, variants } }];
  } else {
    return [{ json: { ok: true, mode, piece,
      value:    parsed.value    || '',
      value_ar: parsed.value_ar || '',
      value_en: parsed.value_en || '' } }];
  }
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}
""")

ELONGATE_IDEA_JS = _with_brand(r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};
const ANTHROPIC = $env.ANTHROPIC_API_KEY;

async function req(opts){
  try { return await http(opts); }
  catch (e) {
    const detail = (e && (e.error || (e.response && e.response.data) || e.description)) || null;
    const real = detail
      ? (typeof detail === 'string' ? detail
        : Buffer.isBuffer(detail) ? detail.toString('utf8', 0, 300)
        : (detail.error && detail.error.message) || JSON.stringify(detail).slice(0, 400))
      : (e && e.message) || String(e);
    throw new Error(real);
  }
}

function safeJson(t){
  const c = String(t||'').replace(/```json|```/g,'').trim();
  try { return JSON.parse(c); } catch(e){
    const m = c.match(/\{[\s\S]*\}/);
    if(m){ try { return JSON.parse(m[0]); } catch(_){} }
    return {};
  }
}

const body = ($input.first().json.body) || {};
const idea = body.idea || {};
const instructions = body.instructions || '';
const platformName = 'Instagram';

const cachedPrefix = `You are a senior social media strategist for ${brandPersona(body)}.

A team member has a rough idea for a ${platformName} post and wants you to turn it into a proper creative brief — the same quality of brief your AI planner already writes for auto-suggested posts. Keep their original intent; elaborate, don't replace it.

BRAND CONTEXT:
${instructions || 'No brand profile has been filled in yet — work only from their rough idea and make no claims about the company.'}

${__PROMPT_RULES__}`;

const variableSuffix = `ROUGH IDEA (their own words):
"${idea.topic || ''}"
${idea.tone ? `Their stated tone: ${idea.tone}` : ''}
${idea.date ? `Scheduled date: ${idea.date}` : ''}

Turn this into a proper post brief. Return ONLY valid JSON, no markdown fences:
{"topic":"1-2 sentence expanded description of what the post is about, keeping their intent",
 "angle":"the specific creative angle/hook for this post, one sentence",
 "tone":"one of: professional, inspirational, educational, casual, promotional, thought_leader",
 "objective":"one of: Awareness, Engagement, Sales/Leads, Trust/Credibility, Community",
 "cta":"a specific call-to-action, or empty string if none fits",
 "design_tip":"one sentence of art direction for whoever generates the image",
 "image_idea":"a vivid 1-2 sentence description of the image itself, ready to hand to an image generator",
 "occasion":"a specific occasion/holiday this ties to, or empty string if none",
 "content_pillar":"a short content-pillar label, 2-4 words, or empty string",
 "hashtags":"6-8 relevant hashtags for THIS brand's own industry and market, mixing Arabic and English${brandTag(body) ? ', leading with ' + brandTag(body) : ''}"}`;

try {
  const resp = await req({ method:'POST', url:'https://api.anthropic.com/v1/messages',
    headers:{ 'x-api-key':ANTHROPIC, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body:{ model:'claude-sonnet-5', max_tokens:1200, messages:[{ role:'user', content:[
      { type:'text', text: cachedPrefix, cache_control:{ type:'ephemeral' } },
      { type:'text', text: variableSuffix },
    ] }] },
    json:true });
  if (!resp || resp.type === 'error' || !Array.isArray(resp.content)) {
    throw new Error('Claude elongation call failed: ' + (resp && resp.error && resp.error.message ? resp.error.message : JSON.stringify(resp).slice(0, 300)));
  }
  // Claude 5-family models can return a leading `thinking` block even when
  // thinking wasn't explicitly requested — content[0] is NOT reliably the
  // text block, so find it by type instead of indexing.
  const textBlock = resp.content.find(b => b.type === 'text');
  const parsed = safeJson(textBlock && textBlock.text);
  return [{ json: {
    ok: true,
    topic: parsed.topic || idea.topic || '', angle: parsed.angle || '',
    tone: parsed.tone || idea.tone || '', objective: parsed.objective || '',
    cta: parsed.cta || '', design_tip: parsed.design_tip || '',
    image_idea: parsed.image_idea || '', occasion: parsed.occasion || '',
    content_pillar: parsed.content_pillar || '', hashtags: parsed.hashtags || '',
  } }];
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}
""")

DRAFT_COPY_STICKY = r"""## Arak – Draft Copy

**Zero secrets in this file.** Needs `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Fires ONCE PER IDEA the moment a plan is created (or whenever the reviewer asks for a fresh set of options on one card) — deliberately NOT batched across multiple ideas in one call, so a slow/failed draft never blocks the rest of the board and the "don't repeat this sibling" framing stays about OTHER ideas, not itself.

Async like the Content Generation workflows (Respond: Accepted immediately, work happens after) so the board can show a spinner per card and poll `plan_ideas.draft_status` — never synchronous, so a browser tab closing mid-draft doesn't lose the request.

Returns 3 caption options (bilingual per the brand's caption_language) and 3 format/orientation-aware media_prompt options — plus a motion_prompt per option when the idea's format is video. This is the "what should this post actually say and look like" step that happens BEFORE any image/video is rendered — Caption Studio's 3-variant UI already proved this pattern for post-review rewrites; this is the same idea moved earlier, to plan time.

Writes straight to `plan_ideas` (caption_options, media_prompt_options, draft_status, draft_error) — the reviewer picks or edits from there; nothing here is a final, generation-ready value yet."""

# ============================================================
# Code-node JavaScript body (Draft Copy)
# ============================================================
DRAFT_COPY_JS = _with_brand(r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};
const ANTHROPIC = $env.ANTHROPIC_API_KEY;

async function req(opts){
  try { return await http(opts); }
  catch (e) {
    const detail = (e && (e.error || (e.response && e.response.data) || e.description)) || null;
    const real = detail
      ? (typeof detail === 'string' ? detail
        : Buffer.isBuffer(detail) ? detail.toString('utf8', 0, 300)
        : (detail.error && detail.error.message) || JSON.stringify(detail).slice(0, 400))
      : (e && e.message) || String(e);
    throw new Error(real);
  }
}

function safeJson(t){
  const c = String(t||'').replace(/```json|```/g,'').trim();
  try { return JSON.parse(c); } catch(e){
    const m = c.match(/\{[\s\S]*\}/);
    if(m){ try { return JSON.parse(m[0]); } catch(_){} }
    return {};
  }
}

const body     = ($input.first().json.body) || {};
const planIdeaId = body.plan_idea_id || '';
const platform = 'instagram';
const platformName = 'Instagram';
const lang     = body.caption_language || 'both';   // ar | en | both
const format   = body.format || 'feed_image';
const aspectRatio = body.aspect_ratio || '';
const mediaType = body.media_type || 'image';       // image | video | none
const wantsCaption = body.wants_caption !== false;
const instructions = body.instructions || '';

const langRule = lang === 'ar'
  ? 'Write in SAUDI ARABIC (Gulf/Najdi dialect — natural, modern, warm; NOT stiff MSA). Fill the *_ar field; set *_en to "".'
  : lang === 'en'
  ? 'Write in ENGLISH. Fill the *_en field; set *_ar to "".'
  : 'Write BOTH a SAUDI ARABIC version (Gulf/Najdi dialect, not stiff MSA) AND an ENGLISH version, matched in meaning, not word-for-word.';

// CACHED prefix (persona + brand context + language rule) is identical
// across every idea drafted in the same plan, so the 2nd+ call in a
// "create plan" burst reads it at ~10% cost.
const cachedPrefix = `You are a senior social media strategist and copywriter for ${brandPersona(body)}.

You are drafting options for ONE ${platformName} post BEFORE it gets generated — the marketer will pick or edit from what you write here, so give them real, distinct choices rather than three near-identical rewrites.

BRAND CONTEXT:
${instructions || 'No brand profile has been filled in yet — work only from the post facts below and make no claims about the company.'}

LANGUAGE: ${langRule}

${__PROMPT_RULES__}`;

const postFacts = `POST TOPIC: ${body.topic || ''}
ANGLE: ${body.angle || ''}
TONE: ${body.tone || ''}
OBJECTIVE: ${body.objective || ''}
CALL TO ACTION: ${body.cta || ''}
OCCASION: ${body.occasion || '(none)'}
CONTENT PILLAR: ${body.content_pillar || '(none)'}
FORMAT: ${format} (${mediaType === 'video' ? 'video' : mediaType === 'none' ? 'text only, no media' : 'image'}${aspectRatio ? `, ${aspectRatio} orientation` : ''})
${body.image_idea ? `MARKETER'S OWN VISION FOR THE MEDIA: ${body.image_idea}` : ''}`;

const wantsMedia = mediaType !== 'none';
const wantsMotion = mediaType === 'video';

const captionSchema = wantsCaption
  ? `"caption_options":[{"caption_ar":"","caption_en":""}, {…}, {…}]  // exactly 3 genuinely different options — vary the hook/structure, not just wording`
  : `"caption_options":[]  // this post has no caption — leave empty`;
const mediaSchema = wantsMedia
  ? `"media_prompt_options":[{"media_prompt":"a vivid, detailed prompt ready to hand to an image${wantsMotion ? '/video cover' : ''} generator — describe the actual scene, lighting, composition, mood"${wantsMotion ? ', "motion_prompt":"how the still should animate into video — camera move, light behavior, pacing"' : ''}}, {…}, {…}]  // exactly 3 genuinely different directions`
  : `"media_prompt_options":[]  // text-only post, no media — leave empty`;

const variableSuffix = `${postFacts}

Write:
${wantsCaption ? '- 3 distinct caption options for this post.' : "- This post has NO caption — return an empty caption_options array."}
${wantsMedia ? `- 3 distinct ${wantsMotion ? 'video' : 'image'} direction options for this post's media.` : '- This post has no image or video — return an empty media_prompt_options array.'}

Return ONLY valid JSON, no markdown fences, EXACTLY this shape:
{${captionSchema}, ${mediaSchema}}`;

try {
  const resp = await req({ method:'POST', url:'https://api.anthropic.com/v1/messages',
    headers:{ 'x-api-key':ANTHROPIC, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body:{ model:'claude-sonnet-5', max_tokens:3000, messages:[{ role:'user', content:[
      { type:'text', text: cachedPrefix, cache_control:{ type:'ephemeral' } },
      { type:'text', text: variableSuffix },
    ] }] },
    json:true });
  if (!resp || resp.type === 'error' || !Array.isArray(resp.content)) {
    throw new Error('Claude draft-copy call failed: ' + (resp && resp.error && resp.error.message ? resp.error.message : JSON.stringify(resp).slice(0, 300)));
  }
  // Claude 5-family models can return a leading `thinking` block even when
  // thinking wasn't explicitly requested — content[0] is NOT reliably the
  // text block, so find it by type instead of indexing.
  const textBlock = resp.content.find(b => b.type === 'text');
  const parsed = safeJson(textBlock && textBlock.text);
  const captionOptions = wantsCaption && Array.isArray(parsed.caption_options) ? parsed.caption_options.slice(0, 3) : [];
  const mediaPromptOptions = wantsMedia && Array.isArray(parsed.media_prompt_options) ? parsed.media_prompt_options.slice(0, 3) : [];
  if (wantsCaption && !captionOptions.length) throw new Error('No caption options returned by the model.');
  if (wantsMedia && !mediaPromptOptions.length) throw new Error('No media prompt options returned by the model.');
  return { json: { _ok: true, plan_idea_id: planIdeaId, caption_options: captionOptions, media_prompt_options: mediaPromptOptions } };
} catch (err) {
  return { json: { _ok: false, plan_idea_id: planIdeaId, error: (err && err.message) ? err.message : String(err) } };
}
""")



MEDIA_OPTIONS_STICKY = r"""## Arak – Media Options

**Zero secrets in this file.** Needs `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` (storage upload is NOT done here — see note below).

On-demand, synchronous: the reviewer clicks "🖼 Generate image options" on ONE plan-board card and waits a few seconds for 2-3 REAL candidate images (not just prompts) to choose from. Same button covers a video idea's COVER image — the actual video clip only renders at Finalize, so this stays fast and cheap even for a month with several reels.

Real spend (fal.ai), so this is always an explicit per-card click, never automatic for a whole board.

Returns fal.ai's own (temporary) URLs directly — no Supabase Storage upload happens here, since most of the 2-3 candidates get discarded the moment the reviewer picks one. Finalize re-fetches and permanently uploads only the CHOSEN url (see `preview_image_url` on `plan_ideas`)."""

# ============================================================
# Code-node JavaScript body (Media Options)
# ============================================================
MEDIA_OPTIONS_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine — see Creative Generate for the
// full story. Kept here too since this workflow makes its own outbound calls
// and can hit the same blip.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};
// Replicate, not fal — this is the only provider actually keyed up for the
// team (IMAGE_PROVIDER=replicate everywhere else). This workflow used to call
// fal directly and unconditionally, with no provider switch at all, and the
// endpoint it called ('fal-ai/flux-2/pro', a slash instead of fal's real
// hyphenated id 'fal-ai/flux-2-pro') 404'd as "Path /pro not found" on every
// single call — so every "generate media options" click from the planner had
// been producing zero images for anyone, silently, since whenever that typo
// shipped. Rather than also fix the fal call, this now runs the same
// Replicate flux-schnell/flux-dev path the rest of the app already pays for
// and has proven working, so there is one image provider in active use, not
// two.
const REPLICATE = $env.REPLICATE_API_TOKEN;

async function req(opts){
  try { return await http(opts); }
  catch (e) {
    const detail = (e && (e.error || (e.response && e.response.data) || e.description)) || null;
    const real = detail
      ? (typeof detail === 'string' ? detail
        : Buffer.isBuffer(detail) ? detail.toString('utf8', 0, 300)
        : (detail.error && detail.error.message) || JSON.stringify(detail).slice(0, 400))
      : (e && e.message) || String(e);
    throw new Error(real);
  }
}

const body = ($input.first().json.body) || {};
const planIdeaId = body.plan_idea_id || '';
const platform = 'instagram';
const prompt = body.media_prompt || '';
const aspectRatio = body.aspect_ratio || '';
const style = body.style || 'photorealistic';
const refs = Array.isArray(body.reference_image_urls) ? body.reference_image_urls : [];
const useI2I = refs.length > 0;
const count = Math.max(2, Math.min(4, Number(body.count) || 3));

if (!prompt.trim()) {
  return [{ json: { ok: false, plan_idea_id: planIdeaId, error: 'No media prompt to generate from.' } }];
}

const STYLE_MAP = {
  photorealistic:  'architectural photography, natural lighting, hyper-detailed, 4K',
  dramatic:        'cinematic lighting, deep shadows, god rays, high contrast, noir atmosphere',
  minimalist:      'clean lines, soft diffused light, Scandinavian aesthetic, generous white space',
  warm_residential:'warm amber tones, cozy luxury interior, golden hour, 2700K warm light',
  warm_interior:   'warm amber tones, cozy luxury interior, golden hour, 2700K warm light',
  cool_commercial: 'cool white 5000K, modern commercial space, crisp corporate luxury',
  facade_exterior: 'architectural exterior night photography, facade illumination, dramatic night sky',
};
// Brand tail comes from the payload, not from a hardcoded industry — see
// decoratePrompt in Generate Post for the same reasoning.
const brandTail = String(body.brand_name || '').trim();
const basePrompt = `${prompt}, ${STYLE_MAP[style] || STYLE_MAP.photorealistic}${brandTail ? ', ' + brandTail : ''}, ultra high detail`;

// Replicate's flux models take an aspect_ratio string, not a named bucket —
// same '1.91:1' -> '3:2' fold Generate Post uses, since Replicate has no
// 1.91:1 preset either.
function aspectRatioFor(ar){
  return ar === '1.91:1' ? '3:2' : (ar || '1:1');
}

// Small, genuinely-different variations per candidate rather than N
// identical calls — different framing/mood angle each time, so the
// reviewer has a real choice instead of three near-duplicates.
const VARIATIONS = [
  '',
  ', alternate camera angle, different composition',
  ', different time of day and mood',
  ', wider establishing shot',
];

async function genOne(variation){
  const finalPrompt = basePrompt + variation;
  const model = useI2I ? 'black-forest-labs/flux-dev' : 'black-forest-labs/flux-schnell';
  const input = { prompt: finalPrompt, aspect_ratio: aspectRatioFor(aspectRatio), output_format:'webp', output_quality:90, num_outputs:1 };
  if (useI2I){ input.image = refs[0]; input.prompt_strength = 0.72; input.num_inference_steps = 24; }
  else { input.num_inference_steps = 4; input.go_fast = true; }
  // Poll from t=0 rather than Prefer:wait — same reasoning as Generate Post:
  // a flux-dev cold start routinely exceeds the 60s sync-wait ceiling, and
  // this is 2-4 of these running in parallel per click.
  const start = await req({ method:'POST',
    url:`https://api.replicate.com/v1/models/${model}/predictions`,
    headers:{ Authorization:`Bearer ${REPLICATE}`, 'Content-Type':'application/json' },
    body:{ input }, json:true });
  const predId = start.id;
  const getUrl = (start.urls && start.urls.get) || (predId ? `https://api.replicate.com/v1/predictions/${predId}` : null);
  let status = start.status, out = start.output, err = start.error;
  if (!getUrl && !out) throw new Error('Replicate did not return a prediction: ' + JSON.stringify(start).slice(0, 250));
  let tries = 0;
  while ((status === 'starting' || status === 'processing' || !status) && getUrl && tries < 120){
    await new Promise(s => setTimeout(s, 2000));
    const g = await req({ method:'GET', url:getUrl, headers:{ Authorization:`Bearer ${REPLICATE}` }, json:true });
    status = g.status; out = g.output; err = g.error; tries++;
    if (status === 'succeeded' || status === 'failed' || status === 'canceled') break;
  }
  if (status === 'failed' || status === 'canceled') {
    throw new Error('Replicate generation ' + status + ': ' + (err || 'no detail') + ' (prediction ' + predId + ')');
  }
  const url = Array.isArray(out) ? out[0] : out;
  if (!url) throw new Error('Replicate timed out after ~' + (tries * 2) + 's, last status "' + status + '" (prediction ' + predId + ')');
  return url;
}

try {
  const jobs = [];
  for (let i = 0; i < count; i++) jobs.push(genOne(VARIATIONS[i] || ''));
  // allSettled, not all — one candidate failing (rate limit, transient
  // error) shouldn't discard the others; only fail outright if EVERY
  // candidate fails.
  const settled = await Promise.allSettled(jobs);
  const images = settled.filter(s => s.status === 'fulfilled').map(s => s.value);
  if (!images.length) {
    const firstError = settled.find(s => s.status === 'rejected');
    throw new Error((firstError && firstError.reason && firstError.reason.message) || 'All image candidates failed.');
  }
  return [{ json: { ok: true, plan_idea_id: planIdeaId, images } }];
} catch (err) {
  return [{ json: { ok: false, plan_idea_id: planIdeaId, error: (err && err.message) ? err.message : String(err) } }];
}
"""

VIDEO_RENDER_STICKY = r"""## Arak – Video Render

**Zero secrets in this file.** Needs `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Batch: Finalize fires this once per approved video-format idea, all at once ("Generate" pulls together every outstanding video render in one action) — one item per idea, `run_once_for_each_item`, so one slow/failed render never blocks the others.

Uses each idea's already-picked cover_image_url (chosen via Media Options during review) + motion_prompt (from Draft Copy / hand-edited) — no new creative decisions happen here, this step only renders the clip. Model: fal.ai `fal-ai/ltx-2/image-to-video/fast` via the queue API (submit → poll status → fetch result), matching the image pipeline's existing poll-don't-block-on-Prefer-wait pattern.

**Known limitation, not silently papered over:** on failure, this workflow does NOT write any status back — there's no video-specific status column yet (unlike drafting/generation, which both have one). A failed render just means the post's video_url stays empty; retry is "click Generate video again" without a stuck-spinner/failed-badge affordance yet. Flagged as a real follow-up, not treated as done."""

# ============================================================
# Code-node JavaScript body (Video Render)
# ============================================================
VIDEO_RENDER_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};
const prepareBinaryData = this.helpers.prepareBinaryData;
const FAL = $env.FAL_KEY;
const MODEL = 'fal-ai/ltx-2/image-to-video/fast';

async function req(opts){
  try { return await http(opts); }
  catch (e) {
    const detail = (e && (e.error || (e.response && e.response.data) || e.description)) || null;
    const real = detail
      ? (typeof detail === 'string' ? detail
        : Buffer.isBuffer(detail) ? detail.toString('utf8', 0, 300)
        : (detail.error && detail.error.message) || JSON.stringify(detail).slice(0, 400))
      : (e && e.message) || String(e);
    throw new Error(real);
  }
}

// MP4's magic bytes are an 'ftyp' box at offset 4, not at the start (unlike
// image formats) — a truncated/wrong download otherwise looks byte-plausible
// and silently corrupts the post the same way a bad image buffer once did.
function looksLikeVideo(buf){
  if (!buf || buf.length < 12) return false;
  return buf.toString('ascii', 4, 8) === 'ftyp';
}

async function downloadAndPrepareVideo(url, filename){
  const buf = await req({ method:'GET', url, encoding:'arraybuffer' });
  if (!looksLikeVideo(buf)) {
    throw new Error(`Downloaded file from ${url} isn't a real video (${buf.length} bytes, starts with "${buf.toString('ascii', 0, 16)}")`);
  }
  return await prepareBinaryData(buf, filename, 'video/mp4');
}

// One webhook call per video idea (same convention as Draft Copy/Media
// Options) — the raw webhook item is {headers, params, query, body}, so
// the actual payload is nested under .body, unlike Generate Post's `idea`
// (which comes from a Split Ideas step that already unwraps it).
const idea = ($input.item.json && $input.item.json.body) || {};

try {
  if (!idea.cover_image_url) throw new Error('No cover image to animate.');
  if (!idea.motion_prompt) throw new Error('No motion direction to animate with.');

  const submit = await req({ method:'POST', url:`https://queue.fal.run/${MODEL}`,
    headers:{ Authorization:`Key ${FAL}`, 'Content-Type':'application/json' },
    body:{ image_url: idea.cover_image_url, prompt: idea.motion_prompt, duration:'6', resolution:'1080p' },
    json:true });
  const requestId = submit.request_id;
  if (!requestId) throw new Error('fal did not return a request_id: ' + JSON.stringify(submit).slice(0, 250));

  // Poll where fal SAYS to poll. The queue is keyed on the first TWO path
  // segments, so building these from the full MODEL path returns 405 — after
  // the submit, i.e. after the render has already been started and charged.
  // Same bug as Creative Video carried, found and fixed 2026-08-11.
  const APP_ID = MODEL.split('/').slice(0, 2).join('/');
  const statusUrl = submit.status_url || `https://queue.fal.run/${APP_ID}/requests/${requestId}/status`;
  const resultUrl = submit.response_url || `https://queue.fal.run/${APP_ID}/requests/${requestId}`;

  // Poll rather than block on a long synchronous wait — video generation
  // routinely runs past what a single HTTP call should hold open. Up to
  // ~7.5 minutes, generous like the existing Replicate image poll.
  let status = submit.status || 'IN_QUEUE';
  let tries = 0;
  while ((status === 'IN_QUEUE' || status === 'IN_PROGRESS') && tries < 150) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await req({ method:'GET', url: statusUrl, headers:{ Authorization:`Key ${FAL}` }, json:true });
    status = s.status; tries++;
  }
  if (status !== 'COMPLETED') {
    throw new Error(status === 'IN_QUEUE' || status === 'IN_PROGRESS'
      ? `fal video generation timed out after ~${tries * 3}s (request ${requestId})`
      : `fal video generation ${status} (request ${requestId})`);
  }

  const result = await req({ method:'GET', url: resultUrl, headers:{ Authorization:`Key ${FAL}` }, json:true });
  const videoUrl = result.video && result.video.url;
  if (!videoUrl) throw new Error('fal returned no video URL: ' + JSON.stringify(result).slice(0, 250));

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  const bucket = 'instagram-posts';
  const binary = { data: await downloadAndPrepareVideo(videoUrl, filename) };

  return { json: { _ok: true, plan_idea_id: idea.plan_idea_id || null, platform: idea.platform || 'instagram', filename, bucket }, binary };
} catch (err) {
  return { json: { _ok: false, plan_idea_id: idea.plan_idea_id || null, platform: idea.platform || 'instagram', error: (err && err.message) ? err.message : String(err) } };
}
"""

ZERNIO_PUBLISH_STICKY = r"""## Arak – Publish Post (Zernio)

**Zero secrets in this file.** Needs `ZERNIO_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Publishes or schedules ONE approved post to its platform through Zernio's unified API (`POST /v1/posts`), then writes the Zernio post id + publish state back onto our own row.

**Why a workflow and not a direct browser call:** the Zernio key is a server-side secret. Calling `zernio.com` from the frontend would ship the key to anyone who opens devtools — so the browser talks to this webhook and only n8n ever sees the key, exactly like every other provider in this project.

Synchronous (`lastNode`): Zernio accepts-and-queues, so the call is fast and the reviewer gets a real result (or a real error) rather than a fire-and-forget spinner.

**Account resolution:** pass `account_id` (Zernio's account `_id`) to target a specific connected account; omit it and this resolves the first active, non-reconnect-needing account for the platform via `GET /v1/accounts`. Resolved accounts are mirrored into `social_accounts` on the way through, so the UI can list them without holding the key.

**Media** is passed by URL (`mediaItems[].url`) — our generated images/videos already live in public Supabase Storage, so nothing is re-uploaded.

Zernio is an ADAPTER here, deliberately: `zernio_post_id` sits next to our own row rather than replacing it, so switching providers later (Ayrshare's SDK is wire-compatible) means editing this one workflow, not the schema or the UI."""

ZERNIO_PUBLISH_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

// n8n's thrown-error shape for non-2xx responses varies by version (the
// body ends up under different keys depending on how the client wraps
// axios), which is why this used to surface a useless generic
// "Request failed with status code 400". Sidestepping that entirely:
// disable the throw, read the parsed JSON body ourselves.
async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 400))
            : (typeof b === 'string' && b) ? b.slice(0, 400)
            : `HTTP ${status}`;
  throw new Error(`Zernio ${status}: ${msg}`);
}

// Instagram's publish API only accepts JPG/PNG — it rejects WEBP outright,
// which is what every image in this pipeline is generated/stored as (webp
// is deliberately kept everywhere else for size). Rather than re-encoding
// our storage pipeline (would bloat the app's own asset sizes for no
// benefit), route just the outbound publish URL through a JPEG-converting
// proxy. images.weserv.nl is a free, widely-used image CDN/proxy that
// supports on-the-fly format conversion — no auth, no upload round-trip.
function toPublishable(u){
  if (!u || !/\.webp(\?|#|$)/i.test(u)) return u;
  return `https://images.weserv.nl/?url=${encodeURIComponent(u)}&output=jpg`;
}

// Bilingual captions are stored as one string, Arabic block + "\n\n—\n\n" +
// English block (see GENERATE_POST_JS_TEMPLATE). Because the string OPENS
// with Arabic, a renderer that treats it as a single bidi paragraph (which
// Instagram's does — it does not treat blank lines as paragraph breaks)
// resolves the whole thing at RTL embedding level. Neutral characters in
// the English half (the "." ending a sentence, the "+" in "45+") then
// visually reorder to the wrong side of their line — that's the stray
// leading "." users see in front of English lines. Wrapping each language
// block in a Unicode directional isolate forces it to resolve independently
// of what surrounds it, regardless of platform.
const LRI = '⁦', RLI = '⁧', PDI = '⁩'; // LTR/RTL isolate, pop isolate
const isArabicScript = s => /[؀-ۿݐ-ݿ]/.test(s);
function isolateBilingual(text){
  const SEP = '\n\n—\n\n';
  const idx = text.indexOf(SEP);
  if (idx === -1) return text; // monolingual — nothing to isolate
  const first  = text.slice(0, idx);
  const second = text.slice(idx + SEP.length);
  const wrap = s => s ? (isArabicScript(s) ? RLI : LRI) + s + PDI : s;
  return wrap(first) + SEP + wrap(second);
}

const body = ($input.first().json.body) || {};
const ZERNIO   = $env.ZERNIO_API_KEY;
const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const ZBASE    = 'https://zernio.com/api/v1';
const zHeaders = { Authorization: `Bearer ${ZERNIO}`, 'Content-Type': 'application/json' };

// ── Wall clock -> absolute instant ──────────────────────────────────────
// Zernio takes a schedule as two fields: a naive wall time ('2026-08-20T19:00')
// plus the zone to read it in. Our `scheduled_publish_at` column is timestamptz
// — an absolute instant. Those are different things, and this workflow used to
// write the wall string straight into the column. Postgres then resolved the
// naive literal in the SESSION zone (UTC on Supabase), so 7 PM Riyadh was
// stored as 7 PM UTC: three hours later than the moment Zernio would actually
// publish. Zernio was right and our database was wrong, silently, on every
// scheduled post — and any calendar reading the column inherited the error.
//
// The conversion happens HERE rather than in the browser on purpose: this node
// is the last thing between a caller and the column, so doing it here means a
// cron, a bulk run or a future internal caller cannot reintroduce the bug by
// forgetting to convert.
function offsetMsAt(utcMs, tz){
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
  }).formatToParts(utcMs)) p[type] = value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}
function wallToUtcISO(wall, tz){
  const s = String(wall || '').trim();
  if (!s) return null;
  // Already carries a zone (trailing Z or ±HH:MM)? Then it is an instant
  // already and re-interpreting it would shift a correct value.
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let utcMs = guess - offsetMsAt(guess, tz);
  const refined = guess - offsetMsAt(utcMs, tz);   // second pass matters across DST
  if (refined !== utcMs) utcMs = refined;
  return new Date(utcMs).toISOString();
}

// Cancel a scheduled post on Zernio's side.
//
// DELETE /posts/{id} removes a draft or scheduled post (published ones need
// Unpublish and are refused below). This is what makes rescheduling honest:
// once a post is handed to Zernio, Zernio owns when it fires, so moving it in
// our database alone would leave the two disagreeing and Zernio would win.
//
// A 404 counts as success — the post is gone, which is the outcome we wanted.
async function cancelZernioPost(zernioPostId){
  if (!zernioPostId) return { ok: true, skipped: true };
  try {
    await req({ method:'DELETE', url:`${ZBASE}/posts/${encodeURIComponent(zernioPostId)}`,
                headers:zHeaders, json:true });
    return { ok: true, deleted: true };
  } catch (e) {
    const msg = (e && e.message) || String(e);
    if (/\b404\b|Not found/i.test(msg)) return { ok: true, deleted: false, alreadyGone: true };
    return { ok: false, error: msg };
  }
}

// Our row, so we can write the result back.
const postId      = body.post_id || '';
const postTable   = body.post_table || 'instagram_generated_posts';
const workspaceId = body.workspace_id || null;
const platform    = body.platform || 'instagram';
// Moving an already-scheduled post to a new time, rather than a first publish.
const isReschedule = body.reschedule === true;
// Set once a reschedule has actually retired the old Zernio post, so the
// failure path can say so — "nothing is scheduled any more" is a very
// different thing to tell someone than "your change didn't apply".
let retiredZernioId = '';

// Only these three tables exist; anything else is a caller bug, and
// interpolating an arbitrary string into the PATCH URL would be worse.
const ALLOWED_TABLES = ['instagram_generated_posts','generated_posts'];
if (!ALLOWED_TABLES.includes(postTable)) throw new Error('Unknown post_table: ' + postTable);

async function patchPost(fields){
  if (!postId) return;
  try {
    await http({ method:'PATCH', url:`${SUPA_URL}/rest/v1/${postTable}?id=eq.${postId}`,
      headers:{ apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body: fields, json:true });
  } catch (e) { /* never let status bookkeeping mask the real publish result */ }
}

// Claim this post for publishing, atomically.
//
// Nothing here used to look at our own row before calling Zernio: the flow was
// mark 'publishing' -> POST /posts -> write the id back. A double-click, a
// second tab, a retried webhook or a bulk run that overlaps itself therefore
// published the SAME post twice, on the real platform, with no way to tell
// afterwards which id was the duplicate. The browser's `setPublishingId` only
// ever guarded one tab's buttons.
//
// A read-then-check can't fix that — two callers both read "not published"
// before either writes. So the claim IS the check: PATCH filtered on the
// states it is legal to publish FROM, asking for the row back. Postgres
// serialises the two updates, so exactly one caller sees a row returned and
// the loser sees none. Whoever gets the row owns the publish.
//
// Legal starting states are 'not_published' and 'failed' (a retry after a
// genuine failure). Deliberately NOT 'publishing': a row already in flight is
// someone else's, and re-entering it is the exact bug this closes.
//
// A reschedule (`reschedule: true`) adds 'scheduled' to that list, and ONLY
// that one. Moving a post that Zernio already holds is legitimate — cancel the
// old, create the new — but 'publishing' stays excluded even here: that row is
// mid-flight at the platform, and cancelling underneath it is precisely how you
// end up either double-posted or silently unpublished. 'published' is excluded
// because it has already gone out; Zernio's DELETE refuses it too.
//
// Escape hatch: force:true skips the claim. A run that dies between claiming
// and writing the id back leaves the row stuck in 'publishing' forever, and
// until a stale-job reconciler exists that is the only way to recover it.
async function claimPost(){
  if (!postId) return { ok: true, claimed: false, row: {} };   // ad-hoc publish, no row to guard
  if (body.force === true) return { ok: true, claimed: true, forced: true, row: {} };
  const from = isReschedule ? 'not_published,failed,scheduled' : 'not_published,failed';
  const rows = await http({
    method:'PATCH',
    url:`${SUPA_URL}/rest/v1/${postTable}?id=eq.${postId}&publish_status=in.(${from})`,
    headers:{ apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json', Prefer:'return=representation' },
    body:{ publish_status:'publishing', publish_error:'' }, json:true });
  // The claimed row comes back with it, which is how the reschedule path
  // learns which Zernio post to cancel. Deliberately not taken from the
  // request body: a caller holding a stale id would have us delete some other
  // post entirely, and the row is the only authority on what we last created.
  if (Array.isArray(rows) && rows.length) return { ok: true, claimed: true, row: rows[0] || {} };

  // Lost the race, or it was already published. Read back the real reason so
  // the caller gets something better than "no".
  let current = {};
  try {
    const got = await http({ method:'GET',
      url:`${SUPA_URL}/rest/v1/${postTable}?id=eq.${postId}&select=publish_status,zernio_post_id,platform_post_url`,
      headers:{ apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}` }, json:true });
    current = (Array.isArray(got) && got[0]) || {};
  } catch (e) { /* the refusal stands either way */ }
  return { ok: false, claimed: false, current };
}

try {
  if (!ZERNIO) throw new Error('ZERNIO_API_KEY is not set on this n8n instance.');

  // ---- 0) cancel-only: give the slot back, keep the post ----
  //
  // Its own branch because none of the publish machinery applies — no account
  // to resolve, no media to assemble, and the "nothing to publish" guard below
  // would reject a perfectly valid cancel of a post whose caption is empty.
  // Still goes through claimPost, so a cancel racing a publish loses the same
  // way any other second writer does.
  if (isReschedule && body.cancel_only === true){
    const c = await claimPost();
    if (!c.ok){
      const cur = c.current || {};
      return [{ json: { ok: false, skipped: true, post_id: postId,
        publish_status: cur.publish_status || 'in flight',
        error: `Cannot unschedule a post that is ${cur.publish_status || 'in flight'}.` } }];
    }
    const existingId = String((c.row && c.row.zernio_post_id) || '');
    const cancelled = await cancelZernioPost(existingId);
    if (!cancelled.ok){
      await patchPost({ publish_status:'scheduled', publish_error:`Could not cancel at Zernio: ${cancelled.error}` });
      return [{ json: { ok:false, post_id:postId, publish_status:'scheduled',
        error:`Could not cancel at Zernio — the post is still scheduled for its original time. ${cancelled.error}` } }];
    }
    await patchPost({ publish_status:'not_published', publish_error:'',
                      zernio_post_id:null, scheduled_publish_at:null });
    return [{ json: { ok:true, post_id:postId, publish_status:'not_published',
                      cancelled:true, zernio_post_id:existingId } }];
  }

  // ---- 1) resolve which connected account to post as ----
  let accountId = body.account_id || '';
  if (!accountId){
    const list = await req({ method:'GET', url:`${ZBASE}/accounts`, headers:zHeaders, json:true });
    const accounts = (list && list.accounts) || [];
    const match = accounts.find(a =>
      a.platform === platform && a.isActive !== false && a.needsReconnection !== true);
    if (!match){
      const connected = accounts.map(a => a.platform).join(', ') || 'none';
      throw new Error(`No connected ${platform} account in Zernio (connected: ${connected}). Connect one in the Zernio dashboard first.`);
    }
    accountId = match._id;

    // Mirror what we just learned into social_accounts so the UI can show
    // connected accounts without ever touching the Zernio key. Upsert on
    // (workspace_id, zernio_account_id) — see the migration's unique index.
    if (workspaceId){
      try {
        await http({ method:'POST', url:`${SUPA_URL}/rest/v1/social_accounts?on_conflict=workspace_id,zernio_account_id`,
          headers:{ apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json', Prefer:'resolution=merge-duplicates,return=minimal' },
          body:{ workspace_id: workspaceId, zernio_account_id: match._id, platform: match.platform,
                 username: match.username || '', display_name: match.displayName || '',
                 profile_picture: match.profilePicture || '', profile_url: match.profileUrl || '',
                 is_active: match.isActive !== false, needs_reconnection: match.needsReconnection === true,
                 followers_count: match.followersCount || 0, last_synced_at: new Date().toISOString(),
                 updated_at: new Date().toISOString() },
          json:true });
      } catch (e) { /* caching is best-effort; publishing must not fail on it */ }
    }
  }

  // ---- 2) build the Zernio payload ----
  // Caption + hashtags are two columns for us but one text field for every
  // platform, so join them here rather than making the caller pre-format.
  const caption  = isolateBilingual(String(body.caption || '').trim());
  const hashtags = String(body.hashtags || '').trim();
  const content  = [caption, hashtags].filter(Boolean).join('\n\n');

  const mediaItems = [];
  const videoUrl = body.video_url || '';
  const coverUrl = body.cover_image_url || '';
  if (videoUrl){
    const item = { type:'video', url: videoUrl };
    // Zernio takes a cover for Reels under instagramThumbnail and for
    // everything else under thumbnail — send both; each platform ignores
    // the one it doesn't use.
    if (coverUrl){ const c = toPublishable(coverUrl); item.thumbnail = c; item.instagramThumbnail = c; }
    mediaItems.push(item);
  } else {
    // image_urls (carousel) preferred, else the single image_url.
    const urls = Array.isArray(body.image_urls) && body.image_urls.length
      ? body.image_urls
      : [body.image_url].filter(Boolean);
    for (const u of urls){
      if (!u) continue;
      const item = { type:'image', url: toPublishable(u) };
      if (body.alt_text) item.altText = String(body.alt_text).slice(0, 1000);
      mediaItems.push(item);
    }
  }

  if (!content && !mediaItems.length){
    throw new Error('Nothing to publish — the post has neither caption text nor media.');
  }

  // ── Per-platform options from the composer ────────────────────────────
  //
  // These arrive already shaped by src/lib/composerState.js, which is also
  // what decides which fields a given format may carry (firstComment is a
  // rejection on a Story, duet/stitch a rejection on a photo carousel). This
  // node passes them through rather than re-deriving them: two places
  // computing the same rule is two places to fix when a platform changes one,
  // and the browser is where the user can actually be told.
  //
  // Still SANITISED here, because a webhook is reachable without the browser:
  // only known keys survive, so a caller cannot inject arbitrary fields into
  // the provider call.
  const IG_KEYS = ['contentType','firstComment','collaborators','userTags',
                   'shareToFeed','thumbOffset','instagramThumbnail','isAiGenerated','altText',
                   // Audio. `audioName` renames the video's OWN audio and works on
                   // any connection; `audioConfiguration` attaches a catalog track
                   // and requires the account to have been connected through
                   // Facebook Login. They are independent — a Reel can have either,
                   // both or neither.
                   'audioName','audioConfiguration'];
  const TT_KEYS = ['privacy_level','allow_comment','allow_duet','allow_stitch',
                   'video_cover_timestamp_ms','video_cover_image_url','media_type',
                   'photo_cover_index','description','auto_add_music','video_made_with_ai',
                   'content_preview_confirmed','express_consent_given'];
  const pick = (src, keys) => {
    const out = {};
    for (const k of keys){ if (src && src[k] !== undefined && src[k] !== null) out[k] = src[k]; }
    return out;
  };

  const psd = pick(body.platform_specific_data, IG_KEYS);

  // Catalog audio is Reels only — Stories, images and carousels reject it at
  // container creation. The composer only offers it on a Reel, but this is a
  // webhook: refusing here means a hand-made request gets a sentence rather
  // than an opaque provider rejection, and the row is not left claimed.
  if (psd.audioConfiguration){
    const isReel = !psd.contentType && !!videoUrl;
    if (!isReel){
      throw new Error('Catalog audio can only be attached to a Reel (a single video post).');
    }
    if (!psd.audioConfiguration.audioId){
      throw new Error('Catalog audio needs an audioId.');
    }
  }

  const target = { platform, accountId };
  if (Object.keys(psd).length) target.platformSpecificData = psd;

  const payload = { platforms: [target] };
  if (content) payload.content = content;
  if (mediaItems.length) payload.mediaItems = mediaItems;

  // TikTok's settings go at the TOP level of the body, NOT inside
  // platformSpecificData. Zernio's docs call this out as unique to TikTok, and
  // getting it wrong is not an error — the block is ignored and the post
  // publishes with TikTok's defaults instead of the ones that were chosen,
  // which for privacy_level means a post that may be more public than asked.
  if (platform === 'tiktok'){
    const tt = pick(body.tiktok_settings, TT_KEYS);
    if (!tt.privacy_level){
      throw new Error('TikTok requires a privacy level, and it must be one the creator account allows.');
    }
    // Re-asserted rather than trusted from the caller. TikTok requires both to
    // be true as a condition of API access; a request that reaches this
    // workflow without them is one the browser did not send.
    if (tt.content_preview_confirmed !== true || tt.express_consent_given !== true){
      throw new Error('TikTok requires the content and consent declaration to be confirmed for every post.');
    }
    payload.tiktokSettings = tt;
  }

  // scheduledFor vs publishNow are mutually exclusive in intent; prefer an
  // explicit schedule when one is given.
  //
  // `scheduled_for` is a NAIVE wall time and must stay naive here — Zernio
  // reads it against the `timezone` field beside it. The absolute instant for
  // our own column is derived from the pair further down.
  const scheduledFor = body.scheduled_for || '';
  const scheduleTz   = body.timezone || 'Asia/Riyadh';
  if (scheduledFor){
    payload.scheduledFor = scheduledFor;
    payload.timezone = scheduleTz;
  } else {
    payload.publishNow = true;
  }

  // Refuse a schedule we cannot resolve to a real instant, before anything is
  // claimed or sent. Letting it through would publish at a time nobody chose
  // and leave the column null, which reads in the calendar as "unscheduled"
  // for a post that is in fact queued at the platform.
  const scheduledAtUTC = scheduledFor ? wallToUtcISO(scheduledFor, scheduleTz) : null;
  if (scheduledFor && !scheduledAtUTC){
    throw new Error(`Unparseable scheduled_for: ${JSON.stringify(scheduledFor)} (expected 'YYYY-MM-DDTHH:MM' read in ${scheduleTz}).`);
  }

  // Claimed here rather than at the top of the try: the window between owning
  // the row and actually calling Zernio should be as short as possible.
  const claim = await claimPost();
  if (!claim.ok){
    // RETURN, never throw. The catch below writes publish_status='failed', and
    // reaching it here would stamp 'failed' onto a post that is in fact live —
    // turning a harmless duplicate click into corrupted state.
    const cur = claim.current || {};
    const st  = cur.publish_status || 'in flight';
    return [{ json: {
      ok: false, skipped: true, post_id: postId, platform,
      publish_status: st,
      zernio_post_id: cur.zernio_post_id || '',
      platform_post_url: cur.platform_post_url || '',
      error: `Already ${st} — refusing to publish this post a second time. Send force:true to override.`,
    } }];
  }

  // ---- 3) if this is a reschedule, retire the old Zernio post FIRST ----
  //
  // Order is the whole safety argument. Cancel-then-create can only fail
  // toward "nothing is scheduled" — visible in the UI, recoverable by sending
  // it again. Create-then-cancel fails toward TWO live scheduled posts on the
  // real platform, which is the failure the claim guard above exists to
  // prevent and which no amount of retrying undoes.
  //
  // So a failed cancel aborts: the row goes back to 'scheduled' with its
  // original Zernio post still standing, which is exactly where it started.
  const previousZernioId = String((claim.row && claim.row.zernio_post_id) || '');
  if (isReschedule && previousZernioId){
    const cancelled = await cancelZernioPost(previousZernioId);
    if (cancelled.ok && cancelled.deleted) retiredZernioId = previousZernioId;
    if (!cancelled.ok){
      await patchPost({
        publish_status: 'scheduled',
        publish_error: `Could not cancel the existing scheduled post — it is still set for its original time. ${cancelled.error}`,
      });
      return [{ json: {
        ok: false, post_id: postId, platform, publish_status: 'scheduled',
        zernio_post_id: previousZernioId,
        error: `Reschedule aborted: ${cancelled.error}. The post is unchanged and still scheduled for its original time.`,
      } }];
    }
  }

  // ---- 4) publish ----
  const resp = await req({ method:'POST', url:`${ZBASE}/posts`, headers:zHeaders, body:payload, json:true });
  const post = (resp && (resp.post || resp)) || {};
  const zernioPostId = post._id || post.id || '';
  if (!zernioPostId){
    throw new Error('Zernio accepted the request but returned no post id: ' + JSON.stringify(resp).slice(0, 300));
  }

  // Zernio's own status is the truth here ('scheduled' | 'publishing' |
  // 'published'); map anything unexpected to our closest equivalent rather
  // than inventing a state our CHECK constraint would reject.
  const zStatus = String(post.status || '').toLowerCase();
  const publishStatus =
    zStatus === 'scheduled'  ? 'scheduled'
  : zStatus === 'published'  ? 'published'
  : scheduledFor             ? 'scheduled'
  :                            'publishing';

  const fields = {
    zernio_post_id: zernioPostId,
    // Which connected account we actually posted as. Stored HERE because
    // Zernio's per-day analytics timeline reports platform + platformPostId
    // but NOT accountId — so with several accounts on one platform there'd
    // be no way to attribute metrics back to the right one at sync time.
    // Publish time is the only moment this is unambiguously known.
    zernio_account_id: accountId,
    publish_status: publishStatus,
    publish_error: '',
    platform_post_url: post.platformPostUrl || '',
  };
  // The absolute instant, NOT the wall string. See wallToUtcISO above for the
  // three-hour bug this replaced.
  if (publishStatus === 'scheduled') fields.scheduled_publish_at = scheduledAtUTC;
  if (publishStatus === 'published') fields.published_at = post.publishedAt || new Date().toISOString();
  await patchPost(fields);

  return [{ json: { ok: true, post_id: postId, zernio_post_id: zernioPostId,
                    publish_status: publishStatus, platform, account_id: accountId,
                    platform_post_url: fields.platform_post_url } }];
} catch (err) {
  let message = (err && err.message) ? err.message : String(err);
  // A reschedule that got past the cancel and then failed has left the post
  // with NO schedule at all — the old one is genuinely gone from Zernio. Say
  // so, because "failed" alone reads as "nothing changed" and someone would
  // reasonably assume the original time still stands.
  if (retiredZernioId){
    message = `${message} — note: the previous schedule (Zernio post ${retiredZernioId}) was already cancelled, so this post is NOT scheduled any more. Send it again to pick a new time.`;
  }
  await patchPost({
    publish_status: 'failed', publish_error: message,
    ...(retiredZernioId ? { zernio_post_id: null, scheduled_publish_at: null } : {}),
  });
  return [{ json: { ok: false, post_id: postId, error: message, unscheduled: !!retiredZernioId } }];
}
"""

ZERNIO_SYNC_STICKY = r"""## Arak – Zernio Sync (accounts + analytics)

**Zero secrets in this file.** Needs `ZERNIO_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Pulls state back FROM Zernio: refreshes `social_accounts` (what's connected, follower counts, dead tokens) and fills `post_analytics` with per-day metrics for every post we published through Zernio.

Runs on a daily schedule AND on an on-demand webhook (`arak-zernio-sync`) so a "Refresh" button in the UI hits the same path — one workflow, not two that drift.

**Why it queries per-post instead of the bulk list:** `GET /v1/analytics` (list mode) returns EXTERNAL post ids, not the Zernio ids we stored at publish time — the docs are explicit about this and suggest correlating on `platformPostUrl`, which is fragile (URLs get rewritten, and it breaks entirely for posts with no public URL yet). Single-post mode (`?postId=`) is documented to accept Zernio post ids directly, so this iterates our own published rows and asks about each one by id. N calls instead of 1, but correct correlation instead of clever correlation — and at this scale N is dozens per month.

`/analytics/post-timeline` is the primary source (it returns exactly our per-day shape); the single-post totals are the fallback when a post is too new to have a timeline, written as one row dated today.

**`metrics_present`** records which metrics the platform actually reported, so a real 0 stays distinguishable from "this platform doesn't measure saves" — without it, averaging `saves` across platforms silently counts a non-reporting post as zero-saves."""

ZERNIO_SYNC_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

// See the matching comment in the Publish workflow: n8n's thrown-error
// shape for non-2xx responses is unreliable across versions, so read the
// parsed JSON body ourselves instead of guessing at e.error/e.response.data.
async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 400))
            : (typeof b === 'string' && b) ? b.slice(0, 400)
            : `HTTP ${status}`;
  throw new Error(`Zernio ${status}: ${msg}`);
}

// Fired by EITHER a schedule trigger (no body) or the webhook (body with an
// optional workspace_id). Both shapes have to be tolerated here.
const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || {};
const ZERNIO   = $env.ZERNIO_API_KEY;
const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const ZBASE    = 'https://zernio.com/api/v1';
const zHeaders = { Authorization: `Bearer ${ZERNIO}`, 'Content-Type': 'application/json' };
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const POST_TABLES = ['instagram_generated_posts','generated_posts'];
const METRIC_KEYS = ['impressions','reach','likes','comments','shares','saves','clicks','views'];

function today(){ return new Date().toISOString().slice(0, 10); }

try {
  if (!ZERNIO) throw new Error('ZERNIO_API_KEY is not set on this n8n instance.');
  const wsFilter = body.workspace_id ? `&workspace_id=eq.${body.workspace_id}` : '';

  // ══ 1) accounts ══════════════════════════════════════════════════════
  const list = await req({ method:'GET', url:`${ZBASE}/accounts`, headers:zHeaders, json:true });
  const accounts = (list && list.accounts) || [];
  const hasAnalyticsAccess = !!(list && list.hasAnalyticsAccess);

  // Zernio has no notion of our workspaces — one API key is one Zernio
  // account. Mirror its accounts into whichever workspace asked (webhook)
  // or every workspace that already has rows (schedule). Without a
  // workspace we can't write anything RLS-scoped, so skip rather than
  // guess.
  let workspaceIds = [];
  if (body.workspace_id){
    workspaceIds = [body.workspace_id];
  } else {
    const existing = await req({ method:'GET', url:`${SUPA_URL}/rest/v1/social_accounts?select=workspace_id`, headers:sHeaders, json:true });
    workspaceIds = [...new Set((existing || []).map(r => r.workspace_id).filter(Boolean))];
  }

  let accountsSynced = 0;
  for (const wsId of workspaceIds){
    for (const a of accounts){
      try {
        await req({ method:'POST', url:`${SUPA_URL}/rest/v1/social_accounts?on_conflict=workspace_id,zernio_account_id`,
          headers:{ ...sHeaders, Prefer:'resolution=merge-duplicates,return=minimal' },
          body:{ workspace_id: wsId, zernio_account_id: a._id, platform: a.platform,
                 username: a.username || '', display_name: a.displayName || '',
                 profile_picture: a.profilePicture || '', profile_url: a.profileUrl || '',
                 is_active: a.isActive !== false, needs_reconnection: a.needsReconnection === true,
                 followers_count: a.followersCount || 0, last_synced_at: new Date().toISOString(),
                 updated_at: new Date().toISOString() },
          json:true });
        accountsSynced++;
      } catch (e) { /* one bad account row must not abort the whole sync */ }
    }
  }

  // ══ 2) analytics ═════════════════════════════════════════════════════
  if (!hasAnalyticsAccess){
    return [{ json: { ok: true, accounts: accounts.length, accounts_synced: accountsSynced,
                      analytics_skipped: 'Zernio analytics add-on not enabled on this plan.',
                      posts_checked: 0, rows_written: 0 } }];
  }

  // Every post we actually pushed through Zernio, across all three tables.
  const targets = [];
  for (const table of POST_TABLES){
    try {
      const rows = await req({ method:'GET',
        url:`${SUPA_URL}/rest/v1/${table}?select=id,workspace_id,zernio_post_id,zernio_account_id,publish_status&zernio_post_id=neq.&publish_status=in.(published,scheduled,publishing)${wsFilter}&limit=500`,
        headers:sHeaders, json:true });
      for (const r of (rows || [])){
        if (r.zernio_post_id) targets.push({ ...r, post_table: table });
      }
    } catch (e) { /* a missing table (generated_posts on older DBs) is fine */ }
  }

  let rowsWritten = 0;
  const errors = [];

  for (const t of targets){
    try {
      // Primary: the real per-day timeline.
      let wrote = false;
      try {
        const tl = await req({ method:'GET',
          url:`${ZBASE}/analytics/post-timeline?postId=${encodeURIComponent(t.zernio_post_id)}`,
          headers:zHeaders, json:true });
        for (const day of ((tl && tl.timeline) || [])){
          const present = METRIC_KEYS.filter(k => day[k] !== undefined && day[k] !== null);
          await req({ method:'POST', url:`${SUPA_URL}/rest/v1/post_analytics?on_conflict=zernio_post_id,platform,metric_date`,
            headers:{ ...sHeaders, Prefer:'resolution=merge-duplicates,return=minimal' },
            body:{ workspace_id: t.workspace_id, zernio_post_id: t.zernio_post_id,
                   platform: day.platform || '', platform_post_id: day.platformPostId || '',
                   post_table: t.post_table, post_id: t.id,
                   // Carried from the post row — the timeline payload has no
                   // accountId, so this is the only way to attribute metrics
                   // when several accounts share a platform.
                   zernio_account_id: t.zernio_account_id || '',
                   metric_date: String(day.date || '').slice(0, 10) || today(),
                   impressions: day.impressions || 0, reach: day.reach || 0, likes: day.likes || 0,
                   comments: day.comments || 0, shares: day.shares || 0, saves: day.saves || 0,
                   clicks: day.clicks || 0, views: day.views || 0,
                   metrics_present: present, synced_at: new Date().toISOString() },
            json:true });
          rowsWritten++; wrote = true;
        }
      } catch (e) { /* fall through to totals */ }

      // Fallback: too new for a timeline — store current totals as today.
      if (!wrote){
        const single = await req({ method:'GET',
          url:`${ZBASE}/analytics?postId=${encodeURIComponent(t.zernio_post_id)}`,
          headers:zHeaders, json:true });
        const perPlatform = (single && single.platformAnalytics) || [];
        // Prefer the per-platform breakdown; fall back to the roll-up when
        // Zernio hasn't split it out yet.
        // Unlike the timeline, the single-post response DOES carry accountId
        // per platform — prefer it, and fall back to the one recorded at
        // publish time.
        const entries = perPlatform.length
          ? perPlatform.map(p => ({ platform: p.platform, platformPostId: p.platformPostId, accountId: p.accountId, a: p.analytics || {} }))
          : [{ platform: single.platform || '', platformPostId: '', accountId: '', a: (single && single.analytics) || {} }];
        for (const e of entries){
          if (!e.a || !Object.keys(e.a).length) continue;
          const present = METRIC_KEYS.filter(k => e.a[k] !== undefined && e.a[k] !== null);
          await req({ method:'POST', url:`${SUPA_URL}/rest/v1/post_analytics?on_conflict=zernio_post_id,platform,metric_date`,
            headers:{ ...sHeaders, Prefer:'resolution=merge-duplicates,return=minimal' },
            body:{ workspace_id: t.workspace_id, zernio_post_id: t.zernio_post_id,
                   platform: e.platform || '', platform_post_id: e.platformPostId || '',
                   post_table: t.post_table, post_id: t.id,
                   zernio_account_id: e.accountId || t.zernio_account_id || '',
                   metric_date: today(),
                   impressions: e.a.impressions || 0, reach: e.a.reach || 0, likes: e.a.likes || 0,
                   comments: e.a.comments || 0, shares: e.a.shares || 0, saves: e.a.saves || 0,
                   clicks: e.a.clicks || 0, views: e.a.views || 0,
                   metrics_present: present, synced_at: new Date().toISOString() },
            json:true });
          rowsWritten++;
        }

        // Zernio knows the real publish state; if a scheduled post has since
        // gone live, reflect that on our row so the UI stops calling it
        // "scheduled" forever.
        const zStatus = String((single && single.status) || '').toLowerCase();
        if (zStatus === 'published' && t.publish_status !== 'published'){
          try {
            await req({ method:'PATCH', url:`${SUPA_URL}/rest/v1/${t.post_table}?id=eq.${t.id}`,
              headers:{ ...sHeaders, Prefer:'return=minimal' },
              body:{ publish_status:'published',
                     published_at: single.publishedAt || new Date().toISOString(),
                     platform_post_url: single.platformPostUrl || '' }, json:true });
          } catch (e) { /* non-fatal */ }
        }
      }
    } catch (e) {
      errors.push({ zernio_post_id: t.zernio_post_id, error: (e && e.message) || String(e) });
    }
  }

  return [{ json: { ok: true, accounts: accounts.length, accounts_synced: accountsSynced,
                    posts_checked: targets.length, rows_written: rowsWritten,
                    errors: errors.slice(0, 10) } }];
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}
"""

ZERNIO_DASHBOARD_STICKY = r"""## Arak – Zernio Dashboard (live proxy)

**Zero secrets in this file.** Needs `ZERNIO_API_KEY`.

On-demand only — no schedule, no writes to Supabase. Zernio already computes these aggregates server-side (best time to post, posting-frequency vs engagement, content-decay curve, daily rollups, follower history); re-deriving them from our own `post_analytics` rows would mean re-implementing Zernio's own stats engine for no benefit. So this just fans out to six of their endpoints in parallel and hands the combined JSON straight to the frontend for one page load — nothing here is meant to be stored, only displayed.

A failure in any ONE branch (e.g. an add-on not enabled) is caught individually and reported as `{_error}` on that key rather than failing the whole response — the dashboard should render what it can, not go blank because one widget's source 402'd."""

ZERNIO_DASHBOARD_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 400))
            : (typeof b === 'string' && b) ? b.slice(0, 400)
            : `HTTP ${status}`;
  throw new Error(`Zernio ${status}: ${msg}`);
}

function qs(params){
  const parts = [];
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') parts.push(`${k}=${encodeURIComponent(v)}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}

const body = ($input.first().json.body) || {};
const ZERNIO = $env.ZERNIO_API_KEY;
const ZBASE  = 'https://zernio.com/api/v1';
const zHeaders = { Authorization: `Bearer ${ZERNIO}`, 'Content-Type': 'application/json' };

const platform  = body.platform || '';
const accountId = body.account_id || '';
const days = Number(body.days) || 30;
const toDate   = new Date().toISOString().slice(0, 10);
const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

try {
  if (!ZERNIO) throw new Error('ZERNIO_API_KEY is not set on this n8n instance.');

  const safe = p => p.catch(e => ({ _error: (e && e.message) ? e.message : String(e) }));

  const [overview, bestTime, frequency, decay, daily, followers] = await Promise.all([
    safe(req({ method:'GET', url:`${ZBASE}/analytics${qs({ platform, accountId, fromDate, toDate, limit:100, source:'all' })}`, headers:zHeaders, json:true })),
    safe(req({ method:'GET', url:`${ZBASE}/analytics/best-time${qs({ platform, accountId })}`, headers:zHeaders, json:true })),
    safe(req({ method:'GET', url:`${ZBASE}/analytics/posting-frequency${qs({ platform, accountId })}`, headers:zHeaders, json:true })),
    safe(req({ method:'GET', url:`${ZBASE}/analytics/content-decay${qs({ platform, accountId })}`, headers:zHeaders, json:true })),
    safe(req({ method:'GET', url:`${ZBASE}/analytics/daily-metrics${qs({ platform, accountId, fromDate, toDate })}`, headers:zHeaders, json:true })),
    safe(req({ method:'GET', url:`${ZBASE}/accounts/follower-stats${qs({ accountIds: accountId, fromDate, toDate })}`, headers:zHeaders, json:true })),
  ]);

  return [{ json: { ok: true, fromDate, toDate, platform, overview, bestTime, frequency, decay, daily, followers } }];
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}
"""

CAMPAIGN_PLANNER_STICKY = r"""## Arak Campaign Planner

**Zero secrets in this file.** Only needs `ANTHROPIC_API_KEY`.

Turns a stated goal + date range into a full slate of dated, platform-specific post ideas — Ramadan/Eid/National Day awareness, posting-day/time cadence enforcement, cross-month anti-repetition (recurring series vs one-off history), target content-mix steering, featured-product coverage. Returns ideas only — never writes to Supabase itself; the app inserts them into plan_ideas after this responds.

Model: Opus 5 with adaptive thinking — this is the one call in the whole pipeline that genuinely needs the extra reasoning (whole-month coherence, holiday judgment), unlike per-post Sonnet calls. Priced the same as the Opus 4.8 it replaces, so staying on Opus here costs nothing. `max_tokens` is 32000, not 16000: it budgets thinking and response text together, and a truncated plan surfaces as a JSON parse error rather than an obviously-short plan."""

BUILD_PROMPT_JS = _with_brand(r"""const input = $input.first().json.body;

const goal         = input.goal || '';
const goalCategory = input.goal_category || '';
const platforms    = input.platforms || ['instagram'];
const startDate    = input.start_date || '';
const endDate      = input.end_date || '';
const approxCount  = input.approx_post_count || null;
const instructions = input.instructions || '';
const includeHolidays = input.include_holidays !== false;
const featuredProducts = Array.isArray(input.featured_products) ? input.featured_products : [];
const seedPosts     = Array.isArray(input.seed_posts) ? input.seed_posts : [];
const existingIdeas = Array.isArray(input.existing_ideas) ? input.existing_ideas : [];
const pastIdeas     = Array.isArray(input.past_ideas) ? input.past_ideas : [];
const postingDays   = Array.isArray(input.posting_days) ? input.posting_days : [];
const contentMixTarget = input.content_mix_target || '';
const defaultTime   = input.posting_time || '19:00';

const countLine = approxCount
  ? `Plan for approximately ${approxCount} posts total across the date range.`
  : `No specific post count was given — decide a sensible number yourself. A reasonable default is 2-4 posts per week per platform across the date range.`;

const DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const cadenceSection = postingDays.length
  ? `\nPOSTING DAYS: This brand only posts on: ${postingDays.map(d => DAY_NAMES[d] || d).join(', ')}. EVERY post's "date" MUST fall on one of these weekdays — no exceptions.\n`
  : `\nPOSTING DAYS: No fixed posting days were given — spread posts sensibly across the week yourself.\n`;

const timeSection = `\nPOSTING TIME: Use "${defaultTime}" (KSA time, 24h HH:MM) as the default "time" unless a specific post genuinely calls for something else. Every post needs its own "time" value (HH:MM, 24h).\n`;

const KSA_HOLIDAYS = [
  { name: 'Saudi Founding Day', start: '2026-02-22', end: '2026-02-22', tentative: false },
  { name: 'Ramadan',           start: '2026-02-18', end: '2026-03-18', tentative: true },
  { name: 'Eid al-Fitr',        start: '2026-03-19', end: '2026-03-23', tentative: true },
  { name: 'Day of Arafat',      start: '2026-05-26', end: '2026-05-26', tentative: true },
  { name: 'Eid al-Adha',        start: '2026-05-27', end: '2026-05-30', tentative: true },
  { name: 'Saudi National Day', start: '2026-09-23', end: '2026-09-23', tentative: false },
  { name: 'Saudi Founding Day', start: '2027-02-22', end: '2027-02-22', tentative: false },
  { name: 'Ramadan',           start: '2027-02-07', end: '2027-03-06', tentative: true },
  { name: 'Eid al-Fitr',        start: '2027-03-07', end: '2027-03-11', tentative: true },
  { name: 'Saudi National Day', start: '2027-09-23', end: '2027-09-23', tentative: false },
];

function overlaps(hStart, hEnd, rangeStart, rangeEnd) {
  if (!rangeStart || !rangeEnd) return false;
  return hStart <= rangeEnd && hEnd >= rangeStart;
}

const relevantHolidays = includeHolidays
  ? KSA_HOLIDAYS.filter(h => overlaps(h.start, h.end, startDate, endDate))
  : [];

// Ramadan needs its own timing note (not just the generic holiday-relevance
// advice below) -- engagement patterns flip during the fasting month, and a
// month-long occasion needs different guidance than a single-day holiday.
const ramadanInRange = relevantHolidays.some(h => h.name === 'Ramadan');
const ramadanTimeNote = ramadanInRange
  ? `\nRAMADAN NOTE: Part of this date range falls during Ramadan. Shift Instagram posting times to post-iftar evening (21:00-23:00 KSA time) for posts landing in that window instead of the usual default -- engagement peaks after iftar, not in the afternoon. Favor warmer, more reflective, community-oriented content during Ramadan itself; ease off hard sales pushes until Eid.\n`
  : '';

const holidaySection = !includeHolidays
  ? ''
  : relevantHolidays.length
    ? `\nPUBLIC HOLIDAYS IN THIS DATE RANGE (Saudi Arabia):\n${relevantHolidays.map(h => `- ${h.name}: ${h.start === h.end ? h.start : `${h.start} to ${h.end}`}${h.tentative ? ' (tentative — exact date depends on moon sighting, treat as approximate)' : ''}`).join('\n')}\nFor any post landing on or right next to one of these, either make it genuinely relevant to the occasion (a greeting, a culturally appropriate angle) or deliberately schedule something lighter than a hard sales push that day — use judgment, don't force a holiday tie-in that feels forced. For the tentative Islamic-calendar dates, treat the date as approximate by a day or two.\n`
    : `\nNo Saudi Arabia public holidays fall within this date range — plan normally.\n`;

// ── Featured products: emphasize these, spread coverage across them ──
const featuredProductsSection = featuredProducts.length
  ? `\nFEATURE THESE PRODUCTS THIS MONTH:\n${featuredProducts.map(p => `- ${p.name}${p.category ? ` (${p.category})` : ''}${p.specs ? ` — ${p.specs}` : ''}${p.description ? `: ${p.description}` : ''}`).join('\n')}\nSpread coverage across ALL of these instead of only picking whichever is easiest to write about — give each one at least one dedicated post if the post count allows it. You may still cover other products/topics too; this list is a required minimum, not the whole plan.\n`
  : '';

// ── Seed posts: specific posts the user already locked in — build around
// them, do NOT propose new ideas that duplicate them. ──
const seedPostsSection = seedPosts.length
  ? `\nPOSTS ALREADY PLANNED BY THE USER (do NOT propose these again — they already exist and will be added to the plan separately; build the rest of the month coherently around them, complementing their timing/topic rather than colliding with it):\n${seedPosts.map(s => `- [${s.platform}, ${s.format}] ${s.text}`).join('\n')}\n`
  : '';

// ── Existing ideas already in the plan (top-up / "generate more" flow) —
// avoid proposing topic+angle combinations that repeat these. ──
const existingIdeasSection = existingIdeas.length
  ? `\nIDEAS ALREADY IN THIS PLAN (do not repeat these topics/angles — propose genuinely different ones):\n${existingIdeas.map(e => `- [${e.platform}${e.date ? ', ' + e.date : ''}] ${e.topic}${e.pillar ? ` (${e.pillar})` : ''}`).join('\n')}\n`
  : '';

// ── Cross-month anti-repetition memory: ideas from OTHER plans (previous
// months), same workspace. Split into ongoing recurring series (continue
// these -- a deliberate weekly/monthly repeat format is good, not a
// repetition problem) vs one-off ideas (avoid repeating their angle). --
// A rejected idea and a published one are opposite signals, and until now
// both arrived here in the same "already covered, don't repeat" list — so
// the only memory the planner had was actively teaching it that a rejected
// idea was a done idea. They are now three separate buckets.
const pastSeriesNames = [...new Set(pastIdeas.filter(p => p.series).map(p => p.series))];
const pastOneOffs = pastIdeas.filter(p => !p.series);
const fmtIdea = p => `  - [${p.platform}] ${p.topic}${p.angle ? ' — ' + p.angle : ''}${p.content_pillar ? ` (${p.content_pillar})` : ''}`;

const covered  = pastOneOffs.filter(p => p.status !== 'rejected').slice(0, 45);
const rejected = pastOneOffs.filter(p => p.status === 'rejected').slice(0, 25);

// Reject reasons are a fixed four-value taxonomy in the review UI, so they
// can be grouped into a real instruction rather than replayed one by one.
const REJECT_LABELS = {
  off_brand:    'off-brand — wrong voice, tone or values for this company',
  repetitive:   'too repetitive — too close to something already done',
  wrong_product:'wrong product or service focus',
  weak:         'a weak idea — not interesting or useful enough to post',
};
const rejectGroups = {};
for (const p of rejected) {
  const key = p.reject_reason || 'unspecified';
  (rejectGroups[key] = rejectGroups[key] || []).push(p);
}

const pastIdeasSection = (pastSeriesNames.length || covered.length || rejected.length)
  ? `\nPREVIOUS MONTHS' CONTENT (this company's history -- read before proposing new ideas):\n` +
    (pastSeriesNames.length ? `- Ongoing recurring series already running: ${pastSeriesNames.join(', ')}. If one fits naturally this month too, continue it on its usual cadence and set "series" to its name -- a deliberate repeat format is good, not a repetition problem.\n` : '') +
    (covered.length ? `- ALREADY COVERED (approved or published in past months -- do NOT repeat these angles; propose genuinely new ones even if the topic area is similar):\n${covered.map(fmtIdea).join('\n')}\n` : '') +
    (rejected.length ? `- TURNED DOWN BY THIS BRAND'S REVIEWERS. These are not "already covered" -- they were judged wrong for the brand. Do not propose ideas of this SHAPE again:\n` +
      Object.entries(rejectGroups).map(([reason, items]) =>
        `  Rejected as ${REJECT_LABELS[reason] || reason}:\n${items.map(fmtIdea).join('\n')}`
      ).join('\n') + '\n' : '')
  : '';

// ── Variety guard ─────────────────────────────────────────────────────────
// The direct fix for "it keeps suggesting the same kind of idea". Counting
// what has actually been proposed before and handing back the distribution
// is far more effective than asking for "variety" in the abstract, because
// the model can see which pillars are already saturated.
function distributionOf(field){
  const counts = {};
  for (const p of pastIdeas) {
    const v = String(p[field] || '').trim();
    if (v) counts[v] = (counts[v] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}
const pillarDist   = distributionOf('content_pillar').slice(0, 12);
const occasionDist = distributionOf('occasion').slice(0, 10);
const totalPast    = pastIdeas.length;
const varietySection = totalPast >= 5 && pillarDist.length
  ? `\nWHAT THIS BRAND HAS LEANED ON SO FAR (${totalPast} past ideas):\n` +
    `Content pillars used: ${pillarDist.map(([k, n]) => `${k} ×${n}`).join(', ')}\n` +
    (occasionDist.length ? `Occasions used: ${occasionDist.map(([k, n]) => `${k} ×${n}`).join(', ')}\n` : '') +
    `Deliberately rebalance AWAY from the most-used pillars above. If a pillar already accounts for a large share of past ideas, it should be a small share of this plan -- reach for the brand's under-used pillars and formats instead. Do not simply produce more of what dominates that list.\n`
  : '';

// -- Target content mix: a freeform ratio the human wants (e.g. "40% product,
// 20% educational, 20% trust, 20% engagement") -- a soft aim, not a hard rule,
// since content_pillar is freeform text and can't be numerically enforced. --
const contentMixSection = contentMixTarget
  ? `\nTARGET CONTENT MIX: The user wants roughly this content-pillar ratio across the month: "${contentMixTarget}". Aim for it when choosing each post's content_pillar and spacing them through the month -- don't force it at the expense of a genuinely good idea, but treat it as the intended shape of the plan, not a suggestion to ignore.\n`
  : '';

// ── CACHED prefix: brand context + the full static rulebook. Identical on
// every call for this company regardless of which specific plan/goal/date
// range is being requested — so a "Generate more" a few minutes after the
// original "Generate" (same company) reads this block at ~10% of its normal
// cost instead of resending it fresh. ──
const promptCached = `You are a social media campaign planner for ${brandPersona(input)}.

${instructions ? `BRAND CONTEXT:\n${instructions}` : 'No brand profile has been filled in yet — keep the plan professional and make no claims about the company.'}

${__PROMPT_RULES__}

You will be given a specific goal, date range, platform list, and any constraints for ONE planning request. Decompose it into a list of individual post ideas, spread across the date range and platforms — do not put everything on day one, and vary the topic/angle so the campaign doesn't feel repetitive.

IMPORTANT: For each Saudi seasonal/cultural moment that falls in the given date range, create at least one dedicated post tied to it and set its "occasion" accordingly. Vary the "content_pillar" across the month so it isn't all product pushes — mix the content pillars this brand actually uses (see the brand context above for its own recurring formats and pillars), its service or product range, educational content, brand story, and the seasonal moments.

Each post needs:
- "platform": always exactly "instagram"
- "date": a date in YYYY-MM-DD format, within the given date range inclusive, and matching the posting-days constraint if one was given
- "time": a time in HH:MM 24h format (KSA time), per the posting-time guidance given
- "topic": a specific, concrete topic for that post
- "angle": an optional specific angle or hook for the topic
- "title": a short, punchy 3-7 word title for the idea (shown in the plan list)
- "occasion": if this post ties to a seasonal/cultural moment in range (Ramadan, Eid al-Fitr, Eid al-Adha, Saudi Founding Day, Saudi National Day), name it (e.g. "Ramadan", "National Day"); otherwise ""
- "content_pillar": the theme it serves — pick ONE: "Project showcase", "Product highlight", "Educational", "Seasonal", "Brand story", "Behind the scenes", "Industry insight"
- "rationale": one short sentence on WHY this idea is worth posting, so the reviewer can approve or reject it on merit
- "objective": what this specific post is FOR — pick ONE: "Awareness", "Engagement", "Sales/Leads", "Trust/Credibility", "Community"
- "cta": a short, specific call-to-action matching the objective and platform — e.g. "DM us for a quote", "Save this for your next project", "Tag someone planning a renovation", "Visit our showroom this weekend", "Share your thoughts in the comments". Never generic filler like "Learn more" — make it concrete to this post.
- "suggested_format": pick ONE — "post", "carousel", or "reel" (step-by-step/list -> carousel; motion/showcase -> reel; single strong visual -> post)
- "tone": pick ONE — professional, inspirational, educational, casual, promotional
- "suggested_style": how this specific post should actually look — pick ONE — photorealistic, dramatic, minimalist, warm_residential, cool_commercial, facade_exterior
  Base this on the topic and angle, not just the tone — e.g. a comparison/breakdown topic should usually be minimalist, a before/after topic should usually be dramatic, an exterior/landscape topic should usually be facade_exterior.
- "suggested_aspect_ratio": pick ONE — 1:1, 4:5, 1.91:1
- "series": a short recurring-series name if this post is a deliberate weekly/monthly repeat format (e.g. "Tip Tuesday"), or "" if it's a one-off. Check the previous-months history below before inventing a new series name -- continue an existing one if it fits.
- "design_tip": a real creative-direction note (2-4 full sentences) on how to actually design this post's visual — written the way you'd genuinely brief a photographer or designer, not a generic platitude. Cover the mood/lighting, the framing or composition, and what should be in or out of frame. This is the ONLY place visual guidance shows up to the user, so it needs to stand on its own without a separate style label next to it.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "campaignName": "short descriptive campaign name",
  "posts": [
    { "platform": "instagram", "date": "YYYY-MM-DD", "time": "HH:MM", "title": "...", "topic": "...", "angle": "...", "occasion": "", "content_pillar": "...", "rationale": "...", "objective": "...", "cta": "...", "suggested_format": "post", "tone": "...", "suggested_style": "...", "suggested_aspect_ratio": "...", "design_tip": "...", "series": "" }
  ]
}`;

// ── UNCACHED suffix: this specific request's parameters. ──
const promptVariable = `GOAL: ${goal}
${goalCategory ? `GOAL CATEGORY: ${goalCategory}` : ''}
PLATFORMS: ${platforms.join(', ')}
DATE RANGE: ${startDate} to ${endDate}
${countLine}
${cadenceSection}${timeSection}${ramadanTimeNote}${holidaySection}
${featuredProductsSection}${seedPostsSection}${existingIdeasSection}${contentMixSection}${pastIdeasSection}${varietySection}
Now produce the plan for the request above, following all the rules already given.`;

return [{
  json: {
    prompt_cached: promptCached,
    prompt_variable: promptVariable,
    _start_date: startDate,
    _end_date: endDate,
    _platforms: platforms,
    _posting_days: postingDays,
    _default_time: defaultTime,
  }
}];""")

PARSE_VALIDATE_PLAN_JS = r"""const response = $input.first().json;
const bounds   = $('Build Prompt').first().json;

let text = '';
if (response.content && Array.isArray(response.content)) {
  const textBlock = response.content.find(b => b.type === 'text');
  text = textBlock ? textBlock.text : '';
} else {
  text = response.completion || response.text || '';
}

text = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');

let parsed;
try {
  parsed = JSON.parse(text);
} catch (e) {
  throw new Error('Could not parse plan JSON from Claude response: ' + text.slice(0, 300));
}

const startDate = bounds._start_date;
const endDate   = bounds._end_date;
const allowedPlatforms = bounds._platforms || ['instagram'];
const postingDays = bounds._posting_days || []; // e.g. ['sun','tue','thu'] — [] means no constraint
const defaultTime = bounds._default_time || '19:00';

const igTones = ['professional', 'inspirational', 'educational', 'casual', 'promotional'];

const igStyles = ['photorealistic', 'dramatic', 'minimalist', 'warm_residential', 'cool_commercial', 'facade_exterior'];

const igAspects = ['1:1', '4:5', '1.91:1'];

const OBJECTIVES = ['Awareness', 'Engagement', 'Sales/Leads', 'Trust/Credibility', 'Community'];

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']; // JS getDay() order
function dayKeyOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return DAY_KEYS[new Date(y, m - 1, d).getDay()];
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
// If posting_days was constrained, snap any date the model got wrong onto the
// nearest allowed weekday — a hard guarantee, not just a prompt instruction.
function enforcePostingDay(dateStr) {
  if (!postingDays.length || !dateStr) return dateStr;
  if (postingDays.includes(dayKeyOf(dateStr))) return dateStr;
  for (let step = 1; step <= 7; step++) {
    const fwd = addDays(dateStr, step);
    if (fwd <= endDate && postingDays.includes(dayKeyOf(fwd))) return fwd;
    const back = addDays(dateStr, -step);
    if (back >= startDate && postingDays.includes(dayKeyOf(back))) return back;
  }
  return dateStr; // no allowed day exists in range — leave as-is rather than lose the post
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function validTime(t, fallback) {
  return typeof t === 'string' && TIME_RE.test(t) ? t : fallback;
}

const posts = (parsed.posts || [])
  .filter(p => p && p.platform && p.date && p.topic)
  .filter(p => allowedPlatforms.includes(p.platform))
  .map(p => {
    const platform = 'instagram';
    let date = p.date;
    if (date < startDate) date = startDate;
    if (date > endDate) date = endDate;
    date = enforcePostingDay(date);

    const fallbackTime = defaultTime;
    const time = validTime(p.time, fallbackTime);

    const tone = igTones.includes(p.tone) ? p.tone : 'professional';

    const suggestedStyle = igStyles.includes(p.suggested_style) ? p.suggested_style : 'photorealistic';

    const suggestedAspectRatio = igAspects.includes(p.suggested_aspect_ratio) ? p.suggested_aspect_ratio : '1:1';

    const objective = OBJECTIVES.includes(p.objective) ? p.objective : 'Awareness';

    return {
      platform,
      date,
      time,
      topic: String(p.topic).slice(0, 300),
      angle: p.angle ? String(p.angle).slice(0, 300) : '',
      tone,
      suggested_style: suggestedStyle,
      suggested_aspect_ratio: suggestedAspectRatio,
      design_tip: p.design_tip ? String(p.design_tip).slice(0, 500) : '',
      title: p.title ? String(p.title).slice(0, 120) : String(p.topic).slice(0, 120),
      occasion: p.occasion ? String(p.occasion).slice(0, 60) : '',
      content_pillar: p.content_pillar ? String(p.content_pillar).slice(0, 60) : '',
      rationale: p.rationale ? String(p.rationale).slice(0, 300) : '',
      objective,
      cta: p.cta ? String(p.cta).slice(0, 140) : '',
      suggested_format: ['post','carousel','reel'].includes(p.suggested_format) ? p.suggested_format : 'post',
      series: p.series ? String(p.series).slice(0, 60) : '',
    };
  });

return [{
  json: {
    campaignName: parsed.campaignName || '',
    posts,
  }
}];"""

# ============================================================
# Node-graph builders
# ============================================================
def _sticky(content: str, height: int, width: int, x: int, y: int, name: str = "Note: Overview") -> dict:
    return {
        "parameters": {"content": content, "height": height, "width": width},
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.stickyNote",
        "typeVersion": 1,
        "position": [x, y],
    }


def _webhook(path: str, response_mode: str, x: int, y: int) -> dict:
    return {
        "parameters": {"httpMethod": "POST", "path": path, "responseMode": response_mode, "options": {}},
        "id": nid(),
        "name": "Webhook",
        "type": "n8n-nodes-base.webhook",
        "typeVersion": 2,
        "position": [x, y],
        "webhookId": path,
    }


def _code(name: str, js: str, x: int, y: int, run_once_for_each_item: bool = False) -> dict:
    params = {"jsCode": js}
    if run_once_for_each_item:
        params = {"mode": "runOnceForEachItem", "jsCode": js}
    return {
        "parameters": params,
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.code",
        "typeVersion": 2,
        "position": [x, y],
    }


# The Vercel proxy (api/n8n/[slot].js) has sent x-webhook-secret since the
# proxy was built, but it was "harmless until the workflows check it" — no
# workflow ever did. Reaching a workflow directly (bypassing the proxy's own
# sign-in check) needs nothing but the current tunnel hostname and a webhook
# path, both of which are just strings a determined caller can find, and every
# workflow past this point spends real money on fal/Replicate/Anthropic.
#
# Enforced only when N8N_WEBHOOK_SECRET is set in n8n's own environment —
# unset, this node is a no-op, so it's safe to ship before anyone has
# configured the secret on both sides (n8n's .env and Vercel's project env).
# Throwing (rather than branching to an explicit 401 response) works
# uniformly across every responseMode used in this file: an unhandled Code
# node error stops the workflow before any downstream node runs, no matter
# which responseMode the workflow uses. What the CALLER sees varies by mode,
# confirmed live 2026-08-17 against arak-fal-balance (responseMode=responseNode):
# a rejected call gets HTTP 200 with an EMPTY body, not a 401/500 — n8n does
# not auto-generate an error response when the workflow dies before its
# Respond node runs. The security property (no downstream/paid node executes)
# holds regardless; only the rejection's shape on the wire is unpolished. A
# caller has to notice "200 but no data" rather than a clean rejected status.
_WEBHOOK_GUARD_JS = """
const expected = String($env.N8N_WEBHOOK_SECRET || '').trim();
if (expected) {
  const headers = ($input.first().json || {}).headers || {};
  const got = String(headers['x-webhook-secret'] || headers['X-Webhook-Secret'] || '').trim();
  if (got !== expected) {
    throw new Error('Unauthorized: missing or invalid webhook secret');
  }
}
return $input.all();
""".strip()


def _inject_webhook_guard(wf: dict) -> dict:
    """Splice a secret-check Code node between every node named "Webhook" and
    whatever it used to connect to. Generic over all workflows in this file
    rather than threaded through each build_* function, because two of them
    (Instagram Reels, Instagram Manual Generation) embed their whole node
    graph as ported JSON rather than building it through these helpers — this
    runs after that JSON is parsed into the same dict shape as everything
    else, so one pass covers both styles.

    Connections are keyed by node NAME (see _assign_deterministic_ids), so
    inserting a node and repointing one connection entry is enough; nothing
    else in the graph needs to change."""
    nodes = wf.get("nodes", [])
    connections = wf.get("connections", {})
    webhook = next((n for n in nodes if n.get("name") == "Webhook"), None)
    if webhook is None:
        return wf
    wx, wy = webhook["position"]
    guard = _code("Webhook Secret Guard", _WEBHOOK_GUARD_JS, x=wx + 130, y=wy)
    nodes.insert(nodes.index(webhook) + 1, guard)
    original = connections.get("Webhook")
    connections["Webhook"] = {"main": [[{"node": guard["name"], "type": "main", "index": 0}]]}
    if original:
        connections[guard["name"]] = original
    return wf


def _respond_json(name: str, response_body_expr: str, x: int, y: int) -> dict:
    return {
        "parameters": {"respondWith": "json", "responseBody": response_body_expr, "options": {}},
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.respondToWebhook",
        "typeVersion": 1,
        "position": [x, y],
    }


def _if_bool_equals(name: str, condition_id: str, left_expr: str, x: int, y: int) -> dict:
    return {
        "parameters": {
            "conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict", "version": 1},
                "conditions": [
                    {
                        "id": condition_id,
                        "leftValue": left_expr,
                        "rightValue": True,
                        "operator": {"type": "boolean", "operation": "equals"},
                    }
                ],
                "combinator": "and",
            },
            "options": {},
        },
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.if",
        "typeVersion": 2,
        "position": [x, y],
    }








def _http_video_storage_upload(x: int, y: int) -> dict:
    return {
        "parameters": {
            "method": "POST",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/{{ $json.bucket }}/{{ $json.filename }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": "video/mp4"},
                    {"name": "x-upsert", "value": "true"},
                ]
            },
            "sendBody": True,
            "contentType": "binaryData",
            "inputDataFieldName": "data",
            "options": {},
        },
        "id": nid(),
        "name": "Upload Video to Supabase Storage",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_save_video_url(x: int, y: int) -> dict:
    """PATCH the right platform's *_generated_posts row (matched by
    plan_idea_id) with the now-permanent video_url. References the
    Video Render node directly (not this node's own input) — same reason
    Aggregate Uploaded Images reads Split Pending Uploads directly: an
    HTTP node's own passthrough of upstream $json isn't reliable to lean on."""
    table_expr = "'instagram_generated_posts'"
    return {
        "parameters": {
            "method": "PATCH",
            "url": f"={{{{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}}}/rest/v1/{{{{ {table_expr} }}}}?plan_idea_id=eq.{{{{ $('Video: Render').item.json.plan_idea_id }}}}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": "application/json"},
                    {"name": "Prefer", "value": "return=minimal"},
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": (
                "={{ JSON.stringify({ video_url: String($env.SUPABASE_URL).replace(/\\/+$/, '') "
                "+ '/storage/v1/object/public/' + $('Video: Render').item.json.bucket + '/' "
                "+ $('Video: Render').item.json.filename }) }}"
            ),
            "options": {},
        },
        "id": nid(),
        "name": "Supabase: Save Video URL",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_save_draft(x: int, y: int) -> dict:
    """PATCH plan_ideas with the drafted options on success, or draft_status
    'failed' + draft_error on failure — one node, branching on _ok so a
    failed draft still lands a real, visible status instead of leaving the
    board's spinner stuck forever."""
    body_expr = (
        "={{ JSON.stringify($json._ok "
        "? { draft_status: 'ready', draft_error: '', "
        "caption_options: $json.caption_options, media_prompt_options: $json.media_prompt_options } "
        ": { draft_status: 'failed', draft_error: $json.error }) }}"
    )
    return {
        "parameters": {
            "method": "PATCH",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/rest/v1/plan_ideas?id=eq.{{ $json.plan_idea_id }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": "application/json"},
                    {"name": "Prefer", "value": "return=minimal"},
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": body_expr,
            "options": {},
        },
        "id": nid(),
        "name": "Supabase: Save Draft",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }












def build_caption_studio() -> dict:
    """
    Webhook (responseMode=lastNode) -> Caption Studio (single Code node, its
    return value IS the HTTP response — no separate respondToWebhook node).
    """
    nodes = [
        _sticky(CAPTION_STUDIO_STICKY, height=300, width=400, x=0, y=-120),
        _webhook("arak-caption-studio", "lastNode", x=0, y=200),
        _code("Caption Studio", CAPTION_STUDIO_JS, x=220, y=200),
    ]
    connections = {"Webhook": {"main": [[{"node": "Caption Studio", "type": "main", "index": 0}]]}}
    return {
        "name": "Arak Lighting – Caption Studio",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_elongate_idea() -> dict:
    """
    Webhook (responseMode=lastNode) -> Elongate Idea (single Code node).
    Synchronous: one Claude call, no image generation, no Supabase writes —
    the browser already holds the user's own access token and applies the
    DB patch itself.
    """
    nodes = [
        _sticky(ELONGATE_IDEA_STICKY, height=260, width=380, x=0, y=-80),
        _webhook("arak-elongate-idea", "lastNode", x=0, y=200),
        _code("Elongate Idea", ELONGATE_IDEA_JS, x=220, y=200),
    ]
    connections = {"Webhook": {"main": [[{"node": "Elongate Idea", "type": "main", "index": 0}]]}}
    return {
        "name": "Arak Lighting – Elongate Idea",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_draft_copy() -> dict:
    """
    Webhook (responseNode) -> Respond: Accepted -> Draft Copy (Code node,
    one idea per call) -> Supabase: Save Draft (HTTP PATCH, branches on
    _ok). Async on purpose (see DRAFT_COPY_STICKY) — the browser polls
    plan_ideas.draft_status rather than waiting on this request.
    """
    nodes = [
        _sticky(DRAFT_COPY_STICKY, height=320, width=440, x=0, y=-140),
        _webhook("arak-draft-copy", "responseNode", x=0, y=260),
        _respond_json(
            "Respond: Accepted",
            "={{ JSON.stringify({ status: 'accepted', plan_idea_id: $json.body.plan_idea_id }) }}",
            x=220,
            y=260,
        ),
        _code("Draft Copy", DRAFT_COPY_JS, x=440, y=260),
        _http_save_draft(x=660, y=260),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Respond: Accepted", "type": "main", "index": 0}]]},
        "Respond: Accepted": {"main": [[{"node": "Draft Copy", "type": "main", "index": 0}]]},
        "Draft Copy": {"main": [[{"node": "Supabase: Save Draft", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Draft Copy",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_media_options() -> dict:
    """
    Webhook (responseMode=lastNode) -> Media Options (single Code node, its
    return value IS the HTTP response). Synchronous on purpose — the
    reviewer clicked a button and is watching a loading state for it, unlike
    Draft Copy's fire-and-forget-then-poll pattern.
    """
    nodes = [
        _sticky(MEDIA_OPTIONS_STICKY, height=300, width=420, x=0, y=-120),
        _webhook("arak-media-options", "lastNode", x=0, y=200),
        _code("Media Options", MEDIA_OPTIONS_JS, x=220, y=200),
    ]
    connections = {"Webhook": {"main": [[{"node": "Media Options", "type": "main", "index": 0}]]}}
    return {
        "name": "Arak Lighting – Media Options",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_video_render() -> dict:
    """
    Webhook (responseNode) -> Respond: Accepted -> Video: Render (Code
    node, one idea per item, run_once_for_each_item) -> Rendered OK? ->
    (yes) Upload Video to Supabase Storage -> Supabase: Save Video URL
                                        (no) dead end — see sticky note
    on the known no-status-on-failure limitation.
    """
    nodes = [
        _sticky(VIDEO_RENDER_STICKY, height=340, width=460, x=0, y=-160),
        _webhook("arak-video-render", "responseNode", x=0, y=300),
        _respond_json(
            "Respond: Accepted",
            "={{ JSON.stringify({ status: 'accepted' }) }}",
            x=220,
            y=300,
        ),
        _code("Video: Render", VIDEO_RENDER_JS, x=440, y=300, run_once_for_each_item=True),
        _if_bool_equals("Rendered OK?", "video-gate-1", "={{ $json._ok === true }}", x=660, y=300),
        _http_video_storage_upload(x=880, y=220),
        _http_save_video_url(x=1100, y=220),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Respond: Accepted", "type": "main", "index": 0}]]},
        "Respond: Accepted": {"main": [[{"node": "Video: Render", "type": "main", "index": 0}]]},
        "Video: Render": {"main": [[{"node": "Rendered OK?", "type": "main", "index": 0}]]},
        "Rendered OK?": {
            "main": [
                [{"node": "Upload Video to Supabase Storage", "type": "main", "index": 0}],
                [],
            ]
        },
        "Upload Video to Supabase Storage": {"main": [[{"node": "Supabase: Save Video URL", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Video Render",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_zernio_publish() -> dict:
    """
    Webhook (responseMode=lastNode) -> Publish to Zernio (single Code node,
    its return value IS the HTTP response). Synchronous on purpose: Zernio
    accepts-and-queues so the call is fast, and the reviewer who clicked
    "Publish" should get a real result or a real error, not a spinner.
    """
    nodes = [
        _sticky(ZERNIO_PUBLISH_STICKY, height=420, width=480, x=0, y=-220),
        _webhook("arak-publish-post", "lastNode", x=0, y=220),
        _code("Publish to Zernio", ZERNIO_PUBLISH_JS, x=240, y=220),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Publish to Zernio", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Publish Post (Zernio)",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_zernio_sync() -> dict:
    """
    TWO entry points into ONE Code node:
      Schedule Trigger (daily 06:00) ─┐
      Webhook (arak-zernio-sync) ─────┴─> Zernio: Sync -> Respond

    Deliberately one workflow rather than a scheduled copy and a manual
    copy — two copies of sync logic drift, and this one is stateful enough
    (upserts, status reconciliation) that drift would be silent. The Code
    node tolerates both input shapes; see its `raw.body || {}` handling.

    The Respond node only matters on the webhook path; on the schedule path
    it's a harmless no-op terminal node (nothing is waiting on a response).
    """
    nodes = [
        _sticky(ZERNIO_SYNC_STICKY, height=440, width=500, x=0, y=-260),
        {
            "parameters": {"rule": {"interval": [{"triggerAtHour": 6}]}},
            "id": nid(),
            "name": "Daily 06:00",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.2,
            "position": [0, 140],
        },
        _webhook("arak-zernio-sync", "lastNode", x=0, y=320),
        _code("Zernio: Sync", ZERNIO_SYNC_JS, x=260, y=230),
    ]
    connections = {
        "Daily 06:00": {"main": [[{"node": "Zernio: Sync", "type": "main", "index": 0}]]},
        "Webhook": {"main": [[{"node": "Zernio: Sync", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Zernio Sync",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_zernio_dashboard() -> dict:
    """
    Webhook (responseMode=lastNode) -> Zernio: Dashboard (single Code node,
    its return value IS the HTTP response). Same synchronous shape as
    Publish Post — the frontend is waiting on this for a page render, not
    firing it and moving on.
    """
    nodes = [
        _sticky(ZERNIO_DASHBOARD_STICKY, height=360, width=480, x=0, y=-200),
        _webhook("arak-zernio-dashboard", "lastNode", x=0, y=220),
        _code("Zernio: Dashboard", ZERNIO_DASHBOARD_JS, x=240, y=220),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Zernio: Dashboard", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Zernio Dashboard",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_campaign_planner() -> dict:
    """
    Webhook (responseNode) -> Build Prompt (Code) -> Call Claude (HTTP,
    x-api-key + $env.ANTHROPIC_API_KEY — NOT n8n credential auth, to match
    every other workflow's zero-secrets-in-file / env-var-only pattern) ->
    Parse & Validate Plan (Code) -> Respond to Webhook.
    """
    nodes = [
        _sticky(CAMPAIGN_PLANNER_STICKY, height=300, width=440, x=0, y=-140),
        _webhook("arak-campaign-planner", "responseNode", x=0, y=200),
        _code("Build Prompt", BUILD_PROMPT_JS, x=220, y=200),
        {
            "parameters": {
                "method": "POST",
                "url": "https://api.anthropic.com/v1/messages",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {"name": "x-api-key", "value": "={{ $env.ANTHROPIC_API_KEY }}"},
                        {"name": "anthropic-version", "value": "2023-06-01"},
                        {"name": "content-type", "value": "application/json"},
                    ]
                },
                "sendBody": True,
                "specifyBody": "json",
                # Opus 5, not Sonnet: this is one call per MONTHLY plan, so its
                # spend is rounding error next to the per-post Sonnet calls and
                # the image/video generation it triggers — and it is the one
                # genuinely reasoning-heavy job here (whole-month coherence,
                # occasion judgement, pillar variety). A weak plan wastes every
                # downstream render. Opus 5 is priced identically to the 4.8 it
                # replaces ($5/$25 per MTok), so the upgrade costs nothing.
                #
                # max_tokens 16000 -> 32000 for two compounding reasons: on
                # Opus 5 thinking is on by default and max_tokens caps thinking
                # PLUS response text together, and Opus 5 writes longer output
                # than 4.8 did. At 16000 the plan JSON could truncate mid-array
                # — which fails as a JSON parse error downstream, not as an
                # obviously-truncated plan. Check stop_reason is not
                # "max_tokens" if plans ever come back unparseable.
                "jsonBody": "={{ JSON.stringify({ model: \"claude-opus-5\", max_tokens: 32000, thinking: { type: \"adaptive\" }, messages: [{ role: \"user\", content: [ { type: \"text\", text: $json.prompt_cached, cache_control: { type: \"ephemeral\" } }, { type: \"text\", text: $json.prompt_variable } ] }] }) }}",
                "options": {},
            },
            "id": nid(),
            "name": "Call Claude",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [440, 200],
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 3000,
        },
        _code("Parse & Validate Plan", PARSE_VALIDATE_PLAN_JS, x=660, y=200),
        _respond_json("Respond to Webhook", "={{ JSON.stringify($json) }}", x=880, y=200),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Build Prompt", "type": "main", "index": 0}]]},
        "Build Prompt": {"main": [[{"node": "Call Claude", "type": "main", "index": 0}]]},
        "Call Claude": {"main": [[{"node": "Parse & Validate Plan", "type": "main", "index": 0}]]},
        "Parse & Validate Plan": {"main": [[{"node": "Respond to Webhook", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Campaign Planner",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }







# ============================================================
# Creative Studio (2026-08-10) — the marketing team's standalone
# generate → compare → edit → animate surface. Distinct from the plan
# pipeline above: there is no post, no caption and no schedule here, only
# the finished asset.
#
# Three workflows, all writing to `creative_versions` (see
# supabase/migrations/20260810_creative_studio.sql). The browser inserts the
# pending row(s) first and polls them, so every workflow here is
# fire-and-forget: it answers "accepted" immediately and PATCHes the row when
# the model returns. A failure PATCHes status='failed' with the real message
# rather than leaving a spinner running forever.
#
# Latest model generation, confirmed available on our FAL_KEY:
#   gpt-image-2 / gpt-image-2/edit   ("ChatGPT" to the marketing team)          — 2026-08-09
#   nano-banana-2 / nano-banana-2/edit     ("Gemini")                          — 2026-08-09
#   bytedance/seedance-2.0/{image,text}-to-video                              — 2026-08-10
# ============================================================

# Shared preamble: n8n's httpRequest helper throws its own generic "status
# code 400" before our code can read the provider's actual error body, which
# on a failed card is indistinguishable between a bad prompt, an expired key
# and an exhausted balance — the last of which actually happened here. Dig the
# real message out of every shape the error can take.
_CREATIVE_REQ_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};
const prepareBinaryData = this.helpers.prepareBinaryData;
const FAL = $env.FAL_KEY;

// Pull the provider's ACTUAL message out of whatever shape n8n wrapped it in.
// Verified necessary 2026-08-09: an exhausted fal balance reached the card as
// the useless "Request failed with status code 403", when fal had actually
// replied {"detail":"User is locked. Reason: Exhausted balance."}. Those two
// strings lead to completely different actions, so this walks every container
// the body might hide in — including `response.body` and `cause`, which the
// older unwrapper (still used by the other workflows) misses — and only falls
// back to n8n's generic text when nothing real is found.
function errText(e){
  const candidates = [
    e && e.response && e.response.data,
    e && e.response && e.response.body,
    e && e.error,
    e && e.cause && e.cause.response && e.cause.response.data,
    e && e.cause && e.cause.error,
    e && e.cause,
    e && e.description,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'string' && c.trim()) return c.slice(0, 400);
    if (Buffer.isBuffer(c)) return c.toString('utf8', 0, 300);
    if (typeof c === 'object') {
      if (c.detail) return (typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)).slice(0, 400);
      if (c.error && c.error.message) return String(c.error.message).slice(0, 400);
      if (c.message && c.message !== (e && e.message)) return String(c.message).slice(0, 400);
      const s = JSON.stringify(c);
      if (s && s !== '{}' && s !== 'null') return s.slice(0, 400);
    }
  }
  return (e && e.message) || String(e);
}

function bodyText(body, status){
  if (body == null) return 'HTTP ' + status;
  if (Buffer.isBuffer(body)) return 'HTTP ' + status + ': ' + body.toString('utf8', 0, 300);
  if (typeof body === 'string') return 'HTTP ' + status + ': ' + body.slice(0, 400);
  if (typeof body === 'object') {
    if (body.detail) return (typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)).slice(0, 400);
    if (body.error && body.error.message) return String(body.error.message).slice(0, 400);
    if (body.message) return String(body.message).slice(0, 400);
    return 'HTTP ' + status + ': ' + JSON.stringify(body).slice(0, 400);
  }
  return 'HTTP ' + status;
}

// Don't let n8n throw on a non-2xx at all — ask for the full response and
// judge the status here. Measured 2026-08-09: when n8n raises the error
// itself, the provider's body is NOT reachable from the thrown object by any
// path (errText below was tried and still yielded "Request failed with status
// code 403"), so an exhausted balance and a rejected prompt were
// indistinguishable on the card. Reading the body directly is the only way to
// get the real reason out. errText stays as the fallback for older n8n builds
// that ignore ignoreHttpStatusErrors and throw regardless.
// returnFullResponse changes how a BINARY body comes back. Measured against
// this n8n build, 2026-08-10, fetching the same JPEG both ways:
//   encoding:'arraybuffer'                       -> real Buffer (isBuffer true)
//   encoding:'arraybuffer' + returnFullResponse  -> {type:'Buffer', data:[...]}
// i.e. the JSON-serialised form, whose .length is undefined. Since req() sets
// returnFullResponse on every call to read error bodies, every image and video
// download in these workflows was silently getting that object instead of
// bytes — "Downloaded file is not a real image (undefined bytes)". It went
// unnoticed because fal's balance was empty the whole time this code existed,
// so the download line had never once been reached with a real response.
function reviveBinary(b){
  if (!b || typeof b !== 'object') return b;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(b)) return b;
  if (b.type === 'Buffer' && Array.isArray(b.data)) return Buffer.from(b.data);
  if (b instanceof ArrayBuffer) return Buffer.from(new Uint8Array(b));
  if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  return b;
}

async function req(opts){
  let full;
  try {
    full = await http(Object.assign({}, opts, { returnFullResponse: true, ignoreHttpStatusErrors: true }));
  } catch (e) {
    throw new Error(errText(e));
  }
  const status = (full && (full.statusCode || full.status)) || 200;
  const body = (full && full.body !== undefined) ? full.body : full;
  if (status >= 400) throw new Error(bodyText(body, status));
  return reviveBinary(body);
}

// A byte-count threshold is not enough — a corrupted buffer can be LARGER
// than the real file (a JSON-stringified Buffer is ~7x bigger), which is how
// a broken image once saved silently with no error anywhere. Check the actual
// file signature instead.
function looksLikeImage(buf){
  if (!buf || buf.length < 12) return false;
  // Same fix as the other looksLikeImage in this file: PNG's 0x89 lead byte
  // cannot survive an 'ascii' string compare (Node masks the high bit off
  // every byte for that encoding), so this always failed a genuine PNG.
  const head = buf.toString('ascii', 0, 12);
  return (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
      || (buf[0] === 0xFF && buf[1] === 0xD8)
      || (head.startsWith('RIFF') && head.indexOf('WEBP') !== -1);
}

// gpt-image-2's named buckets have no 4:5, which used to mean the GPT
// candidate came back 3:4 while the Gemini one came back a true 4:5 — two
// different shapes in a side-by-side that exists to compare models, and the
// GPT one not post-ready. The prompt even claimed it would be "cropped to
// 4:5" and no crop was ever performed anywhere in the pipeline.
//
// The endpoint also accepts explicit dimensions, which removes the problem at
// the source rather than trimming after the fact: 1024x1280 is exactly 4:5,
// both edges multiples of 16, and 1.31MP sits inside the documented
// 655,360–8,294,400 pixel range. Every other ratio has an exact bucket
// already, so only 4:5 needs this.
const GPT_SIZE = {
  '1:1': 'square_hd', '3:4': 'portrait_4_3',
  '9:16': 'portrait_16_9', '16:9': 'landscape_16_9',
  '1.91:1': 'landscape_16_9', '4:3': 'landscape_4_3', '3:2': 'landscape_4_3',
};
const GPT_EXACT = {
  '4:5': { width: 1024, height: 1280 },
};
"""

CREATIVE_GENERATE_JS = _CREATIVE_REQ_JS + r"""
const BUCKET = 'creative-studio';
const body = ($input.first().json.body) || {};
const sessionId   = body.session_id || '';
const basePrompt  = String(body.prompt || '').trim();
const aspect      = body.aspect_ratio || '1:1';
const referenceUrl   = body.reference_url || '';
const referenceNotes = String(body.reference_notes || '').trim();
const instructions   = String(body.instructions || '').trim();
// [{ version_id, provider }] — the browser already inserted these as pending
// rows, so each candidate has somewhere to land the moment it finishes.
const targets = Array.isArray(body.targets) ? body.targets : [];

if (!basePrompt) return targets.map(t => ({ json: { _ok: false, version_id: t.version_id, error: 'No prompt to generate from.' } }));

// Two layers. The creative brief — subject, lighting, composition, materials —
// is IDENTICAL for both candidates, because that is the variable the whole
// side-by-side screen exists to hold constant: we are comparing the models, not
// two different prompts. Only the provider MECHANICS differ below, and each of
// those has a measured reason rather than folklore about prompt styles.
function buildPrompt(provider){
  let p = basePrompt;
  // The brand block used to be appended with no statement of precedence, so
  // "make it cool blue" against a warm-bronze palette resolved arbitrarily —
  // differently run to run. The same reasoning already applied to reference
  // notes below (a specific instruction beats a default) is now stated for
  // the brand block too, which is what makes the outcome repeatable.
  if (instructions) {
    p += '\n\nBRAND CONTEXT (defaults — the brief above is the specific ask and takes precedence over any default here, except brand guardrails and never-do rules, which are absolute):\n' + instructions;
  }
  if (referenceUrl) {
    // The team's explicit ask: take inspiration from the reference, do not
    // reproduce it. Their own note wins over the generic wording when both
    // are present, because it is a specific instruction rather than a
    // default.
    p += referenceNotes
      ? '\n\nThe supplied reference image is INSPIRATION, not a template. Follow this direction from the requester and prioritise it: ' + referenceNotes
      : '\n\nUse the supplied reference image as inspiration for style, mood and composition only — do not reproduce it literally.';
  }
  if (provider === 'openai') {
    // No centre-safe warning here any more: 4:5 is now requested as explicit
    // dimensions (GPT_EXACT), so nothing gets cropped and asking the model to
    // leave dead space top and bottom would just waste the frame.
    // Measured 2026-08-09: gpt-image-2 invented an "ARAK LIGHTING / RIYADH
    // SAUDI ARABIA" wordmark on a wall that nothing in the prompt asked for.
    // nano-banana-2, same prompt, did not — so this is a GPT-only counter
    // rather than a shared rule, which would otherwise suppress legitimate
    // in-scene signage on the Gemini candidate for no reason.
    p += '\n\nDo not add any logo, wordmark, watermark, signage or brand lockup that is not explicitly described above.';
  }
  return p;
}

async function genGemini(){
  const useEdit = !!referenceUrl;
  const endpoint = useEdit ? 'fal-ai/nano-banana-2/edit' : 'fal-ai/nano-banana-2';
  const b = { prompt: buildPrompt('gemini'), aspect_ratio: aspect, resolution: '2K', output_format: 'png', num_images: 1 };
  if (useEdit) b.image_urls = [referenceUrl];
  const r = await req({ method:'POST', url:'https://fal.run/' + endpoint,
    headers:{ Authorization:'Key ' + FAL, 'Content-Type':'application/json' }, body: b, json:true });
  const url = (r.images && r.images[0] && r.images[0].url) || (r.image && r.image.url);
  if (!url) throw new Error('nano-banana-2 returned no image');
  return url;
}

async function genOpenAI(){
  const useEdit = !!referenceUrl;
  // The real edit endpoint is /edit, not /edit-image -- confirmed 2026-08-10 by
  // reading the actual field-validation error off fal's queue API (missing
  // 'prompt'/'image_urls' vs a routing 404), after /edit-image silently 404'd
  // on every call that reached it (this path only fires when a reference image
  // is attached at generate time).
  const endpoint = useEdit ? 'fal-ai/gpt-image-2/edit' : 'fal-ai/gpt-image-2';
  // Exact dimensions where a bucket would distort the shape (4:5), the named
  // bucket everywhere else — the buckets are exact for those ratios and let
  // the model pick its own best resolution.
  const b = { prompt: buildPrompt('openai'),
              image_size: GPT_EXACT[aspect] || GPT_SIZE[aspect] || 'square_hd',
              quality: 'high', output_format: 'png', num_images: 1 };
  if (useEdit) b.image_urls = [referenceUrl];
  const r = await req({ method:'POST', url:'https://fal.run/' + endpoint,
    headers:{ Authorization:'Key ' + FAL, 'Content-Type':'application/json' }, body: b, json:true });
  const url = (r.images && r.images[0] && r.images[0].url) || (r.image && r.image.url);
  if (!url) throw new Error('gpt-image-2 returned no image');
  return url;
}

// fal's own URLs are not guaranteed to persist, and every later step (edit,
// animate, overlay) re-reads this image — so it is copied into our bucket now
// rather than trusted to still be there in ten minutes.
async function oneCandidate(target){
  const tempUrl = target.provider === 'openai' ? await genOpenAI() : await genGemini();
  const buf = await req({ method:'GET', url: tempUrl, encoding:'arraybuffer' });
  if (!looksLikeImage(buf)) {
    throw new Error('Downloaded file is not a real image (' + buf.length + ' bytes, starts with "' + buf.toString('ascii', 0, 16) + '")');
  }
  const base = target.version_id + '-' + Date.now() + '.png';
  const filename = (sessionId ? sessionId + '/' : '') + base;
  return {
    json: { _ok: true, version_id: target.version_id, provider: target.provider, bucket: BUCKET, filename },
    binary: { data: await prepareBinaryData(buf, base, 'image/png') },
  };
}

// allSettled, not all — the whole point of this screen is a side-by-side
// comparison, and one provider erroring should still leave the other one
// standing rather than blanking the round.
const settled = await Promise.allSettled(targets.map(oneCandidate));
return settled.map((s, i) => s.status === 'fulfilled' ? s.value : ({
  json: { _ok: false, version_id: targets[i].version_id, provider: targets[i].provider,
          error: (s.reason && s.reason.message) ? s.reason.message : String(s.reason) },
}));
"""

CREATIVE_EDIT_JS = _CREATIVE_REQ_JS + r"""
const BUCKET = 'creative-studio';
const body = ($input.first().json.body) || {};
const sessionId   = body.session_id || '';
const versionId   = body.version_id || '';
const sourceUrl   = body.source_image_url || '';
const instruction = String(body.instruction || '').trim();
const aspect      = body.aspect_ratio || 'auto';
// Extra images to look at while editing — in practice the OTHER candidate,
// dragged across from its chat ("give this one that one's lighting"). Both
// edit endpoints take an image_urls ARRAY, so this needs no second call and
// no compositing: the model sees the base and the reference together.
const refUrls = (Array.isArray(body.reference_image_urls) ? body.reference_image_urls : [])
  .filter(u => typeof u === 'string' && u && u !== sourceUrl)
  .slice(0, 3);   // fal rejects long arrays, and past ~3 the instruction stops steering anything
// Nano Banana is the default here: instruction-following image editing is its
// headline capability, and it is the stronger of the two at leaving the rest
// of the frame untouched while changing exactly what was asked for.
const provider    = body.provider === 'openai' ? 'openai' : 'gemini';

// What this image has already been through. These models are stateless — one
// image, one instruction, no memory — so without this a follow-up like "a bit
// more" or "undo that last bit" refers to nothing and the model guesses.
// Capped because the useful signal is the recent turns; a 30-edit history
// crowds out the actual instruction.
const history = (Array.isArray(body.history) ? body.history : [])
  .filter(h => typeof h === 'string' && h.trim())
  .slice(-6);
const originalPrompt = String(body.original_prompt || '').trim();

// Order carries meaning to both models — the first image is the one being
// changed, the rest are only there to look at — but neither model is told
// that by the schema, so the prompt says it outright. Without this the edit
// routinely comes back as a blend of the two, which is not what "use that as
// a reference" means.
function editPrompt(){
  const parts = [];

  // Context first, clearly fenced off as background, with the instruction
  // last so it's the thing the model acts on. Saying these are ALREADY
  // APPLIED is the load-bearing part: listed without that, the model treats
  // them as more work to do and the earlier changes land a second time.
  if (originalPrompt || history.length) {
    parts.push('CONTEXT — this is background only. Everything listed here has ALREADY been applied to the image you were given. Do NOT apply any of it again; it is here purely so that a follow-up instruction referring to earlier work makes sense.');
    if (originalPrompt) parts.push('The image was originally created from: ' + originalPrompt);
    if (history.length) {
      parts.push('Edits already made, oldest first:\n'
        + history.map((h, i) => (i + 1) + '. ' + h).join('\n'));
    }
    parts.push('END OF CONTEXT.');
  }

  parts.push((originalPrompt || history.length ? 'NOW DO THIS: ' : '') + instruction);

  if (refUrls.length) {
    parts.push('Edit the FIRST image only — that is the image to modify, and everything not mentioned above must stay exactly as it is. '
      + (refUrls.length > 1 ? 'The following images are' : 'The second image is')
      + ' supplied purely as visual reference for the change described. Do not merge, collage or copy '
      + (refUrls.length > 1 ? 'them' : 'it') + ' into the result.');
  }

  return parts.join('\n\n');
}

async function run(){
  if (!sourceUrl)   throw new Error('No source image to edit.');
  if (!instruction) throw new Error('No edit instruction given.');

  const images = [sourceUrl].concat(refUrls);
  let tempUrl;
  if (provider === 'openai') {
    const r = await req({ method:'POST', url:'https://fal.run/fal-ai/gpt-image-2/edit',
      headers:{ Authorization:'Key ' + FAL, 'Content-Type':'application/json' },
      body:{ prompt: editPrompt(), image_urls: images, quality:'high', output_format:'png', num_images:1 }, json:true });
    tempUrl = (r.images && r.images[0] && r.images[0].url) || (r.image && r.image.url);
  } else {
    const b = { prompt: editPrompt(), image_urls: images, resolution:'2K', output_format:'png', num_images:1 };
    // 'auto' keeps the source's own shape, which is what an edit should do
    // unless the caller deliberately asks for a different frame.
    if (aspect && aspect !== 'auto') b.aspect_ratio = aspect;
    const r = await req({ method:'POST', url:'https://fal.run/fal-ai/nano-banana-2/edit',
      headers:{ Authorization:'Key ' + FAL, 'Content-Type':'application/json' }, body: b, json:true });
    tempUrl = (r.images && r.images[0] && r.images[0].url) || (r.image && r.image.url);
  }
  if (!tempUrl) throw new Error('The edit returned no image.');

  const buf = await req({ method:'GET', url: tempUrl, encoding:'arraybuffer' });
  if (!looksLikeImage(buf)) {
    throw new Error('Edited file is not a real image (' + buf.length + ' bytes, starts with "' + buf.toString('ascii', 0, 16) + '")');
  }
  const base = versionId + '-' + Date.now() + '.png';
  const filename = (sessionId ? sessionId + '/' : '') + base;
  return {
    json: { _ok: true, version_id: versionId, provider, bucket: BUCKET, filename },
    binary: { data: await prepareBinaryData(buf, base, 'image/png') },
  };
}

try { return await run(); }
catch (err) {
  return { json: { _ok: false, version_id: versionId, provider,
                   error: (err && err.message) ? err.message : String(err) } };
}
"""

CREATIVE_VIDEO_JS = _CREATIVE_REQ_JS + r"""
const BUCKET = 'creative-studio';
// One config per model the Studio's picker can send (added 2026-08-10 —
// see CREATIVE-STUDIO.md for the per-model fal pricing this was checked
// against). Endpoints and their accepted inputs genuinely differ: Kling and
// Hailuo take neither `resolution` nor `aspect_ratio`, and Veo's `duration`
// needs an 's' suffix ("8s") where every Seedance model takes a bare number.
// `build` is the one place that has to know that, so the caller below stays
// oblivious to which model it's actually talking to.
const MODEL_CONFIGS = {
  'seedance-2': {
    i2v: 'bytedance/seedance-2.0/image-to-video',
    t2v: 'bytedance/seedance-2.0/text-to-video',
    // Reference-to-video is a DIFFERENT endpoint, not a parameter — which is
    // why the studio's style-reference slot sat unwired until 2026-08-11 with a
    // note saying no model input existed. It does: up to 9 images (plus videos
    // and audio, 12 files total) in an `image_urls` array, addressed from the
    // prompt as @Image1. Verified against fal's live schema.
    r2v: 'bytedance/seedance-2.0/reference-to-video',
    build(imageUrl, endImageUrl, refs) {
      const input = { prompt, duration, resolution, generate_audio: generateAudio, aspect_ratio: aspect };
      if (refs && refs.length) { input.image_urls = refs; return input; }
      if (imageUrl) input.image_url = imageUrl;
      // The last frame of the clip. What makes shot 2 of a stitched reel open
      // exactly where shot 1 closed, so a cut reads as deliberate.
      if (endImageUrl) input.end_image_url = endImageUrl;
      return input;
    },
  },
  'seedance-2.5': {
    i2v: 'bytedance/seedance-2.5/image-to-video',
    t2v: 'bytedance/seedance-2.5/text-to-video',
    r2v: 'bytedance/seedance-2.5/reference-to-video',
    build(imageUrl, endImageUrl, refs) {
      // 2.5's aspect_ratio enum is 'auto' and nothing else — sending a real
      // ratio is rejected. Harmless on image-to-video, where auto follows the
      // source frame; on text-to-video it means this model genuinely offers no
      // shape control, which the picker says out loud.
      const input = { prompt, duration, resolution, generate_audio: generateAudio };
      if (refs && refs.length) { input.image_urls = refs; return input; }
      if (imageUrl) input.image_url = imageUrl;
      if (endImageUrl) input.end_image_url = endImageUrl;
      return input;
    },
  },
  'kling-2.5-turbo-pro': {
    i2v: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video',
    t2v: 'fal-ai/kling-video/v2.5-turbo/pro/text-to-video',
    // No resolution/aspect_ratio input on this endpoint; duration is "5" or "10" only.
    build(imageUrl) {
      const input = { prompt, duration: duration === '10' ? '10' : '5' };
      if (imageUrl) input.image_url = imageUrl;
      return input;
    },
  },
  'veo-3.1-fast': {
    i2v: 'fal-ai/veo3.1/fast/image-to-video',
    t2v: 'fal-ai/veo3.1/fast',
    // Duration takes an 's' suffix ("8s") here, not a bare number.
    build(imageUrl) {
      const d = /s$/.test(duration) ? duration : duration + 's';
      const input = { prompt, duration: d, resolution: resolution === '1080p' ? '1080p' : '720p', generate_audio: generateAudio };
      // Veo takes only auto/16:9/9:16, so it gets an ORIENTATION rather than
      // the session's ratio (see mapAspect). Everything else is reconciled
      // afterwards by Creative Compose, which centre-crops the finished clip to
      // the shape the marketer actually composed against.
      if (aspect) input.aspect_ratio = aspect;
      if (imageUrl) input.image_url = imageUrl;
      return input;
    },
  },
  'hailuo-2.3': {
    i2v: 'fal-ai/minimax/hailuo-2.3/standard/image-to-video',
    t2v: 'fal-ai/minimax/hailuo-2.3/standard/text-to-video',
    // No resolution input; duration is "6" or "10" only.
    build(imageUrl) {
      const input = { prompt, duration: duration === '10' ? '10' : '6' };
      if (imageUrl) input.image_url = imageUrl;
      return input;
    },
  },
};

// MP4's magic bytes are an 'ftyp' box at offset 4, not at the start the way
// image formats are — a truncated download otherwise looks byte-plausible and
// corrupts the asset silently.
function looksLikeVideo(buf){
  if (!buf || buf.length < 12) return false;
  return buf.toString('ascii', 4, 8) === 'ftyp';
}

// Aspect handling is PER MODEL, because the constraint is. It used to be one
// global map, which produced a real and silent failure: 4:5 was rewritten to
// 3:4 for everyone, and Veo rejects 3:4 outright — so every 4:5 or 1:1 Veo
// render failed. Fixed 2026-08-11 along with 2.5's auto-only enum.
//
//  · Seedance 2.0 takes auto/21:9/16:9/4:3/3:4/1:1/9:16 — no 4:5 bucket, the
//    same gap gpt-image-2 has on the image side, so 3:4 is the nearest.
//  · Seedance 2.5 takes 'auto' only — handled in its build(), not here.
//  · Veo 3.1 takes auto/16:9/9:16 only, so it gets an ORIENTATION: portrait
//    ratios become 9:16, everything else 16:9.
//  · Kling and Hailuo take no aspect_ratio at all.
//
// An approximate ratio is acceptable now in a way it wasn't before, because
// Creative Compose centre-crops the finished clip to the overlay's own shape.
const SEEDANCE_MAP = { '4:5': '3:4' };
const PORTRAIT = { '4:5': 1, '9:16': 1, '3:4': 1, '2:3': 1 };
function mapAspect(model, a) {
  const want = a || '';
  if (model === 'veo-3.1-fast') return PORTRAIT[want] ? '9:16' : '16:9';
  if (model === 'seedance-2.5') return '';           // enum is 'auto' only
  if (model === 'kling-2.5-turbo-pro' || model === 'hailuo-2.3') return '';
  return SEEDANCE_MAP[want] || want || 'auto';
}

const body = ($input.first().json.body) || {};
const sessionId = body.session_id || '';
const versionId = body.version_id || '';
const imageUrl  = body.image_url || '';       // absent => text-to-video
const endImageUrl = body.end_image_url || ''; // optional last frame (Seedance only)
// Style references. Seedance's reference-to-video takes these as a whole
// separate endpoint; every other model here has nowhere to put them, so the
// picker says so rather than accepting them and quietly ignoring them.
const referenceUrls = Array.isArray(body.reference_image_urls)
  ? body.reference_image_urls.filter(Boolean).slice(0, 9)
  : [];
const prompt    = String(body.prompt || '').trim();
const duration  = String(body.duration || '5');
const modelId   = MODEL_CONFIGS[body.model] ? body.model : 'seedance-2';
const aspect    = mapAspect(modelId, body.aspect_ratio);
const resolution = body.resolution || '720p';
// Off unless asked: a model inventing ambient sound under a brand asset is a
// liability, not a bonus (CREATIVE-STUDIO.md, 2026-08-10 provider review).
const generateAudio = body.generate_audio === true;
// Falls back to Seedance 2.0 for any request that predates the model picker
// (or names one this workflow doesn't recognise) rather than failing outright.
const cfg = MODEL_CONFIGS[modelId];

async function run(){
  if (!prompt) throw new Error('No direction given for the video.');

  // Three modes, one workflow, because a session may be image-then-video,
  // video-only, or built from references — the team works all three ways and an
  // image is an optional starting point, not a prerequisite.
  const useRefs = referenceUrls.length > 0 && !!cfg.r2v;
  const model = useRefs ? cfg.r2v : (imageUrl ? cfg.i2v : cfg.t2v);

  // The references are only useful if the prompt says what to do with each one.
  // Seedance addresses them positionally as @Image1/@Image2 and, without a
  // sentence naming them, treats them as loose inspiration and mostly ignores
  // them — the same failure the image Edit workflow hit with its image_urls
  // array, and the same fix.
  const refPrompt = useRefs
    ? referenceUrls.map((_, i) => '@Image' + (i + 1)).join(' and ')
      + ' show the look to follow — match their styling, palette and mood. '
      + 'Do not copy them shot for shot.\n\n' + prompt
    : prompt;

  const input = cfg.build(imageUrl, endImageUrl, useRefs ? referenceUrls : null);
  input.prompt = refPrompt;

  const submit = await req({ method:'POST', url:'https://queue.fal.run/' + model,
    headers:{ Authorization:'Key ' + FAL, 'Content-Type':'application/json' }, body: input, json:true });
  const requestId = submit.request_id;
  if (!requestId) throw new Error('fal did not return a request_id: ' + JSON.stringify(submit).slice(0, 250));

  // Saved BEFORE polling starts, not after — the request_id only ever lived
  // in this function's local variables until now, and this function can be
  // killed mid-poll by n8n's own task-runner timeout (found 2026-08-11: a
  // render fal was genuinely still working on got killed at the 5-minute
  // mark, and because the id was never written anywhere, the row was left
  // 'pending' forever with no way to ever recover the finished clip). Best
  // effort and non-fatal — a failed save here must never sink a render that
  // is otherwise working; Creative Video Reconcile is what actually reads
  // this back, sweeping for exactly this situation on a schedule.
  try {
    await req({ method: 'PATCH',
      url: String($env.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/creative_versions?id=eq.' + versionId,
      headers: { Authorization: 'Bearer ' + $env.SUPABASE_KEY, apikey: $env.SUPABASE_KEY,
                 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      // cancel_url comes straight from fal's own submit response, for exactly
      // the reason the status URL does below: the queue is keyed on the app id
      // rather than the full model path, and a URL derived from the wrong one
      // 405s. Creative Cancel prefers this and only derives a fallback if fal
      // ever stops returning it.
      body: { overlay_state: { pendingRequest: {
        requestId, model, cancelUrl: submit.cancel_url || '',
        submittedAt: new Date().toISOString() } } },
      json: true });
  } catch (e) { /* recoverable by Reconcile only if this succeeded; never worth failing the render over */ }

  // ── Poll where fal SAYS to poll, not where we guess ──────────────────────
  // Submitting takes the full model path, but the queue is keyed on the first
  // TWO segments only: submit to
  //   queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/image-to-video
  // and fal replies with
  //   queue.fal.run/fal-ai/kling-video/requests/<id>
  // Building the status URL from the full path returns 405, and because that
  // happens AFTER the submit, the generation had already started and been
  // charged. Every video render in this app failed this way — which is exactly
  // why creative_versions held zero ready videos while the bill still ran
  // (found 2026-08-11, the first time a render was followed all the way
  // through).
  //
  // The fallback keeps the first two segments rather than the whole path, so
  // it is right even if fal ever stops returning the URLs.
  const appId = model.split('/').slice(0, 2).join('/');
  const statusUrl = submit.status_url || ('https://queue.fal.run/' + appId + '/requests/' + requestId + '/status');
  const resultUrl = submit.response_url || ('https://queue.fal.run/' + appId + '/requests/' + requestId);

  // Poll rather than hold a single HTTP call open — video generation
  // routinely runs longer than any request should stay alive. ~7.5 minutes,
  // matching the existing Video Render guard.
  let status = submit.status || 'IN_QUEUE';
  let tries = 0;
  while ((status === 'IN_QUEUE' || status === 'IN_PROGRESS') && tries < 150) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await req({ method:'GET', url: statusUrl, headers:{ Authorization:'Key ' + FAL }, json:true });
    status = s.status; tries++;
  }
  if (status !== 'COMPLETED') {
    throw new Error(status === 'IN_QUEUE' || status === 'IN_PROGRESS'
      ? 'Video generation timed out after ~' + (tries * 3) + 's (request ' + requestId + ')'
      : 'Video generation ' + status + ' (request ' + requestId + ')');
  }

  const result = await req({ method:'GET', url: resultUrl, headers:{ Authorization:'Key ' + FAL }, json:true });
  const videoUrl = result.video && result.video.url;
  // The request id goes in EVERY failure past this point. A render that fails
  // after submitting has already been paid for, and without the id there is no
  // way to fetch the clip fal did produce — which is how one paid Kling render
  // was lost on 2026-08-11.
  if (!videoUrl) throw new Error('fal returned no video URL (request ' + requestId + '): ' + JSON.stringify(result).slice(0, 250));

  const buf = await req({ method:'GET', url: videoUrl, encoding:'arraybuffer' });
  if (!looksLikeVideo(buf)) {
    throw new Error('Downloaded file is not a real video (' + buf.length + ' bytes)');
  }
  const base = versionId + '-' + Date.now() + '.mp4';
  const filename = (sessionId ? sessionId + '/' : '') + base;
  return {
    json: { _ok: true, version_id: versionId, bucket: BUCKET, filename },
    binary: { data: await prepareBinaryData(buf, base, 'video/mp4') },
  };
}

try { return await run(); }
catch (err) {
  return { json: { _ok: false, version_id: versionId,
                   error: (err && err.message) ? err.message : String(err) } };
}
"""


# ─── Creative Video Edit ────────────────────────────────────────────────────
# Every other video workflow GENERATES — a prompt (and maybe a still) becomes
# a brand new take. This one EDITS: an existing clip goes back in, along with
# a plain-English instruction, and fal-ai/kling-video/o1/video-to-video/edit
# changes what the instruction names while preserving the source's own camera
# movement and motion structure. Added 2026-08-11 once it turned out this
# model exists — the original plan treated "edit the footage in place" as
# out of scope because no known endpoint did it.
#
# Same submit/poll/download shape as CREATIVE_VIDEO_JS, including the fixed
# queue-URL logic (appId = first two path segments) — this endpoint sits
# behind the exact same queue.fal.run mechanics, so the same bug would apply.
CREATIVE_VIDEO_EDIT_JS = _CREATIVE_REQ_JS + r"""
const BUCKET = 'creative-studio';
const MODEL = 'fal-ai/kling-video/o1/video-to-video/edit';

function looksLikeVideo(buf){
  if (!buf || buf.length < 12) return false;
  return buf.toString('ascii', 4, 8) === 'ftyp';
}

const body = ($input.first().json.body) || {};
const sessionId = body.session_id || '';
const versionId = body.version_id || '';
const videoUrl  = String(body.video_url || '').trim();
const prompt    = String(body.prompt || '').trim();
// Style/appearance references, addressed in the prompt as @Image1, @Image2 —
// fal caps elements + reference images at 4 combined; we only ever send
// plain images (no character "elements"), so 4 is the whole budget.
const referenceUrls = Array.isArray(body.reference_image_urls)
  ? body.reference_image_urls.filter(Boolean).slice(0, 4)
  : [];

async function run(){
  if (!prompt) throw new Error('No instruction given for the edit.');
  if (!videoUrl) throw new Error('No clip to edit.');

  // keep_audio is unconditional: an edit that changes the picture must not
  // also silently drop audio the original render had. fal defaults this to
  // false, so it has to be stated explicitly.
  const input = { prompt, video_url: videoUrl, keep_audio: true };
  if (referenceUrls.length) input.image_urls = referenceUrls;

  const submit = await req({ method:'POST', url:'https://queue.fal.run/' + MODEL,
    headers:{ Authorization:'Key ' + FAL, 'Content-Type':'application/json' }, body: input, json:true });
  const requestId = submit.request_id;
  if (!requestId) throw new Error('fal did not return a request_id: ' + JSON.stringify(submit).slice(0, 250));

  // See CREATIVE_VIDEO_JS for why this is saved before polling starts —
  // same task-runner-timeout exposure, same fix, same reconciler reads it.
  try {
    await req({ method: 'PATCH',
      url: String($env.SUPABASE_URL).replace(/\/+$/, '') + '/rest/v1/creative_versions?id=eq.' + versionId,
      headers: { Authorization: 'Bearer ' + $env.SUPABASE_KEY, apikey: $env.SUPABASE_KEY,
                 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: { overlay_state: { pendingRequest: { requestId, model: MODEL, submittedAt: new Date().toISOString() } } },
      json: true });
  } catch (e) { /* recoverable by Reconcile only if this succeeded; never worth failing the edit over */ }

  // See CREATIVE_VIDEO_JS for why this is built from the first two path
  // segments rather than the full model path — submitting to the full path
  // but polling the full path too is the bug that cost a real render on
  // 2026-08-11, on this same queue mechanism.
  const appId = MODEL.split('/').slice(0, 2).join('/');
  const statusUrl = submit.status_url || ('https://queue.fal.run/' + appId + '/requests/' + requestId + '/status');
  const resultUrl = submit.response_url || ('https://queue.fal.run/' + appId + '/requests/' + requestId);

  let status = submit.status || 'IN_QUEUE';
  let tries = 0;
  while ((status === 'IN_QUEUE' || status === 'IN_PROGRESS') && tries < 150) {
    await new Promise(r => setTimeout(r, 3000));
    const s = await req({ method:'GET', url: statusUrl, headers:{ Authorization:'Key ' + FAL }, json:true });
    status = s.status; tries++;
  }
  if (status !== 'COMPLETED') {
    throw new Error(status === 'IN_QUEUE' || status === 'IN_PROGRESS'
      ? 'Edit timed out after ~' + (tries * 3) + 's (request ' + requestId + ')'
      : 'Edit ' + status + ' (request ' + requestId + ')');
  }

  const result = await req({ method:'GET', url: resultUrl, headers:{ Authorization:'Key ' + FAL }, json:true });
  const outUrl = result.video && result.video.url;
  if (!outUrl) throw new Error('fal returned no video URL (request ' + requestId + '): ' + JSON.stringify(result).slice(0, 250));

  const buf = await req({ method:'GET', url: outUrl, encoding:'arraybuffer' });
  if (!looksLikeVideo(buf)) {
    throw new Error('Downloaded file is not a real video (' + buf.length + ' bytes)');
  }
  const base = versionId + '-' + Date.now() + '.mp4';
  const filename = (sessionId ? sessionId + '/' : '') + base;
  return {
    json: { _ok: true, version_id: versionId, bucket: BUCKET, filename },
    binary: { data: await prepareBinaryData(buf, base, 'video/mp4') },
  };
}

try { return await run(); }
catch (err) {
  return { json: { _ok: false, version_id: versionId,
                   error: (err && err.message) ? err.message : String(err) } };
}
"""


# ─── Creative Video Reconcile ───────────────────────────────────────────────
# The permanent fix for "the video actually finished in fal, but the app never
# shows it" — added 2026-08-11 after that happened twice in one afternoon, for
# two DIFFERENT reasons (a transient upload-gateway blip, then a task-runner
# timeout). Both left a version row 'pending' forever with no error, because
# both failure modes killed the render's Code node execution somewhere the
# workflow's own Generated OK? / Mark Failed branches never run — that pair
# only fires when the Code node RETURNS, and a killed task never returns.
#
# Rather than chase every individual way a long-running task can die (there
# will always be another one — a container restart, an OOM, a host reboot),
# this closes the loop structurally: the render workflows now save fal's
# request_id to the row the MOMENT they have it, before polling even starts
# (see CREATIVE_VIDEO_JS / CREATIVE_VIDEO_EDIT_JS). This sweep runs on a
# schedule, finds any video row that's been 'pending' for a while and has a
# saved request_id, and asks fal directly what actually happened — same
# status/result calls the render workflows make, just from outside the
# execution that might have died. Whatever fal says, the row stops being a
# silent ghost:
#   COMPLETED → downloads the clip and marks the row ready. No re-render, no
#     new charge — this is the exact recovery that was done by hand twice
#     before this workflow existed.
#   an explicit failure/unknown-request status from fal → marks the row
#     failed with fal's own reason.
#   still queued after 20 minutes → gives up and marks it failed rather than
#     leaving a spinner nobody can act on forever.
#   still queued but under 20 minutes → left alone for the next sweep tick.
CREATIVE_VIDEO_RECONCILE_STICKY = """## Creative Studio — Video Reconcile (safety net, added 2026-08-11)

Runs on a schedule, no webhook. Finds `creative_versions` rows that are
`status = 'pending'`, `media_type = 'video'`, older than 3 minutes (room for
the primary render workflow's own poll to finish first), with a
`overlay_state.pendingRequest.requestId` saved — meaning a render was
submitted to fal and then the workflow that submitted it never came back to
say what happened, for whatever reason (task-runner timeout, container
restart, a crash — this sweep doesn't need to know which).

For each: asks fal for that request's real status.
- `COMPLETED` → downloads the clip, uploads it, marks the row `ready`. Free —
  the render was already paid for; this only ever finishes writing it down.
- a real failure or an expired/unknown request → marks the row `failed` with
  fal's own message, so it reads the same as any other failure card.
- still queued past 20 minutes total → gives up and marks it `failed` rather
  than leaving an unexplained spinner forever.
- still queued, under 20 minutes → left for the next tick.

Rows from before this fix existed have no `pendingRequest` and are skipped —
nothing to reconcile against.

### Images too, since 2026-08-18 — but only to clear them

The name still says "Video" on purpose: renaming the workflow would stop
`redeploy.sh` matching it by name, so the next deploy would import a SECOND
copy on the same 2-minute schedule instead of updating this one. Not worth it.

Images are swept on the same tick but cannot be recovered, and the difference
is worth understanding before trusting it. Video goes through `queue.fal.run`,
so a request id exists and the result can be fetched later. Image generation
and editing call `fal.run` DIRECTLY and synchronously — no request id is ever
recorded, so once the owning workflow dies there is nothing left to ask fal
about and no way to get the picture back.

So for `media_type = 'image'`: after 15 minutes the row is marked `failed`
with an honest "this was interrupted, press Retry". No fal call is made. 15
minutes because n8n caps a Code node at `N8N_RUNNERS_TASK_TIMEOUT` (600s), so
anything still pending past that plus margin is orphaned rather than slow.

Added after a row sat `pending` for 25 hours with nothing in the system that
would ever clear it.

Needs env: FAL_KEY, SUPABASE_URL, SUPABASE_KEY."""

CREATIVE_VIDEO_RECONCILE_JS = _CREATIVE_REQ_JS + r"""
const SUP = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = $env.SUPABASE_KEY;
const BUCKET = 'creative-studio';

function looksLikeVideo(buf){
  if (!buf || buf.length < 12) return false;
  return buf.toString('ascii', 4, 8) === 'ftyp';
}

async function patchRow(id, patch) {
  await req({ method: 'PATCH', url: SUP + '/rest/v1/creative_versions?id=eq.' + id,
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: patch, json: true });
}

const STALE_MS = 3 * 60 * 1000;   // let the primary workflow's own poll finish first
const GIVEUP_MS = 20 * 60 * 1000; // fal's queue doesn't hold a result forever either

// Images are a different problem with a different answer, so they get their own
// deadline. Image generation is SYNCHRONOUS — Creative Generate and Creative
// Edit call fal.run directly, not queue.fal.run — so no request id is ever
// recorded and there is nothing to ask fal about afterwards. A stuck image
// therefore cannot be RECOVERED the way a stuck video can; it can only be
// stopped from spinning. 15 minutes because n8n caps a Code node at
// N8N_RUNNERS_TASK_TIMEOUT (600s, set in docker-compose.yml), so a row still
// pending past that plus margin is certainly orphaned, not slow.
const IMAGE_GIVEUP_MS = 15 * 60 * 1000;

async function run() {
  // Both media types in one sweep. `media_type` is selected now because the
  // loop branches on it — before this it was implied by the filter.
  const rows = await req({ method: 'GET',
    url: SUP + '/rest/v1/creative_versions?status=eq.pending'
      + '&select=id,session_id,created_at,overlay_state,provider,clip_role,media_type&order=created_at.asc&limit=25',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }, json: true });

  const now = Date.now();
  const results = [];

  for (const row of rows) {
    const age = now - new Date(row.created_at).getTime();
    if (age < STALE_MS) continue;

    // Rows this sweep must not touch: Compose and Stitch are local ffmpeg
    // jobs with no fal request behind them, so there is nothing here to
    // reconcile them against. They are provider 'manual'; a stitch row also
    // carries clip_role.
    if (row.provider === 'manual' || row.clip_role) continue;

    // ── Images: clear the spinner, never claim to recover ────────────────
    // Handled before the pendingRequest logic below because an image never
    // has one — the generate/edit calls are synchronous, so there is no queued
    // request to look up and no way to get the picture back. If the workflow
    // that owned this row died, whatever fal may have produced is gone with
    // it. The only honest thing left is to say so and let the operator retry,
    // rather than leave a card spinning forever with no explanation (this is
    // what left one row pending for 25 hours before this branch existed).
    //
    // No fal call is made here at all, which also makes this the free, safe
    // way to prove the sweep is alive: insert a >15min pending image row and
    // watch it flip to failed.
    if (row.media_type === 'image') {
      if (age > IMAGE_GIVEUP_MS) {
        await patchRow(row.id, { status: 'failed',
          error: 'This image never finished — the render was interrupted and cannot be recovered. Press Retry.' });
        results.push({ id: row.id, outcome: 'failed-image-orphaned' });
      }
      continue;
    }

    const pr = row.overlay_state && row.overlay_state.pendingRequest;
    if (!pr || !pr.requestId || !pr.model) {
      // No fal request was ever recorded. Either the row predates the fix that
      // started saving one, or — far likelier now that a multi-clip run
      // inserts up to twelve rows per storyboard — the tab died in the
      // moment between inserting the row and firing the webhook. Nothing is
      // coming for it, so stop it spinning forever.
      if (age > GIVEUP_MS) {
        await patchRow(row.id, { status: 'failed',
          error: 'The render was never submitted — the page was closed before it started. Press Retry.' });
        results.push({ id: row.id, outcome: 'failed-never-submitted' });
      }
      continue;
    }

    try {
      const appId = String(pr.model).split('/').slice(0, 2).join('/');
      const statusUrl = 'https://queue.fal.run/' + appId + '/requests/' + pr.requestId + '/status';
      const resultUrl = 'https://queue.fal.run/' + appId + '/requests/' + pr.requestId;
      const s = await req({ method: 'GET', url: statusUrl, headers: { Authorization: 'Key ' + FAL }, json: true });

      if (s.status === 'COMPLETED') {
        const result = await req({ method: 'GET', url: resultUrl, headers: { Authorization: 'Key ' + FAL }, json: true });
        const videoUrl = result.video && result.video.url;
        if (!videoUrl) {
          await patchRow(row.id, { status: 'failed', error: 'fal reported COMPLETED but returned no video URL (request ' + pr.requestId + ')' });
          results.push({ id: row.id, outcome: 'failed-no-url' }); continue;
        }
        const buf = await req({ method: 'GET', url: videoUrl, encoding: 'arraybuffer' });
        if (!looksLikeVideo(buf)) {
          await patchRow(row.id, { status: 'failed', error: 'Recovered file was not a real video (request ' + pr.requestId + ')' });
          results.push({ id: row.id, outcome: 'failed-bad-file' }); continue;
        }
        const filename = (row.session_id ? row.session_id + '/' : '') + row.id + '-' + Date.now() + '.mp4';
        await req({ method: 'POST', url: SUP + '/storage/v1/object/' + BUCKET + '/' + filename,
          headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: buf });
        await patchRow(row.id, { status: 'ready', error: '', video_url: SUP + '/storage/v1/object/public/' + BUCKET + '/' + filename });
        results.push({ id: row.id, outcome: 'recovered' });
      } else if (s.status === 'IN_QUEUE' || s.status === 'IN_PROGRESS') {
        if (age > GIVEUP_MS) {
          await patchRow(row.id, { status: 'failed', error: 'Gave up waiting on fal after 20 minutes with no result (request ' + pr.requestId + ')' });
          results.push({ id: row.id, outcome: 'gave-up' });
        } else {
          results.push({ id: row.id, outcome: 'still-waiting' });
        }
      } else {
        await patchRow(row.id, { status: 'failed', error: 'fal reported ' + s.status + ' (request ' + pr.requestId + ')' });
        results.push({ id: row.id, outcome: 'failed-' + s.status });
      }
    } catch (err) {
      // Either a transient error on OUR status check, or a request_id fal no
      // longer recognises. Left for the next tick unless already past
      // GIVEUP_MS, at which point a plain explanation beats an eternal ghost.
      if (age > GIVEUP_MS) {
        await patchRow(row.id, { status: 'failed', error: 'Could not reach fal to check this request (request ' + pr.requestId + '): ' + ((err && err.message) || String(err)) });
        results.push({ id: row.id, outcome: 'gave-up-error' });
      } else {
        results.push({ id: row.id, outcome: 'check-failed', error: (err && err.message) || String(err) });
      }
    }
  }

  return [{ json: { checked: rows.length, acted: results.length, results } }];
}

return await run();
"""


def build_creative_video_reconcile() -> dict:
    nodes = [
        _sticky(CREATIVE_VIDEO_RECONCILE_STICKY, height=460, width=480, x=0, y=-240),
        {
            "parameters": {"rule": {"interval": [{"field": "minutes", "minutesInterval": 2}]}},
            "id": nid(),
            "name": "Every 2 minutes",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.2,
            "position": [0, 200],
        },
        _code("Reconcile Stuck Renders", CREATIVE_VIDEO_RECONCILE_JS, x=260, y=200),
    ]
    connections = {
        "Every 2 minutes": {"main": [[{"node": "Reconcile Stuck Renders", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Creative Video Reconcile",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


# ─── Creative Cancel ────────────────────────────────────────────────────────
# Asks fal to drop a render the studio has already submitted.
#
# WHAT THIS CAN AND CANNOT DO, because the UI promises exactly this and no
# more: fal only cancels a request that is still IN_QUEUE. Once generation has
# started the job runs to completion and is billed, and the cancel call comes
# back saying so. So this is "stop it if it hasn't started", not "refund it" —
# and the honest outcome is reported back rather than a blanket success.
#
# The row is already marked failed by the browser before this fires. That
# ordering is deliberate: freeing the board must not depend on fal answering,
# or a cancel during a network wobble would leave a clip spinning forever —
# which is the exact failure this feature exists to rescue people from.

CREATIVE_CANCEL_STICKY = """## Creative Cancel

`POST /webhook/arak-creative-cancel` — `{ session_id, version_id }`

Reads the row's `overlay_state.pendingRequest` (written by Creative Video at
submit time) and asks fal to drop that request.

**Cancelling is not a refund.** fal drops a request only while it is still
`IN_QUEUE`; once it is `IN_PROGRESS` the render finishes and is charged.

Outcomes, all returned with `ok: true` because none of them is a fault:
`cancelled` (dropped before it started), `too_late` (400/409 — already
generating), `not_queued` (404 — already finished or already cancelled;
fal removes completed requests from the queue), `no_request` (never reached
fal, so nothing was spent), `error` (fal genuinely unreachable).

Uses `cancel_url` as fal returned it at submit, falling back to the two-segment
queue path. Building that URL by guessing the full model path is what once
broke every video render in this app (405 on the status URL, after the money
was spent), so the returned URL is always preferred.

The version row is ALREADY marked failed by the browser before this runs — it
must not depend on fal replying.

Needs env: FAL_KEY, SUPABASE_URL, SUPABASE_KEY."""

CREATIVE_CANCEL_JS = _CREATIVE_REQ_JS + r"""
const SUP = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = $env.SUPABASE_KEY;
// FAL comes from _CREATIVE_REQ_JS above — declaring it again is a SyntaxError
// that kills the node before any of this runs.

const body = ($input.first().json.body) || {};
const versionId = String(body.version_id || '');

async function run() {
  if (!versionId) return { ok: false, outcome: 'no_version', detail: 'No version_id given.' };

  const rows = await req({ method: 'GET',
    url: SUP + '/rest/v1/creative_versions?id=eq.' + encodeURIComponent(versionId)
      + '&select=id,overlay_state',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }, json: true });

  const row = Array.isArray(rows) ? rows[0] : null;
  const pr = row && row.overlay_state && row.overlay_state.pendingRequest;
  if (!pr || !pr.requestId) {
    // Never reached fal, so there is nothing to cancel and nothing was spent.
    // The commonest case by far: cancelled in the seconds between the row
    // being inserted and the submit coming back.
    return { ok: true, outcome: 'no_request',
             detail: 'No fal request had been recorded, so nothing was submitted.' };
  }

  // Prefer the URL fal handed us. The fallback keeps the first TWO segments of
  // the model path, never the whole thing — the queue is keyed on the app id
  // (fal-ai/kling-video), not the endpoint (…/v2.5-turbo/pro/image-to-video).
  const appId = String(pr.model || '').split('/').slice(0, 2).join('/');
  const url = pr.cancelUrl
    || ('https://queue.fal.run/' + appId + '/requests/' + pr.requestId + '/cancel');

  try {
    // PUT, not POST — POST on this route returns 405.
    const res = await req({ method: 'PUT', url,
      headers: { Authorization: 'Key ' + FAL }, json: true });
    return { ok: true, outcome: 'cancelled', requestId: pr.requestId,
             detail: 'fal accepted the cancellation.', fal: res };
  } catch (e) {
    // Most non-200s here are ordinary answers, not faults, and reporting them
    // as "couldn't reach fal" would be a lie — fal answered, it just didn't
    // say yes. Classified on the status code rather than by matching words in
    // a message, because the two that matter look nothing alike:
    //
    //  · 404 — no such request in the queue. Verified against a finished
    //    render 2026-08-12: fal drops completed requests from the queue, so a
    //    cancel arriving after the render finished reads exactly like this.
    //  · 400/409 — the request exists and is already generating.
    const msg = String((e && e.message) || e);
    const code = (e && (e.statusCode || e.status || (e.response && e.response.status)))
      || Number((msg.match(/\b(\d{3})\b/) || [])[1])
      || 0;

    if (code === 404) {
      return { ok: true, outcome: 'not_queued', requestId: pr.requestId,
               detail: 'fal has no queued request with that id — it had already finished or been cancelled. '
                     + 'If it finished, that take is charged.' };
    }
    if (code === 400 || code === 409) {
      return { ok: true, outcome: 'too_late', requestId: pr.requestId,
               detail: 'fal had already started this render, so it finishes and is charged.' };
    }
    return { ok: true, outcome: 'error', requestId: pr.requestId,
             detail: 'Could not reach fal to cancel: ' + msg };
  }
}

return [{ json: await run() }];
"""


def build_creative_cancel() -> dict:
    """Webhook -> Cancel at fal -> Respond.

    Responds LAST rather than immediately, unlike the render workflows: the
    whole call is one HTTP round-trip to fal and the caller genuinely wants to
    know which of the three outcomes happened.
    """
    nodes = [
        _sticky(CREATIVE_CANCEL_STICKY, height=520, width=470, x=0, y=-320),
        _webhook("arak-creative-cancel", "responseNode", x=0, y=300),
        _code("Cancel at fal", CREATIVE_CANCEL_JS, x=240, y=300),
        _respond_json("Respond", "={{ JSON.stringify($json) }}", x=480, y=300),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Cancel at fal", "type": "main", "index": 0}]]},
        "Cancel at fal": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Creative Cancel",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


# ─── fal balance ────────────────────────────────────────────────────────────
# What is left on the account, shown beside the studio header so the price on
# a Render button can be read against something.
#
# It has to be proxied through here for one reason: FAL_KEY. The balance
# endpoint needs it, the browser must never see it, and this container already
# holds it. A direct call from the app would ship a key that can spend money to
# every browser that loads the page.

FAL_BALANCE_STICKY = """## fal Balance

`POST /webhook/arak-fal-balance` — no payload. Returns `{ balance, currency }`.

Exists purely to keep `FAL_KEY` server-side. The balance endpoint needs the
key; the browser must never hold a credential that can spend money.

`rest.alpha.fal.ai` is fal's own console API, not the documented model API —
it is what the fal CLI reads. Treat it as liable to move: a failure here
returns `{ balance: null }` and the header simply shows nothing, because a
missing number must never be mistaken for a zero balance.

Needs env: FAL_KEY."""

FAL_BALANCE_JS = _CREATIVE_REQ_JS + r"""
// FAL is already declared by _CREATIVE_REQ_JS above.

async function run() {
  try {
    const res = await req({ method: 'GET', url: 'https://rest.alpha.fal.ai/billing/user_balance',
      headers: { Authorization: 'Key ' + FAL } });
    // The endpoint answers with a bare number, not an object.
    const n = typeof res === 'number' ? res : parseFloat(String(res));
    if (!Number.isFinite(n)) return { balance: null, error: 'fal returned no usable balance.' };
    return { balance: n, currency: 'USD' };
  } catch (e) {
    // null, never 0 — "we could not ask" and "you have nothing left" must not
    // look the same to whatever renders this.
    return { balance: null, error: String(e && e.message || e) };
  }
}

return [{ json: await run() }];
"""


def build_fal_balance() -> dict:
    nodes = [
        _sticky(FAL_BALANCE_STICKY, height=380, width=470, x=0, y=-260),
        _webhook("arak-fal-balance", "responseNode", x=0, y=300),
        _code("Read Balance", FAL_BALANCE_JS, x=240, y=300),
        _respond_json("Respond", "={{ JSON.stringify($json) }}", x=480, y=300),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Read Balance", "type": "main", "index": 0}]]},
        "Read Balance": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – fal Balance",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


# ─── Creative Compose ───────────────────────────────────────────────────────
# The ONLY generation-adjacent workflow that costs nothing to run. It stamps
# our own text/logo layer onto a finished clip with local ffmpeg, so changing a
# headline, a font or a colour re-composites the SAME footage in about a second
# instead of buying a new take that comes back visibly different.
#
# This node builds a shell script; "Composite" runs it. Splitting it that way is
# deliberate — the per-overlay filter chain is real logic (timing, fades, layer
# order) that belongs in JS, while the crop has to be computed from the clip's
# ACTUAL dimensions, which nothing knows until ffprobe has run. So the JS emits
# a script with ${TW}/${TH} left as shell variables and the script fills them in.
CREATIVE_COMPOSE_JS = r"""
const body = ($input.first().json.body) || {};
const sessionId = String(body.session_id || '');
const versionId = String(body.version_id || '');
const overlays  = Array.isArray(body.overlays) ? body.overlays : [];
const BUCKET = 'creative-studio';

// Everything below is interpolated into a shell command, so every URL is
// checked twice: it must live in OUR OWN storage bucket, and it must contain
// nothing that could end the argument and start a new command. `creative_versions`
// is client-writable by design (the browser sets image_url/status itself), so a
// workspace member could otherwise put a shell payload in a row and have n8n —
// which holds the service_role key — run it. The allowlist has no quote,
// backtick, dollar, semicolon, backslash or space in it.
const SUP = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const PREFIX = SUP + '/storage/v1/object/public/';
function safeUrl(u, what) {
  const s = String(u || '');
  if (!s.startsWith(PREFIX)) throw new Error(what + ' is not a file in our own storage.');
  if (!/^[A-Za-z0-9:/._~%()-]+$/.test(s)) throw new Error(what + ' contains characters we will not put in a shell command.');
  return s;
}

const videoUrl = safeUrl(body.video_url, 'The clip');
if (!versionId) throw new Error('No version to write the result back to.');
if (!overlays.length) throw new Error('Nothing to composite onto the clip.');

// ── Trim ──
// Which part of the clip ships, in seconds of SOURCE time. Absent means all of
// it, which is every request made before trimming existed.
//
// The editor authors layer cues against the clip as rendered, so trimming the
// front does NOT move them in the document — it moves them here, once, because
// the trimmed output's t=0 is the source's t=trimStart. Doing the shift in the
// document instead would silently rewrite every cue the moment a handle moved.
const trimStart = Math.max(0, Number(body.trim_start) || 0);
const rawTrimEnd = body.trim_end;
const trimEnd = rawTrimEnd === null || rawTrimEnd === undefined || rawTrimEnd === ''
  ? null : Math.max(0, Number(rawTrimEnd) || 0);
if (trimEnd !== null && trimEnd <= trimStart) throw new Error('The trim ends before it starts.');
const trimmed = trimStart > 0 || trimEnd !== null;

// A layer that lives entirely in the trimmed-away part is dropped rather than
// shifted. Without this its cues both clamp to 0 and `between(t,0,0)` flashes
// it for a single frame at the very start of the video — a layer the marketer
// deliberately cut, reappearing.
const kept = overlays.filter(function (o) {
  const sIn = Math.max(0, Number(o.t_in) || 0);
  const hasOut = o.t_out !== null && o.t_out !== undefined && o.t_out !== '';
  const sOut = hasOut ? Number(o.t_out) : null;
  if (sOut !== null && sOut <= trimStart) return false;
  if (trimEnd !== null && sIn >= trimEnd) return false;
  return true;
});
if (!kept.length) throw new Error('Every layer sits outside the part of the clip you kept, so there is nothing to composite.');

// ── the filter chain ──
// Overlays arrive back-to-front, matching the editor's own layer order, and
// each is chained onto the previous result so stacking survives the round trip.
const num = n => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);

// ── Motion ──
// `overlay` takes expressions in `t` for x and y, which is what makes an
// animated headline free: no per-frame rendering, no second pass, just a
// longer string in a filter chain that already exists.
//
// The curve is ease-out cubic written as REMAINING travel — pow(1-p,3) — which
// is character-for-character the shape model/playback.js uses for the preview.
// If one of the two is ever changed, the other has to change with it or the
// editor starts lying about what will ship.
//
// Distance is 6% of the OVERLAY's height on both axes, matching MOTION_DISTANCE
// there, so a slide reads as the same gesture whatever shape the frame is.
const MOTION_VECTORS = {
  rise: [0, 1], fall: [0, -1], 'slide-left': [1, 0], 'slide-right': [-1, 0],
};
const MOTION_FRACTION = 0.06;

// Progress ramps clamped to [0,1] so the expression is flat outside its own
// window — ffmpeg evaluates this on every frame of the clip, not just during
// the ramp.
//
// Commas are left BARE. The whole expression is wrapped in single quotes at
// the call site, which is how the `enable=` option next to it has always
// protected its own commas; adding backslash escapes on top would survive the
// quote stripping and reach the expression evaluator as literal backslashes.
function rampIn(tIn, d) {
  return 'pow(1-min(max((t-' + num(tIn) + ')/' + num(d) + ',0),1),3)';
}
function rampOut(tOut, d) {
  return 'pow(1-min(max((' + num(tOut) + '-t)/' + num(d) + ',0),1),3)';
}

// Returns { x, y } as ffmpeg expressions, or null when nothing moves — in
// which case the caller keeps the plain `overlay=0:0` it always emitted.
function motionExpr(anim, tIn, tOut, hasOut) {
  if (!anim) return null;
  const vIn = MOTION_VECTORS[anim.in];
  const vOut = hasOut ? MOTION_VECTORS[anim.out] : null;
  if (!vIn && !vOut) return null;
  const d = Math.max(0.05, Number(anim.duration) || 0.4);
  // 'H' is the overlay input's height in overlay's expression vocabulary; the
  // travel therefore scales with the frame instead of being baked in pixels.
  const travel = '(H*' + MOTION_FRACTION + ')';
  const axis = i => {
    const terms = [];
    if (vIn && vIn[i]) terms.push((vIn[i] > 0 ? '' : '-') + travel + '*' + rampIn(tIn, d));
    // Negated, so on the way out it keeps going the way it came in rather
    // than reversing back over its own path.
    if (vOut && vOut[i]) terms.push((vOut[i] > 0 ? '-' : '') + travel + '*' + rampOut(tOut, d));
    return terms.length ? terms.join('+') : '0';
  };
  return { x: axis(0), y: axis(1) };
}
const lines = ['[0:v]crop=${TW}:${TH}:${OX}:${OY},setsar=1[base]'];
let prev = 'base';
const fetches = [];

kept.forEach((o, i) => {
  const url = safeUrl(o.url, 'An overlay');
  fetches.push('wget -q -O ovl' + i + '.png ' + url);

  // Source time in, output time out. A cue that started 1.2s into a clip whose
  // first second was trimmed away starts 0.2s into what ships.
  const srcIn = Math.max(0, Number(o.t_in) || 0);
  const hasSrcOut = o.t_out !== null && o.t_out !== undefined && o.t_out !== '';
  const srcOut = hasSrcOut ? Number(o.t_out) : null;

  const tIn = Math.max(0, srcIn - trimStart);
  // A layer that ran to the end of the clip still runs to the end of the
  // trimmed clip — `null` has to survive the shift, or trimming would pin
  // every open-ended cue to a number and stop it following a re-render.
  const hasOut = hasSrcOut;
  const tOut = hasOut ? Math.max(0, srcOut - trimStart) : null;
  const fade = Math.max(0, Number(o.fade) || 0);

  let f = '[' + (i + 1) + ':v]scale=${TW}:${TH},format=rgba';
  if (fade > 0) {
    f += ',fade=t=in:st=' + num(tIn) + ':d=' + num(fade) + ':alpha=1';
    if (hasOut) f += ',fade=t=out:st=' + num(tOut - fade) + ':d=' + num(fade) + ':alpha=1';
  }
  lines.push(f + '[o' + i + ']');

  const mv = motionExpr(o.anim, tIn, tOut, hasOut);
  let ov = '[' + prev + '][o' + i + ']overlay='
    + (mv ? "x='" + mv.x + "':y='" + mv.y + "'" : '0:0') + ':format=auto';
  // Only gate a layer that actually comes and goes. `enable` is evaluated per
  // frame, and a full-length layer would pay for an expression that is always
  // true — which is the common case by a wide margin.
  if (hasOut)      ov += ":enable='between(t," + num(tIn) + ',' + num(tOut) + ")'";
  else if (tIn > 0) ov += ":enable='gte(t," + num(tIn) + ")'";
  lines.push(ov + '[v' + i + ']');
  prev = 'v' + i;
});

const inputs = kept.map((_, i) => '-loop 1 -framerate "$FPS" -i ovl' + i + '.png').join(' ');
const filter = lines.join(';');

const filename = (sessionId ? sessionId + '/' : '') + versionId + '-' + Date.now() + '.mp4';

// Work inside ~/.n8n-files, NOT /tmp. n8n's `restrictFileAccessTo` defaults to
// '~/.n8n-files', and the Read File node downstream refuses anything outside it
// with "Access to the file is not allowed." — a message that says nothing about
// paths. Using the directory n8n already sanctions means the default protection
// stays on for the whole rest of the filesystem instead of being widened.
// $HOME is only known to the shell, so the script prints the resolved path back
// and the parser reads it from stdout.
const dir = '"$HOME/.n8n-files/compose/' + versionId + '"';

// `set -e` plus an explicit COMPOSE_OK sentinel: ffmpeg exits 0 in some partial
// failures, so a zero exit code alone is not evidence that a file was written.
const script = [
  'set -e',
  // Composited clips are a few MB each and nothing else ever deletes them, so
  // the volume would grow without bound. Anything older than 3 hours is well
  // past the seconds this workflow needs it for.
  'find "$HOME/.n8n-files/compose" -maxdepth 1 -mindepth 1 -type d -mmin +180 -exec rm -rf {} + 2>/dev/null || true',
  'rm -rf ' + dir + ' && mkdir -p ' + dir + ' && cd ' + dir,
  'wget -q -O clip.mp4 ' + videoUrl,
  fetches.join('\n'),
  // Never trust the caller for geometry — the row is client-writable and the
  // model may not have honoured the aspect ratio we asked for anyway.
  'CW=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 clip.mp4)',
  'CH=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 clip.mp4)',
  'FPS=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 clip.mp4)',
  'DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 clip.mp4)',
  // The trimmed length, computed in the shell because only it has the probed
  // duration. awk rather than $(( )) — busybox sh does integer arithmetic only,
  // and a clip is 8.04 seconds, not 8.
  ...(trimmed ? [
    'KEEP=$(awk -v d="$DUR" -v s=' + num(trimStart)
      + ' -v e=' + (trimEnd === null ? '-1' : num(trimEnd))
      + ' \'BEGIN{ end = (e < 0 ? d : (e < d ? e : d)); k = end - s; if (k < 0.1) k = 0.1; printf "%.3f", k }\')',
  ] : []),
  'OW=$(ffprobe -v error -select_streams v:0 -show_entries stream=width  -of csv=p=0 ovl0.png)',
  'OH=$(ffprobe -v error -select_streams v:0 -show_entries stream=height -of csv=p=0 ovl0.png)',
  // Centre-crop the CLIP to the OVERLAY's aspect. The overlay was composed
  // against the still, and the clip comes back in whatever shape the model
  // would accept (a 4:5 session renders 3:4 on Seedance, 9:16 on Veo), so this
  // is what makes the text land where the marketer put it. A no-op when the two
  // already agree. Integer arithmetic only — this runs under busybox sh — and
  // both results forced even, because yuv420p subsamples chroma and rejects
  // odd dimensions.
  'if [ $((CW*OH)) -gt $((CH*OW)) ]; then TH=$CH; TW=$((CH*OW/OH)); else TW=$CW; TH=$((CW*OH/OW)); fi',
  'TW=$((TW/2*2)); TH=$((TH/2*2))',
  'OX=$(((CW-TW)/2)); OY=$(((CH-TH)/2))',
  // -loop 1 matters: a bare PNG is one frame at t=0, and `fade` needs a stream
  // with timestamps to fade along. -t bounds the otherwise infinite loops.
  // -c:a copy rather than re-encode: Seedance's native audio is the one thing a
  // free composite must not quietly degrade.
  // `-ss` goes BEFORE `-i` so the decoder seeks rather than decoding and
  // discarding everything up to the in point — on a 30s clip trimmed to its
  // last five seconds that is the difference between a second and half a
  // minute. Modern ffmpeg is still frame-accurate there; the old
  // keyframe-rounding caveat applies to `-ss` used as an output option.
  //
  // It applies to input 0 ONLY. The overlay PNGs are `-loop 1` streams with no
  // meaningful timeline of their own, and seeking them would be meaningless;
  // their cues were already shifted onto output time above.
  //
  // Audio is still `-c:a copy` — a stream copy cut at an arbitrary point can
  // only start at an audio frame boundary, which is a few milliseconds, and
  // re-encoding the model's own audio to save that is a bad trade.
  'ffmpeg -nostdin -v error -y ' + (trimStart > 0 ? '-ss ' + num(trimStart) + ' ' : '') + '-i clip.mp4 ' + inputs +
    ' -filter_complex "' + filter + '"' +
    ' -map "[' + prev + ']" -map 0:a? -t "' + (trimmed ? '$KEEP' : '$DUR') + '"' +
    ' -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a copy -movflags +faststart out.mp4',
  'test -s out.mp4',
  // The path is echoed rather than predicted because only the shell knows what
  // $HOME expanded to.
  'echo "COMPOSE_OK $PWD/out.mp4"',
].join('\n');

return { json: { script, version_id: versionId, bucket: BUCKET, filename } };
"""

# Reads the shell step's result. Kept separate from the Code node above so the
# failure path can say what ffmpeg actually complained about instead of "exit 1".
CREATIVE_COMPOSE_PARSE_JS = r"""
const src = $('Build Composite').first().json;
const res = $input.first().json || {};
// The sentinel carries the absolute path with it, because $HOME is resolved by
// the shell and the file has to land inside ~/.n8n-files for the Read File node
// to be allowed to touch it at all.
const hit = String(res.stdout || '').match(/COMPOSE_OK\s+(\S+)/);

if (!hit) {
  // stderr's LAST lines are the useful ones — ffmpeg prints the failing filter
  // or the missing file at the end, after any banner noise.
  const err = String(res.stderr || res.stdout || '').trim().split('\n').slice(-4).join(' ').slice(0, 500);
  return { json: { _ok: false, version_id: src.version_id,
                   error: err || ('Compositing failed (exit ' + res.exitCode + ').') } };
}
return { json: { _ok: true, version_id: src.version_id, bucket: src.bucket,
                 filename: src.filename, path: hit[1] } };
"""


# ── Creative Stitch ────────────────────────────────────────────────────────
# Joins a multi-clip storyboard's finished clips into one reel.
#
# TWO executeCommand nodes rather than Compose's one, and the reason is
# arithmetic. Compose only ever does integer crop geometry, which busybox sh
# handles. Stitching needs cumulative crossfade offsets over FLOAT durations
# (`ffprobe format=duration` returns 5.033333), and `$(( ))` is integer-only —
# doing it in the shell means splitting every duration on '.', reassembling
# milliseconds, and dodging octal on zero-prefixed fractions, per clip, in a
# cumulative loop. So: pass 1 downloads and probes and echoes machine-readable
# lines, a Code node does every float calculation in JS, and pass 2 runs with
# all the numbers already baked in as literals. Both passes cd into the same
# directory, so nothing is downloaded twice.

CREATIVE_STITCH_FETCH_JS = r"""
const body = ($input.first().json.body) || {};
const sessionId = String(body.session_id || '');
const versionId = String(body.version_id || '');
const clips = Array.isArray(body.clips) ? body.clips : [];
const BUCKET = 'creative-studio';
const MAX_CLIPS = 12;   // must match MULTI_CLIP_MAX in src/lib/creativeStoryboard.js

// Identical guard to Creative Compose's, and load-bearing for the same
// reason: creative_versions is client-writable by design (the browser sets
// image_url/status itself), these URLs are interpolated into a shell string,
// and n8n holds the service_role key. The allowlist contains no quote,
// backtick, dollar, semicolon, backslash or space.
const SUP = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const PREFIX = SUP + '/storage/v1/object/public/';
function safeUrl(u, what) {
  const s = String(u || '');
  if (!s.startsWith(PREFIX)) throw new Error(what + ' is not a file in our own storage.');
  if (!/^[A-Za-z0-9:/._~%()-]+$/.test(s)) throw new Error(what + ' contains characters we will not put in a shell command.');
  return s;
}

if (!versionId) throw new Error('No version to write the result back to.');
if (clips.length < 2) throw new Error('A reel needs at least two clips.');
if (clips.length > MAX_CLIPS) throw new Error('That is more clips than this can join at once (' + MAX_CLIPS + ').');

// Filenames are OURS, never derived from the URL — one less thing the caller
// can steer. Position in this array is the cut order and the only ordering
// that exists downstream.
const plan = clips.map((c, i) => {
  const t = c.transition === 'crossfade' ? 'crossfade' : 'cut';
  let d = Number(c.transition_duration);
  if (!isFinite(d)) d = 0.5;
  // How much of this shot's own footage to keep, in seconds. Absent means all
  // of it, which is every request made before the reel could be trimmed.
  // Applied during normalisation below, where each clip is already being
  // re-encoded — so a trim costs nothing at all, unlike shortening a shot by
  // re-rendering it.
  const ts = Math.max(0, Number(c.trim_start) || 0);
  const rawEnd = c.trim_end;
  const te = rawEnd === null || rawEnd === undefined || rawEnd === ''
    ? null : Math.max(0, Number(rawEnd) || 0);
  if (te !== null && te <= ts) throw new Error('Clip ' + (i + 1) + ' is trimmed to nothing.');
  return {
    file: 'c' + i + '.mp4',
    url: safeUrl(c.url, 'Clip ' + (i + 1)),
    // The seam BEFORE this clip. Clip 0 has none.
    transition: i === 0 ? 'cut' : t,
    fade: Math.min(2, Math.max(0.1, d)),
    trimStart: ts,
    trimEnd: te,
  };
});

const dir = '"$HOME/.n8n-files/stitch/' + versionId + '"';

const lines = [
  'set -e',
  // Same 3-hour sweep as Compose: a reel's working directory holds every clip
  // plus a normalised copy of each plus the output, so a few runs is a few
  // hundred MB and nothing else ever deletes them.
  'find "$HOME/.n8n-files/stitch" -maxdepth 1 -mindepth 1 -type d -mmin +180 -exec rm -rf {} + 2>/dev/null || true',
  'rm -rf ' + dir + ' && mkdir -p ' + dir + ' && cd ' + dir,
];

for (const p of plan) {
  lines.push('wget -q -O ' + p.file + ' ' + p.url);
  // busybox wget can exit 0 having written nothing; ffprobe's error on an
  // empty file says far less than this does.
  lines.push('test -s ' + p.file + ' || { echo "EMPTY ' + p.file + '" >&2; exit 1; }');
}

lines.push('echo "PROBE_BEGIN"');
for (const p of plan) {
  lines.push([
    'W=$(ffprobe -v error -select_streams v:0 -show_entries stream=width        -of csv=p=0 ' + p.file + ')',
    'H=$(ffprobe -v error -select_streams v:0 -show_entries stream=height       -of csv=p=0 ' + p.file + ')',
    'R=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of csv=p=0 ' + p.file + ')',
    // format=duration, not stream=duration: it is the container duration, which
    // is what xfade actually measures against, and stream=duration is missing
    // on some muxers.
    'D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 ' + p.file + ')',
    // Empty when the clip has no audio track at all — the case that silently
    // breaks concat if it is not handled in the normalise pass.
    'A=$(ffprobe -v error -select_streams a:0 -show_entries stream=index -of csv=p=0 ' + p.file + ' || true)',
    'printf "%s|%s|%s|%s|%s|%s\\n" "' + p.file + '" "$W" "$H" "$R" "$D" "${A:-none}"',
  ].join('\n'));
}
lines.push('echo "PROBE_OK $PWD"');

const filename = (sessionId ? sessionId + '/' : '') + versionId + '-' + Date.now() + '.mp4';

return { json: {
  script: lines.join('\n'),
  version_id: versionId, bucket: BUCKET, filename,
  plan,
} };
"""


CREATIVE_STITCH_PLAN_JS = r"""
const src = $('Build Fetch').first().json;
const res = $input.first().json || {};
const stdout = String(res.stdout || '');

function bail(msg) {
  return { json: { _ok: false, version_id: src.version_id, error: String(msg).slice(0, 500) } };
}

const okHit = stdout.match(/PROBE_OK\s+(\S+)/);
if (!okHit) {
  const err = String(res.stderr || stdout || '').trim().split('\n').slice(-4).join(' ');
  return bail(err || ('Downloading the clips failed (exit ' + res.exitCode + ').'));
}
const cwd = okHit[1];

// ── Read the probe back ──
const rows = new Map();
for (const line of stdout.split('\n')) {
  const parts = line.trim().split('|');
  if (parts.length !== 6) continue;
  const [file, w, h, r, d, a] = parts;
  rows.set(file, {
    w: parseInt(w, 10), h: parseInt(h, 10),
    fps: String(r || '').trim(),
    dur: parseFloat(d),
    hasAudio: a !== 'none' && a !== '',
  });
}

const plan = src.plan.map(p => {
  const probe = rows.get(p.file);
  if (!probe || !probe.w || !probe.h || !isFinite(probe.dur) || probe.dur <= 0) {
    throw new Error('Could not read the size or length of ' + p.file + '.');
  }
  // The trim resolved against what the file turned out to be. ffprobe has the
  // last word here rather than the browser: the editor's figure came from
  // metadata, and a clip that reported one length while loading and another
  // once complete would put every seam after it in the wrong place.
  //
  // `dur` is overwritten with the KEPT length deliberately — every downstream
  // calculation (the segment runs, the xfade offset recurrence, the expected
  // total) is about what ends up in the reel, and leaving the full length in
  // there would put a crossfade past the end of a trimmed stream, which ffmpeg
  // renders as a frozen frame or a black gap without erroring.
  const start = Math.min(Math.max(0, p.trimStart || 0), Math.max(0, probe.dur - 0.1));
  const end = p.trimEnd === null || p.trimEnd === undefined
    ? probe.dur : Math.min(p.trimEnd, probe.dur);
  const kept = Math.max(0.1, end - start);
  return { ...p, ...probe, srcDur: probe.dur, trimStart: start, dur: kept };
});

// ── Target geometry ──
// The LARGEST clip by pixel area, not the first: a 480p draft in the middle
// of the reel should not drag every other clip down to its size. Both forced
// even because yuv420p subsamples chroma and rejects odd dimensions.
let target = plan[0];
for (const p of plan) if (p.w * p.h > target.w * target.h) target = p;
const TW = target.w - (target.w % 2);
const TH = target.h - (target.h % 2);

// r_frame_rate is a FRACTION ('30000/1001'). Compared as a number, handed to
// ffmpeg as the original string — converting it to a decimal is how you get
// drift over a two-minute reel.
function fpsValue(f) {
  const m = String(f).split('/');
  const n = parseFloat(m[0]);
  const d = m.length > 1 ? parseFloat(m[1]) : 1;
  return d ? n / d : n;
}
let FPS = plan[0].fps;
for (const p of plan) if (fpsValue(p.fps) > fpsValue(FPS)) FPS = p.fps;
if (!/^\d+(\/\d+)?$/.test(FPS)) FPS = '30';

// Letterbox rather than crop when a clip came back a different shape — a crop
// silently eats whatever was at the edge of the frame, including composed text.
const ASPECT_TOLERANCE = 0.02;
const targetAspect = TW / TH;
const oddOnes = plan
  .map((p, i) => ({ i, off: Math.abs((p.w / p.h) - targetAspect) / targetAspect }))
  .filter(x => x.off > ASPECT_TOLERANCE)
  .map(x => x.i + 1);
const warning = oddOnes.length
  ? 'Clip' + (oddOnes.length > 1 ? 's ' : ' ') + oddOnes.join(', ') +
    ' came back a different shape and will be letterboxed. Re-render them to match.'
  : '';

// Any real audio anywhere changes how the joins are done — see below.
const anyRealAudio = plan.some(p => p.hasAudio);

// ── Segments ──
// A run of clips joined by hard cuts is ONE segment, concatenated with no
// transition at all. A crossfade seam starts a new segment. Doing cuts this
// way rather than as a 1-frame xfade matters: xfade rejects duration=0, and a
// 0.03s "cut" blends two frames, which is visible between different scenes.
const segments = [];
plan.forEach((p, i) => {
  // Clip 0 opens the first segment; after that only a crossfade seam starts a
  // new one. A cut just extends the segment it lands in.
  if (i === 0 || p.transition === 'crossfade') {
    segments.push({ members: [i], dur: p.dur, fade: i === 0 ? 0 : p.fade, offset: 0 });
  } else {
    const seg = segments[segments.length - 1];
    seg.members.push(i);
    seg.dur += p.dur;
  }
});

// ── The offset recurrence ──
// xfade's `offset` is measured on the ACCUMULATED stream, and that stream has
// already been shortened by every previous fade. So the running total carries
// the subtraction with it rather than each offset being computed from raw
// durations. Getting this wrong puts a transition past the end of the stream,
// which ffmpeg renders as a frozen frame or a black gap WITHOUT erroring.
const r3 = n => Math.round(n * 1000) / 1000;
let acc = segments[0].dur;
for (let i = 1; i < segments.length; i++) {
  // Both sides have to outlast the fade or the overlap runs off an end.
  const f = Math.min(segments[i].fade, 0.5 * segments[i - 1].dur, 0.5 * segments[i].dur);
  segments[i].fade = r3(f);
  segments[i].offset = r3(acc - f);
  acc = acc + segments[i].dur - f;
}
const expected = r3(acc);

// ── The script ──
const scale = 'scale=' + TW + ':' + TH + ':force_original_aspect_ratio=decrease,' +
              'pad=' + TW + ':' + TH + ':(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=' + FPS + ',format=yuv420p';
const VENC = '-c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p';
const AENC = '-c:a aac -b:a 128k -ar 48000 -ac 2';

const lines = ['set -e', 'cd "' + cwd + '"'];

// ── Normalise ──
// Every clip is re-encoded to one shape, one frame rate, one sample rate and
// one channel layout. The audio half is the part that is easy to skip and
// breaks everything: a reel where some clips have sound and some do not comes
// out with audio on the first segment only, because concat matches streams by
// index. anullsrc gives the silent ones a real track to match against.
// The trim rides along on the normalise pass that was happening anyway, which
// is what makes it free: `-ss` before `-i` so the decoder seeks instead of
// decoding and throwing frames away, and `-t` on the output to stop at the
// kept length. A clip with no trim gets neither flag and the command is
// character-for-character what it always was.
const r2 = n => (Math.round((Number(n) || 0) * 1000) / 1000).toFixed(3);
const cutIn = p => (p.trimStart > 0 ? '-ss ' + r2(p.trimStart) + ' ' : '');
const cutLen = p => (p.dur < p.srcDur - 0.02 ? ' -t ' + r2(p.dur) : '');

plan.forEach((p, i) => {
  const out = 'n' + i + '.mp4';
  if (p.hasAudio) {
    lines.push(
      'ffmpeg -nostdin -v error -y ' + cutIn(p) + '-i ' + p.file +
      cutLen(p) +
      ' -vf "' + scale + '"' +
      // apad + -shortest forces the audio to be exactly as long as the video
      // even when the source's track is a few ms short. That equality is what
      // keeps acrossfade (which has no offset of its own) locked to xfade
      // (which does) at every seam.
      ' -af "aresample=48000,apad" -shortest ' +
      VENC + ' ' + AENC + ' -movflags +faststart ' + out);
  } else {
    lines.push(
      'ffmpeg -nostdin -v error -y ' + cutIn(p) + '-i ' + p.file +
      ' -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000' +
      ' -map 0:v -map 1:a -shortest' + cutLen(p) +
      ' -vf "' + scale + '" ' +
      VENC + ' ' + AENC + ' -movflags +faststart ' + out);
  }
});

if (segments.length === 1 && !anyRealAudio) {
  // Every clip is now byte-compatible and the silence is ours, so the demuxer
  // can stream-copy: instant, and not a second generation of encoding.
  //
  // Only when there is no REAL audio. AAC encoder priming leaves a ~20ms gap
  // at each stream-copied join — inaudible across anullsrc silence, an audible
  // click across actual sound.
  lines.push('rm -f list.txt');
  segments[0].members.forEach(i => lines.push("printf \"file 'n" + i + ".mp4'\\n\" >> list.txt"));
  lines.push('ffmpeg -nostdin -v error -y -f concat -safe 0 -i list.txt -c copy -movflags +faststart out.mp4');
} else {
  // One filter graph: each segment concatenated from its members, then the
  // segments crossfaded together pairwise.
  const inputs = plan.map((_, i) => '-i n' + i + '.mp4').join(' ');
  const parts = [];

  segments.forEach((seg, s) => {
    const feed = seg.members.map(i => '[' + i + ':v][' + i + ':a]').join('');
    parts.push(feed + 'concat=n=' + seg.members.length + ':v=1:a=1[s' + s + 'v][s' + s + 'a]');
  });

  let vPrev = 's0v';
  let aPrev = 's0a';
  for (let s = 1; s < segments.length; s++) {
    parts.push('[' + vPrev + '][s' + s + 'v]xfade=transition=fade:duration=' +
               segments[s].fade.toFixed(3) + ':offset=' + segments[s].offset.toFixed(3) + '[x' + s + 'v]');
    // Mirrors the video chain structurally but carries no offset of its own:
    // acrossfade always joins at the end of its first input, and because every
    // clip's audio is exactly as long as its video, both chains shorten by the
    // same amount at every seam and stay in sync.
    parts.push('[' + aPrev + '][s' + s + 'a]acrossfade=d=' + segments[s].fade.toFixed(3) + ':c1=tri:c2=tri[x' + s + 'a]');
    vPrev = 'x' + s + 'v';
    aPrev = 'x' + s + 'a';
  }

  lines.push(
    'ffmpeg -nostdin -v error -y ' + inputs +
    ' -filter_complex "' + parts.join(';') + '"' +
    ' -map "[' + vPrev + ']" -map "[' + aPrev + ']" ' +
    VENC + ' ' + AENC + ' -movflags +faststart out.mp4');
}

lines.push('test -s out.mp4');
lines.push('OUTDUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 out.mp4)');
// set -e plus a sentinel, for the reason Compose documents: ffmpeg exits 0 on
// some partial failures, so a zero exit code alone is not evidence a usable
// file was written. The measured duration rides along so the parser can catch
// a segment that vanished.
lines.push('echo "STITCH_OK $PWD/out.mp4 $OUTDUR"');

return { json: {
  _ok: true,
  script: lines.join('\n'),
  version_id: src.version_id, bucket: src.bucket, filename: src.filename,
  expected_duration: expected,
  warning,
} };
"""


CREATIVE_STITCH_PARSE_JS = r"""
const src = $('Plan Stitch').first().json;
const res = $input.first().json || {};
const hit = String(res.stdout || '').match(/STITCH_OK\s+(\S+)\s+(\S+)/);

if (!hit) {
  const err = String(res.stderr || res.stdout || '').trim().split('\n').slice(-4).join(' ').slice(0, 500);
  return { json: { _ok: false, version_id: src.version_id,
                   error: err || ('Joining the clips failed (exit ' + res.exitCode + ').') } };
}

// A dropped segment is the failure mode that does NOT announce itself: the
// filter graph runs, ffmpeg exits 0, and the reel is simply missing a shot.
// The only thing that catches it is comparing what came out against what the
// arithmetic said should. Three quarters of a second is well past rounding
// and well under the shortest clip any model here produces.
const measured = parseFloat(hit[2]);
const expected = Number(src.expected_duration);
if (isFinite(measured) && isFinite(expected) && Math.abs(measured - expected) > 0.75) {
  return { json: { _ok: false, version_id: src.version_id,
                   error: 'The joined video came out ' + measured.toFixed(1) + 's long but should be ' +
                          expected.toFixed(1) + 's — a clip was dropped. Nothing was saved.' } };
}

return { json: { _ok: true, version_id: src.version_id, bucket: src.bucket,
                 filename: src.filename, path: hit[1], warning: src.warning || '' } };
"""


CREATIVE_ENHANCE_STICKY = """## Creative Studio — Enhance Prompt

POST `arak-creative-enhance`

**Synchronous**, unlike the other three Creative workflows: this is a ~2s text
call whose answer goes straight back into the composer's text box, so there is
no pending row to insert and nothing to poll. Same shape as Elongate Idea.

Turns a rough brief into a written prompt. Two modes:
- `image` — fills in lighting, framing, materials, colour temperature. Never
  changes the subject, and never adds text to the image (words go on later as
  a real editable layer, so baked-in text would be unusable).
- `motion` — camera movement and motion only, max 40 words. The still already
  exists; restating the scene fights the source frame.

Model is `claude-sonnet-5` with thinking **explicitly disabled** and low effort.
Both matter: Sonnet 5 runs adaptive thinking when `thinking` is omitted, which
triples the latency of a button the user is waiting on and shares `max_tokens`
with the answer. Low effort also keeps it filling gaps instead of embellishing
past the brief — the failure mode that makes a prompt enhancer useless.

The result is ALWAYS shown in the composer before anything generates. This
workflow never triggers a generation itself.
"""

# safeJson is defined inline in the older Code bodies but NOT in the shared
# creative request preamble, so Enhance — which now parses a JSON contract to
# report brand conflicts — brings its own copy.
_SAFE_JSON_JS = r"""
function safeJson(t){
  const c = String(t||'').replace(/```json|```/g,'').trim();
  try { return JSON.parse(c); } catch(e){
    const m = c.match(/\{[\s\S]*\}/);
    if(m){ try { return JSON.parse(m[0]); } catch(_){} }
    return {};
  }
}
"""

CREATIVE_ENHANCE_JS = _with_brand(_CREATIVE_REQ_JS + _SAFE_JSON_JS + r"""
const ANTHROPIC = $env.ANTHROPIC_API_KEY;

const body = ($input.first().json.body) || {};
const mode         = body.mode === 'motion' ? 'motion' : 'image';
const rawPrompt    = String(body.prompt || '').trim();
const aspect       = body.aspect_ratio || '1:1';
const duration     = String(body.duration || '5');
const instructions = String(body.instructions || '').trim();
const refNotes     = String(body.reference_notes || '').trim();
const hasReference = !!body.has_reference;
const sourcePrompt = String(body.source_prompt || '').trim();

if (!rawPrompt) return [{ json: { ok: false, error: 'Nothing to enhance yet.' } }];

// Cached prefix: identical on every click, so it carries the whole rule set
// plus brand context. Sonnet 5 needs a 1024-token prefix to cache at all — if
// usage.cache_read_input_tokens stays 0 across clicks, this is under the floor
// and the breakpoint is only paying the write premium; drop it then.
const IMAGE_RULES = `You rewrite rough image briefs into precise prompts for an AI image generator, for ${brandPersona(body)}.

Rules, in priority order:

1. NEVER change the subject. Elaborate what the requester actually asked for. Do not substitute a different idea, setting or mood, however much better it would be.
2. Do NOT put text, lettering, captions or typography in the image unless the requester explicitly asked for it. Words are added afterwards as a real editable text layer, so an image generated with baked-in text is unusable. If they DID ask for text in the scene, quote their exact string verbatim (Arabic included, character for character) and add: render this text exactly — no other text anywhere in the image.
3. Add the concrete detail a photographer would need for THIS subject: lighting quality and direction, colour temperature (2700K warm through 4000K neutral to 5000K cool), time of day, lens and framing, surface and material behaviour, depth of field. Ground every choice in the actual subject in front of the camera — the correct detail for a treatment room, a garment on a rail, or an illuminated facade is not the same detail.
4. Fill gaps only. Leave subject, setting and mood exactly as stated. If a detail was not implied by the requester or by the brand context, do not invent it.
5. 60–120 words. Do not pad to reach a length; a brief that needed little may come back short.
6. Write flowing descriptive prose, not a keyword list.

${__PROMPT_RULES__}`;

const MOTION_RULES = `You rewrite rough animation notes into motion prompts for an AI image-to-video model (Seedance, 2–12 second clips), for ${brandOnly(body)}.

The still image already exists. Rules:

1. Describe CAMERA MOVEMENT AND MOTION ONLY. Do not re-describe the subject, the lighting or the setting — they are already in the frame, and restating them fights the source image.
2. One movement, paced to the clip length. A 5-second clip gets one slow move, not three.
3. House style: slow cinematic pan, gentle dolly in, subtle parallax, soft light bloom, drifting shadow.
4. Never mention text, captions or titles. Text is composited onto the finished clip afterwards.
5. Maximum 40 words.`;

// Enhance already runs before generation, already receives both the brief and
// the brand context, and already returns without spending anything on an
// image. That makes it the one place a brand-vs-prompt conflict can be
// surfaced BEFORE the paid round, without adding a call of its own.
//
// It reports rather than resolves: sometimes the contradiction is deliberate
// (a Ramadan piece that deliberately drops the usual palette), so the
// rewritten prompt still follows the requester's ask per the precedence
// rules — the flag just makes the divergence visible and reversible.
const OUTPUT_CONTRACT = `

Return ONLY valid JSON, no markdown fences, exactly this shape:
{"prompt":"the rewritten prompt text, nothing else",
 "conflicts":[{"field":"what the brand defines, e.g. brand colours","brandRule":"what the brand context says, quoted briefly","promptAsks":"what the requester asked for instead"}]}

"conflicts" lists only DIRECT contradictions between the requester's brief and a brand DEFAULT — a colour, tone, style or format the brand states and the brief overrides. Do not list gaps the brief simply left unspecified, and never list a brand guardrail (those are absolute and you must follow them regardless). Most briefs conflict with nothing: return an empty array.`;

const cachedPrefix = (mode === 'motion' ? MOTION_RULES : IMAGE_RULES)
  + (instructions ? '\n\nBRAND CONTEXT:\n' + instructions : '')
  + OUTPUT_CONTRACT;

let variable;
if (mode === 'motion') {
  variable = 'THE STILL IT ANIMATES:\n' + (sourcePrompt || '(not recorded)') + '\n\n'
    + 'CLIP LENGTH: ' + duration + ' seconds\n\n'
    + 'THEIR ANIMATION NOTE:\n"' + rawPrompt + '"';
} else {
  variable = 'FRAME SHAPE: ' + aspect + '\n'
    + (hasReference
        ? 'A REFERENCE IMAGE IS ATTACHED (inspiration only, never reproduced)'
          + (refNotes ? '. Their note on it: ' + refNotes : '') + '\n'
        : '')
    + '\nTHEIR BRIEF:\n"' + rawPrompt + '"';
}

try {
  const resp = await req({ method:'POST', url:'https://api.anthropic.com/v1/messages',
    headers:{ 'x-api-key':ANTHROPIC, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body:{
      model:'claude-sonnet-5',
      max_tokens: 800,
      // Explicit, not omitted. Sonnet 5 runs adaptive thinking by default,
      // which is 3-4x the latency for a bounded rewrite and shares max_tokens
      // with the answer itself.
      thinking: { type: 'disabled' },
      output_config: { effort: mode === 'motion' ? 'medium' : 'low' },
      messages:[{ role:'user', content:[
        { type:'text', text: cachedPrefix, cache_control:{ type:'ephemeral' } },
        { type:'text', text: variable },
      ] }],
    },
    json:true });

  if (!resp || resp.type === 'error' || !Array.isArray(resp.content)) {
    throw new Error('Enhance call failed: ' + (resp && resp.error && resp.error.message ? resp.error.message : JSON.stringify(resp).slice(0, 300)));
  }
  // Find the text block by type rather than indexing content[0] — block order
  // is not contractual even with thinking disabled.
  const textBlock = resp.content.find(b => b.type === 'text');
  const raw = String((textBlock && textBlock.text) || '').trim();
  if (!raw) throw new Error('The model returned an empty prompt.');

  // Parse the JSON contract, but never fail the whole enhance over it: a
  // model that answered with a bare prompt string still produced the thing
  // the user actually clicked for. Conflicts are the bonus, not the payload.
  let out = '', conflicts = [];
  const parsed = safeJson(raw);
  if (parsed && typeof parsed.prompt === 'string' && parsed.prompt.trim()) {
    out = parsed.prompt.trim();
    conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts.filter(c => c && c.field) : [];
  } else {
    out = raw.replace(/^["']|["']$/g, '');
  }
  if (!out) throw new Error('The model returned an empty prompt.');

  return [{ json: { ok: true, prompt: out, conflicts, mode } }];
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}
""")


def _http_creative_upload(source_node: str, mime: str, name: str, x: int, y: int,
                          ref_node: str = None) -> dict:
    """Binary upload to the creative-studio bucket.

    The bytes cannot be uploaded from inside the Code node: httpRequest is
    proxied to n8n's main process as one JSON.stringify'd message, and a
    Buffer nested inside the options object is never reconstructed — it
    arrives as the literal text '{"type":"Buffer","data":[...]}'. Only
    prepareBinaryData (a top-level RPC argument) survives, so the Code node
    prepares and this real HTTP node, running in the main process, uploads.

    `ref_node` is for Compose, where the binary comes from a Read File node
    sitting between the Code node and this one. That node replaces $json with
    its own output, so bucket/filename have to be looked up by name instead.
    Left unset everywhere else, which keeps the original $json behaviour.

    Note `.first()` rather than `.item`: reading a file off disk does not carry
    pairedItem through, so `.item` cannot resolve which input item this one came
    from and throws. Compose only ever handles a single clip, so first() is
    exact — unlike Generate, which runs both candidates through one node and
    genuinely needs the paired lookup.
    """
    loc = "$json" if ref_node is None else f"$('{ref_node}').first().json"
    return {
        "parameters": {
            "method": "POST",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}"
                   f"/storage/v1/object/{{{{ {loc}.bucket }}}}/{{{{ {loc}.filename }}}}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": mime},
                    {"name": "x-upsert", "value": "true"},
                ]
            },
            "sendBody": True,
            "contentType": "binaryData",
            "inputDataFieldName": "data",
            "options": {},
        },
        # A throw here used to kill the execution outright, and because the
        # row is only ever written by the two nodes DOWNSTREAM of this one,
        # it stayed 'pending' forever — a card spinning on a render that had
        # already been generated and paid for. The error output routes to
        # Mark Failed instead, so a storage hiccup surfaces as a failure the
        # human can retry rather than an infinite spinner.
        #
        # retryOnFail matters specifically here, and specifically for video: a
        # ~23MB upload failed with a raw "400 Bad Request" from an edge/gateway
        # in front of Supabase Storage on 2026-08-11 — not a Supabase API error
        # (those come back as JSON) and not a size problem (a 38MB upload right
        # before it succeeded), so a one-off transient blip, not a real defect
        # in the request. Before this, the ONLY recovery was the UI's "Try
        # again", which re-fires the whole render — so a hiccup on the LAST
        # step of an already-paid-for generation was throwing away the money
        # and starting over. Three tries with backoff means that class of
        # failure now self-heals before it ever reaches the human, on the free
        # step that doesn't warrant repaying for the render just to redo it.
        "retryOnFail": True,
        "maxTries": 3,
        "waitBetweenTries": 2000,
        "onError": "continueErrorOutput",
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_creative_save(source_node: str, media_field: str, name: str, x: int, y: int,
                        single: bool = False) -> dict:
    """PATCH the version row to 'ready' with its now-permanent public URL.

    Reads `source_node` rather than this node's own input for the same reason
    Supabase: Save Video URL does — an HTTP node's json is the upload
    response, not the upstream item, so bucket/filename/version_id have to
    come from the Code node by paired-item lookup.

    `single` swaps that paired lookup for first(). Compose needs it because a
    Read File node sits in the chain and does not carry pairedItem through, so
    `.item` has nothing to resolve against and throws — which, with the error
    output wired to Mark Failed, shows up as a silent no-op rather than an
    error. Only safe where the workflow handles exactly one row, which Compose
    does and Generate (two candidates through one node) does not.
    """
    ref = f"$('{source_node}').{'first()' if single else 'item'}.json"
    body_expr = (
        "={{ JSON.stringify({ status: 'ready', error: '', " + media_field + ": "
        "String($env.SUPABASE_URL).replace(/\\/+$/, '') + '/storage/v1/object/public/' "
        f"+ {ref}.bucket + '/' + {ref}.filename" + " }) }}"
    )
    return {
        "parameters": {
            "method": "PATCH",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}"
                   f"/rest/v1/creative_versions?id=eq.{{{{ {ref}.version_id }}}}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": "application/json"},
                    {"name": "Prefer", "value": "return=minimal"},
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": body_expr,
            "options": {},
        },
        # Same reasoning as the upload node: this is the ONLY node that turns
        # the row 'ready', so if it throws the row is left pending with the
        # asset sitting in the bucket, unreachable. Same retry, cheap insurance
        # here — a tiny JSON PATCH is far less exposed than the video upload,
        # but it crosses the same gateway that produced the 2026-08-11 blip.
        "retryOnFail": True,
        "maxTries": 3,
        "waitBetweenTries": 2000,
        "onError": "continueErrorOutput",
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_creative_fail(source_node: str, name: str, x: int, y: int, single: bool = False) -> dict:
    """PATCH the version row to 'failed' with the real provider message.

    Without this branch a failed generation leaves the card spinning forever
    with nothing to explain it — which is exactly how an exhausted fal balance
    would present to the marketing team.
    """
    # Three different branches feed this node now — the Code node's own
    # "didn't work" output, plus the error outputs of the upload and save
    # nodes — and only the first of those carries version_id in $json. The
    # paired-item lookup on the Code node is what makes the other two work:
    # it resolves to the row THIS item belongs to, which matters because
    # Generate runs several candidates through the same nodes at once.
    # `single` is Compose's case — see _http_creative_save for why a Read File
    # node in the chain makes the paired lookup impossible there.
    ref = f"$('{source_node}').{'first()' if single else 'item'}.json"
    err_expr = (
        "={{ JSON.stringify({ status: 'failed', error: String("
        "$json.error && $json.error.message ? $json.error.message : "
        f"($json.error || {ref}.error || 'Generation failed.')"
        ").slice(0, 500) }) }}"
    )
    return {
        "parameters": {
            "method": "PATCH",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}"
                   f"/rest/v1/creative_versions?id=eq.{{{{ $json.version_id || {ref}.version_id }}}}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": "application/json"},
                    {"name": "Prefer", "value": "return=minimal"},
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": err_expr,
            "options": {},
        },
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


CREATIVE_GENERATE_STICKY = """## Creative Studio — Generate (2 candidates)

POST `arak-creative-generate`
```
{ session_id, targets: [{version_id, provider:'openai'|'gemini'}],
  prompt, aspect_ratio, reference_url?, reference_notes?, instructions? }
```

The browser inserts BOTH pending `creative_versions` rows first and polls
them, so this answers 'accepted' at once and fills each row as its model
returns. One provider failing still leaves the other candidate — the whole
point of the screen is a side-by-side choice.

Models: `gpt-image-2` + `nano-banana-2` (their `/edit` variants when a
reference image is supplied — reference = inspiration, never a copy).

Needs env: FAL_KEY, SUPABASE_URL, SUPABASE_KEY."""

CREATIVE_EDIT_STICKY = """## Creative Studio — Edit

POST `arak-creative-edit`
```
{ session_id, version_id, source_image_url, instruction,
  reference_image_urls?: string[], provider?: 'gemini'|'openai', aspect_ratio? }
```

`source_image_url` is the image being changed; `reference_image_urls` (max 3)
are only looked at. Both go to the model in ONE `image_urls` array, first
position first, and the prompt is extended to say which is which — the
schema doesn't distinguish them, and without that sentence the edit comes
back as a blend of the two. This is what the studio's drag-an-image-from-the-
other-chat gesture sends.

One conversational edit → one new version row. Nano Banana by default:
instruction-following editing is its headline strength and it leaves the
rest of the frame alone.

NOTE: edits to TEXT on an image should normally go through the app's own
overlay editor instead — real text is exact in Arabic and stays editable,
where anything a model paints is baked pixels forever.

Needs env: FAL_KEY, SUPABASE_URL, SUPABASE_KEY."""

CREATIVE_VIDEO_STICKY = """## Creative Studio — Video (model picker, added 2026-08-10)

POST `arak-creative-video`
```
{ session_id, version_id, prompt, model?, image_url?, end_image_url?,
  reference_image_urls?: string[], duration?, aspect_ratio?, resolution?,
  generate_audio? }
```

Three modes, picked from what's in the payload:
- `reference_image_urls` → **reference-to-video** (Seedance 2.0/2.5 only), a
  separate endpoint taking `image_urls` (up to 9) addressed from the prompt as
  `@Image1`. A sentence naming them is prepended automatically; without it the
  model treats them as vague inspiration and mostly ignores them.
- `image_url` → image-to-video, optionally with `end_image_url` as the last
  frame (Seedance only), which is what makes a stitched two-clip sequence read
  as a deliberate cut rather than a join.
- neither → text-to-video, because a session may be image-only, video-only, or
  image-then-video.

`model` selects the fal endpoint via MODEL_CONFIGS at the top of the Code
node — unrecognised or missing values fall back to 'seedance-2'. Each
model's `build()` there knows its own accepted inputs (Kling and Hailuo take
neither `resolution` nor `aspect_ratio`; Veo's `duration` needs an 's' suffix),
so the caller doesn't have to. `generate_audio` defaults false — free on
Seedance, billed separately on Veo, absent on Kling/Hailuo.

**Aspect ratio is per model** (fixed 2026-08-11 — it was one global map, and
rewriting 4:5 to 3:4 for everyone meant every 4:5 and 1:1 Veo render failed,
since Veo rejects 3:4). Seedance 2.0 has no 4:5 bucket so it gets 3:4; Seedance
2.5 accepts only `auto`; Veo gets an orientation (9:16 or 16:9); Kling and
Hailuo take none. An approximate shape is fine now because Creative Compose
centre-crops the finished clip back to the overlay's own aspect.

Add a model by adding one entry to MODEL_CONFIGS — nothing else in the
workflow is model-specific.

Needs env: FAL_KEY, SUPABASE_URL, SUPABASE_KEY."""


CREATIVE_VIDEO_EDIT_STICKY = """## Creative Studio — Video Edit (in-context, added 2026-08-11)

POST `arak-creative-video-edit`
```
{ session_id, version_id, video_url, prompt, reference_image_urls?: string[] }
```

Edits an EXISTING clip via fal's Kling O1 Edit
(`fal-ai/kling-video/o1/video-to-video/edit`) — a natural-language instruction
("change the background to marble", "make the light pulse slower") applied
while the model preserves the source's own camera movement and motion
structure. This is what the chat box's Send does on a finished video, distinct
from Re-render (same prompt, a brand-new take) and Add text (free, ffmpeg only,
never touches the footage).

Real constraint from fal's own schema, not a choice made here: the source
clip must be 3–10.05 seconds. The frontend checks the row's stored `duration`
before offering this action at all — outside that range, only Re-render shows.

`reference_image_urls` are optional style/appearance references, addressed in
the prompt as @Image1, @Image2 — capped at 4 (fal's own limit, shared with any
character "elements", which this app never sends).

`keep_audio: true` always — an edit that changes the picture must not also
silently drop audio the source render had; fal defaults this to false.

Costs $0.168/second of the SOURCE clip's duration, not the edit's own compute
time — a 5s edit is ~$0.84, a 10s edit ~$1.68.

Needs env: FAL_KEY, SUPABASE_URL, SUPABASE_KEY."""


CREATIVE_COMPOSE_STICKY = """## Creative Studio — Compose (text/logos onto a clip)

POST `arak-creative-compose`
```
{ session_id, version_id, video_url,
  overlays: [ { url, t_in, t_out, fade } ] }
```

**Costs nothing to run** — no FAL_KEY, no model call. This is what makes
unlimited free wording/font/colour changes on video real rather than a slogan:
the clip is never regenerated, our own layer is just stamped onto it again.

`overlays` are back-to-front, one PNG per distinct timing group (layers that
share an in/out are rendered into one image by the editor). `t_out: null`
means "runs to the end"; `fade` is seconds of alpha ramp at both ends.

The clip is centre-cropped to the OVERLAY's aspect, not the other way round —
the overlay was composed against the still, while the clip comes back in
whatever shape the model would accept. Dimensions come from ffprobe at run
time; nothing trusts the caller, because `creative_versions` is
client-writable and every URL here ends up in a shell command.

Arabic is safe by construction: the browser renders the text with real fonts
and real shaping, ffmpeg only ever composites a finished PNG, so ffmpeg's
unreliable Arabic `drawtext` never enters the picture.

Needs env: SUPABASE_URL, SUPABASE_KEY. Needs ffmpeg + ffprobe in the image
(see n8n/docker/Dockerfile — a multi-stage copy, since the n8n base is a
hardened image with no package manager)."""


CREATIVE_STITCH_STICKY = """## Creative Studio — Stitch (join a reel's clips)

POST `arak-creative-stitch`
```
{ session_id, version_id,
  clips: [ { url, transition: 'cut'|'crossfade', transition_duration } ] }
```

**Costs nothing to run** — no FAL_KEY, no model call, same as Compose. This is
the second half of what makes long video affordable: no model here renders 30s
cheaply (Seedance 2.5 is $14.19 a take and the only one that reaches it at
all), so a reel is several short clips joined locally instead.

`transition` describes the seam BEFORE that clip; `clips[0]`'s is ignored.
Nothing else is accepted — no geometry, no fps, no filenames. Fewer
caller-supplied values reaching a shell string is the entire point, and the
same `safeUrl` allowlist as Compose applies for the same reason.

**Two shell passes, one Code node between them.** ffprobe returns float
durations and busybox `$(( ))` is integer-only, so pass 1 probes, `Plan
Stitch` does the crossfade arithmetic in JS, and pass 2 runs with literals.

**Every clip is normalised first** — one size (the largest clip's, letterboxed
not cropped), one frame rate, one sample rate, one channel layout. The audio
half is the one that is easy to skip and breaks the reel: clips without a
sound track get one from `anullsrc`, because concat matches streams by index
and a mixed set comes out with audio on the first segment only.

Runs of hard cuts are joined with the concat demuxer and `-c copy` when there
is no real audio — instant, and no second generation of encoding. Any real
audio, or any crossfade, takes the filter path instead (AAC priming leaves an
audible ~20ms click at a stream-copied join).

The parser compares the finished duration against what the arithmetic
predicted and FAILS on a mismatch: a dropped segment is the one failure here
that otherwise exits 0 and just quietly ships a reel with a shot missing.

Never writes `overlay_state` — the Video Reconcile sweep reads that column to
find abandoned renders, and a stitch row appearing there would confuse it.

Needs env: SUPABASE_URL, SUPABASE_KEY. Needs ffmpeg + ffprobe in the image
(see n8n/docker/Dockerfile)."""


def build_creative_stitch() -> dict:
    """Webhook -> Respond -> Build Fetch -> Fetch&Probe -> Plan -> OK?
                                     -> Stitch(sh) -> Parse -> OK?
                                     -> Read File -> Upload -> Save
                                     -> Mark Failed

    Two gates rather than Compose's one, because there are two shell passes:
    a clip that fails to download reports "clip 3 didn't download" instead of
    surfacing later as an inscrutable ffmpeg filter error.
    """
    fail = [{"node": "Supabase: Mark Failed", "type": "main", "index": 0}]
    nodes = [
        _sticky(CREATIVE_STITCH_STICKY, height=760, width=470, x=0, y=-400),
        _webhook("arak-creative-stitch", "responseNode", x=0, y=300),
        _respond_json(
            "Respond: Accepted",
            "={{ JSON.stringify({ status: 'accepted', version_id: $json.body.version_id }) }}",
            x=220, y=300),
        _code("Build Fetch", CREATIVE_STITCH_FETCH_JS, x=440, y=300),
        _execute_command("Fetch & Probe", "={{ $json.script }}", x=660, y=300),
        _code("Plan Stitch", CREATIVE_STITCH_PLAN_JS, x=880, y=300),
        _if_bool_equals("Plan OK?", "creative-stitch-plan-gate", "={{ $json._ok === true }}", x=1100, y=300),
        _execute_command("Stitch", "={{ $json.script }}", x=1320, y=220),
        _code("Parse Stitch", CREATIVE_STITCH_PARSE_JS, x=1540, y=220),
        _if_bool_equals("Stitched OK?", "creative-stitch-gate", "={{ $json._ok === true }}", x=1760, y=220),
        _read_binary_file("Read Stitched Reel", "={{ $json.path }}", x=1980, y=140),
        _http_creative_upload("Parse Stitch", "video/mp4", "Upload to Supabase Storage",
                              x=2200, y=140, ref_node="Parse Stitch"),
        _http_creative_save("Parse Stitch", "video_url", "Supabase: Save Version",
                            x=2420, y=140, single=True),
        _http_creative_fail("Parse Stitch", "Supabase: Mark Failed", x=1980, y=420, single=True),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Respond: Accepted", "type": "main", "index": 0}]]},
        "Respond: Accepted": {"main": [[{"node": "Build Fetch", "type": "main", "index": 0}]]},
        "Build Fetch": {"main": [[{"node": "Fetch & Probe", "type": "main", "index": 0}]]},
        "Fetch & Probe": {"main": [[{"node": "Plan Stitch", "type": "main", "index": 0}]]},
        "Plan Stitch": {"main": [[{"node": "Plan OK?", "type": "main", "index": 0}]]},
        # The failed branch of the first gate carries Plan Stitch's own
        # {_ok:false, error}, which is the shape Mark Failed already reads.
        "Plan OK?": {"main": [[{"node": "Stitch", "type": "main", "index": 0}], fail]},
        "Stitch": {"main": [[{"node": "Parse Stitch", "type": "main", "index": 0}]]},
        "Parse Stitch": {"main": [[{"node": "Stitched OK?", "type": "main", "index": 0}]]},
        "Stitched OK?": {"main": [[{"node": "Read Stitched Reel", "type": "main", "index": 0}], fail]},
        "Read Stitched Reel": {
            "main": [[{"node": "Upload to Supabase Storage", "type": "main", "index": 0}], fail]
        },
        "Upload to Supabase Storage": {
            "main": [[{"node": "Supabase: Save Version", "type": "main", "index": 0}], fail]
        },
        "Supabase: Save Version": {"main": [[], fail]},
    }
    return {
        "name": "Arak Lighting – Creative Stitch",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def _execute_command(name: str, command_expr: str, x: int, y: int) -> dict:
    """Run a shell script built upstream.

    onError continues so a non-zero exit reaches the parser, which can read
    stderr and turn it into a message the marketer can act on — rather than
    ending the execution with the row still 'pending' and nothing to explain it.
    """
    return {
        "parameters": {"command": command_expr},
        "onError": "continueRegularOutput",
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.executeCommand",
        "typeVersion": 1,
        "position": [x, y],
    }


def _read_binary_file(name: str, path_expr: str, x: int, y: int) -> dict:
    """Load the composited mp4 off disk so the existing upload node can send it."""
    return {
        "parameters": {"fileSelector": path_expr, "options": {"dataPropertyName": "data"}},
        "onError": "continueErrorOutput",
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.readWriteFile",
        "typeVersion": 1,
        "position": [x, y],
    }


def build_creative_compose() -> dict:
    """Webhook -> Respond -> Build Composite -> Composite(sh) -> Parse -> OK?
                                        -> Read File -> Upload -> Save
                                        -> Mark Failed

    Deliberately NOT _build_creative_workflow's shape: that one has the Code
    node hand bytes straight to the upload node, whereas here ffmpeg writes to
    disk and a Read File node picks the result back up. Everything downstream of
    that is the same helpers as its three siblings, so the row still ends up
    either 'ready' or 'failed' down every path.
    """
    fail = [{"node": "Supabase: Mark Failed", "type": "main", "index": 0}]
    nodes = [
        _sticky(CREATIVE_COMPOSE_STICKY, height=520, width=460, x=0, y=-260),
        _webhook("arak-creative-compose", "responseNode", x=0, y=300),
        _respond_json(
            "Respond: Accepted",
            "={{ JSON.stringify({ status: 'accepted', version_id: $json.body.version_id }) }}",
            x=220, y=300),
        _code("Build Composite", CREATIVE_COMPOSE_JS, x=440, y=300),
        _execute_command("Composite", "={{ $json.script }}", x=660, y=300),
        _code("Parse Composite", CREATIVE_COMPOSE_PARSE_JS, x=880, y=300),
        _if_bool_equals("Composed OK?", "creative-compose-gate", "={{ $json._ok === true }}", x=1100, y=300),
        _read_binary_file("Read Composed Clip", "={{ $json.path }}", x=1320, y=200),
        _http_creative_upload("Parse Composite", "video/mp4", "Upload to Supabase Storage",
                              x=1540, y=200, ref_node="Parse Composite"),
        _http_creative_save("Parse Composite", "video_url", "Supabase: Save Version",
                            x=1760, y=200, single=True),
        _http_creative_fail("Parse Composite", "Supabase: Mark Failed", x=1320, y=420, single=True),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Respond: Accepted", "type": "main", "index": 0}]]},
        "Respond: Accepted": {"main": [[{"node": "Build Composite", "type": "main", "index": 0}]]},
        "Build Composite": {"main": [[{"node": "Composite", "type": "main", "index": 0}]]},
        "Composite": {"main": [[{"node": "Parse Composite", "type": "main", "index": 0}]]},
        "Parse Composite": {"main": [[{"node": "Composed OK?", "type": "main", "index": 0}]]},
        "Composed OK?": {
            "main": [
                [{"node": "Read Composed Clip", "type": "main", "index": 0}],
                fail,
            ]
        },
        "Read Composed Clip": {
            "main": [[{"node": "Upload to Supabase Storage", "type": "main", "index": 0}], fail]
        },
        "Upload to Supabase Storage": {
            "main": [[{"node": "Supabase: Save Version", "type": "main", "index": 0}], fail]
        },
        "Supabase: Save Version": {"main": [[], fail]},
    }
    return {
        "name": "Arak Lighting – Creative Compose",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def _build_creative_workflow(name, webhook_path, sticky, js, code_node_name,
                             mime, media_field, accepted_expr) -> dict:
    """The shape all three Creative Studio workflows share:

    Webhook -> Respond: Accepted -> <Code> -> OK? -> (yes) Upload -> Save
                                                  -> (no)  Mark Failed

    Upload and Save both also route their ERROR output to Mark Failed. The
    row is only ever written by those two nodes, so before that a throw in
    either one ended the execution with the row still 'pending' — the card
    span forever on an image fal had already produced and charged for, and
    nothing anywhere said why. Every path out of the Code node now ends in a
    row that is either ready or failed.
    """
    nodes = [
        _sticky(sticky, height=360, width=460, x=0, y=-180),
        _webhook(webhook_path, "responseNode", x=0, y=300),
        _respond_json("Respond: Accepted", accepted_expr, x=220, y=300),
        _code(code_node_name, js, x=440, y=300),
        _if_bool_equals("Generated OK?", "creative-gate-1", "={{ $json._ok === true }}", x=660, y=300),
        _http_creative_upload(code_node_name, mime, "Upload to Supabase Storage", x=880, y=200),
        _http_creative_save(code_node_name, media_field, "Supabase: Save Version", x=1100, y=200),
        _http_creative_fail(code_node_name, "Supabase: Mark Failed", x=880, y=400),
    ]
    fail = [{"node": "Supabase: Mark Failed", "type": "main", "index": 0}]
    connections = {
        "Webhook": {"main": [[{"node": "Respond: Accepted", "type": "main", "index": 0}]]},
        "Respond: Accepted": {"main": [[{"node": code_node_name, "type": "main", "index": 0}]]},
        code_node_name: {"main": [[{"node": "Generated OK?", "type": "main", "index": 0}]]},
        "Generated OK?": {
            "main": [
                [{"node": "Upload to Supabase Storage", "type": "main", "index": 0}],
                fail,
            ]
        },
        # Second output on each of these is the error branch that
        # onError=continueErrorOutput adds.
        "Upload to Supabase Storage": {
            "main": [[{"node": "Supabase: Save Version", "type": "main", "index": 0}], fail]
        },
        "Supabase: Save Version": {"main": [[], fail]},
    }
    return {
        "name": name,
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_creative_generate() -> dict:
    return _build_creative_workflow(
        name="Arak Lighting – Creative Generate",
        webhook_path="arak-creative-generate",
        sticky=CREATIVE_GENERATE_STICKY,
        js=CREATIVE_GENERATE_JS,
        code_node_name="Generate Candidates",
        mime="image/png",
        media_field="image_url",
        accepted_expr="={{ JSON.stringify({ status: 'accepted', session_id: $json.body.session_id }) }}",
    )


def build_creative_edit() -> dict:
    return _build_creative_workflow(
        name="Arak Lighting – Creative Edit",
        webhook_path="arak-creative-edit",
        sticky=CREATIVE_EDIT_STICKY,
        js=CREATIVE_EDIT_JS,
        code_node_name="Edit Image",
        mime="image/png",
        media_field="image_url",
        accepted_expr="={{ JSON.stringify({ status: 'accepted', version_id: $json.body.version_id }) }}",
    )


def build_creative_video() -> dict:
    return _build_creative_workflow(
        name="Arak Lighting – Creative Video",
        webhook_path="arak-creative-video",
        sticky=CREATIVE_VIDEO_STICKY,
        js=CREATIVE_VIDEO_JS,
        code_node_name="Render Video",
        mime="video/mp4",
        media_field="video_url",
        accepted_expr="={{ JSON.stringify({ status: 'accepted', version_id: $json.body.version_id }) }}",
    )


def build_creative_video_edit() -> dict:
    return _build_creative_workflow(
        name="Arak Lighting – Creative Video Edit",
        webhook_path="arak-creative-video-edit",
        sticky=CREATIVE_VIDEO_EDIT_STICKY,
        js=CREATIVE_VIDEO_EDIT_JS,
        code_node_name="Edit Video",
        mime="video/mp4",
        media_field="video_url",
        accepted_expr="={{ JSON.stringify({ status: 'accepted', version_id: $json.body.version_id }) }}",
    )


INSIGHTS_REVIEW_STICKY = """## Insights Review

**Zero secrets in this file.** Needs `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Reads what this brand has already decided and what its posts actually did, and proposes short rules into `brand_memory` with `status = 'proposed'`. Nothing it writes reaches a prompt until a human approves it on the Insights page — an unreviewed inference must never start steering a brand's output on its own.

Webhook path: `/arak-insights-review`. Body: `{ workspace_id }`.

**Text only.** One Claude Sonnet call, no image or video generation — this workflow cannot spend money on media.

**It refuses to run on thin data.** Below the thresholds in Gather it returns `skipped` WITHOUT calling Claude. That is the point: asked to find patterns in four decisions and one post, a model will find them, and they will be noise wearing the costume of a finding. Cheaper and more honest to say "not enough history yet".

**It is told what already exists** — active, proposed AND retired rules alike. Without the retired ones it would cheerfully re-propose every suggestion a human has already turned down, every single run.

Sample size travels with each rule into `evidence`, so the page can mark a thin conclusion as thin rather than presenting it with the same confidence as a well-evidenced one."""


INSIGHTS_REVIEW_GATHER_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 400))
            : (typeof b === 'string' && b) ? b.slice(0, 400)
            : `HTTP ${status}`;
  throw new Error(`Supabase ${status}: ${msg}`);
}

const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || {};
const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const wsId = String(body.workspace_id || '').trim();
if (!wsId) throw new Error('workspace_id is required.');

// Every read is scoped to the one workspace. This runs with the service key,
// so RLS is not a backstop here -- the filter IS the isolation, and without
// it one brand's rules would be proposed from another brand's history.
const q = (table, sel, extra) =>
  `${SUPA_URL}/rest/v1/${table}?workspace_id=eq.${wsId}&select=${sel}${extra || ''}`;

const [events, ideas, metrics, posts, existing] = await Promise.all([
  req({ method:'GET', url:q('idea_events', 'event,reason,idea_id,before,after,created_at', '&order=created_at.desc&limit=500'), headers:sHeaders, json:true }),
  req({ method:'GET', url:q('plan_ideas', 'id,status,reject_reason,content_pillar,occasion,format,media_type,platform,scheduled_date,topic,title', '&order=created_at.desc&limit=500'), headers:sHeaders, json:true }),
  req({ method:'GET', url:q('post_analytics', 'post_id,post_table,platform,metric_date,likes,comments,shares,saves,views,impressions,reach,clicks,metrics_present', '&order=metric_date.desc&limit=2000'), headers:sHeaders, json:true }),
  req({ method:'GET', url:q('instagram_generated_posts', 'id,plan_idea_id', '&limit=2000'), headers:sHeaders, json:true }),
  req({ method:'GET', url:q('brand_memory', 'rule,scope,status', '&limit=200'), headers:sHeaders, json:true }),
]);

// ── Decisions ────────────────────────────────────────────────────────────
// plan_ideas carries status and reject_reason directly, and idea_events
// carries the same decisions as a log. Both are counted: a workspace that
// was being used before the log existed still has its rejections recorded
// on the ideas themselves, and ignoring those would call real history empty.
const rejectReasons = {};
let approved = 0, rejected = 0;
for (const i of ideas){
  if (i.status === 'approved') approved++;
  else if (i.status === 'rejected'){
    rejected++;
    const k = i.reject_reason || 'unspecified';
    rejectReasons[k] = (rejectReasons[k] || 0) + 1;
  }
}
const eventTotals = {};
for (const e of events) eventTotals[e.event] = (eventTotals[e.event] || 0) + 1;

// Which fields a human rewrote by hand -- the most direct statement there is
// about where generation falls short.
const editedFields = {};
for (const e of events){
  if (e.event !== 'edited') continue;
  const b = e.before || {}, a = e.after || {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])){
    if (String(b[k] ?? '') === String(a[k] ?? '')) continue;
    editedFields[k] = (editedFields[k] || 0) + 1;
  }
}

const pillarCounts = {};
for (const i of ideas){
  const p = String(i.content_pillar || '').trim();
  if (p) pillarCounts[p] = (pillarCounts[p] || 0) + 1;
}

// ── Performance ──────────────────────────────────────────────────────────
const METRICS = ['likes','comments','shares','saves'];
function engagement(row){
  const present = Array.isArray(row.metrics_present) ? row.metrics_present : null;
  let t = 0;
  for (const m of METRICS){
    if (present && !present.includes(m)) continue;
    t += Number(row[m]) || 0;
  }
  return t;
}
const ideaById = {};
for (const i of ideas) ideaById[i.id] = i;
const ideaByPost = {};
for (const p of posts) if (p.plan_idea_id && ideaById[p.plan_idea_id]) ideaByPost[p.id] = ideaById[p.plan_idea_id];

// One post gains a metrics row per sync; the latest is its standing.
const latest = {};
for (const m of metrics){
  if (m.post_table !== 'instagram_generated_posts' || !m.post_id) continue;
  const seen = latest[m.post_id];
  if (!seen || String(m.metric_date) > String(seen.metric_date)) latest[m.post_id] = m;
}
const groups = { pillar:{}, format:{}, weekday:{} };
const push = (g, k, v) => { if (!k) return; (groups[g][k] = groups[g][k] || []).push(v); };
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
for (const postId of Object.keys(latest)){
  const row = latest[postId];
  const idea = ideaByPost[postId];
  if (!idea) continue;
  const e = engagement(row);
  push('pillar', String(idea.content_pillar || '').trim(), e);
  push('format', String(idea.format || idea.media_type || '').trim(), e);
  if (idea.scheduled_date){
    const d = new Date(`${idea.scheduled_date}T00:00:00`);
    if (!isNaN(d.valueOf())) push('weekday', DAYS[d.getDay()], e);
  }
}
const summarise = g => Object.keys(groups[g]).map(k => ({
  key: k, n: groups[g][k].length,
  avg: Math.round((groups[g][k].reduce((a,b)=>a+b,0) / groups[g][k].length) * 10) / 10,
})).sort((a,b) => b.avg - a.avg);

const postsMeasured = Object.keys(latest).length;
const decisions = approved + rejected + (eventTotals.rejected || 0) + (eventTotals.edited || 0);

// ── The refusal ──────────────────────────────────────────────────────────
// A model asked to find patterns in four decisions WILL find them. Returning
// early costs nothing and keeps invented rules out of the brand's memory.
const MIN_DECISIONS = 8;
const MIN_POSTS = 5;
if (decisions < MIN_DECISIONS && postsMeasured < MIN_POSTS){
  return [{ json: {
    ok: true, skipped: true, proceed: false, workspace_id: wsId,
    reason: `Not enough history yet: ${decisions} decision(s) and ${postsMeasured} measured post(s). ` +
            `Needs ${MIN_DECISIONS} decisions or ${MIN_POSTS} measured posts before a review is worth running.`,
    counts: { decisions, posts_measured: postsMeasured },
  }}];
}

const lines = [];
lines.push(`DECISIONS (${decisions} recorded)`);
lines.push(`Approved: ${approved} | Rejected: ${rejected}`);
if (Object.keys(rejectReasons).length)
  lines.push(`Reject reasons: ${Object.entries(rejectReasons).map(([k,v]) => `${k} x${v}`).join(', ')}`);
if (eventTotals.redrafted) lines.push(`Copy re-drafted ${eventTotals.redrafted} time(s) -- a brief that needed another pass.`);
if (Object.keys(editedFields).length)
  lines.push(`Fields a human rewrote: ${Object.entries(editedFields).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k} x${v}`).join(', ')}`);
if (Object.keys(pillarCounts).length)
  lines.push(`Content pillars used so far: ${Object.entries(pillarCounts).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `${k} x${v}`).join(', ')}`);

lines.push('');
lines.push(`PERFORMANCE (${postsMeasured} post(s) with analytics)`);
for (const [label, g] of [['pillar','pillar'], ['format','format'], ['weekday','weekday']]){
  const rows = summarise(g);
  if (rows.length) lines.push(`By ${label}: ${rows.map(r => `${r.key} ${r.avg} avg over ${r.n} post(s)`).join(' | ')}`);
}

lines.push('');
lines.push('RULES THAT ALREADY EXIST -- do not repeat or rephrase any of these:');
if (existing.length) for (const r of existing) lines.push(`- [${r.status}] (${r.scope}) ${r.rule}`);
else lines.push('- (none yet)');

const prompt = `You are reviewing how one brand's social content has been performing and being received, to propose a small number of concrete rules that will improve what gets generated next.

${lines.join('\n')}

Propose AT MOST 4 rules. Fewer is better; propose none at all if the evidence does not support any.

Each rule must be:
- ONE imperative sentence a copywriter or art director could follow directly. It is injected verbatim into future prompts, so it must make sense with no other context.
- Grounded in a number that appears above. Never invent a statistic.
- Genuinely new -- not a restatement of a rule already listed, in any status.

Where the evidence is thin, either say so in the detail or do not propose the rule. A pattern over fewer than 5 posts is a coincidence, not a finding, and proposing it as one wastes a person's attention.

Return ONLY valid JSON, no markdown:
{"rules":[{"rule":"one imperative sentence","detail":"why, in plain language, including how weak the evidence is","scope":"plan|caption|image|timing|competitor|trend|global","source":"rejections|edits|analytics","sample_size":<integer number of ideas or posts this rests on>,"confidence":<0-1>}]}

Return {"rules":[]} if nothing is well enough evidenced.`;

return [{ json: { ok: true, proceed: true, skipped: false, workspace_id: wsId, prompt,
                  counts: { decisions, posts_measured: postsMeasured } } }];
"""


INSIGHTS_REVIEW_SAVE_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const gathered = $('Insights: Gather').first().json;
const wsId = gathered.workspace_id;

const res = $input.first().json;
const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

// Same defensive parse every Claude-reading node in this file uses: the model
// occasionally wraps JSON in a fence despite being told not to.
let parsed = null;
try {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
} catch (e) {
  throw new Error(`Could not parse the review: ${String(e.message || e).slice(0, 200)}`);
}

const SCOPES  = ['plan','caption','image','timing','competitor','trend','global'];
const SOURCES = ['rejections','edits','analytics'];

// Validated against the CHECK constraints on brand_memory rather than trusted:
// one out-of-vocabulary scope would fail the whole insert, losing the good
// rules alongside the bad one.
const rows = (Array.isArray(parsed.rules) ? parsed.rules : [])
  .filter(r => r && String(r.rule || '').trim())
  .slice(0, 4)
  .map(r => ({
    workspace_id: wsId,
    rule: String(r.rule).trim().slice(0, 500),
    detail: String(r.detail || '').trim().slice(0, 2000),
    scope: SCOPES.includes(r.scope) ? r.scope : 'global',
    source: SOURCES.includes(r.source) ? r.source : 'analytics',
    status: 'proposed',
    evidence: {
      sample_size: Number(r.sample_size) || null,
      decisions: gathered.counts?.decisions ?? null,
      posts_measured: gathered.counts?.posts_measured ?? null,
    },
    confidence: (typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1) ? r.confidence : null,
  }));

if (!rows.length) return [{ json: { ok: true, proposed: 0, note: 'The review found nothing worth proposing.' } }];

await http({
  method: 'POST', url: `${SUPA_URL}/rest/v1/brand_memory`,
  headers: { ...sHeaders, Prefer: 'return=minimal' },
  body: rows, json: true,
});

return [{ json: { ok: true, proposed: rows.length, rules: rows.map(r => r.rule) } }];
"""


def build_insights_review() -> dict:
    """
    Webhook -> Insights: Gather (Code, reads Supabase) -> Enough history?
    (IF) -> Call Claude -> Insights: Save Proposals (Code, writes
    brand_memory).

    The IF is the point of the graph, not decoration: on the false branch it
    responds with `skipped` and never reaches the Claude node, so a review
    over four decisions costs nothing. Both branches terminate in a Respond
    node because the webhook uses responseNode — on a branching graph
    `lastNode` would answer with whichever node happened to run last.

    Text only. There is deliberately no image or video node here; the whole
    workflow can do nothing more expensive than one Sonnet call.
    """
    nodes = [
        _sticky(INSIGHTS_REVIEW_STICKY, height=460, width=500, x=0, y=-300),
        _webhook("arak-insights-review", "responseNode", x=0, y=200),
        _code("Insights: Gather", INSIGHTS_REVIEW_GATHER_JS, x=220, y=200),
        _if_bool_equals("Enough history?", "insights-proceed", "={{ $json.proceed }}", x=440, y=200),
        {
            "parameters": {
                "method": "POST",
                "url": "https://api.anthropic.com/v1/messages",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {"name": "x-api-key", "value": "={{ $env.ANTHROPIC_API_KEY }}"},
                        {"name": "anthropic-version", "value": "2023-06-01"},
                        {"name": "content-type", "value": "application/json"},
                    ]
                },
                "sendBody": True,
                "specifyBody": "json",
                # Sonnet, not Opus: this is summarising a page of numbers into
                # four sentences, not planning a month of content.
                "jsonBody": "={{ JSON.stringify({ model: \"claude-sonnet-5\", max_tokens: 2000, messages: [{ role: \"user\", content: $json.prompt }] }) }}",
                "options": {},
            },
            "id": nid(),
            "name": "Call Claude",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [660, 120],
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 3000,
        },
        _code("Insights: Save Proposals", INSIGHTS_REVIEW_SAVE_JS, x=880, y=120),
        _respond_json("Respond", "={{ JSON.stringify($json) }}", x=1100, y=120),
        _respond_json("Respond: Skipped", "={{ JSON.stringify($json) }}", x=660, y=300),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Insights: Gather", "type": "main", "index": 0}]]},
        "Insights: Gather": {"main": [[{"node": "Enough history?", "type": "main", "index": 0}]]},
        "Enough history?": {"main": [
            [{"node": "Call Claude", "type": "main", "index": 0}],
            [{"node": "Respond: Skipped", "type": "main", "index": 0}],
        ]},
        "Call Claude": {"main": [[{"node": "Insights: Save Proposals", "type": "main", "index": 0}]]},
        "Insights: Save Proposals": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Insights Review",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


BRAND_RESEARCH_STICKY = """## Brand Research

**Zero secrets in this file.** Needs `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Searches the live web for what is moving in this brand's market and what its competitors are doing, and proposes rules into `brand_memory` with `status = 'proposed'`. Same landing place as the Insights review — research does not get its own silo, and nothing steers generation until a human approves it.

Webhook path: `/arak-brand-research`. Body: `{ workspace_id, brand_name, brand_descriptor, instructions, competitors[], market }`.

**Text and search only.** No image or video node — this workflow cannot spend money on media.

**The queries are built from the Brand Brain, not hardcoded.** The old LinkedIn workflow searched a fixed `"architectural lighting industry trends 2026 Saudi Arabia"` string, which was wrong for every brand that was not Arak. The caller sends the research slice of its own brand context (`buildContext(task: 'research')`) and the queries are assembled from the brand's own descriptor and competitor list.

**It refuses to run on an empty brain.** Without a descriptor there is nothing to search FOR, and a generic query would return generic results that a model would then dress up as insight about this specific brand.

**Existing rules go into the prompt**, in every status including retired, so a weekly run does not re-propose what someone already turned down.

This is the one learning source that works on day one — it needs no posting history, which is exactly what a brand with ten ideas and no analytics does not have."""


BRAND_RESEARCH_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 300))
            : (typeof b === 'string' && b) ? b.slice(0, 300)
            : `HTTP ${status}`;
  throw new Error(`${opts.__label || 'Request'} ${status}: ${msg}`);
}

const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || {};
const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const TAVILY   = $env.TAVILY_API_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const wsId = String(body.workspace_id || '').trim();
if (!wsId) throw new Error('workspace_id is required.');

const brandName  = String(body.brand_name || '').trim();
const descriptor = String(body.brand_descriptor || '').trim();
const market     = String(body.market || 'Saudi Arabia').trim();
const competitors = (Array.isArray(body.competitors) ? body.competitors : [])
  .map(c => String(c || '').trim()).filter(Boolean).slice(0, 6);
const instructions = String(body.instructions || '').trim();

// Refuse rather than search for nothing. A query built from an empty brain is
// just the market's name, and the results would be generic trend copy that a
// model would then attribute to THIS brand.
if (!descriptor) {
  return [{ json: { ok: true, skipped: true, proceed: false, workspace_id: wsId,
    reason: 'This brand has no one-line descriptor yet, so there is nothing specific to research. Add one in Brand Brain first.' } }];
}
if (!TAVILY) {
  return [{ json: { ok: true, skipped: true, proceed: false, workspace_id: wsId,
    reason: 'TAVILY_API_KEY is not set on this n8n instance, so the web search cannot run.' } }];
}

const year = new Date().getFullYear();

// A good descriptor usually already says where the brand operates ("an
// at-home spa in Riyadh, Saudi Arabia"), and appending the market anyway
// produced "... in Riyadh, Saudi Arabia — trends 2026 Saudi Arabia". Search
// engines tolerate that; it still reads as a worse query than the one a
// person would type, and these strings end up quoted in the prompt.
const marketSuffix = (market && !descriptor.toLowerCase().includes(market.toLowerCase()))
  ? ` in ${market}` : '';

// Two kinds of question, kept separate because they produce different kinds
// of rule: what is moving in the market, and what the named rivals are doing.
const queries = [
  { scope: 'trend', q: `${descriptor}${marketSuffix} — customer trends and demand ${year}` },
  { scope: 'trend', q: `social media content trends ${year} for ${descriptor}${marketSuffix}` },
];
if (competitors.length) {
  queries.push({ scope: 'competitor', q: `${competitors.join(' OR ')} ${market} — recent marketing, offers and social media activity` });
}

// Searched in sequence rather than in parallel: three calls is not worth a
// concurrency bug, and a rate-limited provider answering 429 to two of three
// would silently narrow the research without saying so.
const findings = [];
const searchErrors = [];
for (const { scope, q } of queries) {
  try {
    const r = await req({
      __label: 'Tavily', method: 'POST', url: 'https://api.tavily.com/search',
      body: { api_key: TAVILY, query: q, max_results: 5, search_depth: 'basic',
              include_answer: true, topic: 'general' },
      json: true,
    });
    findings.push({
      scope, query: q,
      answer: String(r?.answer || '').slice(0, 1200),
      results: (r?.results || []).slice(0, 5).map(x => ({
        title: String(x.title || '').slice(0, 200),
        url: String(x.url || ''),
        content: String(x.content || '').slice(0, 600),
      })),
    });
  } catch (e) { searchErrors.push(`${q}: ${String(e.message || e).slice(0, 160)}`); }
}

if (!findings.length) {
  return [{ json: { ok: true, skipped: true, proceed: false, workspace_id: wsId,
    reason: `Every search failed. ${searchErrors.join(' · ')}`.slice(0, 500) } }];
}

// Same workspace filter as everywhere else: this runs on the service key, so
// the filter IS the isolation.
const existing = await req({
  __label: 'Supabase', method: 'GET',
  url: `${SUPA_URL}/rest/v1/brand_memory?workspace_id=eq.${wsId}&select=rule,scope,status&limit=200`,
  headers: sHeaders, json: true,
});

const lines = [];
for (const f of findings) {
  lines.push(`— SEARCH (${f.scope}): ${f.query}`);
  if (f.answer) lines.push(`Summary: ${f.answer}`);
  for (const r of f.results) lines.push(`  * ${r.title} (${r.url})\n    ${r.content}`);
  lines.push('');
}

lines.push('RULES THAT ALREADY EXIST — do not repeat or rephrase any of these:');
if (existing.length) for (const r of existing) lines.push(`- [${r.status}] (${r.scope}) ${r.rule}`);
else lines.push('- (none yet)');

const prompt = `You are a marketing strategist reviewing live web research for one brand, to propose a small number of concrete rules that will improve the content it produces.

THE BRAND: ${brandName || 'this brand'} — ${descriptor}
MARKET: ${market}
${competitors.length ? `KNOWN COMPETITORS: ${competitors.join(', ')}` : ''}

${instructions ? `WHAT THE BRAND SAYS ABOUT ITSELF:\n${instructions}\n` : ''}
WEB RESEARCH:
${lines.join('\n')}

Propose AT MOST 4 rules. Fewer is better; propose none at all if the research says nothing this brand can act on.

Each rule must be:
- ONE imperative sentence a planner or copywriter could follow directly. It is injected verbatim into future prompts, so it must make sense with no other context.
- Specific to THIS brand and market. "Post more video" is true of every brand on earth and is worth nothing here.
- Grounded in something that actually appears in the research above. Never invent a statistic, a competitor, or a trend.
- Genuinely new — not a restatement of a rule already listed, in any status.

Set "scope" to "trend" for something moving in the market, or "competitor" for something a named rival is doing.

Return ONLY valid JSON, no markdown:
{"rules":[{"rule":"one imperative sentence","detail":"what in the research supports this, in plain language, and how strong that evidence is","scope":"trend|competitor","sources":["url"],"confidence":<0-1>}]}

Return {"rules":[]} if the research does not support anything specific.`;

return [{ json: { ok: true, proceed: true, skipped: false, workspace_id: wsId, prompt,
                  searched: queries.length, found: findings.length,
                  warning: searchErrors.length ? searchErrors.join(' · ') : undefined } }];
"""


BRAND_RESEARCH_SAVE_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine.
//
// Observed 2026-08-17: one candidate in a two-candidate generate round died
// with "getaddrinfo ENOTFOUND fal.run" while the OTHER candidate — same node,
// same host, same second — reached fal and returned an image, and the balance
// call to the same domain succeeded either side of it. Docker's embedded
// resolver (127.0.0.11) drops a lookup occasionally; nothing was wrong with
// fal, the key, or the prompt. The visible cost was half a paid round lost to
// a blip the user then has to notice and re-run by hand.
//
// ONLY name resolution is retried, deliberately. A DNS failure proves the
// request never reached the provider, so re-sending it cannot start a second
// paid job. A connection reset or a timeout carries no such proof — the model
// may already be rendering — so those still fail once, loudly, exactly as
// before.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const gathered = $('Research: Search').first().json;
const wsId = gathered.workspace_id;

const res = $input.first().json;
const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();

let parsed = null;
try {
  const cleaned = text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
} catch (e) {
  throw new Error(`Could not parse the research: ${String(e.message || e).slice(0, 200)}`);
}

// Validated against brand_memory's CHECK constraints. This workflow may only
// ever produce trend/competitor rules — a model returning 'plan' here would
// otherwise write a row claiming the planner's authority off the back of a
// web search.
const SCOPES = ['trend', 'competitor'];

const rows = (Array.isArray(parsed.rules) ? parsed.rules : [])
  .filter(r => r && String(r.rule || '').trim())
  .slice(0, 4)
  .map(r => ({
    workspace_id: wsId,
    rule: String(r.rule).trim().slice(0, 500),
    detail: String(r.detail || '').trim().slice(0, 2000),
    scope: SCOPES.includes(r.scope) ? r.scope : 'trend',
    source: 'research',
    status: 'proposed',
    evidence: {
      sources: (Array.isArray(r.sources) ? r.sources : []).map(u => String(u).slice(0, 300)).slice(0, 5),
      searches: gathered.searched || null,
    },
    confidence: (typeof r.confidence === 'number' && r.confidence >= 0 && r.confidence <= 1) ? r.confidence : null,
  }));

if (!rows.length) return [{ json: { ok: true, proposed: 0, note: 'The research found nothing worth proposing.' } }];

await http({
  method: 'POST', url: `${SUPA_URL}/rest/v1/brand_memory`,
  headers: { ...sHeaders, Prefer: 'return=minimal' },
  body: rows, json: true,
});

return [{ json: { ok: true, proposed: rows.length, rules: rows.map(r => r.rule),
                  warning: gathered.warning } }];
"""


def build_brand_research() -> dict:
    """
    Webhook -> Research: Search (Code: builds brand-specific queries, calls
    Tavily, assembles the prompt) -> Enough to work with? (IF) -> Call Claude
    -> Research: Save Proposals -> Respond.

    Same shape as Insights Review, and deliberately so: both end in
    `brand_memory` rows marked 'proposed', reviewed on the same page. Research
    is not a separate kind of knowledge with a separate home.

    The Tavily calls live INSIDE the Code node rather than as their own HTTP
    nodes. Three searches with per-query error tolerance is a loop, and as
    separate nodes it would be three near-identical nodes plus a merge — with
    a partial failure silently narrowing the research instead of reporting it.

    Text and search only: no image or video node anywhere in this graph.
    """
    nodes = [
        _sticky(BRAND_RESEARCH_STICKY, height=520, width=520, x=0, y=-340),
        _webhook("arak-brand-research", "responseNode", x=0, y=200),
        _code("Research: Search", BRAND_RESEARCH_JS, x=220, y=200),
        _if_bool_equals("Enough to work with?", "research-proceed", "={{ $json.proceed }}", x=440, y=200),
        {
            "parameters": {
                "method": "POST",
                "url": "https://api.anthropic.com/v1/messages",
                "sendHeaders": True,
                "headerParameters": {
                    "parameters": [
                        {"name": "x-api-key", "value": "={{ $env.ANTHROPIC_API_KEY }}"},
                        {"name": "anthropic-version", "value": "2023-06-01"},
                        {"name": "content-type", "value": "application/json"},
                    ]
                },
                "sendBody": True,
                "specifyBody": "json",
                "jsonBody": "={{ JSON.stringify({ model: \"claude-sonnet-5\", max_tokens: 2000, messages: [{ role: \"user\", content: $json.prompt }] }) }}",
                "options": {},
            },
            "id": nid(),
            "name": "Call Claude",
            "type": "n8n-nodes-base.httpRequest",
            "typeVersion": 4.2,
            "position": [660, 120],
            "retryOnFail": True,
            "maxTries": 3,
            "waitBetweenTries": 3000,
        },
        _code("Research: Save Proposals", BRAND_RESEARCH_SAVE_JS, x=880, y=120),
        _respond_json("Respond", "={{ JSON.stringify($json) }}", x=1100, y=120),
        _respond_json("Respond: Skipped", "={{ JSON.stringify($json) }}", x=660, y=300),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Research: Search", "type": "main", "index": 0}]]},
        "Research: Search": {"main": [[{"node": "Enough to work with?", "type": "main", "index": 0}]]},
        "Enough to work with?": {"main": [
            [{"node": "Call Claude", "type": "main", "index": 0}],
            [{"node": "Respond: Skipped", "type": "main", "index": 0}],
        ]},
        "Call Claude": {"main": [[{"node": "Research: Save Proposals", "type": "main", "index": 0}]]},
        "Research: Save Proposals": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Brand Research",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_creative_enhance() -> dict:
    """
    Webhook (responseMode=lastNode) -> Enhance Prompt (single Code node).

    Synchronous, unlike its three siblings: the answer is a short string that
    goes straight back into the browser's text box, so there is no pending
    `creative_versions` row to fill in and nothing for the UI to poll. Same
    graph as Elongate Idea, which is the existing precedent for a one-call
    Claude workflow that answers in-band.
    """
    nodes = [
        _sticky(CREATIVE_ENHANCE_STICKY, height=420, width=460, x=0, y=-220),
        _webhook("arak-creative-enhance", "lastNode", x=0, y=200),
        _code("Enhance Prompt", CREATIVE_ENHANCE_JS, x=240, y=200),
    ]
    connections = {"Webhook": {"main": [[{"node": "Enhance Prompt", "type": "main", "index": 0}]]}}
    return {
        "name": "Arak Lighting – Creative Enhance",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }



# ════════════════════════════════════════════════════════════════════════
# Meta Graph API — the active publishing + analytics path
#
# These three replace the Zernio trio above. The Zernio builders are left
# exactly as they are and still generate: the company's requirement was to
# move onto Meta's official developer API, not to delete the fallback
# before the replacement has proven itself in production.
# ════════════════════════════════════════════════════════════════════════

META_PUBLISH_STICKY = r"""## Arak – Publish Post (Meta Graph API)

**Zero secrets in this file.** Needs `META_IG_TOKEN`, `META_IG_USER_ID`, `SUPABASE_URL`, `SUPABASE_KEY`.

Publishes ONE approved post straight to Instagram through Meta's own Graph API — an official developer-portal app and our own access token, with no third party in between. This is the ACTIVE publishing path. The Zernio workflows are left in place, unchanged and untriggered.

### The two triggers do different jobs

**Webhook** (`arak-meta-publish`) — a human pressed Publish, or moved/cancelled a post. Same request and response shape as the Zernio publish workflow, deliberately, so the browser call sites did not have to change.

**Every 5 Minutes** — the scheduler, which has no Zernio equivalent and is the biggest single consequence of moving to Meta: **the Instagram Graph API cannot schedule.** Meta publishes now or not at all, and a media container expires after 24h, so handing a post to the platform early is simply not on offer.

So we hold the schedule ourselves. `scheduled_publish_at` in Supabase is the only copy, this tick publishes whatever is due, and — the part that is a straight *improvement* — rescheduling is now one UPDATE. Under Zernio the slot lived at Zernio, our column was a copy, and when the two disagreed Zernio won and the post fired at the old time; that is the entire reason moving a post needed a cancel-then-recreate dance. There is no second copy here to desync from.

### Publishing is two steps, and the first one lies

`POST /{ig-user}/media` creates a *container* and returns an id immediately — **even for media Meta will later reject.** Verified 2026-08-19: a WEBP url, which Meta's own docs list as unsupported, came back with a perfectly ordinary id. The id is an acknowledgement, not a success. `status_code` is the only real answer, so every publish polls the container to `FINISHED` before calling `media_publish`.

`meta_container_id` is written to the row *before* the publish call, because the gap between "container ready" and "media_publish returned" is the one window where a crash leaves real ambiguity. Containers live 24h at Meta, so persisting the id turns "did that go out?" into a question with an answer.

### Also handled here

- **Carousels** — each slide is its own `is_carousel_item` container, awaited, then one CAROUSEL parent. Cap 10.
- **Video** — becomes a REELS container with `share_to_feed`; Instagram retired standalone feed video. Transcodes take minutes, so it gets an 8-minute poll budget against the stills' 2.
- **Quota** — read live from `content_publishing_limit` (100/24h on the test account; it varies). Checked *before* claiming, so a quota-blocked post stays `scheduled` and gets swept again later instead of being burned to `failed` for a condition that clears by itself.
- **Stuck rows** — anything in `publishing` for over 20 minutes is moved to `failed` with an explanation. Never retried automatically: its container may already have been published, and a blind retry is how you double-post.
- **The claim guard** — carried over from the Zernio node, and it matters *more* here: a publish is now several round trips wide rather than one, and the 5-minute tick is a genuine second caller that can collide with a hand-publish."""

META_SYNC_STICKY = r"""## Arak – Meta Insights Sync

**Zero secrets in this file.** Needs `META_IG_TOKEN`, `META_IG_USER_ID`, `SUPABASE_URL`, `SUPABASE_KEY`.

Pulls Instagram's own numbers back into `post_analytics` and `account_analytics`. Replaces the Zernio Sync workflow, which is left in place and untriggered.

### Why this must run every day, even when nothing was published

Instagram reports **lifetime totals** for a post. It has no per-day breakdown and none can be requested. So the daily series the "engagement accumulation" chart reads is one *we* build by snapshotting once a day — which means **a missed day is a hole in the curve that can never be backfilled.** Zernio served that series from its own store, so a missed sync there was merely late; here it is lost.

### Two API constraints that shape the code

**Metrics are per media type, and one bad metric kills the whole call.** Meta rejects the entire `/insights` request if a single requested metric is invalid for that media's type, so the metric list is chosen from `media_product_type` and falls back to a core five rather than returning nothing.

**Account insights need two calls, not one.** `follower_count` is a time series; everything else *requires* `metric_type=total_value`, and mixing them is a flat `#100` error naming the offender. Verified live 2026-08-19.

### What Instagram does not measure

`impressions` was removed in v22 (superseded by `views`), and there is no per-media click metric — `profile_visits` is a different thing, and filing it under clicks would quietly turn "someone tapped a link" into "someone looked at the profile". Both stay 0 **and stay out of `metrics_present`**, which is exactly the distinction that column exists to preserve: not measured is not the same as measured zero.

Follower counts come off the profile field rather than the `follower_count` insight metric, which returns an empty series on small accounts — confirmed against the test account, which has 1 follower and gets `data: []`. A chart that silently blanks below some follower threshold is worse than one that is merely flat."""

META_DASHBOARD_STICKY = r"""## Arak – Meta Dashboard

**Zero secrets in this file.** Needs `META_IG_TOKEN`, `META_IG_USER_ID`, `SUPABASE_URL`, `SUPABASE_KEY`.

Serves the Analytics page. Returns the **same response shape** the Zernio Dashboard workflow did — `overview`, `daily`, `bestTime`, `frequency`, `decay`, `followers` — so the page's charts kept working without being rewritten.

### The difference that matters

Zernio *pre-aggregated* all of this: best-time-to-post, posting-frequency curves, content decay and daily rollups were endpoints you simply asked for. **Meta has none of them.** Every one of those sections is derived here, from two sources:

- **Live Graph** — the media in range, with `insights.metric(...)` field expansion so a 30-day window costs one request per page of 50 rather than one per post. Best-time and frequency are computed from these.
- **Our own tables** — `account_analytics` for the daily series and follower history, `post_analytics` for engagement accumulation. Meta retains no history for us, so anything time-shaped can only come from what the sync workflow has accumulated.

### Two places this is deliberately more honest than its predecessor

**Decay buckets are days, not hours.** Zernio recorded continuously and could bucket by hour. We snapshot daily, so an hourly curve would be interpolation dressed up as measurement.

**`metricsSupported` is returned explicitly**, so the page can hide the Impressions and Clicks toggles. Instagram cannot fill them, and a switch that can only ever read 0 looks like a broken integration rather than an absent measurement.

Bucketing is done in **Asia/Riyadh**, not the server's UTC — "Sunday 9pm Riyadh" is Sunday 6pm UTC, and bucketing on UTC would shift a third of the week's posts into the wrong heatmap cell.

Each section is wrapped in `safe()`: a failure is contained to its own key and the page renders the rest around the hole, rather than one rate-limited call blanking nine charts."""


META_PUBLISH_JS = r"""const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine. Copied deliberately from the
// Zernio publish node rather than shared: n8n Code nodes have no import, and
// a helper that only half-exists in one of two publishing paths is worse than
// the duplication. See that node for the full incident writeup — Docker's
// embedded resolver drops a lookup occasionally, and ONLY name resolution is
// retried because a DNS failure proves the request never reached the provider.
// A reset or a timeout carries no such proof, and re-sending one of those is
// exactly how you publish the same photo twice.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

// ── Meta Graph API ──────────────────────────────────────────────────────
// Pinned to v23.0, NOT the v20.0 the original hand-off snippet used. v20 is
// old enough that it still serves the `impressions` metric, which Meta
// removed in v22 — so a v20 pin would have the insights sync reading a
// number Meta no longer computes, and silently reporting stale or zero
// engagement. v27.0 does not exist yet (verified: it 404s on the user node).
const GRAPH   = 'https://graph.facebook.com/v23.0';
const IG_TOKEN = $env.META_IG_TOKEN;
const IG_USER  = $env.META_IG_USER_ID;

// Meta answers with 200 + an `error` object about as often as it answers with
// a 4xx, and n8n's thrown-error shape for non-2xx varies by version (the body
// lands under different keys depending on how the client wraps axios), which
// is how this class of bug surfaces as a useless "Request failed with status
// code 400". So: never let the client throw, read the parsed body ourselves,
// and treat a body-level `error` as a failure regardless of status.
// n8n's Code node sandbox does not expose URLSearchParams (or other
// browser/Node globals not on its curated global list) — confirmed live
// 2026-08-20, every graph() call failed with "URLSearchParams is not
// defined" until this was hand-rolled. Every value passed through here is a
// primitive (ids, metric names, the access token, a comma-joined list), so
// this needs none of URLSearchParams' array/nested-object handling.
function qsEncode(obj){
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
async function graph(method, path, params = {}){
  const qs = qsEncode({ ...params, access_token: IG_TOKEN });
  const opts = method === 'GET'
    ? { method: 'GET', url: `${GRAPH}/${path}?${qs}` }
    : { method: 'POST', url: `${GRAPH}/${path}`, body: qs,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } };
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true, json: true });
  const b = res.body && typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  if (b && b.error){
    const e = b.error;
    // error_user_msg is the human sentence Meta writes for the person who
    // owns the account ("The image aspect ratio is not supported"); `message`
    // is the developer one. Prefer the former when present — it is what an
    // operator can actually act on without opening the Graph API reference.
    const detail = e.error_user_msg || e.message || JSON.stringify(e).slice(0, 300);
    const sub = e.error_subcode ? ` (subcode ${e.error_subcode})` : '';
    throw new Error(`Instagram ${e.code || res.statusCode}${sub}: ${detail}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300){
    throw new Error(`Instagram HTTP ${res.statusCode}: ${JSON.stringify(b).slice(0, 300)}`);
  }
  return b;
}

// Instagram's publish API documents JPEG as the only supported still format,
// and every image in this pipeline is stored as WEBP (kept everywhere else
// for size). Rather than re-encoding our storage, route just the outbound
// URL through images.weserv.nl, a free no-auth image CDN that converts on the
// fly.
//
// Kept even though a WEBP container was observed reaching FINISHED against
// v23.0 on 2026-08-19 — Meta appears to accept it now, but FINISHED only
// proves Meta could DOWNLOAD the file, not that the published render is
// correct, and the cost of being wrong is a broken post on a live grid. PNG
// is converted for the same reason: also undocumented, also not worth
// discovering the hard way.
function toPublishable(u){
  if (!u || !/\.(webp|png)(\?|#|$)/i.test(u)) return u;
  return `https://images.weserv.nl/?url=${encodeURIComponent(u)}&output=jpg`;
}

// Bilingual captions are stored as one string, Arabic block + "\n\n—\n\n" +
// English block. Because the string OPENS with Arabic, a renderer that treats
// it as a single bidi paragraph — Instagram's does; it does not treat blank
// lines as paragraph breaks — resolves the whole thing at RTL embedding
// level, and neutral characters in the English half (a trailing ".", the "+"
// in "45+") visually jump to the wrong side of their line. Wrapping each
// block in a Unicode directional isolate forces it to resolve independently.
const LRI = '⁦', RLI = '⁧', PDI = '⁩';
const isArabicScript = s => /[؀-ۿݐ-ݿ]/.test(s);
function isolateBilingual(text){
  const SEP = '\n\n—\n\n';
  const idx = text.indexOf(SEP);
  if (idx === -1) return text;
  const first  = text.slice(0, idx);
  const second = text.slice(idx + SEP.length);
  const wrap = s => s ? (isArabicScript(s) ? RLI : LRI) + s + PDI : s;
  return wrap(first) + SEP + wrap(second);
}

const ALLOWED_TABLES = ['instagram_generated_posts','generated_posts'];
const CAPTION_MAX = 2200;   // Instagram's hard limit, enforced at publish.

async function patchRow(table, id, fields){
  if (!id || !ALLOWED_TABLES.includes(table)) return;
  try {
    await http({ method:'PATCH', url:`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`,
      headers:{ ...sHeaders, Prefer:'return=minimal' }, body: fields, json:true });
  } catch (e) { /* never let bookkeeping mask the real publish result */ }
}

// ── Wall clock -> absolute instant ──────────────────────────────────────
// `scheduled_publish_at` is timestamptz — an absolute instant — while the UI
// sends a naive wall time plus the zone to read it in. Writing the naive
// string straight into the column makes Postgres resolve it in the SESSION
// zone (UTC on Supabase), so 7 PM Riyadh lands as 7 PM UTC: three hours late.
// That bug was fixed once on the Zernio path; the conversion lives here for
// the same reason it lived there — this node is the last thing between any
// caller and the column, so a cron or a future bulk runner cannot reintroduce
// it by forgetting to convert.
function offsetMsAt(utcMs, tz){
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit',
  }).formatToParts(utcMs)) p[type] = value;
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asIfUtc - Math.floor(utcMs / 1000) * 1000;
}
function wallToUtcISO(wall, tz){
  const s = String(wall || '').trim();
  if (!s) return null;
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(s)){
    const ms = Date.parse(s);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let utcMs = guess - offsetMsAt(guess, tz);
  const refined = guess - offsetMsAt(utcMs, tz);   // second pass matters across DST
  if (refined !== utcMs) utcMs = refined;
  return new Date(utcMs).toISOString();
}

// ── Claim a post for publishing, atomically ─────────────────────────────
// Identical in spirit to the Zernio node's guard, and for the identical
// reason: a read-then-check cannot work, because two callers both read
// "not published" before either writes. So the claim IS the check — PATCH
// filtered on the states it is legal to publish FROM, asking for the row
// back. Postgres serialises the two updates, exactly one caller sees a row,
// and whoever gets the row owns the publish.
//
// It matters MORE here than it did with Zernio. Instagram publishing is two
// round trips (create container, then publish it) with a media download by
// Meta in between, so the window in which a second caller can arrive is
// seconds wide rather than milliseconds. And the cron sweeper below means
// there is now genuinely a second caller: a 5-minute tick can collide with
// someone hitting Publish by hand on the same post.
//
// `from` is the set of legal starting states, and differs by caller:
//   hand publish  — not_published, failed
//   reschedule    — + scheduled  (moving a post we hold the slot for)
//   cron sweeper  — scheduled ONLY (its whole job is due scheduled posts)
// 'publishing' is never legal. A row in flight is someone else's, and
// re-entering it is the exact bug this closes.
async function claimPost(table, id, from, force){
  if (!id) return { ok: true, claimed: false, row: {} };
  if (force === true) return { ok: true, claimed: true, forced: true, row: {} };
  const rows = await http({
    method:'PATCH',
    url:`${SUPA_URL}/rest/v1/${table}?id=eq.${id}&publish_status=in.(${from.join(',')})`,
    headers:{ ...sHeaders, Prefer:'return=representation' },
    body:{ publish_status:'publishing', publish_error:'',
           // Stamped here so a row stuck in 'publishing' can be AGED by the
           // reconciler below. updated_at cannot serve — any unrelated edit
           // touches it, so a post wedged for an hour can look one second old.
           publish_started_at: new Date().toISOString() },
    json:true });
  if (Array.isArray(rows) && rows.length) return { ok: true, claimed: true, row: rows[0] || {} };

  let current = {};
  try {
    const got = await http({ method:'GET',
      url:`${SUPA_URL}/rest/v1/${table}?id=eq.${id}&select=publish_status,zernio_post_id,platform_post_url,meta_container_id`,
      headers:sHeaders, json:true });
    current = (Array.isArray(got) && got[0]) || {};
  } catch (e) { /* the refusal stands either way */ }
  return { ok: false, claimed: false, current };
}

// ── The two-step container dance ────────────────────────────────────────
// Instagram cannot publish in one call: Meta has to fetch the media off a
// public URL first, so you create a CONTAINER, wait for Meta to finish
// downloading it, and only then publish the container.
//
// The trap — verified against the live API on 2026-08-19 — is that creating
// a container ALWAYS returns an id immediately, even for media Meta will
// later reject. A WEBP url (which Meta's own docs list as unsupported) came
// back with a perfectly normal id. So the id is an acknowledgement, not a
// success, and code that publishes straight off it is trusting a receipt for
// a package that has not arrived. status_code is the only real answer.
async function createContainer(params){
  const out = await graph('POST', `${IG_USER}/media`, params);
  const id = out && out.id;
  if (!id) throw new Error(`Instagram accepted the container request but returned no id: ${JSON.stringify(out).slice(0, 300)}`);
  return id;
}

// FINISHED -> publishable. IN_PROGRESS -> keep waiting. ERROR/EXPIRED ->
// stop, and surface Meta's own reason, which is where the genuinely useful
// diagnostics live (aspect ratio, file size, unreachable URL, bad codec).
async function waitForContainer(containerId, timeoutMs){
  const deadline = Date.now() + timeoutMs;
  let delay = 2000, last = '';
  while (Date.now() < deadline){
    const s = await graph('GET', containerId, { fields: 'status_code,status' });
    const code = String((s && s.status_code) || '');
    last = String((s && s.status) || code);
    if (code === 'FINISHED') return true;
    if (code === 'ERROR' || code === 'EXPIRED'){
      throw new Error(`Instagram could not process the media (${code}): ${last}`);
    }
    await new Promise(r => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 10000);   // back off; video takes minutes
  }
  throw new Error(`Instagram was still processing the media after ${Math.round(timeoutMs / 1000)}s — last status: ${last}. The container stays valid for 24h, so the post can be retried.`);
}

// Publishing is capped per rolling 24h (100 on the test account, read live
// rather than assumed — it varies). Checked BEFORE claiming so a quota-blocked
// post stays 'scheduled' and gets swept again later, instead of being burned
// to 'failed' for a condition that clears on its own.
async function quotaBlocked(){
  try {
    const r = await graph('GET', `${IG_USER}/content_publishing_limit`, { fields: 'config,quota_usage' });
    const row = (r && r.data && r.data[0]) || {};
    const used = Number(row.quota_usage || 0);
    const cap  = Number((row.config && row.config.quota_total) || 0);
    if (cap && used >= cap) return `Instagram's publishing quota is used up (${used}/${cap} in the last 24h). This post stays scheduled and will go out once the window rolls over.`;
    return '';
  } catch (e) {
    // A quota check that fails is not a reason to refuse to publish — Meta
    // enforces the real limit anyway, and its error would be clearer.
    return '';
  }
}

// Assemble and push one post. Returns { mediaId, permalink, containerId }.
async function publishMedia({ caption, imageUrl, imageUrls, videoUrl, coverImageUrl, altText, onContainer }){
  const urls = (Array.isArray(imageUrls) && imageUrls.length ? imageUrls : [imageUrl])
    .filter(Boolean).map(toPublishable);

  let containerId, timeout;

  if (videoUrl){
    // A video posted to a business account's feed is a Reel — Instagram
    // retired standalone feed video, and REELS is the only media_type the
    // API accepts for one. share_to_feed puts it on the grid as well as the
    // Reels tab, which is what "post a video" means to everyone using this.
    const params = { media_type: 'REELS', video_url: videoUrl, share_to_feed: 'true' };
    if (caption) params.caption = caption;
    if (coverImageUrl) params.cover_url = toPublishable(coverImageUrl);
    containerId = await createContainer(params);
    timeout = 8 * 60 * 1000;   // Meta transcodes; minutes, not seconds
  } else if (urls.length > 1){
    // Carousel: every slide is its own container created with
    // is_carousel_item, then ONE parent container ties them together. The
    // children carry no caption — only the parent does.
    const children = [];
    for (const u of urls.slice(0, 10)){          // Instagram's cap is 10
      children.push(await createContainer({ image_url: u, is_carousel_item: 'true' }));
    }
    // Wait for the slides BEFORE building the parent. A parent built over a
    // child Meta has not finished downloading fails as an opaque parent-level
    // error that says nothing about which slide was the problem.
    for (const c of children) await waitForContainer(c, 90 * 1000);
    const params = { media_type: 'CAROUSEL', children: children.join(',') };
    if (caption) params.caption = caption;
    containerId = await createContainer(params);
    timeout = 2 * 60 * 1000;
  } else if (urls.length === 1){
    const params = { image_url: urls[0] };
    if (caption) params.caption = caption;
    if (altText) params.alt_text = String(altText).slice(0, 1000);
    containerId = await createContainer(params);
    timeout = 2 * 60 * 1000;
  } else {
    // Instagram has no text-only post. Reaching here with a caption and no
    // media is a caller bug, and saying so beats Meta's generic complaint.
    throw new Error('Instagram cannot publish a caption with no media — every post needs at least one image or a video.');
  }

  // Recorded BEFORE the publish call, because the gap between "container is
  // ready" and "media_publish returned" is the one window where a crash
  // leaves real ambiguity. The container survives 24h at Meta, so persisting
  // its id is what turns "did that go out?" into a question with an answer.
  if (onContainer) await onContainer(containerId);

  await waitForContainer(containerId, timeout);

  const published = await graph('POST', `${IG_USER}/media_publish`, { creation_id: containerId });
  const mediaId = published && published.id;
  if (!mediaId) throw new Error(`Instagram published the container but returned no media id: ${JSON.stringify(published).slice(0, 300)}`);

  // permalink is what fills platform_post_url — the "View post" link in the
  // UI. Best-effort: the post is already live, and failing the whole publish
  // because a follow-up read timed out would be absurd.
  let permalink = '', timestamp = '';
  try {
    const media = await graph('GET', mediaId, { fields: 'permalink,timestamp' });
    permalink = (media && media.permalink) || '';
    timestamp = (media && media.timestamp) || '';
  } catch (e) { /* non-fatal */ }

  return { mediaId, permalink, timestamp, containerId };
}

// ── One post, end to end ────────────────────────────────────────────────
// `from` is the claim's legal starting states — see claimPost.
async function runOne(job, from){
  const table = job.post_table || 'generated_posts';
  const postId = job.post_id || '';
  if (!ALLOWED_TABLES.includes(table)) throw new Error(`Unknown post_table: ${table}`);

  const caption  = isolateBilingual(String(job.caption || '').trim());
  const hashtags = String(job.hashtags || '').trim();
  const content  = [caption, hashtags].filter(Boolean).join('\n\n');

  const blocked = await quotaBlocked();
  if (blocked) return { ok: false, post_id: postId, skipped: true, quota: true, error: blocked };

  const claim = await claimPost(table, postId, from, job.force === true);
  if (!claim.ok){
    // RETURN, never throw. The caller's catch writes publish_status='failed',
    // and reaching it here would stamp 'failed' onto a post that is in fact
    // live — turning a harmless double-click into corrupted state.
    const cur = claim.current || {};
    const st = cur.publish_status || 'in flight';
    return { ok: false, skipped: true, post_id: postId, publish_status: st,
             zernio_post_id: cur.zernio_post_id || '',
             platform_post_url: cur.platform_post_url || '',
             error: `Already ${st} — refusing to publish this post a second time. Send force:true to override.` };
  }

  try {
    // Validated after the claim, and thrown rather than returned, so it lands
    // in this function's own catch: the row is marked 'failed' with the reason
    // and the CALLER carries on.
    //
    // Both halves of that matter. Returning early instead would leave a
    // scheduled post sitting in 'scheduled' with a caption that can never
    // publish, so the cron would pick it up again every five minutes forever
    // and nothing would ever say why. Throwing before the claim was worse
    // still: it escaped runOne entirely and aborted the whole sweep, so one
    // over-long caption stopped every other post due that tick from going out.
    //
    // Refused rather than truncated, on purpose: these captions are bilingual,
    // and a blind cut at 2200 lands mid-sentence in whichever language happens
    // to come second.
    if (content.length > CAPTION_MAX){
      throw new Error(`Caption + hashtags are ${content.length} characters; Instagram's limit is ${CAPTION_MAX}. Shorten it by ${content.length - CAPTION_MAX} and publish again.`);
    }

    const out = await publishMedia({
      caption: content,
      imageUrl: job.image_url || '',
      imageUrls: job.image_urls,
      videoUrl: job.video_url || '',
      coverImageUrl: job.cover_image_url || '',
      altText: job.alt_text || '',
      onContainer: cid => patchRow(table, postId, { meta_container_id: cid }),
    });

    await patchRow(table, postId, {
      // The Instagram MEDIA id, in the column Zernio's id used to occupy —
      // see the migration header for why it was not renamed.
      zernio_post_id: out.mediaId,
      zernio_account_id: IG_USER,
      publish_provider: 'meta',
      publish_status: 'published',
      published_at: out.timestamp || new Date().toISOString(),
      platform_post_url: out.permalink,
      publish_error: '',
      meta_container_id: '',
      scheduled_publish_at: null,
    });

    return { ok: true, post_id: postId, platform: job.platform || 'instagram',
             zernio_post_id: out.mediaId, publish_status: 'published',
             account_id: IG_USER, platform_post_url: out.permalink };
  } catch (err){
    const message = (err && err.message) ? err.message : String(err);
    await patchRow(table, postId, { publish_status: 'failed', publish_error: message });
    return { ok: false, post_id: postId, error: message };
  }
}

// ════════════════════════════════════════════════════════════════════════
// Entry. Fired by EITHER the webhook (a body) or the 5-minute schedule
// trigger (no body) — both shapes have to be tolerated, same as the Zernio
// sync node.
// ════════════════════════════════════════════════════════════════════════
const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || {};
const isCron = !raw.body;

try {
  if (!IG_TOKEN) throw new Error('META_IG_TOKEN is not set on this n8n instance.');
  if (!IG_USER)  throw new Error('META_IG_USER_ID is not set on this n8n instance.');

  // ══════════════════════════════════════════════════════════════════════
  // CRON: sweep everything due, then unwedge anything stuck.
  //
  // This is the part with no Zernio equivalent, and the reason it exists is
  // simple: the Instagram Graph API has NO scheduling. Meta publishes now or
  // not at all, and a media container expires after 24h, so "hand it to the
  // platform early" is not available the way it was with Zernio.
  //
  // Which is a straight improvement in one respect — WE own the slot now.
  // Under Zernio a scheduled post lived at Zernio, our column was a copy,
  // and if the two disagreed Zernio won and the post fired at the old time.
  // That is the entire reason rescheduling needed a cancel-then-recreate
  // dance. Here a reschedule is one UPDATE, and it cannot desync, because
  // there is no second copy to desync from.
  // ══════════════════════════════════════════════════════════════════════
  if (isCron){
    const nowISO = new Date().toISOString();
    const results = [];

    // Stop before n8n does. The task runner kills a Code node at
    // N8N_RUNNERS_TASK_TIMEOUT (600s on this instance, see docker-compose),
    // and this loop publishes sequentially with an 8-minute poll budget per
    // Reel — so two slow videos in one tick would be executed straight through
    // that ceiling. Being killed mid-publish is the worst available outcome:
    // it strands a row in 'publishing' that nothing can claim until the
    // reconciler ages it out 20 minutes later.
    //
    // 7 minutes leaves room for the in-flight post to finish and for the
    // reconciler pass below to run. Anything not reached is simply still due
    // on the next tick five minutes from now, which is what a queue is for.
    const sweepDeadline = Date.now() + 7 * 60 * 1000;
    let outOfTime = false;

    for (const table of ALLOWED_TABLES){
      let due = [];
      try {
        due = await http({ method:'GET',
          url:`${SUPA_URL}/rest/v1/${table}?select=id,workspace_id,platform,caption,hashtags,image_url,image_urls,video_url,cover_image_url,alt_text`
              + `&publish_status=eq.scheduled&scheduled_publish_at=lte.${nowISO}`
              + `&order=scheduled_publish_at.asc&limit=25`,
          headers:sHeaders, json:true });
      } catch (e) { continue; }   // a table that doesn't exist here is fine

      for (const row of (due || [])){
        if (Date.now() > sweepDeadline){ outOfTime = true; break; }
        // Sequential, not parallel. Instagram rate-limits publishing, Meta
        // has to download each file, and a burst of parallel publishes is
        // both slower in practice and far harder to reason about when one
        // of them fails halfway.
        const r = await runOne({
          post_id: row.id, post_table: table, workspace_id: row.workspace_id,
          platform: row.platform || 'instagram',
          caption: row.caption || '', hashtags: row.hashtags || '',
          image_url: row.image_url || '', image_urls: row.image_urls,
          video_url: row.video_url || '', cover_image_url: row.cover_image_url || '',
          alt_text: row.alt_text || '',
        }, ['scheduled']);
        results.push(r);
        // Quota is account-wide: once it bites, every remaining post in this
        // tick will hit it too. Stop rather than grind through them.
        if (r.quota) break;
      }
      if (outOfTime) break;
    }

    // ── Unwedge rows stuck in 'publishing' ──────────────────────────────
    // A run that dies between the claim and the write-back leaves a row in
    // 'publishing' forever: nothing else will touch it, because 'publishing'
    // is not a legal state to claim from. Under Zernio the only cure was a
    // human sending force:true.
    //
    // 20 minutes is comfortably past the worst legitimate case (an 8-minute
    // Reel transcode plus retries), so anything older is genuinely dead. It
    // is moved to 'failed', never retried automatically — meta_container_id
    // may name a container that was already published, and a blind retry is
    // how you double-post. Failed is visible in the UI and one click from a
    // human decision, which is the right owner for that call.
    const cutoff = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    let unwedged = 0;
    for (const table of ALLOWED_TABLES){
      try {
        const stuck = await http({ method:'PATCH',
          url:`${SUPA_URL}/rest/v1/${table}?publish_status=eq.publishing&publish_started_at=lt.${cutoff}`,
          headers:{ ...sHeaders, Prefer:'return=representation' },
          body:{ publish_status:'failed',
                 publish_error:'Publishing was interrupted and never finished. Check the Instagram account before republishing — if the post is already live, mark it published instead of sending it again.' },
          json:true });
        unwedged += (Array.isArray(stuck) ? stuck.length : 0);
      } catch (e) { /* non-fatal */ }
    }

    return [{ json: { ok: true, mode: 'sweep', due: results.length,
                      published: results.filter(r => r.ok).length,
                      failed: results.filter(r => !r.ok && !r.skipped).length,
                      skipped: results.filter(r => r.skipped).length,
                      // Surfaced rather than swallowed: a tick that keeps
                      // running out of time is the signal that the 5-minute
                      // cadence no longer fits the queue.
                      out_of_time: outOfTime || undefined,
                      unwedged, results: results.slice(0, 25) } }];
  }

  // ══════════════════════════════════════════════════════════════════════
  // WEBHOOK
  // ══════════════════════════════════════════════════════════════════════
  const table  = body.post_table || 'generated_posts';
  const postId = body.post_id || '';
  if (!ALLOWED_TABLES.includes(table)) throw new Error(`Unknown post_table: ${table}`);

  const isReschedule = body.reschedule === true;

  // ---- cancel-only: give the slot back, keep the post ----
  // Under Zernio this had to call out and delete a post the provider held.
  // Here the slot only ever existed in our own row, so the cancel is the
  // update. Kept as its own branch and its own request shape so the browser
  // call sites do not have to change.
  if (isReschedule && body.cancel_only === true){
    const c = await claimPost(table, postId, ['not_published','failed','scheduled'], false);
    if (!c.ok){
      const cur = c.current || {};
      return [{ json: { ok:false, skipped:true, post_id:postId,
        publish_status: cur.publish_status || 'in flight',
        error: `Cannot unschedule a post that is ${cur.publish_status || 'in flight'}.` } }];
    }
    await patchRow(table, postId, { publish_status:'not_published', publish_error:'',
                                    scheduled_publish_at:null, publish_started_at:null });
    return [{ json: { ok:true, post_id:postId, publish_status:'not_published', cancelled:true } }];
  }

  // ---- schedule: book the slot, publish nothing ----
  // No Meta call at all. The 5-minute sweeper above is what eventually
  // publishes this, which is the whole architecture in one line.
  const scheduledFor = body.scheduled_for || '';
  if (scheduledFor){
    const tz = body.timezone || 'Asia/Riyadh';
    const whenISO = wallToUtcISO(scheduledFor, tz);
    if (!whenISO){
      throw new Error(`Unparseable scheduled_for: ${JSON.stringify(scheduledFor)} (expected 'YYYY-MM-DDTHH:MM' read in ${tz}).`);
    }
    const from = isReschedule ? ['not_published','failed','scheduled'] : ['not_published','failed'];
    const c = await claimPost(table, postId, from, body.force === true);
    if (!c.ok){
      const cur = c.current || {};
      const st = cur.publish_status || 'in flight';
      return [{ json: { ok:false, skipped:true, post_id:postId, publish_status:st,
        error: `Cannot schedule a post that is ${st}.` } }];
    }
    await patchRow(table, postId, {
      publish_status: 'scheduled', publish_error: '',
      scheduled_publish_at: whenISO, publish_started_at: null,
      publish_provider: 'meta', zernio_account_id: IG_USER,
    });
    return [{ json: { ok:true, post_id:postId, platform: body.platform || 'instagram',
                      publish_status:'scheduled', scheduled_publish_at: whenISO,
                      account_id: IG_USER } }];
  }

  // ---- publish now ----
  const from = isReschedule ? ['not_published','failed','scheduled'] : ['not_published','failed'];
  const result = await runOne(body, from);
  return [{ json: result }];

} catch (err) {
  const message = (err && err.message) ? err.message : String(err);
  // Only stamp the row when we know which row, and only from the webhook
  // path — a cron-level failure is about the sweep, not about any one post.
  if (!isCron && body.post_id && ALLOWED_TABLES.includes(body.post_table || '')){
    await patchRow(body.post_table, body.post_id, { publish_status:'failed', publish_error: message });
  }
  return [{ json: { ok: false, post_id: body.post_id || '', error: message } }];
}"""


META_SYNC_JS = r"""const rawHttp = this.helpers.httpRequest;

// DNS-only retry — see the Meta publish node for the full reasoning. A name
// lookup that fails never reached Meta, so re-sending it is free; anything
// else might have landed and is not retried.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawHttp(opts); }
    catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const GRAPH    = 'https://graph.facebook.com/v23.0';
const IG_TOKEN = $env.META_IG_TOKEN;
const IG_USER  = $env.META_IG_USER_ID;
const BRAND_TZ = 'Asia/Riyadh';

// n8n's Code node sandbox does not expose URLSearchParams — see the same
// fix's comment in the Publish workflow's graph().
function qsEncode(obj){
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
async function graph(path, params = {}){
  const qs = qsEncode({ ...params, access_token: IG_TOKEN });
  const res = await http({ method:'GET', url:`${GRAPH}/${path}?${qs}`,
    returnFullResponse:true, ignoreHttpStatusErrors:true, json:true });
  const b = res.body && typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  if (b && b.error){
    const e = b.error;
    throw new Error(`Instagram ${e.code || res.statusCode}: ${e.error_user_msg || e.message || JSON.stringify(e).slice(0,300)}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300){
    throw new Error(`Instagram HTTP ${res.statusCode}: ${JSON.stringify(b).slice(0,300)}`);
  }
  return b;
}

const POST_TABLES = ['instagram_generated_posts','generated_posts'];

// ── What Instagram actually measures, per media type ────────────────────
// Meta rejects the ENTIRE insights call if a single requested metric is not
// valid for that media's type, so these lists cannot be one union — they
// have to be chosen per media_product_type.
//
// Verified against the live API on 2026-08-19 (v23.0, FEED IMAGE): reach,
// likes, comments, saved, shares, total_interactions, views, profile_visits,
// profile_activity and follows all answer; `impressions` and `plays` are
// gone — Meta removed impressions in v22 and now serves `views` in its
// place, and `navigation`/`replies` are Story-only.
//
// CORE is the fallback for a type we guessed wrong about: the five metrics
// every surface reports. Better a thinner row than no row.
const METRICS_BY_TYPE = {
  REELS: ['reach','likes','comments','saved','shares','views','total_interactions'],
  STORY: ['reach','views','replies','shares','profile_visits','follows','navigation'],
  FEED:  ['reach','likes','comments','saved','shares','views','total_interactions','profile_visits','follows'],
};
const CORE = ['reach','likes','comments','saved','shares'];

// Instagram's metric names -> our post_analytics columns.
//
// `impressions` and `clicks` are deliberately unmapped. Instagram no longer
// reports impressions at all (v22 removed it in favour of views), and there
// is no per-media click metric — profile_visits is a different thing and
// filing it under clicks would quietly turn "someone tapped a link" into
// "someone looked at the profile". They stay 0 AND stay out of
// metrics_present, which is exactly the distinction that column exists to
// preserve: not measured is not the same as measured zero.
const METRIC_TO_COLUMN = {
  reach: 'reach', likes: 'likes', comments: 'comments',
  saved: 'saves', shares: 'shares', views: 'views',
};

function today(){ return new Date().toISOString().slice(0, 10); }

// Fetch insights for one media, degrading rather than failing. A post whose
// type we mis-guessed still yields the core five instead of nothing.
async function mediaInsights(mediaId, productType, mediaType){
  const key = productType === 'REELS' ? 'REELS'
            : productType === 'STORY' ? 'STORY'
            : 'FEED';
  for (const set of [METRICS_BY_TYPE[key], CORE]){
    try {
      const r = await graph(`${mediaId}/insights`, { metric: set.join(',') });
      const out = {};
      for (const m of ((r && r.data) || [])){
        const v = m.values && m.values[0];
        out[m.name] = (v && typeof v.value === 'number') ? v.value : 0;
      }
      if (Object.keys(out).length) return out;
    } catch (e) { /* try the narrower set */ }
  }
  return {};
}

const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || {};

try {
  if (!IG_TOKEN) throw new Error('META_IG_TOKEN is not set on this n8n instance.');
  if (!IG_USER)  throw new Error('META_IG_USER_ID is not set on this n8n instance.');

  // ══ 1) the account itself ════════════════════════════════════════════
  const profile = await graph(IG_USER, {
    fields: 'id,username,name,profile_picture_url,followers_count,follows_count,media_count',
  });

  // Which workspaces should see this account? Meta, like Zernio, has no
  // notion of our workspaces — one token is one Instagram account. Mirror it
  // into whichever workspace asked (webhook), or into every workspace that
  // already has a stake: an existing social_accounts row, or a post already
  // published through Meta. The second source matters on a fresh install,
  // where the first publish happens before any account row exists and the
  // sync would otherwise have nowhere to write.
  let workspaceIds = [];
  if (body.workspace_id){
    workspaceIds = [body.workspace_id];
  } else {
    const seen = new Set();
    try {
      const rows = await http({ method:'GET', url:`${SUPA_URL}/rest/v1/social_accounts?select=workspace_id`, headers:sHeaders, json:true });
      for (const r of (rows || [])) if (r.workspace_id) seen.add(r.workspace_id);
    } catch (e) { /* fall through to posts */ }
    for (const t of POST_TABLES){
      try {
        const rows = await http({ method:'GET',
          url:`${SUPA_URL}/rest/v1/${t}?select=workspace_id&publish_provider=eq.meta&zernio_post_id=neq.&limit=500`,
          headers:sHeaders, json:true });
        for (const r of (rows || [])) if (r.workspace_id) seen.add(r.workspace_id);
      } catch (e) { /* table may not exist */ }
    }
    workspaceIds = [...seen];
  }

  let accountsSynced = 0;
  for (const wsId of workspaceIds){
    try {
      await http({ method:'POST', url:`${SUPA_URL}/rest/v1/social_accounts?on_conflict=workspace_id,zernio_account_id`,
        headers:{ ...sHeaders, Prefer:'resolution=merge-duplicates,return=minimal' },
        body:{ workspace_id: wsId, zernio_account_id: IG_USER, platform: 'instagram',
               publish_provider: 'meta',
               username: profile.username || '', display_name: profile.name || '',
               profile_picture: profile.profile_picture_url || '',
               profile_url: profile.username ? `https://www.instagram.com/${profile.username}/` : '',
               is_active: true, needs_reconnection: false,
               followers_count: profile.followers_count || 0,
               last_synced_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        json:true });
      accountsSynced++;
    } catch (e) { /* one bad row must not abort the sync */ }
  }

  // ══ 2) account-level daily row ═══════════════════════════════════════
  // Two calls, not one, and that is a hard API constraint rather than a
  // style choice: Instagram splits account insights into a time series
  // (follower_count) and aggregates that REQUIRE metric_type=total_value
  // (everything else), and mixing them in one request is an outright #100
  // error naming the offending metric. Verified live on 2026-08-19.
  const acct = {};
  const TOTAL_VALUE = ['reach','views','profile_views','accounts_engaged','total_interactions','likes','comments','saves','shares','website_clicks'];
  try {
    const r = await graph(`${IG_USER}/insights`, {
      metric: TOTAL_VALUE.join(','), period: 'day', metric_type: 'total_value',
    });
    for (const m of ((r && r.data) || [])){
      acct[m.name] = (m.total_value && typeof m.total_value.value === 'number') ? m.total_value.value : 0;
    }
  } catch (e) { /* a bad day of account insights must not lose the post rows */ }

  const acctPresent = Object.keys(acct).map(k => k === 'website_clicks' ? 'clicks'
    : k === 'profile_views' ? 'profile_views' : k).filter(Boolean);

  let accountRows = 0;
  for (const wsId of workspaceIds){
    try {
      await http({ method:'POST', url:`${SUPA_URL}/rest/v1/account_analytics?on_conflict=workspace_id,account_id,metric_date`,
        headers:{ ...sHeaders, Prefer:'resolution=merge-duplicates,return=minimal' },
        body:{ workspace_id: wsId, account_id: IG_USER, platform:'instagram', publish_provider:'meta',
               metric_date: today(),
               // Straight off the profile, NOT the follower_count insight
               // metric — that one returns an empty series on small accounts
               // (confirmed: the test account has 1 follower and gets
               // `data: []`), which would leave the follower chart blank for
               // a brand-new account rather than merely flat.
               followers_count: profile.followers_count || 0,
               follows_count: profile.follows_count || 0,
               media_count: profile.media_count || 0,
               reach: acct.reach || 0, views: acct.views || 0,
               profile_views: acct.profile_views || 0,
               accounts_engaged: acct.accounts_engaged || 0,
               total_interactions: acct.total_interactions || 0,
               likes: acct.likes || 0, comments: acct.comments || 0,
               saves: acct.saves || 0, shares: acct.shares || 0,
               clicks: acct.website_clicks || 0,
               metrics_present: ['followers_count','follows_count','media_count'].concat(acctPresent),
               synced_at: new Date().toISOString() },
        json:true });
      accountRows++;
    } catch (e) { /* non-fatal */ }
  }

  // ══ 3) per-post metrics ══════════════════════════════════════════════
  // Every post we published through Meta. `zernio_post_id` holds the
  // Instagram media id on these rows — see the migration header.
  const wsFilter = body.workspace_id ? `&workspace_id=eq.${body.workspace_id}` : '';
  const targets = [];
  for (const table of POST_TABLES){
    try {
      const rows = await http({ method:'GET',
        url:`${SUPA_URL}/rest/v1/${table}?select=id,workspace_id,zernio_post_id,zernio_account_id,publish_status,platform`
            + `&zernio_post_id=neq.&publish_provider=eq.meta&publish_status=eq.published${wsFilter}&limit=500`,
        headers:sHeaders, json:true });
      for (const r of (rows || [])) if (r.zernio_post_id) targets.push({ ...r, post_table: table });
    } catch (e) { /* a missing table is fine */ }
  }

  let rowsWritten = 0;
  const errors = [];

  for (const t of targets){
    try {
      // media_product_type decides which metrics are even askable, so it has
      // to be read before the insights call rather than assumed.
      const media = await graph(t.zernio_post_id, {
        fields: 'id,media_type,media_product_type,timestamp,permalink,like_count,comments_count',
      });
      const ins = await mediaInsights(t.zernio_post_id, media.media_product_type, media.media_type);

      const row = { impressions:0, reach:0, likes:0, comments:0, shares:0, saves:0, clicks:0, views:0 };
      const present = [];
      for (const [metric, column] of Object.entries(METRIC_TO_COLUMN)){
        if (ins[metric] === undefined) continue;
        row[column] = ins[metric] || 0;
        present.push(column);
      }
      // like_count / comments_count come off the media node itself and are
      // populated even when the insights call degraded to CORE — prefer a
      // real number over a zero we merely failed to fetch.
      if (typeof media.like_count === 'number' && !present.includes('likes')){ row.likes = media.like_count; present.push('likes'); }
      if (typeof media.comments_count === 'number' && !present.includes('comments')){ row.comments = media.comments_count; present.push('comments'); }

      await http({ method:'POST', url:`${SUPA_URL}/rest/v1/post_analytics?on_conflict=zernio_post_id,platform,metric_date`,
        headers:{ ...sHeaders, Prefer:'resolution=merge-duplicates,return=minimal' },
        body:{ workspace_id: t.workspace_id, zernio_post_id: t.zernio_post_id,
               platform: t.platform || 'instagram', platform_post_id: t.zernio_post_id,
               post_table: t.post_table, post_id: t.id,
               zernio_account_id: t.zernio_account_id || IG_USER,
               publish_provider: 'meta',
               // One row per day, overwritten within the day. Instagram
               // reports LIFETIME totals — it has no per-day breakdown for a
               // post — so the daily series that the engagement-accumulation
               // chart reads is one we build by snapshotting, not one Meta
               // hands us. That is also why this sync has to run daily even
               // when nothing was published: a missed day is a hole in the
               // curve that can never be backfilled.
               metric_date: today(),
               ...row,
               metrics_present: [...new Set(present)],
               synced_at: new Date().toISOString() },
        json:true });
      rowsWritten++;

      // Keep platform_post_url honest — a post published before the permalink
      // read succeeded would otherwise never get its link.
      if (media.permalink){
        try {
          await http({ method:'PATCH', url:`${SUPA_URL}/rest/v1/${t.post_table}?id=eq.${t.id}&platform_post_url=eq.`,
            headers:{ ...sHeaders, Prefer:'return=minimal' },
            body:{ platform_post_url: media.permalink }, json:true });
        } catch (e) { /* non-fatal */ }
      }
    } catch (e) {
      errors.push({ media_id: t.zernio_post_id, error: (e && e.message) || String(e) });
    }
  }

  return [{ json: { ok: true, account: profile.username || IG_USER,
                    followers: profile.followers_count || 0,
                    accounts_synced: accountsSynced, account_rows: accountRows,
                    posts_checked: targets.length, rows_written: rowsWritten,
                    errors: errors.slice(0, 10) } }];
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}"""


META_DASHBOARD_JS = r"""const rawHttp = this.helpers.httpRequest;

const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawHttp(opts); }
    catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const GRAPH    = 'https://graph.facebook.com/v23.0';
const IG_TOKEN = $env.META_IG_TOKEN;
const IG_USER  = $env.META_IG_USER_ID;
const BRAND_TZ = 'Asia/Riyadh';

// n8n's Code node sandbox does not expose URLSearchParams — see the same
// fix's comment in the Publish workflow's graph().
function qsEncode(obj){
  return Object.entries(obj).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
async function graph(pathOrUrl, params = {}){
  const url = /^https?:\/\//.test(pathOrUrl)
    ? pathOrUrl + (pathOrUrl.includes('access_token') ? '' : `&access_token=${encodeURIComponent(IG_TOKEN)}`)
    : `${GRAPH}/${pathOrUrl}?${qsEncode({ ...params, access_token: IG_TOKEN })}`;
  const res = await http({ method:'GET', url, returnFullResponse:true, ignoreHttpStatusErrors:true, json:true });
  const b = res.body && typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  if (b && b.error){
    const e = b.error;
    throw new Error(`Instagram ${e.code || res.statusCode}: ${e.error_user_msg || e.message || JSON.stringify(e).slice(0,300)}`);
  }
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(`Instagram HTTP ${res.statusCode}`);
  return b;
}

// Each section is computed independently and a failure is CONTAINED to its
// own key, mirroring the Zernio dashboard's contract — the Analytics page
// already reads `_error` per section and renders the rest of the page around
// a hole. One rate-limited call must not blank nine charts.
async function safe(fn){
  try { return await fn(); }
  catch (e) { return { _error: (e && e.message) ? e.message : String(e) }; }
}

// ── Brand-time calendar helpers ─────────────────────────────────────────
// Every bucket a human reads — which day a post landed on, which hour slot
// performs best — has to be computed in the BRAND's zone, not the server's.
// n8n runs in UTC, so "Sunday 9pm Riyadh" is Sunday 6pm UTC, and bucketing
// on UTC would shift a third of the week's posts into the wrong day cell.
function brandParts(iso){
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: BRAND_TZ, hourCycle:'h23', weekday:'short',
    year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit',
  }).formatToParts(new Date(iso))) p[type] = value;
  // 0 = Monday, matching BestTimeHeatmap's DAY_LABELS and the day_of_week
  // convention the Zernio slots used.
  const dow = { Mon:0, Tue:1, Wed:2, Thu:3, Fri:4, Sat:5, Sun:6 }[p.weekday];
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), dow };
}

function isoWeek(dateStr){
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

const ZERO = { impressions:0, reach:0, likes:0, comments:0, shares:0, saves:0, clicks:0, views:0 };
const interactionsOf = a => (a.likes||0) + (a.comments||0) + (a.shares||0) + (a.saves||0);
function rateOf(a){
  const denom = a.reach || a.impressions || 0;
  return denom ? (interactionsOf(a) / denom) * 100 : 0;
}

const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || {};
const days = Math.max(1, Math.min(365, Number(body.days) || 30));
const workspaceId = body.workspace_id || '';

const toDate   = new Date();
const fromDate = new Date(toDate.getTime() - (days - 1) * 86400000);
const fromISO  = fromDate.toISOString().slice(0, 10);
const toISO    = toDate.toISOString().slice(0, 10);

try {
  if (!IG_TOKEN) throw new Error('META_IG_TOKEN is not set on this n8n instance.');
  if (!IG_USER)  throw new Error('META_IG_USER_ID is not set on this n8n instance.');

  // ══ Media in range, with insights inline ═════════════════════════════
  // `insights.metric(...)` is field EXPANSION, not a second endpoint: it
  // returns each media's metrics inside the media node, so a 30-day window
  // costs one request per page of 50 rather than one per post. The metric
  // list is the intersection that every media_product_type answers — a page
  // mixes Reels and feed posts, and Meta rejects the whole page if one
  // requested metric is invalid for any single item in it.
  const FIELDS = 'id,timestamp,permalink,media_type,media_product_type,'
    + 'thumbnail_url,media_url,caption,like_count,comments_count,'
    + 'insights.metric(reach,likes,comments,saved,shares,views)';

  const media = [];
  let url = `${GRAPH}/${IG_USER}/media?fields=${encodeURIComponent(FIELDS)}&limit=50&access_token=${encodeURIComponent(IG_TOKEN)}`;
  let guard = 0;
  while (url && guard++ < 10){
    const page = await graph(url);
    let ranOut = false;
    for (const m of ((page && page.data) || [])){
      const ts = m.timestamp || '';
      // /media comes back newest-first, so the first item older than the
      // window means every remaining item is too — stop paging rather than
      // walking the account's whole history every dashboard load.
      if (ts && ts.slice(0, 10) < fromISO){ ranOut = true; break; }
      media.push(m);
    }
    if (ranOut || media.length >= 300) break;
    url = (page && page.paging && page.paging.next) || '';
  }

  const posts = media.map(m => {
    const a = { ...ZERO };
    const present = [];
    for (const row of ((m.insights && m.insights.data) || [])){
      const v = (row.values && row.values[0] && row.values[0].value) || 0;
      const col = { reach:'reach', likes:'likes', comments:'comments', saved:'saves', shares:'shares', views:'views' }[row.name];
      if (col){ a[col] = v; present.push(col); }
    }
    // The media node's own counters are populated even when insights are
    // still warming up on a fresh post — prefer a real number to a zero.
    if (typeof m.like_count === 'number' && !present.includes('likes')) a.likes = m.like_count;
    if (typeof m.comments_count === 'number' && !present.includes('comments')) a.comments = m.comments_count;
    return {
      id: m.id,
      platform: 'instagram',
      publishedAt: m.timestamp || '',
      permalink: m.permalink || '',
      platformPostUrl: m.permalink || '',
      // thumbnail_url exists only for video; a still's own media_url is the
      // thumbnail. Verified live — the image rows come back with no
      // thumbnail_url at all rather than with an empty one.
      thumbnailUrl: m.thumbnail_url || m.media_url || '',
      mediaType: m.media_type || '',
      productType: m.media_product_type || '',
      caption: (m.caption || '').slice(0, 300),
      analytics: { ...a, engagementRate: rateOf(a) },
    };
  });

  const totals = posts.reduce((acc, p) => {
    for (const k of Object.keys(ZERO)) acc[k] += p.analytics[k] || 0;
    return acc;
  }, { ...ZERO });

  // ══ Sections ═════════════════════════════════════════════════════════

  const overview = await safe(async () => {
    const profile = await graph(IG_USER, {
      fields: 'id,username,name,profile_picture_url,followers_count,follows_count,media_count',
    });
    return {
      posts,
      overview: { totalPosts: posts.length, lastSync: new Date().toISOString(), totals },
      accounts: [{
        _id: IG_USER, platform: 'instagram',
        username: profile.username || '', displayName: profile.name || '',
        profilePicture: profile.profile_picture_url || '',
        profileUrl: profile.username ? `https://www.instagram.com/${profile.username}/` : '',
        followersCount: profile.followers_count || 0,
        isActive: true, needsReconnection: false,
      }],
      hasAnalyticsAccess: true,
    };
  });

  // Daily rollups come from OUR account_analytics table, not from Meta.
  // Instagram's /insights answers "how many in this window", not "how many
  // each day within it" — there is no per-day breakdown to ask for. The
  // series exists only because the sync workflow snapshots it daily, which
  // also means it starts the day the sync does and cannot be backfilled.
  const daily = await safe(async () => {
    if (!workspaceId) return { dailyData: [], platformBreakdown: [{ platform:'instagram', ...totals }] };
    const rows = await http({ method:'GET',
      url:`${SUPA_URL}/rest/v1/account_analytics?workspace_id=eq.${workspaceId}&account_id=eq.${IG_USER}`
          + `&metric_date=gte.${fromISO}&metric_date=lte.${toISO}&order=metric_date.asc`,
      headers:sHeaders, json:true });
    return {
      dailyData: (rows || []).map(r => ({
        date: r.metric_date,
        metrics: { impressions:0, reach:r.reach||0, likes:r.likes||0, comments:r.comments||0,
                   shares:r.shares||0, saves:r.saves||0, clicks:r.clicks||0, views:r.views||0 },
      })),
      platformBreakdown: [{ platform:'instagram', ...totals }],
    };
  });

  // Best time to post: bucket published media into (brand weekday, brand
  // hour) and average their engagement rate. Zernio computed this over the
  // whole account history server-side; here it is derived from the same
  // window the rest of the page shows, which is a narrower claim but an
  // honest one.
  const bestTime = await safe(async () => {
    const grid = new Map();
    for (const p of posts){
      if (!p.publishedAt) continue;
      const { dow, hour } = brandParts(p.publishedAt);
      if (dow === undefined) continue;
      const key = `${dow}-${hour}`;
      const cur = grid.get(key) || { day_of_week: dow, hour, sum: 0, n: 0 };
      cur.sum += p.analytics.engagementRate || 0;
      cur.n += 1;
      grid.set(key, cur);
    }
    return { slots: [...grid.values()].map(s => ({
      day_of_week: s.day_of_week, hour: s.hour,
      avg_engagement: s.n ? s.sum / s.n : 0, posts: s.n,
    })) };
  });

  // Posting frequency vs engagement: group the window into brand-time weeks,
  // count posts per week, then average engagement across weeks that shared a
  // cadence. With a short window this is a handful of points — which is the
  // honest amount of signal a month of posting contains.
  const frequency = await safe(async () => {
    const weeks = new Map();
    for (const p of posts){
      if (!p.publishedAt) continue;
      const wk = isoWeek(brandParts(p.publishedAt).date);
      const cur = weeks.get(wk) || { n: 0, sum: 0 };
      cur.n += 1; cur.sum += p.analytics.engagementRate || 0;
      weeks.set(wk, cur);
    }
    const byCadence = new Map();
    for (const w of weeks.values()){
      const cur = byCadence.get(w.n) || { posts_per_week: w.n, sum: 0, n: 0 };
      cur.sum += w.sum / w.n; cur.n += 1;
      byCadence.set(w.n, cur);
    }
    return { frequency: [...byCadence.values()]
      .sort((a, b) => a.posts_per_week - b.posts_per_week)
      .map(c => ({ platform:'instagram', posts_per_week: c.posts_per_week,
                   avg_engagement_rate: c.n ? c.sum / c.n : 0 })) };
  });

  // Engagement accumulation, from our own post_analytics snapshots.
  //
  // Buckets are DAYS, not hours. Zernio's version had hour-granularity
  // buckets because it recorded continuously; we snapshot once a day, so an
  // hourly curve would be interpolation dressed up as measurement. Labelling
  // them by day is the same chart telling the truth about its resolution.
  const decay = await safe(async () => {
    if (!workspaceId) return { buckets: [] };
    const rows = await http({ method:'GET',
      url:`${SUPA_URL}/rest/v1/post_analytics?workspace_id=eq.${workspaceId}&publish_provider=eq.meta`
          + `&select=zernio_post_id,metric_date,likes,comments,shares,saves&order=metric_date.asc&limit=2000`,
      headers:sHeaders, json:true });

    const publishedOn = new Map(posts.map(p => [p.id, brandParts(p.publishedAt).date]));
    const series = new Map();
    for (const r of (rows || [])){
      if (!series.has(r.zernio_post_id)) series.set(r.zernio_post_id, []);
      series.get(r.zernio_post_id).push(r);
    }

    const EDGES = [
      { order:0, label:'Day 0',  max:0 },
      { order:1, label:'Day 1',  max:1 },
      { order:2, label:'Day 2',  max:2 },
      { order:3, label:'Day 3',  max:3 },
      { order:4, label:'Week 1', max:7 },
      { order:5, label:'Week 2', max:14 },
      { order:6, label:'Month 1',max:30 },
    ];
    const acc = new Map(EDGES.map(e => [e.order, { ...e, sum:0, n:0 }]));

    for (const [mediaId, list] of series){
      const start = publishedOn.get(mediaId);
      if (!start || list.length < 2) continue;   // one point is not a curve
      const final = interactionsOf(list[list.length - 1]);
      if (!final) continue;                       // nothing accumulated; a 0/0 curve is noise
      const startMs = Date.parse(`${start}T00:00:00Z`);
      // Best value seen by the end of each bucket, so a bucket with no
      // snapshot inherits the last one rather than reading as a dip.
      for (const e of EDGES){
        let best = null;
        for (const r of list){
          const age = Math.round((Date.parse(`${r.metric_date}T00:00:00Z`) - startMs) / 86400000);
          if (age <= e.max) best = r;
        }
        if (!best) continue;
        const cur = acc.get(e.order);
        cur.sum += (interactionsOf(best) / final) * 100;
        cur.n += 1;
      }
    }
    return { buckets: [...acc.values()].filter(b => b.n > 0)
      .map(b => ({ bucket_order: b.order, bucket_label: b.label,
                   avg_pct_of_final: b.n ? b.sum / b.n : 0, posts: b.n })) };
  });

  const followers = await safe(async () => {
    if (!workspaceId) return { stats: {} };
    const rows = await http({ method:'GET',
      url:`${SUPA_URL}/rest/v1/account_analytics?workspace_id=eq.${workspaceId}&account_id=eq.${IG_USER}`
          + `&select=metric_date,followers_count&metric_date=gte.${fromISO}&order=metric_date.asc`,
      headers:sHeaders, json:true });
    return { stats: { [IG_USER]: (rows || []).map(r => ({ date: r.metric_date, followers: r.followers_count || 0 })) } };
  });

  return [{ json: {
    ok: true, provider: 'meta',
    fromDate: fromISO, toDate: toISO,
    // Which metric toggles are worth showing. Instagram reports neither
    // impressions (removed in v22, superseded by views) nor any per-media
    // click metric, so those two switches can only ever read 0 — and a
    // permanent zero on a dashboard reads as a broken integration rather
    // than as an absent measurement.
    metricsSupported: ['reach','likes','comments','shares','saves','views'],
    overview, daily, bestTime, frequency, decay, followers,
  } }];
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}"""


def build_meta_publish() -> dict:
    """
    TWO entry points into ONE Code node:
      Every 5 Minutes (schedule sweep) ─┐
      Webhook (arak-meta-publish) ──────┴─> Meta: Publish

    One workflow rather than a scheduled copy and a manual copy, for the same
    reason Zernio Sync is one workflow: two copies of publishing logic drift,
    and publishing is the last place you want silent drift. The Code node
    tolerates both input shapes via `raw.body` — a webhook call has one, the
    cron does not, and that absence is what selects the sweep branch.

    The cron exists because the Instagram Graph API has no scheduling at all.
    See the sticky note.
    """
    nodes = [
        _sticky(META_PUBLISH_STICKY, height=760, width=520, x=0, y=-560),
        {
            "parameters": {"rule": {"interval": [{"field": "minutes", "minutesInterval": 5}]}},
            "id": nid(),
            "name": "Every 5 Minutes",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.2,
            "position": [0, 140],
        },
        _webhook("arak-meta-publish", "lastNode", x=0, y=320),
        _code("Meta: Publish", META_PUBLISH_JS, x=260, y=230),
    ]
    connections = {
        "Every 5 Minutes": {"main": [[{"node": "Meta: Publish", "type": "main", "index": 0}]]},
        "Webhook": {"main": [[{"node": "Meta: Publish", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Publish Post (Meta)",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_meta_sync() -> dict:
    """
    Daily 06:00 ─┐
    Webhook ─────┴─> Meta: Sync Insights

    Same two-trigger shape as Zernio Sync, and the daily leg is load-bearing
    rather than a convenience: Instagram reports lifetime totals only, so the
    per-day series every time-shaped chart reads exists solely because this
    snapshots it. A day missed here is a day that cannot be recovered.
    """
    nodes = [
        _sticky(META_SYNC_STICKY, height=620, width=520, x=0, y=-440),
        {
            "parameters": {"rule": {"interval": [{"triggerAtHour": 6}]}},
            "id": nid(),
            "name": "Daily 06:00",
            "type": "n8n-nodes-base.scheduleTrigger",
            "typeVersion": 1.2,
            "position": [0, 140],
        },
        _webhook("arak-meta-sync", "lastNode", x=0, y=320),
        _code("Meta: Sync Insights", META_SYNC_JS, x=260, y=230),
    ]
    connections = {
        "Daily 06:00": {"main": [[{"node": "Meta: Sync Insights", "type": "main", "index": 0}]]},
        "Webhook": {"main": [[{"node": "Meta: Sync Insights", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Meta Insights Sync",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_meta_dashboard() -> dict:
    """
    Webhook (responseMode=lastNode) -> Meta: Dashboard. Synchronous, same as
    its Zernio predecessor — the Analytics page is waiting on this to render,
    not firing it and moving on.
    """
    nodes = [
        _sticky(META_DASHBOARD_STICKY, height=560, width=520, x=0, y=-400),
        _webhook("arak-meta-dashboard", "lastNode", x=0, y=220),
        _code("Meta: Dashboard", META_DASHBOARD_JS, x=260, y=220),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Meta: Dashboard", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Meta Dashboard",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }

RESEARCH_RESOLVE_STICKY = """## Research: Resolve Handles

**Zero secrets in this file.** Needs `META_IG_TOKEN`, `META_IG_USER_ID`, `TAVILY_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Seeds `research_agenda` from the competitors the caller sends, then finds and **verifies** each one's Instagram handle.

Webhook path: `/arak-research-resolve`. Body: `{ workspace_id, competitors[{name, positioning, website, source_row_id}], force? }`.

**Why this exists at all.** Checked against the live database 2026-08-20: across all three workspaces there are twelve competitor rows and **zero Instagram handles**. Two rows carry a `watch_url` and both are company websites. So the "parse a handle out of the directory" plan resolves nothing, and the whole Instagram side of the research agent is inert until something goes and finds them.

**Verification is the point, not search.** Finding *an* account called something like the rival is easy. `Ozee` and `Ozeyl` are two different companies in one workspace, and a confident week of numbers attached to the wrong one is the kind of wrong that does not look wrong. So a candidate is scored against the rival's own website domain, name and bio, and only a score at or above the threshold is marked `resolved`.

**Below the threshold it stops.** A weak candidate is stored as a *suggestion* with `ig_status = 'unresolved'` for a human to accept or replace. Nothing downstream may read `ig_handle` alone — the snapshot step filters on `ig_status in ('resolved','human_set')`, which is what keeps a guess out of the numbers.

**`human_set` is never overwritten.** A handle a person typed outranks anything this finds, on every later run.

**Writes nothing to the Brand Brain.** Agenda rows only. A resolved handle is research metadata — discovered, scored, timestamped — not a statement the company makes about itself. See RESEARCH-AGENT.md §5a."""


RESEARCH_RESOLVE_SEED_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Retry a lookup that never left the machine — see Creative Generate for the
// full argument. Only name resolution is retried: a DNS failure proves the
// request never reached the provider, so re-sending cannot double anything.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawHttp(opts); }
    catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 300))
            : (typeof b === 'string' && b) ? b.slice(0, 300)
            : `HTTP ${status}`;
  throw new Error(`${opts.__label || 'Request'} ${status}: ${msg}`);
}

const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || raw;
const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const wsId = String(body.workspace_id || '').trim();
if (!wsId) throw new Error('workspace_id is required.');
const force = body.force === true;

// The caller sends the competitor list, assembled in the browser through the
// same buildContext/directory read every other call uses. Assembling it here
// would mean a second copy of the flattening logic, which is the drift
// brandContext.js exists to prevent.
const sent = (Array.isArray(body.competitors) ? body.competitors : [])
  .map(c => ({
    name: String((c && c.name) || '').trim(),
    positioning: String((c && c.positioning) || '').trim(),
    website: String((c && c.website) || '').trim(),
    source_row_id: (c && c.source_row_id) || null,
  }))
  .filter(c => c.name);

// Same workspace filter as everywhere else: this runs on the service key, so
// the filter IS the isolation.
const existing = await req({
  __label: 'Supabase', method: 'GET',
  url: `${SUPA_URL}/rest/v1/research_agenda?workspace_id=eq.${wsId}&kind=eq.competitor`
     + `&select=id,subject,status,ig_handle,ig_status,ig_confidence,source_row_id&limit=500`,
  headers: sHeaders, json: true,
});

const key = s => String(s || '').trim().toLowerCase();
const byName = new Map(existing.map(r => [key(r.subject), r]));

// Seed the ones we have never seen. A competitor that came from the Brand
// Brain is 'active' immediately — a human already decided it matters by
// typing it there. Only an agent-discovered rival arrives as 'proposed'.
const seeded = [];
for (const c of sent) {
  if (byName.has(key(c.name))) continue;
  const row = {
    workspace_id: wsId, kind: 'competitor', subject: c.name,
    why: c.positioning || '', status: 'active',
    created_by: 'human', source_row_id: c.source_row_id || null,
  };
  const ins = await req({
    __label: 'Supabase', method: 'POST',
    url: `${SUPA_URL}/rest/v1/research_agenda`,
    headers: { ...sHeaders, Prefer: 'return=representation' },
    body: row, json: true,
  });
  const created = Array.isArray(ins) ? ins[0] : ins;
  if (created) { byName.set(key(c.name), created); seeded.push(c.name); }
}

// What still needs a handle. `human_set` is excluded unconditionally — a
// handle a person typed outranks anything this can find, and re-resolving it
// every week would be a slow way to overwrite their correction. `resolved` is
// excluded too unless the caller explicitly asked to re-verify.
const sentByName = new Map(sent.map(c => [key(c.name), c]));
const work = [];
for (const [k, row] of byName) {
  if (row.status === 'retired') continue;
  if (row.ig_status === 'human_set') continue;
  if (row.ig_status === 'resolved' && !force) continue;
  const c = sentByName.get(k) || {};
  work.push({
    agenda_id: row.id,
    name: row.subject,
    positioning: c.positioning || row.why || '',
    website: c.website || '',
  });
}

if (!work.length) {
  return [{ json: { ok: true, proceed: false, skipped: true, workspace_id: wsId,
    seeded: seeded.length, resolved: 0,
    reason: existing.length || sent.length
      ? 'Every competitor already has a handle, or was set by hand. Nothing to resolve.'
      : 'This brand has no competitors listed yet, so there is nothing to look up. Add some in Brand Brain first.' } }];
}

if (!$env.TAVILY_API_KEY) {
  return [{ json: { ok: true, proceed: false, skipped: true, workspace_id: wsId, seeded: seeded.length, resolved: 0,
    reason: 'TAVILY_API_KEY is not set on this n8n instance, so the handle search cannot run.' } }];
}
if (!$env.META_IG_TOKEN || !$env.META_IG_USER_ID) {
  return [{ json: { ok: true, proceed: false, skipped: true, workspace_id: wsId, seeded: seeded.length, resolved: 0,
    reason: 'META_IG_TOKEN / META_IG_USER_ID are not set, so a candidate handle cannot be verified. Refusing to guess.' } }];
}

// Bounded. Twelve rivals across three brands today; the cap is here so a
// directory that grows to eighty cannot turn one button into eighty searches
// plus eighty Graph calls without anyone deciding that.
const MAX_PER_RUN = 12;
return [{ json: { ok: true, proceed: true, workspace_id: wsId, seeded: seeded.length,
                  work: work.slice(0, MAX_PER_RUN), deferred: Math.max(0, work.length - MAX_PER_RUN) } }];
"""


RESEARCH_RESOLVE_FIND_JS = r"""
const rawHttp = this.helpers.httpRequest;

const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawHttp(opts); }
    catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 300))
            : (typeof b === 'string' && b) ? b.slice(0, 300)
            : `HTTP ${status}`;
  throw new Error(`${opts.__label || 'Request'} ${status}: ${msg}`);
}

const inp = ($input.first() && $input.first().json) || {};
const wsId = inp.workspace_id;
const work = Array.isArray(inp.work) ? inp.work : [];

const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

// Pinned to v23.0, the same version the publish and sync workflows use. A
// research call drifting to a different version than the publishing path is
// how you end up debugging two different Graph behaviours at once.
const GRAPH    = 'https://graph.facebook.com/v23.0';
const IG_TOKEN = $env.META_IG_TOKEN;
const IG_USER  = $env.META_IG_USER_ID;
const TAVILY   = $env.TAVILY_API_KEY;

// ─── Matching ────────────────────────────────────────────────────────────
// Everything below is deliberately arithmetic rather than a model call. The
// question "is this the right account" has to be answerable the same way
// twice, and has to be auditable when it is wrong.

const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

// Regex, not `new URL()` — n8n's Code node sandbox does not expose
// URLSearchParams (confirmed live 2026-08-20, see the Meta workflows' fix),
// and URL is the same family of global. This function is a silent-failure
// risk if it guesses wrong: it was wrapped in try/catch, so an unavailable
// URL constructor would not crash — it would just make every domain
// comparison return '' and quietly defeat the verification this whole
// workflow exists for. Matches www-stripped lowercase hostname for the
// http(s) URLs this only ever receives (a website field or a Tavily result).
const domainOf = (url) => {
  const u = String(url || '').trim();
  if (!u) return '';
  const m = (/^https?:\/\//i.test(u) ? u : `https://${u}`).match(/^https?:\/\/([^\/\s:?#]+)/i);
  return m ? m[1].replace(/^www\./i, '').toLowerCase() : '';
};

// Words that carry no identifying weight in this market. "Lighting" is in
// half the rival names in the Arak workspace, so a bio containing it is not
// evidence of anything.
const STOP = new Set(['the','and','for','co','ltd','llc','inc','group','company','est',
                      'trading','est','al','lighting','lights','light','design','studio','app','store']);
const tokensOf = name => String(name || '').toLowerCase().split(/[^a-z0-9]+/i)
  .filter(t => t.length >= 3 && !STOP.has(t));

// A candidate must clear this to be trusted with a week of numbers. Below it
// the handle is kept only as a suggestion for a human — see the sticky note.
const RESOLVE_AT = 0.7;
const SUGGEST_AT = 0.3;

function scoreCandidate(comp, acct) {
  const reasons = [];
  let score = 0;

  const cName = norm(comp.name);
  const aUser = norm(acct.username);
  const aName = norm(acct.name);
  const cDom  = domainOf(comp.website);
  const aDom  = domainOf(acct.website);

  // The strongest signal there is, and conclusive on its own: an account
  // whose bio links to the rival's own domain is the rival's account.
  if (cDom && aDom && cDom === aDom) { score += 0.7; reasons.push(`bio links to ${aDom}`); }

  if (cName && (cName === aUser || cName === aName)) { score += 0.5; reasons.push('name matches exactly'); }
  else if (cName && aUser && (aUser.includes(cName) || cName.includes(aUser))) { score += 0.25; reasons.push('handle contains the name'); }
  else if (cName && aName && aName.includes(cName)) { score += 0.25; reasons.push('display name contains the name'); }

  const toks = tokensOf(comp.name);
  if (toks.length) {
    const hay = `${acct.username} ${acct.name} ${acct.biography}`.toLowerCase();
    const hits = toks.filter(t => hay.includes(t));
    if (hits.length) { score += 0.25 * (hits.length / toks.length); reasons.push(`mentions ${hits.join(', ')}`); }
  }

  // Size as a tie-breaker, not as evidence. A real brand's account is rarely
  // tiny; a squatter's usually is.
  const followers = Number(acct.followers_count || 0);
  if (followers >= 1000) { score += 0.1; reasons.push(`${followers} followers`); }
  else if (followers < 100) { score -= 0.3; reasons.push(`only ${followers} followers — probably not the real account`); }

  return { score: Math.max(0, Math.min(1, Math.round(score * 100) / 100)), reasons };
}

// ─── Candidate discovery ─────────────────────────────────────────────────

function handlesFromSearch(results) {
  const out = [];
  for (const r of results) {
    const hay = `${r.url || ''} ${r.content || ''}`;
    const re = /instagram\.com\/([A-Za-z0-9._]{2,30})/g;
    let m;
    while ((m = re.exec(hay))) {
      const h = m[1].toLowerCase();
      // Instagram's own section paths, not accounts.
      if (['p','reel','reels','explore','stories','tv','accounts','about','directory','tags'].includes(h)) continue;
      if (!out.includes(h)) out.push(h);
    }
  }
  return out;
}

async function lookup(handle) {
  const fields = `business_discovery.username(${handle})`
    + `{id,username,name,biography,website,followers_count,follows_count,media_count}`;
  const url = `${GRAPH}/${IG_USER}?fields=${encodeURIComponent(fields)}`
            + `&access_token=${encodeURIComponent(IG_TOKEN)}`;
  const res = await http({ method: 'GET', url, returnFullResponse: true, ignoreHttpStatusErrors: true, json: true });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    // A handle that does not exist, is personal, or is private answers with
    // an error here. That is a rejected candidate, never a failed run — most
    // guesses SHOULD come back like this.
    const b = res.body || {};
    const err = (b.error && (b.error.message || b.error.type)) || `HTTP ${res.statusCode}`;
    return { ok: false, error: String(err).slice(0, 200) };
  }
  const bd = res.body && res.body.business_discovery;
  if (!bd || !bd.username) return { ok: false, error: 'no business_discovery payload' };
  return { ok: true, acct: bd };
}

// ─── The pass ────────────────────────────────────────────────────────────
// Sequential rather than parallel: a dozen rivals is not worth a concurrency
// bug, and a rate-limited Graph answering 429 to half of them would silently
// narrow the result without saying so.

const outcomes = [];
let resolved = 0, suggested = 0, notFound = 0;

for (const item of work) {
  const record = { name: item.name, agenda_id: item.agenda_id };
  try {
    const query = [item.name, item.positioning, 'Saudi Arabia instagram'].filter(Boolean).join(' ');
    let results = [];
    try {
      const r = await req({
        __label: 'Tavily', method: 'POST', url: 'https://api.tavily.com/search',
        body: { api_key: TAVILY, query, max_results: 6, search_depth: 'basic', topic: 'general' },
        json: true,
      });
      results = (r && r.results) || [];
    } catch (e) { record.search_error = String(e.message || e).slice(0, 160); }

    const candidates = handlesFromSearch(results).slice(0, 4);
    record.candidates = candidates;

    let best = null;
    for (const h of candidates) {
      const got = await lookup(h);
      if (!got.ok) continue;
      const { score, reasons } = scoreCandidate(item, got.acct);
      if (!best || score > best.score) best = { handle: got.acct.username || h, id: got.acct.id, score, reasons };
      // A domain-backed match cannot be beaten; stop paying for more lookups.
      if (score >= 0.95) break;
    }

    let patch;
    if (best && best.score >= RESOLVE_AT) {
      patch = { ig_handle: best.handle, ig_user_id: best.id || '', ig_confidence: best.score,
                ig_status: 'resolved', ig_verified_at: new Date().toISOString() };
      resolved += 1;
      record.result = 'resolved'; record.handle = best.handle;
      record.confidence = best.score; record.why = best.reasons;
    } else if (best && best.score >= SUGGEST_AT) {
      // Stored, but NOT verified. Downstream reads ig_status, never
      // ig_handle on its own — that separation is what keeps a guess out of
      // the snapshots while still giving a human something to accept.
      patch = { ig_handle: best.handle, ig_user_id: '', ig_confidence: best.score,
                ig_status: 'unresolved', ig_verified_at: null };
      suggested += 1;
      record.result = 'suggested'; record.handle = best.handle;
      record.confidence = best.score; record.why = best.reasons;
    } else {
      patch = { ig_handle: '', ig_user_id: '', ig_confidence: best ? best.score : null,
                ig_status: 'not_found', ig_verified_at: null };
      notFound += 1;
      record.result = 'not_found';
      if (best) { record.confidence = best.score; record.why = best.reasons; }
    }

    await req({
      __label: 'Supabase', method: 'PATCH',
      url: `${SUPA_URL}/rest/v1/research_agenda?id=eq.${item.agenda_id}&workspace_id=eq.${wsId}`,
      headers: sHeaders, body: patch, json: true,
    });
  } catch (e) {
    // One rival's failure must not cost the other eleven their results.
    record.result = 'error';
    record.error = String((e && e.message) || e).slice(0, 200);
  }
  outcomes.push(record);
}

return [{ json: {
  ok: true, skipped: false, workspace_id: wsId,
  seeded: inp.seeded || 0, deferred: inp.deferred || 0,
  resolved, suggested, not_found: notFound,
  outcomes,
} }];
"""


def build_research_resolve() -> dict:
    """
    Webhook -> Resolve: Seed Agenda (Code) -> Anything to resolve? (IF)
            -> Resolve: Find Handles (Code) -> Respond
                                            \\-> Respond: Skipped

    Two Code nodes rather than one, and connected in sequence rather than
    through `$('...')`, so each is independently runnable under
    workflowHarness.js — the harness supplies $input and $env but not the node
    graph, so a node that reaches sideways for another node's output is a node
    that cannot be tested.

    No model call anywhere in this graph. Matching a rival to an account is
    arithmetic over a website domain, a name and a bio; asking a model to do
    it would make the same question answerable two different ways on two runs
    and unauditable when it is wrong.
    """
    nodes = [
        _sticky(RESEARCH_RESOLVE_STICKY, height=560, width=520, x=0, y=-380),
        _webhook("arak-research-resolve", "responseNode", x=0, y=200),
        _code("Resolve: Seed Agenda", RESEARCH_RESOLVE_SEED_JS, x=220, y=200),
        _if_bool_equals("Anything to resolve?", "resolve-proceed", "={{ $json.proceed }}", x=440, y=200),
        _code("Resolve: Find Handles", RESEARCH_RESOLVE_FIND_JS, x=660, y=120),
        _respond_json("Respond", "={{ JSON.stringify($json) }}", x=880, y=120),
        _respond_json("Respond: Skipped", "={{ JSON.stringify($json) }}", x=660, y=300),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Resolve: Seed Agenda", "type": "main", "index": 0}]]},
        "Resolve: Seed Agenda": {"main": [[{"node": "Anything to resolve?", "type": "main", "index": 0}]]},
        "Anything to resolve?": {"main": [
            [{"node": "Resolve: Find Handles", "type": "main", "index": 0}],
            [{"node": "Respond: Skipped", "type": "main", "index": 0}],
        ]},
        "Resolve: Find Handles": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Research Resolve",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }



ZERNIO_CONNECT_STICKY = r"""## Arak – Zernio Connect

**Zero secrets in this file.** Needs `ZERNIO_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Per-workspace OAuth. This is what lets a workspace connect its OWN Instagram/TikTok through a normal OAuth redirect, instead of someone adding every account by hand on zernio.com under one shared team.

**How the tenancy works.** Zernio puts a `profile` between the API team and the connected accounts — one profile per customer. This workflow creates one per workspace on first use and stores the id in `workspaces.zernio_profile_id`; from then on every `/connect` and `/accounts` call is scoped by `profileId`, so a workspace can only ever see and post as its own accounts. The Zernio key never leaves n8n, exactly like every other provider here.

**Actions** (one webhook, dispatched on `action`):

| action | does |
|---|---|
| `accounts` | list this workspace's connected accounts, mirror into `social_accounts` |
| `connect_url` | start OAuth — returns `authUrl` for the browser to visit |
| `selection_options` | headless step 2: list the pages/profiles a just-authorised user can pick |
| `selection_complete` | headless step 3: commit the pick, finishing the connection |
| `disconnect` | drop the account at Zernio and locally |

**Why `selection_*` exist.** Instagram and Snapchat need a SECOND choice after OAuth (which page / which public profile). Zernio will host that picker itself, but then the user hops to a Zernio-branded screen mid-flow. Passing `headless=true` hands us a `tempToken` and lets the picker live in our own UI instead.

**Snapchat is deliberately not reachable here** — `LIVE_PLATFORMS` in src/lib/utils.js gates it out in the browser and the guard below refuses it server-side, so a hand-made request cannot start a flow the app has no screen to finish."""

ZERNIO_CONNECT_JS = r"""
const rawHttp = this.helpers.httpRequest;

// Same DNS-blip retry as the publish workflow: Docker's embedded resolver
// (127.0.0.11) drops a lookup occasionally, and a name that never resolved
// proves the request never reached Zernio — so re-sending cannot double
// anything. Connection resets and timeouts still fail once, loudly.
const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rawHttp(opts);
    } catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

// n8n's thrown-error shape for non-2xx varies by version, which is how you
// end up staring at "Request failed with status code 409" with no idea which
// of the six calls below produced it. Read the parsed body ourselves instead,
// and keep the status — the 409 path genuinely needs to inspect it.
async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  const status = res.statusCode;
  if (status >= 200 && status < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 400))
            : (typeof b === 'string' && b) ? b.slice(0, 400)
            : `HTTP ${status}`;
  const err = new Error(`Zernio ${status}: ${msg}`);
  err.status = status;
  err.body = b;
  throw err;
}

const body = ($input.first().json.body) || {};
const ZERNIO   = $env.ZERNIO_API_KEY;
const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const ZBASE    = 'https://zernio.com/api/v1';
const zHeaders = { Authorization: `Bearer ${ZERNIO}`, 'Content-Type': 'application/json' };
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

// n8n's Code node sandbox does not expose URLSearchParams — confirmed live
// 2026-08-20 against arak-meta-dashboard, where every graph() call failed with
// "URLSearchParams is not defined". Same fix as the Meta workflows'.
//
// This one is worth spelling out because the failure would have been total and
// silent-looking: `connect_url` and `audio_search` are the only two actions
// that build a query string, and they are the entire OAuth entry point. A
// ReferenceError here means the connect button throws for every platform, and
// the catch below turns it into a generic ok:false — so it would have read as
// "Zernio is broken" rather than "this global does not exist".
//
// Every value passed through here is a primitive (ids, a redirect URL, a
// search term), so none of URLSearchParams' array/nested-object handling is
// needed.
function qsEncode(obj){
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

const action      = String(body.action || '').trim();
const workspaceId = String(body.workspace_id || '').trim();
const platform    = String(body.platform || '').trim().toLowerCase();

// Mirrors LIVE_PLATFORMS in src/lib/utils.js. Snapchat is in the app's
// platform list as status:'beta' — visible, labelled, not connectable — and
// this is the server-side half of that: the UI hides the button, this refuses
// the call, so a hand-made request cannot open a flow with no screen to
// finish it. Add a platform here only when the app can complete its OAuth.
const CONNECTABLE = ['instagram', 'tiktok'];

// Platforms whose OAuth is followed by a SECOND choice (which Facebook page
// backs this Instagram account). Zernio's docs list six such platforms; these
// are the ones we actually offer. Everything else finishes at the callback.
const NEEDS_SELECTION = ['instagram'];

// Which Instagram connection to request. Named rather than inlined because
// three places depend on agreeing about it: the connect URL, the row we
// mirror into social_accounts, and the composer deciding whether to offer the
// audio picker at all.
const LOGIN_METHOD_IG = 'facebook_login';

// ── Get-or-create this workspace's Zernio profile ───────────────────────
//
// Idempotent and race-safe WITHOUT a read-then-create, which two tabs would
// both pass before either wrote. Two things make that work:
//
//   1. The profile name is DERIVED from the workspace id, not chosen. Zernio
//      enforces name uniqueness per team, so a second create for the same
//      workspace is refused by Zernio rather than silently making a twin.
//   2. That refusal is a 409 carrying `details.existingProfileId` — the id we
//      would have got had we won. So the loser of a race gets the same answer
//      as the winner and nobody is left holding an orphan profile.
//
// The Supabase write is then last-writer-wins over an identical value, which
// is harmless. Compare claimPost() in the publish workflow: that one needs a
// real atomic claim because its outcomes DIFFER per caller; here they cannot.
async function ensureProfile(){
  if (!workspaceId) throw new Error('workspace_id is required.');

  const rows = await http({ method:'GET',
    url:`${SUPA_URL}/rest/v1/workspaces?id=eq.${workspaceId}&select=id,name,zernio_profile_id`,
    headers:sHeaders, json:true });
  const ws = (Array.isArray(rows) && rows[0]) || null;
  if (!ws) throw new Error(`No such workspace: ${workspaceId}`);
  if (ws.zernio_profile_id) return ws.zernio_profile_id;

  // Prefixed and full-length on purpose. A bare uuid is indistinguishable
  // from any other id in Zernio's own dashboard, and a truncated one stops
  // being unique across enough workspaces to matter.
  const name = `arak_ws_${workspaceId}`;
  let profileId = '';
  try {
    const created = await req({ method:'POST', url:`${ZBASE}/profiles`, headers:zHeaders,
      body:{ name, description: String(ws.name || 'Arak workspace').slice(0, 200) }, json:true });
    profileId = String((created && created.profile && created.profile._id) || '');
  } catch (e) {
    const existing = e && e.body && e.body.details && e.body.details.existingProfileId;
    if (e && e.status === 409 && existing) profileId = String(existing);
    else throw e;
  }
  if (!profileId) throw new Error('Zernio created a profile but returned no id.');

  await http({ method:'PATCH', url:`${SUPA_URL}/rest/v1/workspaces?id=eq.${workspaceId}`,
    headers:{ ...sHeaders, Prefer:'return=minimal' },
    body:{ zernio_profile_id: profileId }, json:true });

  return profileId;
}

// Mirror Zernio's account list into social_accounts so every screen can list
// connected accounts without the key ever reaching a browser. Upsert on
// (workspace_id, zernio_account_id) — see the migration's unique index.
async function mirrorAccounts(profileId, accounts){
  if (!workspaceId || !accounts.length) return;
  const rows = accounts.map(a => ({
    workspace_id:       workspaceId,
    zernio_account_id:  String(a._id || ''),
    zernio_profile_id:  profileId,
    platform:           String(a.platform || ''),
    username:           String(a.username || a.name || ''),
    display_name:       String(a.displayName || a.name || ''),
    profile_picture:    String(a.profilePicture || a.avatarUrl || ''),
    profile_url:        String(a.profileUrl || ''),
    is_active:          a.isActive !== false,
    needs_reconnection: a.needsReconnection === true,
    followers_count:    Number(a.followersCount || 0) || 0,
    publish_provider:   'zernio',
    // Instagram only, and only what we can actually observe. Zernio reports
    // the method it connected with; absent that, an Instagram row we created
    // is one WE connected, so it carries the method we asked for. Anything
    // else stays null, which the composer reads as "no catalog audio" — the
    // safe direction, since offering audio an account cannot use produces a
    // Reel that fails at publish rather than a missing button.
    ...(String(a.platform || '') === 'instagram'
        ? { login_method: String(a.loginMethod || a.login_method || LOGIN_METHOD_IG) }
        : {}),
    last_synced_at:     new Date().toISOString(),
    updated_at:         new Date().toISOString(),
  })).filter(r => r.zernio_account_id);
  if (!rows.length) return;

  // connected_at is deliberately ABSENT from this payload. It records when
  // OAuth was actually granted, which is what makes "reconnect, this token is
  // 58 days old" answerable — Instagram's long-lived tokens die at 60. This is
  // an upsert with merge-duplicates, so any column named here is overwritten
  // on every merge: including connected_at would reset that clock on every
  // page load and quietly hide every token that was about to expire. Omitting
  // it lets the column's `default now()` fire on INSERT only, which is exactly
  // the semantics wanted — a value that is written once and never again.
  await http({ method:'POST',
    url:`${SUPA_URL}/rest/v1/social_accounts?on_conflict=workspace_id,zernio_account_id`,
    headers:{ ...sHeaders, Prefer:'resolution=merge-duplicates,return=minimal' },
    body: rows,
    json:true });
}

async function listAccounts(profileId){
  const list = await req({ method:'GET',
    url:`${ZBASE}/accounts?profileId=${encodeURIComponent(profileId)}`,
    headers:zHeaders, json:true });
  const accounts = (list && list.accounts) || [];
  // Belt and braces. profileId is a server-side filter and Zernio honours it,
  // but this list decides which accounts a workspace may post as — so it is
  // re-checked here rather than trusted. A filter regression upstream would
  // otherwise become a cross-tenant publish.
  return accounts.filter(a => !a.profileId || String(a.profileId) === String(profileId));
}

try {
  if (!ZERNIO) throw new Error('ZERNIO_API_KEY is not set on this n8n instance.');
  if (!SUPA_URL || !SUPA_KEY) throw new Error('SUPABASE_URL / SUPABASE_KEY are not set on this n8n instance.');

  // ---- list this workspace's connected accounts ----
  if (action === 'accounts'){
    const profileId = await ensureProfile();
    const accounts  = await listAccounts(profileId);
    await mirrorAccounts(profileId, accounts);
    return [{ json: { ok:true, profile_id:profileId, accounts } }];
  }

  // ---- start OAuth ----
  if (action === 'connect_url'){
    if (!CONNECTABLE.includes(platform)){
      throw new Error(`${platform || 'That platform'} cannot be connected yet.`);
    }
    const redirectUrl = String(body.redirect_url || '').trim();
    if (!redirectUrl) throw new Error('redirect_url is required.');

    const profileId = await ensureProfile();
    const headless  = NEEDS_SELECTION.includes(platform);
    const params = { profileId, redirect_url: redirectUrl };
    if (headless) params.headless = 'true';

    // Instagram connects one of two ways and we deliberately ask for the
    // Facebook one. Publishing, analytics, comments and the inbox are
    // identical either way — but catalog audio is NOT: attaching a track to a
    // Reel on an Instagram-Login account fails with
    // `instagram_audio_requires_facebook_login`, and the Meta Ads add-on can
    // ride on this same connection rather than needing a separate Facebook
    // account. Omitting the param would silently give us the default and take
    // both away.
    //
    // This is also what makes the Page-selection step real rather than
    // speculative: Instagram Login connects the account directly with no
    // picker, Facebook Login authorises through the linked Page and needs one.
    if (platform === 'instagram') params.loginMethod = LOGIN_METHOD_IG;

    const res = await req({ method:'GET',
      url:`${ZBASE}/connect/${encodeURIComponent(platform)}?${qsEncode(params)}`,
      headers:zHeaders, json:true });

    const authUrl = String((res && (res.authUrl || res.url)) || '');
    if (!authUrl) throw new Error('Zernio returned no authorisation URL.');
    return [{ json: { ok:true, profile_id:profileId, auth_url:authUrl,
                      state:(res && res.state) || '', headless } }];
  }

  // ---- headless step 2: what can this user pick? ----
  if (action === 'selection_options'){
    const tempToken = String(body.temp_token || '').trim();
    const step      = String(body.step || '').trim();
    if (!tempToken) throw new Error('temp_token is required.');
    if (!CONNECTABLE.includes(platform)) throw new Error(`${platform || 'That platform'} cannot be connected yet.`);

    // `step` comes back from Zernio's own callback and names the endpoint to
    // call. Passed through rather than hardcoded per platform, so a platform
    // that grows a second selection stage does not need this node changed.
    const path = step || `connect/${platform}/pages`;
    const res  = await req({ method:'GET',
      url:`${ZBASE}/${path.replace(/^\/+/, '')}?tempToken=${encodeURIComponent(tempToken)}`,
      headers:zHeaders, json:true });

    const options = (res && (res.pages || res.profiles || res.options || res.accounts)) || [];
    return [{ json: { ok:true, options } }];
  }

  // ---- headless step 3: commit the pick ----
  if (action === 'selection_complete'){
    const tempToken = String(body.temp_token || '').trim();
    const selection = body.selection;
    const step      = String(body.step || '').trim();
    if (!tempToken)  throw new Error('temp_token is required.');
    if (!selection)  throw new Error('selection is required.');
    if (!CONNECTABLE.includes(platform)) throw new Error(`${platform || 'That platform'} cannot be connected yet.`);

    const path = step || `connect/${platform}/pages`;
    const res  = await req({ method:'POST', url:`${ZBASE}/${path.replace(/^\/+/, '')}`,
      headers:zHeaders, body:{ tempToken, ...(typeof selection === 'object' ? selection : { id: selection }) },
      json:true });

    // Re-list rather than trusting the selection response to describe the new
    // account: this is the moment social_accounts must become correct, and one
    // authoritative read is cheaper to reason about than merging two shapes.
    const profileId = await ensureProfile();
    const accounts  = await listAccounts(profileId);
    await mirrorAccounts(profileId, accounts);

    return [{ json: { ok:true, profile_id:profileId, accounts,
                      account:(res && res.account) || null } }];
  }

  // ---- disconnect ----
  if (action === 'disconnect'){
    const accountId = String(body.account_id || '').trim();
    if (!accountId) throw new Error('account_id is required.');
    const profileId = await ensureProfile();

    // Ownership check BEFORE the delete. account_id arrives from a browser,
    // and DELETE /accounts/{id} is scoped to the API TEAM, not to a profile —
    // so without this, a caller who knew another workspace's account id could
    // disconnect it. Confirming the id appears in THIS profile's list is what
    // makes the delete tenant-safe.
    const accounts = await listAccounts(profileId);
    if (!accounts.some(a => String(a._id) === accountId)){
      throw new Error('That account does not belong to this workspace.');
    }

    await req({ method:'DELETE', url:`${ZBASE}/accounts/${encodeURIComponent(accountId)}`,
      headers:zHeaders, json:true });

    // Local row goes only after Zernio confirms. The other order leaves an
    // account live at the provider that the UI swears is gone — and the next
    // list refresh would resurrect the row anyway.
    await http({ method:'DELETE',
      url:`${SUPA_URL}/rest/v1/social_accounts?workspace_id=eq.${workspaceId}&zernio_account_id=eq.${encodeURIComponent(accountId)}`,
      headers:{ ...sHeaders, Prefer:'return=minimal' }, json:true });

    return [{ json: { ok:true, disconnected:accountId } }];
  }

  // ---- TikTok creator info ----
  //
  // Not optional and not cosmetic. TikTok requires `privacy_level` on every
  // post, drawn from the levels THIS creator is allowed to use — a private
  // account cannot post publicly, and sending a level it does not allow fails
  // the post. So the composer has to ask before it can offer the choice.
  //
  // Two paths, tried in order, because Zernio's own docs disagree with
  // themselves: the platform guide documents
  // /accounts/{id}/tiktok/creator-info while the API reference documents
  // /accounts/{id}/tiktok-creator-info. Rather than guess and ship a feature
  // that 404s, try one and fall back. Whichever answers, the shape is the
  // same. Collapse this to one call once it is known which is real.
  if (action === 'creator_info'){
    const accountId = String(body.account_id || '').trim();
    const mediaType = String(body.media_type || 'video').trim();
    if (!accountId) throw new Error('account_id is required.');
    const profileId = await ensureProfile();

    // Same ownership check as disconnect: account_id comes from a browser and
    // this reads another tenant's posting configuration otherwise.
    const accounts = await listAccounts(profileId);
    if (!accounts.some(a => String(a._id) === accountId)){
      throw new Error('That account does not belong to this workspace.');
    }

    const paths = [
      `${ZBASE}/accounts/${encodeURIComponent(accountId)}/tiktok/creator-info?mediaType=${encodeURIComponent(mediaType)}`,
      `${ZBASE}/accounts/${encodeURIComponent(accountId)}/tiktok-creator-info?mediaType=${encodeURIComponent(mediaType)}`,
    ];
    let info = null, lastErr = null;
    for (const url of paths){
      try { info = await req({ method:'GET', url, headers:zHeaders, json:true }); break; }
      catch (e) { lastErr = e; if (e.status !== 404) throw e; }
    }
    if (!info) throw lastErr || new Error('Could not read TikTok creator info.');

    // Zernio has wrapped this differently across versions; take the first
    // shape that is actually an array rather than assuming one.
    const data = info.creatorInfo || info.data || info;
    const levels = data.privacy_level_options || data.privacyLevelOptions
                || data.privacyLevels || [];
    return [{ json: { ok:true,
      privacyLevels: Array.isArray(levels) ? levels : [],
      nickname: data.creator_nickname || data.nickname || '',
      // Surfaced so the composer can warn before TikTok refuses: these are
      // per-day posting caps, not per-post limits.
      maxVideoSeconds: Number(data.max_video_post_duration_sec || 0) || null,
      commentDisabled: data.comment_disabled === true,
      duetDisabled:    data.duet_disabled === true,
      stitchDisabled:  data.stitch_disabled === true,
    } }];
  }

  // ---- Instagram catalog audio search ----
  //
  // Wraps GET /accounts/{id}/instagram/audio. Meta exposes only the audio it
  // has CLEARED for third-party publishing, so this catalog is a subset of
  // what the Instagram app shows — the trending sound of the week is usually
  // not in it. That is Meta's restriction, not Zernio's and not ours; the
  // composer says so rather than letting someone hunt for a track that was
  // never reachable.
  //
  // Omitting `q` returns trending, which is the more useful default for a
  // picker that opens with nothing typed.
  if (action === 'audio_search'){
    const accountId = String(body.account_id || '').trim();
    const q         = String(body.q || '').trim();
    const audioType = String(body.audio_type || 'music').trim();
    if (!accountId) throw new Error('account_id is required.');
    const profileId = await ensureProfile();

    // Same tenancy guard as disconnect and creator_info: account_id arrives
    // from a browser, and this reads against another workspace's account
    // otherwise.
    const accounts = await listAccounts(profileId);
    const account  = accounts.find(a => String(a._id) === accountId);
    if (!account){
      throw new Error('That account does not belong to this workspace.');
    }

    const params = { audioType, q };

    let res;
    try {
      res = await req({ method:'GET',
        url:`${ZBASE}/accounts/${encodeURIComponent(accountId)}/instagram/audio?${qsEncode(params)}`,
        headers:zHeaders, json:true });
    } catch (e) {
      // The one failure worth naming, because it is a CONNECTION problem
      // rather than a search problem and the fix is a reconnect, not a
      // different query. Instagram-Login accounts cannot touch catalog audio
      // at all.
      const raw = JSON.stringify((e && e.body) || '') + ' ' + String((e && e.message) || '');
      if (/instagram_audio_requires_facebook_login/i.test(raw)){
        return [{ json: { ok:false, needsReconnect:true,
          error: 'This account was connected without Facebook access, which Instagram requires for catalog audio. Reconnect it to enable audio.' } }];
      }
      throw e;
    }

    // Zernio has wrapped list responses differently across versions; take the
    // first shape that is actually an array rather than assuming one.
    const items = (res && (res.audio || res.audios || res.items || res.results || res.data)) || [];
    const list  = Array.isArray(items) ? items : [];

    return [{ json: { ok:true, trending: !q, audio: list.map(a => ({
      audioId:  String(a.audioId || a.id || a._id || ''),
      title:    String(a.title || a.name || ''),
      artist:   String(a.artist || a.artistName || a.creator || ''),
      // Seconds. Zernio reports milliseconds on some shapes and seconds on
      // others; normalise here so the picker does not have to guess which.
      duration: Number(a.durationSeconds || (a.durationMs ? a.durationMs / 1000 : 0) || a.duration || 0) || null,
      // Preview only, and short-lived — Zernio's own docs put the expiry at
      // roughly a day and a half. Never stored on a post row: a saved draft
      // must re-fetch rather than hold a dead URL.
      previewUrl: String(a.downloadUrl || a.previewUrl || ''),
      coverUrl:   String(a.coverUrl || a.thumbnailUrl || ''),
    })).filter(a => a.audioId) } }];
  }

  throw new Error(`Unknown action: ${action || '(none)'}`);
} catch (err) {
  // Deliberately ok:false with HTTP 200 rather than a thrown node error.
  // responseMode=lastNode means a throw reaches the browser as an empty body
  // (see the Webhook Secret Guard note), and "Connect failed" with no reason
  // is the single most annoying thing this screen could do.
  return [{ json: { ok:false, error: String((err && err.message) || err) } }];
}
"""


def build_zernio_connect() -> dict:
    """
    Webhook (responseMode=lastNode) -> Zernio: Connect (single Code node whose
    return value IS the HTTP response).

    One workflow with an `action` switch rather than five workflows, because
    all five share the profile get-or-create and four of them share the
    account mirror — split apart, that logic would be copy-pasted five ways
    and would drift the first time Zernio changed a field name.

    Synchronous for the same reason as Publish Post: somebody is watching a
    Connect button and needs a real answer or a real error.
    """
    nodes = [
        _sticky(ZERNIO_CONNECT_STICKY, height=560, width=520, x=0, y=-360),
        _webhook("arak-zernio-connect", "lastNode", x=0, y=220),
        _code("Zernio: Connect", ZERNIO_CONNECT_JS, x=240, y=220),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Zernio: Connect", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Zernio Connect",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


RESEARCH_RUN_STICKY = """## Research Run — Stage 0 (gather)

**Zero secrets in this file.** Needs `META_IG_TOKEN`, `META_IG_USER_ID`, `SUPABASE_URL`, `SUPABASE_KEY`.

Webhook path: `/arak-research-run`. Body: `{ workspace_id, trigger?, period_days? }`.

The evidence half of the weekly review. Stages 1-5 (plan / search / reflect / synthesise) land on top of this later — this stage makes no model call at all, and produces a competitor board with real numbers before any model is involved.

**Every number here is computed in code.** Asking a model to subtract last week's post count from this week's is asking it to be occasionally wrong about the number the reader will trust most. The model, when it arrives, receives deltas as given facts.

**It only snapshots a VERIFIED handle** — `ig_status in ('resolved','human_set')`. A handle alone is never permission to collect numbers: the resolve step deliberately stores weak candidates as suggestions, and reading `ig_handle` without the status is exactly how a guess reaches the board.

**Async.** The run row is inserted `running` and the webhook answers immediately with its id; the browser polls. Every path out — including the failure path — writes a terminal status, because a run left `running` is a spinner nobody can close.

**Single-flight** is a partial unique index in the database, not a check here. A second press returns the RUNNING run's id rather than starting a second agent on the same period.

**Refuses to invent a baseline.** The first run for a brand reports `baseline: true` and no movements. A delta needs two snapshots and there is only one."""


RESEARCH_RUN_OPEN_JS = r"""
const rawHttp = this.helpers.httpRequest;

const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawHttp(opts); }
    catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

const raw  = ($input.first() && $input.first().json) || {};
const body = raw.body || raw;
const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const wsId = String(body.workspace_id || '').trim();
if (!wsId) throw new Error('workspace_id is required.');

const trigger = ['manual', 'scheduled', 'chat'].includes(body.trigger) ? body.trigger : 'manual';
const periodDays = Math.min(90, Math.max(1, Number(body.period_days) || 7));

const now = new Date();
const periodEnd = new Date(now);
const periodStart = new Date(now.getTime() - periodDays * 86400000);
const asDate = d => d.toISOString().slice(0, 10);

// Sweep first. A run whose workflow died between the insert and the terminal
// write holds the single-flight index open forever, and every later press
// would come back "already running" pointing at a run that finished nothing.
// Twenty minutes is generous for a stage that makes at most a few dozen HTTP
// calls — same reasoning as the creative reconcile sweep.
const staleBefore = new Date(now.getTime() - 20 * 60000).toISOString();
await http({
  method: 'PATCH',
  url: `${SUPA_URL}/rest/v1/research_runs?workspace_id=eq.${wsId}&status=eq.running&started_at=lt.${staleBefore}`,
  headers: sHeaders,
  body: { status: 'failed', error: 'Timed out — the run stopped writing and was swept.', finished_at: now.toISOString() },
  json: true, returnFullResponse: true, ignoreHttpStatusErrors: true,
});

// Claim the run. Single-flight is a partial unique index on
// (workspace_id) WHERE status = 'running', so the DATABASE refuses the second
// caller rather than a check-then-insert here that two tabs could both pass.
const ins = await http({
  method: 'POST', url: `${SUPA_URL}/rest/v1/research_runs`,
  headers: { ...sHeaders, Prefer: 'return=representation' },
  body: {
    workspace_id: wsId, trigger, status: 'running', stage: 'gather',
    period_start: asDate(periodStart), period_end: asDate(periodEnd),
  },
  json: true, returnFullResponse: true, ignoreHttpStatusErrors: true,
});

if (ins.statusCode === 409) {
  // Not an error, and not a second run: hand back the one already going so a
  // double-click attaches to it instead of failing at the user.
  const live = await http({
    method: 'GET',
    url: `${SUPA_URL}/rest/v1/research_runs?workspace_id=eq.${wsId}&status=eq.running`
       + `&select=id,started_at,stage&order=started_at.desc&limit=1`,
    headers: sHeaders, json: true,
  });
  const row = (live || [])[0];
  return [{ json: { ok: true, proceed: false, already_running: true, workspace_id: wsId,
    run_id: row ? row.id : null,
    reason: 'A research run is already going for this brand. Watch that one rather than starting a second.' } }];
}
if (ins.statusCode < 200 || ins.statusCode >= 300) {
  const b = ins.body || {};
  throw new Error(`Could not open the run: ${b.message || b.error || `HTTP ${ins.statusCode}`}`);
}

const run = Array.isArray(ins.body) ? ins.body[0] : ins.body;
return [{ json: {
  ok: true, proceed: true, already_running: false,
  workspace_id: wsId, run_id: run.id, trigger,
  period_start: periodStart.toISOString(), period_end: periodEnd.toISOString(),
  period_days: periodDays,
} }];
"""


RESEARCH_RUN_GATHER_JS = r"""
const rawHttp = this.helpers.httpRequest;

const http = async (opts) => {
  for (let attempt = 0; ; attempt++) {
    try { return await rawHttp(opts); }
    catch (e) {
      const code = (e && (e.code || (e.cause && e.cause.code))) || '';
      const msg  = String((e && e.message) || '');
      const isDns = code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        || /getaddrinfo\s+(ENOTFOUND|EAI_AGAIN)/.test(msg);
      if (!isDns || attempt >= 2) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
};

async function req(opts){
  const res = await http({ ...opts, returnFullResponse: true, ignoreHttpStatusErrors: true });
  if (res.statusCode >= 200 && res.statusCode < 300) return res.body;
  const b = res.body;
  const msg = (b && typeof b === 'object') ? (b.error || b.message || JSON.stringify(b).slice(0, 300))
            : (typeof b === 'string' && b) ? b.slice(0, 300) : `HTTP ${res.statusCode}`;
  throw new Error(`${opts.__label || 'Request'} ${res.statusCode}: ${msg}`);
}

const inp = ($input.first() && $input.first().json) || {};
const wsId  = inp.workspace_id;
const runId = inp.run_id;

const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY = $env.SUPABASE_KEY;
const sHeaders = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' };

const GRAPH    = 'https://graph.facebook.com/v23.0';
const IG_TOKEN = $env.META_IG_TOKEN;
const IG_USER  = $env.META_IG_USER_ID;

const periodStart = new Date(inp.period_start);
const periodEnd   = new Date(inp.period_end);
const periodDays  = Number(inp.period_days) || 7;

// Every exit from here writes a terminal status. A run left 'running' is a
// spinner nobody can close, and the sweep in the previous node only catches
// it twenty minutes later — draft_status taught this expensively.
async function finish(patch) {
  await http({
    method: 'PATCH', url: `${SUPA_URL}/rest/v1/research_runs?id=eq.${runId}&workspace_id=eq.${wsId}`,
    headers: sHeaders, body: { finished_at: new Date().toISOString(), ...patch },
    json: true, returnFullResponse: true, ignoreHttpStatusErrors: true,
  });
}

// ─── Metrics, computed here and never by a model ─────────────────────────

const round = (n, p = 2) => (n == null || !isFinite(n)) ? null : Math.round(n * 10 ** p) / 10 ** p;

function metricsFor(media, followers) {
  const inPeriod = (media || []).filter(m => {
    const t = new Date(m.timestamp);
    return !isNaN(t) && t >= periodStart && t <= periodEnd;
  });

  const formatCounts = {};
  for (const m of inPeriod) {
    const k = m.media_type || 'UNKNOWN';
    formatCounts[k] = (formatCounts[k] || 0) + 1;
  }
  const formatMix = {};
  for (const [k, v] of Object.entries(formatCounts)) formatMix[k] = round(v / inPeriod.length, 3);

  // Instagram lets an account hide its like counts, and business_discovery
  // then omits like_count entirely. A missing count is NOT a zero: averaging
  // it in would quietly punish exactly the accounts that hid it. So cadence
  // counts every post while the engagement averages count only the posts that
  // actually reported — which is why the schema keeps posts_in_period and
  // sample_size as separate columns.
  const measurable = inPeriod.filter(m => m.like_count != null || m.comments_count != null);
  const engagementOf = m => (Number(m.like_count) || 0) + (Number(m.comments_count) || 0);
  const totalEngagement = measurable.reduce((a, m) => a + engagementOf(m), 0);
  const avgEngagement = measurable.length ? totalEngagement / measurable.length : null;

  const postHours = {};
  for (const m of inPeriod) {
    const t = new Date(m.timestamp);
    if (isNaN(t)) continue;
    const k = `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][t.getUTCDay()]}-${String(t.getUTCHours()).padStart(2, '0')}`;
    postHours[k] = (postHours[k] || 0) + 1;
  }

  const topPosts = [...measurable]
    .sort((a, b) => engagementOf(b) - engagementOf(a))
    .slice(0, 3)
    .map(m => ({
      permalink: m.permalink || '', likes: m.like_count ?? null, comments: m.comments_count ?? null,
      media_type: m.media_type || '', timestamp: m.timestamp || '',
      hook: String(m.caption || '').split('\n')[0].slice(0, 160),
    }));

  return {
    posts_in_period: inPeriod.length,
    posts_per_week: periodDays > 0 ? round(inPeriod.length * 7 / periodDays) : null,
    format_mix: formatMix,
    avg_engagement: round(avgEngagement),
    // The only number comparable across accounts of different sizes, and so
    // the only one the report is allowed to rank on. Null rather than zero
    // when we do not know the follower count — a ratio over an unknown
    // denominator is not a small number, it is not a number.
    engagement_per_1k: (avgEngagement != null && followers > 0)
      ? round((avgEngagement / followers) * 1000) : null,
    top_posts: topPosts,
    post_hours: postHours,
    sample_size: measurable.length,
    likes_hidden: inPeriod.length - measurable.length,
    // media.limit caps what we can see. If every post we got back falls inside
    // the period, there may be more we never saw and the cadence is a floor,
    // not a count.
    truncated: (media || []).length >= 50 && inPeriod.length === (media || []).length,
  };
}

async function discover(handle) {
  const fields = `business_discovery.username(${handle})`
    + `{id,username,name,biography,website,followers_count,follows_count,media_count,`
    + `media.limit(50){id,caption,media_type,permalink,timestamp,like_count,comments_count}}`;
  const url = `${GRAPH}/${IG_USER}?fields=${encodeURIComponent(fields)}`
            + `&access_token=${encodeURIComponent(IG_TOKEN)}`;
  const res = await http({ method: 'GET', url, returnFullResponse: true, ignoreHttpStatusErrors: true, json: true });
  if (res.statusCode < 200 || res.statusCode >= 300) {
    const b = res.body || {};
    return { ok: false, error: String((b.error && b.error.message) || `HTTP ${res.statusCode}`).slice(0, 200) };
  }
  const bd = res.body && res.body.business_discovery;
  if (!bd) return { ok: false, error: 'no business_discovery payload' };
  return { ok: true, acct: bd };
}

// ─── The pass ────────────────────────────────────────────────────────────

try {
  if (!IG_TOKEN || !IG_USER) {
    await finish({ status: 'failed', error: 'META_IG_TOKEN / META_IG_USER_ID are not set on this n8n instance.' });
    return [{ json: { ok: false, run_id: runId, error: 'META_IG_TOKEN / META_IG_USER_ID are not set on this n8n instance.' } }];
  }

  // Only VERIFIED handles. This filter is the whole reason the resolve step
  // stores weak candidates separately, and reading ig_handle without checking
  // ig_status is precisely how a guess would reach the numbers.
  const watch = await req({
    __label: 'Supabase', method: 'GET',
    url: `${SUPA_URL}/rest/v1/research_agenda?workspace_id=eq.${wsId}&kind=eq.competitor`
       + `&status=neq.retired&ig_status=in.(resolved,human_set)`
       + `&select=id,subject,ig_handle&limit=100`,
    headers: sHeaders, json: true,
  });

  // Our own account, so every comparison is against us rather than against an
  // average of rivals.
  const selfRows = await req({
    __label: 'Supabase', method: 'GET',
    url: `${SUPA_URL}/rest/v1/social_accounts?workspace_id=eq.${wsId}&platform=eq.instagram`
       + `&is_active=eq.true&select=username,followers_count&limit=1`,
    headers: sHeaders, json: true,
  });
  const selfHandle = ((selfRows || [])[0] || {}).username || '';

  const targets = [
    ...watch.map(w => ({ agenda_id: w.id, name: w.subject, handle: w.ig_handle, is_self: false })),
    ...(selfHandle ? [{ agenda_id: null, name: 'Us', handle: selfHandle, is_self: true }] : []),
  ];

  if (!targets.length) {
    await finish({ status: 'complete', stage: 'gather', report: {
      headline: 'No competitor has a verified Instagram handle yet, so there is nothing to measure.',
      baseline: true, quiet_week: true, movements: [], competitor_board: [], market: [], gaps: [],
      proposed_rules: [], proposed_ideas: [], agenda_changes: [], unanswered: [], sources: [],
    } });
    return [{ json: { ok: true, run_id: runId, snapshots: 0,
      note: 'No verified handles to measure. Run handle resolution first.' } }];
  }

  // Sequential. A dozen accounts is not worth a concurrency bug, and a
  // rate-limited Graph answering 429 to half of them would silently narrow
  // the board without saying so.
  const snapshots = [];
  const failures = [];
  // Things that make a number less trustworthy than it looks. These reach the
  // report rather than being dropped: a cadence that is really a floor, read
  // next week as a fall, is a movement the report would state with total
  // confidence and be wrong about.
  const caveats = [];
  for (const t of targets) {
    const got = await discover(t.handle);
    if (!got.ok) {
      failures.push({ name: t.name, handle: t.handle, error: got.error });
      snapshots.push({
        run_id: runId, workspace_id: wsId, agenda_id: t.agenda_id,
        competitor_name: t.name, ig_handle: t.handle, is_self: t.is_self,
        data_source: 'web_only', captured_at: new Date().toISOString(),
      });
      continue;
    }
    const a = got.acct;
    const followers = Number(a.followers_count) || 0;
    const m = metricsFor((a.media && a.media.data) || [], followers);
    if (m.truncated) {
      caveats.push(`${t.name}: every one of the 50 posts Instagram returned falls inside this period, `
        + `so their cadence is a floor rather than a count — there may be posts we cannot see.`);
    }
    if (m.likes_hidden) {
      caveats.push(`${t.name}: ${m.likes_hidden} of ${m.posts_in_period} posts hide their like count, `
        + `so the engagement average rests on ${m.sample_size} post${m.sample_size === 1 ? '' : 's'}.`);
    }
    snapshots.push({
      run_id: runId, workspace_id: wsId, agenda_id: t.agenda_id,
      competitor_name: t.name, ig_handle: a.username || t.handle, is_self: t.is_self,
      data_source: 'instagram',
      followers, follows: Number(a.follows_count) || null, media_count: Number(a.media_count) || null,
      posts_in_period: m.posts_in_period, posts_per_week: m.posts_per_week,
      format_mix: m.format_mix, avg_engagement: m.avg_engagement,
      engagement_per_1k: m.engagement_per_1k, top_posts: m.top_posts,
      post_hours: m.post_hours, sample_size: m.sample_size,
      captured_at: new Date().toISOString(),
    });
  }

  for (const s of snapshots) {
    await req({
      __label: 'Supabase', method: 'POST', url: `${SUPA_URL}/rest/v1/competitor_snapshots`,
      headers: sHeaders, body: s, json: true,
    });
  }

  // ─── Deltas ────────────────────────────────────────────────────────────
  // Read back the PREVIOUS snapshot per competitor and subtract. This is why
  // competitor_snapshots exists at all: without a stored prior row, "their
  // posting went 3 to 7 a week" would be a model recalling something it never
  // saw.
  const prior = await req({
    __label: 'Supabase', method: 'GET',
    url: `${SUPA_URL}/rest/v1/competitor_snapshots?workspace_id=eq.${wsId}&run_id=neq.${runId}`
       + `&data_source=eq.instagram&select=competitor_name,captured_at,followers,posts_per_week,`
       + `engagement_per_1k,format_mix&order=captured_at.desc&limit=500`,
    headers: sHeaders, json: true,
  });
  const prevByName = new Map();
  for (const p of prior || []) {
    const k = String(p.competitor_name || '').toLowerCase();
    if (!prevByName.has(k)) prevByName.set(k, p);   // ordered desc, so first is latest
  }

  const videoShare = mix => {
    const v = Number((mix || {}).VIDEO || 0) + Number((mix || {}).REELS || 0);
    return isFinite(v) ? round(v, 3) : null;
  };

  const movements = [];
  const pushMove = (name, metric, from, to, unit) => {
    if (from == null || to == null) return;
    if (from === 0 && to === 0) return;
    const abs = Math.abs(to - from);
    const rel = from !== 0 ? abs / Math.abs(from) : 1;
    // A floor, so a rounding wobble does not get reported as news.
    if (rel < 0.15) return;
    movements.push({
      what: `${name}: ${metric}`, metric, competitor: name,
      from: round(from), to: round(to), unit,
      change_pct: round(rel * 100, 1),
      direction: to > from ? 'up' : 'down',
      significance: rel >= 0.5 ? 'high' : rel >= 0.25 ? 'medium' : 'low',
      evidence_source: 'instagram',
    });
  };

  let comparable = 0;
  for (const s of snapshots) {
    if (s.data_source !== 'instagram') continue;
    const prev = prevByName.get(String(s.competitor_name).toLowerCase());
    if (!prev) continue;
    comparable += 1;
    pushMove(s.competitor_name, 'followers', Number(prev.followers), s.followers, 'followers');
    pushMove(s.competitor_name, 'posts per week', Number(prev.posts_per_week), s.posts_per_week, 'posts/week');
    pushMove(s.competitor_name, 'engagement per 1k followers', Number(prev.engagement_per_1k), s.engagement_per_1k, 'per 1k');
    pushMove(s.competitor_name, 'share of posts that are video', videoShare(prev.format_mix), videoShare(s.format_mix), 'share');
  }
  movements.sort((a, b) => (b.change_pct || 0) - (a.change_pct || 0));

  // ─── The board ─────────────────────────────────────────────────────────
  // `vs_us` stays null unless our own account clears a floor. Arak's connected
  // account has ONE follower, so a ratio against it would render as -99.9%
  // and read as a finding — which is worse than rendering nothing.
  const MIN_SELF_BASELINE = 50;
  const self = snapshots.find(s => s.is_self && s.data_source === 'instagram');
  const selfComparable = !!self && Number(self.followers) >= MIN_SELF_BASELINE
                         && self.engagement_per_1k != null;

  const board = snapshots.filter(s => !s.is_self).map(s => {
    const prev = prevByName.get(String(s.competitor_name).toLowerCase());
    return {
      name: s.competitor_name, handle: s.ig_handle, data: s.data_source,
      followers: s.followers ?? null,
      followers_delta: prev && s.followers != null ? s.followers - Number(prev.followers) : null,
      posts_per_week: s.posts_per_week ?? null,
      posts_per_week_prev: prev ? round(Number(prev.posts_per_week)) : null,
      format_mix: s.format_mix || {},
      engagement_per_1k: s.engagement_per_1k ?? null,
      vs_us: (selfComparable && s.engagement_per_1k != null)
        ? `${s.engagement_per_1k >= self.engagement_per_1k ? '+' : ''}` +
          `${round(((s.engagement_per_1k - self.engagement_per_1k) / self.engagement_per_1k) * 100, 1)}%`
        : null,
      vs_us_note: selfComparable ? null : 'No comparable account of ours is connected yet.',
      sample_size: s.sample_size ?? null,
      top_posts: s.top_posts || [],
    };
  });

  const baseline = comparable === 0;
  const report = {
    headline: baseline
      ? `First measurement of ${board.length} competitor${board.length === 1 ? '' : 's'} — nothing to compare against yet.`
      : movements.length
        ? `${movements.length} measurable change${movements.length === 1 ? '' : 's'} across ${comparable} competitor${comparable === 1 ? '' : 's'}.`
        : 'Nothing moved measurably this week.',
    baseline,
    quiet_week: !baseline && movements.length === 0,
    period: { start: inp.period_start, end: inp.period_end, days: periodDays },
    movements, competitor_board: board,
    market: [], gaps: [], proposed_rules: [], proposed_ideas: [], agenda_changes: [],
    unanswered: [
      ...failures.map(f => `Could not read ${f.name} (@${f.handle}): ${f.error}`),
      ...caveats,
    ],
    sources: [],
    stage_reached: 'gather',
  };

  await finish({ status: 'complete', stage: 'gather', report });

  return [{ json: { ok: true, run_id: runId, snapshots: snapshots.length,
    measured: snapshots.filter(s => s.data_source === 'instagram').length,
    failed: failures.length, movements: movements.length, baseline } }];

} catch (e) {
  const msg = String((e && e.message) || e).slice(0, 500);
  await finish({ status: 'failed', error: msg });
  return [{ json: { ok: false, run_id: runId, error: msg } }];
}
"""


def build_research_run() -> dict:
    """
    Webhook -> Run: Open (Code) -> Started? (IF)
            -> Run: Gather (Code) -> Respond
                                  \\-> Respond: Already Running

    Stage 0 of the weekly review, and for now the whole of it. Stages 1-5 hang
    off the end of Gather later; nothing here needs rework when they do,
    because the report document it writes is already the shape §8 specifies —
    just with the model-authored sections empty.

    Two Code nodes, connected in sequence rather than through `$('...')`, for
    the same reason as Research Resolve: the harness supplies $input and $env
    but not the node graph.

    The failure write lives INSIDE Gather's try/catch rather than on an n8n
    error branch. An error output that is itself misconfigured leaves the run
    'running' forever, which is the exact failure this is guarding against —
    so it does not depend on wiring being right.
    """
    nodes = [
        _sticky(RESEARCH_RUN_STICKY, height=560, width=520, x=0, y=-380),
        _webhook("arak-research-run", "responseNode", x=0, y=200),
        _code("Run: Open", RESEARCH_RUN_OPEN_JS, x=220, y=200),
        _if_bool_equals("Started?", "run-proceed", "={{ $json.proceed }}", x=440, y=200),
        _code("Run: Gather", RESEARCH_RUN_GATHER_JS, x=660, y=120),
        _respond_json("Respond", "={{ JSON.stringify($json) }}", x=880, y=120),
        _respond_json("Respond: Already Running", "={{ JSON.stringify($json) }}", x=660, y=300),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Run: Open", "type": "main", "index": 0}]]},
        "Run: Open": {"main": [[{"node": "Started?", "type": "main", "index": 0}]]},
        "Started?": {"main": [
            [{"node": "Run: Gather", "type": "main", "index": 0}],
            [{"node": "Respond: Already Running", "type": "main", "index": 0}],
        ]},
        "Run: Gather": {"main": [[{"node": "Respond", "type": "main", "index": 0}]]},
    }
    return {
        "name": "Arak Lighting – Research Run",
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }



if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workflows")
    os.makedirs(out_dir, exist_ok=True)

    workflows = [
        build_caption_studio(),
        build_elongate_idea(),
        build_draft_copy(),
        build_media_options(),
        build_video_render(),
        build_campaign_planner(),
        build_zernio_publish(),
        build_zernio_sync(),
        build_zernio_dashboard(),
        build_zernio_connect(),
        build_meta_publish(),
        build_meta_sync(),
        build_meta_dashboard(),
        build_creative_generate(),
        build_creative_edit(),
        build_creative_video(),
        build_creative_video_edit(),
        build_creative_video_reconcile(),
        build_creative_compose(),
        build_creative_stitch(),
        build_creative_cancel(),
        build_fal_balance(),
        build_creative_enhance(),
        build_insights_review(),
        build_brand_research(),
        build_research_resolve(),
        build_research_run(),
    ]

    for wf in workflows:
        _inject_webhook_guard(wf)
        _assign_deterministic_ids(wf)
        out_path = os.path.join(out_dir, f"{wf['name']}.json")
        with open(out_path, "w") as f:
            json.dump(wf, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"wrote {out_path}")
