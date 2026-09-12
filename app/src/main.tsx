import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './ui/index'
import { ManorApplication } from './web/ManorApplication'
import { createManorClient, createManorQueryClient } from './web/client'
import { initializeTheme } from './web/theme'
import { preloadCompletionSound } from './ui/sound/sounds'
import { AppUpdateNotice } from './web/AppUpdateNotice'

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
try {
  const client = createManorClient()
  const queries = createManorQueryClient()
  root.render(<AppBoundary><AppUpdateNotice /><ManorApplication client={client} queries={queries} /></AppBoundary>)
} catch (error) {
  console.error('Manor startup failed', { error })
  root.render(<main className="web-status"><h1>Manor needs configuration</h1><p role="alert">{error instanceof Error ? error.message : 'Startup failed'}</p></main>)
}
