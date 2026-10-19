import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { useT, fmtDay } from '../../lib/i18n'
import { Button } from '../../components/ui/index'
import { odooLink } from '../../lib/odooMirror'
import { STAGES, CODES, stageIndex } from '../../lib/technical/projects'
import { projectTasks, addSubmittal, setSubmittal, deleteSubmittal, writeUpdate } from '../../lib/technical/client'
import { W } from './words'
import { Frame, Dot, Box, Reasons, Note, field } from './parts'
import { useTechnical, useCanWork } from './data'

// ─── Technical → one project (v2) ──────────────────────────────────────────
// 2026-10-19. A project as Odoo has it (stage, manager, customer, dates)
// with what Campai watches: when it entered each of the nine stages, the
// client's submittal rounds and their codes, the weekly updates, and the
// reminders and follow-ups made for it. Recording is for the project's
// manager and the Technical manager; the database refuses anyone else.

const longDay = (v, lang) => fmtDay(v, lang, { day: 'numeric', month: 'short', year: 'numeric' })
const todayRiyadh = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10)

export function TechnicalProject() {
  const { t, lang, dir } = useT(W)
  const [params] = useSearchParams()
  const id = Number(params.get('id'))
  const { data, error, reload, ws } = useTechnical()
  const canWork = useCanWork(data)
  const project = data?.board?.find(p => p.id === id)

  return (
    <div dir={dir} lang={lang}>
      <Frame title={project?.name || t.projectsTitle} data={data} error={error} width="max-w-4xl"
        sub={project ? [project.customer, project.pm && `${t.pm}: ${project.pm}`, project.endDate && `${t.delivery}: ${longDay(project.endDate, lang)}`].filter(Boolean).join(' · ') : null}
        actions={<>
          <Link to="/technical" className="text-xs text-text-secondary hover:text-text">{lang === 'ar' ? '→' : '←'} {t.back}</Link>
          {project && data?.sync?.odoo_url && (
            <a href={odooLink(data.sync.odoo_url, 'project.project', project.id)} target="_blank" rel="noreferrer"
              className="text-xs font-medium text-text border border-border rounded-md px-2.5 py-1 hover:bg-surface-subtle">{t.openInOdoo}</a>
          )}
        </>}>
        {!project ? <Note>{t.notFound}</Note> : (
          <div className="space-y-4">
            {!canWork(project) && <p className="text-[11px] text-text-tertiary">{t.canOnlyView}</p>}
            {project.health.reasons.length > 0 && (
              <div className={`border rounded-xl px-4 py-3 ${project.health.level === 'red' ? 'border-red-200 bg-red-50/60' : 'border-yellow-200 bg-yellow-50/60'}`}>
                <p className="flex items-center gap-2 text-xs font-semibold text-text mb-1"><Dot level={project.health.level} /> {t[project.health.level]}</p>
                <Reasons reasons={project.health.reasons} t={t} max={10} />
              </div>
            )}
            <Stages project={project} log={data.log.filter(l => Number(l.odoo_project_id) === id)} settings={data.settings} t={t} lang={lang} />
            <Submittals project={project} canWork={canWork(project)} ws={ws} reload={reload} t={t} lang={lang} />
            <Updates project={project} campai={data.updates.filter(u => Number(u.odoo_project_id) === id)}
              odoo={(data.records['project.update'] || []).filter(u => Array.isArray(u.project_id) && u.project_id[0] === id)}
              every={data.settings.update_every_days} canWork={canWork(project)} ws={ws} reload={reload} t={t} lang={lang} />
            <FollowUps ws={ws} projectId={id} t={t} lang={lang} names={data.names} stamp={data.now} />
          </div>
        )}
      </Frame>
    </div>
  )
}

