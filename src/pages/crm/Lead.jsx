import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { Button, Skeleton } from '../../components/ui/index'
import { useT, fmtDay } from '../../lib/i18n'
import {
  ACTIVITY_TYPES, listName, orgName, partyOf, weighted, fmtMoney, riyadhToday, recordActivities, validateActivity, describeHistory,
} from '../../lib/crm/logic'
import {
  fetchLead, fetchLeadTags, fetchActivities, fetchHistory, patchLead, deleteLead, addActivity, markActivityDone, deleteActivity,
} from '../../lib/crm/client'
import { fetchOrgs, fetchCategories, createOrg } from '../../lib/contacts/client'
import { RW } from './words'
import { useCrmBase, field, fieldInline } from './useCrmBase'
import { Dialog, Stars, TagChips, StatusBadge, BidChip, DueDate, NoAccess } from './parts'
import { OrgForm } from '../contacts/parts'

// ─── CRM → one opportunity (v2) ────────────────────────────────────────────
// 2026-10-28, dev/erp-pilot/CRM.md. Musa's opportunity record: the actions
// (edit, won, lost with a reason, reopen, delete), the stage bar (click a
// stage to move), the details, the client (link an organisation from
// Contacts, or create one from the opportunity's details with Contacts' own
// form and duplicate guard), the activities (plan, mark done with an
// outcome, delete a planned one) and, for managers, the activity log.
// Quotations, pricing sheets, technical offers, bank guarantees and tasks
// on the opportunity wait for those modules (CRM.md).

