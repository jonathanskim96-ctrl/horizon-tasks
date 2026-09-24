import { useState } from 'react'
import { planCreateMany } from '../domain/actions'
import type { Snapshot } from '../domain/types'
import { validateQuickAdd, type FieldErrors, type QuickAddRow } from '../domain/validate'
import type { Store } from '../data/useStore'
import { ErrorBanner, Sheet } from './Sheet'

const ROWS = 5
const blank = (): QuickAddRow => ({ title: '', dueDate: '', priority: '', categoryId: '' })

/**
 * Batch entry: title / due / priority / category only. Blank-title rows are
 * skipped; any titled row with a problem blocks the whole batch (by design).
 * On success everything is saved in one atomic write and the form resets.
 */
export function QuickAdd({ data, store, onClose, onSaved }: { data: Snapshot; store: Store; onClose: () => void; onSaved: (msg: string) => void }) {
  const [rows, setRows] = useState<QuickAddRow[]>(() => Array.from({ length: ROWS }, blank))
  const [rowErrors, setRowErrors] = useState<Record<number, FieldErrors>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (i: number, patch: Partial<QuickAddRow>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))

  const save = async () => {
    setError(null)
    const r = validateQuickAdd(rows, { categories: data.categories, tasks: data.tasks })
    if (!r.ok) {
      setRowErrors(r.rowErrors)
      setError('Nothing was saved — fix the highlighted rows (or clear their titles).')
      return
    }
    setRowErrors({})
    if (!r.values.length) return setError('Type a title in at least one row.')
    setSaving(true)
    try {
      await store.commit('quickadd', planCreateMany(r.values))
      onSaved(`Added ${r.values.length} task${r.values.length === 1 ? '' : 's'}.`)
      setRows(Array.from({ length: ROWS }, blank))
    } catch (e) {
      setError(`Couldn't save: ${(e as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet title="Quick add" onClose={onClose}>
      <p className="muted small">Rows without a title are ignored. Notes, checklists, repeats and Forever need the full form.</p>
      {error && <ErrorBanner message={error} />}
      {rows.map((row, i) => {
        const err = rowErrors[i]
        return (
          <div className={`qa-row${err ? ' has-error' : ''}`} key={i}>
            <input type="text" placeholder={`Task ${i + 1}`} aria-label={`Row ${i + 1} title`} value={row.title} maxLength={500} onChange={(e) => set(i, { title: e.target.value })} />
            <div className="qa-fields">
              <input type="date" aria-label={`Row ${i + 1} due date`} value={row.dueDate} onChange={(e) => set(i, { dueDate: e.target.value })} />
              <select aria-label={`Row ${i + 1} priority`} value={String(row.priority)} onChange={(e) => set(i, { priority: e.target.value === '' ? '' : Number(e.target.value) })}>
                <option value="">P–</option>
                {[1, 2, 3, 4, 5].map((p) => (
                  <option key={p} value={p}>
                    P{p}
                  </option>
                ))}
              </select>
              <select aria-label={`Row ${i + 1} category`} value={row.categoryId} onChange={(e) => set(i, { categoryId: e.target.value })}>
                <option value="">Category</option>
                {data.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            {err && <div className="field-error">{Object.values(err).join(' ')}</div>}
          </div>
        )
      })}
      <div className="btn-row">
        <button className="btn" onClick={onClose} disabled={saving}>
          Close
        </button>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save all'}
        </button>
      </div>
    </Sheet>
  )
}
