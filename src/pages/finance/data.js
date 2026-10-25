import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../store/auth'
import { readMoneyRecords, readSyncState } from '../../lib/odooMirror'
import { financeFacts, OVERDUE_DAYS, MARGIN_RED_POINTS } from '../../lib/finance/finance'
import { arDays } from '../../lib/i18n'

// The Finance pages' words and data (kept apart from the components so fast
// refresh keeps working).


export const FW = {
  en: {
    title: 'Invoices & collections', projectsTitle: 'Project margins',
    sub: 'From Odoo Accounting, read every hour. Amounts include VAT: what customers owe.',
    projectsSub: `Collected against invoiced for each project, and its margin to date against the margin quoted. Red when the actual is more than ${MARGIN_RED_POINTS} points under plan.`,
    loadFailed: 'Finance could not be loaded', notSynced: 'Odoo has not been read yet. Numbers appear after the first hourly round.',
    noAccounting: 'Odoo Accounting is not in use, so there are no invoices to show.',
    lastRead: 'Read from Odoo',
    invoicedMonth: 'Invoiced this month', collectedMonth: 'Collected this month', outstanding: 'Outstanding', overdue: `Overdue over ${OVERDUE_DAYS} days`,
    avgDays: d => `unpaid for ${d} days on average`, unpaidN: n => `${n} unpaid invoice${n === 1 ? '' : 's'}`, overdueN: n => `${n} invoice${n === 1 ? '' : 's'}`,
    noPayments: 'Payments are not in the mirror', paymentsSub: 'customer payments dated this month',
    aging: 'How long the unpaid invoices have been outstanding', agingSub: 'Days since the invoice date.',
    unpaid: 'Unpaid invoices', unpaidSub: 'Oldest first. Red: more than 60 days past due.',
    invoice: 'Invoice', customer: 'Customer', date: 'Invoice date', due: 'Due', total: 'Total', residual: 'Still owed', outstandingDays: 'Outstanding',
    days: n => `${n} days`, pastDue: n => `${n} days past due`, partial: 'part paid', none: 'Every invoice is paid.',
    project: 'Project', order: 'Sales order', invoiced: 'Invoiced', collected: 'Collected', pctCollected: '% collected',
    planned: 'Planned margin', actual: 'Actual margin', gap: 'Against plan',
    noProjects: 'No projects in Odoo.', points: p => `${p > 0 ? '+' : ''}${p} pts`,
    missing: { no_order: 'no sales order linked', no_account: 'no analytic account', no_planned_margin: 'the order has no margin' },
    toFix: 'To fix in Odoo', basis: 'Planned = the sales order\'s margin when quoted. Actual = income less costs on the project\'s analytic account so far.',
    count: n => `${n}`, ofInvoiced: p => `${p}% of the order invoiced`,
  },
  ar: {
    title: 'الفواتير والتحصيل', projectsTitle: 'هوامش المشاريع',
    sub: 'من محاسبة أودو، تُقرأ كل ساعة. المبالغ شاملة الضريبة: ما يدين به العملاء.',
    projectsSub: `المحصّل مقابل المفوتر لكل مشروع، وهامشه حتى الآن مقابل الهامش عند التسعير. يظهر بالأحمر إذا قلّ الفعلي عن المخطط بأكثر من ${MARGIN_RED_POINTS} نقاط.`,
    loadFailed: 'تعذّر تحميل البيانات المالية', notSynced: 'لم تتم قراءة أودو بعد. تظهر الأرقام بعد أول قراءة كل ساعة.',
    noAccounting: 'محاسبة أودو غير مستخدمة، فلا توجد فواتير لعرضها.',
    lastRead: 'قُرئ من أودو',
    invoicedMonth: 'المفوتر هذا الشهر', collectedMonth: 'المحصّل هذا الشهر', outstanding: 'المستحق', overdue: `متأخر أكثر من ${OVERDUE_DAYS} يومًا`,
    avgDays: d => `غير مدفوعة منذ ${arDays(d)} في المتوسط`, unpaidN: n => `${n} فواتير غير مدفوعة`, overdueN: n => `${n} فواتير`,
    noPayments: 'المدفوعات غير موجودة في النسخة', paymentsSub: 'مدفوعات العملاء بتاريخ هذا الشهر',
    aging: 'منذ متى الفواتير غير المدفوعة مستحقة', agingSub: 'الأيام منذ تاريخ الفاتورة.',
    unpaid: 'الفواتير غير المدفوعة', unpaidSub: 'الأقدم أولًا. بالأحمر: تجاوزت تاريخ الاستحقاق بأكثر من ٦٠ يومًا.',
    invoice: 'الفاتورة', customer: 'العميل', date: 'تاريخ الفاتورة', due: 'الاستحقاق', total: 'الإجمالي', residual: 'المتبقي', outstandingDays: 'المدة',
    days: n => arDays(n), pastDue: n => `متأخرة ${arDays(n)}`, partial: 'مدفوعة جزئيًا', none: 'كل الفواتير مدفوعة.',
    project: 'المشروع', order: 'أمر البيع', invoiced: 'المفوتر', collected: 'المحصّل', pctCollected: 'نسبة التحصيل',
    planned: 'الهامش المخطط', actual: 'الهامش الفعلي', gap: 'مقابل المخطط',
    noProjects: 'لا توجد مشاريع في أودو.', points: p => `${p > 0 ? '+' : ''}${p} نقطة`,
    missing: { no_order: 'لا يوجد أمر بيع مرتبط', no_account: 'لا يوجد حساب تحليلي', no_planned_margin: 'أمر البيع بلا هامش' },
    toFix: 'للإصلاح في أودو', basis: 'المخطط = هامش أمر البيع عند التسعير. الفعلي = الإيرادات ناقص التكاليف على الحساب التحليلي للمشروع حتى الآن.',
    count: n => `${n}`, ofInvoiced: p => `فُوتر ${p}% من أمر البيع`,
  },
}

/** The mirror's finance records and the facts from them. */
export function useFinance() {
  const { activeWorkspaceId: ws } = useAuth()
  const [state, setState] = useState({ data: undefined, error: null })
  const load = useCallback(() => {
    if (!ws) return
    Promise.all([readMoneyRecords(ws), readSyncState(ws)])
      .then(([records, sync]) => setState({ data: { sync, facts: sync?.last_ok_at ? financeFacts(records, { now: Date.now(), models: sync.models || [], url: sync.odoo_url || '' }) : null }, error: null }))
      .catch(err => setState({ data: null, error: String(err.message || err) }))
  }, [ws])
  useEffect(() => { load() }, [load])
  return state
}

