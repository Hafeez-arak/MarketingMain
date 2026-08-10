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
| 9 | Move to video generation (Higgsfield or Seedance) | E | ☐ |
| 10 | Video supports the same edits: colour / font / text | E | ⚠️ see note |
| 11 | Final output: ready-to-post image and/or video, accurate Arabic, no captions/analytics | C+E | ☐ |

Also confirmed with the team: a session may be **image only**, **video only**,
or **image then video** — none of the three is a special case.

**⚠️ Requirement 10 — the one thing we must renegotiate.** No AI model today
can reliably retype or restyle text *inside* an existing video. What works,
and what every professional AI-video workflow does, is: **edit the still
image, then re-animate it** (~1–2 min per render). The UI will make this a
one-click loop rather than hiding it. Needs the team's sign-off — it's the
only requirement we're not meeting literally.

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

### ⚠️ Clip length — no model makes a 30-second video

Verified from the live schemas, 2026-08-09:

| Model | Max single clip |
|---|---|
| Veo 3 | 8s |
| Kling 2.5 Turbo | 10s |
| **Seedance 1.0 Pro** (ours) | **12s** |
| Sora 2 | 20s (720p only) |

A 30-second reel therefore has to be **stitched from 2–3 generated clips**, not
generated in one call. That is how reels are cut anyway, so it isn't fatal —
but it is real extra work (a stitch step via `ffmpeg-api/compose`), and the
joins will be visible as cuts unless clips are chained. Seedance's i2v takes
an `end_image_url` as well as a start frame, so clip 2 can begin on the frame
clip 1 ended on, which is the tool for making a chain look deliberate.

**Tell the marketing team this before they plan around 30s reels.** Not in
scope for the first build — the Studio ships single clips first.

### …which also solves requirement 10 (editable text on video)

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

**Draft at 720p, final at 1080p** — exposed in the animate panel as
Draft/Final with the price on each button. The reason for 1080p on finals
isn't the footage, it's **our text overlay**: the layer is composited at video
resolution, and fine Arabic strokes rendered at 720p and then put through
Instagram's re-encode go visibly mushy. Motion checks don't need the pixels;
the finished post does.

**Audio defaults OFF.** It's free, but a model inventing ambient sound under a
brand asset is a liability, not a bonus — it should be asked for. Toggle is in
the panel.

**Budget at the team's stated volume** (15–30 posts/month, 4–6 of them video,
editing included): roughly 18 renders — ~12 drafts at 720p + ~6 finals at
1080p ≈ **$38/month of video**, plus ~$18/month of images. Call it **$55–60 a
month on fal.** Rendering everything at 1080p instead would be ~$61 on video
alone, for no visible gain on the drafts nobody posts.

---

## Questions for the marketing team

1. **Brand fonts** — the actual Arabic + Latin font files Arak uses, so
   "change the font" means *your* fonts. (Until then the editor ships with
   good Arabic-capable defaults: Cairo, Tajawal, IBM Plex Sans Arabic.)
2. ~~**Video specs** — clip length, aspect ratios, is silent video fine?~~
   **Answered internally 2026-08-10:** 4–15s on Seedance 2.0; drafts 720p,
   finals 1080p; audio is available free but off by default until asked for.
   Still worth confirming with the team which aspect ratios they actually
   post in.
3. **Requirement 10** — confirm the edit-image-then-re-animate loop is
   acceptable, since in-video text editing isn't possible.
4. **Volume** — roughly how many images/videos a month, for cost planning
   (≈$0.10–0.30 per two-option round, ≈$0.30–1.00 per video render).
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
- [ ] **E — Video.** Seedance i2v + t2v, re-render loop. *Requirements 9–11.*
- [ ] **F — Canva hand-off.** Connect API via a Supabase Edge Function. Only phase with external-approval risk.
