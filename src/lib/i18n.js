// ─── Arabic and English, app-wide (v2) ─────────────────────────────────────
// 2026-10-19. The CEO's sheet: Arabic across the app. Until now only the CEO
// pages had it, with their own switch (arak.ceo.lang). Now there is one
// choice per browser, made from the top bar, and every translated screen
// follows it:
//
//   · the shell (rail, section menu, top bar, Home) is translated and turns
//     right-to-left in Arabic (dir on AppLayout's root);
//   · a translated page draws its own words from a { en, ar } dictionary
//     and says so in lib/modules.js (`translated: true`), so its content is
//     laid out right-to-left too;
//   · a page not yet translated keeps English, left-to-right, inside the
//     Arabic shell, rather than English text set right-to-left.
//
// Dates and numbers keep Western digits in Arabic (ar-SA-u-nu-latn), as the
// CEO pages already do: SAR amounts in invoices and Odoo are written that way.

import { useSyncExternalStore } from 'react'

const KEY = 'arak.lang'
const OLD_CEO_KEY = 'arak.ceo.lang'
export const LANGS = ['en', 'ar']
export const dirOf = lang => (lang === 'ar' ? 'rtl' : 'ltr')

function read() {
  try {
    const v = localStorage.getItem(KEY) || localStorage.getItem(OLD_CEO_KEY)
    return v === 'ar' ? 'ar' : 'en'
  } catch { return 'en' }
}

let current = typeof window === 'undefined' ? 'en' : read()
const listeners = new Set()

// The direction is set on the app's shell (AppLayout), not on <html>: the
// sign-in pages and the sales team's app are not translated yet, and English
// laid out right-to-left misplaces its punctuation.

export const getLang = () => current

/** Has this browser ever chosen a language (here or on v1's CEO page)? */
export function hasChoice() {
  try { return Boolean(localStorage.getItem(KEY) || localStorage.getItem(OLD_CEO_KEY)) } catch { return false }
}

export function setLang(lang) {
  const next = lang === 'ar' ? 'ar' : 'en'
  if (next === current) return
  current = next
  try { localStorage.setItem(KEY, next); localStorage.setItem(OLD_CEO_KEY, next) } catch { /* private window */ }
  for (const l of listeners) l()
}

const subscribe = l => { listeners.add(l); return () => listeners.delete(l) }

/** The current language; re-renders when it changes. */
export function useLang() {
  return useSyncExternalStore(subscribe, getLang, () => 'en')
}

/** A page's words in the current language: useT({ en: {...}, ar: {...} }). Missing Arabic falls back to English. */
export function useT(dict) {
  const lang = useLang()
  return { lang, dir: dirOf(lang), t: lang === 'ar' ? { ...dict.en, ...dict.ar } : dict.en }
}

/** An item's label in this language: its `ar` when Arabic and it has one. */
export const labelOf = (item, lang) => (lang === 'ar' && item?.ar ? item.ar : item?.label || '')

const LOCALE = { en: 'en-GB', ar: 'ar-SA-u-nu-latn-ca-gregory' }

/** "19 Oct" / "١٩ أكتوبر" (Western digits). */
export function fmtDay(value, lang = 'en', opts = { day: 'numeric', month: 'short' }) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(LOCALE[lang] || LOCALE.en, { timeZone: 'Asia/Riyadh', ...opts })
}

/** SAR in full or short ("1.2M"), Western digits either way. */
export function fmtSar(n, lang = 'en', { short = false } = {}) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const unit = lang === 'ar' ? 'ر.س' : 'SAR'
  if (short && Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}${lang === 'ar' ? ' مليون' : 'M'} ${unit}`
  if (short && Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}${lang === 'ar' ? ' ألف' : 'K'} ${unit}`
  return `${Math.round(v).toLocaleString('en-US')} ${unit}`
}

import { arDays, arHours } from './arabic'

export { arDays, arHours }

/** "5m ago" / "منذ 5 دقائق": lib/utils timeAgo in either language. */
export function ago(iso, lang = 'en') {
  const mins = Math.max(0, Math.floor((Date.now() - Date.parse(iso || '')) / 60_000))
  if (!Number.isFinite(mins)) return ''
  if (lang !== 'ar') {
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const h = Math.floor(mins / 60)
    return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`
  }
  if (mins < 1) return 'الآن'
  if (mins < 60) return mins === 1 ? 'منذ دقيقة' : mins === 2 ? 'منذ دقيقتين' : mins <= 10 ? `منذ ${mins} دقائق` : `منذ ${mins} دقيقة`
  const h = Math.floor(mins / 60)
  if (h < 24) return `منذ ${arHours(h)}`
  const d = Math.floor(h / 24)
  return d === 1 ? 'أمس' : `منذ ${arDays(d)}`
}

/** Words the shell and many pages share. */
export const COMMON = {
  en: {
    home: 'Home', language: 'العربية', languageLabel: 'Switch to Arabic', signOut: 'Sign out', workspace: 'Workspace',
    notifications: 'Notifications', markAllRead: 'Mark all read', allCaughtUp: 'All caught up', menu: 'Menu',
    showMenu: 'Show menu', hideMenu: 'Hide menu', sections: 'Sections', openInOdoo: 'Open in Odoo', loading: 'Loading…',
    allModules: 'Apps', pin: 'Pin to the left bar', unpin: 'Unpin from the left bar', pinSaveFailed: 'Your left bar could not be saved. Try again.',
    search: 'Search', searchPh: 'Search pages, leads, contacts, people…', searchNone: 'Nothing found', searchFailed: 'Some parts could not be searched:',
    searchHint: 'Type to search everything you can open.', searchClose: 'Close', searching: 'Searching…',
    notFoundTitle: "That page doesn't exist", notFoundBody: 'The link may be out of date. Everything is reachable from Home.', backHome: 'Back to Home',
  },
  ar: {
    home: 'الرئيسية', language: 'English', languageLabel: 'التبديل إلى الإنجليزية', signOut: 'تسجيل الخروج', workspace: 'الشركة',
    notifications: 'الإشعارات', markAllRead: 'تعليم الكل كمقروء', allCaughtUp: 'لا جديد', menu: 'القائمة',
    showMenu: 'إظهار القائمة', hideMenu: 'إخفاء القائمة', sections: 'الأقسام', openInOdoo: 'فتح في أودو', loading: 'جارٍ التحميل…',
    allModules: 'التطبيقات', pin: 'تثبيت في الشريط الجانبي', unpin: 'إزالة من الشريط الجانبي', pinSaveFailed: 'تعذّر حفظ الشريط الجانبي. حاول مرة أخرى.',
    search: 'بحث', searchPh: 'ابحث في الصفحات والعملاء وجهات الاتصال والأشخاص…', searchNone: 'لا توجد نتائج', searchFailed: 'تعذّر البحث في:',
    searchHint: 'اكتب للبحث في كل ما يمكنك فتحه.', searchClose: 'إغلاق', searching: 'جارٍ البحث…',
    notFoundTitle: 'هذه الصفحة غير موجودة', notFoundBody: 'ربما الرابط قديم. كل شيء متاح من الرئيسية.', backHome: 'العودة إلى الرئيسية',
  },
}
