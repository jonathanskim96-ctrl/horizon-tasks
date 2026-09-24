import { useState } from 'react'
import { addDays, monthBounds, weekBounds } from '../domain/dates'
import { dayCounts, sortTasks } from '../domain/placement'
import type { ISODate, Snapshot, Task } from '../domain/types'
import { TaskList } from './TaskRow'

interface Props {
  data: Snapshot
  today: ISODate
  onOpen: (t: Task) => void
  onComplete: (t: Task) => void
  onAddOn: (day: ISODate) => void
}

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

/** A grid of day cells with per-day counts; tapping a day lists its tasks. */
function DayGrid({ days, lead, data, today, onOpen, onComplete, onAddOn }: Props & { days: ISODate[]; lead: number }) {
  const [selected, setSelected] = useState<ISODate | null>(null)
  const counts = dayCounts(data.tasks, days[0], days[days.length - 1], today)
  const dayTasks = selected ? sortTasks(data.tasks.filter((t) => t.dueDate === selected), today) : []
  return (
    <>
      <div className="cal-grid">
        {DOW.map((d, i) => (
          <div className="cal-dow" key={i}>
            {d}
          </div>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <div key={`pad${i}`} />
        ))}
        {days.map((d) => {
          const c = counts[d]
          return (
            <button
              key={d}
              className={`cal-cell${d === today ? ' today' : ''}${d === selected ? ' selected' : ''}${c?.overdue ? ' has-overdue' : ''}`}
              onClick={() => setSelected(selected === d ? null : d)}
              aria-label={`${d}${c ? `, ${c.total} due` : ''}`}
              aria-pressed={d === selected}
            >
              <span className="d">{Number(d.slice(8))}</span>
              {c && <span className="cnt">{c.total}</span>}
            </button>
          )
        })}
      </div>
      {selected && (
        <div className="cal-day-list">
          <div className="panel-title">
            {selected}
            <button className="pill" onClick={() => onAddOn(selected)}>
              + Add task
            </button>
          </div>
          <TaskList tasks={dayTasks} data={data} today={today} onOpen={onOpen} onComplete={onComplete} empty="Nothing due this day." />
        </div>
      )}
    </>
  )
}

const range = (start: ISODate, end: ISODate) => {
  const out: ISODate[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d)
  return out
}

export function MonthCalendar(props: Props) {
  const [anchor, setAnchor] = useState<ISODate>(monthBounds(props.today).start)
  const { start, end } = monthBounds(anchor)
  const lead = new Date(`${start}T00:00:00Z`).getUTCDay()
  const label = new Date(`${start}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const shift = (n: number) => {
    const [y, m] = anchor.split('-').map(Number)
    setAnchor(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10))
  }
  return (
    <div>
      <div className="cal-head">
        <div className="month-label">{label}</div>
        <div className="cal-nav">
          <button onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <button onClick={() => setAnchor(monthBounds(props.today).start)} aria-label="This month" className="cal-today">
            •
          </button>
          <button onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </div>
      <DayGrid key={anchor} {...props} days={range(start, end)} lead={lead} />
    </div>
  )
}

/** The current Sunday–Saturday week. */
export function WeekCalendar(props: Props) {
  const { start, end } = weekBounds(props.today)
  return <DayGrid key={start} {...props} days={range(start, end)} lead={0} />
}
