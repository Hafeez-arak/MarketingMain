# Creative Studio — Prompt Enhancement

> Written and built 2026-08-10, once the concurrent Studio session finished.
> Companion to `CREATIVE-STUDIO.md`; this is a Phase-C addition.

## Status: shipped and verified live

| Piece | File | State |
|---|---|---|
| `CREATIVE_ENHANCE_JS` + `build_creative_enhance()` | `n8n/gen_workflows.py` | **Deployed.** Live in `arak-marketing-n8n` as workflow `5l6o1VZ2Zfb76O9m`, published, webhook `arak-creative-enhance` responding 200. |
| Provider-mechanics split, `buildPrompt(provider)` | `n8n/gen_workflows.py` (`CREATIVE_GENERATE_JS`) | **Deployed**, updated in place on the existing workflow `s5U2DS1dybYQhHR0` (same id — not a duplicate). Exported and grepped post-deploy to confirm the GPT no-logo line and `buildPrompt('openai')`/`buildPrompt('gemini')` are actually what's running, not just what's on disk. |
| `requestEnhance()` | `src/lib/creativeStudio.js` | Written, builds clean. |
| `original_prompt` / `prompt_source` columns | `supabase/migrations/20260810_creative_studio.sql` + `20260810_creative_studio_prompt_source.sql` | **Live on `vxjhfvehccftvajgtqtv`** (Arak Marketing), confirmed via `information_schema.columns` after applying. See "The migration gap" below for why a second file was needed. |
| ✨ buttons, Undo, auto-enhance toggle | `src/pages/studio/index.jsx` | Written, builds clean. Not click-tested in an authenticated browser session (no workspace login available in this environment). |
| Webhook field | `src/pages/settings/index.jsx` | Written (`creativeEnhance`). **Still needs the production URL pasted in** — see "One remaining step" below. |
| Brand context wiring | `src/pages/studio/index.jsx` | Fixed as a side effect — `arak-creative-generate` was never receiving `instructions`, so `BRAND CONTEXT` had been silently empty since Phase C. Now wired. |

### Live end-to-end proof

Called the deployed webhook directly with curl, real Anthropic spend, real
model:

```
POST /webhook/arak-creative-enhance  {"mode":"image","prompt":"warm lobby shot", ...}
→ {"ok":true,"prompt":"A warm architectural lobby interior... 2700K warm
   downlights... soft cove lighting... wall-wash grazing the textured stone
   walls... Shot on a wide-angle lens at eye level, 4:5 vertical framing..."}
```

Subject ("lobby") untouched; lighting vocabulary, framing and lens detail
added exactly per the rules. Motion mode tested the same way:

```
POST  {"mode":"motion","prompt":"make it feel alive","duration":"5",
       "source_prompt":"A dusk shot of a modern villa facade with warm linear lighting"}
→ {"ok":true,"prompt":"Slow, steady dolly in toward the villa facade...
   Subtle parallax... soft light bloom breathing faintly along the linear
   fixtures, shadows drifting almost imperceptibly..."}
```

Camera movement only, as specified — doesn't restate the scene, stays under
the 40-word cap. Empty-prompt path also confirmed: `{"ok":false,"error":
"Nothing to enhance yet."}`. `arak-creative-generate`'s webhook re-checked
200 after the in-place update, so the update didn't drop its registration.

**Not tested:** the composer UI itself (✨ button, Undo, auto-enhance toggle)
in a real logged-in session — this environment has no workspace credentials.
`npx vite build` is clean and the dev server boots with zero console errors,
which confirms every import resolves and nothing throws at module-eval time,
but that's static, not behavioral, verification.

---

## The migration gap (why two files exist)

You ran `supabase/migrations/20260810_creative_studio.sql` twice: once before
the `original_prompt`/`prompt_source` columns were added to it, and once
after. `create table if not exists` is a no-op the moment the table already
exists — it does not diff columns like a real migration tool. So the second
run silently changed nothing, and the live table was missing both columns.

