import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt', injectRegister: false,
    manifest: { name: 'Manor', short_name: 'Manor', description: 'Your tasks, habits, notes, and daily perspective.', id: '/', start_url: '/home', display: 'standalone', display_override: ['window-controls-overlay'],
      background_color: '#161418', theme_color: '#805096',
      // Raster icons for the Dock and app switcher; the maskable one keeps the mark inside the safe zone of rounded tiles.
      icons: [
        { src: '/brand/manor-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/brand/manor-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/brand/manor-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: '/brand/manor-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }
      ] },
    workbox: {
      // Precache the shell and page chunks; syntax grammars, KaTeX fonts, and legacy font formats are cached on first use instead.
      globPatterns: ['**/*.{js,css,html,woff2,svg,png}'],
      globIgnores: ['**/lang/**', '**/katex/**'],
      maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
      runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/assets/'), handler: 'CacheFirst',
        options: { cacheName: 'manor-assets', expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 } } }],
      navigateFallback: '/index.html', navigateFallbackDenylist: [/^\/auth\//, /^\/oauth\//],
      cleanupOutdatedCaches: true, skipWaiting: false, clientsClaim: true
    }
  })],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { output: {
      // Route on-demand grammars and KaTeX fonts into their own folders so the service worker precache can skip them.
      chunkFileNames: (chunk) => (chunk.facadeModuleId ?? '').includes('@shikijs/langs') ? 'assets/lang/[name]-[hash].js' : 'assets/[name]-[hash].js',
      assetFileNames: (asset) => (asset.names[0] ?? '').startsWith('KaTeX_') ? 'assets/katex/[name]-[hash][extname]' : 'assets/[name]-[hash][extname]',
      // Icons and shared controls ship as two chunks instead of one request per icon.
      manualChunks: (id) => id.includes('/node_modules/lucide-react/') ? 'icons' : id.includes('/src/ui/components/ui/') ? 'ui' : undefined
    } }
  }
})
