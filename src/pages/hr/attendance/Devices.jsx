import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Skeleton, Spinner } from '../../../components/ui/index'
import { Pagination } from '../../../components/ui/Pagination'
import { useT, fmtDay } from '../../../lib/i18n'
import { nameOf, riyadhToday } from '../../../lib/hr/logic'
import { clock, hm, periods, parseCsv, chunks, byNumber, PUNCH_STATES, NEEDS_ACTION } from '../../../lib/hr/attendance'
import {
  fetchDeviceOverview, fetchDeviceUsers, fetchPunchDays, fetchPunchDayCounts, addDevice, rotateDeviceKey, setDeviceActive, linkDeviceNumbers, uploadPunches, retryEmployee,
} from '../../../lib/hr/attendanceClient'
import { ErrorText, Field, NoAccess, Pill } from '../parts'
import { field, fieldInline } from '../useHrBase'
import { AttHeader, Chips, GroupBy, StatePill, Th, Td, Flash } from './shared'
import { useAttendanceBase, useChips, chipGroups, useParam, groupRows, fmtD, useFlash } from './useAttendance'
import { AW } from './words'

// ─── HR → Attendance: the device screens (v2) ─────────────────────────────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. His change 0044, three screens
// reached from Records:
//   review    device days and what became of them; by default those that
//             wait for someone; Manage tries an employee's days again
//   devices   (Manage) register a device and copy its key once, issue a new
//             key, stop and start, upload a CSV of punches, link the
//             device's numbers to employees
//   everyone  everyone on the device, linked or not, a row per person-day
// How to install the office bridge is in docs/ATTENDANCE-DEVICE-SETUP.md,
// not on screen (the house rule).

const Back = () => {
  const { t, lang } = useT(AW)
  return <Link to="/hr/attendance/records" className="text-xs text-text-secondary hover:text-text">{lang === 'ar' ? '→' : '←'} {t.backToRecords}</Link>
}

// ── The review ──

const REVIEW_FILTERS = [{ key: 'action', group: 'st' }, ...PUNCH_STATES.map(s => ({ key: s, group: 'st' })), { key: 'this_month', group: 'date' }]

