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
import { suppliersApi, competitorsApi, productsApi, templatesApi } from '../../lib/brandDirectory'
import { uid } from '../../lib/utils'

const GROUP_ORDER = ['Identity & Voice', 'Guardrails', 'Audience', 'Market & References', 'Visual', 'Knowledge Centre']
// Asset Library filter chip order — project groups first, then logo, then the rest.
const FILTER_PRIORITY = ['project_photo', 'logo', 'product_photo', 'reference', 'music', 'other']
const EXTRA_SECTIONS = ['Asset Library', 'Products', 'Message Templates', 'Suppliers', 'Competitor Watch']
const ALL_SECTIONS = [...GROUP_ORDER, ...EXTRA_SECTIONS]
const slug = s => 'section-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-')
const scrollToSection = s => document.getElementById(slug(s))?.scrollIntoView({ behavior: 'smooth', block: 'start' })

const FIELDS = [
  // ── Identity & Voice ──
  {
    key: 'mission', group: 'Identity & Voice', label: 'Mission', rows: 2,
    placeholder: 'e.g. To light the Kingdom’s landmark spaces with precision and lasting quality',
    hint: 'Why Arak exists — the purpose behind the work.',
  },
  {
    key: 'positioning', group: 'Identity & Voice', label: 'Market Positioning', rows: 2,
    placeholder: 'e.g. KSA’s premium architectural lighting specialist for landmark projects',
    hint: 'Where Arak sits in the market, in one line.',
  },
  {
    key: 'valueProposition', group: 'Identity & Voice', label: 'Value Proposition', rows: 2,
    placeholder: 'e.g. Engineering-grade lighting, specified right the first time',
    hint: 'The core promise to customers.',
  },
  {
    key: 'brandStory', group: 'Identity & Voice', label: 'Brand Story',
    placeholder: 'e.g. 45+ years lighting Saudi Arabia’s most demanding projects — from King Fahad Airport to the Ritz Carlton Riyadh...',
    hint: 'The narrative the AI draws on — history, milestones, what makes Arak, Arak.',
  },
  {
    key: 'companyFacts', group: 'Identity & Voice', label: 'Company Facts',
    placeholder: 'e.g. Founded 1980\n45+ years in business\n3,000+ projects delivered\nIn-house photometric lab',
    hint: 'Hard facts the AI can state with confidence — one per line.',
  },
  {
    key: 'voiceDescriptors', group: 'Identity & Voice', label: 'Brand Voice', single: true,
    placeholder: 'e.g. premium, authoritative, warm but never casual',
    hint: 'A few descriptors — comma separated. The first thing every AI call reads.',
  },

  // ── Guardrails ──
  {
    key: 'toneDos', group: 'Guardrails', label: 'Always Do',
    placeholder: 'e.g. End every post with a genuine question to drive comments\nMention our 45+ years legacy when relevant\nUse "we" not "I" — Arak speaks as a company',
    hint: 'Habits the AI should reach for by default.',
  },
  {
    key: 'toneDonts', group: 'Guardrails', label: 'Never Do',
    placeholder: 'e.g. "We are excited to announce"\n"In today\'s world"\nExclamation marks in headlines\nGeneric stock-photo language',
    hint: 'Banned phrases and patterns. Be specific — vague rules get ignored.',
  },

  // ── Audience ──
  {
    key: 'targetPersonas', group: 'Audience', label: 'Target Personas',
    placeholder: 'e.g. Architects and interior designers specifying for hospitality projects\nReal estate developers in KSA and the wider GCC\nMEP contractors evaluating suppliers',
    hint: 'Who the content is actually written for.',
  },

  // ── Market & References ──
  {
    key: 'marketContext', group: 'Market & References', label: 'Market Context',
    placeholder: 'e.g. Vision 2030 giga-projects (NEOM, Diriyah, Red Sea)\nRamadan & National Day seasonal moments\nShift toward energy-efficient facade lighting',
    hint: 'KSA market dynamics, seasonal angles, and themes worth riding.',
  },
  {
    key: 'keyProjects', group: 'Market & References', label: 'Key Projects & Clients to Reference',
    placeholder: 'e.g. King Fahad Airport\nRitz Carlton Riyadh\nSolitaire Mall\nNEOM hospitality lighting',
    hint: 'Landmark work the AI can credibly name-drop when relevant.',
  },

  // ── Visual ──
  {
    key: 'visualIdentity', group: 'Visual', label: 'Visual Identity',
    placeholder: 'e.g. Brand colours: warm amber + charcoal\nTypography: clean modern serif headlines\nPhotography: real installations, warm light, no harsh white',
    hint: 'Colours, typography, and photography style — the look of the brand.',
  },
  {
    key: 'brandColors', group: 'Visual', label: 'Brand Colours',
    placeholder: 'e.g. Warm bronze #94765e (primary)\nCharcoal #1b1715 (dark base)\nCream #e0cfbc (light backgrounds)',
    hint: 'Palette + hex codes + what each colour is for. Fed to the image generator to keep visuals on-brand.',
  },
  {
    key: 'visualStyleNotes', group: 'Visual', label: 'AI Image Style Defaults',
    placeholder: 'e.g. Prefer warm residential and facade/exterior styles over cool commercial\nAvoid harsh white light in generated imagery\nDefault to portrait crops for Instagram',
    hint: 'How AI-generated imagery should default to looking, before a user picks a style.',
  },

  // ── Knowledge Centre (powers WhatsApp + email too) ──
  {
    key: 'contactInfo', group: 'Knowledge Centre', label: 'Contact & Conversion',
    placeholder: 'e.g. Phone: +966-11-441-1131\nAddress: Hittin, Riyadh 13513\nPrimary CTA: Request a lighting consultation',
    hint: 'Phone, email, address, hours, main call-to-action. Used in every email footer and WhatsApp reply.',
  },
  {
    key: 'languages', group: 'Knowledge Centre', label: 'Languages',
    placeholder: 'e.g. English + Arabic. Arabic should read native, not translated. Same premium tone in both.',
    hint: 'Which languages content is produced in, and any per-language tone rules.',
  },
  {
    key: 'offersCtas', group: 'Knowledge Centre', label: 'Offers & CTAs',
    placeholder: 'e.g. Request a quote\nBook a showroom visit\nDownload the product catalogue\nSeasonal facade-lighting consultation',
    hint: 'The specific actions we push audiences toward — one per line.',
  },
  {
    key: 'complianceNotes', group: 'Knowledge Centre', label: 'Compliance',
    placeholder: 'e.g. WhatsApp: opt-in required, add "Reply STOP to unsubscribe".\nEmail: unsubscribe link + address in footer.',
    hint: 'Opt-in / unsubscribe / legal rules — required for WhatsApp template approval and email sends.',
  },
]

