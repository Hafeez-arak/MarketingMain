# Creative Studio — build tracker

> Living document for the new content-generation workflow requested by the
> marketing team (2026-08-09). Update the status boxes as work lands.
> Full design: `~/.claude/plans/content-generation-workflow-indexed-moon.md`.

**What it is:** a chat-style studio where you type a prompt (optionally with a
reference image + your own comments), get **two image options side by side —
each with its own chat box** — and keep editing whichever one is going the
right way, by talking to the AI or by moving real text around in our own
editor, until it's right. Then optionally animate it. The finished asset lands
in the Media Library, tagged, ready to post.

**Two conversations, not one.** The screen isn't "choose the better image and
move on" — both candidates stay alive as separate threads with separate
histories. Type in a lane and it opens full size while the other waits as a
chip you click to get the split back. Drag an image from one chat into the
other to reuse it there: the drop asks whether it's a **reference** (look at
this) or the **new base** (work on this instead), because the gesture can
honestly mean either. Borrowing a picture never moves the conversation — the
reply always stays in the lane you typed in.

Deliberately separate from the monthly-plan pipeline for now. Wiring the two
together (using a studio asset as a planned post's media) is a later step.

---

## 🔴 Blocker — fal.ai balance is empty

Every fal endpoint returns `403 User is locked. Reason: Exhausted balance.`
**Someone needs to top up at fal.ai/dashboard/billing** before any of this —
or any Arabic-quality testing — can run.

Note this is **already breaking production today**, not just the new work:
- "Generate image options" in plan review (Media Options → fal FLUX.2) — dead.
- Video Render (fal LTX-2) — dead.

Replicate ✅ and Anthropic ✅ are both healthy, so captions and the main
Generate Post image path (Replicate FLUX) still work. That's why the outage
hasn't been obvious.

---

## Requirements → status

Numbered as the marketing team wrote them.

| # | Requirement | Phase | Status |
|---|---|---|---|
| 1 | Enter a text prompt describing the content/image | C | ☐ |
| 2 | Optionally upload a reference image + my own comments on it; AI takes *inspiration*, doesn't replicate | C | ☐ |
| 4 | Always 2 image options — one "ChatGPT", one "Gemini" — to compare | B+C | ☐ |
| 5 | Select the option I prefer | C | ☑ — and you don't have to discard the other one |
| 6 | Edit the selected image: colour / font / text changes | C (AI) + D (editor) | ☑ |
| 7 | **Accurate Arabic text on images** — top priority, bilingual Gulf content | D (+C) | ☐ |
| 8 | Keep requesting edits until happy | C | ☐ |
| 9 | Move to video generation (Higgsfield or Seedance) | E | ☑ |
| 10 | Video supports the same edits: colour / font / text | E | ☑ — free and unlimited, see below |
| 11 | Final output: ready-to-post image and/or video, accurate Arabic, no captions/analytics | C+E | ☑ |
| 12 | Video creation **from images *and* from a prompt alone** | E | ☑ — both paths already exist |
| 13 | Video length **15–30s**; sound not needed, added separately later | E | ☑ — 20s default, audio off |

Rows 12–13 are the team's 2026-08-11 clarifications, numbered on from their
original list.

- **12 needed no work.** Both paths were already built: animating a chosen
  still (`handleAnimate`) and generating straight from a description with no
  image at all (the `intent === 'video'` path, which sends an empty
  `image_url` — n8n then dispatches to the text-to-video endpoint rather than
  image-to-video). Attaching a start frame switches one to the other.
- **13 was a defaults change, not a capability gap** — Seedance 2.5 already
  reached 30s; nothing shipped it as the thing you land on. See the clip-length
  section below.

Also confirmed with the team: a session may be **image only**, **video only**,
or **image then video** — none of the three is a special case.

**✅ Requirement 10 — met, and better than asked for (2026-08-11).** The earlier
note here said this had to be renegotiated because no model can retype text
*inside* a video. That framing was wrong: it treated "edit" as one operation
when it is three, with completely different cost profiles.

- **Text, fonts, colours of text/graphics, logos, position, timing** —
  compositing, not generation. Free, instant, unlimited, deterministic, and
  bit-for-bit non-destructive to the footage.
- **Lighting, objects, weather** — in-context video editing. One generation
  each, but the take survives. **Built 2026-08-11** — see below.
- **"Something different happens in the scene"** — a full re-render.

**In-context editing, built 2026-08-11.** The original plan treated this
bucket as out of scope — no known endpoint edited a finished clip in place, so
"ask for a change" on a video either had to be a full re-render or nothing.
That assumption was wrong: fal hosts `fal-ai/kling-video/o1/video-to-video/edit`
("Kling O1 Edit"), which takes an existing clip plus a natural-language
instruction ("change the background to marble") and returns an edited clip
that keeps the source's own camera movement and motion structure. This is now
what a video lane's **chat box** does on Send — the same box used for image
edits, dispatching to the video path automatically once the thing being edited
is a clip rather than a still (`src/pages/studio/index.jsx`,
`handleVideoEdit`). Style/appearance references can be attached the same way,
up to 4 at once (fal's own cap, shared with the reference-to-video endpoint's
multi-reference UI).

Real constraint, not a choice made here: the **source clip must be 3–10
seconds**. Outside that range the button explains why and only Re-render (a
full new take) is offered — checked client-side against the row's own stored
duration before the call ever fires, so it fails with a clear message instead
of a rejected fal request. Costs $0.168/second of the *source* clip, shown on
the Send button before the click (e.g. a 10s edit is ~$1.68) — cheaper than a
Re-render because it's shaping an existing take, not buying a new one.

n8n workflow: `Arak Lighting – Creative Video Edit`, webhook
`arak-creative-video-edit` (`n8n/gen_workflows.py`,
`build_creative_video_edit()`). Same submit/poll/download shape as the
generation workflow, including the fixed queue-URL logic — this endpoint sits
behind the identical `queue.fal.run` mechanics the 2026-08-11 bug was found on.

Three of the four things the team actually listed are in the first bucket. So
the requirement is *more* deliverable than it read, not less. The clip is
generated clean, our own layer is stamped on top with local ffmpeg, and
changing an Arabic headline re-composites the same clip in about a second at no
cost — where Higgsfield would charge for a new take that comes back visibly
different.

**What to tell the marketing team:**

> Video works differently from a Photoshop file. Two categories:
>
> **Free and unlimited** — all text, fonts, colours, logos, timing and platform
> sizing. Change these as often as you like, instantly, at no cost. Your Arabic
> and English stay perfectly rendered because we place them as real text, not
> AI-generated pixels.
>
> **Costs credits** — anything happening inside the scene: lighting, objects,
> weather, or a different action. The interface shows you the price before you
> click.
>
> Clips run 4–15s; longer pieces are assembled from several.

---

## Key design decision: text should be a real layer, not AI-painted pixels

When an image model "writes" text, the letters are just coloured pixels —
there is no text object, no font, no string. Once generated you **cannot**
grab that word and move it, retype it, or change its font, in Canva or
anywhere else. You can only paint over it or ask the AI to redraw the image.

So the default workflow is:

1. **Generate the image clean** — no text, or only text that is physically
   part of the scene (a sign, a facade, a product box).
2. **Add the words in our overlay editor** as real text with a real font.

That gives, for free, the thing the team cares most about:

- **Arabic that is always correct** — a real font with real Unicode shaping,
  not a model's best guess at letterforms it may join or mirror wrongly.
- Text you can move, retype, recolour and restyle **forever**, non-destructively
  (`overlay_state` is stored as data, so reopening a version restores the
  editable boxes rather than a flattened picture).
- The brand's actual fonts.

AI text rendering is still available and Nano Banana Pro is genuinely good at
it — it's the right tool when the words must sit *in* the scene with real
perspective and lighting. It's just not the default, and it's not how we
guarantee Arabic.

**Revised after the 2026-08-09 Arabic test (see below).** The models turned out
to render Arabic correctly, so the overlay editor is no longer the *only* way
to get trustworthy Arabic — but it remains the right default, for reasons the
test doesn't touch:

- **It's the only way text stays editable.** AI text is baked pixels the
  instant it's generated. Fixing a typo means regenerating the whole image and
  accepting that everything else shifts slightly.
- **It's the only way to use Arak's real brand fonts.** A model approximates
  letterforms; it cannot be handed a licensed font file.
- **It's what makes editable text on video possible at all** (below).
- **It's free and instant**, where every AI edit costs money and a wait.

So: offer both, and be honest about the trade. AI-painted text when the words
should sit *inside* the scene with real perspective and lighting — a sign, a
facade, an engraved plate. Overlay text for headlines, captions and anything
that might change. That's a stronger product than either alone, and it is what
should be put to the marketing team.

### ✅ Clip length — 15–30s in one call (resolved 2026-08-11)

**The warning that used to sit here is obsolete.** It was written 2026-08-09
against Seedance 1.0 Pro (12s max) and concluded a 30s reel had to be stitched
from 2–3 clips. Seedance **2.5** reaches **30s in a single call**, so the
stitch step, the visible joins and the whole chaining problem simply don't
arise. Nothing was built to solve it because nothing needed to be.

| Model | Max single clip |
|---|---|
| Veo 3.1 Fast | 8s |
| Kling 2.5 Turbo | 10s |
| Seedance 2.0 | 15s |
| **Seedance 2.5** (default) | **30s** (720p ceiling) |

The team asked for **15–30s** finished videos, so a fresh render now starts on
**Seedance 2.5 at 20s**, the middle of that band (`videoModels.js`,
`DEFAULT_VIDEO_MODEL` in `src/pages/studio/index.jsx`). The defaults are read
from the model catalog rather than repeated as literals, because `pickModel`
already resets length/quality to the chosen model's own defaults — hardcoding
them in the page too would mean switching model and back handed you different
settings than you started with.

**The trade, stated plainly:** 2.5 has no 1080p tier, so 15–30s costs us the
sharpest quality setting. That is the right way round — length is a hard
requirement from the team, 1080p is a preference, and the Arabic text layer is
composited by us afterwards at whatever resolution the clip came back at, so
the text stays crisp regardless. For a short, premium 1080p piece, Seedance
2.0 is still in the picker and still goes to 15s.

`end_image_url` remains wired (start/end frame boxes on the video tab) — now
for deliberate framing rather than as a workaround for a length ceiling.

### …which also solves requirement 10 (editable text on video) — built 2026-08-11

**Built, and with local ffmpeg rather than `ffmpeg-api/compose`.** The open
question below ("does compose honour a transparent overlay track?") is now moot:
we run ffmpeg ourselves inside the n8n container, which costs nothing per
composite. That matters more than convenience — if every text tweak were a paid
API call, "free and unlimited typography" would be a false promise, and that
promise is the whole reason this beats Higgsfield.


Because the text was never baked into the image, it doesn't have to be baked
into the video either. The sequence becomes:

1. Animate the **clean** image (Seedance) → a clean video, generated once.
2. The overlay editor exports the text layer as a **full-frame transparent
   PNG** at video resolution.
3. `fal-ai/ffmpeg-api/compose` overlays that PNG onto the video track.

Change the wording, the font or the colour and we re-export the PNG and
re-composite — **seconds, and the underlying video is bit-for-bit the same
clip**. Compare that with re-generating the video, which takes minutes and
comes back a visibly different clip every time.

Arabic is safe here for the same reason as on images: the browser renders the
text (perfect shaping, real fonts) and ffmpeg only ever composites a finished
PNG, so ffmpeg's notoriously unreliable Arabic `drawtext` handling never
enters the picture.

⏳ Needs verifying once credits are in: whether `ffmpeg-api/compose` honours a
transparent overlay track. Fallback if not — we control the n8n Docker image
(`n8n/docker/docker-compose.yml`), so a custom image with ffmpeg + an Execute
Command node does the same composite locally at zero per-render cost.

### "Can we auto-convert a flat image into editable layers?" — partly

Worth knowing, since it came up. Honest state of the art:

- **Text specifically: yes, reliably.** Detect it (`fal-ai/florence-2-large/ocr-with-region`
  returns strings + bounding boxes), erase it (`fal-ai/bria/eraser` with a mask
  from those boxes, or "remove all text" via nano-banana edit), then re-add it
  as real text boxes at the detected positions. Every piece is on our fal key.
- **Everything else: unreliable.** Segmentation (`fal-ai/sam2/image`) and
  background removal (`fal-ai/birefnet/v2`) will give clean cutouts, but
  whatever sat *behind* an object has to be hallucinated by inpainting, and
  recovering the original font, kerning, effects and perspective is guesswork.
  Quality varies a lot.
- **Layer-aware video generation** ("move the headline 50px left" on a finished
  video, no re-render) is a research direction, not something buyable today.

The important framing: all of that is a fix for *"someone handed me a flat
image I didn't make."* **We don't have that problem — we generate the image, so
we can simply never flatten the text in the first place.** Prevention is
cheaper, instant, and exact, where reconstruction is expensive and lossy.

Where it *is* genuinely useful for us is the reverse direction: a
**"Make text editable"** button for an image the team uploads (a reference, an
old asset) or one where the AI baked text in anyway. Detect → erase → hand back
editable boxes on a clean plate. Good feature, strong demo, and cheap now that
every model it needs is confirmed available. Parked as a Phase D+ extra, not
MVP.

---

## Spike results (Phase A) — providers confirmed

All four models we need are on **fal.ai, under the one `FAL_KEY` we already
have**. No separate OpenAI or Google account required. Verified by probing
each endpoint (a bogus model id returns `404 Application not found`, so a
`403 balance` reply proves the model exists and our key may access it).

Using the **latest generation of both models** (confirmed available on our key):

| Purpose | fal endpoint | Notes |
|---|---|---|
| "Gemini" generate | `fal-ai/nano-banana-2` | aspect_ratio incl. `4:5`, `9:16`, `1:1`, `16:9`; resolution `0.5K`–`4K`; `thinking_level` |
| "Gemini" edit | `fal-ai/nano-banana-pro/edit` | takes `image_urls` **array** — source + extra references together |
| "ChatGPT" generate | `fal-ai/gpt-image-2` | `image_size` buckets: `square_hd`, `portrait_4_3`, `portrait_16_9`, `landscape_16_9`, … |
| "ChatGPT" edit | `fal-ai/gpt-image-2/edit-image` | |
| Video (image→video) | `fal-ai/bytedance/seedance/v1/pro/image-to-video` | duration 2–12s, up to 1080p, `9:16`/`1:1`/`16:9` |
| Video (text→video) | `fal-ai/bytedance/seedance/v1/pro/text-to-video` | for video-only sessions |

Also confirmed on the key and useful later: `florence-2-large/ocr-with-region`
(text detection), `bria/eraser` (text removal), `sam2/image`, `birefnet/v2`,
`ffmpeg-api/compose` (video overlay compositing).

**Aspect ratios — nearly a non-issue on the new models.** `gpt-image-2` covers
`portrait_16_9`, so Story/Reel **9:16 is exact**. Only Instagram's 4:5 has no
exact bucket (nearest is `portrait_4_3` = 3:4, slightly taller), so for that
one ratio the GPT candidate is generated at 3:4 with a framing hint and
centre-cropped to 4:5 before upload — a small trim, and both candidates then
come back the same shape and post-ready. Nano Banana 2 hits every ratio
natively.

### ✅ Arabic test — run 2026-08-09, and it changes our assumption

Run on **Replicate** rather than fal (fal is empty; Replicate hosts the same
models — `google/nano-banana-2`, `openai/gpt-image-2` — and had credit). One
image each, same prompt: a full Instagram post for Arak with the Arabic
headline **نضيء تفاصيل المكان** and an English subline.

**Both models rendered the Arabic correctly** — right spelling, correct letter
joining, correct right-to-left order, in clean modern Arabic faces. Both came
back genuinely post-ready: real architectural photography, proper editorial
layout, gold rule, hierarchy, negative space. gpt-image-2 additionally
invented an "ARAK LIGHTING / RIYADH SAUDI ARABIA" logo lockup on the wall
that nothing in the prompt asked for.

**So the earlier premise — "AI can't be trusted with Arabic" — is not
supported.** Do not tell the marketing team otherwise.

Caveats, stated honestly:
- **One sample each.** One success is not consistency. Proper validation needs
  many runs across longer strings, numerals, diacritics and mixed AR/EN.
- **Verified by eye, not by a native reader.** Subtle faults — a missing dot,
  a wrong medial form — are exactly what a non-reader misses. Get an Arabic
  speaker to confirm before this is quoted to anyone.
- Both prompts used a short, common phrase. Long or unusual copy is where
  these models typically degrade.

---

## 🔴 The bug that meant video never actually worked (fixed 2026-08-11)

**Every video render this app ever attempted charged fal and then failed.** That
is why `creative_versions` held 22 ready images and **zero** ready videos while
the feature was marked "built and verified" — it had never once been followed
all the way through to a finished clip.

fal's queue is keyed on the **first two path segments only**. You submit to the
full model path:

```
POST https://queue.fal.run/fal-ai/kling-video/v2.5-turbo/pro/image-to-video
```

and fal replies with a `response_url` pointing at the *app*, not the model:

```
https://queue.fal.run/fal-ai/kling-video/requests/<id>
```

Both workflows built their status/result URLs from the full model path, which
returns **405 Method Not Allowed**. Proven directly:

| URL | Result |
|---|---|
| `…/fal-ai/kling-video/v2.5-turbo/pro/image-to-video/requests/<id>/status` | **405** |
| `…/fal-ai/kling-video/requests/<id>/status` | **200** |

The failure lands *after* the submit, so the generation had already started and
been billed — and the old code discarded the `request_id`, leaving the paid clip
unreachable. One Kling render was lost this way before the cause was found.

**Fixed** in both `Creative Video` and the plan board's `Video Render`: poll
`submit.status_url` / `submit.response_url` — the URLs fal itself returns —
falling back to the first two segments rather than the whole path. The
`request_id` now appears in every failure message past the submit, so a paid
render can never be orphaned again.

**The lesson worth keeping:** "the webhook returns `accepted`" and "the workflow
reports success" both looked green here for weeks. Neither is evidence that an
asset exists. Only a row reaching `status:'ready'` with a playable URL is.

## Endpoint facts — verified against fal's live schemas, 2026-08-11

Two notes elsewhere in this file were stale. Corrected here.

| Model | Aspect ratios accepted | Max | Notes |
|---|---|---|---|
| Seedance 2.0 | auto/21:9/16:9/4:3/3:4/1:1/9:16 | 15s, 4K | takes `end_image_url` |
| Seedance 2.5 | **`auto` only** | 30s, 720p | takes `end_image_url` |
| Veo 3.1 Fast | **auto/16:9/9:16 only** | 8s | one `image_url`, no refs, no end frame |
| Kling 2.5 Turbo Pro | none | 10s | |
| Hailuo 2.3 | none | 10s | |

**Two live bugs found and fixed.** `ASPECT_MAP` was global where the constraint
is per model:
1. It rewrote 4:5 → 3:4 for everyone, and **Veo rejects 3:4** — so every 4:5 or
   1:1 Veo render was failing outright.
2. It sent a real ratio to Seedance 2.5, which accepts only `auto`.

It is now per-model, and an approximate shape is acceptable because Creative
Compose centre-crops the finished clip back to the overlay's own aspect.

**Style references DO have a model input** — the earlier note saying otherwise
was true of the image-to-video endpoints we were calling and false of fal.
`bytedance/seedance-2.0/reference-to-video` (and 2.5) takes an **`image_urls`**
array — up to 9 images plus 3 videos and 3 audio clips, 12 files total —
addressed from the prompt as `@Image1`. A sentence naming them is prepended
automatically; without it the model treats them as vague inspiration and mostly
ignores them, the same failure the image Edit workflow hit with its own
`image_urls` array.

**Seedance's `generate_audio` defaults to `true` on fal**, so our explicit
`false` is load-bearing and must stay.

## Provider review — 2026-08-10 (Higgsfield explored, declined)

**Higgsfield is not on our fal key.** Probed directly: every `higgsfield/*`
path returns 404, while a nonsense path inside a namespace fal *does* host
(`fal-ai/kling-video/v99/...`) returns 403. No higgsfield namespace exists on
fal at all. Using it means a second vendor, a second key
(`Authorization: Key KEY_ID:KEY_SECRET` against `platform.higgsfield.ai`) and a
second bill — subscription, $15/$39/$99 a month in credits, with the headline
"unlimited generations" perk explicitly **not** applying to API usage.

**And their catalogue is largely ours already.** Their pricing page sells Nano
Banana Pro, Nano Banana 2, Seedance 2.0 and Kling 3.0 — all on fal,
pay-as-you-go, no subscription. Their own models are Soul (images), DoP
(image→video) and Speak (talking avatars).

**What actually makes Higgsfield feel better is the interface, not the models.**
You don't write prose — you pick a named camera move from a gallery, or a look
from Soul's style library. Their SDK confirms it: `getMotions()` and
`getSoulStyles()` return preset lists and the video call takes a `motions`
array. That is a curated prompt library, not a model capability, so it was
rebuilt in our repo against the fal key we already pay for —
`src/components/studio/motionPresets.js`.

**Decision: no Higgsfield.** Two things we genuinely cannot replicate, and the
only reasons to revisit: **Soul consistency IDs** (the same product or person
across a whole campaign) and **talking avatars**. Neither has been asked for.

### Video model: moving to Seedance 2.0

| | Seedance 1.0 Pro (was) | Seedance 2.0 (now) |
|---|---|---|
| Endpoint | `fal-ai/bytedance/seedance/v1/pro/…` | `bytedance/seedance-2.0/…` |
| Audio | none | native synced, free (`generate_audio`) |
| Length | ~12s | 4–15s |
| Resolution | up to 1080p | 480p / 720p / 1080p |
| 5s clip | $0.62 (1080p) | **$1.51** (720p) · **$3.41** (1080p) |

**Draft tier first, final tier when it's right** — exposed in the animate
panel as Draft/Final with the price on each button. Which pixels those tiers
mean depends on the model (Seedance 2.0: 720p/1080p; Seedance 2.5: 480p/720p),
which is why the catalog carries them per model instead of the UI assuming.
The reason to spend on the final tier isn't the footage, it's **our text
overlay**: the layer is composited at video resolution, and fine Arabic
strokes rendered small and then put through Instagram's re-encode go visibly
mushy. Motion checks don't need the pixels; the finished post does.

**Every render defaults to the Draft tier**, including the new 20s default. At
20s the Final tier is $9.46 a click, and "re-render until it's right" at that
price is exactly the habit the price-per-button exists to prevent.

**Audio defaults OFF** — and the team has now confirmed this is what they want
("videos do not need sound, I can add that after separately"). Free, but a
model inventing ambient sound under a brand asset is a liability. Toggle is in
the panel.

**⚠️ Budget — the 15–30s requirement roughly triples the video bill.** Worth
putting to whoever owns the fal account before volume ramps, because the old
figure below is quoted in places.

| | Old (5s, Seedance 2.0) | Now (20s, Seedance 2.5) |
|---|---|---|
| One draft | $1.51 | **$4.41** |
| One final | $3.41 | **$9.46** |
| ~18 renders/month | ~$38 | **~$110** |

At the team's stated volume (15–30 posts/month, 4–6 of them video, editing
included) that's roughly **$110/month of video** plus ~$18/month of images —
call it **$125–130 a month on fal**, against $55–60 before. At a 30s default
it would be ~$164 of video instead. Nothing here is wasted spend; it is simply
what 20-second clips cost, and the per-click price is on screen before the
click.

