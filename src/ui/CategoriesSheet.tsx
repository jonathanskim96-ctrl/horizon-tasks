import { useState } from 'react'
import { PALETTE, safeColor } from '../domain/categories'
import type { Category, Snapshot } from '../domain/types'
import type { Store } from '../data/useStore'
import { ErrorBanner, Sheet } from './Sheet'

interface Props {
  data: Snapshot
  store: Store
  onClose: () => void
  onToast: (msg: string) => void
}

/** Rename, recolor, add and delete categories. History keeps the old names. */
export function CategoriesSheet({ data, store, onClose, onToast }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const used = (id: string) => data.tasks.filter((t) => t.categoryId === id).length

  const add = async () => {
    setError(null)
    try {
      const c = await store.addCategory(newName, data.categories)
      setNewName('')
      onToast(`Added “${c.name}”.`)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Sheet title="Categories" onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      <div className="task-list">
        {data.categories.map((c) =>
          editing === c.id ? (
            <EditRow key={c.id} cat={c} data={data} store={store} onDone={(msg) => { setEditing(null); onToast(msg) }} onCancel={() => setEditing(null)} />
          ) : deleting === c.id ? (
            <DeleteRow key={c.id} cat={c} data={data} store={store} onDone={(msg) => { setDeleting(null); onToast(msg) }} onCancel={() => setDeleting(null)} />
          ) : (
            <div className="cat-row" key={c.id}>
              <span className="cat-dot big" style={{ background: safeColor(c.color) }} />
              <span className="cat-name">{c.name}</span>
              <span className="muted small">{used(c.id)} task{used(c.id) === 1 ? '' : 's'}</span>
              <button className="btn small" onClick={() => { setDeleting(null); setEditing(c.id) }} aria-label={`Edit category ${c.name}`}>
                Edit
              </button>
              <button className="btn small danger-outline" onClick={() => { setEditing(null); setDeleting(c.id) }} aria-label={`Delete category ${c.name}`}>
                Delete
              </button>
            </div>
          ),
        )}
      </div>
      <div className="inline-add">
        <input type="text" placeholder="New category" aria-label="New category name" value={newName} maxLength={60} onChange={(e) => setNewName(e.target.value)} />
        <button className="btn small primary" onClick={() => void add()} disabled={!newName.trim()}>
          Add
        </button>
      </div>
      <p className="muted small">Completed tasks in History keep the category name they had at the time.</p>
    </Sheet>
  )
}

function EditRow({ cat, data, store, onDone, onCancel }: { cat: Category; data: Snapshot; store: Store; onDone: (m: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(cat.name)
  const [color, setColor] = useState(cat.color)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const swatches = [...new Set([safeColor(cat.color), ...PALETTE, '#8b929c'])]
  const save = async () => {
    setError(null)
    setSaving(true)
    try {
      await store.editCategory(cat.id, name, color, data.categories)
      onDone('Category saved.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="cat-edit">
      {error && <div className="field-error">{error}</div>}
      <input type="text" aria-label="Category name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      <div className="swatches" role="radiogroup" aria-label="Color">
        {swatches.map((s) => (
          <button key={s} role="radio" aria-checked={color === s} aria-label={`Color ${s}`} className={`swatch${color === s ? ' on' : ''}`} style={{ background: safeColor(s) }} onClick={() => setColor(s)} />
        ))}
      </div>
      <div className="btn-row">
        <button className="btn" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function DeleteRow({ cat, data, store, onDone, onCancel }: { cat: Category; data: Snapshot; store: Store; onDone: (m: string) => void; onCancel: () => void }) {
  const count = data.tasks.filter((t) => t.categoryId === cat.id).length
  const others = data.categories.filter((c) => c.id !== cat.id)
  const [moveTo, setMoveTo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const go = async () => {
    setError(null)
    if (count && !moveTo) return setError('Choose where its tasks should go.')
    setWorking(true)
    try {
      await store.removeCategory(cat.id, data, count ? moveTo : undefined)
      onDone(count ? `Moved ${count} task(s) and deleted “${cat.name}”.` : `Deleted “${cat.name}”.`)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWorking(false)
    }
  }
  return (
    <div className="cat-edit danger-zone">
      {error && <div className="field-error">{error}</div>}
      <p>
        Delete “{cat.name}”?{' '}
        {count ? `Its ${count} active task(s) will move to the category you pick.` : 'No active tasks use it.'} History is not changed.
      </p>
      {count > 0 && (
        <select aria-label="Move tasks to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
          <option value="">Move tasks to…</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <div className="btn-row">
        <button className="btn" onClick={onCancel} disabled={working}>
          Cancel
        </button>
        <button className="btn danger" onClick={() => void go()} disabled={working || others.length === 0}>
          {working ? 'Working…' : count ? 'Move & delete' : 'Delete'}
        </button>
      </div>
    </div>
  )
}