// ── The nine stages, with when each was entered ──
function Stages({ project, log, settings, t, lang }) {
  const at = stageIndex(project.stageKey)
  const firstEntry = key => log.filter(l => l.stage_key === key).sort((a, b) => a.entered_at.localeCompare(b.entered_at))[0]
  return (
    <Box title={t.stages}>
      <ol className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-9 gap-2">
        {STAGES.map((s, i) => {
          const entry = firstEntry(s.key)
          const current = i === at
          const tone = current ? (project.health.level === 'red' ? 'border-red-300 bg-red-50' : project.health.level === 'amber' ? 'border-yellow-300 bg-yellow-50' : 'border-stone-800 bg-stone-50') : i < at ? 'border-border bg-surface-subtle' : 'border-dashed border-border bg-white'
          return (
            <li key={s.key} className={`rounded-lg border px-2.5 py-2 ${tone}`} aria-current={current ? 'step' : undefined}>
              <p className="text-[10px] text-text-tertiary tabular-nums">{i + 1}</p>
              <p className={`text-[11px] leading-tight ${current ? 'font-semibold text-text' : i < at ? 'text-text-secondary' : 'text-text-tertiary'}`}>{s[lang] || s.en}</p>
              {entry && (i <= at) && (
                <p className="text-[10px] text-text-tertiary mt-1">{t.entered} {entry.estimated ? `${t.estimated} ` : ''}{fmtDay(entry.entered_at, lang)}</p>
              )}
              {current && project.health.inStage != null && (
                <p className={`text-[10px] mt-0.5 tabular-nums ${project.health.inStage > settings.stage_days[s.key] ? 'text-red-700 font-semibold' : 'text-text-secondary'}`}>
                  {t.daysInStage(project.health.inStage, settings.stage_days[s.key])}
                </p>
              )}
            </li>
          )
        })}
      </ol>
      {!project.stageKey && <p className="text-xs text-text-secondary mt-2">{t.noStage}{project.stageName ? `: ${project.stageName}` : ''}</p>}
    </Box>
  )
}

