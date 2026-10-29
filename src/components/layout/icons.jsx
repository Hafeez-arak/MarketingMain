import { useId } from 'react'

// ─── The navigation's icons, by name ───────────────────────────────────────
// lib/modules.js names an icon per section and page; this draws it. The
// strokes are v1's sidebar icons, moved here so the rail, the section
// sidebar and Home's tiles draw the same picture for the same thing.

const P = {
  home: <><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></>,
  building: <><path d="M3 21h18"/><path d="M5 21V8l7-5 7 5v13"/><path d="M9 21v-6h6v6"/></>,
  funnel: <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>,
  calculator: <><rect x="4" y="2" width="16" height="20" rx="2"/><rect x="8" y="6" width="8" height="4"/><line x1="8" y1="14" x2="8.01" y2="14"/><line x1="12" y1="14" x2="12.01" y2="14"/><line x1="16" y1="14" x2="16.01" y2="14"/><line x1="8" y1="18" x2="8.01" y2="18"/><line x1="12" y1="18" x2="12.01" y2="18"/><line x1="16" y1="18" x2="16.01" y2="18"/></>,
  box: <><path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><line x1="12" y1="13" x2="12" y2="21"/></>,
  folder: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,
  kanban: <><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/><line x1="5.5" y1="7" x2="6.5" y2="7"/><line x1="11.5" y1="7" x2="12.5" y2="7"/><line x1="11.5" y1="11" x2="12.5" y2="11"/><line x1="17.5" y1="7" x2="18.5" y2="7"/></>,
  target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
  search: <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></>,
  megaphone: <><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M16 8a5 5 0 0 1 0 8"/><path d="M19 5a9 9 0 0 1 0 14"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  pin: <><path d="M12 17v5"/><path d="M9 10.76V6h6v4.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V17H5v-1.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76z"/><path d="M8 3h8"/></>,
  magnifier: <><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  'check-circle': <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
  pen: <><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></>,
  calendar: <><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  share: <><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></>,
  'check-square': <><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
  'message-check': <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><polyline points="8 10 10.5 12.5 15 8"/></>,
  mail: <><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></>,
  image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></>,
  brain: <path d="M9.5 2A3.5 3.5 0 0 0 6 5.5v.5a3 3 0 0 0-2 2.83V10a3 3 0 0 0 1 2.24V14a3 3 0 0 0 2.5 2.96V18a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3v-1.04A3 3 0 0 0 19 14v-1.76A3 3 0 0 0 20 10V8.83a3 3 0 0 0-2-2.83v-.5A3.5 3.5 0 0 0 14.5 2 3.5 3.5 0 0 0 12 3.17 3.5 3.5 0 0 0 9.5 2z"/>,
  bars: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
  bulb: <><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/></>,
  contacts: <><rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="10" r="3"/><path d="M7 18a5 5 0 0 1 10 0"/><line x1="2" y1="7" x2="4" y2="7"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="2" y1="17" x2="4" y2="17"/></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  hardhat: <><path d="M2 18h20"/><path d="M4 18v-2a8 8 0 0 1 16 0v2"/><path d="M10 9V5h4v4"/></>,
  'file-check': <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><polyline points="9 15 11 17 15 13"/></>,
  'id-card': <><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="12" r="2.5"/><path d="M13 10h5"/><path d="M13 14h4"/></>,
  coins: <><circle cx="9" cy="9" r="6"/><path d="M15.5 8.6A6 6 0 1 1 8.6 15.5"/><path d="M9 6.5v5"/></>,
  panel: <><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="9" y1="4" x2="9" y2="20"/></>,
  chat: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
}

/**
 * One navigation icon. Unknown names draw an empty box rather than nothing,
 * so a typo shows. `gradient` ([from, to]) draws the lines in a two-colour
 * blend (Home's app grid) instead of the text colour.
 */
export function NavIcon({ name, className = 'w-4 h-4', strokeWidth = 1.75, gradient = null }) {
  const id = useId()
  return (
    <svg className={className} fill="none" stroke={gradient ? `url(#${id})` : 'currentColor'} strokeWidth={strokeWidth} viewBox="0 0 24 24" aria-hidden="true">
      {/* In the icon's own units: a straight line has no width of its own to blend across. */}
      {gradient && (
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="2" y1="2" x2="22" y2="22">
            <stop offset="0" stopColor={gradient[0]} />
            <stop offset="1" stopColor={gradient[1]} />
          </linearGradient>
        </defs>
      )}
      {P[name] || <rect x="4" y="4" width="16" height="16" rx="2" />}
    </svg>
  )
}

