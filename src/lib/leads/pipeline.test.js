import { describe, it, expect } from 'vitest'
import { trackFields, manualLead, followUpState, groupByStage, pipelineStats, riyadhToday, shortDate, STAGES } from './pipeline'
import { channelLabel, leadFilters, EMPTY_FILTERS } from './view'

describe('the stages', () => {
  it('follow Odoo, Won and Lost last', () => {
    expect(STAGES.map(([k]) => k)).toEqual(['new', 'contacted', 'rfq', 'quotation', 'negotiating', 'won', 'lost'])
  })
  it('check a stage change, and Lost asks why', () => {
    expect(trackFields({ stage: 'quotation' })).toEqual({ values: { stage: 'quotation', lost_reason: '', lost_to: '' } })
    expect(trackFields({ stage: 'lost' }).error).toBe('Say why it was lost.')
    expect(trackFields({ stage: 'lost', lost_reason: 'price', lost_to: ' Rival ' })).toEqual({ values: { stage: 'lost', lost_reason: 'price', lost_to: 'Rival' } })
    expect(trackFields({ stage: 'maybe' }).error).toBe('Unknown stage.')
  })
  it('change only what was sent', () => {
    expect(trackFields({ follow_up: '2026-10-20' })).toEqual({ values: { follow_up: '2026-10-20' } })
    expect(trackFields({ follow_up: '', next_step: ' Call ' })).toEqual({ values: { follow_up: null, next_step: 'Call' } })
    expect(trackFields({ follow_up: 'next week' }).error).toBe('The follow-up date is not a date.')
    expect(trackFields({})).toEqual({ values: {} })
  })
})

describe('a lead added by hand', () => {
  it('needs a name and what they want', () => {
    expect(manualLead({ summary: 'Lights' }).error).toBe('Give the company or the person\'s name.')
    expect(manualLead({ company: 'Co' }).error).toBe('Say what they want.')
    expect(manualLead({ company: 'Co', summary: 'x', email: 'nope' }).error).toBe('That email address does not look right.')
    expect(manualLead({ company: 'Co', summary: 'x', channel: 'fax' }).error).toBe('Unknown way it came in.')
  })
  it('is a qualified lead in the pipeline at New', () => {
    const { row } = manualLead({
      company: ' Example Co ', name: 'Sara', phone: '055 1', email: 'Sara@Gmail.com', channel: 'whatsapp', summary: 'Downlights for a hotel',
      sender_type: 'contractor', project: 'jih', location: 'Jeddah', deadline: 'Friday', notes: 'Called', follow_up: '2026-10-21', next_step: 'Quote',
    })
    expect(row).toMatchObject({
      source: 'manual', channel: 'whatsapp', company: 'Example Co', email: 'sara@gmail.com', phones: ['055 1'], summary: 'Downlights for a hotel',
      message: 'Called', verdict: 'qualified', human_verdict: 'qualified', sender_type: 'contractor', human_project_type: 'jih',
      email_kind: 'free', stage: 'new', follow_up: '2026-10-21', next_step: 'Quote', details: { location: 'Jeddah', urgency: 'Friday' },
    })
    expect(channelLabel(row)).toBe('Added · WhatsApp')
    expect(manualLead({ name: 'فهد', summary: 'انارة' }).row).toMatchObject({ language: 'ar', channel: 'other', follow_up: null, human_project_type: null })
  })
  it('has its own "Came in" choice', () => {
    expect(leadFilters({ ...EMPTY_FILTERS, show: 'all', channel: 'manual' }).eqs).toEqual([['source', 'manual']])
  })
})

describe('what is due', () => {
  it('reads the follow-up date against today in Riyadh', () => {
    expect(riyadhToday(new Date('2026-10-18T22:30:00Z'))).toBe('2026-10-19')
    expect(followUpState('2026-10-17', '2026-10-18')).toBe('overdue')
    expect(followUpState('2026-10-18', '2026-10-18')).toBe('today')
    expect(followUpState('2026-10-21', '2026-10-18')).toBe('soon')
    expect(followUpState('2026-10-30', '2026-10-18')).toBe('later')
    expect(followUpState(null, '2026-10-18')).toBe('')
    expect(shortDate('2026-10-20')).toBe('20 Oct')
  })
  it('groups by stage, most pressing follow-up first, and counts', () => {
    const leads = [
      { id: 'a', stage: 'new', follow_up: '2026-10-25' },
      { id: 'b', stage: 'new', follow_up: '2026-10-17' },
      { id: 'c', stage: 'new', follow_up: null },
      { id: 'd', stage: 'won' },
      { id: 'e', stage: 'lost' },
    ]
    const g = groupByStage(leads)
    expect(g.map((x) => x.key)).toEqual(STAGES.map(([k]) => k))
    expect(g[0].leads.map((l) => l.id)).toEqual(['b', 'a', 'c'])
    expect(pipelineStats(leads, '2026-10-18')).toEqual({ open: 3, due: 1, won: 1, lost: 1 })
  })
})
