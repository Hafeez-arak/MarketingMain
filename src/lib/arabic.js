// ─── Arabic wording that pure code shares (no React) ───────────────────────
// 2026-10-19. Used by the screens through lib/i18n.js and by pure modules the
// server also runs (lib/tasks/logic.js), so it imports nothing.

/** Arabic counts agree with the number: يوم واحد، يومان، ٣–١٠ أيام، ١١ فأكثر يومًا. */
export const arDays = n => (n === 1 ? 'يوم واحد' : n === 2 ? 'يومان' : n >= 3 && n <= 10 ? `${n} أيام` : `${n} يومًا`)

/** The same for hours. */
export const arHours = n => (n === 1 ? 'ساعة واحدة' : n === 2 ? 'ساعتان' : n >= 3 && n <= 10 ? `${n} ساعات` : `${n} ساعة`)

/** "عميل واحد، عميلان، ٣ عملاء، ١١ عميلًا": a count of a noun (singular, dual, plural, accusative singular). */
export const arCount = (n, [one, two, few, many]) => (n === 1 ? one : n === 2 ? two : n >= 3 && n <= 10 ? `${n} ${few}` : `${n} ${many}`)

export const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
export const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
