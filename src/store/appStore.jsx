import { AppContext } from './app'
import { useReducer, useEffect } from 'react'

const STORAGE_KEY = 'campai_arak_v1'

const DEFAULT_WORKSPACE_ID = 'ws_default'

const initialState = {
  campaigns: [],
  posts: [],
  emailFlows: [],
  mediaAssets: [],
  approvals: [],
  connectedAccounts: { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
  notifications: [],
  workspace: { name: 'Arak Lighting', plan: 'Free', logo: '' },
  workspaces: [{ id: DEFAULT_WORKSPACE_ID, name: 'Arak Lighting', createdAt: new Date().toISOString() }],
  activeWorkspaceId: DEFAULT_WORKSPACE_ID,
  // Per-workspace data keyed by workspaceId
  workspaceData: {
    [DEFAULT_WORKSPACE_ID]: {
      campaigns: [], posts: [], emailFlows: [], mediaAssets: [], approvals: [],
      connectedAccounts: { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
      instagramInstructions: '', instagramSchedule: {},
      linkedinInstructions: '', linkedinSchedule: {},
      webhooks: { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '', instagramReels: '', campaignPlanner: '', instagramPlanGen: '', linkedinPlanGen: '', elongateIdea: '', captionStudio: '', draftCopy: '', mediaOptions: '', videoRender: '', publishPost: '', zernioSync: '', zernioDashboard: '', creativeGenerate: '', creativeEdit: '', creativeVideo: '', creativeCompose: '', creativeEnhance: '', creativeVideoEdit: '', creativeStitch: '', creativeCancel: '', falBalance: '' },
      supabase: { url: '', anonKey: '' },
    }
  },
  team: [],
  instagramInstructions: '',
  instagramSchedule: {},
  linkedinInstructions: '',
  linkedinSchedule: {},   // { 'YYYY-MM-DD': { topic, tone, postType, includeImage, style, aspectRatio, contentRoute, notes } }
  webhooks: { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '', instagramReels: '', campaignPlanner: '', instagramPlanGen: '', linkedinPlanGen: '', elongateIdea: '', captionStudio: '', draftCopy: '', mediaOptions: '', videoRender: '', publishPost: '', zernioSync: '', zernioDashboard: '', creativeGenerate: '', creativeEdit: '', creativeVideo: '', creativeCompose: '', creativeEnhance: '', creativeVideoEdit: '', creativeStitch: '', creativeCancel: '', falBalance: '' },
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
    return { ...initialState, ...JSON.parse(raw) }
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
    case 'UPDATE_SUPABASE': return { ...state, supabase: { ...state.supabase, ...action.payload } }
    case 'SET_BRAND_PROFILE': return { ...state, brandProfile: action.payload }
    case 'SET_CAMPAIGN_PLAN_DRAFT': return { ...state, campaignPlanDraft: action.payload }

    case 'CREATE_WORKSPACE': {
      const ws = action.payload
      const emptyData = {
        campaigns: [], posts: [], emailFlows: [], mediaAssets: [], approvals: [],
        connectedAccounts: { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
        instagramInstructions: '', instagramSchedule: {},
        linkedinInstructions: '', linkedinSchedule: {},
        webhooks: { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '', instagramReels: '', campaignPlanner: '', instagramPlanGen: '', linkedinPlanGen: '', elongateIdea: '', captionStudio: '', draftCopy: '', mediaOptions: '', videoRender: '', publishPost: '', zernioSync: '', zernioDashboard: '', creativeGenerate: '', creativeEdit: '', creativeVideo: '', creativeCompose: '', creativeEnhance: '', creativeVideoEdit: '', creativeStitch: '', creativeCancel: '', falBalance: '' },
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
        webhooks: newData.webhooks || { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '' },
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
          webhooks: nextData.webhooks || { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '' },
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
