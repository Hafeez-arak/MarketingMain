import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { fmtDay } from '../../../lib/i18n'
import { fetchLeaveTypes, fetchPeople } from '../../../lib/hr/client'
import { fetchAttendanceSettings, fetchDevices } from '../../../lib/hr/attendanceClient'
import { useHrBase } from '../useHrBase'

// ─── HR attendance: what every attendance page loads and keeps (v2) ───────
// 2026-10-28, dev/erp-pilot/ATTENDANCE.md. The hooks and helpers the
// attendance pages share; the components are in shared.jsx.

export const TABS = [
  { key: 'today', to: '/hr/attendance' },
  { key: 'records', to: '/hr/attendance/records' },
  { key: 'log', to: '/hr/attendance/log' },
  { key: 'flags', to: '/hr/attendance/flags' },
]

/** HR's base, plus the attendance settings, the devices, the leave types and people's names. */
export function useAttendanceBase() {
  const base = useHrBase()
  const { ws } = base
  const [settings, setSettings] = useState(undefined)
  const [devices, setDevices] = useState([])
  const [leaveTypes, setLeaveTypes] = useState([])
  const [people, setPeople] = useState([])
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    if (!ws) return
    const [s, d, ty, p] = await Promise.all([fetchAttendanceSettings(ws), fetchDevices(ws), fetchLeaveTypes(ws), fetchPeople(ws)])
    setSettings(s.row); setDevices(d.rows); setLeaveTypes(ty.rows); setPeople(p.rows)
    setError(s.error || d.error || ty.error || '')
  }, [ws])
  useEffect(() => { queueMicrotask(reload) }, [reload])
  return {
    ...base, settings, devices, leaveTypes, people, reloadAttendance: reload, attError: error,
    ready: settings !== undefined && base.employees !== null,
    deviceMode: devices.some(d => d.active),
    hasDevice: devices.length > 0,
    personName: id => people.find(p => p.user_id === id)?.name || '',
  }
}

/**
 * The list filters, as his ListView: chips in groups; within a group any
 * chip may match, across groups all must. Kept in the address (?f=a,b).
 * `filters` is [{ key, group }]; returns [active Set, toggle].
 */
export function useChips(defaults = []) {
  const [params, setParams] = useSearchParams()
  const raw = params.get('f')
  const active = new Set(raw === null ? defaults : raw.split(',').filter(Boolean))
  const toggle = key => setParams(p => {
    const n = new URLSearchParams(p)
    const next = new Set(active)
    if (next.has(key)) next.delete(key); else next.add(key)
    n.set('f', [...next].join(','))
    n.delete('page')
    return n
  }, { replace: true })
  return [active, toggle]
}

/** Within each group any active chip; groups with no active chip do not filter. */
export function chipGroups(filters, active) {
  const out = {}
  for (const f of filters) if (active.has(f.key)) (out[f.group] ||= []).push(f.key)
  return out
}

/** A search box, group-by picker and the like, kept in the address. */
export function useParam(name, fallback = '') {
  const [params, setParams] = useSearchParams()
  const value = params.get(name) ?? fallback
  const set = v => setParams(p => {
    const n = new URLSearchParams(p)
    if (v === '' || v === null || v === undefined || v === fallback) n.delete(name); else n.set(name, v)
    if (name !== 'page') n.delete('page')
    return n
  }, { replace: true })
  return [value, set]
}

/** Rows into [{ key, title, items }] in first-seen order. */
export function groupRows(rows, keyOf, titleOf) {
  const map = new Map()
  for (const r of rows) {
    const k = keyOf(r)
    if (!map.has(k)) map.set(k, { key: k, title: titleOf(r), items: [] })
    map.get(k).items.push(r)
  }
  return [...map.values()]
}

/** "28 Oct 2026" / with the weekday. */
export const fmtD = (day, lang, weekday = false) => (day ? fmtDay(day, lang, weekday ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** A message that fades out: [msg, setMsg]; shown with <Flash msg={msg} />. */
export function useFlash() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!msg) return
    const id = setTimeout(() => setMsg(''), 6000)
    return () => clearTimeout(id)
  }, [msg])
  return [msg, setMsg]
}
