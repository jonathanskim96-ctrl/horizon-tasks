import { inDaily, inForever, inWeekly, isOverdue, sortTasks } from '../domain/placement'
import type { ISODate, Snapshot, Task } from '../domain/types'
import { MonthCalendar } from '../ui/Calendar'
import { TaskList } from '../ui/TaskRow'

interface Props {
  data: Snapshot
  today: ISODate
  onOpen: (t: Task) => void
  onComplete: (t: Task) => void
  onAddOn: (day: ISODate) => void
  onGoForever: () => void
}

export function Dashboard({ data, today, onOpen, onComplete, onAddOn, onGoForever }: Props) {
  const daily = sortTasks(data.tasks.filter((t) => inDaily(t, today)), today)
  const weekly = sortTasks(data.tasks.filter((t) => inWeekly(t, today)), today)
  const overdue = data.tasks.filter((t) => isOverdue(t, today)).length
  const dueToday = data.tasks.filter((t) => t.dueDate === today).length
  const forever = data.tasks.filter((t) => inForever(t) && !t.parentId).length
  const list = { data, today, onOpen, onComplete }
  return (
    <>
      <div className="stat-row">
        <div className="stat-card">
          <div className="num">{dueToday}</div>
          <div className="lbl">Due today</div>
        </div>
        <div className={`stat-card${overdue ? ' overdue-stat' : ''}`}>
          <div className="num">{overdue}</div>
          <div className="lbl">Overdue</div>
        </div>
        <button className="stat-card forever-stat" onClick={onGoForever} aria-label="Open Forever tab">
          <div className="num">{forever}</div>
          <div className="lbl">Forever</div>
        </button>
      </div>
      <div className="panel-title">Today</div>
      <TaskList tasks={daily} empty="Nothing due today." {...list} />
      <div className="panel-title">This week</div>
      <TaskList tasks={weekly} empty="Nothing due this week." {...list} />
      <div className="panel-title">Calendar</div>
      <MonthCalendar data={data} today={today} onOpen={onOpen} onComplete={onComplete} onAddOn={onAddOn} />
    </>
  )
}
