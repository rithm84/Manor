import { memo } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface MarkdownNode { type: string; value?: string; children?: MarkdownNode[]; data?: { hName?: string } }

const superscriptDigits: Readonly<Record<string, string>> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' }
const subscriptDigits: Readonly<Record<string, string>> = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', '-': '₋' }
function mapDigits(value: string, table: Readonly<Record<string, string>>): string { return [...value].map(character => table[character]).join('') }
function scriptNode(tag: 'sup' | 'sub', value: string): MarkdownNode { return { type: 'emphasis', data: { hName: tag }, children: [{ type: 'text', value }] } }

/** `10^5` in prose becomes a real superscript; the operator stays when its exponent is not a number. */
function splitPowers(value: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = []
  let last = 0
  for (const match of value.matchAll(/([0-9A-Za-z)\]])\^(-?\d+|\{[^}\s]{1,20}\})/g)) {
    const at = match.index + match[1].length
    nodes.push({ type: 'text', value: value.slice(last, at) }, scriptNode('sup', match[2].replace(/^\{|\}$/g, '')))
    last = match.index + match[0].length
  }
  if (nodes.length === 0) return [{ type: 'text', value }]
  nodes.push({ type: 'text', value: value.slice(last) })
  return nodes.filter(node => node.type !== 'text' || node.value !== '')
}

/** Inline code cannot hold elements, so its numeric powers use superscript characters. */
function inlineCodePowers(value: string): string {
  return value
    .replace(/<sup>(-?\d+)<\/sup>/g, (_, digits: string) => mapDigits(digits, superscriptDigits))
    .replace(/<sub>(-?\d+)<\/sub>/g, (_, digits: string) => mapDigits(digits, subscriptDigits))
    .replace(/(\d)\^(-?\d+)/g, (_, base: string, digits: string) => base + mapDigits(digits, superscriptDigits))
}

function rewriteChildren(children: readonly MarkdownNode[]): MarkdownNode[] {
  const result: MarkdownNode[] = []
  for (let index = 0; index < children.length; index += 1) {
    const node = children[index]
    const open = node.type === 'html' ? /^<(sup|sub)>$/i.exec(node.value ?? '') : null
    const inner = children[index + 1]
    const close = children[index + 2]
    if (open !== null && inner?.type === 'text' && close?.type === 'html' && close.value?.toLowerCase() === `</${open[1].toLowerCase()}>`) {
      result.push(scriptNode(open[1].toLowerCase() === 'sup' ? 'sup' : 'sub', inner.value ?? ''))
      index += 2
    } else if (node.type === 'text') result.push(...splitPowers(node.value ?? ''))
    else if (node.type === 'inlineCode') result.push({ ...node, value: inlineCodePowers(node.value ?? '') })
    else result.push(node.children === undefined ? node : { ...node, children: rewriteChildren(node.children) })
  }
  return result
}

/** LeetCode statements write exponents as `<sup>` markup or `^`; both render as clean superscripts. */
function remarkExponents() {
  return (tree: MarkdownNode): void => { if (tree.children !== undefined) tree.children = rewriteChildren(tree.children) }
}

const plugins = [remarkGfm, remarkExponents]

/** Imported markup renders without executing embedded HTML or scripts. */
export const ProblemMarkdown = memo(function ProblemMarkdown({ text }: { text: string }): ReactNode {
  return <div className="problem-markdown"><ReactMarkdown remarkPlugins={plugins} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a> }}>{text}</ReactMarkdown></div>
})
