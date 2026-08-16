import { useState, useEffect } from 'react'
import { useApp, actions, WEBHOOK_SLOTS } from '../../store/app'
import { mergeWebhooks, defaultWebhookUrl } from '../../lib/n8nWebhooks'
import { useAuth } from '../../store/auth'
import { supabase } from '../../lib/supabaseClient'
import { fetchWorkspaceWebhooks, saveWorkspaceWebhooks } from '../../lib/workspaceWebhooks'
import { Card, Button, PageHeader } from '../../components/ui/index'
import { uid, PLATFORM_META } from '../../lib/utils'

// ─── Workspace / Supabase status ────────────────────────────────────────────
// Phase 0 replaced manually-pasted Supabase credentials with real auth —
// this is now a read-only status card, not a form. Nothing here is
// editable because there's nothing left for a user to configure: the
// project URL/anon key are fixed in the app's build, and which workspace's
// data you see is determined by who you're signed in as.
function SupabaseConfig() {
  const { activeWorkspace } = useAuth()
  const isConfigured = !!activeWorkspace

  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#3ECF8E]">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.362 9.354H12V.396a.396.396 0 0 0-.716-.233L2.203 12.424l-.401.562a1.04 1.04 0 0 0 .836 1.659H12v8.959a.396.396 0 0 0 .716.233l9.081-12.261.401-.562a1.04 1.04 0 0 0-.836-1.66z"/>
            </svg>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="font-medium text-text text-sm">Workspace data store</p>
              {isConfigured
                ? <span className="text-[10px] bg-sage-100 text-sage-700 px-1.5 py-0.5 leading-[1.4] font-semibold">● Connected</span>
                : <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 leading-[1.4] font-semibold">No active workspace</span>}
            </div>
            <p className="text-xs text-text-tertiary mt-0.5">
              {isConfigured
                ? `Signed in to "${activeWorkspace.name}". Your data is isolated to this workspace — nothing to configure.`
                : 'Try signing out and back in.'}
            </p>
          </div>
        </div>
      </div>
    </Card>
  )
}

