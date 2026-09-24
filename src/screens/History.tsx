import { useState } from 'react'
import { safeColor } from '../domain/categories'
import { formatTimestamp } from '../domain/dates'
import type { Completion, Snapshot } from '../domain/types'

interface Props {
  data: Snapshot
  onRestore: (c: Completion) => void
  onDelete: (c: Completion) => void
  onExportJSON: () => void
  onExportCSV: () => void
  onImport: () => void
}

const PAGE = 100

export function History({ data, onRestore, onDelete, onExportJSON, onExportCSV, onImport }: Props) {
  const [shown, setShown] = useState(PAGE)
  const items = [...data.completions].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
  return (
    <>
      <div className="panel-title">
        History · {items.length}
        <span className="pill-row">
          <button className="pill" onClick={onExportJSON}>
            Export JSON
          </button>
          <button className="pill" onClick={onExportCSV}>
            CSV
          </button>
          <button className="pill" onClick={onImport}>
            Import
          </button>
        </span>
      </div>
      {!items.length && <div className="empty">Nothing completed yet.</div>}
      <div className="task-list">
        {items.slice(0, shown).map((c) => (
          <div className="hist-row" key={c.id}>
            <div className="task-main">
              <div className="task-top">
                <span className="cat-dot" style={{ background: safeColor(c.snapshot.categoryColor) }} title={c.snapshot.categoryName} />
                <span className="task-title">{c.snapshot.title}</span>
                {c.outcome === 'skipped' && <span className="badge skip-badge">Not needed</span>}
              </div>
              <div className="task-meta">
                {c.snapshot.parentTitle && <span className="breadcrumb">↳ {c.snapshot.parentTitle}</span>}
                <span>{formatTimestamp(c.completedAt)}</span>
                {c.dueDate && <span className="mono">due {c.dueDate}</span>}
              </div>
            </div>
            <div className="hist-actions">
              <button className="btn small" onClick={() => onRestore(c)} aria-label={`Restore “${c.snapshot.title}”`}>
                Restore
              </button>
              <button className="btn small danger-outline" onClick={() => onDelete(c)} aria-label={`Delete “${c.snapshot.title}” permanently`}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      {items.length > shown && (
        <button className="add-row" onClick={() => setShown((n) => n + PAGE)}>
          Show more ({items.length - shown} older)
        </button>
      )}
    </>
  )
}
