import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp, actions } from '../../store/app'
import { useAuth } from '../../store/auth'
import { Card, WarmCard, Button, Textarea, Input, Select, ConfirmDialog, Modal } from '../../components/ui/index'
import {
  DEFAULT_BRAND_PROFILE, fetchBrandProfile, saveBrandProfile,
  buildInstructionsString, isBrandProfileEmpty,
} from '../../lib/brandBrain'
import {
  ASSET_KINDS, fetchBrandAssets, uploadBrandAsset, updateBrandAsset, deleteBrandAsset,
} from '../../lib/brandAssets'
import {
  TASKS, TASK_LABELS, fetchBrandMemory, createBrandMemory, updateBrandMemory, deleteBrandMemory,
} from '../../lib/brandContext'
import {
  fetchBrandSchema, fetchDirectoryRows, getFieldValue, setFieldValue, sortFieldsBySection,
  sectionsApi, fieldsApi, dirColumnsApi, dirRowsApi, slugKey, nextSortOrder,
} from '../../lib/brandSchema'
import { uid } from '../../lib/utils'

// ─── Brand Brain settings ──────────────────────────────────────────────────
// Every section, field and directory column on this page comes from the
// workspace's own rows in brand_sections / brand_fields /
// brand_directory_columns — nothing about the structure is hardcoded here
// any more. Arak's lighting-shaped brain, Aqeeq's spa service menu and Alo
// Kheyatah's alterations price list are the same component reading different
// rows, and marketing reshapes any of them from "Customise structure".

const slug = s => 'section-' + String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-')
const scrollToSection = key => document.getElementById(slug(key))?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const INPUT_TYPES = [
  { value: 'textarea', label: 'Multi-line text' },
  { value: 'text',     label: 'Single line' },
]

const SECTION_KINDS = [
  { value: 'fields',    label: 'Fields — a group of text inputs' },
  { value: 'directory', label: 'Directory — a repeating list of rows' },
]

function ExpandIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
    </svg>
  )
}

function GearIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

// Icon set, keyed by brand_sections.icon. A section created from the
// interface picks one of these; anything unrecognised falls back to the
// generic document mark rather than rendering an empty <svg>.
const SECTION_ICONS = {
  identity:    <><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>,
  guardrails:  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  audience:    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  market:      <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
  visual:      <><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h1.99c3.05 0 5.56-2.5 5.56-5.55C21.96 6.01 17.46 2 12 2z"/></>,
  knowledge:   <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
  assets:      <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
  products:    <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
  templates:   <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
  suppliers:   <><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
  competitors: <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
}
const ICON_CHOICES = Object.keys(SECTION_ICONS)

function SectionIcon({ icon, className = 'w-5 h-5' }) {
  const paths = SECTION_ICONS[icon] || (
    <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>
  )
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">{paths}</svg>
}

// ─── Structure editors ─────────────────────────────────────────────────────

