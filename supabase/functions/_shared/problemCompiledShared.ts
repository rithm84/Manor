/** Helpers the compiled-language drivers share: the types an interface decodes and their mangled decoder names. */
import type { CodecInterface, HarnessType, NodeKind, ProblemInterface } from './problemInterface.ts'
import { nodeKindOf, typeOf, typeTexts } from './problemInterface.ts'
import { driverMeta } from './problemDriverMeta.ts'

function interfaceTypes(spec: ProblemInterface): HarnessType[] {
  const all: HarnessType[] = []
  const add = (t: HarnessType): void => { if (t.tag === 'array' || t.tag === 'list') add(t.item); all.push(t) }
  typeTexts(spec).forEach(text => add(typeOf(text)))
  return all
}
export function mangle(t: HarnessType): string { return t.tag === 'array' ? mangle(t.item) + '_A' : t.tag === 'list' ? mangle(t.item) + '_L' : t.tag === 'scalar' || t.tag === 'node' || t.tag === 'record' || t.tag === 'object' ? t.name : t.tag === 'nested' ? 'NestedInteger' : t.tag === 'buffer' ? 'buffer' : t.int ? 'intCallback' : 'callback' }
/** Every type a decoder exists for, including `int` and the field types of record classes. */
export function decoderTypes(spec: ProblemInterface): HarnessType[] {
  const seen = new Map<string, HarnessType>()
  const meta = driverMeta(spec)
  const extra = [typeOf('int'), ...(Object.keys(meta.records).length > 0 ? [typeOf('list<int>')] : []), ...Object.values(meta.kinds).flatMap(k => k.values.map(([, t]) => typeOf(t)))]
  for (const t of [...extra, ...interfaceTypes(spec)]) if (!seen.has(mangle(t))) seen.set(mangle(t), t)
  return [...seen.values()]
}
export function nodeEncoder(spec: ProblemInterface, code: (kind: NodeKind) => { readonly encode: string }): string { const kind = nodeKindOf(spec); return kind === null ? '' : code(kind).encode + '\n' }
/** Separate instances unless the problem shares one, as LeetCode calls each codec. */
export function codecInstances(spec: CodecInterface, create: string): { readonly ser: string; readonly deser: string } { return { ser: create, deser: spec.sharedInstance ? 'ser' : create } }
