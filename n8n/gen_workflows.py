"""
gen_workflows.py — programmatic builder for ARAK's n8n content-generation workflows.

This REPLACES a throwaway scratchpad script (gen_workflows.py) that generated the
currently-live "v2" workflows and was permanently lost — only its JSON output
survived. This version lives in the actual git repo so that never happens again.

Builds 4 workflows as n8n-importable JSON:
  - Arak Lighting – Instagram Content Generation v2   (webhook: arak-ig-plan-generation)
  - Arak Lighting – Linkedin Content Generation v2     (webhook: arak-li-plan-generation)
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


# ============================================================
# Code-node JavaScript bodies (Instagram / LinkedIn Content Generation v2)
# ============================================================

PREPARE_BATCH_JS = r"""
const body = ($input.first().json.body) || {};
const ideas = Array.isArray(body.ideas) ? body.ideas : [];
if (!ideas.length) throw new Error('No ideas in payload');
return [{ json: {
  plan_id:          body.plan_id || null,
  instructions:     body.instructions || '',
  workspace_id:     body.workspace_id || null,
  caption_language: body.caption_language || 'both',
  ideas,
  count: ideas.length,
} }];
"""

# Differs from Instagram only in the default aspect_ratio fallback
# ('1:1' for IG vs '1.91:1' for LI) — substituted via __ASPECT_DEFAULT__.
SPLIT_IDEAS_JS_TEMPLATE = r"""
const b = $('Prepare Batch').first().json;
const ideas = b.ideas;
return ideas.map((idea, i) => ({
  json: {
    plan_idea_id:   idea.plan_idea_id || null,
    plan_id:        b.plan_id || null,
    workspace_id:   b.workspace_id || null,
    caption_language: b.caption_language || 'both',
    instructions:   b.instructions || '',
    topic:          idea.topic || idea.title || '',
    title:          idea.title || idea.topic || '',
    angle:          idea.angle || '',
    tone:           idea.tone || 'professional',
    style:          idea.style || 'photorealistic',
    aspect_ratio:   idea.aspect_ratio || '__ASPECT_DEFAULT__',
    design_tip:     idea.design_tip || '',
    image_idea:     idea.image_idea || '',
    occasion:       idea.occasion || '',
    content_pillar: idea.content_pillar || '',
    objective:      idea.objective || '',
    cta:            idea.cta || '',
    hashtags:       idea.hashtags || '',
    first_comment:  idea.first_comment || '',
    scheduled_date: idea.scheduled_date || null,
    publish_time:   idea.publish_time || '10:00',
    post_kind:      idea.post_kind || 'caption_image',
    slide_count:    idea.slide_count || 1,
    image_text:     idea.image_text || '',
    image_mode:     idea.image_mode || 'generate',
    reference_image_urls: Array.isArray(idea.reference_image_urls) ? idea.reference_image_urls : [],
    sibling_titles: ideas.filter((_, j) => j !== i).map(x => x.title || x.topic).filter(Boolean).slice(0, 40).join('; '),
    // Already chosen at review time (Draft Copy + Media Options) — when
    // present, Generate Post commits these instead of generating fresh
    // ones. Absent for ideas approved without going through that flow, so
    // the existing full-generation behavior is unchanged for those.
    caption_ar:        idea.caption_ar || '',
    caption_en:        idea.caption_en || '',
    media_prompt:      idea.media_prompt || '',
    preview_image_url: idea.preview_image_url || '',
    // Routing signal only, never persisted to the DB row — see Aggregate
    // Uploaded Images.
    media_type:        idea.media_type || 'image',
  }
}));
"""

INSTAGRAM_SPLIT_IDEAS_JS = SPLIT_IDEAS_JS_TEMPLATE.replace('__ASPECT_DEFAULT__', '1:1')
LINKEDIN_SPLIT_IDEAS_JS = SPLIT_IDEAS_JS_TEMPLATE.replace('__ASPECT_DEFAULT__', '1.91:1')

# Differs from Instagram only in the PLATFORM / BUCKET consts at the top —
# every other line (captions, image generation, upload prep, DB row shape)
# branches on the PLATFORM variable already, so substituting these two lines
# is the entire difference between the two workflows' core engine.
GENERATE_POST_JS_TEMPLATE = r"""
// ══════════════════════════════════════════════════════════════════════════
// Generate Post — engine for ONE plan idea (runs once per item).
// Produces bilingual caption(s) + image(s) for every post_kind, then assembles
// the DB row. NO secrets in this workflow — all keys come from n8n env vars:
//   ANTHROPIC_API_KEY, REPLICATE_API_TOKEN, SUPABASE_URL, SUPABASE_KEY
//   optional: IMAGE_PROVIDER (replicate|fal, default replicate), FAL_KEY
// ══════════════════════════════════════════════════════════════════════════
const PLATFORM = '__PLATFORM__';   // 'instagram' | 'linkedin'
const BUCKET   = '__BUCKET__';     // supabase storage bucket
const http = this.helpers.httpRequest;
const prepareBinaryData = this.helpers.prepareBinaryData;

// n8n's httpRequest helper throws its OWN generic "Request failed with
// status code 400" the moment it sees a non-2xx response — before our code
// ever gets a chance to read the real reason (an Anthropic/Replicate error
// body) out of it. That generic string is useless on a failed-post card: it
// looks identical whether the cause is a bad prompt, an expired key, or (as
// happened in production) the Anthropic account running out of credits.
// req() wraps every call and digs through every shape n8n's error can take
// to surface the real message instead.
async function req(opts){
  try {
    return await http(opts);
  } catch (e) {
    const detail = (e && (e.error || (e.response && e.response.data) || e.description)) || null;
    const real = detail
      ? (typeof detail === 'string' ? detail
        : Buffer.isBuffer(detail) ? detail.toString('utf8', 0, 300)
        : (detail.error && detail.error.message) || JSON.stringify(detail).slice(0, 400))
      : (e && e.message) || String(e);
    throw new Error(real);
  }
}

const idea = $input.item.json;
const ANTHROPIC = $env.ANTHROPIC_API_KEY;
const REPLICATE = $env.REPLICATE_API_TOKEN;
const SUPA_URL  = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPA_KEY  = $env.SUPABASE_KEY;
const PROVIDER  = String($env.IMAGE_PROVIDER || 'replicate').toLowerCase();

const kind = idea.post_kind || 'caption_image';
const lang = idea.caption_language || 'both';          // ar | en | both
const needsCaption = kind !== 'image_only';
const needsImage   = kind !== 'caption_only';
const refs = Array.isArray(idea.reference_image_urls) ? idea.reference_image_urls : [];
const useReference = idea.image_mode === 'use_reference' && refs.length > 0;
const slideCount = kind === 'carousel' ? Math.max(2, Math.min(10, Number(idea.slide_count) || 3)) : 1;
// Already chosen at review time (Draft Copy + Media Options) — commit these
// instead of generating fresh ones. Ideas approved without going through
// that review flow simply won't have these set, so the full-generation
// path below is completely unchanged for them.
const hasSelectedCaption = !!(idea.caption_ar || idea.caption_en);
const hasSelectedImage   = !!idea.preview_image_url;

