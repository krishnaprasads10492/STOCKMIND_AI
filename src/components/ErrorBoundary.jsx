/**
 * ErrorBoundary — catches render errors and prevents full-page crashes.
 *
 * Implements the operational safety requirement (Section 16.5.2):
 * a component failure must not take down the entire dashboard.
 */

import { Component } from 'react'
import styles from './ErrorBoundary.module.css'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, errorMessage: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, errorMessage: error?.message ?? 'Unknown error' }
  }

  componentDidCatch(error, info) {
    // In production, send to your error tracking service (e.g. Sentry)
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className={styles.container} role="alert">
          <span className={styles.icon} aria-hidden="true">⚡</span>
          <h2 className={styles.title}>Something went wrong</h2>
          <p className={styles.message}>
            {this.props.fallbackMessage ??
              'This section failed to load. Other parts of the platform are unaffected.'}
          </p>
          <button
            className={styles.retry}
            onClick={() => this.setState({ hasError: false, errorMessage: null })}
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
