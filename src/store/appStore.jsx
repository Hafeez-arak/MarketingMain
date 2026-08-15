import { AppContext, DEFAULT_WEBHOOKS, WEBHOOK_SLOTS } from './app'
import { mergeWebhooks } from '../lib/n8nWebhooks'
import { useReducer, useEffect } from 'react'

const STORAGE_KEY = 'campai_arak_v1'

const DEFAULT_WORKSPACE_ID = 'ws_default'

// DEFAULT_WEBHOOKS — the one canonical list of webhook slots — moved to
// ./app.js, which is where this file's non-component exports live so that
// editing one doesn't cost Fast Refresh for the other.

// Fill in whatever a stored blob is missing. Used everywhere webhooks come
// back from persistence, so the in-memory shape is complete no matter how old
// the data is.
//
// This is no longer a plain spread, because the defaults are now real URLs
// rather than ''. A spread lets a stored '' — which every persisted blob is
// full of, since 27 slots were saved together and most were never filled —
// overwrite a perfectly good default with nothing. mergeWebhooks treats
// blank as "unset" and rebases our own paths off any stale host; see there.
const webhooksFrom = saved => mergeWebhooks(WEBHOOK_SLOTS, saved)

const initialState = {
  campaigns: [],
  posts: [],
  emailFlows: [],
  mediaAssets: [],
  approvals: [],
  connectedAccounts: { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
  notifications: [],
  workspace: { name: 'Arak Lighting', logo: '' },
  workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Arak Lighting', createdAt: new Date().toISOString() }],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  // Per-workspace data keyed by workspaceId
  workspaceData: {
    [DEFAULT_WORKSPACE_ID]: {
      campaigns: [], posts: [], emailFlows: [], mediaAssets: [], approvals: [],
      connectedAccounts: { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
      instagramInstructions: '', instagramSchedule: {},
      linkedinInstructions: '', linkedinSchedule: {},
      webhooks: { ...DEFAULT_WEBHOOKS },
      supabase: { url: '', anonKey: '' },
    }
  },
  team: [],
  instagramInstructions: '',
  instagramSchedule: {},
  linkedinInstructions: '',
  linkedinSchedule: {},   // { 'YYYY-MM-DD': { topic, tone, postType, includeImage, style, aspectRatio, contentRoute, notes } }
  webhooks: { ...DEFAULT_WEBHOOKS },
  supabase: { url: '', anonKey: '' },
  // Canonical brand profile, fetched from Supabase (not persisted to
  // localStorage — Supabase is the source of truth so n8n workflows and the
  // browser are always reading the same data).
  brandProfile: null,
  // In-progress Campaign Automation plan — lifted out of the page's local
  // state so it survives navigating to a dedicated per-post edit page and
  // back. Cleared on cancel/confirm. null when no plan is in progress.
  campaignPlanDraft: null,
}

const PERSIST_KEYS = [
  'campaigns','posts','emailFlows','mediaAssets','approvals',
  'connectedAccounts','workspace','team',
  'workspaces','activeWorkspaceId','workspaceData',
  'instagramInstructions',
  'instagramSchedule',
  'linkedinInstructions',
  'linkedinSchedule',
  'webhooks',
  'supabase',
  'campaignPlanDraft',
]

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState
    const saved = JSON.parse(raw)
    return {
      ...initialState,
      ...saved,
      // The spread above is shallow, so a persisted `webhooks` object replaces
      // the defaults wholesale rather than filling in around them — which
      // means a blob written before a slot existed would keep its old shape
      // forever, across every reload, with no way to notice. Re-based here so
      // adding a slot to DEFAULT_WEBHOOKS reaches existing browsers too.
      webhooks: webhooksFrom(saved.webhooks),
    }
  } catch { return initialState }
}

function saveState(state) {
  try {
    const partial = {}
    PERSIST_KEYS.forEach(k => { partial[k] = state[k] })
    localStorage.setItem(STORAGE_KEY, JSON.stringify(partial))
  } catch {
    // Private browsing, a full quota, or a disabled store. Persistence is a
    // convenience here — the app runs from in-memory state either way — so
    // there is nothing worth interrupting the user for.
  }
}