// Durable per-idea status on plan_ideas — lets Post Approvals show real
// processing/failed/completed state instead of the idea silently vanishing
// if generation throws. The frontend already optimistically marks 'processing'
// the moment a plan is finalized (or a retry is clicked); this only needs to
// mark 'failed' on error — 'completed' is set by a separate node AFTER the
// post row actually saves, so we never mark done before it's really done.
async function markIdeaStatus(status, error){
  if (!idea.plan_idea_id) return;
  try {
    await http({ method:'PATCH', url:`${SUPA_URL}/rest/v1/plan_ideas?id=eq.${idea.plan_idea_id}`,
      headers:{ apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body:{ generation_status: status, generation_error: error || '' }, json:true });
  } catch (e) { /* status tracking must never crash the actual generation */ }
}

function safeJson(t){
  const c = String(t||'').replace(/```json|```/g,'').trim();
  try { return JSON.parse(c); } catch(e){
    const m = c.match(/\{[\s\S]*\}/);
    if(m){ try { return JSON.parse(m[0]); } catch(_){} }
    return {};
  }
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

function decoratePrompt(base, isTextImage){
  const style = STYLE_MAP[idea.style] || STYLE_MAP.photorealistic;
  let p = (base || idea.topic || '') + ', ' + style +
    ', Arak Lighting Saudi Arabia, luxury architectural lighting, ultra high detail';
  if (idea.design_tip) p += '. Art direction: ' + idea.design_tip;
  // The human's own freeform vision (set on the idea at plan time) — takes
  // priority over the generic design_tip when they conflict, since it's an
  // explicit ask, not a suggestion. Placed last so it's the most recent (and
  // most emphasized) instruction the image model reads.
  if (idea.image_idea)
    p += '. The person requesting this post specifically envisions: ' + idea.image_idea + ' — prioritize this over any generic art direction above if they conflict.';
  if (isTextImage && idea.image_text)
    p += '. Prominently and legibly render the exact text: "' + idea.image_text + '"';
  return p;
}

function aspectFor(){
  return idea.aspect_ratio === '1.91:1' ? '3:2'
       : (idea.aspect_ratio || (PLATFORM === 'linkedin' ? '3:2' : '1:1'));
}

// ---- image providers (replicate = active, fal = prepared) ----
async function genReplicate(prompt){
  const useI2I = refs.length > 0 && !useReference;   // 'generate' mode with a reference photo
  const model = useI2I ? 'black-forest-labs/flux-dev' : 'black-forest-labs/flux-schnell';
  const input = { prompt, aspect_ratio: aspectFor(), output_format:'webp', output_quality:90, num_outputs:1 };
  // flux-dev (img2img) is slower and has no go_fast; cap steps so it isn't
  // running the full 28-step default on every reference-guided post.
  if (useI2I){ input.image = refs[0]; input.prompt_strength = 0.72; input.num_inference_steps = 24; }
  else { input.num_inference_steps = 4; input.go_fast = true; }
  // Start the prediction and poll from t=0 — do NOT use Prefer:wait (it blocks
  // up to 60s in a sync wait that flux-dev cold starts routinely exceed, then
  // we'd still have to poll anyway). Polling immediately catches completion the
  // moment it happens.
  const start = await req({ method:'POST',
    url:`https://api.replicate.com/v1/models/${model}/predictions`,
    headers:{ Authorization:`Bearer ${REPLICATE}`, 'Content-Type':'application/json' },
    body:{ input }, json:true });
  const predId = start.id;
  const getUrl = (start.urls && start.urls.get) || (predId ? `https://api.replicate.com/v1/predictions/${predId}` : null);
  let status = start.status, out = start.output, err = start.error;
  if (!getUrl && !out) throw new Error('Replicate did not return a prediction: ' + JSON.stringify(start).slice(0, 250));
  // Poll up to ~4 minutes — generous enough for a flux-dev cold start + img2img.
  // (If n8n kills the Code node first, raise N8N_RUNNERS_TASK_TIMEOUT.)
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

async function genFal(prompt){
  // PREPARED, not active. Set IMAGE_PROVIDER=fal (+ FAL_KEY) to switch to FLUX.2 Pro.
  const FAL = $env.FAL_KEY;
  const useI2I = refs.length > 0 && !useReference;
  const endpoint = useI2I ? 'fal-ai/flux-2/pro/image-to-image' : 'fal-ai/flux-2/pro';
  const body = { prompt, image_size: (PLATFORM === 'linkedin' ? 'landscape_16_9' : 'square_hd') };
  if (useI2I){ body.image_url = refs[0]; body.strength = 0.72; }
  const r = await req({ method:'POST', url:`https://fal.run/${endpoint}`,
    headers:{ Authorization:`Key ${FAL}`, 'Content-Type':'application/json' }, body, json:true });
  const url = (r.images && r.images[0] && r.images[0].url) || (r.image && r.image.url);
  if (!url) throw new Error('fal returned no image');
  return url;
}

async function generateImage(prompt){
  return PROVIDER === 'fal' ? genFal(prompt) : genReplicate(prompt);
}

// The Code node runs in n8n's external task-runner (a separate process from
// the main workflow) — binary data can cross that process boundary in more
// than one shape depending on n8n version (a real Buffer, a plain array, or
// Node's own {type:'Buffer',data:[...]} JSON form). Handle all of them
// explicitly instead of assuming Buffer.from() always does the right thing —
// a silently-wrong buffer here previously saved a corrupted "image" with NO
// thrown error anywhere.
// Real validity check — a byte-count threshold isn't enough (a corrupted
// buffer can still be large, as happened here: a JSON-stringified Buffer is
// ~7x BIGGER than the real image, not smaller). Check the actual file
// signature instead.
function looksLikeImage(buf){
  if (!buf || buf.length < 12) return false;
  // PNG's signature leads with byte 0x89, which has its high bit set — ascii
  // decoding masks that bit off every byte (Node truncates to 7 bits for
  // 'ascii'), turning 0x89 into 0x09 and making a string compare against
  // '\x89PNG' impossible to ever match a real PNG. Checked as raw bytes
  // instead, the same way the JPEG check already correctly does it.
  const head = buf.toString('ascii', 0, 12);
  return head.startsWith('RIFF') && head.indexOf('WEBP') !== -1   // webp
      || (buf[0] === 0xFF && buf[1] === 0xD8)                      // jpeg
      || (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47); // png
}

// THE REAL ROOT CAUSE (found by reading n8n's own source, @n8n/task-runner):
// this.helpers.httpRequest(options) is proxied to the main process over a
// WebSocket as ONE JSON.stringify'd message. n8n DOES reconstruct a Buffer
// that crosses this boundary, but ONLY when the Buffer is a TOP-LEVEL RPC
// argument (see task-requester.js: `if (isSerializedBuffer(params[i]))
// params[i] = toBuffer(params[i])` — params[i], not params[i].body). Our
// upload called httpRequest({..., body: buf, ...}) — the Buffer was nested
// INSIDE the options object, so it was never reconstructed and arrived at
// Supabase as literal text '{"type":"Buffer","data":[...]}' (confirmed by
// byte inspection). Native fetch() can't help either — n8n's Code node runs
// in a hand-built vm context (see getNativeVariables() in js-task-runner.js)
// that only injects Buffer/timers/TextEncoder/FormData — no fetch at all.
//
// The fix: this.helpers.prepareBinaryData(buffer, name, mime) takes the
// Buffer as a TOP-LEVEL argument, so it IS correctly reconstructed server
// side, and hands the bytes to n8n's own Binary Data Manager (disk-backed) —
// no re-serialization needed. We only download + prepare here; the actual
// HTTP upload to Supabase Storage happens in a real "Upload to Supabase
// Storage" HTTP Request node later in this workflow (Split Pending Uploads ->
// Upload to Supabase Storage -> Aggregate Uploaded Images), which runs in
// n8n's main process and reads the binary straight off disk — no RPC, no
// Buffer-in-JSON corruption possible.
async function downloadAndPrepare(tempUrl, filename){
  const buf = await req({ method:'GET', url: tempUrl, encoding: 'arraybuffer' });
  if (!looksLikeImage(buf)) {
    throw new Error(`Downloaded file from ${tempUrl} isn't a real image (${buf.length} bytes, starts with "${buf.toString('ascii', 0, 16)}")`);
  }
  return await prepareBinaryData(buf, filename, 'image/webp');
}

// Split the prompt into a CACHED prefix (identical for every idea in this
// plan-generation batch — persona, brand context, language rule) and an
// UNCACHED suffix (this idea's own topic/angle/tone/etc). Generate Post runs
// once per idea in a tight loop right after "finalize plan", so the 2nd+
// call within the batch reads the brand-context block at ~10% of its normal
// cost instead of resending it fresh every time.
function buildCachedPrefix(){
  const langRule = lang === 'ar'
    ? 'Write the caption in SAUDI ARABIC (Gulf/Najdi dialect — natural, modern, warm; NOT stiff MSA). Put it in "caption_ar"; set "caption_en" to "".'
    : lang === 'en'
    ? 'Write the caption in ENGLISH. Put it in "caption_en"; set "caption_ar" to "".'
    : 'Write TWO captions for the SAME post: one in SAUDI ARABIC (Gulf/Najdi dialect — natural, modern, warm; NOT stiff MSA) in "caption_ar", and one in ENGLISH in "caption_en". They should match in meaning, not be word-for-word translations.';
  const platformName = PLATFORM === 'linkedin' ? 'LinkedIn' : 'Instagram';
  return `You are a senior social media copywriter for Arak Lighting, Saudi Arabia's leading architectural lighting company (45+ years; projects incl. Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh).

You write ${platformName} posts, pre-planned in a monthly content calendar.

BRAND CONTEXT:
${idea.instructions || 'No brand profile set — keep it premium and on-brand for a luxury lighting company.'}

LANGUAGE (applies to every post): ${langRule}`;
}

function buildVariableSuffix(){
  const carouselRule = kind === 'carousel'
    ? `This is a CAROUSEL of ${slideCount} slides. Return "slide_prompts": an array of EXACTLY ${slideCount} distinct image-generation prompts (max 60 words each), one per slide, telling a coherent visual story.`
    : 'Return "image_prompt": one detailed image-generation prompt (max 70 words) for this post’s visual.';
  // LinkedIn posts are read/edited elsewhere in the app as a distinct HOOK
  // (the line shown before "see more") + BODY — Instagram has no such split,
  // captions there are one flowing block. Ask for the right shape per
  // platform instead of forcing LinkedIn through Instagram's single-field
  // schema (which was leaving every LinkedIn post's hook blank).
  const structureRule = PLATFORM === 'linkedin'
    ? 'LinkedIn needs a distinct HOOK: a short, scroll-stopping opening line, question, or bold statement (1 sentence) shown before "see more" — separate from the BODY that follows it (the rest of the post, can be several paragraphs). Write both, in each language.'
    : 'Instagram captions are ONE flowing block — no separate hook needed.';
  const schema = PLATFORM === 'linkedin'
    ? '{"hook_ar":"...", "hook_en":"...", "body_ar":"...", "body_en":"...", "hashtags":"#ArakLighting #LightingDesign plus 6-8 relevant tags, mixing Arabic and English", "image_prompt":"...", "slide_prompts":[], "post_strategy":"one sentence on why this post works"}'
    : '{"caption_ar":"...", "caption_en":"...", "hashtags":"#ArakLighting #LightingDesign plus 6-8 relevant tags, mixing Arabic and English", "image_prompt":"...", "slide_prompts":[], "post_strategy":"one sentence on why this post works"}';
  return `Now write ONE post with these specifics:

TOPIC: ${idea.topic || ''}
ANGLE: ${idea.angle || ''}
TONE: ${idea.tone || ''}
OBJECTIVE: ${idea.objective || ''}
CALL TO ACTION: ${idea.cta || ''}
CONTENT PILLAR: ${idea.content_pillar || ''}
OCCASION: ${idea.occasion || ''}
ART DIRECTION (for the image): ${idea.design_tip || ''}
${idea.image_idea ? `THE REQUESTER'S OWN VISION FOR THE IMAGE (write the caption so it matches this): ${idea.image_idea}` : ''}

OTHER POSTS ALREADY THIS MONTH (do NOT repeat their hooks, CTAs, openings or structure — make this one distinct):
${idea.sibling_titles || '(none)'}

${structureRule}

${carouselRule}

Return ONLY valid JSON, no markdown fences:
${schema}`;
}

try {
// ---------- 1) caption ----------
// LinkedIn writes hook_ar/hook_en + body_ar/body_en separately (see
// buildVariableSuffix) — caption_ar/caption_en are then derived as the whole
// post per language (hook+body joined) so Approvals' bilingual toggle still
// works the same way it always has, regardless of platform.
let caption_ar='', caption_en='', hook_ar='', hook_en='', body_ar='', body_en='',
    // A human-set hashtag list at plan time always wins over whatever Claude
    // proposes (or the hardcoded fallback) — applies regardless of post_kind,
    // including image_only where no caption call happens at all.
    hashtags = idea.hashtags || '#ArakLighting #LightingDesign',
    post_strategy='', image_prompt = idea.media_prompt || idea.topic || '', slide_prompts = [];
if (needsCaption && hasSelectedCaption){
  // Picked (or hand-edited) during review — commit it as-is, no Claude call.
  // LinkedIn note: Draft Copy proposes one flowing caption, not a separate
  // hook/body split — the whole thing lands in body_*, hook_* stays empty.
  // The reviewer can still split it in Approvals afterward; this only
  // affects ideas that went through the new review flow with a LinkedIn
  // caption already selected.
  caption_ar = idea.caption_ar || '';
  caption_en = idea.caption_en || '';
  if (PLATFORM === 'linkedin') { body_ar = caption_ar; body_en = caption_en; }
} else if (needsCaption){
  // Sonnet 5, not Opus: per-post caption writing is well within Sonnet's
  // strength and ~40% cheaper. Opus is reserved for the monthly Campaign
  // Planner call, which genuinely needs the extra reasoning (holidays,
  // cadence, whole-month consistency).
  const resp = await req({ method:'POST', url:'https://api.anthropic.com/v1/messages',
    headers:{ 'x-api-key':ANTHROPIC, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body:{ model:'claude-sonnet-5', max_tokens:2500, messages:[{ role:'user', content: [
      { type:'text', text: buildCachedPrefix(), cache_control:{ type:'ephemeral' } },
      { type:'text', text: buildVariableSuffix() },
    ] }] },
    json:true });
  // Anthropic errors come back as {type:'error', error:{type, message}} — a
  // 200-shaped body with no .content. Without this check, a failed call was
  // silently read as "empty response" and produced a blank-caption post that
  // LOOKED successful instead of being marked failed with a real reason.
  if (!resp || resp.type === 'error' || !Array.isArray(resp.content)) {
    throw new Error('Claude caption call failed: ' + (resp && resp.error && resp.error.message ? resp.error.message : JSON.stringify(resp).slice(0, 300)));
  }
  // Claude 5-family models can return a leading `thinking` block even when
  // thinking wasn't explicitly requested — content[0] is NOT reliably the
  // text block, so find it by type instead of indexing.
  const textBlock = resp.content.find(b => b.type === 'text');
  const parsed = safeJson(textBlock && textBlock.text);
  if (PLATFORM === 'linkedin') {
    hook_ar = parsed.hook_ar || '';
    hook_en = parsed.hook_en || '';
    body_ar = parsed.body_ar || '';
    body_en = parsed.body_en || '';
    caption_ar = [hook_ar, body_ar].filter(Boolean).join('\n\n');
    caption_en = [hook_en, body_en].filter(Boolean).join('\n\n');
  } else {
    caption_ar = parsed.caption_ar || '';
    caption_en = parsed.caption_en || '';
  }
  hashtags     = idea.hashtags || parsed.hashtags || hashtags;
  post_strategy= parsed.post_strategy || '';
  image_prompt = parsed.image_prompt || idea.topic || '';
  slide_prompts= Array.isArray(parsed.slide_prompts) ? parsed.slide_prompts : [];
}

// ---------- 2) image(s) ----------
// Two different outcomes here, both legitimate:
//  - useReference / no image needed: URLs are already final (user's own
//    upload, or nothing) — db_row is complete right now.
//  - AI-generated image(s): we can only get the BYTES here (prepareBinaryData
//    is RPC-safe); the actual HTTP upload to Supabase Storage happens in a
//    real "Upload to Supabase Storage" node later in this workflow (outside
//    the Code-node sandbox), so db_row.image_urls is finished by a later
//    "Aggregate Uploaded Images" node instead — this item just carries the
//    prepared binaries + a description of what to upload.
let image_urls = [];
const binary = {};
const pending_uploads = [];
if (needsImage){
  if (useReference){
    image_urls = refs.slice(0, kind === 'carousel' ? 10 : 1);   // provided images ARE the post
  } else if (hasSelectedImage){
    // Already picked a real candidate during review (Media Options) — fal.ai's
    // own URL isn't guaranteed to last, so just make THIS one permanent
    // (same download-and-upload path a freshly-generated image goes
    // through) instead of generating anything new.
    const filename = `${Date.now()}-0-${Math.random().toString(36).slice(2,8)}.webp`;
    binary.image_0 = await downloadAndPrepare(idea.preview_image_url, filename);
    pending_uploads.push({ binaryKey: 'image_0', slideIndex: 0, filename, bucket: BUCKET });
  } else {
    let prompts;
    if (kind === 'carousel'){
      prompts = (slide_prompts.length ? slide_prompts : []).slice(0, slideCount);
      while (prompts.length < slideCount) prompts.push(image_prompt);
    } else {
      prompts = [image_prompt];
    }
    let slideIndex = 0;
    for (const p of prompts){
      const temp = await generateImage(decoratePrompt(p, kind === 'text_image'));
      const filename = `${Date.now()}-${slideIndex}-${Math.random().toString(36).slice(2,8)}.webp`;
      const binaryKey = `image_${slideIndex}`;
      binary[binaryKey] = await downloadAndPrepare(temp, filename);
      pending_uploads.push({ binaryKey, slideIndex, filename, bucket: BUCKET });
      slideIndex++;
    }
  }
}
const needsUpload = pending_uploads.length > 0;
const image_url = image_urls[0] || '';

// ---------- 3) assemble display caption + DB row ----------
const displayCaption = lang === 'ar' ? caption_ar
                    : lang === 'en' ? caption_en
                    : [caption_ar, caption_en].filter(Boolean).join('\n\n—\n\n');

const row = {
  scheduled_date: idea.scheduled_date || null,
  publish_time:   idea.publish_time || '10:00',
  topic:          idea.topic || idea.title || '',
  hashtags, image_prompt, post_strategy,
  first_comment: idea.first_comment || '',
  tone:  idea.tone || '',
  style: idea.style || 'photorealistic',
  aspect_ratio: idea.aspect_ratio || (PLATFORM === 'linkedin' ? '1.91:1' : '1:1'),
  status: 'pending_review', source: 'plan',
  plan_id: idea.plan_id || null, plan_idea_id: idea.plan_idea_id || null,
  post_kind: kind, caption_ar, caption_en, workspace_id: idea.workspace_id || null,
};
if (!needsUpload){
  // Already final — useReference or no image at all. For a video idea
  // using a reference photo, that photo is the COVER, not the post image
  // (same distinction as the uploaded-candidate path below).
  if (idea.media_type === 'video') row.cover_image_url = image_url;
  else { row.image_url = image_url; row.image_urls = image_urls; }
}
if (PLATFORM === 'instagram'){
  row.caption = displayCaption;
} else {
  // A real hook/body split (was always blank hook before) — LinkedInPage.jsx
  // is built around a distinct hook line shown before "see more", separate
  // from the body. caption_ar/caption_en (hook+body already joined per
  // language, set above) still drive Approvals' bilingual toggle unchanged.
  row.hook = lang === 'ar' ? hook_ar : lang === 'en' ? hook_en : [hook_ar, hook_en].filter(Boolean).join(' / ');
  row.body = lang === 'ar' ? body_ar : lang === 'en' ? body_en : [body_ar, body_en].filter(Boolean).join('\n\n—\n\n');
  row.post_type = 'thought_leadership';
  row.include_image = needsImage;
  row.content_route = 'plan';
}

return {
  json: { db_row: row, _failed: false, needsUpload, pending_uploads, plan_idea_id: idea.plan_idea_id || null,
          // Routing signal for Aggregate Uploaded Images — NOT part of
          // db_row, never persisted. Decides whether the uploaded image
          // lands in image_url/image_urls (default) or cover_image_url
          // (video ideas — the actual clip is a separate, later step).
          _media_type: idea.media_type || 'image',
          _summary: { kind, lang, images: needsUpload ? pending_uploads.length : image_urls.length } },
  binary,
};

} catch (err) {
  const message = (err && err.message) ? err.message : String(err);
  await markIdeaStatus('failed', message);
  return { json: { _failed: true, _error: message, plan_idea_id: idea.plan_idea_id || null } };
}
"""

INSTAGRAM_GENERATE_POST_JS = (
    GENERATE_POST_JS_TEMPLATE.replace('__PLATFORM__', 'instagram')
    .replace('__BUCKET__', 'instagram-posts')
)
LINKEDIN_GENERATE_POST_JS = (
    GENERATE_POST_JS_TEMPLATE.replace('__PLATFORM__', 'linkedin')
    .replace('__BUCKET__', 'linkedin-posts')
)

SPLIT_PENDING_UPLOADS_JS = r"""
const items = $input.all();
const out = [];
for (let idx = 0; idx < items.length; idx++) {
  const item = items[idx];
  const pending = item.json.pending_uploads || [];
  for (const p of pending) {
    out.push({
      json: { plan_idea_id: item.json.plan_idea_id, slide_index: p.slideIndex, filename: p.filename, bucket: p.bucket },
      binary: { data: item.binary[p.binaryKey] },
      pairedItem: { item: idx },
    });
  }
}
return out;
"""

AGGREGATE_UPLOADED_IMAGES_JS = r"""
const uploaded = $input.all();
const splitItems = $('Split Pending Uploads').all();
const genItems = $('Generate Post').all();

const byIdea = {};
for (const it of uploaded) {
  const srcIdx = (it.pairedItem && typeof it.pairedItem.item === 'number') ? it.pairedItem.item : null;
  const src = srcIdx !== null ? splitItems[srcIdx].json : null;
  if (!src) continue;
  const pid = src.plan_idea_id;
  if (!byIdea[pid]) byIdea[pid] = [];
  const SUPA_URL = String($env.SUPABASE_URL || '').replace(/\/+$/, '');
  byIdea[pid].push({ slideIndex: src.slide_index, url: `${SUPA_URL}/storage/v1/object/public/${src.bucket}/${src.filename}` });
}

const out = [];
for (const pid of Object.keys(byIdea)) {
  const urls = byIdea[pid].sort((a, b) => a.slideIndex - b.slideIndex).map(x => x.url);
  const genItem = genItems.find(g => String(g.json.plan_idea_id) === String(pid));
  if (!genItem) continue;
  // Video ideas: the uploaded image is a COVER, not the post's image — the
  // actual clip renders in a separate later step (arak-video-render) using
  // this cover + the idea's motion_prompt. Everything else: normal image/
  // carousel upload, as before.
  const row = genItem.json._media_type === 'video'
    ? { ...genItem.json.db_row, cover_image_url: urls[0] || '' }
    : { ...genItem.json.db_row, image_urls: urls, image_url: urls[0] || '' };
  out.push({ json: { db_row: row } });
}
return out;
"""

# ============================================================
# Sticky-note content
# ============================================================

INSTAGRAM_STICKY = r"""## Arak Instagram Content Generation v2

**Zero secrets in this file.** Set these n8n ENV VARS:
- `ANTHROPIC_API_KEY`
- `REPLICATE_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- optional: `IMAGE_PROVIDER` (replicate|fal, default replicate), `FAL_KEY`

Handles every post_kind (caption_only / image_only / caption_image / carousel / text_image), image_mode=use_reference, and bilingual (Saudi Arabic + English) captions.

**Why images route through a real HTTP Request node**: Code nodes run in n8n's external task runner, and this.helpers.httpRequest proxies to the main process as ONE JSON message — a Buffer nested inside the request body (e.g. an image upload) silently corrupts into literal text '{"type":"Buffer",...}'. prepareBinaryData() avoids this (Buffer is a top-level RPC arg, which n8n DOES reconstruct correctly), then 'Upload to Supabase Storage' — a native node, not sandboxed — sends the real bytes with no RPC boundary in the way.

**Generate Post never throws** — it catches its own errors and marks `plan_ideas.generation_status='failed'` with the real message, so Post Approvals can show it instead of the idea silently vanishing. On success, 'Mark Completed' flips it to 'completed' only after the post row actually saves."""

LINKEDIN_STICKY = r"""## Arak Linkedin Content Generation v2

**Zero secrets in this file.** Set these n8n ENV VARS:
- `ANTHROPIC_API_KEY`
- `REPLICATE_API_TOKEN`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- optional: `IMAGE_PROVIDER` (replicate|fal, default replicate), `FAL_KEY`

Handles every post_kind (caption_only / image_only / caption_image / carousel / text_image), image_mode=use_reference, and bilingual (Saudi Arabic + English) captions.

**Why images route through a real HTTP Request node**: Code nodes run in n8n's external task runner, and this.helpers.httpRequest proxies to the main process as ONE JSON message — a Buffer nested inside the request body (e.g. an image upload) silently corrupts into literal text '{"type":"Buffer",...}'. prepareBinaryData() avoids this (Buffer is a top-level RPC arg, which n8n DOES reconstruct correctly), then 'Upload to Supabase Storage' — a native node, not sandboxed — sends the real bytes with no RPC boundary in the way.

**Generate Post never throws** — it catches its own errors and marks `plan_ideas.generation_status='failed'` with the real message, so Post Approvals can show it instead of the idea silently vanishing. On success, 'Mark Completed' flips it to 'completed' only after the post row actually saves."""

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

CAPTION_STUDIO_JS = r"""
const http = this.helpers.httpRequest;
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
const platform = body.platform === 'linkedin' ? 'linkedin' : 'instagram';
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
const platformName = platform === 'linkedin' ? 'LinkedIn' : 'Instagram';
const cachedPrefix = `You are a senior social media copywriter for Arak Lighting, Saudi Arabia's leading architectural lighting company (45+ years; landmark projects incl. Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh).

You are helping a marketer refine the copy for ONE ${platformName} post they are reviewing.

BRAND CONTEXT:
${ctx.instructions || 'No brand profile set — keep it premium and on-brand for a luxury lighting company.'}

LANGUAGE: ${langRule}`;

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
  schema = platform === 'linkedin'
    ? '{"variants":[{"hook_ar":"","hook_en":"","body_ar":"","body_en":"","hashtags":""}, {…}, {…}]}'
    : '{"variants":[{"caption_ar":"","caption_en":"","hashtags":""}, {…}, {…}]}';
  variableSuffix = `${postFacts}

Write THREE genuinely DIFFERENT variants of this post's copy — not three rephrasings of the same sentence. Vary the hook, structure and rhythm across them so the reviewer has a real choice.

Return ONLY valid JSON, no markdown fences, EXACTLY this shape (exactly 3 items):
${schema}`;
} else {
  // Regenerate ONE piece; hand the model the current draft so the new piece
  // fits what's staying.
  const pieceFieldMap = {
    caption: platform === 'linkedin' ? 'the BODY text' : 'the caption',
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
"""

ELONGATE_IDEA_JS = r"""
const http = this.helpers.httpRequest;
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
const platformName = idea.platform === 'linkedin' ? 'LinkedIn' : 'Instagram';

const cachedPrefix = `You are a senior social media strategist for Arak Lighting, Saudi Arabia's leading architectural lighting company (45+ years; projects incl. Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh).

A team member has a rough idea for a ${platformName} post and wants you to turn it into a proper creative brief — the same quality of brief your AI planner already writes for auto-suggested posts. Keep their original intent; elaborate, don't replace it.

BRAND CONTEXT:
${instructions || 'No brand profile set — keep it premium and on-brand for a luxury lighting company.'}`;

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
 "hashtags":"6-8 relevant hashtags mixing Arabic and English, e.g. #ArakLighting #تصميم_اضاءة #LightingDesign"}`;

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
"""

DRAFT_COPY_STICKY = r"""## Arak – Draft Copy

**Zero secrets in this file.** Needs `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Fires ONCE PER IDEA the moment a plan is created (or whenever the reviewer asks for a fresh set of options on one card) — deliberately NOT batched across multiple ideas in one call, so a slow/failed draft never blocks the rest of the board and the "don't repeat this sibling" framing stays about OTHER ideas, not itself.

Async like the Content Generation workflows (Respond: Accepted immediately, work happens after) so the board can show a spinner per card and poll `plan_ideas.draft_status` — never synchronous, so a browser tab closing mid-draft doesn't lose the request.

Returns 3 caption options (bilingual per the brand's caption_language) and 3 format/orientation-aware media_prompt options — plus a motion_prompt per option when the idea's format is video. This is the "what should this post actually say and look like" step that happens BEFORE any image/video is rendered — Caption Studio's 3-variant UI already proved this pattern for post-review rewrites; this is the same idea moved earlier, to plan time.

Writes straight to `plan_ideas` (caption_options, media_prompt_options, draft_status, draft_error) — the reviewer picks or edits from there; nothing here is a final, generation-ready value yet."""

# ============================================================
# Code-node JavaScript body (Draft Copy)
# ============================================================
DRAFT_COPY_JS = r"""
const http = this.helpers.httpRequest;
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
const platform = body.platform === 'linkedin' ? 'linkedin' : 'instagram';
const platformName = platform === 'linkedin' ? 'LinkedIn' : 'Instagram';
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
const cachedPrefix = `You are a senior social media strategist and copywriter for Arak Lighting, Saudi Arabia's leading architectural lighting company (45+ years; landmark projects incl. Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh).

You are drafting options for ONE ${platformName} post BEFORE it gets generated — the marketer will pick or edit from what you write here, so give them real, distinct choices rather than three near-identical rewrites.

BRAND CONTEXT:
${instructions || 'No brand profile set — keep it premium and on-brand for a luxury lighting company.'}

LANGUAGE: ${langRule}`;

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
"""



MEDIA_OPTIONS_STICKY = r"""## Arak – Media Options

**Zero secrets in this file.** Needs `FAL_KEY`, `SUPABASE_URL`, `SUPABASE_KEY` (storage upload is NOT done here — see note below).

On-demand, synchronous: the reviewer clicks "🖼 Generate image options" on ONE plan-board card and waits a few seconds for 2-3 REAL candidate images (not just prompts) to choose from. Same button covers a video idea's COVER image — the actual video clip only renders at Finalize, so this stays fast and cheap even for a month with several reels.

Real spend (fal.ai), so this is always an explicit per-card click, never automatic for a whole board.

Returns fal.ai's own (temporary) URLs directly — no Supabase Storage upload happens here, since most of the 2-3 candidates get discarded the moment the reviewer picks one. Finalize re-fetches and permanently uploads only the CHOSEN url (see `preview_image_url` on `plan_ideas`)."""

# ============================================================
# Code-node JavaScript body (Media Options)
# ============================================================
MEDIA_OPTIONS_JS = r"""
const http = this.helpers.httpRequest;
const FAL = $env.FAL_KEY;

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
const platform = body.platform === 'linkedin' ? 'linkedin' : 'instagram';
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
const basePrompt = `${prompt}, ${STYLE_MAP[style] || STYLE_MAP.photorealistic}, Arak Lighting Saudi Arabia, luxury architectural lighting, ultra high detail`;

// fal.ai's aspect_ratio-style image_size buckets — closest match per the
// idea's chosen orientation, not just a platform default.
function imageSizeFor(ar){
  if (ar === '9:16') return 'portrait_16_9';
  if (ar === '4:5' || ar === '3:4') return 'portrait_4_3';
  if (ar === '1.91:1' || ar === '16:9') return 'landscape_16_9';
  return 'square_hd';
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
  const endpoint = useI2I ? 'fal-ai/flux-2/pro/image-to-image' : 'fal-ai/flux-2/pro';
  const reqBody = { prompt: finalPrompt, image_size: imageSizeFor(aspectRatio) };
  if (useI2I) { reqBody.image_url = refs[0]; reqBody.strength = 0.72; }
  const r = await req({ method:'POST', url:`https://fal.run/${endpoint}`,
    headers:{ Authorization:`Key ${FAL}`, 'Content-Type':'application/json' }, body: reqBody, json:true });
  const url = (r.images && r.images[0] && r.images[0].url) || (r.image && r.image.url);
  if (!url) throw new Error('fal returned no image');
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
const http = this.helpers.httpRequest;
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

  const statusUrl = `https://queue.fal.run/${MODEL}/requests/${requestId}/status`;
  const resultUrl = `https://queue.fal.run/${MODEL}/requests/${requestId}`;

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
  const bucket = idea.platform === 'linkedin' ? 'linkedin-posts' : 'instagram-posts';
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
const http = this.helpers.httpRequest;

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

// Our row, so we can write the result back.
const postId      = body.post_id || '';
const postTable   = body.post_table || 'instagram_generated_posts';
const workspaceId = body.workspace_id || null;
const platform    = body.platform || 'instagram';

// Only these three tables exist; anything else is a caller bug, and
// interpolating an arbitrary string into the PATCH URL would be worse.
const ALLOWED_TABLES = ['instagram_generated_posts','linkedin_generated_posts','generated_posts'];
if (!ALLOWED_TABLES.includes(postTable)) throw new Error('Unknown post_table: ' + postTable);

async function patchPost(fields){
  if (!postId) return;
  try {
    await http({ method:'PATCH', url:`${SUPA_URL}/rest/v1/${postTable}?id=eq.${postId}`,
      headers:{ apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json', Prefer:'return=minimal' },
      body: fields, json:true });
  } catch (e) { /* never let status bookkeeping mask the real publish result */ }
}

try {
  if (!ZERNIO) throw new Error('ZERNIO_API_KEY is not set on this n8n instance.');

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

  const payload = { platforms: [{ platform, accountId }] };
  if (content) payload.content = content;
  if (mediaItems.length) payload.mediaItems = mediaItems;

  // scheduledFor vs publishNow are mutually exclusive in intent; prefer an
  // explicit schedule when one is given.
  const scheduledFor = body.scheduled_for || '';
  if (scheduledFor){
    payload.scheduledFor = scheduledFor;
    payload.timezone = body.timezone || 'Asia/Riyadh';
  } else {
    payload.publishNow = true;
  }

  await patchPost({ publish_status: 'publishing', publish_error: '' });

  // ---- 3) publish ----
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
  if (publishStatus === 'scheduled') fields.scheduled_publish_at = scheduledFor || null;
  if (publishStatus === 'published') fields.published_at = post.publishedAt || new Date().toISOString();
  await patchPost(fields);

  return [{ json: { ok: true, post_id: postId, zernio_post_id: zernioPostId,
                    publish_status: publishStatus, platform, account_id: accountId,
                    platform_post_url: fields.platform_post_url } }];
} catch (err) {
  const message = (err && err.message) ? err.message : String(err);
  await patchPost({ publish_status: 'failed', publish_error: message });
  return [{ json: { ok: false, post_id: postId, error: message } }];
}
"""

ZERNIO_SYNC_STICKY = r"""## Arak – Zernio Sync (accounts + analytics)

**Zero secrets in this file.** Needs `ZERNIO_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`.

Pulls state back FROM Zernio: refreshes `social_accounts` (what's connected, follower counts, dead tokens) and fills `post_analytics` with per-day metrics for every post we published through Zernio.

Runs on a daily schedule AND on an on-demand webhook (`arak-zernio-sync`) so a "Refresh" button in the UI hits the same path — one workflow, not two that drift.

**Why it queries per-post instead of the bulk list:** `GET /v1/analytics` (list mode) returns EXTERNAL post ids, not the Zernio ids we stored at publish time — the docs are explicit about this and suggest correlating on `platformPostUrl`, which is fragile (URLs get rewritten, and it breaks entirely for posts with no public URL yet). Single-post mode (`?postId=`) is documented to accept Zernio post ids directly, so this iterates our own published rows and asks about each one by id. N calls instead of 1, but correct correlation instead of clever correlation — and at this scale N is dozens per month.

`/analytics/post-timeline` is the primary source (it returns exactly our per-day shape); the single-post totals are the fallback when a post is too new to have a timeline, written as one row dated today.

**`metrics_present`** records which metrics the platform actually reported, so a real 0 stays distinguishable from "this platform doesn't measure saves" — without it, averaging `saves` across platforms silently counts every LinkedIn post as zero-saves."""

ZERNIO_SYNC_JS = r"""
const http = this.helpers.httpRequest;

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

const POST_TABLES = ['instagram_generated_posts','linkedin_generated_posts','generated_posts'];
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
const http = this.helpers.httpRequest;

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

Model: Opus 4.8 with adaptive thinking — this is the one call in the whole pipeline that genuinely needs the extra reasoning (whole-month coherence, holiday judgment), unlike per-post Sonnet calls."""

BUILD_PROMPT_JS = r"""const input = $input.first().json.body;

const goal         = input.goal || '';
const goalCategory = input.goal_category || '';
const platforms    = input.platforms || ['instagram', 'linkedin'];
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

const timeSection = `\nPOSTING TIME: For Instagram posts, use "${defaultTime}" (KSA time, 24h HH:MM) as the default "time" unless a specific post genuinely calls for something else. For LinkedIn posts, IGNORE that default and instead pick a business-hours slot (between 09:00-11:00 or 13:00-15:00 KSA time) regardless of what the Instagram default is — LinkedIn is a B2B platform and engagement is highest during the work day, not the evening. Every post needs its own "time" value (HH:MM, 24h).\n`;

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
const pastSeriesNames = [...new Set(pastIdeas.filter(p => p.series).map(p => p.series))];
const pastOneOffs = pastIdeas.filter(p => !p.series).slice(0, 60);
const pastIdeasSection = (pastSeriesNames.length || pastOneOffs.length)
  ? `\nPREVIOUS MONTHS' CONTENT (this company's history -- read before proposing new ideas):\n` +
    (pastSeriesNames.length ? `- Ongoing recurring series already running: ${pastSeriesNames.join(', ')}. If one fits naturally this month too, continue it on its usual cadence and set "series" to its name -- a deliberate repeat format is good, not a repetition problem.\n` : '') +
    (pastOneOffs.length ? `- One-off ideas already covered in past months (do NOT repeat these angles/content -- propose genuinely new angles even if the topic area is similar):\n${pastOneOffs.map(p => `  - [${p.platform}] ${p.topic}${p.angle ? ' — ' + p.angle : ''}${p.content_pillar ? ` (${p.content_pillar})` : ''}`).join('\n')}\n` : '')
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
const promptCached = `You are a social media campaign planner for Arak Lighting, a KSA-based architectural lighting manufacturer.

${instructions ? `BRAND CONTEXT:\n${instructions}` : 'No brand profile has been set yet — keep the plan professional and generic.'}

You will be given a specific goal, date range, platform list, and any constraints for ONE planning request. Decompose it into a list of individual post ideas, spread across the date range and platforms — do not put everything on day one, and vary the topic/angle so the campaign doesn't feel repetitive.

IMPORTANT: For each Saudi seasonal/cultural moment that falls in the given date range, create at least one dedicated post tied to it and set its "occasion" accordingly. Vary the "content_pillar" across the month so it isn't all product pushes — mix project showcases, educational lighting content, brand story, and the seasonal moments.

Each post needs:
- "platform": exactly "instagram" or "linkedin"
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
- "tone": pick ONE value from the correct list for that platform —
  Instagram tones: professional, inspirational, educational, casual, promotional
  LinkedIn tones: thought_leader, executive, technical_expert, warm_human, promotional
- "suggested_style": how this specific post should actually look — pick ONE value from the correct list for that platform —
  Instagram styles: photorealistic, dramatic, minimalist, warm_residential, cool_commercial, facade_exterior
  LinkedIn styles: photorealistic, dramatic, minimalist, warm_interior, cool_commercial, facade_exterior
  Base this on the topic and angle, not just the tone — e.g. a comparison/breakdown topic should usually be minimalist, a before/after topic should usually be dramatic, an exterior/landscape topic should usually be facade_exterior.
- "suggested_aspect_ratio": pick ONE value from the correct list for that platform —
  Instagram: 1:1, 4:5, 1.91:1
  LinkedIn: 1.91:1, 1:1, 4:5
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
${featuredProductsSection}${seedPostsSection}${existingIdeasSection}${contentMixSection}${pastIdeasSection}
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
}];"""

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
const allowedPlatforms = bounds._platforms || ['instagram', 'linkedin'];
const postingDays = bounds._posting_days || []; // e.g. ['sun','tue','thu'] — [] means no constraint
const defaultTime = bounds._default_time || '19:00';

const igTones = ['professional', 'inspirational', 'educational', 'casual', 'promotional'];
const liTones = ['thought_leader', 'executive', 'technical_expert', 'warm_human', 'promotional'];

const igStyles = ['photorealistic', 'dramatic', 'minimalist', 'warm_residential', 'cool_commercial', 'facade_exterior'];
const liStyles = ['photorealistic', 'dramatic', 'minimalist', 'warm_interior', 'cool_commercial', 'facade_exterior'];

const igAspects = ['1:1', '4:5', '1.91:1'];
const liAspects = ['1.91:1', '1:1', '4:5'];

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
    const platform = p.platform === 'linkedin' ? 'linkedin' : 'instagram';
    let date = p.date;
    if (date < startDate) date = startDate;
    if (date > endDate) date = endDate;
    date = enforcePostingDay(date);

    const fallbackTime = platform === 'linkedin' ? '10:00' : defaultTime;
    const time = validTime(p.time, fallbackTime);

    const validTones = platform === 'linkedin' ? liTones : igTones;
    const tone = validTones.includes(p.tone) ? p.tone : (platform === 'linkedin' ? 'thought_leader' : 'professional');

    const validStyles = platform === 'linkedin' ? liStyles : igStyles;
    const suggestedStyle = validStyles.includes(p.suggested_style) ? p.suggested_style : 'photorealistic';

    const validAspects = platform === 'linkedin' ? liAspects : igAspects;
    const defaultAspect = platform === 'linkedin' ? '1.91:1' : '1:1';
    const suggestedAspectRatio = validAspects.includes(p.suggested_aspect_ratio) ? p.suggested_aspect_ratio : defaultAspect;

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


def _http_supabase_storage_upload(x: int, y: int) -> dict:
    return {
        "parameters": {
            "method": "POST",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/{{ $json.bucket }}/{{ $json.filename }}",
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": "image/webp"},
                    {"name": "x-upsert", "value": "true"},
                ]
            },
            "sendBody": True,
            "contentType": "binaryData",
            "inputDataFieldName": "data",
            "options": {},
        },
        "id": nid(),
        "name": "Upload to Supabase Storage",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_supabase_save_post(table: str, x: int, y: int) -> dict:
    return {
        "parameters": {
            "method": "POST",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/rest/v1/" + table,
            "sendHeaders": True,
            "headerParameters": {
                "parameters": [
                    {"name": "apikey", "value": "={{ $env.SUPABASE_KEY }}"},
                    {"name": "Authorization", "value": "=Bearer {{ $env.SUPABASE_KEY }}"},
                    {"name": "Content-Type", "value": "application/json"},
                    {"name": "Prefer", "value": "return=representation"},
                ]
            },
            "sendBody": True,
            "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify($json.db_row) }}",
            "options": {},
        },
        "id": nid(),
        "name": "Supabase: Save Post",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_mark_completed(x: int, y: int) -> dict:
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
            "jsonBody": "={{ JSON.stringify({ generation_status: 'completed', generation_error: '' }) }}",
            "options": {},
        },
        "id": nid(),
        "name": "Mark Completed",
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
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
    table_expr = "( $('Video: Render').item.json.platform === 'linkedin' ? 'linkedin_generated_posts' : 'instagram_generated_posts' )"
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


def _split_pending_uploads(x: int, y: int) -> dict:
    return _code("Split Pending Uploads", SPLIT_PENDING_UPLOADS_JS, x, y)


def _aggregate_uploaded_images(x: int, y: int) -> dict:
    return _code("Aggregate Uploaded Images", AGGREGATE_UPLOADED_IMAGES_JS, x, y)


def _build_content_generation_workflow(
    workflow_name: str,
    sticky_content: str,
    webhook_path: str,
    split_ideas_js: str,
    generate_post_js: str,
    supabase_table: str,
) -> dict:
    """
    Shared node graph for the Instagram and LinkedIn Content Generation v2
    workflows — same structure, same node names, same webhook responseMode
    (responseNode), differing only in webhook path / JS bodies / DB table.

    Webhook -> Prepare Batch -> Respond: Accepted -> Split Ideas -> Generate Post
      -> Generated OK? --(yes)--> Needs Upload? --(yes)--> Split Pending Uploads
           -> Upload to Supabase Storage -> Aggregate Uploaded Images
                                                          --(no)--> Supabase: Save Post -> Mark Completed
    """
    nodes = [
        _sticky(sticky_content, height=420, width=420, x=0, y=-80),
        _webhook(webhook_path, "responseNode", x=0, y=300),
        _code("Prepare Batch", PREPARE_BATCH_JS, x=220, y=300),
        _respond_json(
            "Respond: Accepted",
            "={{ JSON.stringify({ status: 'accepted', count: $json.count }) }}",
            x=440,
            y=300,
        ),
        _code("Split Ideas", split_ideas_js, x=660, y=300),
        _code("Generate Post", generate_post_js, x=880, y=300, run_once_for_each_item=True),
        _if_bool_equals("Generated OK?", "gate-1", "={{ $json._failed !== true }}", x=1100, y=300),
        _if_bool_equals("Needs Upload?", "upload-gate-1", "={{ $json.needsUpload === true }}", x=1320, y=300),
        _split_pending_uploads(x=1540, y=220),
        _http_supabase_storage_upload(x=1760, y=220),
        _aggregate_uploaded_images(x=1980, y=220),
        _http_supabase_save_post(supabase_table, x=2200, y=300),
        _http_mark_completed(x=2420, y=300),
    ]

    connections = {
        "Webhook": {"main": [[{"node": "Prepare Batch", "type": "main", "index": 0}]]},
        "Prepare Batch": {"main": [[{"node": "Respond: Accepted", "type": "main", "index": 0}]]},
        "Respond: Accepted": {"main": [[{"node": "Split Ideas", "type": "main", "index": 0}]]},
        "Split Ideas": {"main": [[{"node": "Generate Post", "type": "main", "index": 0}]]},
        "Generate Post": {"main": [[{"node": "Generated OK?", "type": "main", "index": 0}]]},
        "Generated OK?": {
            "main": [
                [{"node": "Needs Upload?", "type": "main", "index": 0}],
                [],
            ]
        },
        "Needs Upload?": {
            "main": [
                [{"node": "Split Pending Uploads", "type": "main", "index": 0}],
                [{"node": "Supabase: Save Post", "type": "main", "index": 0}],
            ]
        },
        "Split Pending Uploads": {"main": [[{"node": "Upload to Supabase Storage", "type": "main", "index": 0}]]},
        "Upload to Supabase Storage": {"main": [[{"node": "Aggregate Uploaded Images", "type": "main", "index": 0}]]},
        "Aggregate Uploaded Images": {"main": [[{"node": "Supabase: Save Post", "type": "main", "index": 0}]]},
        "Supabase: Save Post": {"main": [[{"node": "Mark Completed", "type": "main", "index": 0}]]},
    }

    return {
        "name": workflow_name,
        "nodes": nodes,
        "connections": connections,
        "active": False,
        "settings": {"executionOrder": "v1"},
        "tags": [],
    }


def build_instagram() -> dict:
    return _build_content_generation_workflow(
        workflow_name="Arak Lighting – Instagram Content Generation v2",
        sticky_content=INSTAGRAM_STICKY,
        webhook_path="arak-ig-plan-generation",
        split_ideas_js=INSTAGRAM_SPLIT_IDEAS_JS,
        generate_post_js=INSTAGRAM_GENERATE_POST_JS,
        supabase_table="instagram_generated_posts",
    )


def build_linkedin() -> dict:
    return _build_content_generation_workflow(
        workflow_name="Arak Lighting – Linkedin Content Generation v2",
        sticky_content=LINKEDIN_STICKY,
        webhook_path="arak-li-plan-generation",
        split_ideas_js=LINKEDIN_SPLIT_IDEAS_JS,
        generate_post_js=LINKEDIN_GENERATE_POST_JS,
        supabase_table="linkedin_generated_posts",
    )


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
                "jsonBody": "={{ JSON.stringify({ model: \"claude-opus-4-8\", max_tokens: 16000, thinking: { type: \"adaptive\" }, messages: [{ role: \"user\", content: [ { type: \"text\", text: $json.prompt_cached, cache_control: { type: \"ephemeral\" } }, { type: \"text\", text: $json.prompt_variable } ] }] }) }}",
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


def build_instagram_reels() -> dict:
    """
    Ported from the original manual-reels workflow (see git history / this
    function's docstring context in the repo for how) via a programmatic
    secret-substitution pass — NOT hand-retyped, to avoid transcription
    errors in a 27-node Wait/IF polling graph. The full node/connection
    structure is embedded as JSON below (its own internal source of truth,
    same as every other workflow this generator produces) rather than
    reconstructed through this file's node-builder helpers, since it
    predates those helpers and uses a different polling style (Wait+IF
    nodes, not a Code-node internal loop) that's already proven in
    production — preserved as-is rather than rewritten.
    """
    return json.loads(r"""{
  "name": "Arak Lighting – Instagram Reels (Manual)",
  "nodes": [
    {
      "parameters": {
        "content": "## Arak Lighting – Instagram Reels (Manual)\n\n**Zero secrets in this file.** Needs `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`.\n\nManual reel creation from the Reels Studio tab: Claude writes the caption + motion prompt, FLUX (Replicate) generates the cover image / first frame, then an image-to-video model animates the cover into the actual clip (node names still say \"Wan:\" — the model itself was swapped to LTX-Video after the Wan 2.5 endpoint started failing; renaming the nodes was left alone in this pass to avoid touching a proven multi-node polling structure for a cosmetic fix). Saves to `instagram_reels`, returns `video_url` + caption.\n\nKept its original Wait/IF polling structure (not a Code-node internal loop like this session's newer workflows) — it's already proven in production; ported as a straight secret-substitution, not a rewrite. Two real bugs fixed while porting, not just secrets: the Supabase-URL regex lost its escaping backslash in an earlier draft of this substitution (`/\\/+$/` — would have been a JS syntax error, since `//` at that position is a comment, not a regex), and the Claude model was pinned to a stale `claude-opus-4-5` (predates the current model family) — now `claude-sonnet-5`, matching every other per-item creative-writing call in this codebase.",
        "height": 340,
        "width": 480
      },
      "id": "note-overview-reels",
      "name": "Note: Overview",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [
        0,
        -380
      ]
    },
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "arak-instagram-reels",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "e57e3ef9-a43e-46e7-b6dd-d386f9c7b785",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [
        11872,
        12048
      ],
      "webhookId": "0d81fc8a-7e10-4e66-b292-7f1c915435de"
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "ri-1",
              "name": "reel_format",
              "type": "string",
              "value": "={{ $json.body.reelFormat || $json.body.reel_format || 'product_reel' }}"
            },
            {
              "id": "ri-2",
              "name": "reel_duration",
              "type": "string",
              "value": "={{ $json.body.reelDuration || $json.body.reel_duration || '30s' }}"
            },
            {
              "id": "ri-3",
              "name": "reel_hook",
              "type": "string",
              "value": "={{ ($json.body.reelHook || $json.body.reel_hook || '').replace(/[\\n\\r\\t]/g,' ').replace(/\"/g,\"'\").trim() }}"
            },
            {
              "id": "ri-4",
              "name": "reel_brief",
              "type": "string",
              "value": "={{ ($json.body.reelBrief || $json.body.reel_brief || $json.body.topic || '').replace(/[\\n\\r\\t]/g,' ').replace(/\"/g,\"'\").trim() }}"
            },
            {
              "id": "ri-5",
              "name": "reel_music",
              "type": "string",
              "value": "={{ ($json.body.reelMusic || $json.body.reel_music || '').replace(/[\\n\\r\\t]/g,' ').trim() }}"
            },
            {
              "id": "ri-6",
              "name": "reel_cta",
              "type": "string",
              "value": "={{ ($json.body.reelCta || $json.body.reel_cta || '').replace(/[\\n\\r\\t]/g,' ').trim() }}"
            },
            {
              "id": "ri-7",
              "name": "publish_time",
              "type": "string",
              "value": "={{ $json.body.publishTime || $json.body.publish_time || '10:00' }}"
            },
            {
              "id": "ri-8",
              "name": "tone",
              "type": "string",
              "value": "={{ $json.body.tone || 'professional' }}"
            },
            {
              "id": "ri-9",
              "name": "instructions",
              "type": "string",
              "value": "={{ ($json.body.instructions || '').replace(/[\\n\\r\\t]/g,' ').replace(/\"/g,\"'\").trim() }}"
            },
            {
              "id": "ri-10",
              "name": "wan_duration",
              "type": "number",
              "value": "={{ ($json.body.reelDuration || $json.body.reel_duration || '5s') === '10s' ? 10 : 5 }}"
            }
          ]
        },
        "options": {}
      },
      "id": "0a34a99b-6aa1-4236-b94e-8a72589baca4",
      "name": "Sanitize Inputs",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        12112,
        12048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-5\",\n  \"max_tokens\": 1200,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a social media video expert for Arak Lighting, Saudi Arabia's leading architectural lighting company with 45+ years of experience. Notable projects: Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh.\\n\\nCreate content for an Instagram Reel:\\n\\nREEL FORMAT: {{ $('Sanitize Inputs').item.json.reel_format }}\\nDURATION: {{ $('Sanitize Inputs').item.json.reel_duration }}\\nBRIEF: {{ $('Sanitize Inputs').item.json.reel_brief }}\\nOPENING HOOK: {{ $('Sanitize Inputs').item.json.reel_hook }}\\nMUSIC STYLE: {{ $('Sanitize Inputs').item.json.reel_music }}\\nCALL TO ACTION: {{ $('Sanitize Inputs').item.json.reel_cta }}\\nTONE: {{ $('Sanitize Inputs').item.json.tone }}\\n\\nBRAND INSTRUCTIONS:\\n{{ $('Sanitize Inputs').item.json.instructions }}\\n\\nReturn ONLY valid JSON, no markdown:\\n{\\n  \\\"caption\\\": \\\"reel caption with hook line first, emojis, line breaks, no hashtags\\\",\\n  \\\"hashtags\\\": \\\"#ArakLighting #Reels #LightingDesign [7 more relevant tags]\\\",\\n  \\\"cover_image_prompt\\\": \\\"detailed FLUX prompt for the reel cover/first frame — architectural lighting scene, photorealistic, cinematic, max 80 words\\\",\\n  \\\"motion_prompt\\\": \\\"Wan I2V animation prompt — describe camera movement and motion only, e.g. slow cinematic pan left, soft light flicker, gentle dolly zoom — max 40 words\\\",\\n  \\\"reel_strategy\\\": \\\"one sentence why this reel will perform well\\\"\\n}\"\n  }]\n}",
        "options": {}
      },
      "id": "dfdfb8b1-7d8c-44e5-8523-9ba28fe802eb",
      "name": "Claude: Reel Script",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        12352,
        12048
      ]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst clean = raw.replace(/```json|```/g,'').trim();\nlet parsed;\ntry { parsed = JSON.parse(clean); }\ncatch(e) {\n  const match = clean.match(/\\{[\\s\\S]*\\}/);\n  if (match) { try { parsed = JSON.parse(match[0]); } catch(e2) { throw new Error('Cannot parse: ' + clean.slice(0,200)); } }\n  else throw new Error('No JSON found: ' + clean.slice(0,200));\n}\nreturn [{\n  json: {\n    caption:            parsed.caption            || '',\n    hashtags:           parsed.hashtags           || '#ArakLighting #Reels',\n    cover_image_prompt: parsed.cover_image_prompt || '',\n    motion_prompt:      parsed.motion_prompt      || 'slow cinematic pan, warm light ambiance',\n    reel_strategy:      parsed.reel_strategy      || '',\n  }\n}];"
      },
      "id": "5baa4e55-7bc4-488b-a36c-bdcf1e6af8e9",
      "name": "Parse Script",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        12592,
        12048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "wait"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"input\": {\n    \"prompt\": \"{{ $('Parse Script').item.json.cover_image_prompt }} -- Arak Lighting, architectural photography, luxury interior, Saudi Arabia, hyper-detailed, 4K, cinematic\",\n    \"aspect_ratio\": \"9:16\",\n    \"output_format\": \"png\"\n  }\n}",
        "options": {}
      },
      "id": "698879b9-f314-442f-8284-367484114d3a",
      "name": "FLUX: Start Cover",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        12832,
        12048
      ]
    },
    {
      "parameters": {
        "amount": 8
      },
      "id": "326595d1-a87d-4fdf-a9aa-9b5431fd1035",
      "name": "Wait 8s",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [
        13072,
        12048
      ],
      "webhookId": "a58ea503-67e8-426c-95cc-b3e9c7cfdce8"
    },
    {
      "parameters": {
        "url": "=https://api.replicate.com/v1/predictions/{{ $('FLUX: Start Cover').item.json.id }}",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "options": {}
      },
      "id": "e363ffcd-5fc8-4b9e-b02a-3aff905cd2f5",
      "name": "FLUX: Poll Status",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        13312,
        12048
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "leftValue": "={{ $json.status }}",
              "rightValue": "succeeded",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "3d685db8-c700-417c-a5cf-5187df9459e6",
      "name": "Cover Ready?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        13552,
        12048
      ]
    },
    {
      "parameters": {
        "url": "={{ $('FLUX: Poll Status').item.json.output?.[0] }}",
        "options": {
          "response": {
            "response": {
              "responseFormat": "file"
            }
          }
        }
      },
      "id": "04c4f161-6d2a-4b5d-98cc-328945924fef",
      "name": "Download Cover",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        13792,
        12048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/instagram-reels/cover_{{ $now.toMillis() }}.png",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "image/png"
            },
            {
              "name": "x-upsert",
              "value": "true"
            }
          ]
        },
        "sendBody": true,
        "contentType": "binaryData",
        "inputDataFieldName": "data",
        "options": {}
      },
      "id": "64396977-6dc9-4cca-9428-91a93de9d21b",
      "name": "Upload Cover",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        14032,
        12048
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "scu-1",
              "name": "cover_image_url",
              "type": "string",
              "value": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/public/instagram-reels/{{ $('Upload Cover').item.json.Key.split('/').pop() }}"
            }
          ]
        },
        "options": {}
      },
      "id": "658c50e8-04cb-4d73-9b73-4aeba9a0921b",
      "name": "Set Cover URL",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        14272,
        12048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.replicate.com/v1/predictions",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"version\": \"8c47da666861d081eeb4d1261853087de23923a268a69b63febdf5dc1dee08e4\",\n  \"input\": {\n    \"image\": \"{{ $('Set Cover URL').item.json.cover_image_url }}\",\n    \"prompt\": \"{{ $('Parse Script').item.json.motion_prompt }}\",\n    \"aspect_ratio\": \"9:16\",\n    \"length\": 97,\n    \"negative_prompt\": \"blurry, distorted, low quality, watermark, warped architecture, text artifacts\"\n  }\n}",
        "options": {}
      },
      "id": "0b76fa3e-f6a7-4e28-9477-72a4f3112cc0",
      "name": "Wan: Start Reel",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        14512,
        12048
      ]
    },
    {
      "parameters": {
        "amount": 10
      },
      "id": "de4d7a82-99fc-4bcf-b741-eaafd64aadf2",
      "name": "Wait 30s",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [
        14752,
        12048
      ],
      "webhookId": "7e62f374-753c-4243-8468-526179f9c66f"
    },
    {
      "parameters": {
        "url": "=https://api.replicate.com/v1/predictions/{{ $('Wan: Start Reel').item.json.id }}",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "options": {}
      },
      "id": "6ccc67a9-669c-43cb-bf5a-73e3cc78e80a",
      "name": "Wan: Poll Status",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        14992,
        12048
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "leftValue": "={{ $json.status }}",
              "rightValue": "succeeded",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "5bad619e-62a1-4d94-9680-656f376e728b",
      "name": "Reel Ready?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        15232,
        12048
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "leftValue": "={{ $json.status }}",
              "rightValue": "failed",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            },
            {
              "leftValue": "={{ $json.status }}",
              "rightValue": "canceled",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "or"
        },
        "options": {}
      },
      "id": "bf8f1088-0e69-4519-bc22-c997faa1f878",
      "name": "Reel Failed?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        15232,
        12240
      ]
    },
    {
      "parameters": {
        "amount": 10
      },
      "id": "f12aadfe-cef9-481b-9c95-824c65a349cb",
      "name": "Wait 20s More",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [
        14992,
        12240
      ],
      "webhookId": "976f4bd9-acae-4e66-8185-a6f65332ea74"
    },
    {
      "parameters": {
        "url": "={{ $('Wan: Poll Status').item.json.output[0] }}",
        "options": {
          "response": {
            "response": {
              "responseFormat": "file"
            }
          }
        }
      },
      "id": "abf00afe-c002-462f-a162-fb2863b91fef",
      "name": "Download Video",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        15472,
        12048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/instagram-reels/reel_{{ $now.toMillis() }}.mp4",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "video/mp4"
            },
            {
              "name": "x-upsert",
              "value": "true"
            }
          ]
        },
        "sendBody": true,
        "contentType": "binaryData",
        "inputDataFieldName": "data",
        "options": {}
      },
      "id": "c7ef2e64-24cf-40ca-9b4b-49f309de0163",
      "name": "Upload Video",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        15712,
        12048
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "svu-1",
              "name": "video_url",
              "type": "string",
              "value": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/public/instagram-reels/{{ $('Upload Video').item.json.Key.split('/').pop() }}"
            },
            {
              "id": "svu-2",
              "name": "cover_url",
              "type": "string",
              "value": "={{ $('Set Cover URL').item.json.cover_image_url }}"
            }
          ]
        },
        "options": {}
      },
      "id": "3315e55a-3fa5-4036-919b-db60c3032171",
      "name": "Set Video URL",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        15952,
        12048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/rest/v1/instagram_reels",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "return=representation"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"reel_format\":    \"{{ $('Sanitize Inputs').item.json.reel_format }}\",\n  \"reel_duration\":  \"{{ $('Sanitize Inputs').item.json.reel_duration }}\",\n  \"hook\":           {{ JSON.stringify($('Sanitize Inputs').item.json.reel_hook) }},\n  \"brief\":          {{ JSON.stringify($('Sanitize Inputs').item.json.reel_brief) }},\n  \"music_note\":     {{ JSON.stringify($('Sanitize Inputs').item.json.reel_music) }},\n  \"cta\":            {{ JSON.stringify($('Sanitize Inputs').item.json.reel_cta) }},\n  \"caption\":        {{ JSON.stringify($('Parse Script').item.json.caption) }},\n  \"hashtags\":       {{ JSON.stringify($('Parse Script').item.json.hashtags) }},\n  \"motion_prompt\":  {{ JSON.stringify($('Parse Script').item.json.motion_prompt) }},\n  \"cover_image_url\":{{ JSON.stringify($('Set Video URL').item.json.cover_url) }},\n  \"video_url\":      {{ JSON.stringify($('Set Video URL').item.json.video_url) }},\n  \"publish_time\":   \"{{ $('Sanitize Inputs').item.json.publish_time }}\",\n  \"tone\":           \"{{ $('Sanitize Inputs').item.json.tone }}\",\n  \"status\":         \"ready\",\n  \"source\":         \"manual\"\n}",
        "options": {}
      },
      "id": "1d1a622b-57d0-4e88-8848-4d7304c07dbe",
      "name": "Supabase: Save Reel",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        16192,
        12048
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\n  \"success\": true,\n  \"video_url\": \"{{ $('Set Video URL').item.json.video_url }}\",\n  \"cover_image_url\": \"{{ $('Set Video URL').item.json.cover_url }}\",\n  \"caption\": {{ JSON.stringify($('Parse Script').item.json.caption) }},\n  \"hashtags\": {{ JSON.stringify($('Parse Script').item.json.hashtags) }},\n  \"motion_prompt\": {{ JSON.stringify($('Parse Script').item.json.motion_prompt) }},\n  \"reel_strategy\": {{ JSON.stringify($('Parse Script').item.json.reel_strategy) }},\n  \"status\": \"ready\"\n}",
        "options": {}
      },
      "id": "3c7e4f95-76c7-46da-8bf4-36ffbd0ea965",
      "name": "Respond: Success",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        16432,
        12048
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"success\":false,\"error\":\"Reel generation failed\",\"status\":\"{{ $json.status }}\",\"error_detail\":\"{{ $json.error }}\"}",
        "options": {}
      },
      "id": "bf36e598-5fc3-4447-ad23-ef52cd09c808",
      "name": "Respond: Error",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        15472,
        12336
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "{\"success\":false,\"error\":\"Missing reel brief. Send reelBrief in request body.\"}",
        "options": {}
      },
      "id": "89f7b738-5348-4b9c-8024-02efb1c5d19b",
      "name": "Respond: Bad Request",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        12352,
        12336
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "loose",
            "version": 1
          },
          "conditions": [
            {
              "leftValue": "={{ $runIndex }}",
              "rightValue": 40,
              "operator": {
                "type": "number",
                "operation": "gte"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "a1b2c3d4-reel-timeout-0001",
      "name": "Reel Timeout?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.2,
      "position": [
        15232,
        12432
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"success\":false,\"error\":\"Reel generation timed out after polling limit\",\"status\":\"{{ $json.status }}\",\"prediction_id\":\"{{ $('Wan: Start Reel').item.json.id }}\"}",
        "options": {}
      },
      "id": "b2c3d4e5-respond-timeout-001",
      "name": "Respond: Timeout",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        15712,
        12432
      ]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          {
            "node": "Sanitize Inputs",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Sanitize Inputs": {
      "main": [
        [
          {
            "node": "Claude: Reel Script",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Reel Script": {
      "main": [
        [
          {
            "node": "Parse Script",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Parse Script": {
      "main": [
        [
          {
            "node": "FLUX: Start Cover",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Start Cover": {
      "main": [
        [
          {
            "node": "Wait 8s",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wait 8s": {
      "main": [
        [
          {
            "node": "FLUX: Poll Status",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Poll Status": {
      "main": [
        [
          {
            "node": "Cover Ready?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Cover Ready?": {
      "main": [
        [
          {
            "node": "Download Cover",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Wait 8s",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Download Cover": {
      "main": [
        [
          {
            "node": "Upload Cover",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Upload Cover": {
      "main": [
        [
          {
            "node": "Set Cover URL",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Cover URL": {
      "main": [
        [
          {
            "node": "Wan: Start Reel",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wan: Start Reel": {
      "main": [
        [
          {
            "node": "Wait 30s",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wait 30s": {
      "main": [
        [
          {
            "node": "Wan: Poll Status",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wan: Poll Status": {
      "main": [
        [
          {
            "node": "Reel Ready?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Reel Ready?": {
      "main": [
        [
          {
            "node": "Download Video",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Reel Failed?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wait 20s More": {
      "main": [
        [
          {
            "node": "Wan: Poll Status",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Reel Failed?": {
      "main": [
        [
          {
            "node": "Respond: Error",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Reel Timeout?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Reel Timeout?": {
      "main": [
        [
          {
            "node": "Respond: Timeout",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Wait 20s More",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Download Video": {
      "main": [
        [
          {
            "node": "Upload Video",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Upload Video": {
      "main": [
        [
          {
            "node": "Set Video URL",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Video URL": {
      "main": [
        [
          {
            "node": "Supabase: Save Reel",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Supabase: Save Reel": {
      "main": [
        [
          {
            "node": "Respond: Success",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1"
  },
  "tags": []
}""")


def build_instagram_manual_generation() -> dict:
    """
    Ported from the original manual Instagram workflow via a programmatic
    secret-substitution pass, same reasoning as build_instagram_reels() —
    a proven multi-route Switch/If graph, not worth an untested rewrite.
    Embedded as JSON below rather than reconstructed node-by-node.
    """
    return json.loads(r"""{
  "name": "Arak Lighting – Instagram Manual Generation",
  "nodes": [
    {
      "parameters": {
        "content": "## Arak Lighting – Instagram Manual Generation\n\n**Zero secrets in this file.** Needs `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`.\n\nHandles all real-time requests from the Instagram Studio tab, routed by `route_type`:\n- `full` — topic + brief -> Claude caption -> FLUX image\n- `caption_only` — regenerate caption only (keep image)\n- `image_only` — regenerate image only (keep caption)\n- `style_sync` — rewrite caption tone for a new style\n\nWebhook path: `/arak-instagram`.\n\nPorted via secret-substitution, structure untouched (same reasoning as Instagram Reels — a proven multi-route Switch/If graph, not worth an untested rewrite). One real fix beyond secrets: two Claude nodes (\"Claude: Instructions Caption\", \"Claude: Caption Regen\" — both full caption-writing calls) were pinned to a stale `claude-opus-4-5` (predates the current model family), now `claude-sonnet-5` to match this codebase's per-post caption convention. The other two Claude nodes (\"Claude: Rewrite Image Prompt\", \"Claude: Style Sync Caption\" — lighter, mechanical rewrite tasks) were already on the correct current Haiku tier, left as-is.",
        "height": 420,
        "width": 480
      },
      "id": "sticky-ig-manual-gen",
      "name": "Note: Overview",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [
        18144,
        17920
      ]
    },
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "arak-instagram",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "7a85952e-17f0-4af1-a001-e09c759527a1",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [
        18144,
        18992
      ],
      "webhookId": "6a667fa9-9df6-4082-bde9-bb1ebb887944"
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "si-1",
              "name": "safe_topic",
              "type": "string",
              "value": "={{ ($json.body.topic || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").trim() }}"
            },
            {
              "id": "si-2",
              "name": "safe_instructions",
              "type": "string",
              "value": "={{ ($json.body.instructions || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").trim() }}"
            },
            {
              "id": "si-3",
              "name": "safe_current_caption",
              "type": "string",
              "value": "={{ ($json.body.current_caption || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").slice(0, 500) }}"
            },
            {
              "id": "si-4",
              "name": "tone",
              "type": "string",
              "value": "={{ $json.body.tone || 'professional' }}"
            },
            {
              "id": "si-5",
              "name": "route_type",
              "type": "string",
              "value": "={{ $json.body.route_type }}"
            },
            {
              "id": "si-6",
              "name": "content_route",
              "type": "string",
              "value": "={{ $json.body.content_route || 'instructions' }}"
            },
            {
              "id": "si-7",
              "name": "style",
              "type": "string",
              "value": "={{ $json.body.style || 'photorealistic' }}"
            },
            {
              "id": "si-8",
              "name": "visual_mode",
              "type": "string",
              "value": "={{ $json.body.visual_mode || 'auto' }}"
            },
            {
              "id": "si-9",
              "name": "custom_type",
              "type": "string",
              "value": "={{ $json.body.custom_type || '' }}"
            },
            {
              "id": "si-10",
              "name": "image_prompt",
              "type": "string",
              "value": "={{ ($json.body.image_prompt || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\") }}"
            },
            {
              "id": "si-11",
              "name": "aspect_ratio",
              "type": "string",
              "value": "={{ $json.body.aspect_ratio || '1:1' }}"
            },
            {
              "id": "si-12",
              "name": "campaign_id",
              "type": "string",
              "value": "={{ $json.body.campaignId || '' }}"
            }
          ]
        },
        "options": {}
      },
      "id": "38443973-3566-4a89-b0d1-d8230f0a72a0",
      "name": "Sanitize Inputs",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        18352,
        18992
      ]
    },
    {
      "parameters": {
        "rules": {
          "values": [
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "full",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "full"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "caption_only",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "caption_only"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "image_only",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "image_only"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "style_sync",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "style_sync"
            }
          ]
        },
        "options": {
          "fallbackOutput": "extra"
        }
      },
      "id": "6a4fa6fd-436f-4430-878a-95283c4dc79d",
      "name": "Route Type?",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3,
      "position": [
        18560,
        18944
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-5\",\n  \"max_tokens\": 1024,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a social media expert for Arak Lighting, Saudi Arabia's leading lighting company with 45+ years of experience. Notable projects: Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh.\\n\\nTOPIC: {{ $('Sanitize Inputs').item.json.safe_topic }}\\nTONE: {{ $('Sanitize Inputs').item.json.tone }}\\nVISUAL MODE: {{ $('Sanitize Inputs').item.json.visual_mode }}\\nCUSTOM POST TYPE: {{ $('Sanitize Inputs').item.json.custom_type }}\\n\\nBRAND INSTRUCTIONS:\\n{{ $('Sanitize Inputs').item.json.safe_instructions }}\\n\\nWrite an Instagram post. Return ONLY valid JSON, no markdown:\\n{\\\"caption\\\": \\\"full caption with emojis and line breaks, no hashtags\\\", \\\"hashtags\\\": \\\"#ArakLighting #LightingDesign [8 more]\\\", \\\"image_prompt\\\": \\\"detailed image generation prompt max 80 words\\\", \\\"post_strategy\\\": \\\"one sentence why this works\\\"}\"\n  }]\n}",
        "options": {}
      },
      "id": "7edc7deb-0514-407d-8b6d-a321eb75a1d6",
      "name": "Claude: Instructions Caption",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        18960,
        18704
      ]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst clean = raw.replace(/```json|```/g,'').trim();\nlet parsed;\ntry { parsed = JSON.parse(clean); }\ncatch(e) {\n  const match = clean.match(/\\{[\\s\\S]*\\}/);\n  if (match) { try { parsed = JSON.parse(match[0]); } catch(e2) { throw new Error('Cannot parse: ' + clean.slice(0,200)); } }\n  else throw new Error('No JSON found: ' + clean.slice(0,200));\n}\nconst si = $('Sanitize Inputs').first().json;\nreturn [{json: {\n  caption:       parsed.caption || '',\n  hashtags:      parsed.hashtags || '#ArakLighting #LightingDesign',\n  image_prompt:  parsed.image_prompt || '',\n  post_strategy: parsed.post_strategy || '',\n  topic:         si.safe_topic,\n  tone:          si.tone,\n  style:         si.style,\n  content_route: si.content_route,\n}}];"
      },
      "id": "2b8937af-be42-442b-b8fd-732bd5942594",
      "name": "Parse Caption",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        19168,
        18704
      ]
    },
    {
      "parameters": {
        "jsCode": "const styleMap = {\n  \"photorealistic\":   \"architectural photography, Canon EOS R5, natural lighting, hyper-detailed, 4K\",\n  \"dramatic\":         \"cinematic lighting, deep shadows, god rays, high contrast, noir atmosphere\",\n  \"minimalist\":       \"clean lines, soft diffused light, Scandinavian aesthetic, white space, elegant\",\n  \"warm_residential\": \"warm amber tones, cozy luxury interior, golden hour, warm white light 2700K\",\n  \"cool_commercial\":  \"cool white 5000K, modern commercial space, crisp, corporate luxury\",\n  \"facade_exterior\":  \"architectural exterior night photography, facade illumination, dramatic night sky\"\n};\nconst customMap = {\n  \"event_poster\":      \"professional event poster design, bold promotional graphic with text overlay space, dramatic stage lighting, gold and dark luxury color scheme, Saudi Arabia\",\n  \"hiring_poster\":     \"modern recruitment poster, professional corporate layout, inspiring office background Saudi Arabia\",\n  \"product_showcase\":  \"studio product photography, lighting fixture on pure black background, dramatic spotlight\",\n  \"project_highlight\": \"architectural interior photography, completed luxury project, golden hour, Saudi Arabia\",\n  \"quote_card\":        \"elegant minimal quote card, dark background with warm accent lighting bokeh, luxury brand\",\n  \"suppliers_collab\":  \"corporate partnership announcement, premium product display, luxury lighting showroom Saudi Arabia\",\n  \"behind_scenes\":     \"documentary photography, lighting installation on-site, team working, Saudi Arabia\",\n  \"ai_decides\":        \"\"\n};\nconst si = $('Sanitize Inputs').first().json;\nconst routeType  = si.route_type;\nconst topic      = si.safe_topic || '';\nconst visualMode = si.visual_mode;\nconst customType = si.custom_type;\nconst style      = si.style;\nlet imagePrompt, finalPrompt;\nif (routeType === 'image_only') {\n  const rewritten = $('Claude: Rewrite Image Prompt').first().json.content?.find(b=>b.type==='text')?.text || si.image_prompt;\n  imagePrompt = rewritten.trim();\n  finalPrompt = imagePrompt + ', Arak Lighting Saudi Arabia, ultra high detail';\n} else if (visualMode === 'custom' && customType) {\n  const base = $('Parse Caption').first().json.image_prompt || topic;\n  const mod  = customMap[customType] || '';\n  finalPrompt = mod ? (topic + ' — ' + base + ', ' + mod + ', Arak Lighting Saudi Arabia, ultra high detail') : (base + ', Arak Lighting Saudi Arabia, award-winning photography');\n  imagePrompt = base;\n} else if (visualMode === 'lighting' && style) {\n  const base = $('Parse Caption').first().json.image_prompt || topic;\n  const mod  = styleMap[style] || styleMap['photorealistic'];\n  finalPrompt = base + ', ' + mod + ', Arak Lighting Saudi Arabia, luxury architectural lighting';\n  imagePrompt = base;\n} else {\n  const base = $('Parse Caption').first().json.image_prompt || topic;\n  finalPrompt = base + ', Arak Lighting Saudi Arabia, luxury architectural lighting, ultra high detail';\n  imagePrompt = base;\n}\nreturn [{json: { final_prompt: finalPrompt, style: style || 'auto', image_prompt: imagePrompt, visual_mode: visualMode, custom_type: customType }}];"
      },
      "id": "f412011f-fac1-4fa4-99b8-e3e8f1deee92",
      "name": "Build Image Prompt",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        19424,
        18704
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "wait"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"input\": {\n    \"prompt\": \"{{ $json.final_prompt }}\",\n    \"aspect_ratio\": \"{{ $('Sanitize Inputs').item.json.aspect_ratio === '1.91:1' ? '3:2' : $('Sanitize Inputs').item.json.aspect_ratio || '1:1' }}\",\n    \"output_format\": \"webp\",\n    \"output_quality\": 90,\n    \"num_outputs\": 1\n  }\n}",
        "options": {}
      },
      "id": "7923bcca-4b2d-4baa-b14d-d0b69445c5b0",
      "name": "FLUX: Start Prediction",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        19616,
        18704
      ]
    },
    {
      "parameters": {
        "amount": 8
      },
      "id": "00de6ceb-23e5-4f51-9640-1dc30b376d73",
      "name": "Wait 8s",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [
        19792,
        18704
      ],
      "webhookId": "50e0f57f-17e2-4ecd-a927-fb6fcf31c469"
    },
    {
      "parameters": {
        "url": "=https://api.replicate.com/v1/predictions/{{ $('FLUX: Start Prediction').item.json.id }}",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            }
          ]
        },
        "options": {}
      },
      "id": "871bbf16-0945-4e5b-81f3-627daa0a7628",
      "name": "FLUX: Poll Status",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        19968,
        18704
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "id": "ir-1",
              "leftValue": "={{ $json.status }}",
              "rightValue": "succeeded",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "8675481a-1a63-4438-b078-498039cdef43",
      "name": "Image Ready?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.1,
      "position": [
        20128,
        18704
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "id": "fir-1",
              "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
              "rightValue": "full",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "f9a23d4d-249c-444e-b890-3e778fa084df",
      "name": "Full or Image Route?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.1,
      "position": [
        20992,
        18544
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-5\",\n  \"max_tokens\": 1024,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a social media expert for Arak Lighting, Saudi Arabia's leading lighting company.\\n\\nTOPIC: {{ $('Sanitize Inputs').item.json.safe_topic }}\\nTONE: {{ $('Sanitize Inputs').item.json.tone }}\\nINSTRUCTIONS: {{ $('Sanitize Inputs').item.json.safe_instructions }}\\n\\nCURRENT CAPTION (write something COMPLETELY DIFFERENT):\\n{{ $('Sanitize Inputs').item.json.safe_current_caption }}\\n\\nWrite a fresh Instagram caption with a different opening, angle, and structure. Strong CTA.\\n\\nReturn ONLY JSON, no markdown: {\\\"caption\\\": \\\"new caption with emojis\\\", \\\"hashtags\\\": \\\"#ArakLighting [9 tags]\\\"}\"\n  }]\n}",
        "options": {}
      },
      "id": "81d3c6db-aa3e-4110-8da7-40422a09a381",
      "name": "Claude: Caption Regen",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        18864,
        18960
      ]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst clean = raw.replace(/```json|```/g,'').trim();\nlet parsed;\ntry { parsed = JSON.parse(clean); }\ncatch(e) {\n  const match = clean.match(/\\{[\\s\\S]*\\}/);\n  parsed = match ? JSON.parse(match[0]) : {caption: clean, hashtags: '#ArakLighting'};\n}\nreturn [{json: { caption: parsed.caption, hashtags: parsed.hashtags }}];"
      },
      "id": "fdcdc4d1-3876-432b-8dcd-9b308f7a3551",
      "name": "Parse Caption Regen",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        19088,
        18960
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-haiku-4-5-20251001\",\n  \"max_tokens\": 300,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are an expert at writing image generation prompts for architectural lighting photography.\\n\\nTOPIC/BRIEF: {{ $('Sanitize Inputs').item.json.safe_topic || 'architectural lighting' }}\\nORIGINAL PROMPT: {{ $('Sanitize Inputs').item.json.image_prompt }}\\nTARGET STYLE: {{ $('Sanitize Inputs').item.json.style }}\\nASPECT RATIO: {{ $('Sanitize Inputs').item.json.aspect_ratio }}\\n\\nSTYLE DEFINITIONS:\\n- photorealistic: Canon EOS R5 architectural photography, natural lighting, hyper-detailed\\n- dramatic: cinematic deep shadows, god rays, high contrast, noir atmosphere\\n- minimalist: clean lines, soft diffused light, Scandinavian aesthetic\\n- warm_residential: warm amber 2700K tones, cozy luxury interior, golden hour\\n- cool_commercial: cool white 5000K, modern commercial space, crisp corporate luxury\\n- facade_exterior: architectural exterior night photography, facade illumination\\n\\nRewrite the image prompt for the target style. Consider aspect ratio for composition (9:16=portrait focus, 16:9=wide/landscape, 1:1=balanced, 4:5=portrait).\\n\\nReturn ONLY the prompt text, nothing else. Max 100 words.\"\n  }]\n}",
        "options": {}
      },
      "id": "7a7fcc13-97c1-4f4c-8f6e-12adb1548f8b",
      "name": "Claude: Rewrite Image Prompt",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        19040,
        19200
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\"model\": \"claude-haiku-4-5-20251001\", \"max_tokens\": 600, \"messages\": [{\"role\": \"user\", \"content\": \"You are a social media expert for Arak Lighting, Saudi Arabia's leading lighting company.\\\\n\\\\nTOPIC: {{ $('Webhook').item.json.body.topic }}\\\\nNEW STYLE: {{ $('Webhook').item.json.body.style }}\\\\nCURRENT CAPTION:\\\\n{{ $('Webhook').item.json.body.current_caption }}\\\\n\\\\nRewrite the caption tone to match the new style. Style guide: photorealistic=clean and professional, dramatic=bold and powerful, minimalist=sparse and refined, warm_residential=warm and inviting, cool_commercial=sharp and corporate, facade_exterior=grand and architectural. Keep the core message and hashtags identical.\\\\n\\\\nReturn ONLY valid JSON, no markdown: {\\\\\\\"caption\\\\\\\": \\\\\\\"rewritten caption\\\\\\\", \\\\\\\"hashtags\\\\\\\": \\\\\\\"same hashtags\\\\\\\"}\"}]}",
        "options": {}
      },
      "id": "6917b28f-8dbc-4aa3-8cd1-b54e88425d8d",
      "name": "Claude: Style Sync Caption",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        18896,
        19376
      ]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst clean = raw.replace(/```json|```/g,'').trim();\nlet parsed;\ntry { parsed = JSON.parse(clean); }\ncatch(e) {\n  const match = clean.match(/\\{[\\s\\S]*\\}/);\n  parsed = match ? JSON.parse(match[0]) : {caption: clean, hashtags: '#ArakLighting'};\n}\nreturn [{json: { caption: parsed.caption, hashtags: parsed.hashtags }}];"
      },
      "id": "12be54c9-1cb3-4824-89d6-d6654962bd86",
      "name": "Parse Style Sync",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        19200,
        19376
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"success\":true,\"route_type\":\"full\",\"content_route\":\"instructions\",\"caption\":{{ JSON.stringify($(\"Parse Caption\").item.json.caption) }},\"hashtags\":{{ JSON.stringify($(\"Parse Caption\").item.json.hashtags) }},\"image_url\":\"{{ $(\"Set Permanent Image URL\").item.json.permanent_image_url }}\",\"image_prompt\":{{ JSON.stringify($(\"Parse Caption\").item.json.image_prompt) }},\"post_strategy\":{{ JSON.stringify($(\"Parse Caption\").item.json.post_strategy) }},\"supabase_id\":\"{{ $(\"Supabase: Save Manual Post\").item.json[0]?.id || $(\"Supabase: Save Manual Post\").item.json?.id || \"\" }}\"}",
        "options": {}
      },
      "id": "8e61b0a9-64c8-4ae6-8475-6ebbe1c45bab",
      "name": "Respond: Full Success",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        21488,
        18528
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"success\":true,\"route_type\":\"image_only\",\"image_url\":\"{{ $(\"Set Permanent Image URL\").item.json.permanent_image_url }}\"}",
        "options": {}
      },
      "id": "635ab766-6687-43ac-8911-b33854342459",
      "name": "Respond: Image Success",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        21056,
        18848
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "{\"success\":false,\"error\":\"Image generation timed out. Please try again.\"}",
        "options": {
          "responseCode": 202
        }
      },
      "id": "977906fd-adba-4bf7-8848-683d0c5fd76c",
      "name": "Respond: Image Error",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        20352,
        18864
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"success\":true,\"route_type\":\"caption_only\",\"caption\":{{ JSON.stringify($(\"Parse Caption Regen\").item.json.caption) }},\"hashtags\":{{ JSON.stringify($(\"Parse Caption Regen\").item.json.hashtags) }}}",
        "options": {}
      },
      "id": "a7603814-4c82-47d6-82f4-93d9ca2b4062",
      "name": "Respond: Caption Success",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        19664,
        18960
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={\"success\":true,\"route_type\":\"style_sync\",\"caption\":{{ JSON.stringify($(\"Parse Style Sync\").item.json.caption) }},\"hashtags\":{{ JSON.stringify($(\"Parse Style Sync\").item.json.hashtags) }}}",
        "options": {}
      },
      "id": "e9710fca-a016-4590-b237-b6b1d130368f",
      "name": "Respond: Style Sync",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        19440,
        19376
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "{\"success\":false,\"error\":\"Invalid route_type. Use: full, caption_only, image_only, or style_sync\"}",
        "options": {
          "responseCode": 400
        }
      },
      "id": "db11fcf1-21b5-4d37-9703-f95a45fba76d",
      "name": "Respond: Bad Route",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        18752,
        19584
      ]
    },
    {
      "parameters": {
        "url": "={{ $('FLUX: Poll Status').item.json.output?.[0] }}",
        "options": {}
      },
      "id": "d0baa860-3094-48e7-8704-368fa15a41bc",
      "name": "Download from Replicate",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        20368,
        18544
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/instagram-posts/{{ $now.toMillis() }}-.webp",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "image/webp"
            },
            {
              "name": "x-upsert",
              "value": "true"
            }
          ]
        },
        "sendBody": true,
        "contentType": "binaryData",
        "inputDataFieldName": "data",
        "options": {}
      },
      "id": "7685d912-7a19-407c-aa50-470b703ed743",
      "name": "Upload to Supabase Storage",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        20576,
        18544
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "spu-ig-1",
              "name": "permanent_image_url",
              "type": "string",
              "value": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/public/instagram-posts/{{ $('Upload to Supabase Storage').item.json.Key.split('/').pop() }}"
            },
            {
              "id": "spu-ig-2",
              "name": "replicate_url",
              "type": "string",
              "value": "={{ $('FLUX: Poll Status').item.json.output?.[0] }}"
            }
          ]
        },
        "options": {}
      },
      "id": "38588509-edac-495b-ae6d-dc0fd708d797",
      "name": "Set Permanent Image URL",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        20784,
        18544
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/rest/v1/instagram_manual_posts",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "return=representation"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={ \"topic\": {{ JSON.stringify($(\"Parse Caption\").item.json.topic || $(\"Sanitize Inputs\").item.json.safe_topic) }}, \"caption\": {{ JSON.stringify($(\"Parse Caption\").item.json.caption) }}, \"hashtags\": {{ JSON.stringify($(\"Parse Caption\").item.json.hashtags) }}, \"image_url\": {{ JSON.stringify($(\"Set Permanent Image URL\").item.json.permanent_image_url) }}, \"image_prompt\": {{ JSON.stringify($(\"Parse Caption\").item.json.image_prompt) }}, \"post_strategy\": {{ JSON.stringify($(\"Parse Caption\").item.json.post_strategy) }}, \"tone\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.tone) }}, \"style\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.style) }}, \"aspect_ratio\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.aspect_ratio) }}, \"content_route\": \"instructions\", \"status\": \"pending_review\", \"source\": \"manual\" }",
        "options": {}
      },
      "id": "7c65f6b9-72d9-4e3c-9465-3f267e0371db",
      "name": "Supabase: Save Manual Post",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        21248,
        18528
      ]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          {
            "node": "Sanitize Inputs",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Sanitize Inputs": {
      "main": [
        [
          {
            "node": "Route Type?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Route Type?": {
      "main": [
        [
          {
            "node": "Claude: Instructions Caption",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Claude: Caption Regen",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Claude: Rewrite Image Prompt",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Claude: Style Sync Caption",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Respond: Bad Route",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Instructions Caption": {
      "main": [
        [
          {
            "node": "Parse Caption",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Parse Caption": {
      "main": [
        [
          {
            "node": "Build Image Prompt",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Build Image Prompt": {
      "main": [
        [
          {
            "node": "FLUX: Start Prediction",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Rewrite Image Prompt": {
      "main": [
        [
          {
            "node": "Build Image Prompt",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Start Prediction": {
      "main": [
        [
          {
            "node": "Wait 8s",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wait 8s": {
      "main": [
        [
          {
            "node": "FLUX: Poll Status",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Poll Status": {
      "main": [
        [
          {
            "node": "Image Ready?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Image Ready?": {
      "main": [
        [
          {
            "node": "Download from Replicate",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Respond: Image Error",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Full or Image Route?": {
      "main": [
        [
          {
            "node": "Supabase: Save Manual Post",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Respond: Image Success",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Caption Regen": {
      "main": [
        [
          {
            "node": "Parse Caption Regen",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Parse Caption Regen": {
      "main": [
        [
          {
            "node": "Respond: Caption Success",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Style Sync Caption": {
      "main": [
        [
          {
            "node": "Parse Style Sync",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Parse Style Sync": {
      "main": [
        [
          {
            "node": "Respond: Style Sync",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Download from Replicate": {
      "main": [
        [
          {
            "node": "Upload to Supabase Storage",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Upload to Supabase Storage": {
      "main": [
        [
          {
            "node": "Set Permanent Image URL",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Permanent Image URL": {
      "main": [
        [
          {
            "node": "Full or Image Route?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Supabase: Save Manual Post": {
      "main": [
        [
          {
            "node": "Respond: Full Success",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1"
  },
  "tags": []
}""")


def build_linkedin_manual_generation() -> dict:
    """
    Ported from the original manual LinkedIn workflow (Tavily trend search
    + Claude + FLUX) via the same secret-substitution pass. One extra fix
    beyond the standard pattern: a live Tavily API key was hardcoded inside
    jsonBody on two nodes, missed by the generic Anthropic/Replicate/Supabase
    stripper — rewritten as a proper `={{ JSON.stringify(...) }}` expression
    referencing $env.TAVILY_API_KEY (jsonBody without a leading = is static
    text in n8n; {{ }} inside it does not get evaluated).
    """
    return json.loads(r"""{
  "name": "Arak Lighting – LinkedIn Manual Generation",
  "nodes": [
    {
      "parameters": {
        "content": "## Arak Lighting – LinkedIn Manual Generation\n\n**Zero secrets in this file.** Needs `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_KEY`, `TAVILY_API_KEY`.\n\nHandles all real-time requests from the LinkedIn Studio tab, routed by `route_type` (trend-aware full post / content regen / image-only regen / tone sync) — Tavily search grounds the \"trend\" variants in real current search results before Claude writes the post.\n\nWebhook path: `/arak-linkedin`.\n\nPorted via secret-substitution, structure untouched. Three real fixes beyond the standard Anthropic/Replicate/Supabase substitution:\n1. A live Tavily API key (`tvly-dev-...`) was hardcoded inside `jsonBody` on both \"Tavily: Trend Search\" and \"Tavily: Post Regen\" — missed by the generic secret-stripper since it only knew Anthropic/Replicate/Supabase shapes. Fixed by rewriting the whole `jsonBody` as a proper `={{ JSON.stringify({ api_key: $env.TAVILY_API_KEY, ... }) }}` expression (a `jsonBody` without a leading `=` is static text in n8n — `{{ }}` inside it does NOT get evaluated, so a bare string-replace leaving off the `=` prefix would have shipped a broken/unexpanded placeholder).\n2. All 4 Claude post-writing nodes (\"Claude: Trend Post\", \"Claude: Instructions Post\", \"Claude: Post Regen Trend\", \"Claude: Post Regen Instr\") were pinned to a very stale dated snapshot `claude-sonnet-4-20250514` — now `claude-sonnet-5`, matching this codebase's convention.\n3. \"Claude: Rewrite Image Prompt\" and \"Claude: Tone Sync\" were already on a correctly-dated current model (`claude-haiku-4-5-20251001`) — left as-is.",
        "height": 460,
        "width": 520
      },
      "id": "sticky-li-manual-gen",
      "name": "Note: Overview",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [
        4624,
        8880
      ]
    },
    {
      "parameters": {
        "httpMethod": "POST",
        "path": "arak-linkedin",
        "responseMode": "responseNode",
        "options": {}
      },
      "id": "0d3348b4-5df6-4e6e-9e1a-d0a3be7006de",
      "name": "Webhook",
      "type": "n8n-nodes-base.webhook",
      "typeVersion": 2,
      "position": [
        4624,
        10144
      ],
      "webhookId": "arak-linkedin-manual-001"
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "si-1",
              "name": "safe_topic",
              "type": "string",
              "value": "={{ ($json.body.topic || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").trim() }}"
            },
            {
              "id": "si-2",
              "name": "safe_instructions",
              "type": "string",
              "value": "={{ ($json.body.instructions || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").trim() }}"
            },
            {
              "id": "si-3",
              "name": "safe_current_post",
              "type": "string",
              "value": "={{ ($json.body.current_post || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").slice(0, 800) }}"
            },
            {
              "id": "si-4",
              "name": "tone",
              "type": "string",
              "value": "={{ $json.body.tone || 'thought_leader' }}"
            },
            {
              "id": "si-5",
              "name": "route_type",
              "type": "string",
              "value": "={{ $json.body.route_type }}"
            },
            {
              "id": "si-6",
              "name": "content_route",
              "type": "string",
              "value": "={{ $json.body.content_route || 'instructions' }}"
            },
            {
              "id": "si-7",
              "name": "post_type",
              "type": "string",
              "value": "={{ $json.body.post_type || 'thought_leadership' }}"
            },
            {
              "id": "si-8",
              "name": "include_image",
              "type": "boolean",
              "value": "={{ $json.body.include_image === true }}"
            },
            {
              "id": "si-9",
              "name": "style",
              "type": "string",
              "value": "={{ $json.body.style || 'photorealistic' }}"
            },
            {
              "id": "si-10",
              "name": "image_prompt",
              "type": "string",
              "value": "={{ ($json.body.image_prompt || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\") }}"
            },
            {
              "id": "si-11",
              "name": "aspect_ratio",
              "type": "string",
              "value": "={{ $json.body.aspect_ratio || '1.91:1' }}"
            },
            {
              "id": "si-12",
              "name": "campaign_id",
              "type": "string",
              "value": "={{ $json.body.campaignId || '' }}"
            },
            {
              "id": "si-13",
              "name": "current_hook",
              "type": "string",
              "value": "={{ ($json.body.current_hook || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").slice(0, 200) }}"
            },
            {
              "id": "si-14",
              "name": "current_body",
              "type": "string",
              "value": "={{ ($json.body.current_body || '').replace(/[\\n\\r\\t]/g, ' ').replace(/\"/g, \"'\").slice(0, 800) }}"
            }
          ]
        },
        "options": {}
      },
      "id": "93d9c09f-d0e2-465f-b8fd-06d04cb604a8",
      "name": "Sanitize Inputs",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        4864,
        10144
      ]
    },
    {
      "parameters": {
        "rules": {
          "values": [
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "full",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "full"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "post_only",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "post_only"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "image_only",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "image_only"
            },
            {
              "conditions": {
                "options": {
                  "caseSensitive": false,
                  "leftValue": "",
                  "typeValidation": "strict",
                  "version": 1
                },
                "conditions": [
                  {
                    "leftValue": "={{ $('Sanitize Inputs').item.json.route_type }}",
                    "rightValue": "tone_sync",
                    "operator": {
                      "type": "string",
                      "operation": "equals"
                    }
                  }
                ],
                "combinator": "and"
              },
              "renameOutput": true,
              "outputKey": "tone_sync"
            }
          ]
        },
        "options": {
          "fallbackOutput": "extra"
        }
      },
      "id": "08defdd1-49a0-4522-83c0-3a7385d7be4b",
      "name": "Route Type?",
      "type": "n8n-nodes-base.switch",
      "typeVersion": 3,
      "position": [
        5136,
        10096
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "id": "cr-1",
              "leftValue": "={{ $('Sanitize Inputs').item.json.content_route }}",
              "rightValue": "trend",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "e86d2891-76ce-4bb6-98a4-64bdfa65ef67",
      "name": "Content Route?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.1,
      "position": [
        5472,
        9744
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.tavily.com/search",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ api_key: $env.TAVILY_API_KEY, query: \"architectural lighting industry trends 2026 Saudi Arabia Vision 2030 LinkedIn B2B\", search_depth: \"basic\", max_results: 5, include_answer: true }) }}",
        "options": {}
      },
      "id": "d80fa34b-ac95-4aa3-beeb-70efa564ddbf",
      "name": "Tavily: Trend Search",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        5712,
        9616
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-5\",\n  \"max_tokens\": 1500,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a LinkedIn content strategist for Arak Lighting — Saudi Arabia's leading architectural lighting company with 45+ years of experience. Notable projects: Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh, major Vision 2030 developments.\\n\\nAudience: architects, interior designers, real estate developers, hospitality directors, procurement managers, and C-suite executives across the GCC.\\n\\nCURRENT INDUSTRY TRENDS:\\n{{ $json.answer || '' }}\\n\\nTONE: {{ $('Sanitize Inputs').item.json.tone }}\\nPOST TYPE: {{ $('Sanitize Inputs').item.json.post_type }}\\n\\nTONE GUIDE:\\n- thought_leader: authoritative insights, industry expertise, forward-looking\\n- executive: formal, strategic, C-suite peers\\n- technical_expert: precise, data-driven, specs and performance\\n- warm_human: personal storytelling, behind-the-scenes authenticity\\n- promotional: achievement-focused, project showcases, milestones\\n\\nLINKEDIN POST RULES:\\n1. HOOK (first line, max 12 words): bold, surprising, or curiosity-provoking. Shows before 'see more'.\\n2. BODY: 150-250 words, line breaks every 2-3 sentences. Numbered lists or bullets sparingly.\\n3. CTA: end with a genuine question to spark comments.\\n4. HASHTAGS: exactly 4-5 — NOT in body, separate field.\\n5. No clichés: no 'In today's fast-paced world', no 'We are excited to announce'.\\n\\nWrite a LinkedIn post based on the trends. Return ONLY valid JSON, no markdown:\\n{\\\"hook\\\": \\\"first line only\\\", \\\"body\\\": \\\"post body after hook, line breaks as \\\\n\\\", \\\"hashtags\\\": \\\"#ArakLighting #ArchitecturalLighting [3 more]\\\", \\\"image_prompt\\\": \\\"detailed prompt for professional LinkedIn visual, max 80 words, wide 1.91:1\\\", \\\"trending_angle\\\": \\\"one sentence on what trend this taps\\\"}\"\n  }]\n}",
        "options": {}
      },
      "id": "f395c8fa-24a3-4335-8e77-0d8c2d0ec6d2",
      "name": "Claude: Trend Post",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        5952,
        9616
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-5\",\n  \"max_tokens\": 1500,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a LinkedIn content strategist for Arak Lighting — Saudi Arabia's leading architectural lighting company with 45+ years of experience. Notable projects: Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh, Vision 2030.\\n\\nAudience: architects, interior designers, real estate developers, hospitality directors, procurement managers, C-suite across GCC.\\n\\nTOPIC: {{ $('Sanitize Inputs').item.json.safe_topic }}\\nTONE: {{ $('Sanitize Inputs').item.json.tone }}\\nPOST TYPE: {{ $('Sanitize Inputs').item.json.post_type }}\\n\\nBRAND INSTRUCTIONS:\\n{{ $('Sanitize Inputs').item.json.safe_instructions }}\\n\\nTONE GUIDE:\\n- thought_leader: authoritative insights, forward-looking perspective\\n- executive: formal, strategic, C-suite peers\\n- technical_expert: precise, data-driven\\n- warm_human: personal storytelling, authentic\\n- promotional: achievement-focused, milestones\\n\\nPOST TYPE GUIDE:\\n- thought_leadership: big idea, contrarian take, industry insight\\n- project_case_study: specific project, measurable impact\\n- team_spotlight: people, culture, behind the scenes\\n- industry_insight: data, research, market observation\\n- milestone_award: achievement, anniversary, recognition\\n- job_opening: recruitment, culture story\\n- product_launch: new product, innovation, technical feature\\n\\nLINKEDIN POST RULES:\\n1. HOOK (first line, max 12 words): bold, surprising, curiosity-provoking.\\n2. BODY: 150-250 words, line breaks every 2-3 sentences.\\n3. CTA: genuine question for comments.\\n4. HASHTAGS: exactly 4-5 — separate field.\\n5. No clichés.\\n\\nReturn ONLY valid JSON, no markdown:\\n{\\\"hook\\\": \\\"first line only\\\", \\\"body\\\": \\\"post body after hook, line breaks as \\\\n\\\", \\\"hashtags\\\": \\\"#ArakLighting #ArchitecturalLighting [3 more]\\\", \\\"image_prompt\\\": \\\"detailed prompt for professional LinkedIn visual, max 80 words\\\", \\\"post_strategy\\\": \\\"one sentence on why this format and angle works\\\"}\"\n  }]\n}",
        "options": {}
      },
      "id": "27f228ef-2480-4584-88b4-d1ecead0ce54",
      "name": "Claude: Instructions Post",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        5824,
        9856
      ]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst clean = raw.replace(/```json|```/g,'').trim();\nlet parsed;\ntry { parsed = JSON.parse(clean); }\ncatch(e) {\n  const match = clean.match(/\\{[\\s\\S]*\\}/);\n  if (match) { try { parsed = JSON.parse(match[0]); } catch(e2) { throw new Error('Cannot parse: ' + clean.slice(0,200)); } }\n  else throw new Error('No JSON found: ' + clean.slice(0,200));\n}\nconst si = $('Sanitize Inputs').first().json;\nreturn [{json: {\n  hook:           parsed.hook || '',\n  body:           parsed.body || '',\n  hashtags:       parsed.hashtags || '#ArakLighting #ArchitecturalLighting',\n  image_prompt:   parsed.image_prompt || '',\n  trending_angle: parsed.trending_angle || '',\n  post_strategy:  parsed.post_strategy || '',\n  topic:          si.safe_topic,\n  tone:           si.tone,\n  post_type:      si.post_type,\n  style:          si.style,\n  content_route:  si.content_route,\n  include_image:  si.include_image,\n  aspect_ratio:   si.aspect_ratio,\n}}];"
      },
      "id": "70920dd6-c5f7-42a1-a0d8-d7d5f761f17e",
      "name": "Parse Post",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        6240,
        9744
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "id": "img-1",
              "leftValue": "={{ $('Sanitize Inputs').item.json.include_image }}",
              "rightValue": true,
              "operator": {
                "type": "boolean",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "bb4f6266-6f30-47c5-9312-1d7fb0dc4ca3",
      "name": "Include Image?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.1,
      "position": [
        6432,
        9744
      ]
    },
    {
      "parameters": {
        "jsCode": "const styleMap = {\n  \"photorealistic\":   \"architectural photography, Canon EOS R5, professional lighting, hyper-detailed, 4K, wide format\",\n  \"dramatic\":         \"cinematic lighting, deep shadows, high contrast, noir atmosphere, professional corporate\",\n  \"minimalist\":       \"clean lines, soft diffused light, Scandinavian aesthetic, white space, elegant\",\n  \"warm_interior\":    \"warm amber tones, luxury interior, golden hour, premium hospitality space\",\n  \"cool_commercial\":  \"cool white 5000K, modern commercial architecture, crisp, glass and steel, corporate luxury\",\n  \"facade_exterior\":  \"architectural exterior night photography, facade illumination, dramatic night sky\"\n};\nconst si = $('Sanitize Inputs').first().json;\nconst base = $('Parse Post').first().json.image_prompt || si.safe_topic || 'architectural lighting';\nconst styleStr = styleMap[si.style] || styleMap['photorealistic'];\nconst finalPrompt = base + ', ' + styleStr + ', Arak Lighting Saudi Arabia, ultra high detail, professional LinkedIn visual, wide 16:9 composition';\nreturn [{json: { final_prompt: finalPrompt, style: si.style }}];"
      },
      "id": "254bcc09-af1c-43e8-9fe6-cb7e7efa76e3",
      "name": "Build Image Prompt",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        6640,
        9600
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "wait"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"input\": {\n    \"prompt\": \"{{ $json.final_prompt }}\",\n    \"aspect_ratio\": \"{{ $('Sanitize Inputs').item.json.aspect_ratio === '1.91:1' ? '3:2' : $('Sanitize Inputs').item.json.aspect_ratio || '3:2' }}\",\n    \"output_format\": \"webp\",\n    \"output_quality\": 90,\n    \"num_outputs\": 1\n  }\n}",
        "options": {}
      },
      "id": "1b7f2f49-bdfb-45bb-bfba-1b378673084a",
      "name": "FLUX: Start Prediction",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        6848,
        9600
      ]
    },
    {
      "parameters": {
        "amount": 8
      },
      "id": "0583742e-6c05-4602-9dd5-368b79304bb3",
      "name": "Wait 8s",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [
        7040,
        9600
      ],
      "webhookId": "linkedin-manual-wait-001"
    },
    {
      "parameters": {
        "url": "=https://api.replicate.com/v1/predictions/{{ $('FLUX: Start Prediction').item.json.id }}",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            }
          ]
        },
        "options": {}
      },
      "id": "32c8753e-4ae5-40f7-986b-f2ea82306a62",
      "name": "FLUX: Poll Status",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        7264,
        9600
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "id": "ir-1",
              "leftValue": "={{ $json.status }}",
              "rightValue": "succeeded",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "538a0245-7a99-4f05-99f9-f7be8375fec3",
      "name": "Image Ready?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.1,
      "position": [
        7456,
        9600
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ success: true, route_type: \"full\", content_route: $(\"Sanitize Inputs\").item.json.content_route, hook: $(\"Parse Post\").item.json.hook, body: $(\"Parse Post\").item.json.body, hashtags: $(\"Parse Post\").item.json.hashtags, image_url: $(\"Set Permanent Image URL\").item.json.permanent_image_url, image_prompt: $(\"Parse Post\").item.json.image_prompt, trending_angle: $(\"Parse Post\").item.json.trending_angle, post_strategy: $(\"Parse Post\").item.json.post_strategy, include_image: true, supabase_id: $(\"Supabase: Save Manual Post\").item.json[0]?.id || $(\"Supabase: Save Manual Post\").item.json?.id || \"\" }) }}",
        "options": {}
      },
      "id": "0badd5ab-ef1f-4076-9d0d-78cd63fdca6a",
      "name": "Respond: Full + Image",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        8560,
        9472
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "{\"success\":false,\"error\":\"Image generation timed out. Post text is ready — try regenerating the image.\"}",
        "options": {
          "responseCode": 202
        }
      },
      "id": "e094c470-e06d-4e3d-a756-fe0a9d9f6f5a",
      "name": "Respond: Image Timeout",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        7664,
        9760
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ success: true, route_type: \"full\", content_route: $(\"Sanitize Inputs\").item.json.content_route, hook: $(\"Parse Post\").item.json.hook, body: $(\"Parse Post\").item.json.body, hashtags: $(\"Parse Post\").item.json.hashtags, image_url: null, image_prompt: $(\"Parse Post\").item.json.image_prompt, trending_angle: $(\"Parse Post\").item.json.trending_angle, post_strategy: $(\"Parse Post\").item.json.post_strategy, include_image: false }) }}",
        "options": {}
      },
      "id": "1a13eba3-fe91-470e-b6cc-50d835f892b1",
      "name": "Respond: Full No Image",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        6944,
        9840
      ]
    },
    {
      "parameters": {
        "conditions": {
          "options": {
            "caseSensitive": false,
            "leftValue": "",
            "typeValidation": "strict",
            "version": 1
          },
          "conditions": [
            {
              "id": "pr-1",
              "leftValue": "={{ $('Sanitize Inputs').item.json.content_route }}",
              "rightValue": "trend",
              "operator": {
                "type": "string",
                "operation": "equals"
              }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "5fe05313-4665-488c-a4c4-33bf44f794b2",
      "name": "Post Regen Route?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2.1,
      "position": [
        5584,
        10112
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.tavily.com/search",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Content-Type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify({ api_key: $env.TAVILY_API_KEY, query: \"architectural lighting industry trends 2026 Saudi Arabia Vision 2030 LinkedIn B2B\", search_depth: \"basic\", max_results: 5, include_answer: true }) }}",
        "options": {}
      },
      "id": "a75afdc0-949a-4b97-9f05-16f9d763600a",
      "name": "Tavily: Post Regen",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        5840,
        10048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-5\",\n  \"max_tokens\": 1500,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a LinkedIn content strategist for Arak Lighting, Saudi Arabia's leading architectural lighting company.\\n\\nLATEST TRENDS: {{ $json.answer }}\\nTONE: {{ $('Sanitize Inputs').item.json.tone }}\\n\\nCURRENT POST (write COMPLETELY DIFFERENT — different hook, angle, structure):\\n{{ $('Sanitize Inputs').item.json.safe_current_post }}\\n\\nWrite a fresh LinkedIn post. End with an engaging question.\\n\\nReturn ONLY JSON, no markdown: {\\\"hook\\\": \\\"new bold hook, max 12 words\\\", \\\"body\\\": \\\"full body, line breaks as \\\\n\\\", \\\"hashtags\\\": \\\"#ArakLighting [4 tags total\\\"}\"\n  }]\n}",
        "options": {}
      },
      "id": "3a167c25-6b46-4b02-8fde-113981a84ac7",
      "name": "Claude: Post Regen Trend",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        6080,
        10048
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-sonnet-5\",\n  \"max_tokens\": 1500,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a LinkedIn content strategist for Arak Lighting, Saudi Arabia's leading architectural lighting company.\\n\\nTOPIC: {{ $('Sanitize Inputs').item.json.safe_topic }}\\nTONE: {{ $('Sanitize Inputs').item.json.tone }}\\nINSTRUCTIONS: {{ $('Sanitize Inputs').item.json.safe_instructions }}\\n\\nCURRENT POST (write COMPLETELY DIFFERENT):\\n{{ $('Sanitize Inputs').item.json.safe_current_post }}\\n\\nWrite a fresh LinkedIn post with a different hook and angle. End with an engaging question.\\n\\nReturn ONLY JSON, no markdown: {\\\"hook\\\": \\\"new bold hook, max 12 words\\\", \\\"body\\\": \\\"full body, line breaks as \\\\n\\\", \\\"hashtags\\\": \\\"#ArakLighting [4 tags total\\\"}\"\n  }]\n}",
        "options": {}
      },
      "id": "ea559b83-c3ea-4d61-b0a9-caff355d8bfb",
      "name": "Claude: Post Regen Instr",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        5968,
        10272
      ]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst clean = raw.replace(/```json|```/g,'').trim();\nlet parsed;\ntry { parsed = JSON.parse(clean); }\ncatch(e) {\n  const match = clean.match(/\\{[\\s\\S]*\\}/);\n  parsed = match ? JSON.parse(match[0]) : {hook: '', body: clean, hashtags: '#ArakLighting'};\n}\nreturn [{json: { hook: parsed.hook || '', body: parsed.body || '', hashtags: parsed.hashtags || '#ArakLighting' }}];"
      },
      "id": "c15f9973-62e4-4bb4-9544-77c930f52132",
      "name": "Parse Post Regen",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        6352,
        10144
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ success: true, route_type: \"post_only\", hook: $(\"Parse Post Regen\").item.json.hook, body: $(\"Parse Post Regen\").item.json.body, hashtags: $(\"Parse Post Regen\").item.json.hashtags }) }}",
        "options": {}
      },
      "id": "95d90647-175d-4e02-a268-b57b513e74a5",
      "name": "Respond: Post Regen",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        6592,
        10144
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-haiku-4-5-20251001\",\n  \"max_tokens\": 300,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are an expert at writing image generation prompts for professional LinkedIn visuals.\\n\\nTOPIC: {{ $('Sanitize Inputs').item.json.safe_topic || 'architectural lighting' }}\\nORIGINAL PROMPT: {{ $('Sanitize Inputs').item.json.image_prompt }}\\nTARGET STYLE: {{ $('Sanitize Inputs').item.json.style }}\\n\\nSTYLE DEFINITIONS:\\n- photorealistic: Canon EOS R5 professional photography, architectural, hyper-detailed\\n- dramatic: cinematic deep shadows, high contrast, corporate noir\\n- minimalist: clean lines, soft light, elegant white space\\n- warm_interior: warm amber 2700K, luxury interior, golden hour\\n- cool_commercial: cool white 5000K, modern glass and steel, corporate luxury\\n- facade_exterior: architectural exterior night, facade illumination\\n\\nRewrite for the target style. LinkedIn visuals should look authoritative and credible. Wide 1.91:1 format.\\n\\nReturn ONLY the prompt text. Max 100 words.\"\n  }]\n}",
        "options": {}
      },
      "id": "afe03ed1-b823-483b-8250-ba6021c71af6",
      "name": "Claude: Rewrite Image Prompt",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        5616,
        10464
      ]
    },
    {
      "parameters": {
        "jsCode": "const rewritten = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst si = $('Sanitize Inputs').first().json;\nconst base = rewritten.trim() || si.image_prompt || 'architectural lighting Saudi Arabia';\nconst finalPrompt = base + ', Arak Lighting Saudi Arabia, ultra high detail, professional LinkedIn visual, wide 16:9 composition';\nreturn [{json: { final_prompt: finalPrompt }}];"
      },
      "id": "7f2c4a87-bc17-40c6-a320-dbe77249f717",
      "name": "Build Regen Image Prompt",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        5856,
        10464
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "wait"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"input\": {\n    \"prompt\": \"{{ $json.final_prompt }}\",\n    \"aspect_ratio\": \"3:2\",\n    \"output_format\": \"webp\",\n    \"output_quality\": 90,\n    \"num_outputs\": 1\n  }\n}",
        "options": {}
      },
      "id": "4a55664c-8b8e-48a5-a7c0-bef7709a8a45",
      "name": "FLUX: Regen Image",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        6096,
        10464
      ]
    },
    {
      "parameters": {
        "amount": 8
      },
      "id": "a7bd3061-38ed-4952-9c69-412fcc4b5762",
      "name": "Wait 8s (Regen)",
      "type": "n8n-nodes-base.wait",
      "typeVersion": 1.1,
      "position": [
        6336,
        10464
      ],
      "webhookId": "linkedin-manual-wait-002"
    },
    {
      "parameters": {
        "url": "=https://api.replicate.com/v1/predictions/{{ $('FLUX: Regen Image').item.json.id }}",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.REPLICATE_API_TOKEN }}"
            }
          ]
        },
        "options": {}
      },
      "id": "b8446421-a25a-4565-8519-35b6df90fe08",
      "name": "FLUX: Poll Regen",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        6576,
        10464
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ success: true, route_type: \"image_only\", image_url: $(\"Set Permanent Image URL (Regen)\").item.json.permanent_image_url }) }}",
        "options": {}
      },
      "id": "bb6ca0c8-fa3f-4853-a2cc-8e4e6cc236dc",
      "name": "Respond: Image Only",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        7632,
        10464
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://api.anthropic.com/v1/messages",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "x-api-key",
              "value": "={{ $env.ANTHROPIC_API_KEY }}"
            },
            {
              "name": "anthropic-version",
              "value": "2023-06-01"
            },
            {
              "name": "content-type",
              "value": "application/json"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={\n  \"model\": \"claude-haiku-4-5-20251001\",\n  \"max_tokens\": 800,\n  \"messages\": [{\n    \"role\": \"user\",\n    \"content\": \"You are a LinkedIn content expert for Arak Lighting, Saudi Arabia's leading architectural lighting company.\\n\\nTOPIC: {{ $('Sanitize Inputs').item.json.safe_topic }}\\nNEW TONE: {{ $('Sanitize Inputs').item.json.tone }}\\nCURRENT HOOK:\\n{{ $('Sanitize Inputs').item.json.current_hook }}\\nCURRENT BODY:\\n{{ $('Sanitize Inputs').item.json.current_body }}\\n\\nRewrite to match the new tone. Tone guide: thought_leader=authoritative and insightful, executive=formal and strategic, technical_expert=precise and data-driven, warm_human=personal storytelling, promotional=achievement-focused. Keep core message and hashtags identical.\\n\\nReturn ONLY valid JSON, no markdown: {\\\"hook\\\": \\\"rewritten hook\\\", \\\"body\\\": \\\"rewritten body with \\\\n line breaks\\\", \\\"hashtags\\\": \\\"same hashtags\\\"}\"\n  }]\n}",
        "options": {}
      },
      "id": "07024158-fc3f-4335-b793-a24054bfc669",
      "name": "Claude: Tone Sync",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        5616,
        10704
      ]
    },
    {
      "parameters": {
        "jsCode": "const raw = $input.first().json.content?.find(b=>b.type==='text')?.text || '';\nconst clean = raw.replace(/```json|```/g,'').trim();\nlet parsed;\ntry { parsed = JSON.parse(clean); }\ncatch(e) {\n  const match = clean.match(/\\{[\\s\\S]*\\}/);\n  parsed = match ? JSON.parse(match[0]) : {hook: '', body: clean, hashtags: '#ArakLighting'};\n}\nreturn [{json: { hook: parsed.hook || '', body: parsed.body || '', hashtags: parsed.hashtags || '#ArakLighting' }}];"
      },
      "id": "d36a53cc-0ddd-422b-bdea-7db993f6eb41",
      "name": "Parse Tone Sync",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [
        5856,
        10704
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ success: true, route_type: \"tone_sync\", hook: $(\"Parse Tone Sync\").item.json.hook, body: $(\"Parse Tone Sync\").item.json.body, hashtags: $(\"Parse Tone Sync\").item.json.hashtags }) }}",
        "options": {}
      },
      "id": "5e26fe2f-43f4-4a89-be54-09673da3c6ec",
      "name": "Respond: Tone Sync",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        6096,
        10704
      ]
    },
    {
      "parameters": {
        "respondWith": "json",
        "responseBody": "{\"success\":false,\"error\":\"Invalid route_type. Use: full, post_only, image_only, or tone_sync\"}",
        "options": {
          "responseCode": 400
        }
      },
      "id": "c2e222a5-75c6-4fd2-b6f1-bb0283afcdc2",
      "name": "Respond: Bad Route",
      "type": "n8n-nodes-base.respondToWebhook",
      "typeVersion": 1.1,
      "position": [
        5616,
        10896
      ]
    },
    {
      "parameters": {
        "url": "={{ $('FLUX: Poll Status').item.json.output?.[0] }}",
        "options": {}
      },
      "id": "8c04223a-e156-4e75-a0a3-2dc7e6437240",
      "name": "Download from Replicate",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        7664,
        9472
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/linkedin-posts/{{ $now.toMillis() }}-.webp",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "image/webp"
            },
            {
              "name": "x-upsert",
              "value": "true"
            }
          ]
        },
        "sendBody": true,
        "contentType": "binaryData",
        "inputDataFieldName": "data",
        "options": {}
      },
      "id": "029cb068-702b-440f-9033-c0c9f7192763",
      "name": "Upload to Supabase Storage",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        7888,
        9472
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "linkedin-spu-1",
              "name": "permanent_image_url",
              "type": "string",
              "value": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/public/linkedin-posts/{{ $('Upload to Supabase Storage').item.json.Key.split('/').pop() }}"
            },
            {
              "id": "linkedin-spu-2",
              "name": "replicate_url",
              "type": "string",
              "value": "={{ $('FLUX: Poll Status').item.json.output?.[0] }}"
            }
          ]
        },
        "options": {}
      },
      "id": "c0c899fe-bc24-488e-82e1-d878368d0715",
      "name": "Set Permanent Image URL",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        8128,
        9472
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/rest/v1/linkedin_manual_posts",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "return=representation"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={ \"topic\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.safe_topic) }}, \"hook\": {{ JSON.stringify($(\"Parse Post\").item.json.hook) }}, \"body\": {{ JSON.stringify($(\"Parse Post\").item.json.body) }}, \"hashtags\": {{ JSON.stringify($(\"Parse Post\").item.json.hashtags) }}, \"image_url\": {{ JSON.stringify($(\"Set Permanent Image URL\").item.json.permanent_image_url) }}, \"image_prompt\": {{ JSON.stringify($(\"Parse Post\").item.json.image_prompt) }}, \"post_strategy\": {{ JSON.stringify($(\"Parse Post\").item.json.post_strategy) }}, \"trending_angle\": {{ JSON.stringify($(\"Parse Post\").item.json.trending_angle) }}, \"tone\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.tone) }}, \"style\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.style) }}, \"aspect_ratio\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.aspect_ratio) }}, \"post_type\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.post_type) }}, \"content_route\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.content_route) }}, \"include_image\": true, \"status\": \"pending_review\", \"source\": \"manual\" }",
        "options": {}
      },
      "id": "dd8d9095-a79a-4111-b2f0-4baf3b85fe8e",
      "name": "Supabase: Save Manual Post",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        8336,
        9472
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/rest/v1/linkedin_manual_posts",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "application/json"
            },
            {
              "name": "Prefer",
              "value": "return=minimal"
            }
          ]
        },
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={ \"topic\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.safe_topic) }}, \"hook\": {{ JSON.stringify($(\"Parse Post\").item.json.hook) }}, \"body\": {{ JSON.stringify($(\"Parse Post\").item.json.body) }}, \"hashtags\": {{ JSON.stringify($(\"Parse Post\").item.json.hashtags) }}, \"image_url\": null, \"post_strategy\": {{ JSON.stringify($(\"Parse Post\").item.json.post_strategy) }}, \"tone\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.tone) }}, \"content_route\": {{ JSON.stringify($(\"Sanitize Inputs\").item.json.content_route) }}, \"include_image\": false, \"status\": \"pending_review\", \"source\": \"manual\" }",
        "options": {}
      },
      "id": "4ee46dd0-c41a-4a18-955a-5742d30f9f08",
      "name": "Supabase: Save Manual Post (No Image)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        6736,
        9840
      ]
    },
    {
      "parameters": {
        "url": "={{ $('FLUX: Poll Regen').item.json.output?.[0] }}",
        "options": {}
      },
      "id": "09900ff2-31ec-437c-aca3-5b6fed0bd5ac",
      "name": "Download from Replicate (Regen)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        6848,
        10464
      ]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/linkedin-posts/{{ $now.toMillis() }}-.webp",
        "sendHeaders": true,
        "headerParameters": {
          "parameters": [
            {
              "name": "apikey",
              "value": "={{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Authorization",
              "value": "=Bearer {{ $env.SUPABASE_KEY }}"
            },
            {
              "name": "Content-Type",
              "value": "image/webp"
            },
            {
              "name": "x-upsert",
              "value": "true"
            }
          ]
        },
        "sendBody": true,
        "contentType": "binaryData",
        "inputDataFieldName": "data",
        "options": {}
      },
      "id": "22dc9878-bded-4673-9311-1df0c6413d88",
      "name": "Upload to Supabase Storage (Regen)",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [
        7072,
        10464
      ]
    },
    {
      "parameters": {
        "assignments": {
          "assignments": [
            {
              "id": "li-rsu-1",
              "name": "permanent_image_url",
              "type": "string",
              "value": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/public/linkedin-posts/{{ $('Upload to Supabase Storage (Regen)').item.json.Key.split('/').pop() }}"
            }
          ]
        },
        "options": {}
      },
      "id": "abcce7ad-665e-4c26-9a54-464e815e8987",
      "name": "Set Permanent Image URL (Regen)",
      "type": "n8n-nodes-base.set",
      "typeVersion": 3.4,
      "position": [
        7312,
        10464
      ]
    }
  ],
  "connections": {
    "Webhook": {
      "main": [
        [
          {
            "node": "Sanitize Inputs",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Sanitize Inputs": {
      "main": [
        [
          {
            "node": "Route Type?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Route Type?": {
      "main": [
        [
          {
            "node": "Content Route?",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Post Regen Route?",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Claude: Rewrite Image Prompt",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Claude: Tone Sync",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Respond: Bad Route",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Content Route?": {
      "main": [
        [
          {
            "node": "Tavily: Trend Search",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Claude: Instructions Post",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Tavily: Trend Search": {
      "main": [
        [
          {
            "node": "Claude: Trend Post",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Trend Post": {
      "main": [
        [
          {
            "node": "Parse Post",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Instructions Post": {
      "main": [
        [
          {
            "node": "Parse Post",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Parse Post": {
      "main": [
        [
          {
            "node": "Include Image?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Include Image?": {
      "main": [
        [
          {
            "node": "Build Image Prompt",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Supabase: Save Manual Post (No Image)",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Build Image Prompt": {
      "main": [
        [
          {
            "node": "FLUX: Start Prediction",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Start Prediction": {
      "main": [
        [
          {
            "node": "Wait 8s",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wait 8s": {
      "main": [
        [
          {
            "node": "FLUX: Poll Status",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Poll Status": {
      "main": [
        [
          {
            "node": "Image Ready?",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Image Ready?": {
      "main": [
        [
          {
            "node": "Download from Replicate",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Respond: Image Timeout",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Post Regen Route?": {
      "main": [
        [
          {
            "node": "Tavily: Post Regen",
            "type": "main",
            "index": 0
          }
        ],
        [
          {
            "node": "Claude: Post Regen Instr",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Tavily: Post Regen": {
      "main": [
        [
          {
            "node": "Claude: Post Regen Trend",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Post Regen Trend": {
      "main": [
        [
          {
            "node": "Parse Post Regen",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Post Regen Instr": {
      "main": [
        [
          {
            "node": "Parse Post Regen",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Parse Post Regen": {
      "main": [
        [
          {
            "node": "Respond: Post Regen",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Rewrite Image Prompt": {
      "main": [
        [
          {
            "node": "Build Regen Image Prompt",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Build Regen Image Prompt": {
      "main": [
        [
          {
            "node": "FLUX: Regen Image",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Regen Image": {
      "main": [
        [
          {
            "node": "Wait 8s (Regen)",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Wait 8s (Regen)": {
      "main": [
        [
          {
            "node": "FLUX: Poll Regen",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "FLUX: Poll Regen": {
      "main": [
        [
          {
            "node": "Download from Replicate (Regen)",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Claude: Tone Sync": {
      "main": [
        [
          {
            "node": "Parse Tone Sync",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Parse Tone Sync": {
      "main": [
        [
          {
            "node": "Respond: Tone Sync",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Download from Replicate": {
      "main": [
        [
          {
            "node": "Upload to Supabase Storage",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Upload to Supabase Storage": {
      "main": [
        [
          {
            "node": "Set Permanent Image URL",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Permanent Image URL": {
      "main": [
        [
          {
            "node": "Supabase: Save Manual Post",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Supabase: Save Manual Post": {
      "main": [
        [
          {
            "node": "Respond: Full + Image",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Supabase: Save Manual Post (No Image)": {
      "main": [
        [
          {
            "node": "Respond: Full No Image",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Download from Replicate (Regen)": {
      "main": [
        [
          {
            "node": "Upload to Supabase Storage (Regen)",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Upload to Supabase Storage (Regen)": {
      "main": [
        [
          {
            "node": "Set Permanent Image URL (Regen)",
            "type": "main",
            "index": 0
          }
        ]
      ]
    },
    "Set Permanent Image URL (Regen)": {
      "main": [
        [
          {
            "node": "Respond: Image Only",
            "type": "main",
            "index": 0
          }
        ]
      ]
    }
  },
  "active": false,
  "settings": {
    "executionOrder": "v1"
  },
  "tags": []
}""")

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
#   gpt-image-2 / gpt-image-2/edit-image   ("ChatGPT" to the marketing team)   — 2026-08-09
#   nano-banana-2 / nano-banana-2/edit     ("Gemini")                          — 2026-08-09
#   bytedance/seedance-2.0/{image,text}-to-video                              — 2026-08-10
# ============================================================

# Shared preamble: n8n's httpRequest helper throws its own generic "status
# code 400" before our code can read the provider's actual error body, which
# on a failed card is indistinguishable between a bad prompt, an expired key
# and an exhausted balance — the last of which actually happened here. Dig the
# real message out of every shape the error can take.
_CREATIVE_REQ_JS = r"""
const http = this.helpers.httpRequest;
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
  if (instructions) p += '\n\nBRAND CONTEXT:\n' + instructions;
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
  const endpoint = useEdit ? 'fal-ai/gpt-image-2/edit-image' : 'fal-ai/gpt-image-2';
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
    const r = await req({ method:'POST', url:'https://fal.run/fal-ai/gpt-image-2/edit-image',
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
    build(imageUrl) {
      const input = { prompt, duration, resolution, generate_audio: generateAudio, aspect_ratio: aspect };
      if (imageUrl) input.image_url = imageUrl;
      return input;
    },
  },
  'seedance-2.5': {
    i2v: 'bytedance/seedance-2.5/image-to-video',
    t2v: 'bytedance/seedance-2.5/text-to-video',
    build(imageUrl) {
      const input = { prompt, duration, resolution, generate_audio: generateAudio, aspect_ratio: aspect };
      if (imageUrl) input.image_url = imageUrl;
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

// Seedance 2.0's aspect_ratio enum is auto/21:9/16:9/4:3/3:4/1:1/9:16 — no
// 4:5 bucket, same gap gpt-image-2 has on the image side. 3:4 is the nearest
// (slightly taller); everything else in the Studio's own RATIOS list maps
// straight through.
const ASPECT_MAP = { '4:5': '3:4' };
function mapAspect(a) { return ASPECT_MAP[a] || a || 'auto'; }

const body = ($input.first().json.body) || {};
const sessionId = body.session_id || '';
const versionId = body.version_id || '';
const imageUrl  = body.image_url || '';       // absent => text-to-video
const prompt    = String(body.prompt || '').trim();
const duration  = String(body.duration || '5');
const aspect    = mapAspect(body.aspect_ratio);
const resolution = body.resolution || '720p';
// Off unless asked: a model inventing ambient sound under a brand asset is a
// liability, not a bonus (CREATIVE-STUDIO.md, 2026-08-10 provider review).
const generateAudio = body.generate_audio === true;
// Falls back to Seedance 2.0 for any request that predates the model picker
// (or names one this workflow doesn't recognise) rather than failing outright.
const cfg = MODEL_CONFIGS[body.model] || MODEL_CONFIGS['seedance-2'];

async function run(){
  if (!prompt) throw new Error('No direction given for the video.');

  // Both modes live in one workflow because a session may be image-then-video
  // OR video-only, and the team works both ways — an image is an optional
  // starting point, not a prerequisite.
  const model = imageUrl ? cfg.i2v : cfg.t2v;
  const input = cfg.build(imageUrl);

  const submit = await req({ method:'POST', url:'https://queue.fal.run/' + model,
    headers:{ Authorization:'Key ' + FAL, 'Content-Type':'application/json' }, body: input, json:true });
  const requestId = submit.request_id;
  if (!requestId) throw new Error('fal did not return a request_id: ' + JSON.stringify(submit).slice(0, 250));

  const statusUrl = 'https://queue.fal.run/' + model + '/requests/' + requestId + '/status';
  const resultUrl = 'https://queue.fal.run/' + model + '/requests/' + requestId;

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
  if (!videoUrl) throw new Error('fal returned no video URL: ' + JSON.stringify(result).slice(0, 250));

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

CREATIVE_ENHANCE_JS = _CREATIVE_REQ_JS + r"""
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
const IMAGE_RULES = `You rewrite rough image briefs into precise prompts for an AI image generator, for Arak Lighting — Saudi Arabia's leading architectural lighting company (45+ years; Solitaire Mall, King Fahad Airport, Ritz Carlton Riyadh).

Rules, in priority order:

1. NEVER change the subject. Elaborate what the requester actually asked for. Do not substitute a different idea, setting or mood, however much better it would be.
2. Do NOT put text, lettering, captions or typography in the image unless the requester explicitly asked for it. Words are added afterwards as a real editable text layer, so an image generated with baked-in text is unusable. If they DID ask for text in the scene, quote their exact string verbatim (Arabic included, character for character) and add: render this text exactly — no other text anywhere in the image.
3. Add the concrete lighting detail a photographer would need: colour temperature (2700K warm through 4000K neutral to 5000K cool), fixture type and technique (grazing, wall-wash, cove, linear, uplight, downlight, backlight), beam quality, time of day, and how the light reads across the specific materials in frame.
4. Fill gaps only. Add lighting, framing, lens, materials and colour temperature. Leave subject, setting and mood exactly as stated. If a detail was not implied by the requester, do not invent it.
5. 60–120 words. Do not pad to reach a length; a brief that needed little may come back short.
6. Write flowing descriptive prose, not a keyword list.

Output the prompt text only. No preamble, no quotes, no markdown, no explanation.`;

const MOTION_RULES = `You rewrite rough animation notes into motion prompts for an AI image-to-video model (Seedance, 2–12 second clips), for Arak Lighting.

The still image already exists. Rules:

1. Describe CAMERA MOVEMENT AND MOTION ONLY. Do not re-describe the subject, the lighting or the setting — they are already in the frame, and restating them fights the source image.
2. One movement, paced to the clip length. A 5-second clip gets one slow move, not three.
3. House style: slow cinematic pan, gentle dolly in, subtle parallax, soft light bloom, drifting shadow.
4. Never mention text, captions or titles. Text is composited onto the finished clip afterwards.
5. Maximum 40 words.

Output the prompt text only. No preamble, no quotes, no markdown.`;

const cachedPrefix = (mode === 'motion' ? MOTION_RULES : IMAGE_RULES)
  + (instructions ? '\n\nBRAND CONTEXT:\n' + instructions : '');

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
  const out = String((textBlock && textBlock.text) || '').trim().replace(/^["']|["']$/g, '');
  if (!out) throw new Error('The model returned an empty prompt.');

  return [{ json: { ok: true, prompt: out, mode } }];
} catch (err) {
  return [{ json: { ok: false, error: (err && err.message) ? err.message : String(err) } }];
}
"""


def _http_creative_upload(source_node: str, mime: str, name: str, x: int, y: int) -> dict:
    """Binary upload to the creative-studio bucket.

    The bytes cannot be uploaded from inside the Code node: httpRequest is
    proxied to n8n's main process as one JSON.stringify'd message, and a
    Buffer nested inside the options object is never reconstructed — it
    arrives as the literal text '{"type":"Buffer","data":[...]}'. Only
    prepareBinaryData (a top-level RPC argument) survives, so the Code node
    prepares and this real HTTP node, running in the main process, uploads.
    """
    return {
        "parameters": {
            "method": "POST",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}/storage/v1/object/{{ $json.bucket }}/{{ $json.filename }}",
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
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_creative_save(source_node: str, media_field: str, name: str, x: int, y: int) -> dict:
    """PATCH the version row to 'ready' with its now-permanent public URL.

    Reads `source_node` rather than this node's own input for the same reason
    Supabase: Save Video URL does — an HTTP node's json is the upload
    response, not the upstream item, so bucket/filename/version_id have to
    come from the Code node by paired-item lookup.
    """
    ref = f"$('{source_node}').item.json"
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
        "id": nid(),
        "name": name,
        "type": "n8n-nodes-base.httpRequest",
        "typeVersion": 4.2,
        "position": [x, y],
    }


def _http_creative_fail(name: str, x: int, y: int) -> dict:
    """PATCH the version row to 'failed' with the real provider message.

    Without this branch a failed generation leaves the card spinning forever
    with nothing to explain it — which is exactly how an exhausted fal balance
    would present to the marketing team.
    """
    return {
        "parameters": {
            "method": "PATCH",
            "url": "={{ String($env.SUPABASE_URL).replace(/\\/+$/, '') }}"
                   "/rest/v1/creative_versions?id=eq.{{ $json.version_id }}",
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
            "jsonBody": "={{ JSON.stringify({ status: 'failed', error: String($json.error || 'Generation failed.') }) }}",
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
{ session_id, version_id, prompt, model?, image_url?, duration?, aspect_ratio?,
  resolution?, generate_audio? }
```

`image_url` present → image-to-video; absent → text-to-video, because a
session may be image-only, video-only, or image-then-video.

`model` selects the fal endpoint via MODEL_CONFIGS at the top of the Code
node — unrecognised or missing values fall back to 'seedance-2'. Each
model's `build()` there knows its own accepted inputs (Kling and Hailuo take
neither `resolution` nor `aspect_ratio`; Veo's `duration` needs an 's' suffix),
so the caller doesn't have to. `generate_audio` defaults false — free on
Seedance, billed separately on Veo, absent on Kling/Hailuo. `aspect_ratio`
has no exact 4:5 bucket (nearest is 3:4) — same gap as gpt-image-2 on the
image side, and only applies to the models that take it at all.

Add a model by adding one entry to MODEL_CONFIGS — nothing else in the
workflow is model-specific.

Needs env: FAL_KEY, SUPABASE_URL, SUPABASE_KEY."""


def _build_creative_workflow(name, webhook_path, sticky, js, code_node_name,
                             mime, media_field, accepted_expr) -> dict:
    """The shape all three Creative Studio workflows share:

    Webhook -> Respond: Accepted -> <Code> -> OK? -> (yes) Upload -> Save
                                                  -> (no)  Mark Failed
    """
    nodes = [
        _sticky(sticky, height=360, width=460, x=0, y=-180),
        _webhook(webhook_path, "responseNode", x=0, y=300),
        _respond_json("Respond: Accepted", accepted_expr, x=220, y=300),
        _code(code_node_name, js, x=440, y=300),
        _if_bool_equals("Generated OK?", "creative-gate-1", "={{ $json._ok === true }}", x=660, y=300),
        _http_creative_upload(code_node_name, mime, "Upload to Supabase Storage", x=880, y=200),
        _http_creative_save(code_node_name, media_field, "Supabase: Save Version", x=1100, y=200),
        _http_creative_fail("Supabase: Mark Failed", x=880, y=400),
    ]
    connections = {
        "Webhook": {"main": [[{"node": "Respond: Accepted", "type": "main", "index": 0}]]},
        "Respond: Accepted": {"main": [[{"node": code_node_name, "type": "main", "index": 0}]]},
        code_node_name: {"main": [[{"node": "Generated OK?", "type": "main", "index": 0}]]},
        "Generated OK?": {
            "main": [
                [{"node": "Upload to Supabase Storage", "type": "main", "index": 0}],
                [{"node": "Supabase: Mark Failed", "type": "main", "index": 0}],
            ]
        },
        "Upload to Supabase Storage": {"main": [[{"node": "Supabase: Save Version", "type": "main", "index": 0}]]},
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


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "workflows")
    os.makedirs(out_dir, exist_ok=True)

    workflows = [
        build_instagram(),
        build_linkedin(),
        build_caption_studio(),
        build_elongate_idea(),
        build_draft_copy(),
        build_media_options(),
        build_video_render(),
        build_campaign_planner(),
        build_instagram_reels(),
        build_instagram_manual_generation(),
        build_linkedin_manual_generation(),
        build_zernio_publish(),
        build_zernio_sync(),
        build_zernio_dashboard(),
        build_creative_generate(),
        build_creative_edit(),
        build_creative_video(),
        build_creative_enhance(),
    ]

    for wf in workflows:
        _assign_deterministic_ids(wf)
        out_path = os.path.join(out_dir, f"{wf['name']}.json")
        with open(out_path, "w") as f:
            json.dump(wf, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"wrote {out_path}")