export function AttendanceReview() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, can, employees } = a
  const today = riyadhToday()
  const [active, toggle] = useChips(['action'])
  const [q, setQ] = useParam('q')
  const [pageRaw, setPage] = useParam('page', '0')
  const page = Number(pageRaw) || 0
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(null)
  const [counts, setCounts] = useState({})
  const [names, setNames] = useState(new Map())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [flash, setFlash] = useFlash()

  const load = useCallback(async () => {
    if (!ws || employees === null) return
    const g = chipGroups(REVIEW_FILTERS, active)
    const states = [...new Set((g.st || []).flatMap(k => (k === 'action' ? NEEDS_ACTION : [k])))]
    const text = q.trim()
    const ids = text ? employees.filter(e => `${e.name_en} ${e.name_ar}`.toLowerCase().includes(text.toLowerCase())).map(e => e.id) : null
    const [r, c, u] = await Promise.all([
      fetchPunchDays(ws, { states, from: g.date ? periods(today).month[0] : '', numbers: text ? [text].filter(x => /^\d+$/.test(x)) : null, employeeIds: ids, page, pageSize: 50 }),
      fetchPunchDayCounts(ws), fetchDeviceUsers(ws),
    ])
    setRows(r.rows); setCount(r.count); setCounts(c.row || {}); setNames(new Map(u.rows.map(x => [x.device_user_no, x.name])))
    setError(r.error || c.error || u.error || '')
  }, [ws, employees, active, q, page, today])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  const emp = id => (employees || []).find(e => e.id === id)
  const chipCounts = { action: NEEDS_ACTION.reduce((n, s) => n + (counts[s] || 0), 0), ...counts }

  async function retry(e) {
    setBusy(e.id); setError('')
    const out = await retryEmployee(ws, e.id)
    setBusy('')
    if (out.error) { setError(out.error); return }
    setFlash(t.retried(nameOf(e, lang), out.row)); load()
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <AttHeader tab="records" sub="review" />
      <Back />
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchPerson} aria-label={t.search} className={`${fieldInline} min-w-[14rem]`} dir="auto" />
      <Chips filters={REVIEW_FILTERS.map(f => ({ ...f, label: f.key === 'action' ? t.filters.action : f.key === 'this_month' ? t.filters.this_month : t.punchStates[f.key] }))}
        active={active} onToggle={toggle} counts={chipCounts} />
      <Flash msg={flash} />
      <ErrorText error={error || a.error} />
      {rows === null ? <Skeleton className="h-48" /> : !rows.length ? <p className="text-sm text-text-secondary py-6">{t.nothing}</p> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <Th>{t.day}</Th><Th>{t.number}</Th><Th>{t.person}</Th><Th end>{t.punches}</Th><Th end>{t.arrival}</Th><Th end>{t.departure}</Th><Th>{t.status}</Th><Th />
            </tr></thead>
            <tbody className="divide-y divide-border">{rows.map(r => {
              const e = emp(r.employee_id)
              return (
                <tr key={`${r.device_user_no}|${r.work_day}`}>
                  <Td className="whitespace-nowrap">{fmtD(r.work_day, lang)}</Td>
                  <Td><bdi dir="ltr">#{r.device_user_no}</bdi></Td>
                  <Td>{e ? <Link className="hover:underline" to={`/hr/employee?id=${e.id}`}>{nameOf(e, lang)}</Link> : <span className="text-text-secondary" dir="auto">{names.get(r.device_user_no) || t.dash}</span>}</Td>
                  <Td end>{r.punches}</Td>
                  <Td end>{clock(r.first_at)}</Td>
                  <Td end>{r.punches > 1 ? clock(r.last_at) : t.dash}</Td>
                  <Td><StatePill state={r.state} /></Td>
                  <Td end>{can('manage') && (r.state === 'unlinked'
                    ? <Link className="text-xs underline" to={`/hr/attendance/devices#link-${r.device_user_no}`}>{t.link}</Link>
                    : e && NEEDS_ACTION.includes(r.state) && <Button size="xs" variant="ghost" disabled={busy === e.id} onClick={() => retry(e)}>{busy === e.id && <Spinner size="sm" />}{t.retry}</Button>)}</Td>
                </tr>
              )
            })}</tbody>
          </table>
          <Pagination page={page} pageSize={50} count={count} onPage={n => setPage(String(n))} words={t.pager} />
        </div>
      )}
    </div>
  )
}

// ── The devices ──

const zones = () => { try { return Intl.supportedValuesOf('timeZone') } catch { return ['Asia/Riyadh'] } }

