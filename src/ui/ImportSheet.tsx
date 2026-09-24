import { useState } from 'react'
import { defaultEnv } from '../domain/actions'
import { missingCategories, parseImport, planImport, MAX_IMPORT_BYTES, type ParsedImport } from '../domain/importing'
import type { Category, Snapshot } from '../domain/types'
import type { Store } from '../data/useStore'
import { ErrorBanner, Sheet } from './Sheet'

interface Props {
  data: Snapshot
  store: Store
  onClose: () => void
  onDone: (message: string) => void
}

/** Choose file → preview (nothing written) → confirm → atomic write. */
export function ImportSheet({ data, store, onClose, onDone }: Props) {
  const [parsed, setParsed] = useState<ParsedImport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const choose = async (file: File | undefined) => {
    setError(null)
    setParsed(null)
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) return setError('That file is too large to be an export (over 5 MB).')
    try {
      setParsed(parseImport(await file.text()))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  // Preview against placeholder categories; the real write re-plans with real ids.
  let preview: ReturnType<typeof planImport> | null = null
  let newCats: { name: string; color: string }[] = []
  let previewError: string | null = null
  if (parsed) {
    try {
      newCats = missingCategories(parsed, data.categories)
      const pseudo: Category[] = newCats.map((c, i) => ({ id: `pending-${i}`, name: c.name, color: c.color, sortOrder: 999 }))
      preview = planImport(parsed, { ...data, categories: [...data.categories, ...pseudo] }, defaultEnv)
    } catch (e) {
      previewError = (e as Error).message
    }
  }

  const confirm = async () => {
    if (!parsed) return
    setWorking(true)
    setError(null)
    const createdCats: string[] = []
    try {
      let categories = data.categories
      for (const c of missingCategories(parsed, categories)) {
        const created = await store.addCategory(c.name, categories, c.color)
        categories = [...categories, created]
        createdCats.push(created.name)
      }
      const plan = planImport(parsed, { ...data, categories }, defaultEnv)
      await store.commit('import', plan.changeSet)
      onDone(`Imported ${plan.counts.tasks} task(s) and ${plan.counts.completions} history entr${plan.counts.completions === 1 ? 'y' : 'ies'}.`)
    } catch (e) {
      const cats = createdCats.length ? ` (the new categories ${createdCats.join(', ')} were already created)` : ''
      setError(`Import failed — no tasks or history were added${cats}: ${(e as Error).message}`)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Sheet title="Import" onClose={onClose}>
      <p className="muted small">
        Choose a JSON export — from the old Horizon Tasks artifact (History → Export) or from this app. Items already here are
        skipped, so importing the same file twice is safe. Nothing is saved until you confirm.
      </p>
      <input type="file" accept=".json,application/json" aria-label="Export file" onChange={(e) => void choose(e.target.files?.[0])} />
      {(error ?? previewError) && <ErrorBanner message={(error ?? previewError)!} />}
      {preview && (
        <div className="import-preview">
          <ul>
            <li>
              <b>{preview.counts.tasks}</b> task(s) to add
            </li>
            <li>
              <b>{preview.counts.completions}</b> history entr{preview.counts.completions === 1 ? 'y' : 'ies'} to add
            </li>
            {newCats.length > 0 && (
              <li>
                New categories: <b>{newCats.map((c) => c.name).join(', ')}</b>
              </li>
            )}
            {preview.counts.duplicates > 0 && <li>{preview.counts.duplicates} already here — skipped</li>}
            {preview.counts.skipped > 0 && <li>{preview.counts.skipped} can't be imported — see below</li>}
          </ul>
          {preview.notes.length > 0 && (
            <details open={preview.notes.length <= 8}>
              <summary>Adjustments and skips ({preview.notes.length})</summary>
              <ul className="small">
                {preview.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <div className="btn-row">
        <button className="btn" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button
          className="btn primary"
          onClick={confirm}
          disabled={working || !preview || preview.counts.tasks + preview.counts.completions === 0}
        >
          {working ? 'Importing…' : 'Import'}
        </button>
      </div>
    </Sheet>
  )
}