---

## Questions for the marketing team

1. **Brand fonts** — the actual Arabic + Latin font files Arak uses, so
   "change the font" means *your* fonts. (Until then the editor ships with
   good Arabic-capable defaults: Cairo, Tajawal, IBM Plex Sans Arabic.)
2. ~~**Video specs** — clip length, aspect ratios, is silent video fine?~~
   **Answered by the team 2026-08-11:** **15–30s**, and **no sound needed**
   ("I can add that after separately"). Both are now the shipped defaults —
   Seedance 2.5 at 20s, audio off. Still worth confirming which **aspect
   ratios** they actually post in; that one is still open.
3. ~~**Requirement 10** — confirm the edit-image-then-re-animate loop is
   acceptable, since in-video text editing isn't possible.~~ **Moot.** Text on
   video is free, instant and re-editable (Creative Compose), and scene changes
   edit the footage directly (Kling O1 Edit). Nothing to renegotiate. The one
   thing to *tell* them: past 10s a scene change is a fresh take rather than an
   edit of that clip, because fal caps the edit endpoint's input at 10s — so a
   20s clip's lighting change comes back as a different take. Text, fonts and
   colours are unaffected at any length.
4. ~~**Volume**~~ **Answered:** 15–30 posts/month, 4–6 of them video. Costed
   above — note the 15–30s ask moves fal from ~$55–60 to ~$125–130 a month.