function reducer(state, action) {
  switch (action.type) {
    case 'ADD_CAMPAIGN':    return { ...state, campaigns: [action.payload, ...state.campaigns] }
    case 'UPDATE_CAMPAIGN': return { ...state, campaigns: state.campaigns.map(c => c.id === action.payload.id ? { ...c, ...action.payload } : c) }
    case 'DELETE_CAMPAIGN': return { ...state, campaigns: state.campaigns.filter(c => c.id !== action.payload) }
    case 'ADD_POST':    return { ...state, posts: [action.payload, ...state.posts] }
    case 'UPDATE_POST': return { ...state, posts: state.posts.map(p => p.id === action.payload.id ? { ...p, ...action.payload } : p) }
    case 'DELETE_POST': return { ...state, posts: state.posts.filter(p => p.id !== action.payload) }
    case 'ADD_EMAIL_FLOW':    return { ...state, emailFlows: [action.payload, ...state.emailFlows] }
    case 'UPDATE_EMAIL_FLOW': return { ...state, emailFlows: state.emailFlows.map(f => f.id === action.payload.id ? { ...f, ...action.payload } : f) }
    case 'DELETE_EMAIL_FLOW': return { ...state, emailFlows: state.emailFlows.filter(f => f.id !== action.payload) }
    case 'ADD_MEDIA':    return { ...state, mediaAssets: [action.payload, ...state.mediaAssets] }
    case 'DELETE_MEDIA': return { ...state, mediaAssets: state.mediaAssets.filter(m => m.id !== action.payload) }
    case 'ADD_APPROVAL':    return { ...state, approvals: [action.payload, ...state.approvals] }
    case 'UPDATE_APPROVAL': return { ...state, approvals: state.approvals.map(a => a.id === action.payload.id ? { ...a, ...action.payload } : a) }
    case 'CONNECT_ACCOUNT':    return { ...state, connectedAccounts: { ...state.connectedAccounts, [action.payload]: true } }
    case 'DISCONNECT_ACCOUNT': return { ...state, connectedAccounts: { ...state.connectedAccounts, [action.payload]: false } }
    case 'ADD_NOTIFICATION':    return { ...state, notifications: [action.payload, ...state.notifications].slice(0, 50) }
    case 'CLEAR_NOTIFICATIONS': return { ...state, notifications: [] }
    case 'UPDATE_WORKSPACE':   return { ...state, workspace: { ...state.workspace, ...action.payload } }
    case 'ADD_TEAM_MEMBER':    return { ...state, team: [...state.team, action.payload] }
    case 'REMOVE_TEAM_MEMBER': return { ...state, team: state.team.filter(m => m.id !== action.payload) }
    case 'SET_INSTAGRAM_INSTRUCTIONS': return { ...state, instagramInstructions: action.payload }
    case 'SET_INSTAGRAM_SCHEDULE':     return { ...state, instagramSchedule: action.payload }
    case 'SET_LINKEDIN_INSTRUCTIONS':  return { ...state, linkedinInstructions: action.payload }
    case 'SET_LINKEDIN_SCHEDULE':      return { ...state, linkedinSchedule: action.payload }
    case 'SET_WEBHOOK': return { ...state, webhooks: { ...state.webhooks, [action.payload.platform]: action.payload.url } }
    // Applying a blob fetched from workspace_webhooks. Deliberately NOT a
    // loop of SET_WEBHOOK over its entries, which is what the two loaders
    // used to do: that path writes every stored key verbatim, so the ''s
    // and stale hosts in an old row land in the store unfiltered and
    // clobber the build's defaults. Routing it through webhooksFrom applies
    // the same blank/rebase rules as localStorage hydration.
    case 'HYDRATE_WEBHOOKS': return { ...state, webhooks: webhooksFrom(action.payload) }
    case 'UPDATE_SUPABASE': return { ...state, supabase: { ...state.supabase, ...action.payload } }
    case 'SET_BRAND_PROFILE': return { ...state, brandProfile: action.payload }
    // A function payload is applied against the CURRENT draft instead of one
    // captured at render time.
    //
    // The planner's flows are async and dispatch more than once from a single
    // render: creating a plan sets step:'review', then immediately starts
    // caption drafting, which updates `ideas`. Both calls closed over the same
    // stale draft, so the second silently reverted step to 'setup' — the plan
    // and its ideas were written, nothing errored, and the user landed back on
    // the form with no explanation, creating another duplicate plan on every
    // retry. Merging against current state is what makes two updates in one
    // tick compose instead of clobber.
    case 'SET_CAMPAIGN_PLAN_DRAFT': return {
      ...state,
      campaignPlanDraft: typeof action.payload === 'function'
        ? action.payload(state.campaignPlanDraft)
        : action.payload,
    }

    case 'CREATE_WORKSPACE': {
      const ws = action.payload
      const emptyData = {
        campaigns: [], posts: [], emailFlows: [], mediaAssets: [], approvals: [],
        connectedAccounts: { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
        instagramInstructions: '', instagramSchedule: {},
        linkedinInstructions: '', linkedinSchedule: {},
        webhooks: { ...DEFAULT_WEBHOOKS },
        supabase: { url: '', anonKey: '' },
      }
      return {
        ...state,
        workspaces: [...(state.workspaces || []), ws],
        workspaceData: { ...(state.workspaceData || {}), [ws.id]: emptyData },
      }
    }

    case 'SWITCH_WORKSPACE': {
      const id = action.payload
      const ws = (state.workspaces || []).find(w => w.id === id)
      if (!ws) return state
      const currentId = state.activeWorkspaceId
      const savedCurrent = {
        campaigns: state.campaigns, posts: state.posts, emailFlows: state.emailFlows,
        mediaAssets: state.mediaAssets, approvals: state.approvals,
        connectedAccounts: state.connectedAccounts,
        instagramInstructions: state.instagramInstructions, instagramSchedule: state.instagramSchedule,
        linkedinInstructions: state.linkedinInstructions, linkedinSchedule: state.linkedinSchedule,
        webhooks: state.webhooks, supabase: state.supabase,
      }
      const newData = (state.workspaceData || {})[id] || {}
      return {
        ...state,
        activeWorkspaceId: id,
        workspace: { ...state.workspace, name: ws.name },
        workspaceData: { ...(state.workspaceData || {}), [currentId]: savedCurrent },
        campaigns: newData.campaigns || [],
        posts: newData.posts || [],
        emailFlows: newData.emailFlows || [],
        mediaAssets: newData.mediaAssets || [],
        approvals: newData.approvals || [],
        connectedAccounts: newData.connectedAccounts || { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
        instagramInstructions: newData.instagramInstructions || '',
        instagramSchedule: newData.instagramSchedule || {},
        linkedinInstructions: newData.linkedinInstructions || '',
        linkedinSchedule: newData.linkedinSchedule || {},
        webhooks: webhooksFrom(newData.webhooks),
        supabase: newData.supabase || { url: '', anonKey: '' },
      }
    }

    case 'RENAME_WORKSPACE': {
      const { id, name } = action.payload
      const updatedWorkspaces = (state.workspaces || []).map(w => w.id === id ? { ...w, name } : w)
      const updates = { workspaces: updatedWorkspaces }
      if (id === state.activeWorkspaceId) updates.workspace = { ...state.workspace, name }
      return { ...state, ...updates }
    }

    case 'DELETE_WORKSPACE': {
      const id = action.payload
      if ((state.workspaces || []).length <= 1) return state
      const remaining = (state.workspaces || []).filter(w => w.id !== id)
      const newWd = { ...(state.workspaceData || {}) }
      delete newWd[id]
      if (state.activeWorkspaceId === id) {
        const next = remaining[0]
        const nextData = newWd[next.id] || {}
        return {
          ...state,
          workspaces: remaining,
          workspaceData: newWd,
          activeWorkspaceId: next.id,
          workspace: { ...state.workspace, name: next.name },
          campaigns: nextData.campaigns || [],
          posts: nextData.posts || [],
          emailFlows: nextData.emailFlows || [],
          mediaAssets: nextData.mediaAssets || [],
          approvals: nextData.approvals || [],
          connectedAccounts: nextData.connectedAccounts || { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
          instagramInstructions: nextData.instagramInstructions || '',
          instagramSchedule: nextData.instagramSchedule || {},
          linkedinInstructions: nextData.linkedinInstructions || '',
          linkedinSchedule: nextData.linkedinSchedule || {},
          webhooks: webhooksFrom(nextData.webhooks),
          supabase: nextData.supabase || { url: '', anonKey: '' },
        }
      }
      return { ...state, workspaces: remaining, workspaceData: newWd }
    }

    default: return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  useEffect(() => { saveState(state) }, [state])
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}
