import { createContext, useContext } from 'react'

// ─── App store: the context, the hook, and the action creators ─────────────
// Split out of appStore.jsx, which keeps <AppProvider>. A module that exports
// both a component and plain values breaks Fast Refresh — React can't tell
// whether a changed export is a component, so it falls back to a full reload
// on every edit. Keeping the non-component half here means editing an action
// creator hot-swaps instead of reloading the page.

export const AppContext = createContext(null)

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
  setBrandProfile:    p  => ({ type: 'SET_BRAND_PROFILE',     payload: p }),
  setCampaignPlanDraft: p => ({ type: 'SET_CAMPAIGN_PLAN_DRAFT', payload: p }),
  createWorkspace:    p  => ({ type: 'CREATE_WORKSPACE',  payload: p }),
  switchWorkspace:    id => ({ type: 'SWITCH_WORKSPACE',  payload: id }),
  renameWorkspace:    p  => ({ type: 'RENAME_WORKSPACE',  payload: p }),
  deleteWorkspace:    id => ({ type: 'DELETE_WORKSPACE',  payload: id }),
}