Confirmed directly against `vxjhfvehccftvajgtqtv` via `information_schema.columns`
before touching anything. Fixed with a proper idempotent follow-up
(`20260810_creative_studio_prompt_source.sql`, using `add column if not
exists` this time, which — unlike `create table if not exists` — really is
safe to run against either starting state) and verified present afterward.
Everything else in the original migration (both tables, RLS, all five
indexes, the `creative-studio` storage bucket) was already correct — checked
`pg_policies`, `pg_indexes`, `storage.buckets`, and `pg_class.relrowsecurity`
directly, no other gaps.

Also ran `get_advisors(security)` on the project while I had access: five
findings, all pre-existing and unrelated to Creative Studio (a
`SECURITY DEFINER` view, two functions missing `search_path`, `create_company`
callable by `anon`/`authenticated`, leaked-password protection off). Nothing
introduced by this work — flagged for awareness, not acted on, since they're
out of scope here.

**The reconnect that made this checkable:** the Supabase MCP connector was
originally authorized against the wrong org and only exposed `Arak
Catalogues` (`fiiifytprcswwoyvyrvm`) — a completely different Supabase
project from the one this app runs on. Reconnecting it (Settings →
Connectors → Supabase → disconnect → reconnect, granting the org that owns
`Arak Marketing`) is what made `vxjhfvehccftvajgtqtv` visible and this whole
check possible.

---

## One remaining step

The workflow is live and responding, but the **Settings → Integrations →
Creative Studio — Enhance Prompt** field is still empty — the browser has no
way to find the webhook until that URL is pasted in. Production URL:

```
http://localhost:5680/webhook/arak-creative-enhance
```

(Port confirmed via `docker port arak-marketing-n8n` — `5678/tcp -> 5680`,
matching the other three Creative Studio webhooks already configured there.)

---

## The question this answers

*"Don't the two models need different prompts? Wouldn't sharing one hurt
quality? But I need high-quality generation too — pick the best approach."*

It splits into two layers, and only one should ever differ per model.

**Layer 1 — the creative brief. Shared, visible, one thing to manage.**
Subject, setting, lighting, composition, materials, colour temperature, mood.
This is ~95% of image quality and it's genuinely model-agnostic — both
gpt-image-2 and nano-banana-2 are instruction-tuned on natural descriptive
language, not a special dialect each. One enhanced prompt in the textarea.
Both candidates render the same brief, so the side-by-side actually answers
what it's for: which model renders *our* idea better — not which of two
different prompts happened to work out.

**Layer 2 — provider mechanics. Deterministic, invisible, no second LLM
call.** This is where genuine per-model difference belongs, and only for
things with evidence behind them:

| Rule | Provider | Grounds |
|---|---|---|
| Centre-safe framing at 4:5 | GPT only | No exact 4:5 bucket — generates at `portrait_4_3`, centre-cropped after (`CREATIVE-STUDIO.md:206`). Nano Banana hits 4:5 natively. Pre-existing. |
| "No logo, wordmark, watermark, signage or brand lockup unless explicitly described" | GPT only | The 2026-08-09 Arabic test: gpt-image-2 invented an ARAK LIGHTING / RIYADH wall lockup nothing asked for; nano-banana-2, same prompt, did not (`CREATIVE-STUDIO.md:226`). New — deployed today, confirmed live via workflow export. |

A blanket no-logo rule would have suppressed legitimate in-scene signage on
the Gemini side for no reason — exactly why this lives in layer 2 keyed by
provider rather than in the shared brief.

**Is a differing layer 2 still a fair A/B?** Yes — arguably fairer. The point
is "which picture do we like," not a research benchmark. Penalising GPT for
a crop bucket or a logo habit it can't help says nothing about which image to
post. Each model gets an equally good rendition of the *same* brief; the
creative variable — the thing actually being compared — stays controlled.

Real per-model divergence already exists downstream where it earns its keep:
the edit loop edits each branch with the model that made it. It doesn't
belong in the one place — generation — where it would corrupt the comparison.

---

## Model: `claude-sonnet-5`, thinking off, effort low

```js
model: 'claude-sonnet-5',
thinking: { type: 'disabled' },
output_config: { effort: 'low' },   // 'medium' for motion mode
max_tokens: 800,
```

