import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'

// ─── Targets, who is emailed, and the routing rules ────────────────────────
// 2026-10-18. Requirement 14: "a settings page where I set the monthly
// targets; colours depend on my targets". Requirement 3: every qualified
// lead gets an owner by customer type or region; the owner chose a rules
// table they fill in. Saved through /api/leads/targets_save and
// /routing_save (api/leads/_control.js), which check every value again.

const SENDER_KEYS = ['contractor', 'developer_owner', 'consultant', 'end_client', 'facility_company', 'individual']
const PROJECT_KEYS = ['jih', 'tender', 'maintenance']

const NUMBERS = [
  ['revenue_month_sar', 'revenue'],
  ['pipeline_sar', 'pipeline'],
  ['quotes_week', 'quotesWeek'],
  ['win_rate_pct', 'winRate'],
  ['first_reply_hours', 'firstReply'],
  ['quote_hours', 'quoteHours'],
  ['key_account_quiet_days', 'quietDays'],
  ['amber_pct', 'amber'],
]

const asText = v => (v === null || v === undefined ? '' : String(v))

export function TargetsTab({ data, lang, t, canEdit, calls, onSaved }) {
  const tg = data.targets || {}
  const [form, setForm] = useState(() => ({
    ...Object.fromEntries(NUMBERS.map(([k]) => [k, asText(tg[k])])),
    brief_emails: (tg.brief_emails || []).join(', '),
    alert_emails: (tg.alert_emails || []).join(', '),
    routing_enabled: Boolean(tg.routing_enabled),
    routing_fallback: tg.routing_fallback || '',
  }))
  const [rules, setRules] = useState(() => (data.rules || []).map(r => ({
    sender_type: r.sender_type || '', region: r.region || '', project_type: r.project_type || '', assign_to: r.assign_to || '',
  })))
  const [state, setState] = useState('')
  const team = data.team || []
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setRule = (i, k, v) => setRules(rs => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  async function save() {
    setState('busy')
    const a = await calls.saveTargets(form)
    if (a.error) { setState(`error:${a.error}`); return }
    const b = await calls.saveRouting(rules)
    if (b.error) { setState(`error:${b.error}`); return }
    setState('saved')
    onSaved()
  }

  const input = 'w-full border border-border bg-white px-2 py-1.5 text-sm disabled:bg-surface-muted'
  const select = 'border border-border bg-white px-2 py-1.5 text-sm min-w-0 w-full disabled:bg-surface-muted'

  return (
    <div className="space-y-5 max-w-3xl">
      {!canEdit && <p className="text-xs text-text-tertiary">{t.adminOnly}</p>}

      <section className="bg-white border border-border px-4 py-4">
        <h2 className="text-sm font-semibold text-text">{t.targetsTitle}</h2>
        <p className="text-xs text-text-secondary mt-1 mb-3">{t.targetsNote}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {NUMBERS.map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-[11px] text-text-secondary">{t[label]}</span>
              <input type="number" min="0" inputMode="decimal" dir="ltr" value={form[k]} disabled={!canEdit}
                onChange={e => set(k, e.target.value)} className={input} />
            </label>
          ))}
        </div>
      </section>

      <section className="bg-white border border-border px-4 py-4">
        <h2 className="text-sm font-semibold text-text mb-3">{t.emailsTitle}</h2>
        <div className="grid grid-cols-1 gap-3">
          {[['brief_emails', t.briefEmails], ['alert_emails', t.alertEmails]].map(([k, label]) => (
            <label key={k} className="block">
              <span className="text-[11px] text-text-secondary">{label}</span>
              <input type="text" dir="ltr" value={form[k]} placeholder={t.emailsHint} disabled={!canEdit}
                onChange={e => set(k, e.target.value)} className={input} />
            </label>
          ))}
        </div>
      </section>

      <section className="bg-white border border-border px-4 py-4">
        <h2 className="text-sm font-semibold text-text">{t.routingTitle}</h2>
        <p className="text-xs text-text-secondary mt-1 mb-3">{t.routingNote}</p>
        <label className="flex items-center gap-2 text-sm text-text mb-3">
          <input type="checkbox" checked={form.routing_enabled} disabled={!canEdit} onChange={e => set('routing_enabled', e.target.checked)} />
          {t.routingOn}
        </label>

        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-2 items-end border border-border px-2 py-2">
              <label className="min-w-0"><span className="text-[11px] text-text-tertiary">{t.senderType}</span>
                <select value={r.sender_type} disabled={!canEdit} onChange={e => setRule(i, 'sender_type', e.target.value)} className={select}>
                  <option value="">{t.any}</option>
                  {SENDER_KEYS.map(k => <option key={k} value={k}>{t.senderTypes[k]}</option>)}
                </select>
              </label>
              <label className="min-w-0"><span className="text-[11px] text-text-tertiary">{t.region}</span>
                <select value={r.region} disabled={!canEdit} onChange={e => setRule(i, 'region', e.target.value)} className={select}>
                  <option value="">{t.any}</option>
                  {(data.regions || []).map(g => <option key={g.key} value={g.key}>{g[lang]}</option>)}
                </select>
              </label>
              <label className="min-w-0"><span className="text-[11px] text-text-tertiary">{t.projectType}</span>
                <select value={r.project_type} disabled={!canEdit} onChange={e => setRule(i, 'project_type', e.target.value)} className={select}>
                  <option value="">{t.any}</option>
                  {PROJECT_KEYS.map(k => <option key={k} value={k}>{t.projectTypes[k]}</option>)}
                </select>
              </label>
              <label className="min-w-0"><span className="text-[11px] text-text-tertiary">{t.person}</span>
                <select value={r.assign_to} disabled={!canEdit} onChange={e => setRule(i, 'assign_to', e.target.value)} className={select}>
                  <option value="">{t.pick}</option>
                  {team.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              {canEdit && (
                <button type="button" onClick={() => setRules(rs => rs.filter((_, j) => j !== i))}
                  className="text-xs text-red-700 hover:underline justify-self-start sm:justify-self-auto py-1.5">{t.remove}</button>
              )}
            </div>
          ))}
          {canEdit && <Button size="xs" variant="secondary" onClick={() => setRules(rs => [...rs, { sender_type: '', region: '', project_type: '', assign_to: '' }])}>{t.addRule}</Button>}
        </div>

        <label className="block mt-4 max-w-xs">
          <span className="text-[11px] text-text-secondary">{t.fallback}</span>
          <select value={form.routing_fallback} disabled={!canEdit} onChange={e => set('routing_fallback', e.target.value)} className={select}>
            <option value="">{t.fallbackNone}</option>
            {team.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </section>

      {canEdit && (
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={state === 'busy'}>{state === 'busy' ? <Spinner size="sm" /> : t.save}</Button>
          {state === 'saved' && <span className="text-xs text-green-700">✓ {t.saved}</span>}
          {state.startsWith('error:') && <span className="text-xs text-red-600" dir="auto">{state.slice(6)}</span>}
        </div>
      )}
    </div>
  )
}
