import { readFileSync } from 'node:fs'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** The version the desktop shell also reads from this package, so About shows the build that is running. */
function packageVersion(): string {
  const parsed: unknown = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('version' in parsed) || typeof parsed.version !== 'string') {
    throw new Error('app/package.json has no string version')
  }
  return parsed.version
}

export default defineConfig({
  // The Tauri CLI owns the terminal during a desktop build; keep its output.
  clearScreen: false,
  define: { __MANOR_VERSION__: JSON.stringify(packageVersion()) },
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: { output: {
      // Icons and shared controls ship as two chunks instead of one request per icon.
      manualChunks: (id) => id.includes('/node_modules/lucide-react/') ? 'icons' : id.includes('/src/ui/components/ui/') ? 'ui' : undefined
    } }
  }
})
