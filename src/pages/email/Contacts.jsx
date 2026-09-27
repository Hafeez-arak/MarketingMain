import { useMemo, useState } from 'react'
import { Card, Button, Input, Select, Textarea, Modal, ConfirmDialog, Empty, Skeleton, Toggle } from '../../components/ui/index'
import {
  AUDIENCES, CONTACT_TYPES, CONSENT, STATUSES, SOURCES, LANGUAGES,
  cleanContact, displayName, isValidEmail,
} from '../../lib/email/contacts'
import { parseCsv, rowsToContacts, contactsToCsv } from '../../lib/email/csv'
import {
  saveContact, deleteContacts, updateContacts, importContacts, addToGroup, removeFromGroup, setContactGroups, saveGroup,
} from '../../lib/email/client'
import { AudienceTag, ContactStatus, GroupChip, Notice, EIcon } from './parts'
import { download, shortDate } from './format'

const PAGE = 100

export function Contacts({ workspaceId, data, loading, reload, params, setTab }) {
  const [q, setQRaw] = useState('')
  const [audience, setAudienceRaw] = useState('')
  const [status, setStatusRaw] = useState('')
  const [type, setTypeRaw] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [picked, setSelected] = useState(new Set())
  // The group filter lives in the URL, so "View" on a group and the import's
  // "View the group" land here already filtered, and Back undoes it.
  const group = params.get('group') || ''
  // Any filter change starts the list from the top again.
  const filterSetter = set => v => { set(v); setShown(PAGE) }
  const setQ = filterSetter(setQRaw)
  const setAudience = filterSetter(setAudienceRaw)
  const setStatus = filterSetter(setStatusRaw)
  const setType = filterSetter(setTypeRaw)
  const setGroup = v => { setTab('contacts', { group: v }); setShown(PAGE) }
  const [editing, setEditing] = useState(null)      // contact | 'new' | null
  const [importing, setImporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const groupsById = useMemo(() => new Map(data.groups.map(g => [g.id, g])), [data.groups])
  const groupsOf = useMemo(() => {
    const m = new Map()
    for (const x of data.members) {
      if (!m.has(x.contact_id)) m.set(x.contact_id, [])
      m.get(x.contact_id).push(x.group_id)
    }
    return m
  }, [data.members])
  const existingEmails = useMemo(() => new Set(data.contacts.map(c => c.email)), [data.contacts])
  const types = useMemo(() => [...new Set([...CONTACT_TYPES, ...data.contacts.map(c => c.contact_type).filter(Boolean)])], [data.contacts])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return data.contacts.filter(c => {
      if (audience && c.audience !== audience) return false
      if (status && c.status !== status) return false
      if (type && c.contact_type !== type) return false
      if (group === '__none' && (groupsOf.get(c.id) || []).length) return false
      if (group && group !== '__none' && !(groupsOf.get(c.id) || []).includes(group)) return false
      if (!needle) return true
      return [c.email, c.first_name, c.last_name, c.company, c.job_title, c.city, c.notes]
        .some(v => String(v || '').toLowerCase().includes(needle))
    })
  }, [data.contacts, q, audience, status, type, group, groupsOf])

  // The selection that counts is only the ticked rows that are still visible,
  // so a bulk delete never reaches a contact the person cannot see (filtered
  // out, or deleted in another tab).
  const selected = useMemo(() => {
    const visibleIds = new Set(filtered.map(c => c.id))
    return new Set([...picked].filter(id => visibleIds.has(id)))
  }, [picked, filtered])

  const visible = filtered.slice(0, shown)
  const allSelected = filtered.length > 0 && filtered.every(c => selected.has(c.id))
  const toggle = id => setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  async function run(label, fn) {
    setBusy(label); setError('')
    try { await fn(); await reload() } catch (err) { setError(err.message || String(err)) } finally { setBusy('') }
  }

  const ids = [...selected]
  const selectedContacts = data.contacts.filter(c => selected.has(c.id))
  const mixedLanes = new Set(selectedContacts.map(c => c.audience)).size > 1

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Input className="flex-1 min-w-[200px]" placeholder="Search name, email, company, city…" value={q} onChange={e => setQ(e.target.value)} />
          <Select value={audience} onChange={e => setAudience(e.target.value)} className="w-36">
            <option value="">All lanes</option>
            <option value="marketing">Marketing</option>
            <option value="cold">Cold</option>
          </Select>
          <Select value={group} onChange={e => setGroup(e.target.value)} className="w-44">
            <option value="">All groups</option>
            <option value="__none">In no group</option>
            {data.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
          <Select value={type} onChange={e => setType(e.target.value)} className="w-40">
            <option value="">All types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Select value={status} onChange={e => setStatus(e.target.value)} className="w-36">
            <option value="">Any status</option>
            {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <p className="text-xs text-text-tertiary">
            {loading ? 'Loading…' : `${filtered.length.toLocaleString()} of ${data.contacts.length.toLocaleString()} contacts`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={!filtered.length}
              onClick={() => download(`contacts-${new Date().toISOString().slice(0, 10)}.csv`,
                contactsToCsv(filtered, c => (groupsOf.get(c.id) || []).map(id => groupsById.get(id)?.name).filter(Boolean)))}>
              Export CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setImporting(true)} disabled={loading}>Import CSV</Button>
            <Button size="sm" onClick={() => setEditing('new')} disabled={loading}><EIcon name="plus" /> Add contact</Button>
          </div>
        </div>
      </Card>

      {error && <Notice tone="red" title="That did not work">{error}</Notice>}

      {selected.size > 0 && (
        <BulkBar
          count={selected.size} groups={data.groups} busy={busy} mixedLanes={mixedLanes}
          onClear={() => setSelected(new Set())}
          onAddGroup={g => run('group', () => addToGroup(workspaceId, g, ids))}
          onRemoveGroup={g => run('group', () => removeFromGroup(workspaceId, g, ids))}
          onSet={patch => run('update', () => updateContacts(workspaceId, ids, patch))}
          onDelete={() => setConfirmDelete(true)}
        />
      )}

      <Card>
        {loading ? (
          <div className="p-4 space-y-2">{[0, 1, 2, 3, 4].map(i => <Skeleton key={i} className="h-9 w-full" />)}</div>
        ) : data.contacts.length === 0 ? (
          <Empty icon={<EIcon name="users" />} title="No contacts yet"
            description="Start with the people who already know you: export your customers and business contacts from Outlook or your accounting system, and import the CSV."
            action={<div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => setEditing('new')}>Add one</Button><Button size="sm" onClick={() => setImporting(true)}>Import CSV</Button></div>} />
        ) : filtered.length === 0 ? (
          <p className="px-5 py-8 text-sm text-text-tertiary text-center">No contacts match these filters.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-text-tertiary border-b border-border">
                  <th className="w-10 px-3 py-2">
                    <input type="checkbox" aria-label="Select all" checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(filtered.map(c => c.id)))} />
                  </th>
                  <th className="text-left font-semibold px-2 py-2">Contact</th>
                  <th className="text-left font-semibold px-2 py-2">Company</th>
                  <th className="text-left font-semibold px-2 py-2">Type</th>
                  <th className="text-left font-semibold px-2 py-2">Lane</th>
                  <th className="text-left font-semibold px-2 py-2">Groups</th>
                  <th className="text-left font-semibold px-2 py-2">Status</th>
                  <th className="text-left font-semibold px-3 py-2">Last emailed</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(c => (
                  <tr key={c.id} className={`border-b border-border last:border-0 hover:bg-surface-subtle ${selected.has(c.id) ? 'bg-amber-50' : ''}`}>
                    <td className="px-3 py-2 align-top"><input type="checkbox" aria-label={`Select ${c.email}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} /></td>
                    <td className="px-2 py-2 align-top cursor-pointer" onClick={() => setEditing(c)}>
                      <p className="font-medium text-text truncate max-w-[240px]">{displayName(c)}</p>
                      <p className="text-[11px] text-text-tertiary truncate max-w-[240px]">
                        {c.email}{c.language === 'ar' && <span className="ml-1.5 text-text-secondary">· AR</span>}
                      </p>
                    </td>
                    <td className="px-2 py-2 align-top cursor-pointer" onClick={() => setEditing(c)}>
                      <p className="text-text-secondary truncate max-w-[200px]">{c.company || '—'}</p>
                      {c.job_title && <p className="text-[11px] text-text-tertiary truncate max-w-[200px]">{c.job_title}</p>}
                    </td>
                    <td className="px-2 py-2 align-top text-xs text-text-secondary">{c.contact_type || '—'}</td>
                    <td className="px-2 py-2 align-top"><AudienceTag audience={c.audience} /></td>
                    <td className="px-2 py-2 align-top">
                      <div className="flex flex-wrap gap-1 max-w-[220px]">
                        {(groupsOf.get(c.id) || []).map(id => <GroupChip key={id} group={groupsById.get(id)} />)}
                      </div>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <ContactStatus status={c.status} />
                      {c.replied_at && <span className="block text-[10px] text-sage-700 mt-0.5">Replied</span>}
                    </td>
                    <td className="px-3 py-2 align-top text-xs text-text-tertiary whitespace-nowrap">{shortDate(c.last_sent_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length > shown && (
              <div className="px-5 py-3 border-t border-border text-center">
                <Button size="sm" variant="secondary" onClick={() => setShown(s => s + PAGE * 5)}>
                  Show more ({(filtered.length - shown).toLocaleString()} left)
                </Button>
              </div>
            )}
          </div>
        )}
      </Card>

      {editing && (
        <ContactModal
          workspaceId={workspaceId}
          contact={editing === 'new' ? null : editing}
          groups={data.groups}
          currentGroups={editing === 'new' ? [] : (groupsOf.get(editing.id) || [])}
          types={types}
          existingEmails={data.contacts}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }}
        />
      )}

      {importing && (
        <ImportModal
          workspaceId={workspaceId} groups={data.groups} types={types}
          existing={existingEmails}
          onClose={() => setImporting(false)}
          onDone={async () => { await reload() }}
          onViewGroup={id => { setImporting(false); setTab('contacts', { group: id }) }}
        />
      )}

      <ConfirmDialog
        open={confirmDelete} onClose={() => setConfirmDelete(false)} danger
        title={`Delete ${selected.size} contact${selected.size === 1 ? '' : 's'}?`}
        message="They are removed from every group and every queued email. Their sending history is kept in campaign numbers. This cannot be undone. To stop emailing someone but keep the record, set them to Unsubscribed instead."
        onConfirm={() => run('delete', async () => { await deleteContacts(workspaceId, ids); setSelected(new Set()) })}
      />
    </div>
  )
}

function BulkBar({ count, groups, busy, mixedLanes, onClear, onAddGroup, onRemoveGroup, onSet, onDelete }) {
  const [action, setAction] = useState('')
  function apply(value) {
    if (!value) return
    const [kind, arg] = value.split(':')
    setAction('')
    if (kind === 'add') onAddGroup(arg)
    else if (kind === 'remove') onRemoveGroup(arg)
    else if (kind === 'audience') onSet(arg === 'cold' ? { audience: 'cold', consent: 'none' } : { audience: 'marketing', consent: 'business_contact' })
    else if (kind === 'lang') onSet({ language: arg })
    else if (kind === 'status') onSet(arg === 'unsubscribed' ? { status: 'unsubscribed', unsubscribed_at: new Date().toISOString() } : { status: arg })
    else if (kind === 'type') onSet({ contact_type: arg })
  }
  return (
    <div className="sticky top-0 z-20 bg-amber-700 text-white px-4 py-2 flex flex-wrap items-center gap-3">
      <span className="text-sm font-semibold">{count} selected</span>
      <select value={action} onChange={e => apply(e.target.value)} disabled={!!busy}
        className="bg-white text-text text-xs px-2 py-1.5 border border-white min-w-[200px]">
        <option value="">Choose an action…</option>
        <optgroup label="Add to group">{groups.map(g => <option key={g.id} value={`add:${g.id}`}>{g.name} ({g.audience})</option>)}</optgroup>
        <optgroup label="Remove from group">{groups.map(g => <option key={g.id} value={`remove:${g.id}`}>{g.name}</option>)}</optgroup>
        <optgroup label="Lane">
          <option value="audience:marketing">Move to Marketing (they know us)</option>
          <option value="audience:cold">Move to Cold (prospects)</option>
        </optgroup>
        <optgroup label="Language">
          <option value="lang:en">English</option>
          <option value="lang:ar">Arabic</option>
        </optgroup>
        <optgroup label="Type">{CONTACT_TYPES.map(t => <option key={t} value={`type:${t}`}>{t}</option>)}</optgroup>
        <optgroup label="Status">
          <option value="status:unsubscribed">Mark unsubscribed</option>
          <option value="status:active">Mark active again</option>
        </optgroup>
      </select>
      {mixedLanes && <span className="text-[11px] text-white/80">Selection mixes Marketing and Cold contacts.</span>}
      {busy && <span className="text-xs text-white/80">Working…</span>}
      <div className="flex-1" />
      <button onClick={onDelete} className="text-xs font-semibold underline underline-offset-2">Delete</button>
      <button onClick={onClear} className="text-xs text-white/80 hover:text-white">Clear</button>
    </div>
  )
}

function ContactModal({ workspaceId, contact, groups, currentGroups, types, existingEmails, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    email: '', first_name: '', last_name: '', company: '', job_title: '', phone: '', city: '', country: 'Saudi Arabia',
    contact_type: '', audience: 'marketing', language: 'en', consent: 'business_contact', notes: '', source: 'manual',
    status: 'active',
    ...(contact || {}),
  }))
  const [groupIds, setGroupIds] = useState(currentGroups)
  const [replied, setReplied] = useState(Boolean(contact?.replied_at))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const emailTaken = !contact && existingEmails.some(c => c.email === String(form.email).trim().toLowerCase())
  const laneGroups = groups.filter(g => g.audience === form.audience)
  const otherLaneGroups = groups.filter(g => g.audience !== form.audience && groupIds.includes(g.id))

  async function save() {
    setError('')
    if (!isValidEmail(form.email)) { setError('Enter a valid email address.'); return }
    if (emailTaken) { setError('That address is already in your contacts.'); return }
    setSaving(true)
    try {
      const row = cleanContact(form, { source: contact?.source || 'manual' })
      if (contact) {
        const statusPatch = form.status !== contact.status
          ? { status: form.status, ...(form.status === 'unsubscribed' ? { unsubscribed_at: new Date().toISOString() } : {}) }
          : {}
        const repliedPatch = form.audience === 'cold'
          ? { replied_at: replied ? (contact.replied_at || new Date().toISOString()) : null }
          : {}
        delete row.source
        await saveContact(workspaceId, { ...row, ...statusPatch, ...repliedPatch }, contact.id)
        await setContactGroups(workspaceId, contact.id, groupIds, currentGroups)
      } else {
        const created = await saveContact(workspaceId, row)
        await setContactGroups(workspaceId, created.id, groupIds, [])
      }
      await onSaved()
    } catch (err) {
      setError(/duplicate|unique/i.test(err.message) ? 'That address is already in your contacts.' : err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={contact ? `Edit ${displayName(contact)}` : 'Add contact'} width="max-w-2xl">
      <div className="p-5 space-y-4">
        <div className="grid sm:grid-cols-2 gap-3">
          <Input label="Email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="name@company.com"
            error={emailTaken ? 'Already in your contacts' : ''} autoFocus={!contact} />
          <Select label="Type" value={form.contact_type} onChange={e => set('contact_type', e.target.value)}>
            <option value="">—</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </Select>
          <Input label="First name" value={form.first_name} onChange={e => set('first_name', e.target.value)} />
          <Input label="Last name" value={form.last_name} onChange={e => set('last_name', e.target.value)} />
          <Input label="Company" value={form.company} onChange={e => set('company', e.target.value)} />
          <Input label="Job title" value={form.job_title} onChange={e => set('job_title', e.target.value)} />
          <Input label="Phone" value={form.phone} onChange={e => set('phone', e.target.value)} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" value={form.city} onChange={e => set('city', e.target.value)} />
            <Input label="Country" value={form.country} onChange={e => set('country', e.target.value)} />
          </div>
        </div>

        <div>
          <p className="eyebrow mb-1.5">Lane</p>
          <div className="grid sm:grid-cols-2 gap-2">
            {Object.entries(AUDIENCES).map(([k, a]) => (
              <label key={k} className={`border px-3 py-2 cursor-pointer ${form.audience === k ? 'border-amber-700 bg-amber-50' : 'border-border hover:border-stone-400'}`}>
                <span className="flex items-center gap-2 text-sm font-semibold text-text">
                  <input type="radio" name="audience" checked={form.audience === k}
                    onChange={() => setForm(f => ({ ...f, audience: k, consent: k === 'cold' ? 'none' : (f.consent === 'none' ? 'business_contact' : f.consent) }))} />
                  {a.label}
                </span>
                <span className="block text-[11px] text-text-tertiary mt-0.5 leading-relaxed">{a.hint}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid sm:grid-cols-3 gap-3">
          <Select label="Language" value={form.language} onChange={e => set('language', e.target.value)}>
            {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          <Select label="Why we may email them" value={form.consent} onChange={e => set('consent', e.target.value)} disabled={form.audience === 'cold'}
            hint={CONSENT[form.consent]?.hint}>
            {Object.entries(CONSENT).filter(([k]) => form.audience === 'cold' ? k === 'none' : k !== 'none')
              .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
          {contact ? (
            <Select label="Status" value={form.status} onChange={e => set('status', e.target.value)}
              hint={['bounced', 'complained'].includes(contact.status) ? 'Set by the mail system. Re-activating risks another bounce or complaint.' : ''}>
              {Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </Select>
          ) : <div />}
        </div>

        <div>
          <p className="eyebrow mb-1.5">Groups</p>
          {laneGroups.length === 0 ? (
            <p className="text-xs text-text-tertiary">No {form.audience === 'cold' ? 'cold' : 'marketing'} groups yet. Create one in the Groups tab.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {laneGroups.map(g => (
                <label key={g.id} className={`flex items-center gap-1.5 text-xs border px-2 py-1 cursor-pointer ${groupIds.includes(g.id) ? 'border-amber-700 bg-amber-50 text-text' : 'border-border text-text-secondary'}`}>
                  <input type="checkbox" checked={groupIds.includes(g.id)}
                    onChange={() => setGroupIds(ids => ids.includes(g.id) ? ids.filter(x => x !== g.id) : [...ids, g.id])} />
                  {g.name}
                </label>
              ))}
            </div>
          )}
          {otherLaneGroups.length > 0 && (
            <p className="text-[11px] text-amber-800 mt-1.5">
              Still in {otherLaneGroups.map(g => g.name).join(', ')} from the other lane. Campaigns there will skip this contact.
              <button className="underline ml-1" onClick={() => setGroupIds(ids => ids.filter(id => !otherLaneGroups.some(g => g.id === id)))}>Remove</button>
            </p>
          )}
        </div>

        {form.audience === 'cold' && contact && (
          <Toggle checked={replied} onChange={setReplied} label="They replied (stops any follow-ups to them)" />
        )}

        <Textarea label="Notes" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)}
          hint="Private. The AI uses notes when writing a personal cold email to this contact." />

        {contact && (
          <p className="text-[11px] text-text-tertiary">
            Added {shortDate(contact.created_at)} · {SOURCES[contact.source] || contact.source}
            {contact.last_opened_at && <> · last opened {shortDate(contact.last_opened_at)}</>}
            {contact.unsubscribed_at && <> · unsubscribed {shortDate(contact.unsubscribed_at)}</>}
          </p>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : contact ? 'Save' : 'Add contact'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function ImportModal({ workspaceId, groups, types, existing, onClose, onDone, onViewGroup }) {
  const [text, setText] = useState('')
  const [fileName, setFileName] = useState('')
  const [defaults, setDefaults] = useState({ audience: 'marketing', language: 'en', consent: 'business_contact', contact_type: '' })
  const [groupChoice, setGroupChoice] = useState('')   // '' | id | '__new'
  const [newGroup, setNewGroup] = useState('')
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  const parsed = useMemo(() => text.trim() ? rowsToContacts(parseCsv(text), defaults, existing) : null, [text, defaults, existing])
  const laneGroups = groups.filter(g => g.audience === defaults.audience)
  const setD = (k, v) => setDefaults(d => ({ ...d, [k]: v }))

  async function readFile(file) {
    if (!file) return
    setFileName(file.name)
    if (/\.xlsx?$/i.test(file.name)) { setError('Save the spreadsheet as CSV first (File → Save As → CSV UTF-8), then choose that file.'); return }
    setError('')
    setText(await file.text())
  }

  async function run() {
    if (!parsed?.contacts.length) return
    setError('')
    try {
      let groupId = groupChoice && groupChoice !== '__new' ? groupChoice : ''
      if (groupChoice === '__new') {
        if (!newGroup.trim()) { setError('Name the new group.'); return }
        groupId = (await saveGroup(workspaceId, { name: newGroup, audience: defaults.audience })).id
      }
      setProgress({ done: 0, total: parsed.contacts.length })
      const inserted = await importContacts(workspaceId, parsed.contacts, (done, total) => setProgress({ done, total }))
      if (groupId && inserted.length) await addToGroup(workspaceId, groupId, inserted.map(r => r.id))
      setResult({ inserted: inserted.length, groupId })
      await onDone()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setProgress(null)
    }
  }

  return (
    <Modal open onClose={onClose} title="Import contacts" width="max-w-3xl">
      <div className="p-5 space-y-4">
        {result ? (
          <div className="space-y-3">
            <Notice tone="sage" title={`${result.inserted.toLocaleString()} contact${result.inserted === 1 ? '' : 's'} imported`}>
              {parsed?.rejected.length ? `${parsed.rejected.length} row${parsed.rejected.length === 1 ? ' was' : 's were'} left out (listed before import).` : 'Every row was imported.'}
            </Notice>
            <div className="flex justify-end gap-2">
              {result.groupId && <Button variant="secondary" onClick={() => onViewGroup(result.groupId)}>View the group</Button>}
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-xs text-text-secondary leading-relaxed space-y-1">
              <p>A CSV with an <strong>Email</strong> column. Optional columns are picked up by name: First name, Last name (or Name), Company, Job title, Phone, City, Country, Type, Language, Notes. Arabic headers work too.</p>
              <p>From Outlook: File → Open &amp; Export → Import/Export → Export to a file → CSV. From Excel: Save As → CSV UTF-8.</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold border border-border bg-white hover:bg-surface-subtle cursor-pointer">
                Choose CSV file
                <input type="file" accept=".csv,text/csv,.txt" className="hidden" onChange={e => readFile(e.target.files?.[0])} />
              </label>
              {fileName && <span className="text-xs text-text-tertiary">{fileName}</span>}
              <span className="text-xs text-text-tertiary">or paste below</span>
            </div>
            <Textarea rows={5} value={text} onChange={e => { setText(e.target.value); setFileName('') }}
              placeholder={'Email,First name,Company\nali@example.com,Ali,Example Contracting'} />

            <div className="grid sm:grid-cols-4 gap-3">
              <Select label="Lane" value={defaults.audience}
                onChange={e => { const v = e.target.value; setDefaults(d => ({ ...d, audience: v, consent: v === 'cold' ? 'none' : 'business_contact' })); setGroupChoice('') }}>
                <option value="marketing">Marketing (know us)</option>
                <option value="cold">Cold (prospects)</option>
              </Select>
              <Select label="Why we may email them" value={defaults.consent} onChange={e => setD('consent', e.target.value)} disabled={defaults.audience === 'cold'}>
                {Object.entries(CONSENT).filter(([k]) => defaults.audience === 'cold' ? k === 'none' : k !== 'none')
                  .map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </Select>
              <Select label="Language (if no column)" value={defaults.language} onChange={e => setD('language', e.target.value)}>
                <option value="en">English</option>
                <option value="ar">Arabic</option>
              </Select>
              <Select label="Type (if no column)" value={defaults.contact_type} onChange={e => setD('contact_type', e.target.value)}>
                <option value="">—</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Select label="Put them in a group" value={groupChoice} onChange={e => setGroupChoice(e.target.value)}>
                <option value="">No group</option>
                {laneGroups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                <option value="__new">New group…</option>
              </Select>
              {groupChoice === '__new' && <Input label="New group name" value={newGroup} onChange={e => setNewGroup(e.target.value)} placeholder="e.g. Customers 2025" />}
            </div>

            {defaults.audience === 'marketing' && (
              <Notice tone="amber">
                Only import people who know Arak: customers, partners, people who emailed you or gave you a card. A bought or scraped list in this lane is how a sending domain gets blocked in its first week. Prospects go in the Cold lane.
              </Notice>
            )}

            {parsed && (
              <div className="border border-border">
                <div className="px-4 py-2 bg-surface-subtle flex flex-wrap gap-x-6 gap-y-1 text-xs">
                  <span><strong className="text-text">{parsed.contacts.length.toLocaleString()}</strong> ready to import</span>
                  <span><strong className="text-text">{parsed.rejected.length.toLocaleString()}</strong> left out</span>
                  <span className="text-text-tertiary">Columns found: {parsed.columns.filter(Boolean).join(', ') || 'none'}</span>
                </div>
                {parsed.contacts.length > 0 && (
                  <div className="max-h-40 overflow-y-auto scrollbar-thin">
                    <table className="w-full text-xs">
                      <tbody>
                        {parsed.contacts.slice(0, 8).map(c => (
                          <tr key={c.email} className="border-t border-border">
                            <td className="px-4 py-1.5 text-text">{c.email}</td>
                            <td className="px-2 py-1.5 text-text-secondary">{[c.first_name, c.last_name].filter(Boolean).join(' ')}</td>
                            <td className="px-2 py-1.5 text-text-secondary">{c.company}</td>
                            <td className="px-4 py-1.5 text-text-tertiary">{c.language === 'ar' ? 'Arabic' : 'English'}</td>
                          </tr>
                        ))}
                        {parsed.contacts.length > 8 && <tr className="border-t border-border"><td colSpan={4} className="px-4 py-1.5 text-text-tertiary">…and {parsed.contacts.length - 8} more</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
                {parsed.rejected.length > 0 && (
                  <details className="border-t border-border">
                    <summary className="px-4 py-2 text-xs text-text-secondary cursor-pointer">Rows left out, and why</summary>
                    <div className="max-h-40 overflow-y-auto scrollbar-thin">
                      <table className="w-full text-xs">
                        <tbody>
                          {parsed.rejected.slice(0, 200).map((r, i) => (
                            <tr key={i} className="border-t border-border">
                              <td className="px-4 py-1 text-text-tertiary w-16">Row {r.row}</td>
                              <td className="px-2 py-1 text-text-secondary">{r.email || '—'}</td>
                              <td className="px-4 py-1 text-red-600">{r.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </div>
            )}

            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
              <Button onClick={run} disabled={!parsed?.contacts.length || !!progress}>
                {progress ? `Importing ${progress.done}/${progress.total}…` : `Import ${parsed?.contacts.length ? parsed.contacts.length.toLocaleString() : ''} contacts`}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
