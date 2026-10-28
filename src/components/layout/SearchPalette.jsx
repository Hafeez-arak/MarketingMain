import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../store/auth'
import { MODES } from '../../lib/shell/search'
import { searchCall } from '../../lib/shell/client'
import { useLang, dirOf, COMMON } from '../../lib/i18n'
import { NavIcon } from './icons'

// ─── The Ctrl/Cmd+K palette (v2 shell) ─────────────────────────────────────
// 2026-10-28, docs/SHELL.md. One input over lib/shell/search.js: pages at
// once, then the records of every module this person may open, grouped by
// type. ↑ ↓ move, Enter opens, Esc closes.
//
// The palette runs MODES.search. The company assistant's "ask" mode will be
// a second runner in MODES, offered as a choice above the input once it
// exists. Nothing about it is drawn now.

const WAIT_MS = 180 // between keystrokes before the database is asked

/** The parts a failed search names, in the app's language. */
const PARTS = {
  sales: { en: 'Leads', ar: 'العملاء المحتملون' }, crm: { en: 'CRM', ar: 'إدارة العملاء' },
  contacts: { en: 'Contacts', ar: 'جهات الاتصال' }, hr: { en: 'HR', ar: 'الموارد البشرية' },
  tasks: { en: 'Tasks', ar: 'المهام' }, requests: { en: 'Requests', ar: 'الطلبات' },
}

export function SearchPalette({ open, onClose }) {
  if (!open) return null
  return <Palette onClose={onClose} />
}

function Palette({ onClose }) {
  const navigate = useNavigate()
  const { who, activeWorkspaceId } = useAuth()
  const lang = useLang()
  const c = COMMON[lang]
  const [query, setQuery] = useState('')
  // Kept with the query it answers, so a slow answer never shows under a newer query.
  const [res, setRes] = useState({ for: '', groups: [], failed: [], busy: false })
  const [active, setActive] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const call = useMemo(() => searchCall(activeWorkspaceId), [activeWorkspaceId])

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const text = query.trim()
    if (!text) return
    let stale = false
    const ctx = { lang, call, onPages: groups => { if (!stale) setRes({ for: text, groups, failed: [], busy: true }) } }
    const t = setTimeout(async () => {
      const r = await MODES.search(text, who, ctx)
      if (!stale) setRes({ for: text, groups: r.groups, failed: r.failed, busy: false })
    }, WAIT_MS)
    return () => { stale = true; clearTimeout(t) }
  }, [query, who, lang, call])

  const text = query.trim()
  const current = Boolean(text) && res.for === text
  const groups = current ? res.groups : []
  const flat = groups.flatMap(g => g.items)
  const indexOf = new Map(flat.map((it, n) => [it.key, n]))
  const at = Math.min(active, Math.max(flat.length - 1, 0))

  const go = item => { if (!item) return; onClose(); navigate(item.to) }

  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!flat.length) return
      const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length
      setActive(next)
      listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' })
      return
    }
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); go(flat[at]) }
  }

  const waiting = Boolean(text) && (!current || res.busy)
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center px-3 pt-[10vh]" dir={dirOf(lang)} lang={lang} data-print-hide>
      <div className="absolute inset-0 bg-black/30" aria-hidden="true" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={c.search}
        className="relative w-full max-w-xl bg-white border border-border rounded-xl shadow-dropdown overflow-hidden animate-fade-scale">
        <div className="flex items-center gap-2 px-3 border-b border-border">
          <NavIcon name="magnifier" className="w-4 h-4 text-text-tertiary flex-shrink-0" />
          <input ref={inputRef} value={query} onChange={e => { setQuery(e.target.value); setActive(0) }} onKeyDown={onKey}
            placeholder={c.searchPh} aria-label={c.search} dir="auto" autoComplete="off" spellCheck={false}
            role="combobox" aria-expanded={flat.length > 0} aria-controls="shell-search-results"
            aria-activedescendant={flat.length ? `shell-search-${at}` : undefined}
            className="flex-1 min-w-0 h-12 bg-transparent text-sm text-text placeholder:text-text-tertiary focus:outline-none" />
          <kbd className="hidden sm:inline text-[10px] text-text-tertiary border border-border rounded px-1.5 py-0.5">Esc</kbd>
          <button type="button" onClick={onClose} aria-label={c.searchClose}
            className="sm:hidden w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-stone-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <div ref={listRef} id="shell-search-results" role="listbox" aria-label={c.search} className="max-h-[60vh] overflow-y-auto scrollbar-thin py-1">
          {!text && <p className="px-4 py-6 text-center text-xs text-text-tertiary">{c.searchHint}</p>}
          {groups.map(g => (
            <div key={g.key} role="group" aria-label={g.label} className="py-1">
              <p className="px-4 pt-1.5 pb-1 text-[11px] font-medium text-text-tertiary">{g.label}</p>
              {g.items.map(item => {
                const n = indexOf.get(item.key)
                const on = n === at
                return (
                  <button key={item.key} type="button" id={`shell-search-${n}`} data-i={n} role="option" aria-selected={on}
                    onMouseMove={() => { if (!on) setActive(n) }} onClick={() => go(item)}
                    className={`w-full flex items-center gap-3 px-4 py-2 text-start ${on ? 'bg-stone-100' : ''}`}>
                    <span className="w-7 h-7 rounded-md flex items-center justify-center bg-white border border-border text-text-secondary flex-shrink-0">
                      <NavIcon name={item.icon} className="w-4 h-4" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-text truncate" dir="auto">{item.title}</span>
                      {item.detail && <span className="block text-[11px] text-text-tertiary truncate" dir="auto">{item.detail}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
          {current && !res.busy && !groups.length && <p className="px-4 py-6 text-center text-xs text-text-tertiary">{c.searchNone}</p>}
          {waiting && !groups.length && <p className="px-4 py-6 text-center text-xs text-text-tertiary">{c.searching}</p>}
          {current && res.failed.length > 0 && (
            <p role="alert" className="px-4 py-2 text-[11px] text-red-600">
              {c.searchFailed} {res.failed.map(k => PARTS[k]?.[lang] || k).join(lang === 'ar' ? '، ' : ', ')}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
