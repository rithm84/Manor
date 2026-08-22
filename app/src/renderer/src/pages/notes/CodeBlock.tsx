import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

export interface CodeBlockProps {
  language: string
  code: string
}

const TOKEN_RE =
  /(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|\b(import|from|as|def|return|for|in|if|elif|else|while|class|with|lambda|None|True|False|and|or|not)\b|(\b\d+(?:\.\d+)?\b)/g

/** Minimal, quiet syntax tinting: comments, strings, keywords, numbers. */
function tint(code: string): readonly ReactNode[] {
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0
  for (const match of code.matchAll(TOKEN_RE)) {
    const index = match.index
    if (index > cursor) {
      nodes.push(code.slice(cursor, index))
    }
    const [text, comment, str, keyword, num] = match
    if (comment !== undefined) {
      nodes.push(
        <span key={key} className="ncode-comment">
          {text}
        </span>
      )
    } else if (str !== undefined) {
      nodes.push(
        <span key={key} className="ncode-str">
          {text}
        </span>
      )
    } else if (keyword !== undefined) {
      nodes.push(
        <span key={key} className="ncode-kw">
          {text}
        </span>
      )
    } else if (num !== undefined) {
      nodes.push(
        <span key={key} className="ncode-num">
          {text}
        </span>
      )
    } else {
      nodes.push(text)
    }
    key += 1
    cursor = index + text.length
  }
  if (cursor < code.length) {
    nodes.push(code.slice(cursor))
  }
  return nodes
}

const COPIED_MS = 1500

/** Notion-style code block: language label, hover copy affordance, mono body. */
export function CodeBlock({ language, code }: CodeBlockProps): ReactNode {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    return (): void => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current)
      }
    }
  }, [])

  const copy = (): void => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
    }
    timer.current = window.setTimeout(() => {
      setCopied(false)
      timer.current = null
    }, COPIED_MS)
  }

  return (
    <div className="ncode">
      <div className="ncode-head">
        <span className="ncode-lang">{language}</span>
        <button
          type="button"
          className={`ncode-copy${copied ? ' is-copied' : ''}`}
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="ncode-body">
        <code>{tint(code)}</code>
      </pre>
    </div>
  )
}
