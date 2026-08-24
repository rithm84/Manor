import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['@blocknote/math-block', 'katex']
      }
    }
  }
})
