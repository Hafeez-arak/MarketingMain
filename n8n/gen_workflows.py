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


def nid() -> str:
    """Fresh node id — n8n only needs these to be unique within a workflow."""
    return str(uuid.uuid4())


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
  const head = buf.toString('ascii', 0, 12);
  return head.startsWith('RIFF') && head.indexOf('WEBP') !== -1   // webp
      || (buf[0] === 0xFF && buf[1] === 0xD8)                      // jpeg
      || head.startsWith('\x89PNG');                                // png
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
  const parsed = safeJson(resp.content[0] && resp.content[0].text);
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
  const parsed = safeJson(resp.content[0] && resp.content[0].text);
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
  const parsed = safeJson(resp.content[0] && resp.content[0].text);
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
  const parsed = safeJson(resp.content[0] && resp.content[0].text);
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
        _code("Draft Copy", DRAFT_COPY_JS, x=440, y=260, run_once_for_each_item=True),
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
    ]

    for wf in workflows:
        out_path = os.path.join(out_dir, f"{wf['name']}.json")
        with open(out_path, "w") as f:
            json.dump(wf, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"wrote {out_path}")
