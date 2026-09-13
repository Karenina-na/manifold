import type { ErrorInfo, ReactNode } from 'react'
import { Component } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { RotateCcw } from 'lucide-react'
import { createTraceId, reportClientError } from '../lib/observability'

type Props = { children: ReactNode; t: TFunction }
type State = { error: Error | null; traceId: string | null }

class ErrorBoundaryImpl extends Component<Props, State> {
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
    const { t } = this.props
    return <main className="error-shell"><section className="error-panel" role="alert"><p className="kicker">{t('errorBoundary.kicker')}</p><h1>{t('errorBoundary.title')}</h1><p className="error-copy">{t('errorBoundary.copy')}</p><button className="button button-primary" type="button" onClick={() => window.location.reload()}><RotateCcw size={16} /> {t('errorBoundary.reload')}</button><small>{t('errorBoundary.reference', { id: this.state.traceId })}</small></section></main>
  }
}

export function AdminErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return <ErrorBoundaryImpl t={t}>{children}</ErrorBoundaryImpl>
}
