import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies: Record<string, string> }
const dependencies = Object.keys(manifest.dependencies)

export default defineConfig({
  plugins: [react()],
  build: {
    lib: { entry: 'src/ui/index.ts', formats: ['es'], fileName: 'manor-ui' },
    rollupOptions: { external: (id: string): boolean => dependencies.some((name) => id === name || id.startsWith(name + '/')) }
  }
})