export function AttendanceDevices() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, can, employees, devices } = a
  const [overview, setOverview] = useState(null)
  const [users, setUsers] = useState([])
  const [error, setError] = useState('')
  const [key, setKey] = useState(null) // { id, key } shown once
  const [flash, setFlash] = useFlash()

  const load = useCallback(async () => {
    if (!ws) return
    const [o, u] = await Promise.all([fetchDeviceOverview(ws), fetchDeviceUsers(ws)])
    setOverview(o.row || { devices: [], numbers: [], locked: [] }); setUsers(u.rows); setError(o.error || u.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level || !can('manage')) return <NoAccess />
  const after = async (out, msg) => {
    if (out.error) { setError(out.error); return false }
    setError(''); if (msg) setFlash(msg); await Promise.all([load(), a.reloadAttendance(), a.reload()]); return true
  }

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <AttHeader tab="records" sub="devices" />
      <Back />
      <Flash msg={flash} />
      <ErrorText error={error || a.error} />
      {key && (
        <div className="border-2 border-stone-900 rounded-lg p-3 bg-white space-y-2" role="alert">
          <p className="text-sm font-semibold">{t.keyFor(devices.find(d => d.id === key.id)?.name || '')}</p>
          <p className="text-xs text-red-700">{t.keyOnce}</p>
          <div className="flex gap-2 items-center">
            <code className="flex-1 text-[11px] bg-stone-50 border border-border rounded px-2 py-1.5 break-all" dir="ltr">{key.key}</code>
            <CopyButton text={key.key} />
          </div>
          <Button size="xs" variant="ghost" onClick={() => setKey(null)}>{t.close}</Button>
        </div>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-text">{t.devicesTitle}</h2>
        {!overview ? <Skeleton className="h-24" /> : !devices.length ? <p className="text-xs text-text-tertiary">{t.noDevices}</p> : (
          <ul className="grid gap-2 md:grid-cols-2">{devices.map(d => {
            const o = overview.devices.find(x => x.device_id === d.id) || {}
            const s = o.last_sync
            return (
              <li key={d.id} className="bg-white border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-text" dir="auto">{d.name}</p>
                    <p className="text-[11px] text-text-tertiary"><bdi dir="ltr">{d.timezone}</bdi> · {t.keyHint(d.key_hint)}</p>
                  </div>
                  <Pill tone={d.active ? 'green' : 'grey'}>{d.active ? t.running : t.stopped}</Pill>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                  <dt className="text-text-tertiary">{t.punches}</dt><dd className="tabular-nums">{o.punches ?? 0}</dd>
                  <dt className="text-text-tertiary">{t.lastPunchAt}</dt><dd className="tabular-nums" dir="ltr">{o.last_punch ? String(o.last_punch).replace('T', ' ').slice(0, 16) : t.never}</dd>
                  <dt className="text-text-tertiary">{t.lastSync}</dt><dd>{s ? `${fmtDay(s.created_at, lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${t.syncLine(s.received, s.inserted)}` : t.never}</dd>
                  <dt className="text-text-tertiary">{t.users}</dt><dd className="tabular-nums">{o.users ?? 0}</dd>
                  {s && (s.device_serial || s.device_model || s.device_firmware) && <><dt className="text-text-tertiary">{t.deviceInfo}</dt><dd dir="ltr">{[s.device_model, s.device_serial, s.device_firmware].filter(Boolean).join(' · ')}</dd></>}
                </dl>
                {d.notes && <p className="text-[11px] text-text-secondary" dir="auto">{d.notes}</p>}
                <div className="flex flex-wrap gap-1.5">
                  <Button size="xs" variant="secondary" onClick={async () => {
                    if (!window.confirm(t.newKeyConfirm)) return
                    const out = await rotateDeviceKey(ws, d.id)
                    if (await after(out, t.keyIssued)) setKey({ id: d.id, key: out.row })
                  }}>{t.newKey}</Button>
                  <Button size="xs" variant={d.active ? 'danger' : 'secondary'} onClick={async () => after(await setDeviceActive(ws, d.id, !d.active), d.active ? t.stoppedMsg : t.startedMsg)}>{d.active ? t.stop : t.start}</Button>
                  {d.active && <UploadButton onFile={async punches => {
                    if (!punches.length) { setError(t.uploadEmpty); return }
                    const tot = { received: 0, inserted: 0, duplicates: 0, rejected: 0, paired: 0 }
                    for (const part of chunks(punches)) {
                      const out = await uploadPunches(ws, d.id, part)
                      if (out.error) { setError(out.error); return }
                      for (const k of Object.keys(tot)) tot[k] += Number(out.row?.[k] || 0)
                    }
                    await after({}, t.uploaded(tot.received, tot.inserted, tot.duplicates, tot.rejected, tot.paired))
                  }} />}
                </div>
              </li>
            )
          })}</ul>
        )}
        <NewDevice onAdd={async f => {
          const out = await addDevice(ws, f)
          if (await after(out)) setKey(out.row)
          return out
        }} />
      </section>

      {overview && employees && <People key={employees.map(e => e.device_user_no || '').join(',')} overview={overview} users={users} employees={employees} ws={ws} after={after} onLinked={(n, d) => setFlash(t.linked(n, d))} />}
    </div>
  )
}

function CopyButton({ text }) {
  const { t } = useT(AW)
  const [done, setDone] = useState(false)
  return <Button size="xs" variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true) } catch { setDone(false) } }}>{done ? t.copied : t.copy}</Button>
}

