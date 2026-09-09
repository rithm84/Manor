import { readdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('.', import.meta.url))
const diagrams = resolve(root, '../../docs/diagrams')
const server = await createServer({ root, server: { host: '127.0.0.1', port: 4179, strictPort: true } })
await server.listen()
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => { throw error })
  await page.goto('http://127.0.0.1:4179')
  await page.waitForFunction(() => typeof window.renderScene === 'function')
  for (const name of (await readdir(diagrams)).filter((name) => name.endsWith('.excalidraw')).sort()) {
    const scene = JSON.parse(await readFile(resolve(diagrams, name), 'utf8'))
    const result = await page.evaluate(async (scene) => window.renderScene(scene), scene)
    await writeFile(resolve(diagrams, name), JSON.stringify(result.scene, null, 2) + '\n')
    await writeFile(resolve(diagrams, name.replace('.excalidraw', '.svg')), result.svg + '\n')
    await page.locator('#preview svg').screenshot({ path: resolve('/private/tmp', `manor-${name.replace('.excalidraw', '.png')}`) })
    console.log(`Exported ${name}: ${result.scene.elements.length} elements`)
  }
} finally {
  await browser.close()
  await server.close()
}
