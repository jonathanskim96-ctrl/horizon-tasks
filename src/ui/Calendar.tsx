import { useState } from 'react'
import { addDays, monthBounds } from '../domain/dates'
import { monthCounts, sortTasks } from '../domain/placement'
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

export function MonthCalendar({ data, today, onOpen, onComplete, onAddOn }: Props) {
  const [anchor, setAnchor] = useState<ISODate>(monthBounds(today).start)
  const [selected, setSelected] = useState<ISODate | null>(null)
  const { start, end } = monthBounds(anchor)
  const counts = monthCounts(data.tasks, anchor, today)
  const lead = new Date(`${start}T00:00:00Z`).getUTCDay()
  const days: ISODate[] = []
  for (let d = start; d <= end; d = addDays(d, 1)) days.push(d)
  const label = new Date(`${start}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const shift = (n: number) => {
    const [y, m] = anchor.split('-').map(Number)
    setAnchor(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10))
  }
  const dayTasks = selected ? sortTasks(data.tasks.filter((t) => t.dueDate === selected), today) : []

  return (
    <div>
      <div className="cal-head">
        <div className="month-label">{label}</div>
        <div className="cal-nav">
          <button onClick={() => shift(-1)} aria-label="Previous month">
            ‹
          </button>
          <button onClick={() => shift(1)} aria-label="Next month">
            ›
          </button>
        </div>
      </div>
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
    </div>
  )
}
