// Weekly, Monthly and Later tabs.
import { useState } from 'react'
import { addDays, weekBounds } from '../domain/dates'
import { inLater, inMonthlyList, inWeekly, sortTasks } from '../domain/placement'
import type { ISODate, Snapshot, Task } from '../domain/types'
import { MonthCalendar, WeekCalendar } from '../ui/Calendar'
import { TaskList } from '../ui/TaskRow'

interface Props {
  data: Snapshot
  today: ISODate
  onOpen: (t: Task) => void
  onComplete: (t: Task) => void
  onAddOn: (day: ISODate) => void
}

function ViewToggle({ view, onChange }: { view: 'list' | 'cal'; onChange: (v: 'list' | 'cal') => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      <button className={view === 'list' ? 'active' : ''} aria-pressed={view === 'list'} onClick={() => onChange('list')}>
        List
      </button>
      <button className={view === 'cal' ? 'active' : ''} aria-pressed={view === 'cal'} onClick={() => onChange('cal')}>
        Calendar
      </button>
    </div>
  )
}

export function Weekly(props: Props) {
  const [view, setView] = useState<'list' | 'cal'>('list')
  const { data, today, onOpen, onComplete } = props
  const { start, end } = weekBounds(today)
  const tasks = sortTasks(data.tasks.filter((t) => inWeekly(t, today)), today)
  return (
    <>
      <div className="panel-title">
        This week · {start.slice(5)} – {end.slice(5)}
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === 'list' ? (
        <TaskList tasks={tasks} data={data} today={today} onOpen={onOpen} onComplete={onComplete} empty="Nothing due this week." />
      ) : (
        <WeekCalendar {...props} />
      )}
    </>
  )
}

export function Monthly(props: Props) {
  const [view, setView] = useState<'list' | 'cal'>('list')
  const { data, today, onOpen, onComplete } = props
  const tasks = sortTasks(data.tasks.filter((t) => inMonthlyList(t, today)), today)
  return (
    <>
      <div className="panel-title">
        {view === 'list' ? `Next 30 days · to ${addDays(today, 30).slice(5)}` : 'Month'}
        <ViewToggle view={view} onChange={setView} />
      </div>
      {view === 'list' ? (
        <TaskList tasks={tasks} data={data} today={today} onOpen={onOpen} onComplete={onComplete} empty="Nothing due in the next 30 days." />
      ) : (
        <MonthCalendar {...props} />
      )}
    </>
  )
}

export function Later({ data, today, onOpen, onComplete }: Props) {
  const tasks = sortTasks(data.tasks.filter((t) => inLater(t, today)), today)
  return (
    <>
      <div className="panel-title">Later · after this month</div>
      <TaskList tasks={tasks} data={data} today={today} onOpen={onOpen} onComplete={onComplete} empty="Nothing scheduled beyond this month." />
    </>
  )
}
