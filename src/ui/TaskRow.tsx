import { safeColor } from '../domain/categories'
import { breadcrumb, isOverdue } from '../domain/placement'
import { subtaskProgress } from '../domain/actions'
import type { ISODate, Snapshot, Task } from '../domain/types'

interface Props {
  task: Task
  data: Snapshot
  today: ISODate
  onOpen: (t: Task) => void
  onComplete: (t: Task) => void
}

export function TaskRow({ task: t, data, today, onOpen, onComplete }: Props) {
  const cat = data.categories.find((c) => c.id === t.categoryId)
  const overdue = isOverdue(t, today)
  const crumbs = breadcrumb(data.tasks, t)
  const progress = subtaskProgress(data.tasks, data.completions, t.id)
  return (
    <div
      className={`task-row${overdue ? ' overdue' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Open “${t.title}”`}
      onClick={() => onOpen(t)}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onOpen(t)
        }
      }}
    >
      <button
        className="check"
        aria-label={`Complete “${t.title}”`}
        onClick={(e) => {
          e.stopPropagation()
          onComplete(t)
        }}
      />
      <div className="task-main">
        <div className="task-top">
          <span className="cat-dot" style={{ background: safeColor(cat?.color) }} title={cat?.name} />
          <span className="task-title">{t.title}</span>
          {overdue && <span className="badge overdue-badge">Overdue</span>}
          <span className="priority-chip">P{t.priority}</span>
        </div>
        <div className="task-meta">
          {crumbs.length > 0 && <span className="breadcrumb">↳ {crumbs.join(' › ')}</span>}
          {t.dueDate && <span className="mono">{t.dueDate}</span>}
          {t.ongoing && <span>Forever</span>}
          {progress.total > 0 && (
            <span>
              {progress.done}/{progress.total} done
            </span>
          )}
          {t.recurrence && <span>↻ every {t.recurrence.everyNDays}d</span>}
          {t.checklist.length > 0 && (
            <span>
              ☑ {t.checklist.filter((c) => c.done).length}/{t.checklist.length}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export function TaskList(props: Omit<Props, 'task'> & { tasks: Task[]; empty: string }) {
  const { tasks, empty, ...rest } = props
  if (!tasks.length) return <div className="empty">{empty}</div>
  return (
    <div className="task-list">
      {tasks.map((t) => (
        <TaskRow key={t.id} task={t} {...rest} />
      ))}
    </div>
  )
}