5. **Canva** — does the team have a Canva account (Pro/Teams)? Needed for the
   hand-off in Phase F.

---

## Phases

- [x] **A — Spike.** Confirm endpoints + schemas. ✅ done. Arabic-quality test ⏳ blocked on fal balance.
- [x] **B — Backend.** ✅ **Done and deployed.** 3 workflows in
  `n8n/gen_workflows.py`, imported into the `arak-marketing-n8n` container,
  published, and verified listening (`{"status":"accepted"}` on all three
  paths). Migration run — `creative_sessions` and `creative_versions` both
  return 200. Webhook fields live in Settings → Integrations.

  **Import gotcha, for next time:** `n8n import:workflow --input=<single file>`
  fails on n8n 2.33 with `NOT NULL constraint failed: workflow_entity.id`,
  because the generator emits no top-level workflow id and only `--separate`
  synthesises one. Importing the whole `/workflows` directory isn't the
  answer either — it would duplicate all 14 existing workflows onto the same
  webhook paths with no defined winner (see `n8n/docker/README.md`). The
  working recipe is to copy just the new files into a scratch dir in the
  container and run `--separate` on that:
  ```
  docker exec arak-marketing-n8n sh -c 'mkdir -p /tmp/newflows && cp /workflows/*Creative*.json /tmp/newflows/'
  docker exec arak-marketing-n8n n8n import:workflow --separate --input=/tmp/newflows
  docker exec arak-marketing-n8n n8n publish:workflow --id=<id>   # per workflow
  docker compose restart n8n
  ```

  **UPDATING an already-imported workflow** (the repeat case) — see
  `scratchpad/redeploy.sh` for the whole thing. Two traps, both of which
  reported success while shipping nothing:
  - Inject the id n8n already assigned into the JSON before importing, or the
    import creates a *second* workflow instead of updating in place.
  - **Copy to a FRESH directory every time.** `docker cp dir container:/existing`
    puts the source *inside* the destination, so a reused path leaves the stale
    files exactly where `--separate` reads them and hides the new ones a level
    down. Copied files are owned by root while n8n runs as `node`, so they
    can't be deleted to recover — hence a new timestamped dir per deploy.
  - `healthz` returns 200 *before* webhooks are registered. Poll the webhook
    itself for `{"status":"accepted"}`, not the health endpoint.

  Still to set: paste the three production URLs into Settings → Integrations
  (`http://localhost:5680/webhook/arak-creative-…`). Every webhook field in
  that screen is currently "Not set" in this browser, since they live in
  localStorage per-browser.

  ⛔ **The migration can't be applied from here.** The connected Supabase MCP
  only exposes project `fiiifytprcswwoyvyrvm` (**Arak Catalogues** — products,
  SKUs, catalog matching). The marketing app runs on `vxjhfvehccftvajgtqtv`
  (**Arak Marketing**, per `.env`), which that connection cannot see. The SQL
  must be run by hand in the Arak Marketing SQL editor, or the MCP reconnected
  to the account that owns it. Applying it to the Catalogues project would put
  the tables in the wrong database entirely.
