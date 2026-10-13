/**
 * Real-provider acceptance check. Every check runs in one standing judge sandbox, as an account's jobs do, so the
 * adversarial checks also prove that a job cannot affect the jobs after it. The sandbox is deleted in finally.
 * Inspections run as root through the sandbox's process API to see what a job left behind outside its jail.
 */
import { BlaxelClient, type BlaxelSandbox, type JudgeOutput } from '../../supabase/functions/_shared/blaxelClient.ts'
import { z } from '../../supabase/functions/_shared/integrationRuntime.ts'

const image = Deno.args[0]
if (!image) throw new Error('Supply the published runtime image identifier')
const key = Deno.env.get('BLAXEL_API_KEY')
const workspace = Deno.env.get('BLAXEL_WORKSPACE')
if (!key || !workspace) throw new Error('BLAXEL_API_KEY and BLAXEL_WORKSPACE are required')
const client = new BlaxelClient(key, workspace, image)
const owner = crypto.randomUUID()

/** Runs a root command in the sandbox, outside every jail, and returns its standard output. */
async function inspect(sandbox: BlaxelSandbox, command: string): Promise<string> {
  const response = await fetch(new URL('/process', sandbox.metadata.url), { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'X-Blaxel-Authorization': `Bearer ${key}`, 'X-Blaxel-Workspace': workspace!, 'Content-Type': 'application/json' }, body: JSON.stringify({ command, workingDir: '/', waitForCompletion: true, timeout: 50 }) })
  if (!response.ok) throw new Error(`Inspection ${command} returned HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`)
  const result = z.object({ exitCode: z.number(), stdout: z.string(), stderr: z.string() }).parse(await response.json())
  if (result.exitCode !== 0) throw new Error(`Inspection ${command} exited ${result.exitCode}: ${result.stderr.slice(0, 1000)}`)
  return result.stdout
}
const jailProcesses = (sandbox: BlaxelSandbox): Promise<string> => inspect(sandbox, 'ps -o pid=,args= -u 10001 || true')
const jailFiles = (sandbox: BlaxelSandbox): Promise<string> => inspect(sandbox, 'find / /dev/shm -xdev -uid 10001 -not -path /workspace -not -path "/home/runner*" 2>/dev/null || true')
/** The marker is assembled inside the shell so the inspection's own command line, which the process API records, never contains it. */
const filesContaining = (sandbox: BlaxelSandbox, prefix: string, suffix: string): Promise<string> => inspect(sandbox, `grep -rIl -s -e "$(printf '%s%s' ${prefix} ${suffix})" / --exclude-dir=proc --exclude-dir=sys --exclude-dir=dev --exclude-dir=usr --exclude-dir=opt || true`)