function UploadButton({ onFile }) {
  const { t } = useT(AW)
  const [busy, setBusy] = useState(false)
  return (
    <label className={`inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2 py-1 text-xs cursor-pointer hover:bg-stone-50 ${busy ? 'opacity-60' : ''}`} title={t.uploadHelp}>
      {busy && <Spinner size="sm" />}{t.upload}
      <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" disabled={busy} onChange={async e => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file || file.size > 5 * 1024 * 1024) return
        setBusy(true)
        await onFile(parseCsv(await file.text()))
        setBusy(false)
      }} />
    </label>
  )
}

function NewDevice({ onAdd }) {
  const { t } = useT(AW)
  const [f, setF] = useState({ name: '', timezone: 'Asia/Riyadh', notes: '' })
  const [busy, setBusy] = useState(false)
  const list = useMemo(() => zones(), [])
  return (
    <details className="bg-white border border-border rounded-lg px-4 py-3">
      <summary className="text-sm font-semibold text-text cursor-pointer">{t.newDevice}</summary>
      <form className="mt-3 grid gap-2 md:grid-cols-[1.2fr_1fr_1.4fr_auto] items-end" onSubmit={async e => {
        e.preventDefault(); setBusy(true)
        const out = await onAdd(f); setBusy(false)
        if (!out.error) setF({ name: '', timezone: 'Asia/Riyadh', notes: '' })
      }}>
        <Field label={t.deviceName}><input required maxLength={120} value={f.name} onChange={e => setF(x => ({ ...x, name: e.target.value }))} className={field} dir="auto" /></Field>
        <Field label={t.timezone}><select value={f.timezone} onChange={e => setF(x => ({ ...x, timezone: e.target.value }))} className={field} dir="ltr">{list.map(z => <option key={z}>{z}</option>)}</select></Field>
        <Field label={t.deviceNotes}><input maxLength={500} value={f.notes} onChange={e => setF(x => ({ ...x, notes: e.target.value }))} className={field} dir="auto" /></Field>
        <Button type="submit" size="sm" disabled={busy}>{busy && <Spinner size="sm" />}{t.register}</Button>
      </form>
    </details>
  )
}

