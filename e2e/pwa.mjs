// PWA checks with a real (non-incognito) Chromium profile: the browser itself
// must report the app as installable, and everything the manifest references
// must exist.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:5198/'
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pwa-')), {
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
  viewport: { width: 390, height: 844 },
})
const page = await ctx.newPage()
await page.route('http://mock.supabase.local/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
await page.goto(BASE)
await page.waitForFunction(() => navigator.serviceWorker?.ready.then(() => true))
const cdp = await ctx.newCDPSession(page)
const problems = []
const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors')
if (installabilityErrors.length) problems.push('Chromium says not installable: ' + JSON.stringify(installabilityErrors))
const { errors, url } = await cdp.send('Page.getAppManifest')
if (errors.length) problems.push('manifest errors: ' + JSON.stringify(errors))
const manifest = await (await page.request.get(url)).json()
for (const key of ['id', 'name', 'short_name', 'start_url', 'scope', 'display', 'theme_color', 'background_color', 'icons', 'shortcuts', 'screenshots'])
  if (!manifest[key]) problems.push(`manifest missing ${key}`)
if (manifest.display !== 'standalone') problems.push('display is not standalone')
if (!manifest.icons.some((i) => i.purpose === 'maskable')) problems.push('no maskable icon')
if (!manifest.icons.some((i) => i.sizes === '512x512')) problems.push('no 512px icon')
const files = [...manifest.icons, ...manifest.screenshots, ...manifest.shortcuts.flatMap((s) => s.icons ?? [])].map((i) => i.src)
for (const f of new Set(files)) {
  const r = await page.request.get(new URL(f, url).href)
  if (!r.ok()) problems.push(`${f}: HTTP ${r.status()}`)
}
const head = await page.evaluate(() => ({
  viewport: document.querySelector('meta[name=viewport]')?.content ?? '',
  appleIcon: !!document.querySelector('link[rel=apple-touch-icon]'),
  appleCapable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
}))
if (!head.viewport.includes('viewport-fit=cover')) problems.push('viewport lacks viewport-fit=cover (iPhone status bar overlap)')
if (!head.appleIcon || head.appleCapable !== 'yes') problems.push('iOS home-screen tags missing')
await ctx.close()
if (problems.length) {
  console.log('FAIL  PWA installability\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log(`pwa: installable, manifest complete (${files.length} referenced files OK)`)
