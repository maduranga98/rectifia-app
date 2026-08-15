import { Component } from 'react'
import Icon from '../ui/Icon'

// The one place a caught error is logged. Kept as a single function so a
// monitoring service (Sentry or otherwise) can be wired in later behind this
// call instead of at every componentDidCatch site. Console only for now -
// no external SDK, and nothing here is sent anywhere.
function reportCaughtError(error, errorInfo) {
  console.error('[ErrorBoundary] caught error:', error, errorInfo?.componentStack)
}

// Brand-consistent default screen: navy/gold card on the app canvas. Error
// details only render in dev - a stack trace is internal structure that a
// production viewer (staff or reporter) has no business seeing.
function DefaultFallback({ error, errorInfo, reset }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-5 py-10">
      <div className="card w-full max-w-md p-6 text-center">
        <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-navy-50">
          <Icon name="alert" className="h-5 w-5 text-navy" />
        </div>
        <h1 className="mt-3 text-lg font-semibold text-charcoal">Something went wrong</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          We're sorry - this page ran into a problem. Reloading usually fixes it.
        </p>

        {import.meta.env.DEV && error && (
          <details className="mt-4 rounded-lg border border-line bg-navy-50/60 p-3 text-left text-xs text-muted">
            <summary className="cursor-pointer font-medium text-charcoal">Error details (dev only)</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{error.message}</pre>
            {errorInfo?.componentStack && (
              <pre className="mt-2 whitespace-pre-wrap break-words">{errorInfo.componentStack}</pre>
            )}
          </details>
        )}

        <button
          type="button"
          onClick={() => {
            reset()
            window.location.reload()
          }}
          className="btn btn-accent mt-5"
        >
          <Icon name="refresh" className="h-4 w-4" />
          Reload
        </button>
      </div>
    </div>
  )
}

// Class component: componentDidCatch has no hook equivalent. App.jsx uses
// two separate instances of this boundary - one shared across the staff
// routes, one per reporter-facing route - so a crash on either side can
// never take the other down. `fallback`, when given, is a render prop
// `(error, errorInfo, reset) => node`; omit it to get DefaultFallback.
class ErrorBoundary extends Component {
  state = { hasError: false, error: null, errorInfo: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    reportCaughtError(error, errorInfo)
    this.setState({ errorInfo })
  }

  reset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    this.props.onReset?.()
  }

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props
      if (fallback) {
        return fallback(this.state.error, this.state.errorInfo, this.reset)
      }
      return <DefaultFallback error={this.state.error} errorInfo={this.state.errorInfo} reset={this.reset} />
    }
    return this.props.children
  }
}

export default ErrorBoundary
