import { describe, it, expect } from 'vitest'
import { COMMON, ago, fmtSar, labelOf } from './i18n'
import { arDays, arHours } from './arabic'
import { W as TECHNICAL } from '../pages/technical/words'
import { FW as FINANCE } from '../pages/finance/data'
import { TW as TASKS } from '../pages/tasks/words'
import { LW as LEADS } from '../pages/leads/words'
import { AW as AUTH } from '../pages/auth/words'
import { SW as SALES_TARGETS } from '../pages/sales/words'
import { leadLabels } from './leads/view'
import { AR_LABELS as TASK_AR, STATUS_LABEL, PRIORITY_LABEL, BUCKET_LABEL } from './tasks/logic'
import { AR_LABELS as REQUEST_AR, STATUS_LABEL as REQ_STATUS, KIND_LABEL } from './requests'

// Every English word a screen uses has its Arabic, at every level of
// nesting: a missing key would silently show English (useT falls back).

const keysOf = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) =>
  (v && typeof v === 'object' && !Array.isArray(v) && !v.$$typeof ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`]))

describe('every dictionary has Arabic for every English key', () => {
  const dicts = { COMMON, TECHNICAL, FINANCE, TASKS, LEADS, AUTH, SALES_TARGETS }
  for (const [name, d] of Object.entries(dicts)) {
    it(name, () => {
      const en = keysOf(d.en).sort()
      const ar = keysOf(d.ar).sort()
      expect(en.filter(k => !ar.includes(k)), `missing in Arabic`).toEqual([])
      expect(ar.filter(k => !en.includes(k)), `Arabic only`).toEqual([])
    })
  }
  it('lead labels', () => {
    expect(keysOf(leadLabels('ar')).sort()).toEqual(keysOf(leadLabels('en')).sort())
  })
  it('task and request labels', () => {
    expect(Object.keys(TASK_AR.status).sort()).toEqual(Object.keys(STATUS_LABEL).sort())
    expect(Object.keys(TASK_AR.priority).sort()).toEqual(Object.keys(PRIORITY_LABEL).sort())
    expect(Object.keys(TASK_AR.bucket).sort()).toEqual(Object.keys(BUCKET_LABEL).sort())
    expect(Object.keys(REQUEST_AR.status).sort()).toEqual(Object.keys(REQ_STATUS).sort())
    expect(Object.keys(REQUEST_AR.kind).sort()).toEqual(Object.keys(KIND_LABEL).sort())
  })
})

describe('Arabic wording', () => {
  it('counts agree with the number', () => {
    expect([1, 2, 3, 10, 11, 25].map(arDays)).toEqual(['يوم واحد', 'يومان', '3 أيام', '10 أيام', '11 يومًا', '25 يومًا'])
    expect(arHours(2)).toBe('ساعتان')
  })
  it('time ago in both languages', () => {
    const t = new Date(Date.now() - 3 * 86_400_000).toISOString()
    expect(ago(t, 'en')).toBe('3d ago')
    expect(ago(t, 'ar')).toBe('منذ 3 أيام')
  })
  it('SAR keeps Western digits', () => {
    expect(fmtSar(1_380_000, 'ar')).toBe('1,380,000 ر.س')
    expect(fmtSar(1_380_000, 'en', { short: true })).toBe('1.4M SAR')
  })
  it('a label falls back to English when it has no Arabic', () => {
    expect(labelOf({ label: 'Leads', ar: 'العملاء' }, 'ar')).toBe('العملاء')
    expect(labelOf({ label: 'Leads' }, 'ar')).toBe('Leads')
  })
})
