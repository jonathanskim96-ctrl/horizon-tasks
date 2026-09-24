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
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'privacy.html'],
      manifest: {
        name: 'Horizon Tasks',
        short_name: 'Horizon',
        description: 'Personal task planner across daily, weekly, monthly and forever horizons.',
        theme_color: '#111317',
        background_color: '#111317',
        display: 'standalone',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        // Never cache Supabase API/auth responses in the service worker.
        navigateFallbackDenylist: [/^\/auth/],
      },
    }),
  ],
  test: {
    environment: 'node',
  },
}))
