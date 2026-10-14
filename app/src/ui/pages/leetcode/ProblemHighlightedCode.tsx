import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { ProblemLanguage } from '../../../shared/problemExecution'
import { useNoteTheme } from '../notes/useNoteTheme'
import { errorMessage } from './leetCodeModel'

interface Props { readonly code: string; readonly language: ProblemLanguage; readonly tabSize: number; readonly className: string; readonly testId?: string }

/** Read-only code with the editor's grammar and theme; the plain text shows until highlighting arrives. */
export function ProblemHighlightedCode({ code, language, tabSize, className, testId }: Props): ReactNode {
  const theme = useNoteTheme()
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setHtml(null)
    void import('./problemCodeEditorRuntime').then(runtime => runtime.colorizeProblemCode(code, language, theme, tabSize)).then(next => { if (!cancelled) setHtml(next) }).catch(failure => console.error('Code highlighting failed', { language, error: errorMessage(failure) }))
    return () => { cancelled = true }
  }, [code, language, theme, tabSize])
  // Monaco's colorizer escapes the source and emits only its token spans.
  return html === null ? <pre className={className} data-testid={testId} style={{ tabSize }}>{code}</pre> : <pre className={className} data-testid={testId} style={{ tabSize }} dangerouslySetInnerHTML={{ __html: html }} />
}