const sources: Readonly<Record<string, string>> = {
  cpp: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
  c: '#include <stdio.h>\nint main(void){long long a,b;if(scanf("%lld%lld",&a,&b)!=2)return 1;printf("%lld\\n",a+b);return 0;}',
  python: 'import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n',
  javascript: 'const fs=require("fs");const [a,b]=fs.readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);console.log(a+b);',
  java: 'import java.util.*;public class Main{public static void main(String[] args){Scanner s=new Scanner(System.in);long a=s.nextLong(),b=s.nextLong();System.out.println(a+b);}}',
  go: 'package main\nimport("fmt";"os";"bufio")\nfunc main(){var a,b int64;fmt.Fscan(bufio.NewReader(os.Stdin),&a,&b);fmt.Println(a+b)}',
}
const adversarial: readonly { name: string; code: string; verify: (result: JudgeOutput) => boolean }[] = [
  { name: 'runtime-error', code: 'raise RuntimeError("intentional")', verify: result => result.cases[0].process.exitCode !== 0 },
  { name: 'timeout', code: 'while True: pass', verify: result => result.cases[0].process.timedOut },
  { name: 'output-limit', code: 'while True: print("x"*8192)', verify: result => result.cases[0].process.outputLimit },
  { name: 'network-isolation', code: 'import socket\ns=socket.socket()\ns.settimeout(1)\ntry:\n s.connect(("1.1.1.1",443))\n print("network-accessible")\nexcept OSError:\n print("blocked")', verify: result => result.cases[0].process.stdout.trim() === 'blocked' },
  // The sandbox API listens on port 8080 and carries every job's input, so the jail must not reach it.
  { name: 'sandbox-api-isolation', code: 'import socket\nfor port in (8080, 443, 80):\n s=socket.socket()\n s.settimeout(1)\n try:\n  s.connect(("127.0.0.1",port))\n  print("reachable",port)\n except OSError:\n  pass\nprint("blocked")', verify: result => result.cases[0].process.stdout.trim() === 'blocked' },
  { name: 'process-limit', code: 'import subprocess\nchildren=[]\ntry:\n for _ in range(110): children.append(subprocess.Popen(["sleep","30"]))\n print("unlimited")\nexcept BlockingIOError:\n print("limited")\nfinally:\n for child in children: child.kill()\n for child in children: child.wait()', verify: result => result.cases[0].process.stdout.trim() === 'limited' },
  { name: 'credential-isolation', code: 'import os\nprint(os.getuid())\nprint(any("KEY" in k or "TOKEN" in k or "BLAXEL" in k for k in os.environ))\nprint(os.path.exists("/bl/metadata"))', verify: result => result.cases[0].process.stdout.trim() === '10001\nFalse\nFalse' },
]
// Toolchain files a later job executes or links; a job that could change them would compromise every job after it.
const guarded = ['/usr/bin/python3.12', '/usr/lib/python3.12/os.py', '/usr/local/go/bin/go', '/usr/local/go/pkg/linux_amd64/fmt.a', '/usr/include/x86_64-linux-gnu/c++/13/bits/stdc++.h.gch', '/usr/lib/manor/javac.jsa', '/usr/bin/node', '/opt/manor/runner.py']
const tamper = `import os, subprocess, time
written = []
for path in ${JSON.stringify(['/tmp/planted', '/workspace/planted', '/var/tmp/planted', '/dev/shm/planted', '/home/runner/planted', '/var/lib/manor/jobs/planted', '/etc/planted', ...guarded])}:
    try:
        with open(path, "ab") as handle: handle.write(b"planted")
        written.append(path)
    except OSError:
        pass
# Detached children try to outlive the job: a new session, a double fork, and a plain background process.
subprocess.Popen(["sleep", "300"], start_new_session=True)
if os.fork() == 0:
    os.setsid()
    if os.fork() == 0:
        time.sleep(300)
    os._exit(0)
subprocess.Popen(["sh", "-c", "while true; do echo planted > /tmp/heartbeat; sleep 0.2; done"])
print("written", written)
`
const checkLater = `import os, hashlib
for path in ["/tmp/planted", "/workspace/planted", "/tmp/heartbeat"]:
    if os.path.exists(path): print("leaked", path)
print("isolated")
`

