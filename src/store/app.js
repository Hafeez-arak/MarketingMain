import { createContext, useContext } from 'react'
import { defaultWebhooks } from '../lib/n8nWebhooks'

// ─── App store: the context, the hook, and the action creators ─────────────
// Split out of appStore.jsx, which keeps <AppProvider>. A module that exports
// both a component and plain values breaks Fast Refresh — React can't tell
// whether a changed export is a component, so it falls back to a full reload
// on every edit. Keeping the non-component half here means editing an action
// creator hot-swaps instead of reloading the page.

export const AppContext = createContext(null)

// ─── The webhook slots ──────────────────────────────────────────────────────
// Every n8n webhook the app can be pointed at. ONE list — this object used to
// be written out as a literal in five separate places, and two of them (the
// `|| {...}` fallbacks in SWITCH_WORKSPACE and DELETE_WORKSPACE) had drifted
// to six keys while the other three carried twenty-seven.
//
// That drift was survivable only by luck: a missing key reads `undefined`,
// which is falsy, and every consumer already treats falsy as "not configured
// yet" (`if (!webhookUrl) return { error: 'set it in Settings' }`), while the
// Settings page coerces with `|| ''` before binding an input. So nothing broke.
// What it did guarantee is that ADDING a slot meant remembering five edits,
// and the two easiest to miss were the ones no test or type would catch.
//
// Read it as the schema: a workspace's webhooks are always exactly these keys.
// Anything loaded from localStorage or the workspace_webhooks table is spread
// ON TOP of this (see webhooksFrom), never used in place of it, so a blob
// written by an older build gains the newer keys as '' instead of holes.
//
// Lives here rather than in appStore.jsx for the reason at the top of this
// file: a module exporting both <AppProvider> and a plain object costs Fast
// Refresh on every edit to either.
//
// The slots are still the schema; what changed is that they no longer
// default to ''. Each one now resolves to VITE_N8N_BASE_URL + the slot's
// fixed webhook path (lib/n8nWebhooks.js), so a fresh workspace is already
// pointed at the live n8n instance and nobody has to paste 27 URLs into
// Settings. Slots with no deployed workflow still resolve to '' — see the
// note on WEBHOOK_PATHS.
export const WEBHOOK_SLOTS = [
  'instagram',
  'instagramSchedule', 'instagramScheduleRegen',
  'instagramReels',
  'campaignPlanner', 'instagramPlanGen',
  'elongateIdea', 'captionStudio', 'draftCopy', 'mediaOptions',
  'videoRender',
  'publishPost', 'zernioSync', 'zernioDashboard',
  'creativeGenerate', 'creativeEdit', 'creativeVideo', 'creativeCompose',
  'creativeEnhance', 'creativeVideoEdit', 'creativeStitch', 'creativeCancel',
  'falBalance',
]

export const DEFAULT_WEBHOOKS = defaultWebhooks(WEBHOOK_SLOTS)

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

export const actions = {
  addCampaign:        p  => ({ type: 'ADD_CAMPAIGN',         payload: p }),
  updateCampaign:     p  => ({ type: 'UPDATE_CAMPAIGN',      payload: p }),
  deleteCampaign:     id => ({ type: 'DELETE_CAMPAIGN',      payload: id }),
  addPost:            p  => ({ type: 'ADD_POST',             payload: p }),
  updatePost:         p  => ({ type: 'UPDATE_POST',          payload: p }),
  deletePost:         id => ({ type: 'DELETE_POST',          payload: id }),
  addEmailFlow:       p  => ({ type: 'ADD_EMAIL_FLOW',       payload: p }),
  updateEmailFlow:    p  => ({ type: 'UPDATE_EMAIL_FLOW',    payload: p }),
  deleteEmailFlow:    id => ({ type: 'DELETE_EMAIL_FLOW',    payload: id }),
  addMedia:           p  => ({ type: 'ADD_MEDIA',            payload: p }),
  deleteMedia:        id => ({ type: 'DELETE_MEDIA',         payload: id }),
  addApproval:        p  => ({ type: 'ADD_APPROVAL',         payload: p }),
  updateApproval:     p  => ({ type: 'UPDATE_APPROVAL',      payload: p }),
  connectAccount:     id => ({ type: 'CONNECT_ACCOUNT',      payload: id }),
  disconnectAccount:  id => ({ type: 'DISCONNECT_ACCOUNT',   payload: id }),
  addNotification:    p  => ({ type: 'ADD_NOTIFICATION',     payload: p }),
  clearNotifications: () => ({ type: 'CLEAR_NOTIFICATIONS' }),
  updateWorkspace:    p  => ({ type: 'UPDATE_WORKSPACE',     payload: p }),
  addTeamMember:      p  => ({ type: 'ADD_TEAM_MEMBER',      payload: p }),
  removeTeamMember:   id => ({ type: 'REMOVE_TEAM_MEMBER',   payload: id }),
  setWebhook:         (platform, url) => ({ type: 'SET_WEBHOOK', payload: { platform, url } }),
  hydrateWebhooks:    saved => ({ type: 'HYDRATE_WEBHOOKS', payload: saved }),
  setBrandProfile:    p  => ({ type: 'SET_BRAND_PROFILE',     payload: p }),
  setCampaignPlanDraft: p => ({ type: 'SET_CAMPAIGN_PLAN_DRAFT', payload: p }),
  createWorkspace:    p  => ({ type: 'CREATE_WORKSPACE',  payload: p }),
  switchWorkspace:    id => ({ type: 'SWITCH_WORKSPACE',  payload: id }),
  renameWorkspace:    p  => ({ type: 'RENAME_WORKSPACE',  payload: p }),
  deleteWorkspace:    id => ({ type: 'DELETE_WORKSPACE',  payload: id }),
}
