import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

import { Button } from '../components/ui'

interface PageErrorBoundaryProps {
  /** Remounts the boundary when the route changes, clearing a stale error. */
  resetKey: string
  children: ReactNode
}

interface PageErrorBoundaryState {
  error: Error | null
}

/**
 * A failed render must not blank the window. React unmounts the whole tree
 * when nothing catches, which reads as a dead app; this keeps the chrome,
 * names what broke, and offers a way back.
 */
export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  constructor(props: PageErrorBoundaryProps) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { error }
  }

  componentDidUpdate(previous: PageErrorBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error !== null) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Manor page render failed', { error, componentStack: info.componentStack })
  }

  render(): ReactNode {
    const { error } = this.state
    if (error === null) return this.props.children
    return (
      <div className="page-crash" role="alert">
        <h2 className="page-crash-title">This page could not be drawn</h2>
        <p className="page-crash-body">
          The rest of Manor is still working. Try again, or move to another page.
        </p>
        <pre className="page-crash-detail">{error.message}</pre>
        <Button variant="primary" onClick={() => this.setState({ error: null })}>
          Try again
        </Button>
      </div>
    )
  }
}