- [x] **C — Studio UI.** ✅ Built and verified end to end. `/studio` (sidebar →
  Marketing → Creative Studio): intent picker, prompt, shape, reference upload
  + notes, dual candidate cards labelled *ChatGPT* / *Gemini*, select, AI edit
  loop, text editor, animate, save to Media Library, download. Files:
  `src/pages/studio/index.jsx`, `src/components/studio/GenerationRound.jsx`,
  `src/lib/creativeStudio.js`.

  Verified live: session created, two pending rows inserted, webhook accepted,
  n8n ran, and both cards resolved to a real failure with fal's own message.
  The only reason it stops at failure is the empty balance — every link in the
  chain either side of the model call is proven.

  Two bugs found and fixed during that verification:
  **Reworked 2026-08-10 into the two-lane form** described at the top. Each
  round-0 candidate is now the root of its own branch and gets its own chat
  box, edit history, base image and toolbar. Nothing was added to the schema
  to do it — `parent_version_id` already said which lineage a version belongs
  to, so the branch is *derived* (`buildBranches` in `src/lib/creativeStudio.js`)
  and therefore can't drift from the tree or need a migration.

  Also new: **which image an instruction acts on is explicit.** By default it's
  the lane's newest still (never a video — no model can edit a clip; you edit
  the image and re-animate). Click any earlier version in the thread to
  continue from that one instead, or drag a picture over from the other lane.
  `reference_image_urls` was added to the Creative Edit workflow for that last
  case: both fal edit endpoints take an `image_urls` **array**, so the base and
  the reference go in one call, first position first — plus a sentence in the
  prompt saying which is which, without which the edit comes back as a blend of
  the two rather than an edit of the first.

  Files: `src/pages/studio/index.jsx`, `src/components/studio/BranchChat.jsx`,
  `VersionCard.jsx`, `labels.js` (`GenerationRound.jsx` was folded into these).

  - Errors surfaced as "Request failed with status code 403" instead of fal's
    "User is locked. Reason: Exhausted balance." n8n's thrown error does not
    carry the response body anywhere reachable; the fix is
    `ignoreHttpStatusErrors: true` + `returnFullResponse: true` and reading the
    status ourselves. **The other 6 workflows still have the old unwrapper and
    the same blind spot** — worth the same fix next time one is touched.
  - "Pick the one you prefer" rendered above two *failed* cards.
