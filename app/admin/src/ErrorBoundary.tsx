import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { RotateCcw } from 'lucide-react'
import { createTraceId, reportClientError } from './observability'

type Props = { children: ReactNode }
type State = { error: Error | null; traceId: string | null }

export class AdminErrorBoundary extends Component<Props, State> {
  state: State = { error: null, traceId: null }

  static getDerivedStateFromError(error: Error): State {
    return { error, traceId: createTraceId() }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const traceId = this.state.traceId ?? createTraceId()
    reportClientError(error, traceId, 'admin.app', info.componentStack ?? undefined)
  }

  render() {
    if (!this.state.error || !this.state.traceId) return this.props.children
    return <main className="error-shell"><section className="error-panel" role="alert"><p className="kicker">Workspace interruption</p><h1>The workspace needs another pass.</h1><p className="error-copy">The management view stopped unexpectedly. Core data remains unchanged.</p><button className="button button-primary" type="button" onClick={() => window.location.reload()}><RotateCcw size={16} /> Reload workspace</button><small>Reference: {this.state.traceId}</small></section></main>
  }
}