function Facts({ rows }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm content-start">
      {rows.map(([label, value, ltr, title]) => (
        <div key={label} className="contents">
          <dt className="text-text-tertiary text-xs pt-0.5">{label}</dt>
          <dd className="text-text break-words" dir={ltr ? 'ltr' : 'auto'} style={ltr ? { textAlign: 'start' } : undefined} title={title}>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CrmLead() {
  const { canSection, user } = useAuth()
  const { t: w, lang, dir } = useT(RW)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('id') || ''
  const { ws, base, stagesById, sourcesById, reasonsById, tagsById, peopleById, clientsById, error: baseError, reload: reloadBase } = useCrmBase()
  const [lead, setLead] = useState(undefined) // undefined loading · null gone
  const [tagIds, setTagIds] = useState([])
  const [acts, setActs] = useState([])
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [losing, setLosing] = useState(false)
  const [loss, setLoss] = useState({ reason: '', note: '' })
  const [pick, setPick] = useState('')
  const [creating, setCreating] = useState(null) // null | { orgs, categories }
  const [outcomes, setOutcomes] = useState({})
  const [plan, setPlan] = useState(null)
  const [planTried, setPlanTried] = useState(false)
  const today = riyadhToday()
  const canManage = canSection('crm', 'manage')

  const load = useCallback(async () => {
    if (!ws || !id) return
    const [l, t, a, h] = await Promise.all([
      fetchLead(ws, id), fetchLeadTags(ws, { leadId: id }), fetchActivities(ws, { leadId: id }),
      canManage ? fetchHistory(ws, id) : Promise.resolve({ rows: [] }),
    ])
    setLead(l.lead || null)
    setTagIds(t.rows.map(r => r.tag_id))
    setActs(a.rows)
    setHistory(h.rows)
    if (l.error) setError(l.error)
  }, [ws, id, canManage])
  useEffect(() => { queueMicrotask(load) }, [load])

  const people = useMemo(() => base?.people || [], [base])
  // The activity form starts on today, for the opportunity's owner (or me).
  useEffect(() => {
    if (!lead || plan) return
    const who = [lead.assigned_to, user?.id].find(u => people.some(p => p.user_id === u)) || ''
    queueMicrotask(() => setPlan({ activity_type: 'call', summary: '', due_date: today, assigned_to: who }))
  }, [lead, plan, people, user?.id, today])

  if (!canSection('crm', 'view')) return <NoAccess />
  if (lead === undefined || !base) return <Skeleton className="h-64 max-w-5xl" />
  if (!lead) {
    return (
      <div className="space-y-3" dir={dir} lang={lang}>
        <Link to="/crm" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>
        <p className="text-sm text-text-secondary">{error || w.leadGone}</p>
      </div>
    )
  }

  const open = lead.status === 'open'
  const canWork = canSection('crm', 'work')
  const client = clientsById[lead.client_org_id]
  const tags = tagIds.map(t => tagsById[t]).filter(Boolean).sort((a, b) => listName(a, lang).localeCompare(listName(b, lang)))
  const stages = base.stages.filter(s => s.is_active || s.id === lead.stage_id)
    .sort((a, b) => (a.sequence - b.sequence) || String(a.created_at).localeCompare(String(b.created_at)))
  const curIdx = stages.findIndex(s => s.id === lead.stage_id)
  const reasons = base.reasons.filter(r => r.is_active).sort((a, b) => listName(a, lang).localeCompare(listName(b, lang)))
  const pickable = base.clients.filter(c => c.status === 'active').sort((a, b) => orgName(a, lang).localeCompare(orgName(b, lang)))
  const ordered = recordActivities(acts)
  const plannedCount = acts.filter(a => !a.done_at).length
  const name = uid => peopleById[uid]?.name || ''
  const stamp = ts => fmtDay(ts, lang, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  async function act(fn) {
    setBusy(true); setError('')
    const out = await fn()
    setBusy(false)
    if (out?.error) setError(out.error)
    return out
  }
  const change = patch => act(async () => { const out = await patchLead(ws, lead.id, patch); if (!out.error) await load(); return out })

  async function startCreateClient() {
    const [o, c] = await Promise.all([fetchOrgs(ws), fetchCategories(ws)])
    setCreating({ orgs: o.rows, categories: c.rows })
  }
  const clientDraft = {
    kind: lead.organization ? 'company' : 'individual',
    name: lead.organization || lead.contact_name || '',
    roles: ['client'],
    phone: lead.phone || '', email: lead.email || '', city: lead.city || '',
    notes: lead.organization && lead.contact_name ? `${w.f.contact}: ${lead.contact_name}` : '',
  }

  // The activity log, in the reader's words.
  const show = (f, v) => {
    if (f === 'stage_id') return listName(stagesById[v], lang) || v
    if (f === 'source_id') return listName(sourcesById[v], lang) || v
    if (f === 'lost_reason_id') return listName(reasonsById[v], lang) || v
    if (f === 'client_org_id') return orgName(clientsById[v], lang) || v
    if (['assigned_to', 'closed_by', 'done_by'].includes(f)) return name(v) || v
    if (f === 'status') return w.statuses[v] || v
    if (f === 'activity_type') return w.types[v] || v
    if (f === 'priority') return Number(v) ? '★'.repeat(Number(v)) : w.normal
    if (['closed_at', 'done_at'].includes(f)) return stamp(v)
    return v
  }

  const planErrors = plan ? validateActivity(plan) : {}

  return (
    <div className="max-w-5xl space-y-4" dir={dir} lang={lang}>
      <Link to="/crm" className="text-xs text-text-secondary hover:text-text">{w.back}</Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {canWork && open && <Button size="sm" variant="secondary" onClick={() => navigate(`/crm/edit?id=${lead.id}`)}>{w.edit}</Button>}
          {canWork && open && lead.client_org_id && (
            <Button size="sm" disabled={busy} onClick={() => window.confirm(w.confirmWon) && change({ status: 'won' })}>{w.markWon}</Button>
          )}
          {canWork && open && <Button size="sm" variant="secondary" onClick={() => setLosing(x => !x)} aria-expanded={losing}><span className="text-red-700">{w.markLost}</span></Button>}
          {canWork && lead.status === 'lost' && <Button size="sm" disabled={busy} onClick={() => change({ status: 'open' })}>{w.reopen}</Button>}
          {canWork && open && (
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => window.confirm(w.confirmDelete) && act(async () => { const out = await deleteLead(ws, lead.id); if (!out.error) navigate('/crm'); return out })}>
              <span className="text-red-700">{w.delete}</span>
            </Button>
          )}
        </div>
        {open && canWork ? (
          <nav className="flex flex-wrap" aria-label={w.stageBar}>
            {stages.map((s, i) => (
              <button key={s.id} type="button" disabled={busy || i === curIdx || !s.is_active} onClick={() => change({ stage_id: s.id })}
                aria-current={i === curIdx ? 'step' : undefined}
                className={`text-xs px-3 py-1.5 border -ms-px first:ms-0 first:rounded-s-md last:rounded-e-md ${i === curIdx ? 'bg-stone-900 text-white border-stone-900'
                  : i < curIdx ? 'bg-stone-100 text-text border-border hover:bg-stone-200' : 'bg-white text-text-secondary border-border hover:bg-stone-50'} disabled:cursor-default`}>
                <bdi>{listName(s, lang)}</bdi>
              </button>
            ))}
          </nav>
        ) : (
          <p className="flex items-center gap-2 text-xs"><StatusBadge status={lead.status} /> <bdi className="text-text-tertiary">{listName(stagesById[lead.stage_id], lang)}</bdi></p>
        )}
      </div>

      {losing && open && canWork && (
        <div className="bg-white border border-border p-3 space-y-2 max-w-md">
          {!reasons.length ? <p className="text-xs text-text-secondary">{w.noReasons}</p> : (
            <>
              <label className="block">
                <span className="text-[11px] text-text-secondary">{w.lostReason} *</span>
                <select value={loss.reason} onChange={e => setLoss(x => ({ ...x, reason: e.target.value }))} className={field}>
                  <option value="" />
                  {reasons.map(r => <option key={r.id} value={r.id}>{listName(r, lang)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-[11px] text-text-secondary">{w.lostDetails}</span>
                <textarea value={loss.note} onChange={e => setLoss(x => ({ ...x, note: e.target.value }))} rows={2} maxLength={2000} className={field} dir="auto" />
              </label>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy || !loss.reason}
                  onClick={async () => { const out = await change({ status: 'lost', lost_reason_id: loss.reason, lost_note: loss.note.trim() || null }); if (!out.error) setLosing(false) }}>
                  {w.recordLoss}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setLosing(false)}>{w.cancel}</Button>
              </div>
            </>
          )}
        </div>
      )}

      {(error || baseError) && <p className="text-xs text-red-600" dir="auto" role="alert">{error || baseError}</p>}

      <section className="relative bg-white border border-border p-4 space-y-3 overflow-hidden">
        {lead.status !== 'open' && (
          <span className={`absolute top-3 end-3 text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded ${lead.status === 'won' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
            {lead.status === 'won' ? w.wonRibbon : w.lostRibbon}
          </span>
        )}
        <div>
          <h1 className="text-xl font-semibold text-text pe-20"><Stars n={lead.priority} /> <bdi>{lead.title}</bdi></h1>
          <p className="text-sm text-text-secondary"><bdi dir="ltr">{lead.lead_no}</bdi> · <bdi>{partyOf(lead, clientsById, lang) || '—'}</bdi></p>
          {tags.length > 0 && <div className="mt-1.5"><TagChips tags={tags} /></div>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
          <Facts rows={[
            [w.f.client, client && (canSection('contacts', 'view') ? <Link to={`/contacts/org?id=${client.id}`} className="underline"><bdi>{orgName(client, lang)}</bdi></Link> : <bdi>{orgName(client, lang)}</bdi>)],
            [w.f.organization, lead.organization],
            [w.f.contact, lead.contact_name],
            [w.f.phone, lead.phone, true],
            [w.f.email, lead.email, true],
            [w.f.city, lead.city],
            [w.f.consultant, lead.consultant],
            [w.f.owner, lead.project_owner],
          ]} />
          <Facts rows={[
            [w.f.assignee, name(lead.assigned_to)],
            [w.f.source, listName(sourcesById[lead.source_id], lang)],
            [w.f.value, fmtMoney(lead.expected_revenue), true],
            [w.f.probability, lead.probability == null ? '—' : `${lead.probability}%`, true],
            [w.f.weighted, fmtMoney(weighted(lead)), true, w.f.weightedHint],
            [w.f.closeDate, lead.expected_close_date, true],
            [w.f.bidDate, open && lead.bid_due_date ? <BidChip lead={lead} today={today} label={false} /> : lead.bid_due_date, true],
            [w.f.tenderRef, lead.tender_ref],
          ]} />
        </div>
        {lead.status === 'lost' && (
          <p className="text-sm"><span className="text-text-tertiary">{w.lostBecause}</span> <strong><bdi>{listName(reasonsById[lead.lost_reason_id], lang)}</bdi></strong>{lead.lost_note && <> — <bdi>{lead.lost_note}</bdi></>}</p>
        )}
        {lead.closed_at && <p className="text-xs text-text-tertiary">{w.closedAt(stamp(lead.closed_at))}</p>}
        {lead.notes && <p className="text-sm whitespace-pre-wrap"><span className="text-text-tertiary">{w.notesLabel}</span> <bdi>{lead.notes}</bdi></p>}
      </section>

      <section className="bg-white border border-border p-4 space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.clientCard}</h2>
        {!client ? (
          <>
            <p className="text-xs text-text-secondary">{w.noClientYet}</p>
            {canWork && open && (
              <div className="flex flex-wrap items-center gap-2">
                {canSection('contacts', 'work') && (lead.organization || lead.contact_name) && (
                  <Button size="sm" variant="secondary" onClick={startCreateClient}>{w.createClient}</Button>
                )}
                {pickable.length > 0 && (
                  <span className="inline-flex items-center gap-1.5">
                    <select value={pick} onChange={e => setPick(e.target.value)} className={fieldInline} aria-label={w.pickClient}>
                      <option value="">{w.pickClient}</option>
                      {pickable.map(c => <option key={c.id} value={c.id}>{orgName(c, lang)} ({c.contact_no})</option>)}
                    </select>
                    <Button size="sm" variant="secondary" disabled={!pick || busy}
                      onClick={async () => { const out = await change({ client_org_id: pick }); if (!out.error) { setPick(''); reloadBase() } }}>{w.link}</Button>
                  </span>
                )}
              </div>
            )}
          </>
        ) : (
          <p className="text-sm">
            {canSection('contacts', 'view') ? <Link to={`/contacts/org?id=${client.id}`} className="underline"><bdi>{orgName(client, lang)}</bdi></Link> : <bdi>{orgName(client, lang)}</bdi>}
            {' '}<bdi dir="ltr" className="text-text-tertiary text-xs">{client.contact_no}</bdi>
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{w.activities} <span className="font-normal text-text-tertiary">{w.planned(plannedCount)}</span></h2>
        {!ordered.length ? <p className="text-xs text-text-tertiary">{w.noActivities}</p> : (
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                {['type', 'summary', 'due', 'assignee', 'outcome'].map(c => <th key={c} className="text-start font-medium px-3 py-2">{w.actCols[c]}</th>)}
                <th />
              </tr></thead>
              <tbody className="divide-y divide-border">
                {ordered.map(a => (
                  <tr key={a.id} className={`align-top ${a.done_at ? 'text-text-tertiary' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{w.types[a.activity_type]}</td>
                    <td className="px-3 py-2"><bdi>{a.summary}</bdi></td>
                    <td className="px-3 py-2 whitespace-nowrap"><DueDate date={a.due_date} today={today} done={Boolean(a.done_at)} /></td>
                    <td className="px-3 py-2 whitespace-nowrap"><bdi>{name(a.assigned_to) || '—'}</bdi></td>
                    <td className="px-3 py-2 min-w-[12rem]">
                      {a.done_at ? (
                        <>
                          <span className="text-[11px] px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-800">{w.doneBadge}</span>
                          {a.outcome && <bdi className="ms-1.5 text-text">{a.outcome}</bdi>}
                          <p className="text-[11px]">{stamp(a.done_at)}</p>
                        </>
                      ) : canWork ? (
                        <span className="flex gap-1.5">
                          <input value={outcomes[a.id] || ''} onChange={e => setOutcomes(x => ({ ...x, [a.id]: e.target.value }))} placeholder={w.outcomePh}
                            aria-label={w.outcomePh} maxLength={2000} className={`${fieldInline} min-w-[8rem] flex-1 py-1 text-xs`} dir="auto" />
                          <Button size="xs" disabled={busy}
                            onClick={() => act(async () => { const out = await markActivityDone(ws, a.id, outcomes[a.id]); if (!out.error) await load(); return out })}>{w.doneBtn}</Button>
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {!a.done_at && canWork && (
                        <button type="button" title={w.removeActivity} aria-label={w.removeActivity} className="text-red-700 px-1.5 hover:bg-red-50 rounded"
                          onClick={() => window.confirm(w.confirmDeleteActivity) && act(async () => { const out = await deleteActivity(ws, a.id); if (!out.error) await load(); return out })}>×</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canWork && open && plan && (
          <form className="bg-white border border-border p-3 grid grid-cols-1 sm:grid-cols-[auto_1fr_auto_auto_auto] gap-2 items-end" noValidate
            onSubmit={async e => {
              e.preventDefault()
              setPlanTried(true)
              if (Object.keys(planErrors).length) return
              const out = await act(() => addActivity(ws, lead.id, plan))
              if (!out.error) { setPlan(p => ({ ...p, summary: '' })); setPlanTried(false); await load() }
            }}>
            <label className="block">
              <span className="text-[11px] text-text-secondary">{w.addType}</span>
              <select value={plan.activity_type} onChange={e => setPlan(p => ({ ...p, activity_type: e.target.value }))} className={field}>
                {ACTIVITY_TYPES.map(t => <option key={t} value={t}>{w.types[t]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-text-secondary">{w.addSummary} *</span>
              <input value={plan.summary} onChange={e => setPlan(p => ({ ...p, summary: e.target.value }))} placeholder={w.addSummaryPh} maxLength={500} className={field} dir="auto"
                aria-invalid={planTried && Boolean(planErrors.summary)} />
              {planTried && planErrors.summary && <span className="block text-[11px] text-red-600">{w.errors[planErrors.summary]}</span>}
            </label>
            <label className="block">
              <span className="text-[11px] text-text-secondary">{w.addDue} *</span>
              <input type="date" value={plan.due_date} onChange={e => setPlan(p => ({ ...p, due_date: e.target.value }))} className={field} dir="ltr" />
            </label>
            <label className="block">
              <span className="text-[11px] text-text-secondary">{w.addAssignee} *</span>
              <select value={plan.assigned_to} onChange={e => setPlan(p => ({ ...p, assigned_to: e.target.value }))} className={field}>
                {!plan.assigned_to && <option value="" />}
                {people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select>
              {planTried && planErrors.assigned_to && <span className="block text-[11px] text-red-600">{w.errors.required}</span>}
            </label>
            <Button type="submit" size="sm" disabled={busy}>{w.addActivity}</Button>
          </form>
        )}
      </section>

      {canManage && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text">{w.history}</h2>
          {!history.length ? <p className="text-xs text-text-tertiary">{w.noHistory}</p> : (
            <ol className="bg-white border border-border divide-y divide-border">
              {history.map(r => {
                const d = describeHistory(r, show)
                return (
                  <li key={r.id} className="px-3 py-2 text-xs">
                    <p className="flex flex-wrap gap-x-2 text-text">
                      <strong className="font-medium">{r.actor ? name(r.actor) || w.someone : w.system}</strong>
                      <span>{w.historyActions[d.who][d.action]}{d.who === 'activity' && <> <bdi>{d.label}</bdi></>}</span>
                      <time className="text-text-tertiary ms-auto" dateTime={r.at}>{stamp(r.at)}</time>
                    </p>
                    {d.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-text-secondary">
                        {d.changes.map(([f, from, to]) => (
                          <li key={f}>{w.fieldNames[f] || f}: <del className="text-text-tertiary"><bdi>{from}</bdi></del> {dir === 'rtl' ? '←' : '→'} <bdi>{to}</bdi></li>
                        ))}
                      </ul>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </section>
      )}

      {creating && (
        <Dialog title={w.newClientTitle} onClose={() => setCreating(null)} wide>
          <OrgForm initial={clientDraft} orgs={creating.orgs} categories={creating.categories} onCancel={() => setCreating(null)}
            onSubmit={async f => {
              const made = await createOrg(ws, f)
              if (made.error) return made
              const out = await patchLead(ws, lead.id, { client_org_id: made.org.id })
              if (out.error) return out
              setCreating(null)
              await Promise.all([reloadBase(), load()])
              return out
            }} />
        </Dialog>
      )}
    </div>
  )
}
