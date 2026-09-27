import { useMemo, useState } from 'react'
import { Card, Button, Input, Textarea, Modal, ConfirmDialog, Empty, Skeleton } from '../../components/ui/index'
import { AUDIENCES, blockReason } from '../../lib/email/contacts'
import { saveGroup, deleteGroup } from '../../lib/email/client'
import { AudienceTag, Notice, EIcon } from './parts'
import { GROUP_COLORS } from './format'

// ─── Groups ────────────────────────────────────────────────────────────────
// A group is a named list inside one lane. Marketing campaigns may only pick
// marketing groups and cold campaigns only cold groups; the server re-checks
// both the group's lane and each contact's.

export function Groups({ workspaceId, data, loading, reload, setTab }) {
  const [editing, setEditing] = useState(null)     // group | 'new-marketing' | 'new-cold'
  const [deleting, setDeleting] = useState(null)
  const [error, setError] = useState('')

  const stats = useMemo(() => {
    const byId = new Map(data.contacts.map(c => [c.id, c]))
    const out = new Map()
    for (const g of data.groups) out.set(g.id, { total: 0, reachable: 0 })
    for (const m of data.members) {
      const s = out.get(m.group_id)
      if (!s) continue
      s.total++
      const g = data.groups.find(x => x.id === m.group_id)
      if (!blockReason(byId.get(m.contact_id), g.audience)) s.reachable++
    }
    return out
  }, [data.contacts, data.groups, data.members])

  async function remove(g) {
    setError('')
    try { await deleteGroup(workspaceId, g.id); await reload() } catch (err) { setError(err.message) }
  }

  const lanes = ['marketing', 'cold']

  return (
    <div className="space-y-4">
      {error && <Notice tone="red">{error}</Notice>}
      {lanes.map(lane => {
        const groups = data.groups.filter(g => g.audience === lane)
        return (
          <Card key={lane}>
            <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
              <div className="min-w-0">
                <h3 className="font-semibold text-text text-sm flex items-center gap-2">{AUDIENCES[lane].label} groups <AudienceTag audience={lane} /></h3>
                <p className="text-xs text-text-tertiary mt-1">{AUDIENCES[lane].hint}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing(`new-${lane}`)} disabled={loading}><EIcon name="plus" /> New group</Button>
            </div>
            {loading ? (
              <div className="p-5 space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>
            ) : groups.length === 0 ? (
              <Empty icon={<EIcon name="folder" />} title={`No ${lane} groups yet`}
                description={lane === 'marketing'
                  ? 'For example: Customers, Consultants, Contractors, Riyadh partners, Arabic-speaking contacts.'
                  : 'For example: Hotel projects Riyadh, MEP contractors, Tender contacts. One group per outreach campaign works well.'}
                action={<Button size="sm" onClick={() => setEditing(`new-${lane}`)}>Create one</Button>} />
            ) : (
              <ul className="divide-y divide-border">
                {groups.map(g => {
                  const s = stats.get(g.id) || { total: 0, reachable: 0 }
                  return (
                    <li key={g.id} className="px-5 py-3 flex items-center gap-4">
                      <span className={`w-2 h-8 flex-shrink-0 ${GROUP_COLORS[g.color] || GROUP_COLORS.steel}`} />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-text text-sm truncate">{g.name}</p>
                        {g.description && <p className="text-xs text-text-tertiary truncate">{g.description}</p>}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-semibold text-text tabular-nums">{s.total.toLocaleString()}</p>
                        <p className="text-[10px] text-text-tertiary">{s.reachable.toLocaleString()} can be emailed</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button size="xs" variant="ghost" onClick={() => setTab('contacts', { group: g.id })}>View</Button>
                        <Button size="xs" variant="ghost" onClick={() => setEditing(g)}>Edit</Button>
                        <Button size="xs" variant="ghost" onClick={() => setDeleting(g)} aria-label={`Delete ${g.name}`}><EIcon name="trash" /></Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>
        )
      })}

      <p className="text-[11px] text-text-tertiary">
        To add people to a group: tick them in Contacts and choose “Add to group”, or pick a group when importing a CSV.
      </p>

      {editing && (
        <GroupModal
          workspaceId={workspaceId}
          group={typeof editing === 'string' ? null : editing}
          audience={typeof editing === 'string' ? editing.replace('new-', '') : editing.audience}
          memberCount={typeof editing === 'string' ? 0 : (stats.get(editing.id)?.total || 0)}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload() }}
        />
      )}

      <ConfirmDialog
        open={!!deleting} onClose={() => setDeleting(null)} danger
        title={`Delete “${deleting?.name}”?`}
        message="The group is removed. The contacts in it are not deleted. Campaigns already sent keep their numbers."
        onConfirm={() => remove(deleting)}
      />
    </div>
  )
}

function GroupModal({ workspaceId, group, audience, memberCount, onClose, onSaved }) {
  const [form, setForm] = useState({ name: group?.name || '', description: group?.description || '', color: group?.color || 'steel', audience })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!form.name.trim()) { setError('Give the group a name.'); return }
    setSaving(true); setError('')
    try { await saveGroup(workspaceId, form, group?.id || null); await onSaved() }
    catch (err) { setError(err.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onClose={onClose} title={group ? 'Edit group' : `New ${AUDIENCES[audience].label.toLowerCase()} group`}>
      <div className="p-5 space-y-4">
        <Input label="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus />
        <Textarea label="Description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          hint="Who is in it and why. Shown when choosing groups for a campaign." />
        <div>
          <p className="eyebrow mb-1.5">Colour</p>
          <div className="flex gap-2">
            {Object.entries(GROUP_COLORS).map(([k, cls]) => (
              <button key={k} type="button" aria-label={k} onClick={() => setForm(f => ({ ...f, color: k }))}
                className={`w-7 h-7 ${cls} ${form.color === k ? 'ring-2 ring-offset-2 ring-amber-700' : ''}`} />
            ))}
          </div>
        </div>
        {group && memberCount > 0 && (
          <p className="text-[11px] text-text-tertiary">This group is in the {AUDIENCES[group.audience].label} lane. To move people between lanes, change the contacts themselves.</p>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : group ? 'Save' : 'Create group'}</Button>
        </div>
      </div>
    </Modal>
  )
}
