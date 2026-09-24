import { useState } from 'react'
import { planCreate, planUpdate } from '../domain/actions'
import { safeColor } from '../domain/categories'
import { MAX_DEPTH, type ChecklistItem, type ISODate, type Snapshot, type Task } from '../domain/types'
import { validateTask, type FieldErrors } from '../domain/validate'
import type { Store } from '../data/useStore'
import { ErrorBanner, Sheet } from './Sheet'

interface Props {
  data: Snapshot
  store: Store
  /** Task being edited; absent for a new task. */
  editing?: Task
  /** New subtask under this parent. */
  parentId?: string
  presetDue?: ISODate
  onClose: () => void
  onSaved: (message: string) => void
}

export function TaskForm({ data, store, editing, parentId, presetDue, onClose, onSaved }: Props) {
  const parent = data.tasks.find((t) => t.id === (editing?.parentId ?? parentId))
  const [title, setTitle] = useState(editing?.title ?? '')
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [priority, setPriority] = useState<number | null>(editing?.priority ?? null)
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '')
  const [ongoing, setOngoing] = useState(editing?.ongoing ?? false)
  const [dueDate, setDueDate] = useState(editing?.dueDate ?? presetDue ?? '')
  const [repeat, setRepeat] = useState(!!editing?.recurrence)
  const [everyN, setEveryN] = useState(String(editing?.recurrence?.everyNDays ?? '7'))
  const [endDate, setEndDate] = useState(editing?.recurrence?.endDate ?? '')
  const [checklist, setChecklist] = useState<ChecklistItem[]>(editing?.checklist ?? [])
  const [newCat, setNewCat] = useState<string | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaveError(null)
    const r = validateTask(
      {
        title,
        notes,
        priority,
        categoryId,
        ongoing,
        dueDate,
        checklist,
        parentId: parent?.id ?? null,
        recurrence: repeat ? { everyNDays: everyN.trim() === '' ? NaN : Number(everyN), endDate } : null,
      },
      { categories: data.categories, tasks: data.tasks, selfId: editing?.id },
    )
    if (!r.ok) {
      setErrors(r.errors)
      return
    }
    setErrors({})
    setSaving(true)
    try {
      const cs = editing ? planUpdate(editing, r.value) : planCreate(r.value)
      await store.commit(`save:${editing?.id ?? 'new'}`, cs)
      onSaved(editing ? 'Task updated.' : parent ? 'Subtask added.' : 'Task added.')
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const addCategory = async () => {
    if (newCat == null) return
    try {
      const cat = await store.addCategory(newCat, data.categories)
      setCategoryId(cat.id)
      setNewCat(null)
      setErrors((e) => ({ ...e, categoryId: undefined }))
    } catch (e) {
      setErrors((x) => ({ ...x, categoryId: (e as Error).message }))
    }
  }

  const heading = editing ? 'Edit task' : parent ? 'New subtask' : 'New task'
  return (
    <Sheet title={heading} onClose={onClose}>
      {parent && <p className="muted small">Under “{parent.title}”{parent.dueDate ? ` · due ${parent.dueDate}` : ''}</p>}
      {saveError && <ErrorBanner message={saveError} />}

      <Field label="Title" error={errors.title}>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={500} autoFocus />
      </Field>

      <Field label="Priority" error={errors.priority}>
        <div className="pill-row">
          {[1, 2, 3, 4, 5].map((p) => (
            <button key={p} type="button" className={`pill${priority === p ? ' active' : ''}`} onClick={() => setPriority(p)}>
              P{p}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Category" error={errors.categoryId}>
        <div className="pill-row">
          {data.categories.map((c) => (
            <button key={c.id} type="button" className={`pill cat-pill${categoryId === c.id ? ' active' : ''}`} onClick={() => setCategoryId(c.id)}>
              <span className="cat-dot" style={{ background: safeColor(c.color) }} />
              {c.name}
            </button>
          ))}
          {newCat == null && (
            <button type="button" className="pill" onClick={() => setNewCat('')}>
              + New
            </button>
          )}
        </div>
        {newCat != null && (
          <div className="inline-add">
            <input type="text" placeholder="Category name" value={newCat} maxLength={60} onChange={(e) => setNewCat(e.target.value)} />
            <button type="button" className="btn small primary" onClick={addCategory}>
              Add
            </button>
            <button type="button" className="btn small" onClick={() => setNewCat(null)}>
              Cancel
            </button>
          </div>
        )}
      </Field>

      <label className="toggle-row">
        <span>
          Forever / ongoing
          <span className="muted small block">No deadline needed; always listed under Forever.</span>
        </span>
        <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} />
      </label>

      <Field label={ongoing ? 'Due date (optional)' : 'Due date'} error={errors.dueDate}>
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>

      <label className="toggle-row">
        <span>Repeats</span>
        <input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
      </label>
      {repeat && (
        <div className="field-row">
          <Field label="Every N days" error={errors.recurrence}>
            <input type="number" inputMode="numeric" min={1} step={1} value={everyN} onChange={(e) => setEveryN(e.target.value)} />
          </Field>
          <Field label="Ends (optional)">
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
      )}

      <Field label="Notes" error={errors.notes}>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={20000} />
      </Field>

      <Field label="Checklist" error={errors.checklist}>
        {checklist.map((item, i) => (
          <div className="checklist-item" key={i}>
            <input
              type="checkbox"
              checked={item.done}
              aria-label="Done"
              onChange={() => setChecklist((l) => l.map((c, j) => (j === i ? { ...c, done: !c.done } : c)))}
            />
            <input
              type="text"
              value={item.text}
              maxLength={500}
              onChange={(e) => setChecklist((l) => l.map((c, j) => (j === i ? { ...c, text: e.target.value } : c)))}
            />
            <button type="button" className="link" aria-label="Remove item" onClick={() => setChecklist((l) => l.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="add-row" onClick={() => setChecklist((l) => [...l, { text: '', done: false }])}>
          + Add item
        </button>
      </Field>

      <div className="btn-row">
        <button className="btn" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      {parent && parent.depth + 1 >= MAX_DEPTH && <p className="muted small">This is the deepest level; it can't have subtasks.</p>}
    </Sheet>
  )
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      {children}
      {error && <div className="field-error">{error}</div>}
    </div>
  )
}
