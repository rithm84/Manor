import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt', injectRegister: false,
    manifest: { name: 'Manor', short_name: 'Manor', start_url: '/home', display: 'standalone',
      background_color: '#161418', theme_color: '#805096',
      icons: [{ src: '/brand/manor-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }] },
    workbox: {
      globPatterns: ['**/*.{js,css,html,woff2,svg}'],
      maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/auth\//, /^\/oauth\//],
      cleanupOutdatedCaches: true, skipWaiting: false, clientsClaim: true
    }
  })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: { target: 'es2022' }
})