- [ ] **D — Overlay text editor.** Real fonts, guaranteed Arabic, re-editable. *Requirement 7.*
- [x] **E — Video.** ✅ **Done 2026-08-11.** *Requirements 9–11.*

  Animation un-parked (`ANIMATE_ENABLED` deleted), and the piece that made
  parking it reasonable — a clip you couldn't put editable text on — is gone.

  **Creative Compose**, a fourth n8n workflow (`arak-creative-compose`), stamps
  the editor's own layer onto a finished clip with **local ffmpeg**. It is the
  only generation-adjacent workflow that spends nothing: no `FAL_KEY`, no model
  call. That is what makes "change the wording as often as you like, free" true
  rather than a slogan.

  - **The editor is the same editor**, in `mode="video"`. Every coordinate was
    already a fraction of the frame, so it doesn't care whether a photo or frame
    one of a clip is underneath. Crop and photo-adjust are hidden (they cannot
    reach footage); a **timeline strip** appears; Save emits a transparent brand
    layer instead of a flattened picture. Rebuilding a separate video editor
    would have thrown away the fonts, the Arabic shaping, the snapping and the
    undo stack for nothing.
  - **Per-layer timing.** `tIn` / `tOut` / `fade` in seconds (not fractions —
    seconds are resolution-independent, and a fraction would silently move text
    if the clip were re-rendered longer). One PNG per distinct timing group, so
    the common case of "everything runs the whole clip" still costs one image
    and one ffmpeg overlay.
  - **The invariant that matters:** `overlay_state.baseVideoUrl` holds the clip
    as the model rendered it, and re-editing always composites from THAT. Same
    rule as `baseImageUrl` on the image side, same reason — compositing over a
    previous composite burns the old wording permanently into the footage while
    `overlay_state` replays the same layers on top, so a typo fix would show
    both spellings with no way back.
  - **No migration needed.** A composed clip is `kind:'overlay'`,
    `provider:'manual'`, `media_type:'video'` — all three already pass the
    existing check constraints — and everything else lives in `overlay_state`.

  Also fixed in this pass: the style-reference slot now reaches Seedance's
  **reference-to-video** endpoint (it was never true that no model input
  existed — we were calling the wrong endpoint); start/end frames are sent;
  and two live aspect-ratio bugs are gone (below).

  **ffmpeg in the container.** `n8n/docker/Dockerfile` copies static ffmpeg and
  ffprobe in from `mwader/static-ffmpeg:7.1`. Not `apk add` — `n8nio/n8n:latest`
  is now a **Docker Hardened Image** with no package manager and no curl, only
  busybox wget. Two more traps, both of which look nothing like their cause:
  - n8n 2.0 **disables the ExecuteCommand node by default**
    (`NODES_EXCLUDE` defaults to executeCommand + localFileTrigger). Without
    re-enabling it the workflow imports and publishes fine, then never
    activates and the webhook 404s. Re-enabled in `docker-compose.yml`, with the
    security trade-off written down there.
  - `restrictFileAccessTo` defaults to `~/.n8n-files`, so the Read File node
    refuses anything in `/tmp` with "Access to the file is not allowed." The
    composite is written inside `~/.n8n-files` instead of widening the setting.

  Files: `n8n/gen_workflows.py` (`build_creative_compose`), `n8n/docker/*`,
  `n8n/redeploy.sh` (new — the update-in-place recipe, which the docs referenced
  but the repo never had), `src/components/studio/editor/canvas/Timeline.jsx`,
  `editor/model/{document,render}.js`, `src/components/studio/videoFrame.js`,
  `src/pages/studio/index.jsx`, `BranchChat.jsx`, `VideoSettings.jsx`.

  **Verified without spending anything on fal:** the filter graph proved against
  a synthetic clip (alpha respected, layers appear/leave on the second, fades
  smooth, 3:4 → 4:5 centre-crop exact, audio preserved); the real workflow run
  end to end against fixtures in Supabase storage, producing a correct 1080×1350
  mp4; and the editor's own Arabic export inspected at native resolution —
  correct joining and RTL order.

  **And verified live, 2026-08-11.** Hotel-lobby still → Kling 2.5 Turbo Pro,
  10s ($0.70) → 1292×1604 clip → the editor's real Arabic + English overlays
  composited over it → **1282×1604 (ratio 0.7992, i.e. 4:5) in under 13 seconds
  at no cost**. Frames either side of each cue confirm the timing: the Arabic
  headline runs the whole clip, the English subline is absent at 0.5s, present
  from 2.6s, and gone again by 8.0s, with its 0.5s fades visible at the edges.
  Audio and duration preserved. The centre-crop was genuinely exercised — Kling
  returned 0.8054 rather than an exact 0.8, and the composite trimmed 10px of
  width to make the clip agree with the layer the marketer composed against.
- [ ] **F — Canva hand-off.** Connect API via a Supabase Edge Function. Only phase with external-approval risk.