function ExpandIcon({ className = 'w-3.5 h-3.5' }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
    </svg>
  )
}

// Per-section descriptions + icons — turns a flat list of fields into a
// legible knowledge base with intent behind each section.
const SECTION_META = {
  'Identity & Voice':   'The foundation — who Arak is and how it speaks. Read first on every generation.',
  'Guardrails':         'Hard rules the AI must follow — what to always do and what to never do.',
  'Audience':           'Who the content is actually written for.',
  'Market & References': 'KSA market context and landmark work worth name-dropping.',
  'Visual':             'Colours, photography, and how AI-generated imagery should look.',
  'Knowledge Centre':   'Contact details, languages, offers and compliance — powers email & WhatsApp too.',
  'Asset Library':      'Real photos, logos, and references the AI draws from instead of inventing.',
  'Products':           'The actual fixtures Arak sells — so content can feature specific products.',
  'Message Templates':  'Reusable, approved WhatsApp / email / social copy.',
  'Suppliers':          'Supply partners and the product lines they carry.',
  'Competitor Watch':   'Who we’re up against and the angle that sets Arak apart.',
}

function SectionIcon({ title, className = 'w-5 h-5' }) {
  const p = {
    'Identity & Voice':    <><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></>,
    'Guardrails':          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
    'Audience':            <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    'Market & References': <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>,
    'Visual':              <><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.83-.44-1.12-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h1.99c3.05 0 5.56-2.5 5.56-5.55C21.96 6.01 17.46 2 12 2z"/></>,
    'Knowledge Centre':    <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></>,
    'Asset Library':       <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></>,
    'Products':            <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></>,
    'Message Templates':   <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
    'Suppliers':           <><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>,
    'Competitor Watch':    <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>,
  }[title]
  return <svg className={className} fill="none" stroke="currentColor" strokeWidth="1.75" viewBox="0 0 24 24">{p}</svg>
}

