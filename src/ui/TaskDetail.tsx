import { safeColor } from '../domain/categories'
import { breadcrumb, childrenOf, isOverdue, sortTasks } from '../domain/placement'
import { subtaskProgress } from '../domain/actions'
import { MAX_DEPTH, type ISODate, type Snapshot, type Task } from '../domain/types'
import { Sheet } from './Sheet'
import { TaskList } from './TaskRow'

interface Props {
  task: Task
  data: Snapshot
  today: ISODate
  onClose: () => void
  onOpen: (t: Task) => void
  onEdit: (t: Task) => void
  onAddSubtask: (t: Task) => void
  onComplete: (t: Task) => void
  onDelete: (t: Task) => void
  onToggleChecklist: (t: Task, index: number) => void
  /** `${taskId}:${index}` of items currently saving. */
  pendingChecks: ReadonlySet<string>
}

export function TaskDetail(p: Props) {
  const { task: t, data, today } = p
  const cat = data.categories.find((c) => c.id === t.categoryId)
  const crumbs = breadcrumb(data.tasks, t)
  const kids = sortTasks(childrenOf(data.tasks, t.id), today)
  const progress = subtaskProgress(data.tasks, data.completions, t.id)
  return (
    <Sheet title={t.title} onClose={p.onClose}>
      {crumbs.length > 0 && <p className="muted small">↳ {crumbs.join(' › ')}</p>}
      <div className="detail-meta">
        <span className="chip">
          <span className="cat-dot" style={{ background: safeColor(cat?.color) }} />
          {cat?.name ?? 'No category'}
        </span>
        <span className="chip">P{t.priority}</span>
        {t.dueDate && <span className={`chip${isOverdue(t, today) ? ' overdue-chip' : ''}`}>Due {t.dueDate}</span>}
        {t.ongoing && <span className="chip">Forever</span>}
        {t.recurrence && (
          <span className="chip">
            ↻ every {t.recurrence.everyNDays}d{t.recurrence.endDate ? ` until ${t.recurrence.endDate}` : ''}
          </span>
        )}
      </div>

      {t.notes && (
        <section className="detail-section">
          <div className="field-label">Notes</div>
          <div className="notes-text">{t.notes}</div>
        </section>
      )}

      {t.checklist.length > 0 && (
        <section className="detail-section">
          <div className="field-label">Checklist</div>
          {t.checklist.map((item, i) => (
            <label className={`checklist-view${p.pendingChecks.has(`${t.id}:${i}`) ? ' pending' : ''}`} key={i}>
              <input
                type="checkbox"
                checked={item.done}
                disabled={p.pendingChecks.has(`${t.id}:${i}`)}
                onChange={() => p.onToggleChecklist(t, i)}
              />
              <span className={item.done ? 'done' : ''}>{item.text}</span>
            </label>
          ))}
        </section>
      )}

      <section className="detail-section">
        <div className="field-label">
          Subtasks{progress.total > 0 ? ` · ${progress.done} of ${progress.total} done` : ''}
        </div>
        <TaskList tasks={kids} data={data} today={today} onOpen={p.onOpen} onComplete={p.onComplete} empty="No open subtasks." />
        {t.depth < MAX_DEPTH && (
          <button className="add-row" onClick={() => p.onAddSubtask(t)}>
            + Add subtask
          </button>
        )}
      </section>

      <div className="btn-row">
        <button className="btn danger-outline" onClick={() => p.onDelete(t)}>
          Delete
        </button>
        <button className="btn" onClick={() => p.onEdit(t)}>
          Edit
        </button>
        <button className="btn good" onClick={() => p.onComplete(t)}>
          Complete
        </button>
      </div>
    </Sheet>
  )
}

/** In-app confirmation (never window.confirm). */
export function Confirm(props: {
  title: string
  body: React.ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet title={props.title} onClose={props.onCancel}>
      {props.error && (
        <div className="error" role="alert">
          {props.error}
        </div>
      )}
      <div className="confirm-body">{props.body}</div>
      <div className="btn-row">
        <button className="btn" onClick={props.onCancel} disabled={props.busy}>
          Cancel
        </button>
        <button className={`btn ${props.danger ? 'danger' : 'primary'}`} onClick={props.onConfirm} disabled={props.busy}>
          {props.busy ? 'Working…' : props.confirmLabel}
        </button>
      </div>
    </Sheet>
  )
}
