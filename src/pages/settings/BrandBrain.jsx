import { useEffect, useState } from 'react'
import { useApp, actions } from '../../store/appStore'
import { useAuth } from '../../store/AuthContext'
import { Card, WarmCard, Button, Textarea, Input } from '../../components/ui/index'
import {
  DEFAULT_BRAND_PROFILE, fetchBrandProfile, saveBrandProfile,
  buildInstructionsString, isBrandProfileEmpty,
} from '../../lib/brandBrain'
import { uid } from '../../lib/utils'

const FIELDS = [
  {
    key: 'voiceDescriptors', label: 'Brand Voice', single: true,
    placeholder: 'e.g. premium, authoritative, warm but never casual',
    hint: 'A few descriptors — comma separated. This is the first thing every AI call reads.',
  },
  {
    key: 'toneDos', label: 'Always Do',
    placeholder: 'e.g. End every post with a genuine question to drive comments\nMention our 45+ years legacy when relevant\nUse "we" not "I" — Arak speaks as a company',
    hint: 'Habits the AI should reach for by default.',
  },
  {
    key: 'toneDonts', label: 'Never Do',
    placeholder: 'e.g. "We are excited to announce"\n"In today\'s world"\nExclamation marks in headlines\nGeneric stock-photo language',
    hint: 'Banned phrases and patterns. Be specific — vague rules get ignored.',
  },
  {
    key: 'targetPersonas', label: 'Target Personas',
    placeholder: 'e.g. Architects and interior designers specifying for hospitality projects\nReal estate developers in KSA and the wider GCC\nMEP contractors evaluating suppliers',
    hint: 'Who the content is actually written for.',
  },
  {
    key: 'keyProjects', label: 'Key Projects & Clients to Reference',
    placeholder: 'e.g. King Fahad Airport\nRitz Carlton Riyadh\nNEOM hospitality lighting',
    hint: 'Landmark work the AI can credibly name-drop when relevant.',
  },
  {
    key: 'visualStyleNotes', label: 'Visual Style Defaults',
    placeholder: 'e.g. Prefer warm residential and facade/exterior styles over cool commercial\nAvoid harsh white light in generated imagery\nDefault to portrait crops for Instagram',
    hint: 'How AI-generated imagery should default to looking, before a user picks a style.',
  },
]

export function BrandBrain() {
  const { state, dispatch } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const isConfigured = !!activeWorkspaceId

  const [profile,  setProfile]  = useState(() => state.brandProfile || { ...DEFAULT_BRAND_PROFILE })
  const [loading,  setLoading]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [error,    setError]    = useState('')
  const [loaded,   setLoaded]   = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  useEffect(() => {
    if (!isConfigured || loaded) return
    setLoading(true)
    fetchBrandProfile(activeWorkspaceId, accessToken).then(p => {
      setLoading(false); setLoaded(true)
      if (p) { setProfile(p); dispatch(actions.setBrandProfile(p)) }
    })
  }, [isConfigured, loaded])

  const set = (k, v) => setProfile(p => ({ ...p, [k]: v }))

  async function handleSave() {
    setSaving(true); setError('')
    const result = await saveBrandProfile(activeWorkspaceId, accessToken, profile)
    setSaving(false)
    if (result.error) { setError(result.error); return }
    dispatch(actions.setBrandProfile(result.profile))
    dispatch(actions.addNotification({ id: uid(), message: 'Brand Brain profile saved.', createdAt: new Date().toISOString() }))
    setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const previewText = buildInstructionsString(profile, '')

  return (
    <div className="max-w-4xl space-y-5">

      <WarmCard className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-5 rounded-full btn-amber" />
          <p className="text-xs font-semibold text-amber-700 tracking-[0.12em] uppercase">Brand Brain</p>
        </div>
        <h1 className="font-display text-2xl font-bold text-stone-900 mb-2">One brand voice, every platform.</h1>
        <p className="text-sm text-text-secondary leading-relaxed max-w-xl">
          This profile feeds every AI generation call — Instagram, LinkedIn, and whatever comes next.
          Set it once here. Each platform's Create page can still add platform-specific notes on top,
          but they supplement this, they don't replace it.
        </p>
      </WarmCard>

      {!isConfigured && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3">
          <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-700">No active workspace</p>
            <p className="text-xs text-amber-600 mt-0.5">This shouldn't normally happen while signed in — try signing out and back in. If it persists, your account isn't attached to a workspace yet.</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 text-text-tertiary text-sm">Loading your brand profile…</div>
      )}

      {!loading && (
        <div className="space-y-4">
          {FIELDS.map(f => (
            <Card key={f.key} className="p-5">
              <p className="text-sm font-semibold text-text mb-1">{f.label}</p>
              <p className="text-xs text-text-tertiary mb-3">{f.hint}</p>
              {f.single ? (
                <Input placeholder={f.placeholder} value={profile[f.key] || ''} onChange={e => set(f.key, e.target.value)} />
              ) : (
                <Textarea placeholder={f.placeholder} value={profile[f.key] || ''} onChange={e => set(f.key, e.target.value)} rows={4} />
              )}
            </Card>
          ))}

          {error && <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-xs text-red-600">{error}</div>}

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={!isConfigured || saving} variant={saved ? 'secondary' : 'primary'}>
              {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save Brand Brain'}
            </Button>
            {profile.updatedAt && (
              <p className="text-xs text-text-tertiary">Last updated {new Date(profile.updatedAt).toLocaleString()}</p>
            )}
          </div>

          {/* Live preview of what actually gets sent to n8n */}
          <Card className="overflow-hidden">
            <button onClick={() => setShowPreview(v => !v)}
              className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-subtle transition-colors">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-stone-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-text">Preview what gets sent to n8n</p>
                  <p className="text-xs text-text-secondary">
                    {isBrandProfileEmpty(profile) ? 'Nothing yet — fill in at least one field above' : 'See the flattened instructions block'}
                  </p>
                </div>
              </div>
              <svg className={`w-4 h-4 text-text-tertiary transition-transform ${showPreview ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {showPreview && (
              <div className="px-5 pb-5 border-t border-border pt-4">
                <pre className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap bg-surface-subtle rounded-xl p-4 font-mono">
                  {previewText || '— empty —'}
                </pre>
                <p className="text-[11px] text-text-tertiary mt-2">Each platform's Create page appends its own platform-specific notes after this block.</p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}
