import react from '@vitejs/plugin-react'
import { loadEnv, type Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Content-Security-Policy for production builds: only our own scripts run,
 * and the page may only talk to our own origin and the Supabase project.
 * (Dev is excluded: Vite's hot reload needs inline scripts.)
 */
function contentSecurityPolicy(supabaseUrl: string | undefined): Plugin {
  const api = supabaseUrl ? new URL(supabaseUrl) : null
  const connect = api ? ` ${api.origin} ${api.protocol === 'http:' ? 'ws' : 'wss'}://${api.host}` : ''
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${connect}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'horizon-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`),
  }
}

export default defineConfig(({ mode }) => ({
  // GitHub Pages serves the app under /horizon-tasks/; local dev uses /.
  base: process.env.BASE_PATH ?? '/',
  plugins: [
    react(),
    contentSecurityPolicy(process.env.VITE_SUPABASE_URL ?? loadEnv(mode, process.cwd(), 'VITE_').VITE_SUPABASE_URL),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by src/sw-register.ts (update handling), not an injected script.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Horizon Tasks',
        short_name: 'Horizon',
        description: 'Personal task planner across daily, weekly, monthly and forever horizons.',
        theme_color: '#111317',
        background_color: '#111317',
        display: 'standalone',
        // Stable identity: updates never show up as a second, separate app.
        // = the start address, which is what already-installed copies are known by.
        id: process.env.BASE_PATH ?? '/',
        lang: 'en',
        dir: 'ltr',
        categories: ['productivity'],
        // Long-press the home-screen icon for these.
        shortcuts: [
          { name: 'Quick add', short_name: 'Quick add', url: '?open=quickadd', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'New task', short_name: 'New task', url: '?open=new', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: 'Today', short_name: 'Today', url: '?open=daily', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // Shown in the richer install dialog (sample data, not real tasks).
        screenshots: [
          { src: 'screenshots/phone.png', sizes: '390x844', type: 'image/png', form_factor: 'narrow', label: 'Dashboard' },
          { src: 'screenshots/wide.png', sizes: '1280x800', type: 'image/png', form_factor: 'wide', label: 'Dashboard on a larger screen' },
        ],
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Take over as soon as a new version is installed (the page then
        // reloads or offers a Reload — see src/sw-register.ts). Without these,
        // updates wait until every tab/home-screen instance is fully closed.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Never cache Supabase API/auth responses in the service worker.
        navigateFallbackDenylist: [/^\/auth/],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
}))