/** Every number the devices know, with the employee linked to it (his "link" form). */
function People({ overview, users, employees, ws, after, onLinked }) {
  const { t, lang } = useT(AW)
  const linkedBy = useMemo(() => new Map(employees.filter(e => e.device_user_no).map(e => [e.device_user_no, e])), [employees])
  const numbers = useMemo(() => [...new Set([...users.map(u => u.device_user_no), ...overview.numbers.map(n => n.no), ...linkedBy.keys()])].sort(byNumber), [users, overview, linkedBy])
  const [links, setLinks] = useState(() => Object.fromEntries(numbers.map(no => [no, linkedBy.get(no)?.id || ''])))
  const [busy, setBusy] = useState(false)
  const locked = new Set(overview.locked || [])
  const active = employees.filter(e => e.status === 'active').sort((x, y) => nameOf(x, lang).localeCompare(nameOf(y, lang), lang))
  useEffect(() => {
    const id = window.location.hash.slice(1)
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'center' })
  }, [])
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-text">{t.people}</h2>
      <p className="text-[11px] text-text-tertiary">{t.peopleHelp}</p>
      {!numbers.length ? <p className="text-xs text-text-tertiary">{t.noNumbers}</p> : (
        <form onSubmit={async e => {
          e.preventDefault(); setBusy(true)
          const body = Object.fromEntries(numbers.map(no => [no, links[no] || null]))
          const out = await linkDeviceNumbers(ws, body)
          setBusy(false)
          if (await after(out)) onLinked(out.row?.changed ?? 0, out.row?.paired ?? 0)
        }}>
          <div className="bg-white border border-border overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
                <Th>{t.number}</Th><Th>{t.nameOnDevice}</Th><Th>{t.enabled}</Th><Th end>{t.punches}</Th><Th>{t.lastPunchAt}</Th><Th>{t.employee}</Th>
              </tr></thead>
              <tbody className="divide-y divide-border">{numbers.map(no => {
                const u = users.find(x => x.device_user_no === no)
                const n = overview.numbers.find(x => x.no === no)
                const holder = linkedBy.get(no)
                const isLocked = holder && locked.has(holder.id)
                const taken = new Set(Object.entries(links).filter(([k, v]) => k !== no && v).map(([, v]) => v))
                return (
                  <tr key={no} id={`link-${no}`} className={window.location.hash === `#link-${no}` ? 'bg-amber-50' : ''}>
                    <Td><bdi dir="ltr" className="tabular-nums">#{no}</bdi></Td>
                    <Td dir="auto">{u?.name || t.dash}</Td>
                    <Td>{u?.enabled === false ? t.dash : u ? '✓' : ''}</Td>
                    <Td end>{n?.punches ?? 0}</Td>
                    <Td className="whitespace-nowrap">{n?.last_day ? fmtD(n.last_day, lang) : t.dash}</Td>
                    <Td>{isLocked ? <span className="text-xs" title={t.locked}>{nameOf(holder, lang)} 🔒</span> : (
                      <select value={links[no] || ''} onChange={e => setLinks(x => ({ ...x, [no]: e.target.value }))} className={`${fieldInline} text-xs max-w-[16rem]`} aria-label={`${t.employee} #${no}`}>
                        <option value="">{t.noLink}</option>
                        {active.filter(e => !taken.has(e.id) || links[no] === e.id).map(e => <option key={e.id} value={e.id}>{nameOf(e, lang)}{e.employee_no ? ` · ${e.employee_no}` : ''}</option>)}
                      </select>
                    )}</Td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
          <Button type="submit" size="sm" className="mt-2" disabled={busy}>{busy && <Spinner size="sm" />}{t.saveLinks}</Button>
        </form>
      )}
    </section>
  )
}

// ── Everyone on the device ──

const EVERYONE_FILTERS = [
  { key: 'today', group: 'date' }, { key: 'this_month', group: 'date' }, { key: 'last_month', group: 'date' },
  { key: 'unlinked', group: 'link' }, { key: 'linked', group: 'link' },
]

export function AttendanceEveryone() {
  const { t, lang, dir } = useT(AW)
  const a = useAttendanceBase()
  const { ws, level, employees } = a
  const today = riyadhToday()
  const [active, toggle] = useChips()
  const [q, setQ] = useParam('q')
  const [group, setGroup] = useParam('g')
  const [fromP, setFrom] = useParam('from')
  const [toP, setTo] = useParam('to')
  const [pageRaw, setPage] = useParam('page', '0')
  const page = Number(pageRaw) || 0
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(null)
  const [names, setNames] = useState(new Map())
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!ws || employees === null) return
    const g = chipGroups(EVERYONE_FILTERS, active)
    const p = periods(today)
    const ranges = (g.date || []).map(k => (k === 'today' ? p.today : k === 'this_month' ? p.month : p.last_month))
    const from = [fromP, ...ranges.map(r => r[0])].filter(Boolean).sort()[0] || ''
    const to = [toP, ...ranges.map(r => r[1])].filter(Boolean).sort().at(-1) || ''
    const u = await fetchDeviceUsers(ws)
    const nameMap = new Map(u.rows.map(x => [x.device_user_no, x.name]))
    const text = q.trim().toLowerCase()
    const numbers = text ? [...nameMap.entries()].filter(([no, n]) => no === text || (n || '').toLowerCase().includes(text)).map(([no]) => no).concat(/^\d+$/.test(text) ? [text] : []) : null
    const ids = text ? employees.filter(e => `${e.name_en} ${e.name_ar}`.toLowerCase().includes(text)).map(e => e.id) : null
    const r = await fetchPunchDays(ws, { from, to, linked: g.link?.length === 1 ? g.link[0] === 'linked' : null, numbers, employeeIds: ids, page, pageSize: 100, all: Boolean(group) })
    setRows(r.rows); setCount(r.count); setNames(nameMap); setError(r.error || u.error || '')
  }, [ws, employees, active, q, fromP, toP, page, group, today])
  useEffect(() => { queueMicrotask(load) }, [load])

  if (!level) return <NoAccess />
  const emp = id => (employees || []).find(e => e.id === id)
  const personOf = r => (r.employee_id ? nameOf(emp(r.employee_id), lang) : names.get(r.device_user_no) || `#${r.device_user_no}`)
  const groups = group && rows ? groupRows(rows, r => (group === 'person' ? r.device_user_no : r.work_day), r => (group === 'person' ? personOf(r) : fmtD(r.work_day, lang, true))) : null

  return (
    <div className="max-w-6xl space-y-4" dir={dir} lang={lang}>
      <AttHeader tab="records" sub="everyone" />
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs" role="group">
          <Link to="/hr/attendance/records" className="px-3 py-1.5 bg-white text-text-secondary hover:bg-stone-50">{t.employeeRecords}</Link>
          <span className="px-3 py-1.5 bg-stone-900 text-white" aria-current="page">{t.everyoneOnDevice}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchPerson} aria-label={t.search} className={`${fieldInline} min-w-[14rem]`} dir="auto" />
        <label className="text-[11px] text-text-secondary">{t.from} <input type="date" value={fromP} max={today} onChange={e => setFrom(e.target.value)} className={fieldInline} /></label>
        <label className="text-[11px] text-text-secondary">{t.to} <input type="date" value={toP} max={today} onChange={e => setTo(e.target.value)} className={fieldInline} /></label>
        <GroupBy value={group} onChange={setGroup} options={['person', 'day']} />
      </div>
      <Chips filters={EVERYONE_FILTERS} active={active} onToggle={toggle} />
      <ErrorText error={error || a.error} />
      {rows === null ? <Skeleton className="h-48" /> : !rows.length ? <p className="text-sm text-text-secondary py-6">{t.nothing}</p> : (
        <div className="bg-white border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] text-text-tertiary border-b border-border">
              <Th>{t.day}</Th><Th>{t.person}</Th><Th>{t.number}</Th><Th end>{t.arrival}</Th><Th end>{t.departure}</Th><Th end>{t.hours}</Th><Th end>{t.punches}</Th><Th>{t.status}</Th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {(groups || [{ key: '', items: rows }]).map(g => [
                groups && <tr key={`g-${g.key}`} className="bg-stone-50 text-xs font-medium"><td colSpan={8} className="px-3 py-1.5">{g.title} <span className="text-text-tertiary font-normal">({g.items.length})</span></td></tr>,
                ...g.items.map(r => (
                  <tr key={`${r.device_user_no}|${r.work_day}`}>
                    <Td className="whitespace-nowrap">{fmtD(r.work_day, lang)}</Td>
                    <Td>{r.employee_id ? <Link className="hover:underline" to={`/hr/employee?id=${r.employee_id}`}>{personOf(r)}</Link> : <span className="text-text-secondary" dir="auto">{personOf(r)}</span>}</Td>
                    <Td><bdi dir="ltr">#{r.device_user_no}</bdi></Td>
                    <Td end>{clock(r.first_at)}</Td>
                    <Td end>{r.punches > 1 ? clock(r.last_at) : t.dash}</Td>
                    <Td end>{r.punches > 1 ? hm((Date.parse(r.last_at) - Date.parse(r.first_at)) / 3_600_000) : t.dash}</Td>
                    <Td end>{r.punches}</Td>
                    <Td><StatePill state={r.state} /></Td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
          {!group && <Pagination page={page} pageSize={100} count={count} onPage={n => setPage(String(n))} words={t.pager} />}
        </div>
      )}
    </div>
  )
}
