import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'

import { browserBridgePlugin } from './src/main/devBridgePlugin'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), browserBridgePlugin()]
  }
})
