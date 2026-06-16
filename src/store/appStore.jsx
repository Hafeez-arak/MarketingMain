import { createContext, useContext, useReducer, useEffect } from 'react'

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
      webhooks: { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '', instagramReels: '' },
      supabase: { url: '', anonKey: '' },
    }
  },
  team: [],
  instagramInstructions: '',
  instagramSchedule: {},
  linkedinInstructions: '',
  linkedinSchedule: {},   // { 'YYYY-MM-DD': { topic, tone, postType, includeImage, style, aspectRatio, contentRoute, notes } }
  webhooks: { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '', instagramReels: '' },
  supabase: { url: '', anonKey: '' },
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
  } catch {}
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

    case 'CREATE_WORKSPACE': {
      const ws = action.payload
      const emptyData = {
        campaigns: [], posts: [], emailFlows: [], mediaAssets: [], approvals: [],
        connectedAccounts: { instagram: false, facebook: false, linkedin: false, tiktok: false, x: false },
        instagramInstructions: '', instagramSchedule: {},
        linkedinInstructions: '', linkedinSchedule: {},
        webhooks: { instagram: '', linkedin: '', instagramSchedule: '', instagramScheduleRegen: '', linkedinSchedule: '', linkedinScheduleRegen: '', instagramReels: '' },
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

const AppContext = createContext(null)

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  useEffect(() => { saveState(state) }, [state])
  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

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
  createWorkspace:    p  => ({ type: 'CREATE_WORKSPACE',  payload: p }),
  switchWorkspace:    id => ({ type: 'SWITCH_WORKSPACE',  payload: id }),
  renameWorkspace:    p  => ({ type: 'RENAME_WORKSPACE',  payload: p }),
  deleteWorkspace:    id => ({ type: 'DELETE_WORKSPACE',  payload: id }),
}
