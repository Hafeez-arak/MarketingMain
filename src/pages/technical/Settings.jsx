import { useMemo, useState } from 'react'
import { useAuth } from '../../store/auth'
import { useT } from '../../lib/i18n'
import { Button } from '../../components/ui/index'
import { STAGES, stageMap } from '../../lib/technical/projects'
import { saveSettings } from '../../lib/technical/client'
import { W } from './words'
import { Frame, Box, field } from './parts'
import { useTechnical } from './data'

// ─── Technical → Stage limits (v2, Technical manage) ───────────────────────
// 2026-10-19. How many days a project may stay in each of the nine stages
// before it turns red, and when the reminders go out. The stages themselves
// are Odoo Project's: this shows which of Odoo's stage names matched which
// of the nine, and any that matched none.

export function TechnicalSettings() {
  const { t, lang, dir } = useT(W)
  const { user } = useAuth()
  const { data, error, reload, ws } = useTechnical()

  return (
    <div dir={dir} lang={lang}>
      <Frame title={t.setTitle} sub={t.setSub} data={data} error={error} width="max-w-3xl">
        {data && <SettingsForm key={data.settingsRow?.updated_at || 'defaults'} data={data} ws={ws} me={user?.id} reload={reload} t={t} lang={lang} />}
      </Frame>
    </div>
  )
}

function SettingsForm({ data, ws, me, reload, t, lang }) {
  const [form, setForm] = useState(() => structuredClone(data.settings))
  const [state, setState] = useState('')
  const odooStages = useMemo(() => data?.records?.['project.project.stage'] || [], [data])
  const map = useMemo(() => stageMap(odooStages), [odooStages])
  const unmatched = odooStages.filter(s => !map[s.id])

  async function save(e) {
    e.preventDefault()
    setState('busy')
    const out = await saveSettings(ws, me, form)
    setState(out.error ? `error:${out.error}` : 'saved')
    if (!out.error) reload()
  }
  const num = (v, set) => (
    <input type="number" min="1" max="365" required className={`${field.replace("w-full ", "")} !w-20 text-end tabular-nums`} value={v}
      onChange={e => { set(e.target.value); setState('') }} />
  )

  return (
          <form onSubmit={save} className="space-y-4">
            <Box title={t.stages}>
              <table className="w-full text-sm">
                <tbody>
                  {STAGES.map((s, i) => {
                    const names = odooStages.filter(o => map[o.id] === s.key).map(o => o.name)
                    return (
                      <tr key={s.key} className="border-t border-border first:border-0">
                        <td className="py-2 pe-3 text-text-tertiary tabular-nums w-6">{i + 1}</td>
                        <td className="py-2 pe-3">
                          <p className="text-text">{s[lang] || s.en}</p>
                          <p className="text-[11px] text-text-tertiary">{names.length ? `${t.odooNames}: ${names.join(', ')}` : '—'}</p>
                        </td>
                        <td className="py-2 text-end whitespace-nowrap">
                          {num(form.stage_days[s.key], v => setForm(f => ({ ...f, stage_days: { ...f.stage_days, [s.key]: v } })))} <span className="text-xs text-text-tertiary">{t.days}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {unmatched.length > 0 && (
                <p className="text-xs text-yellow-800 mt-3">{t.unmatched}: {unmatched.map(s => s.name).join(', ')}</p>
              )}
            </Box>
            <Box title={t.followUps}>
              {[['update_every_days', t.updateEvery], ['review_chase_days', t.chaseAfter], ['resubmit_days', t.resubmitIn]].map(([k, label]) => (
                <label key={k} className="flex flex-wrap items-center justify-between gap-2 py-2 border-t border-border first:border-0 text-sm text-text">
                  <span>{label}</span>
                  <span className="whitespace-nowrap">{num(form[k], v => setForm(f => ({ ...f, [k]: v })))} <span className="text-xs text-text-tertiary">{t.days}</span></span>
                </label>
              ))}
            </Box>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={state === 'busy'}>{t.save}</Button>
              {state === 'saved' && <span className="text-xs text-green-700">✓ {t.saved}</span>}
              {state.startsWith('error:') && <span className="text-xs text-red-700" dir="auto">{state.slice(6)}</span>}
            </div>
          </form>
  )
}
