/** Real-provider acceptance check. Every disposable sandbox is deleted in finally. */
import { BlaxelClient } from '../../supabase/functions/_shared/blaxelClient.ts'

const image = Deno.args[0]
if (!image) throw new Error('Supply the published runtime image identifier')
const key = Deno.env.get('BLAXEL_API_KEY')
const workspace = Deno.env.get('BLAXEL_WORKSPACE')
if (!key || !workspace) throw new Error('BLAXEL_API_KEY and BLAXEL_WORKSPACE are required')
const client = new BlaxelClient(key, workspace, image)
const sources: Readonly<Record<string, string>> = {
  cpp: '#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}',
  c: '#include <stdio.h>\nint main(void){long long a,b;if(scanf("%lld%lld",&a,&b)!=2)return 1;printf("%lld\\n",a+b);return 0;}',
  python: 'import sys\na,b=map(int,sys.stdin.read().split())\nprint(a+b)\n',
  javascript: 'const fs=require("fs");const [a,b]=fs.readFileSync(0,"utf8").trim().split(/\\s+/).map(Number);console.log(a+b);',
  java: 'import java.util.*;public class Main{public static void main(String[] args){Scanner s=new Scanner(System.in);long a=s.nextLong(),b=s.nextLong();System.out.println(a+b);}}',
  go: 'package main\nimport("fmt";"os";"bufio")\nfunc main(){var a,b int64;fmt.Fscan(bufio.NewReader(os.Stdin),&a,&b);fmt.Println(a+b)}',
}
const checks: { name: string; passed: boolean; durationMs: number }[] = []
for (const [language, code] of Object.entries(sources)) {
  const name = 'manor-judge-' + crypto.randomUUID().replaceAll('-', '')
  try {
    const sandbox = await client.createSandbox(name, 'judge')
    const result = await client.judge(sandbox, { language, code, cases: [{ id: 'positive', input: '40 2\n' }, { id: 'negative', input: '-4 2\n' }] })
    const passed = (result.compile === null || result.compile.exitCode === 0) && result.cases.length === 2 && result.cases[0].process.stdout.trim() === '42' && result.cases[1].process.stdout.trim() === '-2'
    if (!passed) throw new Error(`${language} real execution failed: ${JSON.stringify(result)}`)
    checks.push({ name: language, passed, durationMs: result.cases.reduce((sum, test) => sum + test.process.durationMs, 0) })
    console.log(JSON.stringify(checks.at(-1)))
  } finally { await client.deleteSandbox(name) }
}
const adversarial: readonly { name: string; code: string; verify: (result: Awaited<ReturnType<BlaxelClient['judge']>>) => boolean }[] = [
  { name: 'runtime-error', code: 'raise RuntimeError("intentional")', verify: result => result.cases[0].process.exitCode !== 0 },
  { name: 'timeout', code: 'while True: pass', verify: result => result.cases[0].process.timedOut },
  { name: 'output-limit', code: 'while True: print("x"*8192)', verify: result => result.cases[0].process.outputLimit },
  { name: 'network-isolation', code: 'import socket\ns=socket.socket()\ns.settimeout(1)\ntry:\n s.connect(("1.1.1.1",443))\n print("network-accessible")\nexcept OSError:\n print("blocked")', verify: result => result.cases[0].process.stdout.trim() === 'blocked' },
  { name: 'process-limit', code: 'import subprocess\nchildren=[]\ntry:\n for _ in range(110): children.append(subprocess.Popen(["sleep","30"]))\n print("unlimited")\nexcept BlockingIOError:\n print("limited")\nfinally:\n for child in children: child.kill()\n for child in children: child.wait()', verify: result => result.cases[0].process.stdout.trim() === 'limited' },
  { name: 'credential-isolation', code: 'import os\nprint(os.getuid())\nprint(any("KEY" in k or "TOKEN" in k or "BLAXEL" in k for k in os.environ))\nprint(os.path.exists("/bl/metadata"))', verify: result => result.cases[0].process.stdout.trim() === '10001\nFalse\nFalse' },
]
for (const check of adversarial) {
  const name = 'manor-judge-' + crypto.randomUUID().replaceAll('-', '')
  try {
    const sandbox = await client.createSandbox(name, 'judge')
    const result = await client.judge(sandbox, { language: 'python', code: check.code, cases: [{ id: check.name, input: '' }] })
    if (!check.verify(result)) throw new Error(`${check.name} failed: ${JSON.stringify(result)}`)
    console.log(JSON.stringify({ name: check.name, passed: true }))
  } finally { await client.deleteSandbox(name) }
}
const isolationName = 'manor-judge-' + crypto.randomUUID().replaceAll('-', '')
try {
  const sandbox = await client.createSandbox(isolationName, 'judge')
  const result = await client.judge(sandbox, { language: 'python', code: 'import sys\nfrom pathlib import Path\nvalue=sys.stdin.read().strip()\nif value=="hidden-marker":\n Path("/tmp/private-input").write_text(value)\n try: Path("private-input").write_text(value)\n except OSError: pass\n print("stored-in-scratch")\nelse:\n print("leaked" if Path("/tmp/private-input").exists() or Path("private-input").exists() else "isolated")', cases: [{ id: 'hidden', input: 'hidden-marker' }, { id: 'public', input: 'public-probe' }] })
  if (result.cases.length !== 2 || result.cases[1].process.stdout.trim() !== 'isolated') throw new Error('Case filesystem isolation failed: ' + JSON.stringify(result))
  console.log(JSON.stringify({ name: 'case-filesystem-isolation', passed: true }))
} finally { await client.deleteSandbox(isolationName) }
console.log(JSON.stringify({ passed: checks.length + adversarial.length + 1 }))
