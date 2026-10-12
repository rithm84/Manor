/**
 * Special judges decide problems with several valid answers. The judge source defines
 * `check(args, output, expected) -> bool`, where `args` are the parsed input lines (the arguments of a
 * function case, or the operations and arguments of a class case), `output` is the submission's parsed
 * answer, and `expected` is the reference answer. Judges run in a sandbox that holds no submitted code.
 */
export interface JudgeItem { readonly input: string; readonly output: string; readonly expected: string }

export function judgeProgram(source: string): string {
  return source + `

import json as __manor_json, sys as __manor_sys
def __manor_judge():
    items = __manor_json.loads(__manor_sys.stdin.read())
    verdicts = []
    for item in items:
        try:
            output = __manor_json.loads(item['output'])
        except ValueError:
            verdicts.append(False)
            continue
        args = [__manor_json.loads(line) for line in item['input'].split('\\n') if line.strip()]
        try:
            verdicts.append(bool(check(args, output, __manor_json.loads(item['expected']))))
        except Exception:
            verdicts.append(False)
    __manor_sys.stdout.write(__manor_json.dumps(verdicts))
__manor_judge()
`
}

/** Splits judge work into runner inputs below the 1 MiB per-input limit. */
export function judgeBatches(items: readonly JudgeItem[], limitBytes: number): JudgeItem[][] {
  const batches: JudgeItem[][] = []; let current: JudgeItem[] = []; let size = 2
  for (const item of items) {
    const bytes = new TextEncoder().encode(JSON.stringify(item)).length + 1
    if (bytes + 2 > limitBytes) throw new Error('A single judged case exceeds the judge input limit')
    if (current.length > 0 && size + bytes > limitBytes) { batches.push(current); current = []; size = 2 }
    current.push(item); size += bytes
  }
  if (current.length > 0) batches.push(current)
  return batches
}
