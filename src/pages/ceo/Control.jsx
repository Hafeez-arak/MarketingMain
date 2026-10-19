import { useState } from 'react'
import { Button, Spinner } from '../../components/ui/index'
import { TONE_DOT } from './strings'

// ─── The control panel's tabs ──────────────────────────────────────────────
// 2026-10-18, from the CEO's requirements. Each tab draws one part of the
// server's answer (api/leads/_control.js → src/lib/control/panel.js); none
// of them computes a number itself. Buttons go through `act`, which runs
// the action and reloads the panel, so what he sees after a click is the
// server's word, not a guess.

const group = n => Math.round(Number(n) || 0).toLocaleString('en-US')

function sar(n, lang) {
  const v = Number(n) || 0
  const abs = Math.abs(v)
  const [x, en, ar] = abs >= 1e6 ? [v / 1e6, 'M', 'مليون'] : abs >= 1e3 ? [v / 1e3, 'K', 'ألف'] : [v, '', '']
  const num = abs >= 1e3 ? (Math.round(x * 10) / 10).toString() : group(v)
  return lang === 'ar' ? `${num}${ar ? ` ${ar}` : ''} ريال` : `SAR ${num}${en}`
}

const shortDate = (d, lang) => {
  const x = new Date(d)
  if (!d || Number.isNaN(x.getTime())) return '—'
  return x.toLocaleDateString(lang === 'ar' ? 'ar-SA-u-nu-latn-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: '2-digit' })
}

// ── Shared pieces ──

export function Tile({ k, lang, t }) {
  return (
    <div className="bg-white border border-border rounded-xl px-4 py-3 min-w-0">
      <p className="flex items-center gap-1.5 text-xs text-text-secondary leading-tight min-w-0">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${TONE_DOT[k.tone] || TONE_DOT.none}`} aria-hidden="true" />
        <span className="truncate">{k.label?.[lang]}</span>
      </p>
      <p className={`text-xl sm:text-2xl font-bold tabular-nums mt-1 leading-none ${k.tone === 'waiting' ? 'text-text-tertiary' : 'text-text'}`}
        dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {k.value?.[lang]}
      </p>
      <p className="text-[11px] text-text-secondary mt-1 leading-snug line-clamp-2">
        {k.tone === 'waiting' ? <span className="font-medium">{t.waiting} · </span> : null}{k.sub?.[lang]}
      </p>
    </div>
  )
}

/** Choose a salesperson, then confirm: the one button of an assign / send. */
function PersonPicker({ team, suggested, label, t, onPick }) {
  const [open, setOpen] = useState(false)
  const [who, setWho] = useState(suggested || '')
  if (!open) return <Button size="xs" onClick={() => setOpen(true)} disabled={!team.length}>{label}</Button>
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select value={who} onChange={e => setWho(e.target.value)} className="text-xs border border-border bg-white px-2 py-1" aria-label={t.assignTo}>
        <option value="">{t.pick}</option>
        {team.map(p => <option key={p.id} value={p.id}>{p.name}{p.id === suggested ? ` (${t.suggested})` : ''}</option>)}
      </select>
      <Button size="xs" disabled={!who} onClick={() => onPick(who)}>{label}</Button>
      <button type="button" className="text-xs text-text-tertiary hover:text-text" onClick={() => setOpen(false)}>{t.cancel}</button>
    </span>
  )
}

/** A button whose click runs `run` and shows busy / done / the error in place. */
function useAction(act) {
  const [state, setState] = useState({})
  const go = async (key, fn) => {
    setState(s => ({ ...s, [key]: 'busy' }))
    const out = await act(fn)
    setState(s => ({ ...s, [key]: out?.error ? `error:${out.error}` : 'done' }))
  }
  return [state, go]
}

function Status({ value, t }) {
  if (value === 'busy') return <Spinner size="sm" />
  if (value === 'done') return <span className="text-xs text-green-700">✓ {t.done}</span>
  if (value?.startsWith?.('error:')) return <span className="text-xs text-red-600" dir="auto">{value.slice(6)}</span>
  return null
}

// ── Home: six numbers and at most three decisions ──

export function HomeTab({ data, lang, t, act, calls }) {
  const [state, go] = useAction(act)
  const team = data.team || []
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {data.kpis.map(k => <Tile key={k.key} k={k} lang={lang} t={t} />)}
      </section>

      <section>
        <h2 className="eyebrow mb-2">{t.decisions}</h2>
        {data.decisions.length === 0 ? (
          <div className="border border-green-200 bg-green-50/60 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-green-700 text-lg" aria-hidden>✓</span>
            <div>
              <p className="text-sm font-semibold text-green-900">{t.allClear}</p>
              <p className="text-xs text-green-800">{t.allClearSub}</p>
            </div>
          </div>
        ) : (
          <ol className="space-y-2">
            {data.decisions.map((d, i) => {
              const s = state[d.key]
              const a = d.action
              return (
                <li key={d.key} className="bg-white border border-border rounded-xl px-4 py-3">
                  <div className="flex gap-3">
                    <span className="w-6 h-6 rounded-full bg-stone-100 text-text text-xs font-semibold flex items-center justify-center flex-shrink-0 tabular-nums">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-text leading-snug" dir="auto">{d.title[lang]}</p>
                      <p className="text-xs text-text-secondary mt-0.5 leading-snug" dir="auto">{d.why[lang]}</p>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mt-2">
                        <span className="text-[11px] text-text-tertiary">{t.owner}: <span className="text-text-secondary font-medium">{d.owner || t.nobody}</span></span>
                        {s && s !== 'busy' && !s.startsWith('error:') ? <Status value={s} t={t} /> : (
                          <>
                            {a.type === 'assign' && <PersonPicker team={team} suggested={a.suggested} label={t.assign} t={t}
                              onPick={who => go(d.key, () => calls.assign(a.leadId, who))} />}
                            {a.type === 'remind' && <Button size="xs" onClick={() => go(d.key, () => calls.remind(a.leadId))}>{t.remind(d.owner)}</Button>}
                            {a.type === 'contacted' && <Button size="xs" onClick={() => go(d.key, () => calls.contacted(a.accountId))}>{t.contacted}</Button>}
                            {a.type === 'send_to_sales' && <PersonPicker team={team} label={t.sendToSales} t={t}
                              onPick={who => go(d.key, () => calls.sendToSales(a.opportunityId, who))} />}
                            <Status value={s} t={t} />
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

// ── One row per salesperson ──

export function TeamTab({ data, lang, t }) {
  const reps = data.reps || []
  if (!reps.length) return <p className="text-sm text-text-tertiary">{t.noTeam}</p>
  return (
    <div className="bg-white border border-border rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] text-text-tertiary border-b border-border">
            <th className="text-start font-medium px-3 py-2">{t.rep}</th>
            <th className="text-end font-medium px-3 py-2">{t.open}</th>
            <th className="text-end font-medium px-3 py-2">{t.quotes}</th>
            <th className="text-end font-medium px-3 py-2">{t.late}</th>
            <th className="text-end font-medium px-3 py-2">{t.won}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {reps.map(r => (
            <tr key={r.id} className="align-top">
              <td className="px-3 py-2">
                <span className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${TONE_DOT[r.tone] || TONE_DOT.none}`} />
                  <span className="font-medium text-text">{r.name}</span>
                </span>
                {r.lateLeads?.length > 0 && (
                  <p className="text-[11px] text-red-700 mt-1 ps-4" dir="auto">{t.lateList}: {r.lateLeads.slice(0, 4).map(l => l.who).join('، ')}{r.lateLeads.length > 4 ? ` +${r.lateLeads.length - 4}` : ''}</p>
                )}
              </td>
              <td className="px-3 py-2 text-end tabular-nums">{group(r.open)}</td>
              <td className="px-3 py-2 text-end tabular-nums">{group(r.quotes)}</td>
              <td className={`px-3 py-2 text-end tabular-nums ${r.late ? 'text-red-700 font-semibold' : ''}`}>{group(r.late)}</td>
              <td className="px-3 py-2 text-end tabular-nums" title={r.wonValue === null ? t.wonWaits : undefined}>
                {r.wonValue === null ? <span className="text-text-tertiary">—</span> : sar(r.wonValue, lang)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── The top ten customers ──

export function AccountsTab({ data, lang, t, act, calls }) {
  const [state, go] = useAction(act)
  const rows = data.accounts || []
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">{t.accountsNote}</p>
      {!rows.length ? <p className="text-sm text-text-tertiary">{t.noAccounts}</p> : (
        <ul className="space-y-2">
          {rows.map(a => (
            <li key={a.id} className="bg-white border border-border rounded-xl px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-semibold text-text" dir="auto">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${TONE_DOT[a.tone] || TONE_DOT.none}`} aria-hidden="true" />
                    {a.name}
                  </p>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    {t.owner}: {a.owner || t.nobody}
                  </p>
                </div>
                {state[a.id] ? <Status value={state[a.id]} t={t} /> : (
                  <Button size="xs" variant="secondary" onClick={() => go(a.id, () => calls.contacted(a.id))}>{t.contacted}</Button>
                )}
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 mt-2 text-[11px]">
                <div><dt className="text-text-tertiary">{t.lastOrder}</dt><dd className="text-text tabular-nums">{shortDate(a.last_order, lang)}</dd></div>
                <div><dt className="text-text-tertiary">{t.openDeals}</dt><dd className="text-text tabular-nums">{group(a.open_deals)}{a.open_value_sar ? ` · ${sar(a.open_value_sar, lang)}` : ''}</dd></div>
                <div><dt className="text-text-tertiary">{t.nextStep}</dt><dd className={`tabular-nums ${a.nextOverdue ? 'text-red-700 font-medium' : 'text-text'}`}>{shortDate(a.next_step_on, lang)}{a.nextOverdue ? ` · ${t.overdue}` : ''}</dd></div>
                <div><dt className="text-text-tertiary">{t.lastContact}</dt><dd className={a.tone === 'bad' ? 'text-red-700 font-medium' : 'text-text'}>{a.quietDays === null ? t.never : t.daysAgo(a.quietDays)}</dd></div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── New projects from the research, five a week ──

export function OpportunitiesTab({ data, lang, t, act, calls }) {
  const [state, go] = useAction(act)
  const rows = data.opportunities || []
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">{t.oppsNote}</p>
      {!rows.length ? <p className="text-sm text-text-tertiary">{t.noOpps}</p> : (
        <ul className="space-y-2">
          {rows.map(o => (
            <li key={o.id} className="bg-white border border-border px-3 py-2.5">
              <p className="text-sm font-semibold text-text" dir="auto">{o.name}</p>
              <p className="text-xs text-text-secondary mt-0.5" dir="auto">
                {[o.client, o.location, o.stage, o.deadline && shortDate(o.deadline, lang)].filter(Boolean).join(' · ')}
              </p>
              {o.package_value_sar ? <p className="text-xs text-text mt-1">{t.share}: <span className="font-medium">{sar(o.package_value_sar, lang)}</span>{o.package ? ` · ${o.package}` : ''}</p> : null}
              {o.suggested_action && <p className="text-xs text-text-secondary mt-1" dir="auto">{lang === 'ar' ? '←' : '→'} {o.suggested_action}</p>}
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {state[o.id] ? <Status value={state[o.id]} t={t} /> : (
                  <PersonPicker team={data.team || []} label={t.sendToSales} t={t} onPick={who => go(o.id, () => calls.sendToSales(o.id, who))} />
                )}
                {o.source_url && <a href={o.source_url} target="_blank" rel="noreferrer" className="text-xs text-text underline-offset-2 hover:underline">{t.source}</a>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Marketing in three numbers ──

export function MarketingTab({ data, lang, t }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-secondary">{t.marketingNote}</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {(data.marketing || []).map(k => <Tile key={k.key} k={k} lang={lang} t={t} />)}
      </div>
    </div>
  )
}
