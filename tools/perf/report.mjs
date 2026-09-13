// Print Markdown tables comparing benchmark runs. Usage: node report.mjs <label> [<label> ...]
import { readFile } from 'node:fs/promises'

const labels = process.argv.slice(2)
if (labels.length === 0) throw new Error('usage: node report.mjs <label> [<label> ...]')
const runs = await Promise.all(labels.map(async (label) => JSON.parse(await readFile(`/Users/rithvik/Projects/Manor/docs/perf/${label}.json`, 'utf8'))))
const pages = Object.keys(runs[0].pages)
const metrics = [
  ['cold.lastResponseMs', 'Cold: last response (ms)'], ['cold.settledMs', 'Cold: settled (ms)'], ['cold.lcpMs', 'Cold: LCP (ms)'],
  ['warm.lastResponseMs', 'Warm: last response (ms)'], ['warm.settledMs', 'Warm: settled (ms)'],
  ['coldNetwork.requests', 'Cold: requests'], ['coldNetwork.transferKB', 'Cold: transfer (KB)'], ['coldNetwork.jsKB', 'Cold: JS (KB)'], ['coldNetwork.apiRequests', 'Cold: API calls'],
  ['cold.heapMB', 'Heap after load (MB)'], ['cold.taskMs', 'Main-thread task time (ms)']
]
const get = (run, page, path) => path.split('.').reduce((value, key) => (value == null ? value : value[key]), run.pages[page])
for (const [path, title] of metrics) {
  console.log(`\n**${title}**\n`)
  console.log(`| Page | ${labels.join(' | ')} |`)
  console.log(`|---|${labels.map(() => '---:').join('|')}|`)
  for (const page of pages) console.log(`| ${page} | ${labels.map((_, i) => { const v = get(runs[i], page, path); return v == null ? 'n/a' : v }).join(' | ')} |`)
}
console.log('\n**Navigation loop (heap MB after 3 laps, GC forced)**\n')
console.log(`| Run | First Home | Lap 1 | Lap 2 | Lap 3 |\n|---|---:|---:|---:|---:|`)
for (const [i, run] of runs.entries()) console.log(`| ${labels[i]} | ${run.navigationLoop.first.heapMB} | ${run.navigationLoop.laps.map(l => l.heapMB).join(' | ')} |`)
console.log('\n**Idle (requests in 65 s on Home)**\n')
console.log(`| Run | Requests | Endpoints |\n|---|---:|---|`)
for (const [i, run] of runs.entries()) console.log(`| ${labels[i]} | ${run.idle.requests} | ${run.idle.urls.join(', ')} |`)