function FieldBox({ field, value, onChange }) {
  const [expanded, setExpanded] = useState(false)
  const filled = !!(value && String(value).trim())
  const lineCount = value ? String(value).split('\n').filter(Boolean).length : 0
  const showMoreHint = !field.single && lineCount > 3

  return (
    <div className="px-5 sm:px-6 py-5 group/field transition-colors hover:bg-stone-50/50">
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${filled ? 'bg-sage-500' : 'bg-stone-300'}`}
              title={filled ? 'Filled in' : 'Empty'} />
            <p className="text-[15px] font-semibold text-text">{field.label}</p>
          </div>
          <p className="text-xs text-text-tertiary mt-1 leading-relaxed max-w-xl">{field.hint}</p>
        </div>
        <button onClick={() => setExpanded(true)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-text-tertiary hover:text-amber-600 hover:bg-amber-50 transition-colors flex-shrink-0 opacity-0 group-hover/field:opacity-100"
          title="Expand to edit full-screen">
          <ExpandIcon />
        </button>
      </div>
      {field.single ? (
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
          <p className="text-xs text-text-tertiary">{field.hint}</p>
          {field.single ? (
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
// optional right-aligned action (Upload / + Add). The whole left block toggles
// collapse; the action sits outside so clicking it doesn't fold the section.
function SectionBar({ title, badge, collapsed, onToggle, action }) {
  return (
    <div className="flex items-start justify-between gap-3 mb-4">
      <button onClick={onToggle} className="flex items-start gap-3.5 min-w-0 text-left group/hd">
        <span className="w-11 h-11 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center flex-shrink-0 ring-1 ring-amber-100 group-hover/hd:bg-amber-100 transition-colors">
          <SectionIcon title={title} />
        </span>
        <span className="min-w-0 pt-0.5">
          <span className="flex items-center gap-2 flex-wrap">
            <h2 className="font-display text-lg font-bold text-stone-900 group-hover/hd:text-amber-700 transition-colors">{title}</h2>
            {badge != null && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-stone-100 text-stone-500">{badge}</span>}
            <svg className={`w-4 h-4 text-text-tertiary transition-transform ${collapsed ? '-rotate-90' : ''}`}
              fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
          </span>
          {SECTION_META[title] && <p className="text-xs text-text-tertiary mt-1 leading-relaxed max-w-md">{SECTION_META[title]}</p>}
        </span>
      </button>
      {action && <div className="flex-shrink-0 pt-1">{action}</div>}
    </div>
  )
}

function FieldGroup({ group, fields, profile, set }) {
  const [collapsed, setCollapsed] = useState(false)
  const filledCount = fields.filter(f => profile[f.key] && String(profile[f.key]).trim()).length

  return (
    <section id={slug(group)} className="scroll-mt-6">
      <SectionBar title={group} badge={`${filledCount}/${fields.length}`}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      {!collapsed && (
        <Card className="overflow-hidden divide-y divide-border/70">
          {fields.map(f => (
            <FieldBox key={f.key} field={f} value={profile[f.key]} onChange={v => set(f.key, v)} />
          ))}
        </Card>
      )}
    </section>
  )
}

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
        <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{kindLabel}</span>
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

// One card per named project group (cover photo + count). Click to open the
// full group in a modal — add more photos or pull one out individually.
function ProjectGroupCard({ name, photos, onOpen }) {
  return (
    <Card className="overflow-hidden cursor-pointer group/proj" onClick={onOpen}>
      <div className="aspect-video bg-surface-subtle overflow-hidden relative">
        <img src={photos[0]?.public_url} alt={name} className="w-full h-full object-cover group-hover/proj:scale-105 transition-transform duration-300" />
        <span className="absolute bottom-2 right-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-black/60 text-white">
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

// "+" tile at the end of the groups grid — hover shows a tooltip, click opens
// the create-group flow.
function NewProjectGroupTile({ onClick }) {
  return (
    <div className="absolute -bottom-2 -right-2 group/new">
      <button onClick={onClick} title="Create new project group"
        className="w-10 h-10 rounded-full bg-stone-800 hover:bg-amber-600 text-white shadow-lg flex items-center justify-center transition-colors">
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
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity">
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
// Same list the grid behind it is showing, so add/remove there is reflected
// here automatically (index-based, not a frozen copy).
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
        className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>

      <span className="absolute top-4 left-4 text-xs font-semibold text-white/70">{index + 1} / {photos.length}</span>

      {/* Sized to the image itself so the arrows hug its edges instead of the viewport */}
      <div className="flex flex-col items-center gap-4">
        <div className="relative inline-block">
          {photos.length > 1 && (
            <button onClick={() => onIndexChange(i => (i - 1 + photos.length) % photos.length)}
              className="absolute -left-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-stone-800 shadow-lg flex items-center justify-center transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          )}

          <img src={photo.public_url} alt={photo.title || ''} className="block max-w-[85vw] max-h-[70vh] object-contain rounded-lg select-none" />

          {photos.length > 1 && (
            <button onClick={() => onIndexChange(i => (i + 1) % photos.length)}
              className="absolute -right-5 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/90 hover:bg-white text-stone-800 shadow-lg flex items-center justify-center transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          )}
        </div>

        {photos.length > 1 && (
          <div className="flex items-center gap-1.5">
            {photos.map((p, i) => (
              <button key={p.id} onClick={() => onIndexChange(() => i)}
                className={`rounded-full transition-all ${i === index ? 'w-2.5 h-2.5 bg-amber-500' : 'w-1.5 h-1.5 bg-white/40 hover:bg-white/70'}`} />
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

// Full-screen view of one project's photos: add more (pre-tagged with this
// project), pull a photo out to "individual", or delete it outright.
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

function AssetLibrary() {
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
    <section id={slug('Asset Library')} className="scroll-mt-6">
      <SectionBar title="Asset Library"
        badge={assets.length > 0 ? `${assets.length} file${assets.length !== 1 ? 's' : ''}` : null}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} />
      {!collapsed && (
      <Card className="p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={kind} onChange={e => setKind(e.target.value)} className="w-auto">
            {ASSET_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </Select>
          {kind === 'project_photo' && (
            <Input value={uploadProject} onChange={e => setUploadProject(e.target.value)}
              placeholder="Project name (e.g. Riyadh Air) — blank for individual" className="w-64" />
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

const SUPPLIER_FIELDS = [
  { key: 'name',        label: 'Name',          placeholder: 'e.g. Philips' },
  { key: 'category',    label: 'Category',      placeholder: 'e.g. LED drivers, facade lighting' },
  { key: 'brand_lines', label: 'Product Lines',  placeholder: 'e.g. Hue, CoreLine' },
  { key: 'notes',       label: 'Notes',          placeholder: '', wide: true },
]

const COMPETITOR_FIELDS = [
  { key: 'name',          label: 'Name',          placeholder: 'e.g. Competitor Co' },
  { key: 'positioning',   label: 'Positioning',   placeholder: '' },
  { key: 'strengths',     label: 'Strengths',     placeholder: '', wide: true },
  { key: 'how_we_differ', label: 'How We Differ', placeholder: '', wide: true },
  { key: 'watch_url',     label: 'Watch URL',     placeholder: 'https://...' },
]

const PRODUCT_FIELDS = [
  { key: 'name',        label: 'Name',        placeholder: 'e.g. CoreLine Downlight' },
  { key: 'category',    label: 'Category',    placeholder: 'indoor / facade / outdoor / automation' },
  { key: 'supplier',    label: 'Supplier',    placeholder: 'e.g. Philips' },
  { key: 'price_range', label: 'Price Range', placeholder: 'optional' },
  { key: 'description', label: 'Description', placeholder: '', wide: true },
  { key: 'specs',       label: 'Specs',       placeholder: 'wattage, lumens, IP rating, CCT…', wide: true },
]

const TEMPLATE_FIELDS = [
  { key: 'name',     label: 'Name',     placeholder: 'e.g. Ramadan facade promo' },
  { key: 'channel',  label: 'Channel',  placeholder: 'whatsapp / email / social' },
  { key: 'category', label: 'Category', placeholder: 'marketing / utility / newsletter / promo' },
  { key: 'subject',  label: 'Subject / Header', placeholder: 'email subject or template header', wide: true },
  { key: 'body',     label: 'Body',     placeholder: 'the message copy', wide: true },
  { key: 'status',   label: 'Status',   placeholder: 'draft / pending / approved' },
]

function DirectoryEditor({ title, api, fields, emptyRow, numbered }) {
  const { activeWorkspaceId, accessToken } = useAuth()
  const [rows,    setRows]    = useState([])
  const [loadedFor, setLoadedFor] = useState(null)
  const [collapsed, setCollapsed] = useState(true)

  const loading = !!activeWorkspaceId && loadedFor !== activeWorkspaceId

  useEffect(() => {
    if (!activeWorkspaceId) return
    let alive = true
    api.list(activeWorkspaceId, accessToken).then(r => {
      if (!alive) return
      setRows(r); setLoadedFor(activeWorkspaceId)
    })
    return () => { alive = false }
  }, [activeWorkspaceId, accessToken, api])

  async function addRow() {
    setCollapsed(false)
    const result = await api.create(activeWorkspaceId, accessToken, emptyRow)
    if (result.ok) setRows(prev => [...prev, result.row])
  }

  async function saveRow(row, patch) {
    setRows(prev => prev.map(r => r.id === row.id ? { ...r, ...patch } : r))
    await api.update(accessToken, row.id, patch)
  }

  async function removeRow(id) {
    setRows(prev => prev.filter(r => r.id !== id))
    await api.remove(accessToken, id)
  }

  return (
    <section id={slug(title)} className="scroll-mt-6">
      <SectionBar title={title} badge={rows.length > 0 ? rows.length : null}
        collapsed={collapsed} onToggle={() => setCollapsed(c => !c)}
        action={<Button size="sm" variant="secondary" onClick={addRow}>+ Add</Button>} />
      {!collapsed && (
      <Card className="overflow-hidden">
        {loading ? (
          <p className="text-xs text-text-tertiary text-center py-6">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-text-tertiary text-center py-6">Nothing yet — add the first one above.</p>
        ) : (
          <div className="divide-y divide-border">
            {rows.map((row, i) => (
              <div key={row.id} className={`p-5 grid sm:grid-cols-2 gap-3 relative ${numbered ? 'pl-11' : ''}`}>
                {numbered && (
                  <span className="absolute left-5 top-5 w-6 h-6 rounded-full bg-amber-50 text-amber-700 text-[11px] font-bold flex items-center justify-center ring-1 ring-amber-100">
                    {i + 1}
                  </span>
                )}
                {fields.map(f => (
                  <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
                    <label className="text-[11px] font-semibold text-text-tertiary uppercase tracking-wide">{f.label}</label>
                    <input defaultValue={row[f.key] || ''} placeholder={f.placeholder}
                      onBlur={e => { if (e.target.value !== (row[f.key] || '')) saveRow(row, { [f.key]: e.target.value }) }}
                      className="w-full text-sm text-text bg-transparent focus:outline-none border-b border-border focus:border-amber-400 py-1" />
                  </div>
                ))}
                <div className="sm:col-span-2 flex justify-end">
                  <button onClick={() => removeRow(row.id)} className="text-[11px] text-red-500 hover:text-red-600 font-medium">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      )}
    </section>
  )
}

export function BrandBrain() {
  const { state, dispatch } = useApp()
  const { activeWorkspaceId, accessToken } = useAuth()
  const isConfigured = !!activeWorkspaceId

  const [profile,  setProfile]  = useState(() => state.brandProfile || { ...DEFAULT_BRAND_PROFILE })
  // Starts true when there is something to fetch, so the spinner no longer
  // has to be switched on from inside the effect.
  const [loading,  setLoading]  = useState(() => isConfigured && !state.brandProfile)
  const [saving,   setSaving]   = useState(false)
  const [dirty,    setDirty]    = useState(false)  // are there unsaved field edits?
  const [error,    setError]    = useState('')
  // A once-guard, so a ref: it never changes what's on screen, and as state
  // it forced a second render on every load.
  const loadedRef = useRef(false)
  const [showPreview, setShowPreview] = useState(false)
  const [activeSection, setActiveSection] = useState(GROUP_ORDER[0])

  useEffect(() => {
    if (!isConfigured || loadedRef.current) return
    // Already have it in the store (e.g. loaded by the sync hook on another
    // page)? The form initialised from it — skip the refetch so an in-flight
    // fetch can't clobber edits the user starts typing right away.
    if (state.brandProfile) { loadedRef.current = true; return }
    let alive = true
    fetchBrandProfile(activeWorkspaceId, accessToken).then(p => {
      // The guard is set on SUCCESS, not before the request. StrictMode
      // double-invokes effects on mount: setting it up front made the second
      // run bail out, and since the first run's cleanup had already flipped
      // `alive` to false, nothing was left to clear the loading flag — the
      // page sat on "Loading your brand profile…" forever.
      if (!alive) return
      loadedRef.current = true
      setLoading(false)
      if (p) { setProfile(p); dispatch(actions.setBrandProfile(p)) }
    })
    return () => { alive = false }
  }, [isConfigured, state.brandProfile, activeWorkspaceId, accessToken, dispatch])

  // Scroll-spy: highlight the section nearest the top of the viewport so the
  // sidebar always reflects where you are in the page.
  useEffect(() => {
    if (loading) return
    const byId = new Map(ALL_SECTIONS.map(s => [slug(s), s]))
    const els = ALL_SECTIONS.map(s => document.getElementById(slug(s))).filter(Boolean)
    if (!els.length) return
    const obs = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting)
      if (!visible.length) return
      const top = visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      const name = byId.get(top.target.id)
      if (name) setActiveSection(name)
    }, { rootMargin: '-12% 0px -78% 0px' })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [loading])

  const set = (k, v) => { setDirty(true); setProfile(p => ({ ...p, [k]: v })) }

  async function handleSave() {
    setSaving(true); setError('')
    const result = await saveBrandProfile(activeWorkspaceId, accessToken, profile)
    setSaving(false)
    if (result.error) { setError(result.error); return }
    if (result.profile) {
      setProfile(result.profile)                       // refresh local form (incl. updatedAt)
      dispatch(actions.setBrandProfile(result.profile)) // keep the store in sync
    }
    setDirty(false)  // everything on screen is now persisted
    dispatch(actions.addNotification({ id: uid(), message: 'Brand Brain profile saved.', createdAt: new Date().toISOString() }))
  }

  const previewText = buildInstructionsString(profile, '')

  const totalFields  = FIELDS.length
  const filledFields = FIELDS.filter(f => profile[f.key] && String(profile[f.key]).trim()).length
  const pct = Math.round((filledFields / totalFields) * 100)

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
            <h1 className="font-display text-3xl font-bold text-stone-900 mb-2.5 leading-tight">One brand voice, every platform.</h1>
            <p className="text-sm text-text-secondary leading-relaxed">
              This is the single source of truth every AI generation reads — captions, imagery, emails,
              and WhatsApp. Fill it in once; each platform layers its own notes on top, never replacing it.
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
              <p className="text-[11px] text-text-tertiary">core fields<br/>trained</p>
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

      {!loading && (
        <div className="grid lg:grid-cols-[232px_minmax(0,1fr)] gap-6 lg:gap-8 items-start">

          {/* ── Sidebar nav (desktop) ── */}
          <aside className="hidden lg:block lg:sticky lg:top-4 space-y-3">
            <div className="rounded-2xl border border-border bg-white p-4 shadow-card">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-text-secondary uppercase tracking-wide">Completion</span>
                <span className="text-[11px] font-bold text-amber-700">{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
                <div className="h-full rounded-full btn-amber transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-[11px] text-text-tertiary mt-2">{filledFields} of {totalFields} core fields filled</p>
            </div>
            <nav className="rounded-2xl border border-border bg-white p-2 shadow-card">
              {ALL_SECTIONS.map(s => {
                const active = activeSection === s
                return (
                  <button key={s} onClick={() => scrollToSection(s)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-[13px] font-medium transition-colors ${active ? 'bg-amber-50 text-amber-800' : 'text-text-secondary hover:bg-stone-50 hover:text-text'}`}>
                    <SectionIcon title={s} className={`w-4 h-4 flex-shrink-0 ${active ? 'text-amber-600' : 'text-text-tertiary'}`} />
                    <span className="truncate">{s}</span>
                  </button>
                )
              })}
            </nav>
          </aside>

          {/* ── Main content ── */}
          <div className="space-y-8 min-w-0">

            {/* Mobile section chips */}
            <div className="lg:hidden -mx-1 px-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin pb-1">
              {ALL_SECTIONS.map(s => (
                <button key={s} onClick={() => scrollToSection(s)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-semibold bg-white border border-border text-text-secondary hover:border-amber-300 hover:text-amber-700 transition-colors">
                  {s}
                </button>
              ))}
            </div>

            {GROUP_ORDER.map(group => (
              <FieldGroup key={group} group={group} fields={FIELDS.filter(f => f.group === group)} profile={profile} set={set} />
            ))}

            <AssetLibrary />

            <DirectoryEditor
              title="Products"
              api={productsApi}
              fields={PRODUCT_FIELDS}
              emptyRow={{ name: '', category: '', supplier: '', price_range: '', description: '', specs: '' }}
            />

            <DirectoryEditor
              title="Message Templates"
              api={templatesApi}
              fields={TEMPLATE_FIELDS}
              emptyRow={{ name: '', channel: 'whatsapp', category: '', subject: '', body: '', status: 'draft' }}
            />

            <DirectoryEditor
              title="Suppliers"
              api={suppliersApi}
              fields={SUPPLIER_FIELDS}
              emptyRow={{ name: '', category: '', brand_lines: '', notes: '' }}
              numbered
            />

            <DirectoryEditor
              title="Competitor Watch"
              api={competitorsApi}
              fields={COMPETITOR_FIELDS}
              emptyRow={{ name: '', positioning: '', strengths: '', how_we_differ: '', watch_url: '' }}
              numbered
            />

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

            <div className="h-2" />
          </div>
        </div>
      )}

      {!loading && (
        <div className="sticky bottom-0 -mx-1 px-1 pb-1">
          <div className="flex items-center gap-3 bg-white/95 backdrop-blur-sm border border-border rounded-2xl shadow-dropdown px-5 py-3.5">
            <Button onClick={handleSave} disabled={!isConfigured || saving || (!dirty && !!profile.updatedAt)}
              variant={dirty || !profile.updatedAt ? 'primary' : 'secondary'}>
              {saving ? 'Saving…' : dirty ? 'Save Brand Brain' : profile.updatedAt ? '✓ Saved' : 'Save Brand Brain'}
            </Button>
            {/* Caption language — which language(s) generated captions are written in. */}
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              <span className="font-medium whitespace-nowrap">Caption language</span>
              <select
                value={profile.captionLanguage || 'both'}
                onChange={e => set('captionLanguage', e.target.value)}
                className="rounded-lg border border-border bg-white text-text text-xs px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400">
                <option value="both">Arabic + English</option>
                <option value="ar">Arabic only (Saudi)</option>
                <option value="en">English only</option>
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
    </div>
  )
}
