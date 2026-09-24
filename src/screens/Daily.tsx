import { inDaily, sortTasks } from '../domain/placement'
import type { ISODate, Snapshot, Task } from '../domain/types'
import { TaskList } from '../ui/TaskRow'

export function Daily(props: { data: Snapshot; today: ISODate; onOpen: (t: Task) => void; onComplete: (t: Task) => void }) {
  const { data, today } = props
  const tasks = sortTasks(data.tasks.filter((t) => inDaily(t, today)), today)
  return (
    <>
      <div className="panel-title">Today · {today}</div>
      <TaskList tasks={tasks} empty="Nothing due today or overdue. 🎉" {...props} />
    </>
  )
}
