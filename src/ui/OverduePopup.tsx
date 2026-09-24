import { useState } from 'react'
import { safeColor } from '../domain/categories'
import { diffDays } from '../domain/dates'
import { breadcrumb, descendantsOf, isOverdue, sortTasks } from '../domain/placement'
import type { ISODate, Outcome, Snapshot, Task } from '../domain/types'
import { ErrorBanner, Sheet } from './Sheet'

interface Props {
  data: Snapshot
  today: ISODate
  error: string | null
  /** Resolves true when the write succeeded. */
  onFinish: (t: Task, outcome: Outcome) => Promise<boolean>
  onClose: () => void
}

/**
 * Lists every overdue task. Dismiss hides it until the next app open (no data
 * change); Not needed records a skip; Complete records a completion. Both of
 * those advance recurring tasks. Items with open subtasks ask once inline.
 */
export function OverduePopup({ data, today, error, onFinish, onClose }: Props) {
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const [confirming, setConfirming] = useState<{ id: string; outcome: Outcome } | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const items = sortTasks(data.tasks.filter((t) => isOverdue(t, today) && !dismissed.has(t.id)), today)

  const act = async (t: Task, outcome: Outcome) => {
    const subtasks = descendantsOf(data.tasks, t.id).length
    if (subtasks && !(confirming?.id === t.id && confirming.outcome === outcome)) {
      setConfirming({ id: t.id, outcome })
      return
    }
    setConfirming(null)
    setWorking(t.id)
    await onFinish(t, outcome)
    setWorking(null)
  }

  return (
    <Sheet title={items.length ? `${items.length} overdue` : 'All caught up'} onClose={onClose}>
      {error && <ErrorBanner message={error} />}
      {!items.length && <p className="muted">Nothing overdue. 🎉</p>}
      {items.map((t) => {
        const cat = data.categories.find((c) => c.id === t.categoryId)
        const late = diffDays(t.dueDate!, today)
        const crumbs = breadcrumb(data.tasks, t)
        const subtasks = descendantsOf(data.tasks, t.id).length
        const asking = confirming?.id === t.id ? confirming.outcome : null
        return (
          <div className="popup-item" key={t.id}>
            <div className="task-top">
              <span className="cat-dot" style={{ background: safeColor(cat?.color) }} />
              <span className="task-title">{t.title}</span>
              <span className="priority-chip">P{t.priority}</span>
            </div>
            <div className="popup-meta">
              {crumbs.length > 0 && <span className="breadcrumb">↳ {crumbs.join(' › ')} · </span>}
              due {t.dueDate} · {late} day{late === 1 ? '' : 's'} late{t.recurrence ? ` · ↻ every ${t.recurrence.everyNDays}d` : ''}
            </div>
            {asking && (
              <div className="warn-box small">
                Also {asking === 'completed' ? 'completes' : 'marks not needed'} its {subtasks} open subtask(s). Tap again to confirm.
              </div>
            )}
            <div className="popup-actions">
              <button disabled={working === t.id} onClick={() => setDismissed((s) => new Set(s).add(t.id))}>
                Dismiss
              </button>
              <button className="skip" disabled={working === t.id} onClick={() => void act(t, 'skipped')}>
                {asking === 'skipped' ? 'Confirm not needed' : 'Not needed'}
              </button>
              <button className="complete" disabled={working === t.id} onClick={() => void act(t, 'completed')}>
                {asking === 'completed' ? 'Confirm complete' : 'Complete'}
              </button>
            </div>
          </div>
        )
      })}
      <div className="btn-row">
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  )
}