function FieldEditorModal({ field, sections, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(field)
  const isNew = !field.id
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add field' : `Edit "${field.label}"`} width="max-w-lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Label</label>
          <Input value={draft.label || ''} onChange={e => set('label', e.target.value)}
            placeholder="e.g. Booking Occasions" autoFocus />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Hint</label>
          <Input value={draft.hint || ''} onChange={e => set('hint', e.target.value)}
            placeholder="What this field is for — shown under the label" />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Placeholder</label>
          <Input value={draft.placeholder || ''} onChange={e => set('placeholder', e.target.value)}
            placeholder="e.g. Pre-event grooming, post-Ramadan pampering" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Section</label>
            <Select value={draft.section_key} onChange={e => set('section_key', e.target.value)}>
              {sections.filter(s => s.kind === 'fields').map(s => (
                <option key={s.key} value={s.key}>{s.title}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Input</label>
            <Select value={draft.input_type} onChange={e => set('input_type', e.target.value)}>
              {INPUT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Heading used in the AI prompt</label>
          <Input value={draft.prompt_label || ''} onChange={e => set('prompt_label', e.target.value)}
            placeholder="Leave blank to use the label above" />
        </div>

        <label className="flex items-start gap-2.5 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={draft.include_in_prompt !== false}
            onChange={e => set('include_in_prompt', e.target.checked)} />
          <span>
            <span className="font-medium text-text">Send this field to the AI</span>
            <span className="block text-text-tertiary mt-0.5">
              Turn off to keep the text here for the team without adding it to every generation.
            </span>
          </span>
        </label>

        {/* Task scoping sits beside the send-to-AI toggle deliberately: it is
            the same idea one step finer, so it reads as "and only for these",
            not as a separate concept to learn. */}
        {draft.include_in_prompt !== false && (
          <div>
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
              Only send it to
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {TASKS.map(t => {
                const tags = draft.tasks || []
                const on = tags.includes(t)
                return (
                  <button key={t} type="button"
                    onClick={() => set('tasks', on ? tags.filter(x => x !== t) : [...tags, t])}
                    className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-colors ${
                      on ? 'bg-sage-50 border-sage-300 text-sage-700'
                         : 'border-border text-text-secondary hover:border-sage-200'}`}>
                    {TASK_LABELS[t] || t}
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-text-tertiary mt-1.5 leading-relaxed">
              {(draft.tasks || []).length
                ? 'Sent only to the tasks selected above.'
                : 'Nothing selected — sent to every kind of generation. Pick some to narrow it (a price list is useful when planning, wasted in an image prompt).'}
            </p>
          </div>
        )}

        {!isNew && field.storage_column && (
          <p className="text-[11px] text-text-tertiary bg-surface-subtle rounded-lg px-3 py-2">
            This is a built-in field stored in <code>{field.storage_column}</code>. You can rename and reword it,
            but deleting it may affect other pages that read that value.
          </p>
        )}

        <div className="flex items-center justify-between pt-1">
          {!isNew ? (
            <button onClick={() => onDelete(field)} className="text-[11px] text-red-500 hover:text-red-600 font-medium">
              Delete field
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSave(draft)} disabled={!draft.label?.trim()}>
              {isNew ? 'Add field' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function SectionEditorModal({ section, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(section)
  const isNew = !section.id
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add section' : `Edit "${section.title}"`} width="max-w-lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Title</label>
          <Input value={draft.title || ''} onChange={e => set('title', e.target.value)}
            placeholder="e.g. Service Menu" autoFocus />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Description</label>
          <Textarea value={draft.description || ''} onChange={e => set('description', e.target.value)}
            rows={2} placeholder="One line explaining what belongs in this section" />
        </div>

        {isNew && (
          <div>
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Type</label>
            <Select value={draft.kind} onChange={e => set('kind', e.target.value)}>
              {SECTION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          </div>
        )}

        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Icon</label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {ICON_CHOICES.map(name => (
              <button key={name} onClick={() => set('icon', name)}
                className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ring-1 ${
                  draft.icon === name ? 'bg-amber-100 text-amber-700 ring-amber-200' : 'bg-surface-subtle text-text-tertiary ring-border hover:text-amber-600'
                }`} title={name}>
                <SectionIcon icon={name} className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={draft.enabled !== false}
            onChange={e => set('enabled', e.target.checked)} />
          <span className="font-medium text-text">Show this section</span>
        </label>

        <div className="flex items-center justify-between pt-1">
          {!isNew ? (
            <button onClick={() => onDelete(section)} className="text-[11px] text-red-500 hover:text-red-600 font-medium">
              Delete section
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSave(draft)} disabled={!draft.title?.trim()}>
              {isNew ? 'Add section' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function ColumnEditorModal({ column, onSave, onDelete, onClose }) {
  const [draft, setDraft] = useState(column)
  const isNew = !column.id
  const set = (k, v) => setDraft(d => ({ ...d, [k]: v }))

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add column' : `Edit "${column.label}"`} width="max-w-md">
      <div className="p-6 space-y-4">
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Label</label>
          <Input value={draft.label || ''} onChange={e => set('label', e.target.value)}
            placeholder="e.g. Price (SAR)" autoFocus />
        </div>
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Placeholder</label>
          <Input value={draft.placeholder || ''} onChange={e => set('placeholder', e.target.value)}
            placeholder="e.g. 255" />
        </div>
        <label className="flex items-center gap-2.5 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" checked={!!draft.wide} onChange={e => set('wide', e.target.checked)} />
          <span className="font-medium text-text">Full width</span>
        </label>
        <label className="flex items-start gap-2.5 text-xs text-text-secondary cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={draft.in_prompt !== false}
            onChange={e => set('in_prompt', e.target.checked)} />
          <span>
            <span className="font-medium text-text">Send this column to the AI</span>
            <span className="block text-text-tertiary mt-0.5">
              Off is the right choice for prices — they stay editable here without landing in every generation.
            </span>
          </span>
        </label>

        <div className="flex items-center justify-between pt-1">
          {!isNew ? (
            <button onClick={() => onDelete(column)} className="text-[11px] text-red-500 hover:text-red-600 font-medium">
              Delete column
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => onSave(draft)} disabled={!draft.label?.trim()}>
              {isNew ? 'Add column' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Field rendering ───────────────────────────────────────────────────────

function FieldBox({ field, value, onChange, structureMode, onEditField }) {
  const [expanded, setExpanded] = useState(false)
  const filled = !!(value && String(value).trim())
  const single = field.input_type === 'text'
  const lineCount = value ? String(value).split('\n').filter(Boolean).length : 0
  const showMoreHint = !single && lineCount > 3

  return (
    <div className="px-5 sm:px-6 py-5 group/field transition-colors hover:bg-stone-50/50">
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${filled ? 'bg-sage-500' : 'bg-stone-300'}`}
              title={filled ? 'Filled in' : 'Empty'} />
            <p className="text-[15px] font-semibold text-text">{field.label}</p>
            {field.include_in_prompt === false && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] bg-stone-100 text-stone-500">NOT SENT TO AI</span>
            )}
          </div>
          {field.hint && <p className="text-xs text-text-tertiary mt-1 leading-relaxed max-w-xl">{field.hint}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {structureMode && (
            <button onClick={() => onEditField(field)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-amber-600 hover:bg-amber-50 transition-colors"
              title="Edit this field">
              <GearIcon />
            </button>
          )}
          <button onClick={() => setExpanded(true)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-amber-600 hover:bg-amber-50 transition-colors opacity-0 group-hover/field:opacity-100"
            title="Expand to edit full-screen">
            <ExpandIcon />
          </button>
        </div>
      </div>
      {single ? (
        <Input placeholder={field.placeholder} value={value || ''} onChange={e => onChange(e.target.value)} />
      ) : (
        <Textarea placeholder={field.placeholder} value={value || ''} onChange={e => onChange(e.target.value)} rows={field.rows || 4} />
      )}
      {showMoreHint && (
        <button onClick={() => setExpanded(true)} className="text-[11px] text-amber-600 hover:text-amber-700 font-medium mt-2">
          {lineCount} lines — expand to see all
        </button>
      )}

      <Modal open={expanded} onClose={() => setExpanded(false)} title={field.label} width="max-w-2xl">
        <div className="p-6 space-y-3">
          {field.hint && <p className="text-xs text-text-tertiary">{field.hint}</p>}
          {single ? (
            <Input placeholder={field.placeholder} value={value || ''} onChange={e => onChange(e.target.value)} autoFocus />
          ) : (
            <Textarea placeholder={field.placeholder} value={value || ''} onChange={e => onChange(e.target.value)} rows={14} autoFocus />
          )}
          <div className="flex justify-end pt-1">
            <Button onClick={() => setExpanded(false)}>Done</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// Shared section header — icon tile, title, description, count chip, and an
// optional right-aligned action. The whole left block toggles collapse; the
// action sits outside so clicking it doesn't fold the section.
function SectionBar({ section, badge, collapsed, onToggle, action, structureMode, onEditSection }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <button onClick={onToggle} className="flex items-start gap-3.5 min-w-0 text-left group/hd">
        <span className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0 ring-1 ring-amber-100 group-hover/hd:bg-amber-100 transition-colors">
          <SectionIcon icon={section.icon} />
        </span>
        <span className="min-w-0 pt-0.5">
          <span className="flex items-center gap-2 flex-wrap">
            <h2 className="font-semibold text-sm text-text group-hover/hd:text-amber-800 transition-colors">{section.title}</h2>
            {badge != null && <span className="text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] bg-stone-100 text-stone-500">{badge}</span>}
            <svg className={`w-4 h-4 text-text-tertiary transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
          {section.description && <p className="text-xs text-text-tertiary mt-1 leading-relaxed max-w-md">{section.description}</p>}
        </span>
      </button>
      <div className="flex-shrink-0 pt-1 flex items-center gap-1.5">
        {structureMode && (
          <button onClick={() => onEditSection(section)}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-amber-600 hover:bg-amber-50 transition-colors"
            title="Edit this section">
            <GearIcon />
          </button>
        )}
        {action}
      </div>
    </div>
  )
}

function FieldGroup({ section, fields, profile, onFieldChange, structureMode, onEditField, onEditSection, onAddField }) {
  const [collapsed, setCollapsed] = useState(false)
  const filledCount = fields.filter(f => String(getFieldValue(profile, f) || '').trim()).length

  return (
    <section id={slug(section.key)} className="scroll-mt-6">
      <SectionBar section={section} badge={`${filledCount}/${fields.length}`}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}
        structureMode={structureMode} onEditSection={onEditSection}
        action={structureMode ? (
          <Button size="sm" variant="secondary" onClick={() => onAddField(section)}>+ Field</Button>
        ) : null} />
      {!collapsed && (
        <Card className="overflow-hidden divide-y divide-border/70">
          {fields.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center py-6">
              No fields yet — turn on "Customise structure" above to add the first one.
            </p>
          ) : fields.map(f => (
            <FieldBox key={f.id || f.key} field={f} value={getFieldValue(profile, f)}
              onChange={v => onFieldChange(f, v)}
              structureMode={structureMode} onEditField={onEditField} />
          ))}
        </Card>
      )}
    </section>
  )
}

// ─── Asset library (unchanged storage model, now a schema-driven section) ──

function AssetCard({ asset, accessToken, onChange, onDelete, compact, onImageClick }) {
  const [title,   setTitle]   = useState(asset.title || '')
  const [caption, setCaption] = useState(asset.caption || '')
  const [tags,    setTags]    = useState((asset.tags || []).join(', '))
  const [project, setProject] = useState(asset.project || '')
  const [lightbox, setLightbox] = useState(false)
  const isImage = (asset.kind !== 'music') && /\.(png|jpe?g|webp|gif)$/i.test(asset.storage_path)
  const kindLabel = ASSET_KINDS.find(k => k.value === asset.kind)?.label || 'Other'

  async function saveMeta(extra) {
    const patch = {
      title,
      caption,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      ...extra,
    }
    const result = await updateBrandAsset(accessToken, asset.id, patch)
    if (result.ok) onChange(result.row)
  }

  return (
    <Card className="overflow-hidden">
      <div className={`aspect-video bg-surface-subtle flex items-center justify-center overflow-hidden ${isImage ? 'cursor-zoom-in' : ''}`}
        onClick={() => isImage && (onImageClick ? onImageClick(asset) : setLightbox(true))}>
        {isImage ? (
          <img src={asset.public_url} alt={title} className="w-full h-full object-cover" />
        ) : (
          <svg className="w-8 h-8 text-text-tertiary" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            {asset.kind === 'music'
              ? <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>
              : <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>}
          </svg>
        )}
      </div>
      <div className="p-3 space-y-2">
        <span className="inline-block text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] bg-amber-100 text-amber-700">{kindLabel}</span>
        <input value={title} onChange={e => setTitle(e.target.value)} onBlur={() => saveMeta()}
          placeholder="Title" className="w-full text-sm font-medium text-text bg-transparent focus:outline-none border-b border-transparent focus:border-amber-300 py-0.5" />
        {!compact && (
          <textarea value={caption} onChange={e => setCaption(e.target.value)} onBlur={() => saveMeta()}
            placeholder="Caption / context for AI generation" rows={2}
            className="w-full text-xs text-text-secondary bg-transparent focus:outline-none resize-none border-b border-transparent focus:border-amber-300 py-0.5" />
        )}
        {!compact && asset.kind === 'project_photo' && (
          <input value={project} onChange={e => setProject(e.target.value)} onBlur={() => saveMeta({ project })}
            placeholder="Project name (blank = individual photo)"
            className="w-full text-[11px] text-amber-700 bg-transparent focus:outline-none border-b border-transparent focus:border-amber-300 py-0.5" />
        )}
        {!compact && (
          <input value={tags} onChange={e => setTags(e.target.value)} onBlur={() => saveMeta()}
            placeholder="tags, comma, separated" className="w-full text-[11px] text-text-tertiary bg-transparent focus:outline-none border-b border-transparent focus:border-amber-300 py-0.5" />
        )}
        <button onClick={() => onDelete(asset)} className="text-[11px] text-red-500 hover:text-red-600 font-medium pt-1">Delete</button>
        {compact && asset.kind === 'project_photo' && asset.project && (
          <button onClick={() => saveMeta({ project: '' })} className="text-[11px] text-text-tertiary hover:text-amber-700 font-medium pt-1 ml-3">
            Remove from group
          </button>
        )}
      </div>

      {isImage && (
        <Modal open={lightbox} onClose={() => setLightbox(false)} title={title || kindLabel} width="max-w-3xl">
          <div className="p-4">
            <img src={asset.public_url} alt={title} className="w-full max-h-[75vh] object-contain rounded-lg" />
          </div>
        </Modal>
      )}
    </Card>
  )
}

function ProjectGroupCard({ name, photos, onOpen }) {
  return (
    <Card className="overflow-hidden cursor-pointer group/proj" onClick={onOpen}>
      <div className="aspect-video bg-surface-subtle overflow-hidden relative">
        <img src={photos[0]?.public_url} alt={name} className="w-full h-full object-cover group-hover/proj:scale-105 transition-transform duration-300" />
        <span className="absolute bottom-2 right-2 text-[10px] font-bold px-1.5 py-0.5 leading-[1.4] bg-black/60 text-white">
          {photos.length} photo{photos.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-text truncate">{name}</p>
        <p className="text-[11px] text-text-tertiary mt-0.5">Project group — click to open</p>
      </div>
    </Card>
  )
}

function NewProjectGroupTile({ onClick }) {
  return (
    <div className="absolute -bottom-2 -right-2 group/new">
      <button onClick={onClick} title="Create new project group"
        className="w-10 h-10 bg-amber-700 hover:bg-amber-800 text-white flex items-center justify-center transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
      </button>
      <span className="pointer-events-none absolute bottom-full right-0 mb-2 whitespace-nowrap text-[11px] font-semibold text-white bg-stone-800 px-2.5 py-1 rounded-lg opacity-0 group-hover/new:opacity-100 transition-opacity">
        Create new project group
      </span>
    </div>
  )
}

// Name + at least one staged photo are both required before the group can be
// created — nothing is uploaded until "Create group" is pressed, so a
// half-filled attempt never leaves an orphan empty group behind.
function NewProjectGroupModal({ accessToken, activeWorkspaceId, onCreated, onClose }) {
  const [name, setName] = useState('')
  const [files, setFiles] = useState([])
  const [creating, setCreating] = useState(false)
  const inputRef = useRef(null)

  function addFiles(fileList) {
    setFiles(prev => [...prev, ...Array.from(fileList || [])])
  }
  function removeFile(i) {
    setFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  const canCreate = name.trim().length > 0 && files.length > 0 && !creating

  async function handleCreate() {
    if (!canCreate) return
    setCreating(true)
    const rows = []
    for (const file of files) {
      const result = await uploadBrandAsset(activeWorkspaceId, accessToken, file, 'project_photo', name.trim())
      if (result.ok) rows.push(result.row)
    }
    setCreating(false)
    if (rows.length) onCreated(rows, name.trim())
  }

  return (
    <Modal open onClose={onClose} title="Create new project group" width="max-w-lg">
      <div className="p-6 space-y-4">
        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Project name</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Riyadh Air" autoFocus />
        </div>

        <div>
          <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Photos</label>
          <div onDrop={e => { e.preventDefault(); addFiles(e.dataTransfer.files) }} onDragOver={e => e.preventDefault()}
            onClick={() => inputRef.current?.click()}
            className="mt-1 border-2 border-dashed border-border hover:border-amber-400 rounded-2xl p-5 text-center transition-colors cursor-pointer">
            <p className="text-xs text-text-secondary">Drop photos here or <span className="text-amber-600 font-medium">browse</span> — at least one is required</p>
          </div>
          <input ref={inputRef} type="file" multiple accept="image/*" className="hidden"
            onChange={e => { addFiles(e.target.files); e.target.value = '' }} />
        </div>

        {files.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {files.map((file, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-surface-subtle group/thumb">
                <img src={URL.createObjectURL(file)} alt={file.name} className="w-full h-full object-cover" />
                <button onClick={() => removeFile(i)}
                  className="absolute top-1 right-1 w-5 h-5 bg-black/70 hover:bg-black/85 text-white flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <p className="text-[11px] text-text-tertiary">
            {!name.trim() && !files.length ? 'Name and at least one photo required.'
              : !name.trim() ? 'Project name required.'
              : !files.length ? 'Add at least one photo.'
              : `${files.length} photo${files.length !== 1 ? 's' : ''} ready.`}
          </p>
          <Button onClick={handleCreate} disabled={!canCreate}>
            {creating ? 'Creating…' : 'Create group'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Instagram-style slide-through viewer for a set of photos: arrow buttons,
// left/right arrow keys, and click-the-edge-of-the-image to step through.
function PhotoCarousel({ photos, index, onIndexChange, onClose }) {
  const photo = photos[index]

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onIndexChange(i => (i - 1 + photos.length) % photos.length)
      if (e.key === 'ArrowRight') onIndexChange(i => (i + 1) % photos.length)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [photos.length, onClose, onIndexChange])

  if (!photo) return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,8,6,0.9)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>

      <button onClick={onClose}
        className="absolute top-4 right-4 w-9 h-9 bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>

      <span className="absolute top-4 left-4 text-xs font-semibold text-white/70">{index + 1} / {photos.length}</span>

      {/* Sized to the image itself so the arrows hug its edges instead of the viewport */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative inline-block">
          {photos.length > 1 && (
            <button onClick={() => onIndexChange(i => (i - 1 + photos.length) % photos.length)}
              className="absolute -left-5 top-1/2 -translate-y-1/2 w-10 h-10 bg-white hover:bg-surface-subtle text-text flex items-center justify-center transition-colors border border-border">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}

          <img src={photo.public_url} alt={photo.title || ''} className="block max-w-[85vw] max-h-[70vh] object-contain rounded-lg select-none" />

          {photos.length > 1 && (
            <button onClick={() => onIndexChange(i => (i + 1) % photos.length)}
              className="absolute -right-5 top-1/2 -translate-y-1/2 w-10 h-10 bg-white hover:bg-surface-subtle text-text flex items-center justify-center transition-colors border border-border">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          )}
        </div>

        {photos.length > 1 && (
          <div className="flex items-center gap-1.5">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => onIndexChange(() => i)}
                className={`transition-all ${i === index ? 'w-4 h-1.5 bg-white' : 'w-1.5 h-1.5 bg-white/40 hover:bg-white/70'}`} />
            ))}
          </div>
        )}

        {(photo.title || photo.caption) && (
          <div className="max-w-md text-center px-4 -mt-1">
            {photo.title && <p className="text-sm font-semibold text-white">{photo.title}</p>}
            {photo.caption && <p className="text-xs text-white/70 mt-0.5">{photo.caption}</p>}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function ProjectGroupModal({ name, photos, accessToken, activeWorkspaceId, onChange, onAdd, onDelete, onClose }) {
  const [uploading, setUploading] = useState(false)
  const [carouselIndex, setCarouselIndex] = useState(null)
  const inputRef = useRef(null)

  async function handleFiles(files) {
    if (!activeWorkspaceId || !files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const result = await uploadBrandAsset(activeWorkspaceId, accessToken, file, 'project_photo', name)
      if (result.ok) onAdd(result.row)
    }
    setUploading(false)
  }

  // Clamp in case the photo at the open index gets deleted/removed while
  // browsing. Done during render rather than in an effect: React re-renders
  // immediately without committing, so the carousel never paints a frame
  // pointing past the end of the array.
  if (carouselIndex != null && carouselIndex >= photos.length) {
    setCarouselIndex(photos.length > 0 ? photos.length - 1 : null)
  }

  return (
    <Modal open onClose={onClose} title={name} width="max-w-4xl">
      <div className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '+ Add photos to this group'}
          </Button>
          <input ref={inputRef} type="file" multiple accept="image/*" className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((asset, i) => (
            <AssetCard key={asset.id} asset={asset} accessToken={accessToken} compact
              onChange={onChange} onDelete={onDelete} onImageClick={() => setCarouselIndex(i)} />
          ))}
        </div>
      </div>

      {carouselIndex != null && (
        <PhotoCarousel photos={photos} index={carouselIndex} onIndexChange={setCarouselIndex} onClose={() => setCarouselIndex(null)} />
      )}
    </Modal>
  )
}

const FILTER_PRIORITY = ['project_photo', 'logo', 'product_photo', 'reference', 'music', 'other']

function AssetLibrary({ section, structureMode, onEditSection }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [assets,   setAssets]   = useState([])
  const [loadedFor, setLoadedFor] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [kind,     setKind]     = useState('product_photo')
  const [uploadProject, setUploadProject] = useState('')
  const [filter,   setFilter]   = useState('project_photo')
  const [viewMode, setViewMode] = useState('groups') // 'groups' | 'individual' | 'all' — project_photo only
  const [openGroup, setOpenGroup] = useState(null)
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [collapsed, setCollapsed] = useState(true)
  const inputRef = useRef(null)

  // `loading` is derived from whose data we're holding rather than set inside
  // the effect — which also means a slow response for a workspace you've
  // already left can't overwrite the current one's assets.
  const loading = !!activeWorkspaceId && loadedFor !== activeWorkspaceId

  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    fetchBrandAssets(activeWorkspaceId, accessToken).then(a => {
      if (!alive) return
      setAssets(a); setLoadedFor(activeWorkspaceId)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  async function handleFiles(files) {
    if (!activeWorkspaceId || !files?.length) return
    setUploading(true)
    for (const file of Array.from(files)) {
      const result = await uploadBrandAsset(activeWorkspaceId, accessToken, file, kind, kind === 'project_photo' ? uploadProject : '')
      if (result.ok) setAssets(prev => [result.row, ...prev])
    }
    setUploading(false)
  }

  async function handleDelete(asset) {
    await deleteBrandAsset(accessToken, asset.id, asset.storage_path)
    setAssets(prev => prev.filter(a => a.id !== asset.id))
    setDeleteTarget(null)
  }

  function handleAssetChange(row) {
    setAssets(prev => prev.map(a => a.id === row.id ? row : a))
  }

  function handleAssetAdded(row) {
    setAssets(prev => [row, ...prev])
  }

  function handleGroupCreated(rows, name) {
    setAssets(prev => [...rows, ...prev])
    setCreatingGroup(false)
    setOpenGroup(name)
  }

  const filtered = filter === 'all' ? assets : assets.filter(a => a.kind === filter)

  // Project photos split into named groups vs ungrouped ("individual").
  const projectPhotos = assets.filter(a => a.kind === 'project_photo')
  const groupsMap = {}
  for (const a of projectPhotos) {
    const p = (a.project || '').trim()
    if (!p) continue
    ;(groupsMap[p] ||= []).push(a)
  }
  const groupNames = Object.keys(groupsMap).sort()
  const individualProjectPhotos = projectPhotos.filter(a => !(a.project || '').trim())
  const openGroupPhotos = openGroup ? assets.filter(a => a.kind === 'project_photo' && (a.project || '').trim() === openGroup) : []

  const showingProjectPhotos = filter === 'project_photo'

  return (
    <section id={slug(section.key)} className="scroll-mt-6">
      <SectionBar section={section}
        badge={assets.length > 0 ? `${assets.length} file${assets.length !== 1 ? 's' : ''}` : null}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}
        structureMode={structureMode} onEditSection={onEditSection} />
      {!collapsed && (
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onChange={e => setKind(e.target.value)} className="w-auto">
            {ASSET_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
          {kind === 'project_photo' && (
            <Input value={uploadProject} onChange={e => setUploadProject(e.target.value)}
              placeholder="Project name — blank for individual" className="w-64" />
          )}
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </Button>
          <input ref={inputRef} type="file" multiple accept="image/*,audio/*" className="hidden"
            onChange={e => { handleFiles(e.target.files); e.target.value = '' }} />
        </div>

        <div onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files) }} onDragOver={e => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-border hover:border-amber-400 rounded-2xl p-5 text-center transition-colors cursor-pointer">
          <p className="text-xs text-text-secondary">Drop files here or <span className="text-amber-600 font-medium">browse</span> — tagged as "{ASSET_KINDS.find(k => k.value === kind)?.label}"{kind === 'project_photo' && uploadProject.trim() ? ` in "${uploadProject.trim()}"` : ''}</p>
        </div>

        {assets.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {[...ASSET_KINDS].sort((a, b) => FILTER_PRIORITY.indexOf(a.value) - FILTER_PRIORITY.indexOf(b.value)).map(k => {
              const count = assets.filter(a => a.kind === k.value).length
              if (!count) return null
              return (
                <button key={k.value} onClick={() => setFilter(k.value)} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${filter === k.value ? 'bg-amber-100 text-amber-700' : 'text-text-tertiary hover:bg-surface-subtle'}`}>{k.label} ({count})</button>
              )
            })}
            <button onClick={() => setFilter('all')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${filter === 'all' ? 'bg-amber-100 text-amber-700' : 'text-text-tertiary hover:bg-surface-subtle'}`}>All ({assets.length})</button>
          </div>
        )}

        {/* Groups / Individual / All sub-filter — only meaningful for project photos */}
        {showingProjectPhotos && projectPhotos.length > 0 && (
          <div className="flex gap-1 flex-wrap border-t border-border pt-3">
            <button onClick={() => setViewMode('groups')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${viewMode === 'groups' ? 'bg-stone-800 text-white' : 'text-text-tertiary hover:bg-surface-subtle'}`}>Groups ({groupNames.length})</button>
            <button onClick={() => setViewMode('individual')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${viewMode === 'individual' ? 'bg-stone-800 text-white' : 'text-text-tertiary hover:bg-surface-subtle'}`}>Individual ({individualProjectPhotos.length})</button>
            <button onClick={() => setViewMode('all')} className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors ${viewMode === 'all' ? 'bg-stone-800 text-white' : 'text-text-tertiary hover:bg-surface-subtle'}`}>All photos ({projectPhotos.length})</button>
          </div>
        )}

        {loading ? (
          <p className="text-xs text-text-tertiary text-center py-6">Loading assets…</p>
        ) : showingProjectPhotos && viewMode === 'groups' ? (
          <div className="relative pb-6 pr-6">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {groupNames.map(name => (
                <ProjectGroupCard key={name} name={name} photos={groupsMap[name]} onOpen={() => setOpenGroup(name)} />
              ))}
            </div>
            <NewProjectGroupTile onClick={() => setCreatingGroup(true)} />
          </div>
        ) : showingProjectPhotos && viewMode === 'individual' ? (
          individualProjectPhotos.length === 0 ? (
            <p className="text-xs text-text-tertiary text-center py-6">No individual project photos — everything's grouped.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {individualProjectPhotos.map(asset => (
                <AssetCard key={asset.id} asset={asset} accessToken={accessToken}
                  onChange={handleAssetChange} onDelete={setDeleteTarget} />
              ))}
            </div>
          )
        ) : filtered.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-6">No assets yet — upload your first photo above.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {filtered.map(asset => (
              <AssetCard key={asset.id} asset={asset} accessToken={accessToken}
                onChange={handleAssetChange}
                onDelete={setDeleteTarget} />
            ))}
          </div>
        )}
      </Card>
      )}

      {openGroup && (
        <ProjectGroupModal name={openGroup} photos={openGroupPhotos}
          accessToken={accessToken} activeWorkspaceId={activeWorkspaceId}
          onChange={handleAssetChange} onAdd={handleAssetAdded} onDelete={setDeleteTarget}
          onClose={() => setOpenGroup(null)} />
      )}

      {creatingGroup && (
        <NewProjectGroupModal accessToken={accessToken} activeWorkspaceId={activeWorkspaceId}
          onCreated={handleGroupCreated} onClose={() => setCreatingGroup(false)} />
      )}

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        onConfirm={() => handleDelete(deleteTarget)} title="Delete asset"
        message="This will permanently remove this file from the brand asset library." danger />
    </section>
  )
}

// ─── Directory sections ────────────────────────────────────────────────────
// Rows are JSONB keyed by the section's own columns, so "Service Menu" with
// Arabic names and SAR prices and "Suppliers" with product lines are the same
// component reading different column definitions.


// ─── Learned Guidance ──────────────────────────────────────────────────────
// brand_memory surfaced inside the Brand Brain rather than in a separate
// screen, because a rule that steers generation IS brand knowledge — it just
// happens to have been learned rather than typed.
//
// Only 'active' rules are injected into prompts. A 'proposed' rule is
// something the system inferred and no human has agreed to yet; letting those
// steer output automatically would mean the brand's voice drifting on the
// strength of an unreviewed guess.
function LearnedGuidance({ rules, onAdd, onSetStatus, onDelete, busy }) {
  const [text, setText] = useState('')
  const [scope, setScope] = useState('global')

  const active   = rules.filter(r => r.status === 'active')
  const proposed = rules.filter(r => r.status === 'proposed')
  const retired  = rules.filter(r => r.status === 'retired')

  function submit() {
    const rule = text.trim()
    if (!rule) return
    onAdd({ rule, scope, status: 'active', source: 'human' })
    setText('')
  }

  const Row = ({ r }) => (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-white px-3 py-2">
      <span className="flex-1 min-w-0">
        <span className="block text-xs text-text leading-relaxed">{r.rule}</span>
        <span className="block text-[10px] text-text-tertiary mt-0.5">
          {r.scope} · from {r.source}
          {r.evidence?.sample_size ? ` · ${r.evidence.sample_size} posts` : ''}
        </span>
        {r.detail && <span className="block text-[10px] text-text-tertiary mt-1 leading-relaxed">{r.detail}</span>}
      </span>
      <span className="flex items-center gap-1 shrink-0">
        {r.status !== 'active' && (
          <button type="button" disabled={busy} onClick={() => onSetStatus(r, 'active')}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-sage-200 text-sage-700 hover:bg-sage-50">
            Activate
          </button>
        )}
        {r.status === 'active' && (
          <button type="button" disabled={busy} onClick={() => onSetStatus(r, 'retired')}
            className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-border text-text-secondary hover:bg-surface-subtle">
            Retire
          </button>
        )}
        <button type="button" disabled={busy} onClick={() => onDelete(r)}
          className="text-[11px] font-semibold px-2 py-1 rounded-lg border border-border text-text-tertiary hover:text-red-500 hover:border-red-200">
          Delete
        </button>
      </span>
    </div>
  )

  return (
    <Card id={slug('learned_guidance')} className="scroll-mt-24">
      <div className="px-5 pt-5">
        <h2 className="text-sm font-semibold text-text">Learned Guidance</h2>
        <p className="text-xs text-text-secondary mt-1 leading-relaxed">
          Short rules that get added to every matching generation, on top of the fields above.
          Write them yourself, or approve ones the system proposes from what was rejected,
          edited, or how posts actually performed.
        </p>
      </div>

      <div className="p-5 space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[240px]">
            <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">Add a rule</label>
            <Input value={text} onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="One imperative sentence, e.g. Do not open captions with a rhetorical question." />
          </div>
          <Select value={scope} onChange={e => setScope(e.target.value)}>
            {['global', 'plan', 'caption', 'image', 'timing', 'competitor', 'trend'].map(v => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
          <Button onClick={submit} disabled={busy || !text.trim()} variant="secondary">Add</Button>
        </div>

        {proposed.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide">
              Proposed — not steering anything yet ({proposed.length})
            </p>
            {proposed.map(r => <Row key={r.id} r={r} />)}
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">
            Active — sent with every matching generation ({active.length})
          </p>
          {active.length === 0
            ? <p className="text-xs text-text-tertiary">Nothing active yet.</p>
            : active.map(r => <Row key={r.id} r={r} />)}
        </div>

        {retired.length > 0 && (
          <details>
            <summary className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide cursor-pointer">
              Retired ({retired.length})
            </summary>
            <div className="space-y-1.5 mt-1.5">{retired.map(r => <Row key={r.id} r={r} />)}</div>
          </details>
        )}
      </div>
    </Card>
  )
}

function DirectoryEditor({
  section, columns, rows, onRowsChange,
  structureMode, onEditSection, onEditColumn, onAddColumn,
}) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [collapsed, setCollapsed] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState(null)

  const visibleColumns = columns.filter(c => c.enabled !== false)

  async function addRow() {
    setCollapsed(false)
    const result = await dirRowsApi.create(activeWorkspaceId, accessToken, {
      section_key: section.key,
      data: {},
      sort_order: nextSortOrder(rows),
    })
    if (result.ok) onRowsChange([...rows, result.row])
  }

  async function saveCell(row, key, value) {
    const data = { ...(row.data || {}), [key]: value }
    onRowsChange(rows.map(r => r.id === row.id ? { ...r, data } : r))
    await dirRowsApi.update(accessToken, row.id, { data })
  }

  async function removeRow(row) {
    onRowsChange(rows.filter(r => r.id !== row.id))
    setDeleteTarget(null)
    await dirRowsApi.remove(accessToken, row.id)
  }

  return (
    <section id={slug(section.key)} className="scroll-mt-6">
      <SectionBar section={section} badge={rows.length > 0 ? rows.length : null}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}
        structureMode={structureMode} onEditSection={onEditSection}
        action={
          <div className="flex items-center gap-1.5">
            {structureMode && (
              <Button size="sm" variant="secondary" onClick={() => onAddColumn(section)}>+ Column</Button>
            )}
            <Button size="sm" variant="secondary" onClick={addRow}>+ Add</Button>
          </div>
        } />
      {!collapsed && (
      <Card className="overflow-hidden">
        {structureMode && visibleColumns.length > 0 && (
          <div className="px-5 py-3 bg-surface-subtle border-b border-border flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide mr-1">Columns</span>
            {visibleColumns.map(c => (
              <button key={c.id} onClick={() => onEditColumn(c)}
                className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-white border border-border text-text-secondary hover:border-amber-300 hover:text-amber-700 transition-colors">
                {c.label}{c.in_prompt === false ? ' ·' : ''}
              </button>
            ))}
            <span className="text-[11px] text-text-tertiary ml-1">· = not sent to AI</span>
          </div>
        )}
        {visibleColumns.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-6">
            No columns defined — turn on "Customise structure" and add the first one.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-6">Nothing yet — add the first one above.</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row, i) => (
              <div key={row.id} className="p-5 pl-11 grid sm:grid-cols-2 gap-3 relative">
                <span className="absolute left-5 top-5 w-6 h-6 bg-amber-100 text-amber-800 text-[11px] font-bold flex items-center justify-center tabular-nums">
                  {i + 1}
                </span>
                {visibleColumns.map(c => (
                  <div key={c.id} className={c.wide ? 'sm:col-span-2' : ''}>
                    <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{c.label}</label>
                    <input defaultValue={row.data?.[c.key] || ''} placeholder={c.placeholder}
                      onBlur={e => { if (e.target.value !== (row.data?.[c.key] || '')) saveCell(row, c.key, e.target.value) }}
                      className="w-full text-sm text-text bg-transparent focus:outline-none border-b border-border focus:border-amber-400 py-1" />
                  </div>
                ))}
                <div className="sm:col-span-2 flex justify-end">
                  <button onClick={() => setDeleteTarget(row)} className="text-[11px] text-red-500 hover:text-red-600 font-medium">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      )}

      <ConfirmDialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}
        onConfirm={() => removeRow(deleteTarget)} title={`Delete from ${section.title}`}
        message="This row will be removed permanently." danger />
    </section>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export function BrandBrain() {
  const { state, dispatch } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const isConfigured = !!activeWorkspaceId

  const [profile,  setProfile]  = useState(() => state.brandProfile || { ...DEFAULT_BRAND_PROFILE })
  const [schema,   setSchema]   = useState({ sections: [], fields: [], columns: [] })
  const [dirRows,  setDirRows]  = useState({})   // section_key → rows
  // `loading` is derived from whose data we're holding rather than set inside
  // the effect: it also means a slow response for a workspace you've already
  // switched away from can't paint the wrong brand's structure.
  const [loadedFor, setLoadedFor] = useState(null)
  const loading = isConfigured && loadedFor !== activeWorkspaceId
  const [saving,   setSaving]   = useState(false)
  const [dirty,    setDirty]    = useState(false)
  const [error,    setError]    = useState('')
  const [showPreview, setShowPreview] = useState(false)
  const [activeSection, setActiveSection] = useState(null)
  const [structureMode, setStructureMode] = useState(false)

  // Structure-editing modal targets
  const [fieldTarget,   setFieldTarget]   = useState(null)
  const [sectionTarget, setSectionTarget] = useState(null)
  const [columnTarget,  setColumnTarget]  = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // Everything is keyed on the workspace, so switching companies must refetch
  // rather than leave the previous brand's structure on screen.
  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    Promise.all([
      fetchBrandProfile(activeWorkspaceId, accessToken),
      fetchBrandSchema(activeWorkspaceId, accessToken),
      fetchDirectoryRows(activeWorkspaceId, accessToken),
    ]).then(([p, s, rows]) => {
      if (!alive) return
      const grouped = {}
      for (const r of rows) (grouped[r.section_key] ||= []).push(r)
      setSchema(s)
      setDirRows(grouped)
      if (p) { setProfile(p); dispatch(actions.setBrandProfile(p)) }
      setDirty(false)
      setLoadedFor(activeWorkspaceId)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, dispatch])

  // Learned rules for this brand. All statuses fetched — a human reviewing
  // proposals is the whole point of the section, so filtering to active here
  // would hide exactly what needs deciding.
  const [memory, setMemory] = useState([])
  const [memoryBusy, setMemoryBusy] = useState(false)
  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    fetchBrandMemory(activeWorkspaceId, accessToken, { status: 'all' })
      .then(rows => { if (alive) setMemory(rows) })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken])

  async function addMemory(row) {
    setMemoryBusy(true)
    const res = await createBrandMemory(activeWorkspaceId, accessToken, row)
    setMemoryBusy(false)
    if (res.error) { setError(res.error); return }
    setMemory(m => [res.row, ...m])
  }

  async function setMemoryStatus(rule, status) {
    setMemoryBusy(true)
    const res = await updateBrandMemory(accessToken, rule.id, {
      status, reviewed_at: new Date().toISOString(),
    })
    setMemoryBusy(false)
    if (res.error) { setError(res.error); return }
    setMemory(m => m.map(r => r.id === rule.id ? res.row : r))
  }

  async function removeMemory(rule) {
    setMemoryBusy(true)
    const res = await deleteBrandMemory(accessToken, rule.id)
    setMemoryBusy(false)
    if (res.error) { setError(res.error); return }
    setMemory(m => m.filter(r => r.id !== rule.id))
  }

  const visibleSections = schema.sections.filter(s => s.enabled !== false)
  const fieldsFor = key => schema.fields.filter(f => f.section_key === key && f.enabled !== false)

  // Scroll-spy: highlight the section nearest the top of the viewport so the
  // sidebar always reflects where you are in the page.
  useEffect(() => {
    if (loading || !visibleSections.length) return
    const byId = new Map(visibleSections.map(s => [slug(s.key), s.key]))
    const els = visibleSections.map(s => document.getElementById(slug(s.key))).filter(Boolean)
    if (!els.length) return
    const obs = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting)
      if (!visible.length) return
      const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      const key = byId.get(top.target.id)
      if (key) setActiveSection(key)
    }, { rootMargin: '-12% 0px -78% 0px' })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [loading, schema.sections])

  function handleFieldChange(field, value) {
    setDirty(true)
    setProfile(p => setFieldValue(p, field, value))
  }
  const setPlain = (k, v) => { setDirty(true); setProfile(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    setSaving(true); setError('')
    const result = await saveBrandProfile(activeWorkspaceId, accessToken, profile)
    setSaving(false)
    if (result.error) { setError(result.error); return }
    if (result.profile) {
      setProfile(result.profile)
      dispatch(actions.setBrandProfile(result.profile))
    }
    setDirty(false)
    dispatch(actions.addNotification({ id: uid(), message: 'Brand Brain profile saved.', createdAt: new Date().toISOString() }))
  }

  // ── Structure mutations ──
  // The schema is refetched-in-place rather than refetched from the server:
  // each API call returns the written row, so patching local state keeps the
  // page from flashing while staying in step with what was persisted.

  async function saveField(draft) {
    if (draft.id) {
      const patch = {
        label: draft.label, hint: draft.hint || '', placeholder: draft.placeholder || '',
        input_type: draft.input_type, section_key: draft.section_key,
        prompt_label: draft.prompt_label || '', include_in_prompt: draft.include_in_prompt !== false,
        tasks: draft.tasks || [],
      }
      const result = await fieldsApi.update(accessToken, draft.id, patch)
      if (result.error) { setError(result.error); return }
      setSchema(s => ({ ...s, fields: s.fields.map(f => f.id === draft.id ? result.row : f) }))
    } else {
      const key = slugKey(draft.label, schema.fields.map(f => f.key))
      const result = await fieldsApi.create(activeWorkspaceId, accessToken, {
        section_key: draft.section_key, key,
        label: draft.label, hint: draft.hint || '', placeholder: draft.placeholder || '',
        input_type: draft.input_type || 'textarea', rows: 4,
        storage_column: '',                     // new fields always live in custom_fields
        prompt_label: draft.prompt_label || '',
        include_in_prompt: draft.include_in_prompt !== false,
        tasks: draft.tasks || [],
        sort_order: nextSortOrder(fieldsFor(draft.section_key)),
      })
      if (result.error) { setError(result.error); return }
      setSchema(s => ({ ...s, fields: [...s.fields, result.row] }))
    }
    // Keep the profile's copy of the defs in step so the n8n preview below
    // reflects the change without a page reload.
    setFieldTarget(null)
    refreshFieldDefs()
  }

  // Ranked the same way fetchBrandFieldDefs ranks them, so the n8n preview
  // below reflects the real prompt order rather than the raw fetch order.
  async function refreshFieldDefs() {
    const s = await fetchBrandSchema(activeWorkspaceId, accessToken)
    setSchema(s)
    setProfile(p => ({
      ...p,
      fieldDefs: sortFieldsBySection(s.fields.filter(f => f.enabled !== false), s.sections),
    }))
  }

  async function deleteField(field) {
    const result = await fieldsApi.remove(accessToken, field.id)
    if (result.error) { setError(result.error); return }
    setSchema(s => ({ ...s, fields: s.fields.filter(f => f.id !== field.id) }))
    setFieldTarget(null); setConfirmDelete(null)
    refreshFieldDefs()
  }

  async function saveSection(draft) {
    if (draft.id) {
      const patch = {
        title: draft.title, description: draft.description || '',
        icon: draft.icon || '', enabled: draft.enabled !== false,
      }
      const result = await sectionsApi.update(accessToken, draft.id, patch)
      if (result.error) { setError(result.error); return }
      setSchema(s => ({ ...s, sections: s.sections.map(x => x.id === draft.id ? result.row : x) }))
    } else {
      const key = slugKey(draft.title, schema.sections.map(s => s.key))
      const result = await sectionsApi.create(activeWorkspaceId, accessToken, {
        key, title: draft.title, description: draft.description || '',
        kind: draft.kind || 'fields', icon: draft.icon || '',
        sort_order: nextSortOrder(schema.sections), enabled: true,
      })
      if (result.error) { setError(result.error); return }
      setSchema(s => ({ ...s, sections: [...s.sections, result.row] }))
    }
    setSectionTarget(null)
  }

  async function deleteSection(section) {
    const result = await sectionsApi.remove(accessToken, section.id)
    if (result.error) { setError(result.error); return }
    setSchema(s => ({
      ...s,
      sections: s.sections.filter(x => x.id !== section.id),
      fields:   s.fields.filter(f => f.section_key !== section.key),
      columns:  s.columns.filter(c => c.section_key !== section.key),
    }))
    setSectionTarget(null); setConfirmDelete(null)
    refreshFieldDefs()
  }

  async function saveColumn(draft) {
    if (draft.id) {
      const patch = {
        label: draft.label, placeholder: draft.placeholder || '',
        wide: !!draft.wide, in_prompt: draft.in_prompt !== false,
      }
      const result = await dirColumnsApi.update(accessToken, draft.id, patch)
      if (result.error) { setError(result.error); return }
      setSchema(s => ({ ...s, columns: s.columns.map(c => c.id === draft.id ? result.row : c) }))
    } else {
      const sectionColumns = schema.columns.filter(c => c.section_key === draft.section_key)
      const key = slugKey(draft.label, sectionColumns.map(c => c.key))
      const result = await dirColumnsApi.create(activeWorkspaceId, accessToken, {
        section_key: draft.section_key, key,
        label: draft.label, placeholder: draft.placeholder || '',
        wide: !!draft.wide, in_prompt: draft.in_prompt !== false,
        sort_order: nextSortOrder(sectionColumns),
      })
      if (result.error) { setError(result.error); return }
      setSchema(s => ({ ...s, columns: [...s.columns, result.row] }))
    }
    setColumnTarget(null)
  }

  async function deleteColumn(column) {
    const result = await dirColumnsApi.remove(accessToken, column.id)
    if (result.error) { setError(result.error); return }
    setSchema(s => ({ ...s, columns: s.columns.filter(c => c.id !== column.id) }))
    setColumnTarget(null); setConfirmDelete(null)
  }

  const previewText = buildInstructionsString(profile, '')

  const allFields = schema.fields.filter(f => f.enabled !== false)
  const totalFields  = allFields.length
  const filledFields = allFields.filter(f => String(getFieldValue(profile, f) || '').trim()).length
  const pct = totalFields ? Math.round((filledFields / totalFields) * 100) : 0

  return (
    <div className="max-w-6xl mx-auto pb-4">

      {/* ── Hero ── */}
      <WarmCard className="p-7 sm:p-8 mb-6">
        <div className="flex items-start justify-between gap-8 flex-wrap">
          <div className="max-w-xl min-w-0">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-xl btn-amber flex items-center justify-center text-white shadow-sm">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24"><path d="M12 2a4.5 4.5 0 0 0-4.5 4.5c0 .5.08.98.23 1.42A4 4 0 0 0 5 11.5a4 4 0 0 0 2 3.46V17a3 3 0 0 0 6 0M12 2a4.5 4.5 0 0 1 4.5 4.5c0 .5-.08.98-.23 1.42A4 4 0 0 1 19 11.5a4 4 0 0 1-2 3.46V17a3 3 0 0 1-6 0"/></svg>
              </span>
              <p className="text-xs font-semibold text-amber-700 tracking-[0.14em] uppercase">Brand Brain</p>
            </div>
            <h1 className="text-xl font-bold text-text tracking-tight mb-2.5 leading-tight">One brand voice, every platform.</h1>
            <p className="text-sm text-text-secondary leading-relaxed">
              This is the single source of truth every AI generation reads — captions, imagery, emails,
              and WhatsApp. Its shape belongs to this brand: use <span className="font-medium text-amber-800">Customise structure</span> to
              rename sections, add fields, or drop the ones that don't apply.
            </p>
          </div>

          {/* Completion ring */}
          <div className="flex items-center gap-3.5">
            <div className="relative w-[76px] h-[76px] flex-shrink-0">
              <svg className="w-[76px] h-[76px] -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(146,100,20,0.16)" strokeWidth="3" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#b45309" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 15.5}
                  strokeDashoffset={2 * Math.PI * 15.5 * (1 - pct / 100)}
                  style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-lg font-bold text-amber-800">{pct}%</span>
              </div>
            </div>
            <div className="leading-tight">
              <p className="text-sm font-bold text-stone-900">{filledFields}<span className="text-text-tertiary font-medium">/{totalFields}</span></p>
              <p className="text-[11px] text-text-tertiary">fields<br/>trained</p>
            </div>
          </div>
        </div>
      </WarmCard>

      {!isConfigured && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-start gap-3 mb-6">
          <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div>
            <p className="text-xs font-semibold text-amber-700">No active workspace</p>
            <p className="text-xs text-amber-600 mt-0.5">This shouldn't normally happen while signed in — try signing out and back in. If it persists, your account isn't attached to a workspace yet.</p>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-16 text-text-tertiary text-sm">Loading your brand profile…</div>
      )}

      {!loading && isConfigured && schema.sections.length === 0 && (
        <Card className="p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-text">This brand's brain has no structure yet.</p>
          <p className="text-xs text-text-tertiary max-w-md mx-auto">
            Add the first section to start shaping it — sections hold either a group of fields or a
            repeating directory like a service menu.
          </p>
          <Button onClick={() => setSectionTarget({ title: '', description: '', kind: 'fields', icon: 'identity', enabled: true })}>
            + Add section
          </Button>
        </Card>
      )}

      {!loading && schema.sections.length > 0 && (
        <div className="grid lg:grid-cols-[232px_minmax(0,1fr)] gap-6 lg:gap-8 items-start">

          {/* ── Sidebar nav (desktop) ── */}
          <aside className="hidden lg:block lg:sticky lg:top-4 space-y-3">
            <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Completion</span>
                <span className="text-[11px] font-bold text-amber-700">{pct}%</span>
              </div>
              <div className="h-1.5 bg-stone-100 border border-border overflow-hidden">
                <div className="h-full bg-amber-700 transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-text-tertiary mt-2">{filledFields} of {totalFields} fields filled</p>
            </div>
            <nav className="rounded-2xl border border-border bg-white p-2 shadow-card">
              {visibleSections.map(s => {
                const active = activeSection === s.key
                return (
                  <button key={s.key} onClick={() => scrollToSection(s.key)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-[13px] font-medium transition-colors ${active ? 'bg-amber-50 text-amber-800' : 'text-text-secondary hover:bg-stone-50 hover:text-text'}`}>
                    <SectionIcon icon={s.icon} className={`w-4 h-4 flex-shrink-0 ${active ? 'text-amber-600' : 'text-text-tertiary'}`} />
                    <span className="truncate">{s.title}</span>
                  </button>
                )
              })}
            </nav>
            <button onClick={() => setStructureMode(m => !m)}
              className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-2xl text-[13px] font-semibold border transition-colors ${
                structureMode ? 'bg-amber-700 border-amber-700 text-white' : 'bg-white border-border text-text-secondary hover:border-amber-300 hover:text-amber-700'
              }`}>
              <GearIcon className="w-4 h-4" />
              {structureMode ? 'Done customising' : 'Customise structure'}
            </button>
          </aside>

          {/* ── Main content ── */}
          <div className="space-y-8 min-w-0">

            {/* Mobile section chips + structure toggle */}
            <div className="lg:hidden space-y-2">
              <div className="-mx-1 px-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
                {visibleSections.map(s => (
                  <button key={s.key} onClick={() => scrollToSection(s.key)}
                    className="flex-shrink-0 px-2.5 py-1 leading-[1.4] text-[11px] font-semibold bg-white border border-border text-text-secondary hover:border-amber-300 hover:text-amber-700 transition-colors">
                    {s.title}
                  </button>
                ))}
              </div>
              <Button size="sm" variant={structureMode ? 'primary' : 'secondary'} onClick={() => setStructureMode(m => !m)}>
                {structureMode ? 'Done customising' : 'Customise structure'}
              </Button>
            </div>

            {structureMode && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-xs font-semibold text-amber-800">Customising this brand's structure</p>
                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                  Changes to sections, fields and columns save immediately and affect only this brand.
                  Field values still need the Save button at the bottom.
                </p>
              </div>
            )}

            {visibleSections.map(section => {
              if (section.kind === 'assets') {
                return (
                  <AssetLibrary key={section.key} section={section}
                    structureMode={structureMode} onEditSection={setSectionTarget} />
                )
              }
              if (section.kind === 'directory') {
                return (
                  <DirectoryEditor key={section.key} section={section}
                    columns={schema.columns.filter(c => c.section_key === section.key)}
                    rows={dirRows[section.key] || []}
                    onRowsChange={rows => setDirRows(d => ({ ...d, [section.key]: rows }))}
                    structureMode={structureMode}
                    onEditSection={setSectionTarget}
                    onEditColumn={setColumnTarget}
                    onAddColumn={s => setColumnTarget({ section_key: s.key, label: '', placeholder: '', wide: false, in_prompt: true })} />
                )
              }
              return (
                <FieldGroup key={section.key} section={section} fields={fieldsFor(section.key)}
                  profile={profile} onFieldChange={handleFieldChange}
                  structureMode={structureMode}
                  onEditField={setFieldTarget}
                  onEditSection={setSectionTarget}
                  onAddField={s => setFieldTarget({
                    section_key: s.key, label: '', hint: '', placeholder: '',
                    input_type: 'textarea', prompt_label: '', include_in_prompt: true, tasks: [],
                  })} />
              )
            })}

            {structureMode && (
              <div className="flex justify-center">
                <Button variant="secondary"
                  onClick={() => setSectionTarget({ title: '', description: '', kind: 'fields', icon: 'identity', enabled: true })}>
                  + Add section
                </Button>
              </div>
            )}

            {/* Live preview of what actually gets sent to n8n */}
            <Card className="overflow-hidden">
              <button onClick={() => setShowPreview(v => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-surface-subtle transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-stone-100 flex items-center justify-center">
                    <svg className="w-3.5 h-3.5 text-stone-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text">Preview what gets sent to n8n</p>
                    <p className="text-xs text-text-secondary">
                      {isBrandProfileEmpty(profile) ? 'Nothing yet — fill in at least one field above' : 'See the flattened instructions block'}
                    </p>
                  </div>
                </div>
                <svg className={`w-4 h-4 text-text-tertiary transition-transform ${showPreview ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {showPreview && (
                <div className="px-5 pb-5 border-t border-border pt-4">
                  <pre className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap bg-surface-subtle rounded-xl p-4 font-mono">
                    {previewText || '— empty —'}
                  </pre>
                  <p className="text-[11px] text-text-tertiary mt-2">Each platform's Create page appends its own platform-specific notes after this block.</p>
                </div>
              )}
            </Card>

            <LearnedGuidance
              rules={memory}
              busy={memoryBusy}
              onAdd={addMemory}
              onSetStatus={setMemoryStatus}
              onDelete={removeMemory}
            />

            <div className="h-2" />
          </div>
        </div>
      )}

      {!loading && (
        <div className="sticky bottom-0 -mx-1 px-1 pb-1">
          <div className="flex items-center gap-3 bg-white/95 backdrop-blur-sm border border-border rounded-2xl shadow-dropdown px-5 py-3.5 flex-wrap">
            <Button onClick={handleSave} disabled={!isConfigured || saving || (!dirty && !!profile.updatedAt)}
              variant={dirty || !profile.updatedAt ? 'primary' : 'secondary'}>
              {saving ? 'Saving…' : dirty ? 'Save Brand Brain' : profile.updatedAt ? '✓ Saved' : 'Save Brand Brain'}
            </Button>
            {/* Caption language — which language(s) generated captions are written in. */}
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="font-medium whitespace-nowrap">Caption language</span>
              <select
                value={profile.captionLanguage || 'both'}
                onChange={e => setPlain('captionLanguage', e.target.value)}
                className="rounded-lg border border-border bg-white text-text text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="both">Arabic + English</option>
                <option value="ar">Arabic only (Saudi)</option>
                <option value="en">English only</option>
              </select>
            </label>
            {/* Arabic dialect — stored since v3 but never editable until now. */}
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="font-medium whitespace-nowrap">Arabic</span>
              <select
                value={profile.arabicDialect || 'saudi'}
                onChange={e => setPlain('arabicDialect', e.target.value)}
                className="rounded-lg border border-border bg-white text-text text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="saudi">Saudi dialect</option>
                <option value="msa">Modern Standard Arabic</option>
                <option value="gulf">Gulf / Khaleeji</option>
              </select>
            </label>
            {dirty && !saving && <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>}
            {error && <p className="text-xs text-red-600 flex-1">{error}</p>}
            {!error && profile.updatedAt && (
              <p className="text-xs text-text-tertiary flex-1">Last updated {new Date(profile.updatedAt).toLocaleString()}</p>
            )}
          </div>
        </div>
      )}

      {/* ── Structure editing modals ── */}
      {fieldTarget && (
        <FieldEditorModal field={fieldTarget} sections={schema.sections}
          onSave={saveField}
          onDelete={f => setConfirmDelete({ kind: 'field', target: f })}
          onClose={() => setFieldTarget(null)} />
      )}
      {sectionTarget && (
        <SectionEditorModal section={sectionTarget}
          onSave={saveSection}
          onDelete={s => setConfirmDelete({ kind: 'section', target: s })}
          onClose={() => setSectionTarget(null)} />
      )}
      {columnTarget && (
        <ColumnEditorModal column={columnTarget}
          onSave={saveColumn}
          onDelete={c => setConfirmDelete({ kind: 'column', target: c })}
          onClose={() => setColumnTarget(null)} />
      )}

      <ConfirmDialog open={!!confirmDelete} onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete.kind === 'field')   return deleteField(confirmDelete.target)
          if (confirmDelete.kind === 'section') return deleteSection(confirmDelete.target)
          if (confirmDelete.kind === 'column')  return deleteColumn(confirmDelete.target)
        }}
        title={
          confirmDelete?.kind === 'field'   ? `Delete "${confirmDelete.target.label}"`
          : confirmDelete?.kind === 'section' ? `Delete "${confirmDelete.target.title}"`
          : confirmDelete?.kind === 'column'  ? `Delete "${confirmDelete.target.label}"`
          : 'Delete'
        }
        message={
          confirmDelete?.kind === 'field'
            ? 'This field stops appearing here and stops being sent to the AI. Any text already saved in it is kept, so re-adding a field with the same name brings it back.'
          : confirmDelete?.kind === 'section'
            ? 'The section and its field definitions are removed from this brand. Values and directory rows are kept in the database, but nothing on this page will show them.'
          : 'This column disappears from every row in this directory. The values already typed into it are kept in the database.'
        }
        danger />
    </div>
  )
}
