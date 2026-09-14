import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // The Tauri CLI owns the terminal during a desktop build; keep its output.
  clearScreen: false,
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
