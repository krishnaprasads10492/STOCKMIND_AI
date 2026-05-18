/**
 * useVoiceCommand — Web Speech API voice recognition for super-admin.
 *
 * Features:
 * - Keyword detection: "Hey JARVIS" activates command mode
 * - Commands: "status", "scan", "ghost mode", "approve all", "show alerts"
 * - Only activates when user.role === 'super-admin'
 * - Visual indicator when listening
 * - All processing is LOCAL — no audio sent to any server
 *
 * @param {{ onCommand: function, enabled: boolean }} options
 * @returns {{ listening: boolean, transcript: string, supported: boolean, startListening: function, stopListening: function, commandMode: boolean }}
 */

import { useState, useEffect, useRef, useCallback } from 'react'

const WAKE_WORD = 'hey jarvis'

const COMMANDS = {
  'status':      'STATUS',
  'scan':        'SCAN',
  'force scan':  'SCAN',
  'ghost mode':  'GHOST_MODE',
  'approve all': 'APPROVE_ALL',
  'show alerts': 'SHOW_ALERTS',
  'alerts':      'SHOW_ALERTS',
  'help':        'HELP',
}

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function useVoiceCommand({ onCommand, enabled = true }) {
  const [listening,    setListening]    = useState(false)
  const [transcript,   setTranscript]   = useState('')
  const [commandMode,  setCommandMode]  = useState(false)
  const [supported,    setSupported]    = useState(false)

  const recognitionRef  = useRef(null)
  const commandModeRef  = useRef(false)
  const commandTimerRef = useRef(null)
  const enabledRef      = useRef(enabled)

  useEffect(() => { enabledRef.current = enabled }, [enabled])

  // Check support on mount
  useEffect(() => {
    setSupported(!!getSpeechRecognition())
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* ignore */ }
    }
    setListening(false)
    setCommandMode(false)
    commandModeRef.current = false
    clearTimeout(commandTimerRef.current)
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition || !enabledRef.current) return

    // Clean up any existing instance
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch { /* ignore */ }
    }

    const recognition = new SpeechRecognition()
    recognition.continuous     = true
    recognition.interimResults = true
    recognition.lang           = 'en-US'
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setListening(true)
      setTranscript('')
    }

    recognition.onend = () => {
      setListening(false)
      // Auto-restart if still enabled (continuous listening)
      if (enabledRef.current) {
        setTimeout(() => {
          if (enabledRef.current) startListening()
        }, 500)
      }
    }

    recognition.onerror = (event) => {
      // Ignore no-speech errors — they're normal
      if (event.error === 'no-speech') return
      if (event.error === 'aborted') return
      setListening(false)
    }

    recognition.onresult = (event) => {
      let finalText = ''
      let interimText = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }

      const text = (finalText || interimText).toLowerCase().trim()
      setTranscript(text)

      if (!commandModeRef.current) {
        // Check for wake word
        if (text.includes(WAKE_WORD)) {
          commandModeRef.current = true
          setCommandMode(true)
          // Extract command after wake word
          const afterWake = text.split(WAKE_WORD).pop()?.trim() ?? ''
          if (afterWake) {
            processCommand(afterWake)
          } else {
            // Wait 3 seconds for a command
            clearTimeout(commandTimerRef.current)
            commandTimerRef.current = setTimeout(() => {
              commandModeRef.current = false
              setCommandMode(false)
            }, 3000)
          }
        }
      } else if (finalText) {
        // We're in command mode — process the command
        clearTimeout(commandTimerRef.current)
        processCommand(finalText.toLowerCase().trim())
        commandModeRef.current = false
        setCommandMode(false)
      }
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch { /* ignore start errors */ }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function processCommand(text) {
    const cleaned = text.replace(/[^a-z\s]/g, '').trim()

    for (const [phrase, command] of Object.entries(COMMANDS)) {
      if (cleaned.includes(phrase)) {
        onCommand?.({ command, transcript: text })
        return
      }
    }

    // Unknown command — still notify so UI can show feedback
    onCommand?.({ command: 'UNKNOWN', transcript: text })
  }

  // Auto-start when enabled changes
  useEffect(() => {
    if (!supported) return
    if (enabled) {
      startListening()
    } else {
      stopListening()
    }
    return () => {
      stopListening()
    }
  }, [enabled, supported]) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    listening,
    transcript,
    commandMode,
    supported,
    startListening,
    stopListening,
  }
}