- **Haiku 4.5** — fastest, cheapest, already doing the style-rewrite job
  elsewhere in this codebase. But this needs brand voice and Arak's actual
  lighting vocabulary (2700K vs 4000K, grazing vs wall-wash vs cove, beam
  angle, facade illumination) — Haiku flattens that to generic padding, which
  is the exact failure this feature exists to avoid. Fallback if measured
  latency turns out unacceptable.
- **Opus 5** — thinking is on by default and can't be disabled above `high`
  effort, so a click-and-wait button sits at 6–15s. Its strength is
  long-horizon agentic work, not a bounded single-shot rewrite.
- **Sonnet 5, thinking off, effort low** — the live test above ran in a
  couple seconds, and reads as literal instruction-following, not
  embellishment.

**Cost:** ~1.5k in / 400 out ≈ $0.007/click at Sonnet 5's intro $2/$10 per
MTok — noise against $0.10–0.30 per two-candidate generation round.

---

## What ships in the two system prompts

**Image mode**, priority order (stated first and literally, because thinking
is off):

1. Never change the subject — elaborate, don't substitute.
2. No text/lettering in the image unless explicitly asked. Per the Phase-D
   decision, the default is a clean plate with real text added in the overlay
   editor afterward; an enhancer that "helpfully" adds Arabic typography would
   silently break that. If text *was* asked for, quote it verbatim and add
   "render this text exactly, no other text anywhere."
3. Add Arak's lighting vocabulary — colour temperature, fixture technique,
   beam quality, material response.
4. Moderate elaboration only: fill lighting/framing/materials/lens gaps, leave
   subject/setting/mood untouched, 60–120 words, no padding to hit a length.
5. A reference image is described as *direction*, never "reproduce this."
6. Output the prompt text only — no preamble, quotes, or markdown.

**Motion mode** — a different job, since the still already exists:

1. Camera movement and motion only — the subject, lighting and setting are
   already in frame; restating them fights the source image.
2. One movement, paced to clip length (Seedance: 2–12s).
3. House style: slow pan, gentle dolly, subtle parallax, soft light bloom.
4. Never mentions text — that's composited onto the finished clip separately.
5. Max 40 words.

---

## Composer state machine

The truth about "has the human touched this?" lives in the browser, not in
n8n — n8n only ever receives a plain boolean.

```
promptRaw      // what they originally typed — kept for one-click Undo
prompt         // what's in the box, and what gets sent
promptSource   // 'raw' | 'enhanced' | 'enhanced_edited'
```

- ✨ click → `enhancePrompt()` calls the webhook, writes the result into the
  box, sets `promptSource = 'enhanced'`. **Never fires a generation** — the
  whole point is the text is read before it costs anything.
- Typing afterward flips the source to `'enhanced_edited'`; the button stays
  available (now offered as "rewrite again, replacing the current text").
- Undo restores `promptRaw` and resets to `'raw'`.
- Auto-enhance toggle (default **off**, per-session, in-memory — not
  persisted to `creative_sessions`) fires inside `handleGenerate` only when
  `promptSource === 'raw'`, and only writes the box via the same
  `enhancePrompt()` path — so even the automatic case is visible before
  `createSession` runs, not a silent background swap.
- A failed enhance never blocks generation — it falls back to the raw prompt
  and surfaces a non-blocking error.

Same three states drive the motion-mode button on the animate modal, minus
the auto-toggle (motion enhancement is always explicit).

---

## Deliberately not built

- **Enhancement on edit instructions.** The edit-loop chat box takes surgical
  instructions ("make the light warmer"). Elaborating those makes edits *less*
  precise — the model's strength there is leaving the rest of the frame
  untouched, and a padded instruction erodes exactly that.
- **A second enhanced prompt per provider.** Covered above — the real
  per-model need lives in layer 2, not in a second creative brief.
- **Persisting the auto-enhance toggle per session.** It's a per-visit UI
  preference right now (component state, resets with `newSession()`).
  Reconsider only if the team asks for it to stick.
