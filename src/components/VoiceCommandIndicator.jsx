/**
 * VoiceCommandIndicator — floating mic indicator for super-admin voice commands.
 * Only rendered when user.role === 'super-admin'.
 * Shows listening state and last transcript.
 */

import { useState, useCallback } from 'react'
import { useAuthStore } from '@store/authStore.js'
import { useVoiceCommand } from '@hooks/useVoiceCommand.js'
import styles from './VoiceCommandIndicator.module.css'

const COMMAND_LABELS = {
  STATUS:      '📊 Status',
  SCAN:        '🔍 Scan',
  GHOST_MODE:  '👻 Ghost Mode',
  APPROVE_ALL: '✅ Approve All',
  SHOW_ALERTS: '🔔 Show Alerts',
  HELP:        '❓ Help',
  UNKNOWN:     '❓ Unknown',
}

/**
 * @param {{ onCommand: function }} props
 */
export function VoiceCommandIndicator({ onCommand }) {
  const user        = useAuthStore(s => s.user)
  const isSuperAdmin = user?.role === 'super-admin'

  const [enabled,     setEnabled]     = useState(false)
  const [lastCommand, setLastCommand] = useState(null)

  const handleCommand = useCallback((evt) => {
    setLastCommand(evt)
    onCommand?.(evt)
    // Clear after 3 seconds
    setTimeout(() => setLastCommand(null), 3000)
  }, [onCommand])

  const { listening, transcript, commandMode, supported } = useVoiceCommand({
    onCommand: handleCommand,
    enabled: enabled && isSuperAdmin,
  })

  // Only render for super-admin
  if (!isSuperAdmin || !supported) return null

  return (
    <div className={styles.container} aria-live="polite" aria-label="Voice command status">
      {/* Toggle button */}
      <button
        type="button"
        className={`${styles.micBtn} ${enabled ? styles.micBtnActive : ''} ${commandMode ? styles.micBtnCommand : ''}`}
        onClick={() => setEnabled(e => !e)}
        aria-label={enabled ? 'Disable voice commands' : 'Enable voice commands (Hey JARVIS)'}
        title={enabled ? 'Voice commands ON — say "Hey JARVIS [command]"' : 'Enable voice commands'}
      >
        <span className={styles.micIcon} aria-hidden="true">
          {commandMode ? '🎙' : listening ? '🎤' : '🎤'}
        </span>
        {listening && <span className={styles.pulse} aria-hidden="true" />}
      </button>

      {/* Status panel */}
      {enabled && (
        <div className={styles.panel}>
          <div className={styles.panelStatus}>
            {commandMode
              ? <span className={styles.commandMode}>🎙 Listening for command…</span>
              : listening
                ? <span className={styles.listening}>Listening — say "Hey JARVIS"</span>
                : <span className={styles.idle}>Voice ready</span>
            }
          </div>

          {transcript && (
            <div className={styles.transcript} aria-label="Transcript">
              "{transcript}"
            </div>
          )}

          {lastCommand && lastCommand.command !== 'UNKNOWN' && (
            <div className={styles.lastCommand}>
              {COMMAND_LABELS[lastCommand.command] ?? lastCommand.command}
            </div>
          )}

          <div className={styles.hint}>
            Commands: status · scan · ghost mode · approve all · show alerts
          </div>
        </div>
      )}
    </div>
  )
}