// ─── Workflow Webhooks ─────────────────────────────────────────────────────
const WORKFLOW_CONFIGS = [
  {
    platform: 'instagram',
    label: 'Instagram Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram',
    description: 'Triggers AI content generation — captions, images, style switching.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0"
        style={{ background: '#E1306C' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="2" y="2" width="20" height="20" rx="5"/>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramReels',
    label: 'Instagram Reels Webhook',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram-reels',
    description: 'Triggers the Reels workflow — FLUX cover image + Wan 2.5 I2V video generation.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0"
        style={{ background: '#E1306C' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramSchedule',
    label: 'Instagram Schedule Webhook',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram-schedule',
    description: 'Separate path for dispatching pre-planned monthly schedule entries.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0"
        style={{ background: '#E1306C' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramScheduleRegen',
    label: 'Instagram Schedule — Regen Image',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-instagram-schedule-regen',
    description: 'Called when you click Regenerate Image on a scheduled post.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0"
        style={{ background: '#E1306C' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'linkedin',
    label: 'LinkedIn Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-linkedin',
    description: 'Triggers AI post generation — hooks, body copy, optional image.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#0A66C2]">
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'linkedinSchedule',
    label: 'LinkedIn Schedule Webhook',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-linkedin-schedule',
    description: 'Separate path for dispatching pre-planned monthly schedule entries.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#0A66C2]">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'linkedinScheduleRegen',
    label: 'LinkedIn Schedule — Regen Image',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-linkedin-schedule-regen',
    description: 'Called when you click Regenerate Image on a monthly schedule post.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 bg-[#0A66C2]">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.27-4.93"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'campaignPlanner',
    label: 'Campaign Planner Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-campaign-planner',
    description: 'Decomposes a stated goal into a dated set of post ideas across platforms. Returns a plan — never writes to Supabase itself.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#7c3aed' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M12 3v3m0 12v3m9-9h-3M6 12H3m15.36-6.36l-2.12 2.12M8.76 15.24l-2.12 2.12m12.72 0l-2.12-2.12M8.76 8.76L6.64 6.64"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'instagramPlanGen',
    label: 'Instagram Plan Generation',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-ig-plan-generation',
    description: 'When a plan is approved, generates each approved Instagram idea (caption + image) into pending_review, ready to review before scheduling.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#E1306C' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>
      </div>
    ),
  },
  {
    platform: 'linkedinPlanGen',
    label: 'LinkedIn Plan Generation',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-li-plan-generation',
    description: 'When a plan is approved, generates each approved LinkedIn idea (hook/body + image) into pending_review, ready to review before scheduling.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#0A66C2' }}>
        <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M4.98 3.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM3 9h4v12H3zM10 9h3.8v1.7h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1V21h-4v-5.3c0-1.26-.02-2.9-1.77-2.9s-2.03 1.38-2.03 2.8V21h-4z"/></svg>
      </div>
    ),
  },
  {
    platform: 'elongateIdea',
    label: 'Idea Elongation Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-elongate-idea',
    description: 'When you manually add your own idea in the planner, this turns your rough topic into a full brief (angle, objective, CTA, image direction) — same quality as AI-suggested ideas — before you approve it. Runs automatically on save.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#059669' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'captionStudio',
    label: 'Caption Studio Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-caption-studio',
    description: 'Powers the ✨ Rewrite panel on the post review screen — 3 caption variants side by side, regenerate just the hook or hashtags, with length / hook-style / emoji / hashtag-count controls. On-demand only, so it never adds cost to normal generation.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#7c3aed' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M5 3v4M3 5h4M6 17v4m-2-2h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3z"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'draftCopy',
    label: 'Draft Copy Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-draft-copy',
    description: 'Fires once per idea the moment a plan is created — writes 3 caption options and 3 media-prompt options onto the plan board before anything renders, so you review real proposals instead of blind topics. Async: fires and the board polls for the result.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#0ea5e9' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'mediaOptions',
    label: 'Media Options Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-media-options',
    description: 'Powers "🖼 Generate image options" on the plan board — real spend (fal.ai), so it only fires when you click it. Returns 2-3 actual candidate images (or a video cover) to pick from before Finalize, not just more prompts.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#f59e0b' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'videoRender',
    label: 'Video Render Workflow',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-video-render',
    description: 'Renders the actual video clip for a reel/video-format idea once approved — Finalize fires this for every approved video post at once, using the cover image + motion direction already chosen during review. Real spend (fal.ai).',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#ef4444' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeGenerate',
    label: 'Creative Studio — Generate',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-generate',
    description: 'The Creative Studio\'s two-option generator: one candidate from ChatGPT (gpt-image-2) and one from Gemini (nano-banana-2) for every prompt, so you compare and pick. Real spend (fal.ai) — fires when you hit Generate.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#8b5cf6' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="2" y="4" width="9" height="16" rx="1.5"/><rect x="13" y="4" width="9" height="16" rx="1.5"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeEdit',
    label: 'Creative Studio — Edit',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-edit',
    description: 'Conversational edits on the image you picked — "make the background navy", "warmer lighting". Each edit becomes a new version you can revert to. Real spend (fal.ai) per edit. Note: for changing TEXT, the built-in text editor is better — real fonts, exact Arabic, and always re-editable.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#06b6d4' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeVideo',
    label: 'Creative Studio — Video',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-video',
    description: 'Turns a finished image into a clip, or generates one straight from a prompt when there is no image (Seedance, 2–12s). Real spend (fal.ai) per render — the most expensive call in the app, so it only fires on request.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#f43f5e' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeVideoEdit',
    label: 'Creative Studio — Video Edit',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-video-edit',
    description: 'What the chat box\'s Send does under a finished clip — edits the FOOTAGE itself ("change the background to marble") via Kling O1 Edit, keeping the source\'s own camera movement. Real spend (fal.ai), ~$0.17/second of the clip. Only works on clips 3–10s long; longer ones only offer Re-render.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#8b5cf6' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          <path d="M9 9l-2 2 2 2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeCancel',
    label: 'Creative Studio — Cancel a render',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-cancel',
    description: 'Asks fal to drop a clip that is already generating. Worth knowing what this can actually do: fal only cancels a request still waiting in its queue — once generation has started, the clip finishes and is charged whatever we send. So it saves money on a misfire caught quickly, and frees the storyboard either way.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#b91c1c,#ef4444)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6" strokeLinecap="round"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'falBalance',
    label: 'fal.ai — credit balance',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-fal-balance',
    description: 'Shows what is left on the fal account beside the Creative Studio header, so the price on a Render button can be read against something. Goes through n8n rather than straight from the browser because reading the balance needs FAL_KEY — a credential that can spend money and must never reach a browser. Optional: leave it blank and the header simply shows no figure.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#047857,#10b981)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20" strokeLinecap="round"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeStitch',
    label: 'Creative Studio — Stitch (join the clips)',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-stitch',
    description: 'Joins a long video\'s clips into one reel with local ffmpeg — re-encodes every clip to a common size, frame rate and sound, then cuts or crossfades between them. No model, no fal call — FREE, like Compose. This is what makes a 30-second video cost $2 of short clips instead of $14 of one long render.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#0891b2,#22d3ee)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="1" y="7" width="9" height="10" rx="1"/><rect x="14" y="7" width="9" height="10" rx="1"/>
          <path d="M10 12h4" strokeLinecap="round"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeCompose',
    label: 'Creative Studio — Compose (text on video)',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-compose',
    description: 'Stamps your text, logos and colours onto a finished clip with local ffmpeg. No model, no fal call — FREE, and unlimited. This is what lets the team change an Arabic headline as often as they like without ever re-rendering the footage; only changing what happens inside the scene costs money.',
    icon: (
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg,#059669,#34d399)' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 12h10M7 16h6" strokeLinecap="round"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'creativeEnhance',
    label: 'Creative Studio — Enhance Prompt',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-creative-enhance',
    description: 'The ✨ button next to the prompt box — rewrites a rough brief into a fuller one (lighting, framing, materials) before you generate. Text only, no image spend. Claude call, ~2 seconds, always shown to you before anything renders.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#f59e0b' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" strokeLinecap="round"/>
          <circle cx="12" cy="12" r="2.5"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'publishPost',
    label: 'Publish Post (Zernio)',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-publish-post',
    description: 'Publishes or schedules an approved post to its platform through Zernio. The Zernio API key lives in n8n, never in this app — the browser only ever calls this webhook.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#8b5cf6' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'zernioSync',
    label: 'Zernio Sync (accounts + analytics)',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-zernio-sync',
    description: 'Pulls state back from Zernio: which accounts are connected, and per-day metrics for everything published. Runs daily on its own; this URL is what the "Refresh" buttons hit for an on-demand sync.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#0d9488' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
        </svg>
      </div>
    ),
  },
  {
    platform: 'zernioDashboard',
    label: 'Zernio Dashboard (rich analytics)',
    placeholder: 'https://your-instance.app.n8n.cloud/webhook/arak-zernio-dashboard',
    description: 'Live, on-demand proxy for the fuller Zernio widgets — best time to post, posting frequency vs engagement, content decay, daily rollups, follower history. Nothing here is stored; the Analytics page fetches it fresh on load.',
    icon: (
      <div className="w-8 h-8 flex items-center justify-center flex-shrink-0" style={{ background: '#f59e0b' }}>
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
        </svg>
      </div>
    ),
  },
]

function WorkflowWebhooks() {
  const { state, dispatch } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const [drafts, setDrafts]   = useState(() => {
    const d = {}
    WORKFLOW_CONFIGS.forEach(c => { d[c.platform] = state.webhooks?.[c.platform] || '' })
    return d
  })
  const [saved,   setSaved]   = useState({})
  const [visible, setVisible] = useState({})
  const [syncState, setSyncState] = useState('idle') // idle | synced | error

  // Webhooks used to live only in this browser's localStorage — sign in
  // from another browser/device and every field was blank. Load the
  // account's saved copy from Supabase (workspace_webhooks) and merge it
  // into the store so it's the same everywhere the account signs in.
  useEffect(() => {
    if (!activeWorkspaceId) return
    let cancelled = false
    fetchWorkspaceWebhooks(activeWorkspaceId, accessToken).then(saved => {
      if (cancelled) return
      if (saved) {
        dispatch(actions.hydrateWebhooks(saved))
        // Show the same merged values the rest of the app will use, not the
        // raw row — otherwise a slot the row has as '' or on a dead tunnel
        // host renders blank/stale here while every other page correctly
        // calls the current default.
        setDrafts(mergeWebhooks(WEBHOOK_SLOTS, saved))
      }
      setSyncState('synced')
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId])

  async function handleSave(platform) {
    const url = drafts[platform].trim()
    // Clearing a field now means "stop overriding", not "blank it". What's
    // stored stays '' so the row carries no host at all, and the slot falls
    // back to the build's default — which is what keeps the app following
    // the tunnel across restarts instead of freezing on whatever host was
    // current the day someone last typed here.
    const effective = url || defaultWebhookUrl(platform)
    dispatch(actions.setWebhook(platform, effective))
    // Normalise the draft to the trimmed value so isDirty resolves to false
    // right after saving (otherwise a trailing space keeps the button "dirty").
    setDrafts(d => ({ ...d, [platform]: effective }))
    setSaved(s => ({ ...s, [platform]: true }))
    setTimeout(() => setSaved(s => ({ ...s, [platform]: false })), 2000)

    // Persist only genuine overrides. A slot equal to its own default is
    // written as '' rather than as today's tunnel URL, so a row saved now
    // doesn't become 27 stale hosts the next time the tunnel restarts.
    const merged = {}
    for (const slot of WEBHOOK_SLOTS) {
      const value = slot === platform ? url : (state.webhooks?.[slot] || '')
      merged[slot] = value === defaultWebhookUrl(slot) ? '' : value
    }
    const result = await saveWorkspaceWebhooks(activeWorkspaceId, accessToken, merged)
    dispatch(actions.addNotification({
      id: uid(),
      message: result.error
        ? `${platform} webhook saved locally, but failed to sync to your account: ${result.error}`
        : (url ? `${platform} webhook saved to your account.` : `${platform} webhook reset to the default.`),
      createdAt: new Date().toISOString(),
    }))
  }

  return (
    <Card>
      <div className="px-6 py-5 border-b border-border">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-text">Workflow Webhooks</h3>
          {syncState === 'synced' && (
            <span className="text-[10px] bg-sage-100 text-sage-700 px-1.5 py-0.5 leading-[1.4] font-semibold">● Synced to your account</span>
          )}
        </div>
        {/* The n8n hostname is deliberately not shown. It is server-side
            config now (app_config.n8n_base_url, read by /api/n8n/<slot>), and
            printing it here would put it back in the page for every visitor —
            the exact leak the proxy exists to close. */}
        <p className="text-xs text-text-tertiary mt-0.5">
          These already route to the team&apos;s n8n instance through this app, so you
          don&apos;t need to fill anything in. Override one only if you&apos;re testing
          against your own n8n; clear it to go back to the default.
        </p>
      </div>
      <div className="divide-y divide-border">
        {WORKFLOW_CONFIGS.map(cfg => {
          const current = state.webhooks?.[cfg.platform] || ''
          const isSet   = !!current
          // "Default" vs "Custom" matters here in a way "Configured" doesn't:
          // a custom value is the one thing that won't follow the tunnel when
          // the base URL changes, so it should be visible at a glance.
          const isDefault = isSet && current === defaultWebhookUrl(cfg.platform)
          const isDirty = drafts[cfg.platform] !== current
          const show    = visible[cfg.platform]

          return (
            <div key={cfg.platform} className="p-6 space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3">
                {cfg.icon}
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-text text-sm">{cfg.label}</p>
                    {!isSet
                      ? <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 leading-[1.4] font-semibold">Not set</span>
                      : isDefault
                        ? <span className="text-[10px] bg-sage-100 text-sage-700 px-1.5 py-0.5 leading-[1.4] font-semibold">● Default</span>
                        : <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 leading-[1.4] font-semibold">● Custom</span>
                    }
                  </div>
                  <p className="text-xs text-text-tertiary mt-0.5">{cfg.description}</p>
                </div>
              </div>

              {/* URL input */}
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <input
                    type={show ? 'text' : 'password'}
                    name={`webhook-${cfg.platform}`}
                    placeholder={cfg.placeholder}
                    value={drafts[cfg.platform]}
                    onChange={e => setDrafts(d => ({ ...d, [cfg.platform]: e.target.value }))}
                    // A webhook URL is not a login password — stop password managers
                    // (1Password / LastPass / Chrome) from auto-refilling the masked
                    // field, which silently reverts edits and blocks replacing the URL.
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    data-1p-ignore
                    data-lpignore="true"
                    data-form-type="other"
                    className="w-full rounded-xl border border-border bg-surface-subtle text-text text-xs px-3.5 py-2.5 pr-10 focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono placeholder:font-sans placeholder:text-text-tertiary transition-all"
                  />
                  <button onClick={() => setVisible(v => ({ ...v, [cfg.platform]: !v[cfg.platform] }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text transition-colors">
                    {show
                      ? <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>
                <button
                  onClick={() => handleSave(cfg.platform)}
                  disabled={!isDirty}
                  className={`px-4 py-2.5 rounded-xl text-xs font-semibold transition-all flex-shrink-0 ${
                    saved[cfg.platform]
                      ? 'bg-sage-100 text-sage-700 border border-sage-200'
                      : isDirty
                        ? 'btn-amber'
                        : 'bg-surface-subtle text-text-tertiary border border-border cursor-not-allowed'
                  }`}>
                  {saved[cfg.platform]
                    ? '✓ Saved'
                    : (isDirty && !drafts[cfg.platform].trim() ? 'Clear' : 'Save')}
                </button>
              </div>

              {/* Helper */}
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100">
                <svg className="w-3.5 h-3.5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  In n8n: click the <strong>Webhook</strong> node → copy the <strong>Production URL</strong>.
                  Use the <strong>Test URL</strong> while building to see live executions.
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Settings ──────────────────────────────────────────────────────────────
// A "company" == a Supabase workspace. This section reads/writes the REAL
// workspaces + workspace_members tables (via useAuth), not the legacy
// localStorage appStore — so creating a company here makes a real, isolated
// tenant that shows up in the sidebar switcher and gets its own brain/plans.
export function Settings() {
  const { user, workspaces, activeWorkspaceId, switchWorkspace, refreshWorkspaces } = useAuth()
  const [showCreate, setShowCreate] = useState(false)
  const [newWsName, setNewWsName]   = useState('')
  const [editingId, setEditingId]   = useState(null)
  const [editName, setEditName]     = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')

  const activeId = activeWorkspaceId

  async function handleCreate() {
    const name = newWsName.trim()
    if (!name || !user) return
    setBusy(true); setError('')
    // create_company() (SECURITY DEFINER) atomically makes the company + the
    // caller's owner membership, then we refresh and drop into the new one.
    const { data: newId, error: rpcError } = await supabase
      .rpc('create_company', { company_name: name })
    if (rpcError) { setError(rpcError.message); setBusy(false); return }
    await refreshWorkspaces()
    if (newId) switchWorkspace(newId)
    setNewWsName(''); setShowCreate(false); setBusy(false)
  }

  async function handleRename(id) {
    const name = editName.trim()
    if (!name) return
    setBusy(true); setError('')
    const { error: e } = await supabase.from('workspaces').update({ name }).eq('id', id)
    if (e) { setError(e.message); setBusy(false); return }
    await refreshWorkspaces()
    setEditingId(null); setBusy(false)
  }

  async function handleDelete(id) {
    setBusy(true); setError('')
    // FK on delete cascade wipes members + all workspace-scoped data.
    const { error: e } = await supabase.from('workspaces').delete().eq('id', id)
    if (e) { setError(e.message); setBusy(false); setConfirmDelete(null); return }
    if (id === activeId) {
      const next = workspaces.find(w => w.id !== id)
      if (next) switchWorkspace(next.id)
    }
    await refreshWorkspaces()
    setConfirmDelete(null); setBusy(false)
  }

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title="Settings" subtitle="Companies, workspace preferences, and account details." />

      <Card className="overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-text text-sm">Companies</h3>
            <p className="text-xs text-text-tertiary mt-0.5">Each company keeps its own brand brain, content, plans, and posts. Everyone on the team can see and edit all of them — add or remove people under Team &amp; Access.</p>
          </div>
          <Button size="sm" onClick={() => { setShowCreate(true); setNewWsName(''); setError('') }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            Add company
          </Button>
        </div>

        {error && (
          <div className="px-6 py-3 border-b border-border bg-red-50/60">
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Create inline form */}
        {showCreate && (
          <div className="px-6 py-4 border-b border-border bg-amber-50/40">
            <p className="text-xs font-semibold text-text-secondary mb-2">Company name</p>
            <div className="flex gap-2">
              <input
                autoFocus
                value={newWsName}
                onChange={e => setNewWsName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setShowCreate(false) }}
                placeholder="e.g. Nour Interiors"
                className="flex-1 rounded-xl border border-border bg-white text-text text-sm px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 transition-all"
              />
              <Button size="sm" onClick={handleCreate} disabled={!newWsName.trim() || busy}>{busy ? 'Creating…' : 'Create'}</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Company list */}
        <ul className="divide-y divide-border">
          {workspaces.map(ws => {
            const isActive  = ws.id === activeId
            const isEditing = editingId === ws.id
            return (
              <li key={ws.id}
                className={`flex items-center gap-3 px-6 py-3.5 transition-colors ${isActive ? 'bg-amber-50/40' : 'hover:bg-surface-muted'}`}>
                {/* Avatar */}
                <div className="w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                  style={{ background: isActive ? '#96acb2' : '#929ca7' }}>
                  {ws.name.charAt(0).toUpperCase()}
                </div>

                {/* Name / edit */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(ws.id); if (e.key === 'Escape') setEditingId(null) }}
                    className="flex-1 rounded-lg border border-amber-300 bg-white text-text text-sm px-3 py-1 focus:outline-none focus:ring-2 focus:ring-amber-400"
                  />
                ) : (
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text truncate">{ws.name}</p>
                    {isActive && <p className="text-[10px] text-amber-600 font-semibold">Active</p>}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <Button size="xs" onClick={() => handleRename(ws.id)} disabled={!editName.trim() || busy}>Save</Button>
                      <Button size="xs" variant="secondary" onClick={() => setEditingId(null)}>Cancel</Button>
                    </>
                  ) : (
                    <>
                      {!isActive && (
                        <Button size="xs" variant="outline"
                          onClick={() => switchWorkspace(ws.id)}>
                          Switch
                        </Button>
                      )}
                      <button
                        onClick={() => { setEditingId(ws.id); setEditName(ws.name) }}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text hover:bg-surface-subtle transition-colors"
                        title="Rename">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>
                      </button>
                      {workspaces.length > 1 && (
                        <button
                          onClick={() => setConfirmDelete(ws)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete">
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      {/* Danger Zone */}
      <Card className="p-6 border-red-200">
        <h3 className="font-semibold text-red-600 mb-2">Danger Zone</h3>
        <p className="text-xs text-text-secondary mb-4">Delete the active company. This permanently removes its brand brain, content, plans, and posts.</p>
        <Button variant="danger" size="sm"
          disabled={workspaces.length <= 1}
          onClick={() => setConfirmDelete(workspaces.find(w => w.id === activeId))}>
          Delete company
        </Button>
        {workspaces.length <= 1 && (
          <p className="text-[11px] text-text-tertiary mt-2">Create a second company before you can delete this one.</p>
        )}
      </Card>

      {/* Confirm delete modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(28,35,33,0.45)' }}>
          <div className="bg-white rounded-2xl shadow-dropdown w-full max-w-sm border border-border animate-fade-scale p-6 space-y-4">
            <h3 className="font-semibold text-text text-sm">Delete "{confirmDelete.name}"?</h3>
            <p className="text-sm text-text-secondary leading-relaxed">
              All content, posts, campaigns, brand brain, and settings for this company will be permanently removed.
            </p>
            <div className="flex gap-3 pt-1">
              <Button variant="secondary" className="flex-1 justify-center" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" className="flex-1 justify-center" onClick={() => handleDelete(confirmDelete.id)} disabled={busy}>{busy ? 'Deleting…' : 'Delete'}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Integrations ──────────────────────────────────────────────────────────
const thirdParty = [
  { id:'n8n',      name:'n8n',       desc:'Workflow automation',    category:'automation' },
  { id:'resend',   name:'Resend',    desc:'Email delivery',         category:'email' },
  { id:'openai',   name:'OpenAI',    desc:'AI content generation',  category:'ai' },
  { id:'supabase', name:'Supabase',  desc:'Database & storage',     category:'data' },
  { id:'stripe',   name:'Stripe',    desc:'Payments',               category:'payments' },
  { id:'zapier',   name:'Zapier',    desc:'No-code automation',     category:'automation' },
  { id:'slack',    name:'Slack',     desc:'Team notifications',     category:'messaging' },
  { id:'twilio',   name:'Twilio',    desc:'SMS & WhatsApp',         category:'messaging' },
]

export function Integrations() {
  const { state } = useApp()
  const platforms = Object.entries(PLATFORM_META)

  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Integrations" subtitle="Connect the services this workspace publishes and generates through." />

      {/* Supabase — needed for schedule auto-generation */}
      <SupabaseConfig />

      {/* Workflow Webhooks */}
      <WorkflowWebhooks />

      {/* Social platforms */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h3 className="font-semibold text-text">Social Accounts</h3>
          <p className="text-xs text-text-tertiary mt-0.5">Connect your social media accounts for direct publishing.</p>
        </div>
        <div className="divide-y divide-border">
          {platforms.map(([key, meta]) => {
            const connected = state.connectedAccounts?.[key]
            return (
              <div key={key} className="flex items-center gap-4 px-6 py-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-white text-xs`}
                  style={{ background: meta.color }}>
                  {meta.abbr}
                </div>
                <div className="flex-1">
                  <p className="font-medium text-text text-sm">{meta.label}</p>
                  <p className="text-xs text-text-tertiary">{connected ? 'Connected' : 'Not connected'}</p>
                </div>
                <Button variant={connected ? 'secondary' : 'outline'} size="sm">
                  {connected ? 'Disconnect' : 'Connect'}
                </Button>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Third-party integrations */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-border">
          <h3 className="font-semibold text-text">Integrations</h3>
          <p className="text-xs text-text-tertiary mt-0.5">Connect tools to extend Campai's capabilities.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-5">
          {thirdParty.map(t => (
            <div key={t.id} className="flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-amber-300 hover:bg-amber-50/30 transition-all group">
              <div className="w-9 h-9 rounded-xl bg-surface-subtle flex items-center justify-center flex-shrink-0 text-xs font-bold text-text-secondary group-hover:bg-amber-100 group-hover:text-amber-700 transition-colors">
                {t.name.slice(0,2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-text text-sm">{t.name}</p>
                <p className="text-xs text-text-tertiary">{t.desc}</p>
              </div>
              <Button variant="ghost" size="xs">Connect</Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
