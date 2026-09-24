// App-update test: version A is installed (service worker), version B is
// published, and the user reopens the app. They must end up on B without
// doing anything special; if B lands while the app is in use, a Reload banner
// appears instead of a surprise reload.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright'
import { createMock, session } from './mock.mjs'

const [dirA, dirB] = process.argv.slice(2)
let root = dirA
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' }
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  const file = join(root, path.endsWith('/') ? path + 'index.html' : path)
  try {
    const body = await readFile(file)
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=600' })
    res.end(body)
  } catch {
    res.writeHead(404).end()
  }
}).listen(5197)
const BASE = 'http://localhost:5197/'
const results = []
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})

async function run(name, fn) {
  root = dirA
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  const mock = createMock()
  await page.route('http://mock.supabase.local/**', mock.handler)
  await page.routeWebSocket(/realtime/, mock.realtime)
  await page.addInitScript((s) => { try { localStorage.setItem('sb-mock-auth-token', s) } catch {} }, session('u'))
  try {
    await fn(page)
    results.push(['PASS', name])
  } catch (e) {
    results.push(['FAIL', name, e.message.split('\n')[0]])
  }
  await ctx.close()
}
const build = (page) => page.locator('.build-id').textContent()
async function installA(page) {
  await page.goto(BASE)
  await page.getByText('build aaaaaaa').waitFor()
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload() // now controlled by A's service worker
  await page.getByText('build aaaaaaa').waitFor()
}

await run('Reopening after a new release lands on the new version automatically', async (page) => {
  await installA(page)
  root = dirB // new version published
  await page.reload() // "open the app again": old shell first, then auto-switch
  await page.getByText('build bbbbbbb').waitFor({ timeout: 20000 })
  await page.getByText('Due today', { exact: true }).waitFor()
})

await run('A release arriving mid-use shows a Reload banner, not a surprise reload', async (page) => {
  await installA(page)
  await page.waitForTimeout(11000) // user has been using the app for a while
  root = dirB
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()))
  await page.getByText('A new version of Horizon is ready.').waitFor({ timeout: 20000 })
  if ((await build(page)) !== 'build aaaaaaa') throw new Error('reloaded without asking')
  await page.getByRole('button', { name: 'Reload' }).click()
  await page.getByText('build bbbbbbb').waitFor({ timeout: 20000 })
})

await browser.close()
server.close()
for (const r of results) console.log(r.join('  '))
const passed = results.filter((r) => r[0] === 'PASS').length
console.log(`update: ${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
