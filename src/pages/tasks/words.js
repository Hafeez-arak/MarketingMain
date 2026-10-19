// The Tasks screens' words, English and Arabic (lib/i18n.js useT). Status,
// priority, deadline-group and reminder labels are in lib/tasks/logic.js
// (English) and its AR_LABELS (Arabic); see labels() below.

import { STATUS_LABEL, PRIORITY_LABEL, BUCKET_LABEL, REMINDER_CHOICES, AR_LABELS } from '../../lib/tasks/logic'

/** The label sets for a language. */
export function labels(lang) {
  if (lang !== 'ar') return { status: STATUS_LABEL, priority: PRIORITY_LABEL, bucket: BUCKET_LABEL, reminder: Object.fromEntries(REMINDER_CHOICES.map(c => [c.key, c.label])) }
  return AR_LABELS
}

export const TW = {
  en: {
    title: 'Tasks',
    subtitle: 'Your to-do list, the follow-ups you set for others, and what each meeting agreed. Reminders and deadlines come to the bell, and every morning a summary.',
    salesSubtitle: 'Your to-do list and the follow-ups you set for others. Deadlines and reminders come to the bell, and every morning a summary.',
    newTask: '+ New task', tabsLabel: 'Tasks',
    tabs: { mine: 'My tasks', assigned: 'I assigned', team: 'Team', meetings: 'Meetings' },
    person: 'Person', open: 'Open', overdue: 'Overdue', dueWeek: 'Due this week', doneWeek: 'Done (7 days)', salesTag: 'sales',
    noTeamTasks: 'No tasks you can see yet.',
    teamNote: 'You see the tasks you set or were given, and all of a section\'s tasks where you manage it.',
    emptyMine: 'Nothing on your list. Tasks given to you, and ones you add, show up here.',
    emptyAssigned: 'You have not set anyone a task yet.',
    addFollowUp: 'Add a follow-up', addTask: 'Add task', addFollowUpBtn: 'Add follow-up', followUpPrefix: 'Follow up: ',
    // List
    nothingHere: 'Nothing here.', highPriority: 'High priority', meeting: 'Meeting', leadFollowUp: 'Lead follow-up',
    from: name => `from ${name}`, reopen: t => `Reopen: ${t}`, markDone: t => `Mark done: ${t}`,
    someoneLeft: 'someone who left', nobody: 'nobody', me: 'me',
    // Form
    titleMissing: 'Give the task a title.', whatNeedsDoing: 'What needs doing?', task: 'Task', details: 'Details (optional)', detailsLabel: 'Details',
    who: 'Who', deadline: 'Deadline', time: 'Time (optional)', priority: 'Priority', reminder: 'Reminder', cancel: 'Cancel', save: 'Save', add: 'Add',
    // Panel
    fromTo: (a, b) => `From ${a} → ${b}`, close: 'Close', status: 'Status', drop: 'Drop', noDetails: 'No details.',
    priorityLine: p => `Priority: ${p}`, reminderAt: r => ` · Reminder ${r}`,
    edit: 'Edit', openLead: 'Open the lead', delete: 'Delete', confirmDelete: 'Delete this task?',
    history: 'Comments and history', writeComment: 'Write a comment…', comment: 'Comment', send: 'Send',
    events: { created: 'set this task', assigned: 'gave it to', status: 'moved it', due: 'set the deadline to', edited: 'edited it' },
    toStatus: s => ` to ${s}`,
    // Meetings
    meetingsIntro: 'Write a meeting down and type its action items as they are agreed; saving gives everyone their tasks.',
    newMeeting: '+ New meeting', noMeetings: 'No meetings yet.', people: n => `${n} people`,
    doneOf: (d, t) => `${d} of ${t} done`, noItems: 'No action items',
    meetingTitleMissing: 'Give the meeting a title.', whoDoes: t => `Who does "${t}"?`,
    savedSomeFailed: x => `Saved, but some action items did not: ${x}`,
    meetingLabel: 'Meeting', meetingPlaceholder: 'Weekly sales meeting', date: 'Date', section: 'Section',
    sections: { '': 'No section', sales: 'Sales', marketing: 'Marketing', ceo: 'Management', insights: 'Insights', technical: 'Technical', finance: 'Finance' },
    whoWasThere: 'Who was there', notes: 'Notes', notesPlaceholder: 'What was discussed and decided',
    actionItems: 'Action items', actionItemsHelp: 'One per line: what, who, by when. Each becomes a task for that person, and they are told at once.',
    actionItem: i => `Action item ${i}`, whoQ: 'Who?', remove: 'Remove', anotherItem: '+ Another item',
    saveMeeting: 'Save meeting and assign', meetingGone: 'That meeting is not there any more.', back: 'Back', allMeetings: 'All meetings',
    nobodyListed: 'nobody listed', addItem: '+ Add an item', addActionItem: 'Add an action item', noActionItems: 'No action items.', someone: 'someone',
  },
  ar: {
    title: 'المهام',
    subtitle: 'قائمة مهامك، والمتابعات التي كلّفت بها غيرك، وما اتُّفق عليه في كل اجتماع. التذكيرات والمواعيد تصلك في الإشعارات، وملخص كل صباح.',
    salesSubtitle: 'قائمة مهامك والمتابعات التي كلّفت بها غيرك. المواعيد والتذكيرات تصلك في الإشعارات، وملخص كل صباح.',
    newTask: '+ مهمة جديدة', tabsLabel: 'المهام',
    tabs: { mine: 'مهامي', assigned: 'كلّفت بها', team: 'الفريق', meetings: 'الاجتماعات' },
    person: 'الشخص', open: 'مفتوحة', overdue: 'متأخرة', dueWeek: 'مستحقة هذا الأسبوع', doneWeek: 'أُنجزت (٧ أيام)', salesTag: 'مبيعات',
    noTeamTasks: 'لا توجد مهام يمكنك رؤيتها بعد.',
    teamNote: 'ترى المهام التي أسندتها أو أُسندت إليك، وكل مهام القسم الذي تديره.',
    emptyMine: 'لا شيء في قائمتك. المهام المسندة إليك والتي تضيفها تظهر هنا.',
    emptyAssigned: 'لم تكلّف أحدًا بمهمة بعد.',
    addFollowUp: 'إضافة متابعة', addTask: 'إضافة المهمة', addFollowUpBtn: 'إضافة المتابعة', followUpPrefix: 'متابعة: ',
    nothingHere: 'لا شيء هنا.', highPriority: 'أولوية عالية', meeting: 'اجتماع', leadFollowUp: 'متابعة عميل',
    from: name => `من ${name}`, reopen: t => `إعادة فتح: ${t}`, markDone: t => `تعليم كمنجزة: ${t}`,
    someoneLeft: 'شخص غادر', nobody: 'لا أحد', me: 'أنا',
    titleMissing: 'اكتب عنوانًا للمهمة.', whatNeedsDoing: 'ما المطلوب؟', task: 'المهمة', details: 'التفاصيل (اختياري)', detailsLabel: 'التفاصيل',
    who: 'من', deadline: 'الموعد', time: 'الوقت (اختياري)', priority: 'الأولوية', reminder: 'التذكير', cancel: 'إلغاء', save: 'حفظ', add: 'إضافة',
    fromTo: (a, b) => `من ${a} ← ${b}`, close: 'إغلاق', status: 'الحالة', drop: 'إلغاء المهمة', noDetails: 'لا توجد تفاصيل.',
    priorityLine: p => `الأولوية: ${p}`, reminderAt: r => ` · التذكير ${r}`,
    edit: 'تعديل', openLead: 'فتح العميل', delete: 'حذف', confirmDelete: 'حذف هذه المهمة؟',
    history: 'التعليقات والسجل', writeComment: 'اكتب تعليقًا…', comment: 'تعليق', send: 'إرسال',
    events: { created: 'أنشأ هذه المهمة', assigned: 'أسندها إلى', status: 'غيّر حالتها', due: 'حدّد الموعد', edited: 'عدّلها' },
    toStatus: s => ` إلى ${s}`,
    meetingsIntro: 'دوّن الاجتماع واكتب بنود العمل كما يُتفق عليها؛ الحفظ يسند لكل شخص مهامه.',
    newMeeting: '+ اجتماع جديد', noMeetings: 'لا توجد اجتماعات بعد.', people: n => `${n} أشخاص`,
    doneOf: (d, t) => `أُنجز ${d} من ${t}`, noItems: 'لا بنود عمل',
    meetingTitleMissing: 'اكتب عنوانًا للاجتماع.', whoDoes: t => `من سينفّذ "${t}"؟`,
    savedSomeFailed: x => `حُفظ، لكن بعض البنود لم تُحفظ: ${x}`,
    meetingLabel: 'الاجتماع', meetingPlaceholder: 'اجتماع المبيعات الأسبوعي', date: 'التاريخ', section: 'القسم',
    sections: { '': 'بلا قسم', sales: 'المبيعات', marketing: 'التسويق', ceo: 'الإدارة', insights: 'الرؤى', technical: 'الفني', finance: 'المالية' },
    whoWasThere: 'الحضور', notes: 'ملاحظات', notesPlaceholder: 'ما الذي نوقش وتقرر',
    actionItems: 'بنود العمل', actionItemsHelp: 'بند في كل سطر: ماذا، ومن، ومتى. كل بند يصبح مهمة لذلك الشخص ويُبلَّغ فورًا.',
    actionItem: i => `بند العمل ${i}`, whoQ: 'من؟', remove: 'حذف', anotherItem: '+ بند آخر',
    saveMeeting: 'حفظ الاجتماع وإسناد المهام', meetingGone: 'هذا الاجتماع لم يعد موجودًا.', back: 'رجوع', allMeetings: 'كل الاجتماعات',
    nobodyListed: 'لم يُسجَّل حضور', addItem: '+ إضافة بند', addActionItem: 'إضافة بند عمل', noActionItems: 'لا بنود عمل.', someone: 'شخص ما',
  },
}
