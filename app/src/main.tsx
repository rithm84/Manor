import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/index'
import { ManorApplication } from './web/ManorApplication'
import { createManorClient, createManorQueryClient } from './web/client'
import { createDesktopShell, type DesktopShell } from './web/shell/DesktopShell'
import { initializeTheme } from './web/theme'
import { preloadCompletionSound } from './ui/sound/sounds'
import { UpdateNotice } from './web/UpdateNotice'
import { logBootMilestone } from './web/shell/timing'

class AppBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error): { error: string } { return { error: error.message } }
  componentDidCatch(error: Error, info: ErrorInfo): void { console.error('Manor rendering failed', { error, componentStack: info.componentStack }) }
  render(): ReactNode {
    return this.state.error ? <main className="web-status"><h1>Something interrupted Manor</h1><p role="alert">{this.state.error}</p><button className="ui-button" onClick={() => location.reload()}>Reload</button></main> : this.props.children
  }
}

initializeTheme()
preloadCompletionSound()
const element = document.getElementById('root')
if (!element) throw new Error('Manor root element is missing')
const root = createRoot(element)
let shell: DesktopShell | null = null
try {
  shell = await createDesktopShell()
  logBootMilestone('shell', shell.launchedAt, {})
  const client = createManorClient()
  const queries = createManorQueryClient()
  root.render(<AppBoundary>
    <UpdateNotice />
    <ManorApplication client={client} queries={queries} shell={shell} />
  </AppBoundary>)
} catch (error) {
  console.error('Manor startup failed', { error })
  root.render(<main className="web-status"><h1>Manor needs configuration</h1><p role="alert">{error instanceof Error ? error.message : 'Startup failed'}</p></main>)
} finally {
  // The window opens hidden so its first frame carries the saved theme, applied above. A hidden WebKit view
  // paints nothing and fires no animation frames, so the reveal follows the render call instead of a frame, and it
  // also shows a configuration error; when the shell itself failed to build, Rust reveals the window.
  if (shell !== null) void shell.revealWindow().catch((cause: unknown) => console.error('Manor could not show its window', { cause }))
}
