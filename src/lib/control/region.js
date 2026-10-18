// ─── Which part of Saudi Arabia a lead is in ───────────────────────────────
// 2026-10-18, for routing by region. Leads carry no region field: the lead
// agent writes whatever the sender said into details.location ("Riyadh,
// KSA", "جدة", "Al Khobar site"). This turns that text into one of the six
// regions sales is organised by, or '' when it cannot tell. Pure.

export const REGIONS = [
  { key: 'central', en: 'Riyadh & Central', ar: 'الرياض والوسطى' },
  { key: 'western', en: 'Western (Jeddah, Makkah, Madinah)', ar: 'الغربية (جدة، مكة، المدينة)' },
  { key: 'eastern', en: 'Eastern (Dammam, Khobar, Jubail)', ar: 'الشرقية (الدمام، الخبر، الجبيل)' },
  { key: 'southern', en: 'Southern (Abha, Jazan, Najran)', ar: 'الجنوبية (أبها، جازان، نجران)' },
  { key: 'northern', en: 'Northern (Tabuk, Hail, NEOM)', ar: 'الشمالية (تبوك، حائل، نيوم)' },
  { key: 'qassim', en: 'Qassim', ar: 'القصيم' },
  { key: 'outside', en: 'Outside Saudi Arabia', ar: 'خارج السعودية' },
]

// Checked in this order, so "Riyadh road, Jeddah" stays with the first named
// city only when no more specific word wins. Lower-case English, and Arabic
// with the usual spelling variants folded by `fold`.
const WORDS = [
  ['western', ['jeddah', 'jedda', 'jiddah', 'makkah', 'mecca', 'makka', 'madinah', 'medina', 'madina', 'taif', 'yanbu', 'rabigh', 'kaec', 'king abdullah economic', 'red sea global', 'جده', 'مكه', 'المدينه', 'الطايف', 'الطائف', 'ينبع', 'رابغ']],
  ['eastern', ['dammam', 'khobar', 'alkhobar', 'dhahran', 'jubail', 'ahsa', 'hofuf', 'qatif', 'ras tanura', 'hafar', 'الدمام', 'الخبر', 'الظهران', 'الجبيل', 'الاحساء', 'الهفوف', 'القطيف', 'حفر الباطن', 'الشرقيه']],
  ['southern', ['abha', 'khamis', 'jazan', 'jizan', 'najran', 'baha', 'bisha', 'ابها', 'خميس', 'جازان', 'جيزان', 'نجران', 'الباحه', 'بيشه']],
  ['northern', ['tabuk', 'hail', 'jouf', 'sakaka', 'arar', 'neom', 'qurayyat', 'تبوك', 'حائل', 'حايل', 'الجوف', 'سكاكا', 'عرعر', 'نيوم']],
  ['qassim', ['qassim', 'buraidah', 'buraydah', 'unaizah', 'القصيم', 'بريده', 'عنيزه']],
  ['central', ['riyadh', 'riyad', 'diriyah', 'kharj', 'majmaah', 'qiddiya', 'الرياض', 'الدرعيه', 'الخرج', 'المجمعه', 'القديه']],
  ['outside', ['dubai', 'abu dhabi', 'uae', 'qatar', 'doha', 'kuwait', 'bahrain', 'oman', 'muscat', 'egypt', 'cairo', 'jordan', 'amman', 'دبي', 'ابوظبي', 'الامارات', 'قطر', 'الدوحه', 'الكويت', 'البحرين', 'عمان', 'مصر', 'القاهره', 'الاردن']],
]

/** Folds the Arabic spellings people mix (ة/ه, أ/إ/آ/ا, ى/ي) and lower-cases English. */
export function fold(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[ة]/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/[ً-ْ]/g, '') // harakat
}

/** 'central' | 'western' | … | '' when the text names nowhere we know. */
export function regionOf(text) {
  const t = fold(text)
  if (!t.trim()) return ''
  let best = '', at = Infinity
  // The place named FIRST in the text wins: "Jeddah project, office in Riyadh".
  for (const [key, words] of WORDS) {
    for (const w of words) {
      const i = t.indexOf(w)
      if (i >= 0 && i < at) { best = key; at = i }
    }
  }
  return best
}

/** Where a lead is: its stated location, else its subject and summary. */
export function leadRegion(lead = {}) {
  return regionOf(lead.details?.location) || regionOf(`${lead.subject || ''} ${lead.summary || ''}`)
}

export const regionLabel = (key, lang = 'en') => REGIONS.find(r => r.key === key)?.[lang] || ''
