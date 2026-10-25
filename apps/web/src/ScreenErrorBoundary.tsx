/**
 * No screen or window may blank the whole app (walkthrough, Oct 24, 2026: a
 * Salesman's pipeline card turned the app white). A screen or window that
 * fails to draw shows a plain message instead, with Go back and Reload, and
 * the error goes to the server as an automatic feedback (Feedback page, the
 * owner's bell, scripts/feedback-report.ts), sent through the save queue so it
 * gets there on weak signal.
 *
 *   <ScreenErrorBoundary name="Sales Pipeline" resetKey={path}>...</ScreenErrorBoundary>
 *   <ScreenErrorBoundary name="Card window" onBack={close} window>...</ScreenErrorBoundary>
 *
 * The work itself is safe: every change is saved (or waiting to send) the
 * moment it is made, before anything is drawn.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { sendFeedback } from './feedback'

/** One report per error per app load: a screen that fails on every redraw is reported once. */
const reported = new Set<string>()

export function reportScreenError(name: string, error: unknown, componentStack = ''): void {
  const message = String((error as Error)?.message ?? error).slice(0, 300)
  const key = `${name}|${message}`
  if (reported.has(key)) return
  reported.add(key)
  // The first lines of the component stack say which part of the screen failed.
  const where = componentStack.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 8).join(' < ')
  const text = `Automatic report: the ${name} screen could not be shown.\nError: ${message}${where ? `\nWhere: ${where}` : ''}`.slice(0, 4900)
  void sendFeedback({ text, screenshot: null, path: window.location.pathname + window.location.search }, 0).catch(() => {})
}

interface Props {
  /** The screen or window, in plain words ("Sales Pipeline", "Card window"). */
  name: string
  children: ReactNode
  /** Closes the window (a window's Go back). Without it, Go back is the browser's Back. */
  onBack?: () => void
  /** A window drawn over the page: the message is drawn as a window too. */
  window?: boolean
  /** When this changes (another screen, another record), the screen is tried again. */
  resetKey?: unknown
}

interface State { error: unknown; key: unknown }

export default class ScreenErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error ?? new Error('Unknown error') }
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // Moved to another screen or record: try drawing again.
    if (props.resetKey !== state.key) return { key: props.resetKey, error: null }
    return null
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(`[screen] ${this.props.name} could not be shown:`, error)
    reportScreenError(this.props.name, error, info?.componentStack ?? '')
  }

  private back = () => {
    const { onBack } = this.props
    this.setState({ error: null })
    if (onBack) onBack()
    else window.history.back()
  }

  render() {
    if (!this.state.error) return this.props.children
    const box = (
      <div role="alert" data-screen-error={this.props.name} className="bg-white rounded-2xl border border-gray-200 p-6 max-w-md w-full text-center space-y-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">Something went wrong on this screen.</h2>
        <p className="text-base text-gray-700">Your work is saved. Go back, or reload the app. The office has been told.</p>
        <div className="flex gap-3 justify-center flex-wrap">
          <button type="button" className="btn btn-secondary min-h-[48px] px-6" onClick={this.back} data-screen-error-back>Go back</button>
          <button type="button" className="btn btn-primary min-h-[48px] px-6" onClick={() => window.location.reload()} data-screen-error-reload>Reload</button>
        </div>
      </div>
    )
    if (this.props.window) {
      return <div className="fixed inset-0 z-[300] bg-black/40 flex items-center justify-center p-4">{box}</div>
    }
    return <div className="flex justify-center py-10 px-2">{box}</div>
  }
}