const checks: string[] = []
const passed = (name: string, detail: Record<string, string | number | boolean | readonly string[]>): void => { checks.push(name); console.log(JSON.stringify({ name, passed: true, ...detail })) }
let sandbox = await client.warmSandbox('judge', owner)
try {
  for (const [language, code] of Object.entries(sources)) {
    const started = Date.now()
    const result = await client.judge(sandbox, { language, code, cases: [{ id: 'positive', input: '40 2\n' }, { id: 'negative', input: '-4 2\n' }] })
    const ok = (result.compile === null || result.compile.exitCode === 0) && result.cases.length === 2 && result.cases[0].process.stdout.trim() === '42' && result.cases[1].process.stdout.trim() === '-2' && result.tainted.length === 0
    if (!ok) throw new Error(`${language} real execution failed: ${JSON.stringify(result)}`)
    passed(language, { compileMs: result.compile?.durationMs ?? 0, runMs: result.cases.reduce((sum, test) => sum + test.process.durationMs, 0), jobMs: Date.now() - started })
  }
  for (const check of adversarial) {
    const result = await client.judge(sandbox, { language: 'python', code: check.code, cases: [{ id: check.name, input: '' }] })
    if (!check.verify(result)) throw new Error(`${check.name} failed: ${JSON.stringify(result)}`)
    passed(check.name, { tainted: result.tainted })
  }
  const isolation = await client.judge(sandbox, { language: 'python', code: 'import sys\nfrom pathlib import Path\nvalue=sys.stdin.read().strip()\nif value=="hidden-marker":\n Path("/tmp/private-input").write_text(value)\n try: Path("private-input").write_text(value)\n except OSError: pass\n print("stored-in-scratch")\nelse:\n print("leaked" if Path("/tmp/private-input").exists() or Path("private-input").exists() else "isolated")', cases: [{ id: 'hidden', input: 'hidden-marker' }, { id: 'public', input: 'public-probe' }] })
  if (isolation.cases.length !== 2 || isolation.cases[1].process.stdout.trim() !== 'isolated') throw new Error('Case filesystem isolation failed: ' + JSON.stringify(isolation))
  passed('case-filesystem-isolation', {})

  const before = await inspect(sandbox, `sha256sum ${guarded.join(' ')}`)
  const tampered = await client.judge(sandbox, { language: 'python', code: tamper, cases: [{ id: 'tamper', input: '' }] })
  const written = tampered.cases[0].process.stdout
  // Writes to the jail's own /tmp and /dev/shm succeed and vanish with the jail; anything shared must refuse them.
  if (!written.startsWith('written') || [...guarded, '/workspace/', '/var/', '/home/', '/etc/'].some(path => written.includes(path))) throw new Error('A job wrote outside its scratch space: ' + JSON.stringify(tampered))
  const survivors = await jailProcesses(sandbox)
  if (survivors.trim() !== '') throw new Error('Processes from an earlier job survived it: ' + survivors)
  const planted = await jailFiles(sandbox)
  if (planted.trim() !== '') throw new Error('An earlier job left files in the sandbox: ' + planted)
  if (await inspect(sandbox, `sha256sum ${guarded.join(' ')}`) !== before) throw new Error('A job changed a toolchain file')
  passed('background-processes-and-files', { written: written.trim(), tainted: tampered.tainted })
  if (tampered.tainted.length > 0) {
    // A tainted sandbox is deleted by the worker; the next job then runs in a fresh one.
    await client.deleteSandbox(sandbox.metadata.name)
    sandbox = await client.warmSandbox('judge', owner)
  }
  const later = await client.judge(sandbox, { language: 'python', code: checkLater, cases: [{ id: 'later', input: '' }] })
  if (later.cases[0].process.stdout.trim() !== 'isolated' || later.tainted.length > 0) throw new Error('An earlier job affected a later one: ' + JSON.stringify(later))
  passed('later-job-unaffected', {})

  const [prefix, suffix] = ['hidden-' + crypto.randomUUID().slice(0, 8), crypto.randomUUID().slice(0, 8)]
  const echoed = await client.judge(sandbox, { language: 'python', code: 'import sys\nprint(sys.stdin.read())', cases: [{ id: 'hidden', input: prefix + suffix }] })
  if (!echoed.cases[0].process.stdout.includes(prefix + suffix)) throw new Error('The hidden input did not reach the program: ' + JSON.stringify(echoed))
  const remaining = await filesContaining(sandbox, prefix, suffix)
  const jobs = await inspect(sandbox, 'ls -A /var/lib/manor/jobs')
  if (remaining.trim() !== '' || jobs.trim() !== '') throw new Error(`Hidden test data remained after its job: ${remaining} ${jobs}`)
  passed('hidden-tests-removed', {})
  console.log(JSON.stringify({ passed: checks.length }))
} finally { await client.deleteSandbox(sandbox.metadata.name) }
