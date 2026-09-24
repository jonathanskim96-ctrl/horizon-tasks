import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Horizon Tasks',
        short_name: 'Horizon',
        description: 'Personal task planner across daily, weekly, monthly and forever horizons.',
        theme_color: '#111317',
        background_color: '#111317',
        display: 'standalone',
        start_url: '/',
        icons: [
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
})
