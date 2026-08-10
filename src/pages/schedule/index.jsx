import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp, actions } from '../../store/app'
import { Card, WarmCard, Button, Badge, Modal, Input, PostImage } from '../../components/ui/index'
import { formatDateTime } from '../../lib/utils'

const DAYS   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

const PLATFORM_COLORS = {
  instagram: { bg: 'linear-gradient(135deg,#f09433,#bc1888)', dot: '#E1306C', light: '#fce4f0' },
  facebook:  { bg: '#1877F2', dot: '#1877F2', light: '#e8f0fe' },
  linkedin:  { bg: '#0A66C2', dot: '#0A66C2', light: '#e1f0fb' },
  tiktok:    { bg: '#010101', dot: '#555', light: '#f0f0f0' },
  x:         { bg: '#000',    dot: '#333', light: '#f5f5f5' },
}

export function Schedule() {
  const { state, dispatch } = useApp()
  const navigate = useNavigate()

  const today = new Date()
  const [viewDate,  setViewDate]  = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [viewMode,  setViewMode]  = useState('month') // 'month' | 'list'
  const [filter,    setFilter]    = useState('all')
  const [selectedDay, setSelectedDay] = useState(null)
  const [scheduleModal, setScheduleModal] = useState(null) // post to schedule
  const [schedDate,  setSchedDate]  = useState('')
  const [schedTime,  setSchedTime]  = useState('10:00')
  const [viewItem,   setViewItem]   = useState(null)   // schedule item to view/edit
  const [platformPicker, setPlatformPicker] = useState(false) // show platform picker modal

  // Save edited schedule entry back to instagramSchedule / linkedinSchedule in state
  function saveScheduleEdit(item, updatedFields) {
    const key        = item.dateKey
    const stateKey   = item.source === 'instagram_schedule' ? 'instagramSchedule' : 'linkedinSchedule'
    const actionType = item.source === 'instagram_schedule' ? 'SET_INSTAGRAM_SCHEDULE' : 'SET_LINKEDIN_SCHEDULE'
    const existing   = state[stateKey] || {}
    const dayArr     = existing[key] ? (Array.isArray(existing[key]) ? existing[key] : [existing[key]]) : []
    const updated    = dayArr.map((e, i) => i === item.rawIndex ? { ...e, ...updatedFields } : e)
    dispatch({ type: actionType, payload: { ...existing, [key]: updated } })
    setViewItem(null)
    setSelectedDay(new Date(key + 'T12:00:00'))
  }

  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  // ── date key helper (YYYY-MM-DD) ──────────────────────────────────────────
  function toKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  }

  // Build calendar grid
  const calDays = useMemo(() => {
    const firstDay  = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const prevMonthDays = new Date(year, month, 0).getDate()
    const cells = []

    // Prev month overflow
    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({ date: new Date(year, month - 1, prevMonthDays - i), overflow: 'prev' })
    }
    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(year, month, d), overflow: null })
    }
    // Next month overflow (fill to 6 rows)
    let next = 1
    while (cells.length % 7 !== 0) {
      cells.push({ date: new Date(year, month + 1, next++), overflow: 'next' })
    }
    return cells
  }, [year, month])

  // Posts (state.posts) indexed by date string
  const postsByDate = useMemo(() => {
    const map = {}
    state.posts.forEach(p => {
      const dt = p.scheduledAt || p.createdAt
      const key = new Date(dt).toDateString()
      if (!map[key]) map[key] = []
      map[key].push(p)
    })
    return map
  }, [state.posts])

  function postsForDay(date) {
    return postsByDate[date.toDateString()] || []
  }

  // ── Full cross-platform schedule for a given date ─────────────────────────
  function scheduleForDay(date) {
    const key = toKey(date)
    const items = []

    // 1. state.posts (manually created / approved posts)
    postsForDay(date).forEach(p => {
      items.push({
        id:       p.id,
        platform: p.platform,
        type:     p.uploadType === 'reel' ? 'reel' : 'post',
        topic:    p.copy?.slice(0, 60) || p.topic || '',
        status:   p.status,
        imageUrl: p.imageUrl || p.mediaUrls?.[0] || null,
        source:   'posts',
        raw:      p,
      })
    })

    // 2. Instagram monthly schedule
    const igRaw = (state.instagramSchedule || {})[key]
    const igEntries = igRaw ? (Array.isArray(igRaw) ? igRaw : [igRaw]) : []
    igEntries.forEach((igEntry, idx) => {
      items.push({
        id:       `ig-sched-${key}-${idx}`,
        platform: 'instagram',
        type:     igEntry.uploadType === 'reel' ? 'reel' : 'scheduled',
        topic:    igEntry.topic || '',
        status:   igEntry.status || 'planned',
        imageUrl: null,
        source:   'instagram_schedule',
        rawIndex: idx,
        dateKey:  key,
        raw:      igEntry,
      })
    })

    // 3. LinkedIn monthly schedule
    const liRaw = (state.linkedinSchedule || {})[key]
    const liEntries = liRaw ? (Array.isArray(liRaw) ? liRaw : [liRaw]) : []
    liEntries.forEach((liEntry, idx) => {
      items.push({
        id:       `li-sched-${key}-${idx}`,
        platform: 'linkedin',
        type:     liEntry.uploadType === 'video' ? 'video' : 'scheduled',
        topic:    liEntry.topic || '',
        status:   liEntry.status || 'planned',
        imageUrl: null,
        source:   'linkedin_schedule',
        rawIndex: idx,
        dateKey:  key,
        raw:      liEntry,
      })
    })

    return items
  }

  // Count for calendar dot (include schedule plans)
  function countForDay(date) {
    const key = toKey(date)
    let n = postsForDay(date).length
    const igRaw = (state.instagramSchedule || {})[key]
    const liRaw = (state.linkedinSchedule  || {})[key]
    if (igRaw) n += Array.isArray(igRaw) ? igRaw.length : 1
    if (liRaw) n += Array.isArray(liRaw) ? liRaw.length : 1
    return n
  }

  function isToday(date) {
    return date.toDateString() === today.toDateString()
  }

  function prevMonth() { setViewDate(new Date(year, month - 1, 1)) }
  function nextMonth() { setViewDate(new Date(year, month + 1, 1)) }

  function handleSchedulePost(post) {
    setScheduleModal(post)
    setSchedDate(new Date().toISOString().split('T')[0])
  }

  function confirmSchedule() {
    if (!scheduleModal || !schedDate) return
    const scheduledAt = new Date(`${schedDate}T${schedTime}`).toISOString()
    dispatch(actions.updatePost({ id: scheduleModal.id, status: 'scheduled', scheduledAt }))
    setScheduleModal(null)
  }

  // List view posts
  const listPosts = useMemo(() => {
    let posts = [...state.posts]
    if (filter !== 'all') posts = posts.filter(p => p.status === filter)
    return posts.sort((a, b) => new Date(a.scheduledAt || a.createdAt) - new Date(b.scheduledAt || b.createdAt))
  }, [state.posts, filter])

  return (
    <div className="max-w-7xl space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-display font-bold text-2xl text-text">Content Calendar</h2>
          <p className="text-sm text-text-secondary mt-0.5">Plan and schedule your brand content</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'rgba(232,217,190,0.3)', border: '1px solid rgba(232,217,190,0.5)' }}>
            {[{ key:'month', label:'Calendar' },{ key:'list', label:'List' }].map(v => (
              <button key={v.key} onClick={() => setViewMode(v.key)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${viewMode === v.key ? 'bg-white text-navy-900 shadow-sm' : 'text-text-secondary hover:text-text'}`}>
                {v.label}
              </button>
            ))}
          </div>
          <Button onClick={() => setPlatformPicker(true)}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            New Post
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Scheduled', value: state.posts.filter(p=>p.status==='scheduled').length, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Published', value: state.posts.filter(p=>p.status==='published').length, color: 'text-green-700', bg: 'bg-green-50' },
          { label: 'Pending',   value: state.posts.filter(p=>p.status==='pending_publish').length, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'Draft',     value: state.posts.filter(p=>p.status==='draft').length, color: 'text-gray-600', bg: 'bg-gray-100' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-border p-4 text-center shadow-card">
            <p className={`text-2xl font-display font-bold ${s.color}`}>{s.value}</p>
            <p className={`text-[10px] font-semibold uppercase tracking-wide mt-1 ${s.color} opacity-80`}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* CALENDAR VIEW */}
      {viewMode === 'month' && (
        <Card className="overflow-hidden">
          {/* Calendar header */}
          <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid rgba(232,217,190,0.5)', background: 'linear-gradient(135deg, rgba(255,253,240,0.8), rgba(249,243,232,0.8))' }}>
            <div className="flex items-center gap-4">
              <button onClick={prevMonth} className="w-8 h-8 rounded-xl flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:text-text transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>
              </button>
              <h3 className="font-display font-semibold text-xl text-text min-w-[180px] text-center">
                {MONTHS[month]} <span className="text-text-tertiary">{year}</span>
              </h3>
              <button onClick={nextMonth} className="w-8 h-8 rounded-xl flex items-center justify-center text-text-secondary hover:bg-surface-subtle hover:text-text transition-all">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
              </button>
            </div>
            <button onClick={() => setViewDate(new Date(today.getFullYear(), today.getMonth(), 1))}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold text-amber-700 hover:bg-amber-50 transition-colors"
              style={{ border: '1px solid rgba(212,160,23,0.3)' }}>
              Today
            </button>
          </div>

          {/* Day headers */}
          <div className="grid grid-cols-7" style={{ borderBottom: '1px solid rgba(232,217,190,0.4)', background: 'rgba(249,243,232,0.4)' }}>
            {DAYS.map(d => (
              <div key={d} className="py-2.5 text-center">
                <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-text-tertiary">{d}</span>
              </div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7">
            {calDays.map((cell, i) => {
              const dayPosts = postsForDay(cell.date)
              const dayCount = countForDay(cell.date)
              const todayCell = isToday(cell.date)
              const isSelected = selectedDay && cell.date.toDateString() === selectedDay.toDateString()
              const isWeekend = cell.date.getDay() === 0 || cell.date.getDay() === 6

              return (
                <div key={i}
                  onClick={() => !cell.overflow && setSelectedDay(cell.date)}
                  className={`min-h-[100px] p-2 transition-all duration-200 relative group
                    ${cell.overflow ? 'opacity-35' : 'cursor-pointer'}
                    ${isSelected ? 'bg-amber-50' : isWeekend && !cell.overflow ? 'bg-warm-50/50' : !cell.overflow ? 'hover:bg-surface-subtle/50' : ''}`}
                  style={{
                    border: '1px solid rgba(232,217,190,0.25)',
                    background: isSelected ? 'rgba(245,192,0,0.10)' : dayCount > 0 && !cell.overflow ? 'rgba(245,192,0,0.03)' : '',
                  }}>
                  {/* Date number */}
                  <div className="flex items-start justify-between mb-1">
                    <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full transition-all
                      ${todayCell ? 'bg-amber-gradient text-navy-950 shadow-amber' : isSelected ? 'text-amber-700' : 'text-text-secondary'}`}>
                      {cell.date.getDate()}
                    </span>
                    {dayCount > 0 && !cell.overflow && (
                      <div className="flex flex-col items-center leading-none">
                        <span className="text-base font-bold text-amber-600 leading-none">{dayCount}</span>
                        <span className="text-[8px] text-amber-500 font-medium leading-none mt-0.5">post{dayCount !== 1 ? 's' : ''}</span>
                      </div>
                    )}
                  </div>

                  {/* Post dots / pills */}
                  <div className="space-y-1">
                    {dayPosts.slice(0, 3).map(p => {
                      const pc = PLATFORM_COLORS[p.platform] || PLATFORM_COLORS.instagram
                      return (
                        <div key={p.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium truncate"
                          style={{ background: pc.light, color: pc.dot }}>
                          <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: pc.dot }} />
                          <span className="truncate">{p.copy?.slice(0,18) || p.platform}</span>
                        </div>
                      )
                    })}
                    {dayPosts.length > 3 && (
                      <span className="text-[10px] text-text-tertiary px-1.5">+{dayPosts.length - 3} more</span>
                    )}
                  </div>

                  {/* Add post on hover */}
                  {!cell.overflow && (
                    <button onClick={e => { e.stopPropagation(); setPlatformPicker(true) }}
                      className="absolute bottom-1 right-1 w-5 h-5 rounded-lg bg-amber-gradient opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center justify-center shadow-amber">
                      <svg className="w-3 h-3 text-navy-950" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* Day detail modal overlay */}
      {selectedDay && (() => {
        const items = scheduleForDay(selectedDay)
        const dateLabel = selectedDay.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })
        const platforms = ['instagram','facebook','linkedin','tiktok','x']
        const byPlatform = {}
        platforms.forEach(pl => { byPlatform[pl] = items.filter(it => it.platform === pl) })
        const activePlatforms = platforms.filter(pl => byPlatform[pl].length > 0)
        const TYPE_LABELS   = { reel:'🎬 Reel', video:'🎬 Video', scheduled:'📅 Scheduled', post:'✦ Post' }
        const STATUS_STYLES = {
          planned:'bg-stone-100 text-stone-600', generated:'bg-green-50 text-green-700',
          scheduled:'bg-blue-50 text-blue-600', published:'bg-green-50 text-green-700',
          pending_publish:'bg-amber-50 text-amber-700', draft:'bg-gray-100 text-gray-600',
        }
        const PLATFORM_LABELS = { instagram:'Instagram', facebook:'Facebook', linkedin:'LinkedIn', tiktok:'TikTok', x:'X / Twitter' }

        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
            style={{ background:'rgba(26,20,16,0.55)', backdropFilter:'blur(6px)' }}
            onClick={e => { if (e.target === e.currentTarget) setSelectedDay(null) }}>
            <div style={{ width:'720px', height:'82vh' }} className="bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-scale">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-5 flex-shrink-0"
                style={{ borderBottom:'1px solid rgba(232,217,190,0.5)', background:'linear-gradient(135deg,rgba(255,253,240,0.9),rgba(249,243,232,0.9))' }}>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-1">Content Calendar</p>
                  <h3 className="font-display font-bold text-xl text-text">{dateLabel}</h3>
                  <p className="text-xs text-text-tertiary mt-0.5">
                    {items.length === 0
                      ? 'Nothing scheduled across all platforms'
                      : `${items.length} item${items.length !== 1 ? 's' : ''} · ${activePlatforms.length} platform${activePlatforms.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => { setSelectedDay(null); setPlatformPicker(true) }}>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                    Add Post
                  </Button>
                  <button onClick={() => setSelectedDay(null)}
                    className="w-8 h-8 rounded-xl flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
                  </button>
                </div>
              </div>

              {/* Body */}
              <div className="overflow-y-auto flex-1">
                {items.length === 0 ? (
                  <div className="py-16 text-center px-6">
                    <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </div>
                    <p className="font-semibold text-text mb-1">Nothing scheduled</p>
                    <p className="text-sm text-text-secondary mb-5">No posts or plans across any platform for this day.</p>
                    <div className="flex gap-2 justify-center flex-wrap">
                      <Button size="sm" onClick={() => { setSelectedDay(null); setPlatformPicker(true) }}>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
                        Add Post
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="divide-y" style={{ borderColor:'rgba(232,217,190,0.4)' }}>
                    {activePlatforms.map(platform => {
                      const pc     = PLATFORM_COLORS[platform] || PLATFORM_COLORS.instagram
                      const pItems = byPlatform[platform]
                      return (
                        <div key={platform}>
                          {/* Platform header */}
                          <div className="flex items-center gap-2.5 px-6 py-3"
                            style={{ background:'rgba(249,243,232,0.5)' }}>
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: pc.dot }} />
                            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: pc.dot }}>
                              {PLATFORM_LABELS[platform]}
                            </span>
                            <span className="text-[10px] text-text-tertiary">
                              {pItems.length} item{pItems.length !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {/* Items */}
                          <div className="px-6 py-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {pItems.map(item => (
                              <div key={item.id} className="rounded-2xl border overflow-hidden hover:shadow-card-hover transition-all"
                                style={{ borderColor:'rgba(232,217,190,0.5)' }}>
                                <div className="h-1" style={{ background: pc.bg }} />
                                <div className="p-4">
                                  <div className="flex items-start gap-3">
                                    {item.imageUrl ? (
                                      <PostImage src={item.imageUrl} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                                    ) : (
                                      <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                                        style={{ background: pc.light }}>
                                        {item.type === 'reel' || item.type === 'video' ? '🎬' : '📋'}
                                      </div>
                                    )}
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                        <span className="text-[10px] font-semibold text-text-tertiary">
                                          {TYPE_LABELS[item.type] || item.type}
                                        </span>
                                        {(item.source === 'instagram_schedule' || item.source === 'linkedin_schedule') && (
                                          <span className="text-[9px] bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full font-medium">Monthly Plan</span>
                                        )}
                                      </div>
                                      <p className="text-xs text-text leading-relaxed line-clamp-2">
                                        {item.topic || 'No brief'}
                                      </p>
                                    </div>
                                  </div>

                                  <div className="flex items-center justify-between mt-3">
                                    <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_STYLES[item.status] || 'bg-stone-100 text-stone-500'}`}>
                                      {item.status === 'pending_publish' ? 'Pending' : item.status}
                                    </span>
                                    {item.source === 'posts' && item.raw?.status === 'pending_publish' && (
                                      <button onClick={() => { setSelectedDay(null); handleSchedulePost(item.raw) }}
                                        className="text-[10px] font-semibold text-amber-600 hover:text-amber-700 transition-colors">
                                        Schedule →
                                      </button>
                                    )}
                                    {(item.source === 'instagram_schedule' || item.source === 'linkedin_schedule') && (
                                      <button onClick={() => { setSelectedDay(null); setViewItem(item) }}
                                        className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg border border-border text-text-secondary hover:text-text hover:bg-surface-subtle transition-all">
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                        View
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* LIST VIEW */}
      {viewMode === 'list' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex gap-1 p-1 rounded-xl w-fit" style={{ background: 'rgba(232,217,190,0.3)', border: '1px solid rgba(232,217,190,0.5)' }}>
            {['all','scheduled','pending_publish','published','draft'].map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all duration-200 ${filter === f ? 'bg-amber-gradient text-navy-950 shadow-amber' : 'text-text-secondary hover:text-text'}`}>
                {f === 'pending_publish' ? 'Pending' : f}
              </button>
            ))}
          </div>

          {listPosts.length === 0 ? (
            <Card className="p-16 text-center">
              <div className="w-14 h-14 rounded-3xl bg-amber-100 flex items-center justify-center mx-auto mb-4 animate-float">
                <svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
              </div>
              <p className="font-display font-semibold text-text text-lg mb-2">No posts yet</p>
              <p className="text-sm text-text-secondary mb-5">Start generating content for Arak Lighting</p>
              <Button onClick={() => setPlatformPicker(true)}>Create First Post</Button>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'rgba(249,243,232,0.6)', borderBottom: '1px solid rgba(232,217,190,0.4)' }}>
                    {['Platform','Preview','Scheduled','Status',''].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-[10px] font-bold uppercase tracking-[0.1em] text-text-tertiary">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {listPosts.map((p, i) => {
                    const pc = PLATFORM_COLORS[p.platform] || PLATFORM_COLORS.instagram
                    return (
                      <tr key={p.id} className="hover:bg-surface-subtle/50 transition-colors group"
                        style={{ borderBottom: '1px solid rgba(232,217,190,0.25)', animationDelay: `${i * 0.03}s` }}>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-6 rounded-full" style={{ background: pc.bg }} />
                            <span className="text-xs font-semibold capitalize" style={{ color: pc.dot }}>{p.platform}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            {(p.imageUrl || p.mediaUrls?.[0]) && (
                              <PostImage src={p.imageUrl || p.mediaUrls?.[0]} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
                            )}
                            <p className="text-text text-xs max-w-xs truncate">{p.copy?.slice(0,60) || '—'}</p>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-text-secondary text-xs whitespace-nowrap">
                          {p.scheduledAt ? formatDateTime(p.scheduledAt) : <span className="text-text-disabled">Not scheduled</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <Badge status={p.status === 'pending_publish' ? 'pending' : p.status} />
                        </td>
                        <td className="px-5 py-3.5">
                          {p.status === 'pending_publish' && (
                            <Button variant="ghost" size="xs" onClick={() => handleSchedulePost(p)}>Schedule</Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>
          )}
        </div>
      )}

      {/* Schedule Modal */}
      <Modal open={!!scheduleModal} onClose={() => setScheduleModal(null)} title="Schedule Post" width="max-w-md">
        {scheduleModal && (
          <div className="p-6 space-y-5">
            {/* Post preview */}
            <WarmCard className="p-4">
              <div className="flex items-start gap-3">
                {(scheduleModal.imageUrl || scheduleModal.mediaUrls?.[0]) && (
                  <PostImage src={scheduleModal.imageUrl || scheduleModal.mediaUrls?.[0]} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: PLATFORM_COLORS[scheduleModal.platform]?.dot || '#888' }} />
                    <span className="text-[10px] font-bold uppercase tracking-wide text-text-secondary">{scheduleModal.platform}</span>
                  </div>
                  <p className="text-xs text-text line-clamp-3 leading-relaxed">{scheduleModal.copy?.slice(0,100)}</p>
                </div>
              </div>
            </WarmCard>

            {/* Date + time */}
            <div className="grid grid-cols-2 gap-3">
              <Input label="Date" type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} />
              <Input label="Time (KSA)" type="time" value={schedTime} onChange={e => setSchedTime(e.target.value)} />
            </div>

            {/* Best time tip */}
            <div className="px-4 py-3 rounded-xl text-xs" style={{ background: 'rgba(245,192,0,0.08)', border: '1px solid rgba(212,160,23,0.2)' }}>
              <p className="font-semibold text-amber-700 mb-1">💡 Best times for KSA audience</p>
              <p className="text-text-secondary">Instagram: <strong>10–11 AM</strong> or <strong>7–9 PM</strong> on weekdays. Thursdays see highest engagement.</p>
            </div>

            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1 justify-center" onClick={() => setScheduleModal(null)}>Cancel</Button>
              <Button className="flex-1 justify-center" onClick={confirmSchedule} disabled={!schedDate}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                Schedule Post
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Platform Picker Modal ──────────────────────────────────────── */}
      {platformPicker && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background:'rgba(26,20,16,0.55)', backdropFilter:'blur(6px)' }}
          onClick={e => { if (e.target === e.currentTarget) setPlatformPicker(false) }}>
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-scale">
            {/* Header */}
            <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom:'1px solid rgba(232,217,190,0.4)', background:'linear-gradient(135deg,rgba(255,253,240,0.9),rgba(249,243,232,0.9))' }}>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500 mb-1">New Post</p>
                <h3 className="font-display font-bold text-lg text-text">Choose a platform</h3>
                <p className="text-xs text-text-tertiary mt-0.5">Where would you like to create this post?</p>
              </div>
              <button onClick={() => setPlatformPicker(false)} className="w-8 h-8 rounded-xl flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {/* Platform grid */}
            <div className="p-5 grid grid-cols-2 gap-3">
              {[
                { key:'instagram', label:'Instagram', abbr:'IG', bg:'linear-gradient(135deg,#f09433,#e6683c,#dc2743,#cc2366,#bc1888)', desc:'Posts, Reels, Stories' },
                { key:'linkedin',  label:'LinkedIn',  abbr:'in', bg:'#0A66C2', desc:'Articles, Posts, Videos' },
                { key:'facebook',  label:'Facebook',  abbr:'fb', bg:'#1877F2', desc:'Posts, Stories, Reels' },
                { key:'x',         label:'X / Twitter', abbr:'X', bg:'#000000', desc:'Posts, Threads' },
                { key:'tiktok',    label:'TikTok',    abbr:'TT', bg:'linear-gradient(135deg,#010101,#69C9D0)', desc:'Videos, Lives' },
              ].map(p => (
                <button key={p.key}
                  onClick={() => { setPlatformPicker(false); navigate(`/social/${p.key}`) }}
                  className="flex items-center gap-3 p-4 rounded-2xl border border-border hover:shadow-card-hover hover:border-transparent transition-all text-left group">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white text-xs font-bold flex-shrink-0"
                    style={{ background: p.bg }}>
                    {p.abbr}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text group-hover:text-amber-700 transition-colors">{p.label}</p>
                    <p className="text-[10px] text-text-tertiary">{p.desc}</p>
                  </div>
                  <svg className="w-4 h-4 text-text-disabled ml-auto flex-shrink-0 group-hover:text-amber-500 transition-colors" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Scheduled Item Detail / Edit Modal ─────────────────────────── */}
      {viewItem && <ScheduledItemDetail item={viewItem} onClose={() => { setViewItem(null); setSelectedDay(new Date(viewItem.dateKey + 'T12:00:00')) }} onSave={saveScheduleEdit} />}
    </div>
  )
}

// ─── Scheduled Item Detail Panel ──────────────────────────────────────────
const POST_TYPE_LABELS_IG = {
  generate: { icon: '✦', label: 'AI Generate', color: '#E1306C' },
  upload:   { icon: '🖼️', label: 'Upload',      color: '#E1306C' },
  reel:     { icon: '🎬', label: 'Reel',        color: '#bc1888' },
}
const POST_TYPE_LABELS_LI = {
  generate: { icon: '✦', label: 'AI Generate', color: '#0A66C2' },
  upload:   { icon: '🖼️', label: 'Upload',      color: '#0A66C2' },
  video:    { icon: '🎬', label: 'Video',       color: '#5b21b6' },
}
const IG_TONES   = ['professional','inspirational','educational','casual','promotional']
const LI_TONES   = ['thought_leader','executive','technical_expert','warm_human','promotional']
const TIME_SLOTS = ['07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00']

function ScheduledItemDetail({ item, onClose, onSave }) {
  const isIG = item.source === 'instagram_schedule'
  const pc   = isIG
    ? { dot:'#E1306C', bg:'linear-gradient(135deg,#f09433,#bc1888)', light:'#fce4f0', accent:'amber' }
    : { dot:'#0A66C2', bg:'#0A66C2', light:'#e1f0fb', accent:'blue' }
  const typeLabels = isIG ? POST_TYPE_LABELS_IG : POST_TYPE_LABELS_LI
  const tones      = isIG ? IG_TONES : LI_TONES
  const typeMeta   = typeLabels[item.raw?.uploadType] || typeLabels['generate']
  const dateLabel  = new Date(item.dateKey + 'T12:00:00').toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })

  const [editing, setEditing] = useState(false)
  // Edit fields
  const [topic,       setTopic]       = useState(item.raw?.topic || '')
  const [tone,        setTone]        = useState(item.raw?.tone || (isIG ? 'professional' : 'thought_leader'))
  const [notes,       setNotes]       = useState(item.raw?.notes || '')
  const [publishTime, setPublishTime] = useState(item.raw?.publishTime || '10:00')

  const STATUS_STYLES = {
    planned:'bg-stone-100 text-stone-600', generated:'bg-green-50 text-green-700',
    pending:'bg-amber-50 text-amber-700',  published:'bg-green-50 text-green-700',
  }

  const DETAIL_ROWS = [
    { label: 'Date',          value: dateLabel },
    { label: 'Platform',      value: isIG ? 'Instagram' : 'LinkedIn' },
    { label: 'Type',          value: `${typeMeta.icon} ${typeMeta.label}` },
    { label: 'Tone',          value: item.raw?.tone?.replace(/_/g,' ') || '—' },
    { label: 'Aspect Ratio',  value: item.raw?.aspectRatio || '—' },
    { label: 'Publish Time',  value: item.raw?.publishTime ? (() => { const [h,m] = item.raw.publishTime.split(':'); const hr = parseInt(h); return `${hr > 12 ? hr-12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}` })() : 'Not set' },
    { label: 'Status',        value: item.raw?.status || 'planned' },
    ...(item.raw?.style         ? [{ label: 'Image Style',    value: item.raw.style }] : []),
    ...(item.raw?.customType    ? [{ label: 'Custom Type',    value: item.raw.customType?.replace(/_/g,' ') }] : []),
    ...(item.raw?.postType      ? [{ label: 'Post Type',      value: item.raw.postType?.replace(/_/g,' ') }] : []),
    ...(item.raw?.reelFormat    ? [{ label: 'Reel Format',    value: item.raw.reelFormat?.replace(/_/g,' ') }] : []),
    ...(item.raw?.reelDuration  ? [{ label: 'Reel Duration',  value: item.raw.reelDuration }] : []),
    ...(item.raw?.videoType     ? [{ label: 'Video Type',     value: item.raw.videoType?.replace(/_/g,' ') }] : []),
    ...(item.raw?.videoLength   ? [{ label: 'Video Length',   value: item.raw.videoLength }] : []),
    ...(item.raw?.videoAudience ? [{ label: 'Audience',       value: item.raw.videoAudience?.replace(/_/g,' ') }] : []),
  ]

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background:'rgba(26,20,16,0.6)', backdropFilter:'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-fade-scale"
        style={{ width:'100%', maxWidth:'600px', height:'85vh' }}>

        {/* Header */}
        <div className="px-6 py-5 flex-shrink-0" style={{ background: isIG ? 'linear-gradient(135deg,rgba(255,248,235,0.9),rgba(252,228,240,0.6))' : 'linear-gradient(135deg,rgba(240,246,255,0.9),rgba(225,240,251,0.6))', borderBottom:'1px solid rgba(232,217,190,0.4)' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-5 h-5 rounded-md flex items-center justify-center" style={{ background: pc.bg }}>
                  <span className="text-white text-[9px] font-bold">{isIG ? 'IG' : 'LI'}</span>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: pc.dot }}>
                  {isIG ? 'Instagram' : 'LinkedIn'} · Monthly Schedule
                </p>
              </div>
              <h3 className="font-display font-bold text-lg text-text">{dateLabel}</h3>
              <p className="text-xs text-text-tertiary mt-0.5">{typeMeta.icon} {typeMeta.label}</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!editing && (
                <button onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border border-border text-text-secondary hover:text-text hover:bg-surface-subtle transition-all">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Edit
                </button>
              )}
              <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center text-text-tertiary hover:bg-stone-100 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-5">

          {!editing ? (
            /* ── Detail view ── */
            <>
              {/* Topic */}
              <div className="rounded-2xl border p-4" style={{ borderColor:'rgba(232,217,190,0.5)', background:'rgba(249,243,232,0.3)' }}>
                <p className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-2">Topic / Brief</p>
                <p className="text-sm text-text leading-relaxed">{item.raw?.topic || '—'}</p>
                {item.raw?.notes && <p className="text-xs text-text-tertiary mt-2 pt-2 border-t border-border">📝 {item.raw.notes}</p>}
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-2 gap-2">
                {DETAIL_ROWS.map(row => (
                  <div key={row.label} className="rounded-xl border border-border bg-surface-subtle/50 px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-text-disabled mb-0.5">{row.label}</p>
                    <p className="text-xs font-semibold text-text capitalize">{row.value}</p>
                  </div>
                ))}
              </div>

              {/* Status badge */}
              <div className="flex items-center gap-2">
                <span className={`text-xs font-semibold px-3 py-1.5 rounded-full ${STATUS_STYLES[item.raw?.status] || 'bg-stone-100 text-stone-600'}`}>
                  {item.raw?.status || 'planned'}
                </span>
                <span className="text-xs text-text-tertiary">n8n will process this at 8am and post at {item.raw?.publishTime || '10:00'}</span>
              </div>
            </>
          ) : (
            /* ── Edit view ── */
            <>
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-2.5 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                <p className="text-xs text-amber-700">Changes will also update the {isIG ? 'Instagram' : 'LinkedIn'} Monthly Schedule.</p>
              </div>

              {/* Topic */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Topic / Brief</label>
                <textarea value={topic} onChange={e => setTopic(e.target.value)} rows={4}
                  className="w-full text-sm border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none" />
              </div>

              {/* Tone */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Tone</label>
                <div className="flex flex-wrap gap-2">
                  {tones.map(t => (
                    <button key={t} onClick={() => setTone(t)}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-medium capitalize transition-all ${tone === t ? `border-${pc.accent}-400 bg-${pc.accent}-50 text-${pc.accent}-700` : 'border-border text-text-secondary hover:border-border-strong'}`}
                      style={tone === t ? { borderColor: pc.dot, background: isIG ? '#fff4f0' : '#e8f0fb', color: pc.dot } : {}}>
                      {t.replace(/_/g,' ')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Publish Time */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Publish Time (KSA)</label>
                <div className="flex items-center gap-3 flex-wrap">
                  <input type="time" value={publishTime} onChange={e => setPublishTime(e.target.value)}
                    className="text-sm font-semibold border-2 rounded-xl px-3 py-2 bg-white text-text focus:outline-none focus:ring-2 cursor-pointer"
                    style={{ borderColor: isIG ? '#7d98a1' : '#0A66C2' }} />
                  <div className="flex gap-1.5 flex-wrap">
                    {TIME_SLOTS.map(slot => {
                      const [h] = slot.split(':'); const hr = parseInt(h); const label = `${hr > 12 ? hr-12 : hr || 12}${hr >= 12 ? 'pm' : 'am'}`
                      return (
                        <button key={slot} onClick={() => setPublishTime(slot)}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold border transition-all ${publishTime === slot ? 'text-white border-transparent' : 'bg-white text-text-secondary border-border hover:border-stone-300'}`}
                          style={publishTime === slot ? { background: pc.bg, borderColor:'transparent' } : {}}>
                          {label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-text-secondary mb-1.5 uppercase tracking-wider">Additional Notes</label>
                <input value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Hashtag ideas, references, things to avoid…"
                  className="w-full text-sm border border-border rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-amber-400" />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex-shrink-0 flex gap-3">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-text-secondary hover:bg-surface-subtle transition-colors">Cancel</button>
              <button onClick={() => onSave(item, { topic, tone, notes, publishTime })}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                style={{ background: pc.bg }}>
                Save Changes
              </button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-text-secondary hover:bg-surface-subtle transition-colors">Close</button>
              <button onClick={() => setEditing(true)}
                className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white transition-all"
                style={{ background: pc.bg }}>
                Edit Post
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
