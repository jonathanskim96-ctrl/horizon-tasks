import { inForever, sortForever } from '../domain/placement'
import type { ISODate, Snapshot, Task } from '../domain/types'
import { TaskList } from '../ui/TaskRow'

export function Forever(props: { data: Snapshot; today: ISODate; onOpen: (t: Task) => void; onComplete: (t: Task) => void }) {
  const tasks = sortForever(props.data.tasks.filter(inForever))
  return (
    <>
      <div className="panel-title">Ongoing responsibilities</div>
      <TaskList tasks={tasks} empty="No Forever tasks yet. Turn on “Forever / ongoing” when adding a task." {...props} />
    </>
  )
}
