import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

import { browserBridgePlugin } from './src/main/devBridgePlugin'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    server:
      process.env.PORT === undefined
        ? undefined
        : { port: Number(process.env.PORT), strictPort: true },
    plugins: [react(), browserBridgePlugin()]
  }
})