// ── Submittal rounds ──
function Submittals({ project, canWork, ws, reload, t, lang }) {
  const { user } = useAuth()
  const [adding, setAdding] = useState(null) // null | { title, round }
  const [err, setErr] = useState('')
  const items = project.submittals

  async function add(fields) {
    setErr('')
    const out = await addSubmittal(ws, user.id, { projectId: project.id, ...fields })
    if (out.error) return setErr(out.error)
    setAdding(null)
    reload()
  }
  async function change(id, fields) {
    setErr('')
    const out = await setSubmittal(ws, id, fields)
    if (out.error) setErr(out.error)
    reload()
  }
  async function remove(id) {
    setErr('')
    const out = await deleteSubmittal(ws, id)
    if (out.error) setErr(out.error)
    reload()
  }

  const stateText = it => (it.state === 'waiting' ? t.waitingClient(it.days) : it.state === 'again' ? t.again : it.state === 'approved' ? t.approved : t.draft)
  const stateTone = it => (it.state === 'again' ? 'text-red-700' : it.state === 'waiting' ? 'text-yellow-700' : it.state === 'approved' ? 'text-green-700' : 'text-text-tertiary')

  return (
    <Box title={t.submittals} sub={t.submittalsSub}
      action={canWork && !adding ? <Button size="xs" variant="secondary" onClick={() => setAdding({ title: '', round: 1 })}>{t.newItem}</Button> : null}>
      {err && <p className="text-xs text-red-700 mb-2" dir="auto">{err}</p>}
      {adding && <RoundForm initial={adding} onSave={add} onCancel={() => setAdding(null)} t={t} />}
      {!items.length && !adding ? <p className="text-xs text-text-tertiary">{t.noSubmittals}</p> : (
        <div className="space-y-3">
          {items.map(it => (
            <div key={it.title} className="border border-border rounded-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface-subtle rounded-t-lg">
                <p className="text-sm font-medium text-text">{it.title}</p>
                <div className="flex items-center gap-3">
                  <span className={`text-[11px] font-medium ${stateTone(it)}`}>{stateText(it)}</span>
                  {canWork && it.state === 'again' && !adding && (
                    <Button size="xs" onClick={() => setAdding({ title: it.title, round: it.round + 1, submitted_at: todayRiyadh() })}>{t.nextRound}</Button>
                  )}
                </div>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-text-tertiary">
                    {[t.round, t.submitted, t.code, t.returned, t.notes, ''].map((h, i) => <th key={i} className="text-start font-normal px-3 py-1.5">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {it.rounds.map(r => (
                    <RoundRow key={r.id} r={r} canWork={canWork} onChange={f => change(r.id, f)} onRemove={() => remove(r.id)} t={t} lang={lang} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-text-tertiary mt-3">{Object.keys(CODES).map(c => t.codes[c]).join(' · ')}</p>
    </Box>
  )
}

function RoundForm({ initial, onSave, onCancel, t }) {
  const [title, setTitle] = useState(initial.title)
  const [submitted, setSubmitted] = useState(initial.submitted_at || todayRiyadh())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const fixedTitle = initial.round > 1
  return (
    <form className="border border-border rounded-lg p-3 mb-3 grid gap-2 sm:grid-cols-[1fr_9rem_1fr_auto] items-end"
      onSubmit={async e => { e.preventDefault(); setBusy(true); await onSave({ title, round: initial.round, submitted_at: submitted, notes }); setBusy(false) }}>
      <label className="text-[11px] text-text-secondary">
        {t.item}{fixedTitle ? ` · ${t.round} ${initial.round}` : ''}
        <input className={`${field} mt-1`} value={title} onChange={e => setTitle(e.target.value)} placeholder={t.itemPlaceholder} required readOnly={fixedTitle} />
      </label>
      <label className="text-[11px] text-text-secondary">{t.submitted}
        <input type="date" className={`${field} mt-1`} value={submitted} onChange={e => setSubmitted(e.target.value)} />
      </label>
      <label className="text-[11px] text-text-secondary">{t.notes}
        <input className={`${field} mt-1`} value={notes} onChange={e => setNotes(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy || !title.trim()}>{t.record}</Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>{t.cancel}</Button>
      </div>
    </form>
  )
}

function RoundRow({ r, canWork, onChange, onRemove, t, lang }) {
  const tone = r.code === 'C' || r.code === 'D' ? 'text-red-700' : r.code ? 'text-green-700' : 'text-text-tertiary'
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-2 tabular-nums">{r.round}</td>
      <td className="px-3 py-2">{canWork
        ? <input type="date" className={`${field} py-0.5 text-xs w-36`} value={r.submitted_at || ''} onChange={e => onChange({ submitted_at: e.target.value })} aria-label={t.submitted} />
        : (r.submitted_at ? fmtDay(r.submitted_at, lang) : '—')}</td>
      <td className="px-3 py-2">{canWork
        ? (
          <select className={`${field} py-0.5 text-xs w-44 ${tone}`} value={r.code || ''} onChange={e => onChange({ code: e.target.value || null })} aria-label={t.setCode}>
            <option value="">{t.noCode}</option>
            {Object.keys(CODES).map(c => <option key={c} value={c}>{t.codes[c]}</option>)}
          </select>
        ) : <span className={`font-semibold ${tone}`}>{r.code ? t.codes[r.code] : '—'}</span>}</td>
      <td className="px-3 py-2">{canWork && r.code
        ? <input type="date" className={`${field} py-0.5 text-xs w-36`} value={r.returned_at || ''} onChange={e => onChange({ returned_at: e.target.value })} aria-label={t.returned} />
        : (r.returned_at ? fmtDay(r.returned_at, lang) : '—')}</td>
      <td className="px-3 py-2 min-w-[10rem]">{canWork
        ? <input key={r.notes || ''} className={`${field} py-0.5 text-xs`} defaultValue={r.notes || ''} onBlur={e => e.target.value !== (r.notes || '') && onChange({ notes: e.target.value })} aria-label={t.notes} />
        : <span className="text-text-secondary" dir="auto">{r.notes}</span>}</td>
      <td className="px-3 py-2 text-end">{canWork && (
        <button type="button" onClick={onRemove} className="text-[11px] text-text-tertiary hover:text-red-700">{t.remove}</button>
      )}</td>
    </tr>
  )
}

// ── Weekly updates ──
function Updates({ project, campai, odoo, every, canWork, ws, reload, t, lang }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ status: 'on_track', done: '', next: '', blockers: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const all = useMemo(() => [
    ...campai.map(u => ({ key: `c${u.id}`, at: u.written_at, status: u.status, by: u.written_by_name, done: u.done, next: u.next, blockers: u.blockers })),
    ...odoo.map(u => ({ key: `o${u.id}`, at: u.date, status: u.status, by: Array.isArray(u.user_id) ? u.user_id[1] : '', title: u.name, odoo: true })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at))), [campai, odoo])

  async function save(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const out = await writeUpdate(ws, user.id, { projectId: project.id, ...form })
    setBusy(false)
    if (out.error) return setErr(out.error)
    setOpen(false)
    setForm({ status: 'on_track', done: '', next: '', blockers: '' })
    reload()
  }

  return (
    <Box title={t.updates} sub={t.updatesSub(every)}
      action={canWork && !open ? <Button size="xs" onClick={() => setOpen(true)}>{t.writeUpdate}</Button> : null}>
      {open && (
        <form onSubmit={save} className="border border-border rounded-lg p-3 mb-3 space-y-2">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="text-[11px] text-text-secondary mb-1">{t.status}</legend>
            {['on_track', 'at_risk', 'off_track'].map(s => (
              <label key={s} className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-xs cursor-pointer ${form.status === s ? 'border-stone-900 bg-stone-900 text-white' : 'border-border bg-white text-text-secondary'}`}>
                <input type="radio" name="status" value={s} checked={form.status === s} onChange={() => setForm(f => ({ ...f, status: s }))} className="sr-only" />
                <Dot level={s === 'on_track' ? 'green' : s === 'at_risk' ? 'amber' : 'red'} /> {t.statuses[s]}
              </label>
            ))}
          </fieldset>
          {['done', 'next', 'blockers'].map(k => (
            <label key={k} className="block text-[11px] text-text-secondary">{t[k]}
              <textarea rows={2} className={`${field} mt-1`} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} required={k === 'done'} dir="auto" />
            </label>
          ))}
          {err && <p className="text-xs text-red-700" dir="auto">{err}</p>}
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy}>{t.save}</Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>{t.cancel}</Button>
          </div>
        </form>
      )}
      {!all.length ? <p className="text-xs text-text-tertiary">{t.noUpdates}</p> : (
        <ul className="divide-y divide-border">
          {all.slice(0, 12).map(u => (
            <li key={u.key} className="py-2.5">
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <Dot level={u.status === 'on_track' ? 'green' : u.status === 'at_risk' ? 'amber' : u.status === 'off_track' ? 'red' : null} />
                <span className="font-medium text-text">{t.statuses[u.status] || u.status}</span>
                <span className="text-text-tertiary">{fmtDay(u.at, lang, { weekday: 'short', day: 'numeric', month: 'short' })}{u.by ? ` · ${u.by}` : ''}{u.odoo ? ` · ${t.fromOdoo}` : ''}</span>
              </p>
              {u.title && <p className="text-xs text-text-secondary mt-1" dir="auto">{u.title}</p>}
              {u.done && <p className="text-xs text-text mt-1 whitespace-pre-line" dir="auto">{u.done}</p>}
              {u.next && <p className="text-xs text-text-secondary mt-1 whitespace-pre-line" dir="auto"><span className="text-text-tertiary">{t.next}: </span>{u.next}</p>}
              {u.blockers && <p className="text-xs text-red-700 mt-1 whitespace-pre-line" dir="auto"><span className="text-text-tertiary">{t.blockers}: </span>{u.blockers}</p>}
            </li>
          ))}
        </ul>
      )}
    </Box>
  )
}

// ── Reminders and follow-ups (Tasks) ──
function FollowUps({ ws, projectId, t, lang, names, stamp }) {
  const [rows, setRows] = useState(undefined)
  useEffect(() => {
    let cancelled = false
    projectTasks(ws, projectId).then(r => { if (!cancelled) setRows(r || []) }).catch(() => { if (!cancelled) setRows(null) })
    return () => { cancelled = true }
  }, [ws, projectId, stamp])
  const open = (rows || []).filter(r => !['done', 'cancelled'].includes(r.status))
  const closed = (rows || []).filter(r => ['done', 'cancelled'].includes(r.status)).slice(0, 5)
  const late = r => r.due_at && Date.parse(r.due_at) < stamp
  return (
    <Box title={t.followUps} sub={t.followUpsSub}>
      {rows === undefined ? <p className="text-xs text-text-tertiary">…</p> : rows === null ? <p className="text-xs text-red-700">{t.loadFailed}</p> : (
        <ul className="space-y-1">
          {!open.length && <li className="text-xs text-text-tertiary">{t.noFollowUps}</li>}
          {[...open, ...closed].map(r => (
            <li key={r.id}>
              <Link to={`/tasks?id=${r.id}`} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-surface-subtle">
                <span className={`text-xs ${['done', 'cancelled'].includes(r.status) ? 'text-text-tertiary line-through' : 'text-text'}`}>{r.title}</span>
                <span className={`text-[11px] ${late(r) && !['done', 'cancelled'].includes(r.status) ? 'text-red-700' : 'text-text-tertiary'}`}>
                  {t.taskStatus[r.status]}{r.due_at ? ` · ${fmtDay(r.due_at, lang)}` : ''}{r.assigned_to && names[r.assigned_to] ? ` · ${names[r.assigned_to]}` : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Box>
  )
}

