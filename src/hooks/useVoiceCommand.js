/**
 * useVoiceCommand — Continuous voice recognition with JARVIS NLU.
 *
 * Upgrade: instead of rigid keyword commands, all speech after "Hey JARVIS"
 * is sent to useJarvisCommander which understands ANY app action in plain English.
 *
 * Wake word: "Hey JARVIS" or "JARVIS" alone
 * After wake word: free-form command in plain English
 *
 * Examples:
 *   "Hey JARVIS, go to predictions"
 *   "Hey JARVIS, show me NIFTY50 signals"
 *   "Hey JARVIS, switch to crypto"
 *   "Hey JARVIS, change chart to 15 minutes"
 *   "Hey JARVIS, dark mode"
 *   "Hey JARVIS, run backtest"
 *   "Hey JARVIS, what's the system health?"
 *
 * @param {{ onCommand: function, enabled: boolean, token: string }} options
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useJarvisCommander } from './useJarvisCommander.js'

const WAKE_WORDS = ['hey rama', 'rama', 'hey r.a.m.a', 'jai rama']

function getSpeechRecognition() {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export function useVoiceCommand({ onCommand, enabled = true, token = null }) {
  const [listening,    setListening]    = useState(false)
  const [transcript,   setTranscript]   = useState('')
  const [commandMode,  setCommandMode]  = useState(false)
  const [supported,    setSupported]    = useState(false)
  const [processing,   setProcessing]   = useState(false)

  const recognitionRef  = useRef(null)
  const commandModeRef  = useRef(false)
  const commandTimerRef = useRef(null)
  const enabledRef      = useRef(enabled)

  useEffect(() => { enabledRef.current = enabled }, [enabled])

  const { processInput } = useJarvisCommander({
    onAction: (action, reply) => {
      // Dispatch to AppShell via the onCommand callback
      onCommand?.({ command: action?.type ?? 'CHAT', action, reply, transcript: transcript })
    },
    token,
    enabled,
  })

  useEffect(() => { setSupported(!!getSpeechRecognition()) }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    setListening(false)
    setCommandMode(false)
    commandModeRef.current = false
    clearTimeout(commandTimerRef.current)
  }, [])

  const startListening = useCallback(() => {
    const SR = getSpeechRecognition()
    if (!SR || !enabledRef.current) return
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }

    const recognition = new SR()
    recognition.continuous      = true
    recognition.interimResults  = true
    recognition.lang            = 'en-IN'   // Indian English — better for market terms
    recognition.maxAlternatives = 3         // try alternatives if primary fails

    recognition.onstart  = () => { setListening(true); setTranscript('') }
    recognition.onend    = () => {
      setListening(false)
      // Auto-restart
      if (enabledRef.current) {
        setTimeout(() => { if (enabledRef.current) startListening() }, 600)
      }
    }
    recognition.onerror  = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return
      setListening(false)
    }

    recognition.onresult = async (event) => {
      let finalText = '', interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i]
        // Check all alternatives for the best match
        const best = r[0].transcript
        if (r.isFinal) finalText   += best
        else           interimText += best
      }

      const text = (finalText || interimText).toLowerCase().trim()
      setTranscript(text)

      // ── Wake word detection ──────────────────────────────────────────────
      if (!commandModeRef.current) {
        const hasWake = WAKE_WORDS.some(w => text.includes(w))
        if (!hasWake) return

        commandModeRef.current = true
        setCommandMode(true)

        // Extract command immediately if it follows the wake word
        let command = text
        for (const w of WAKE_WORDS) {
          const idx = text.indexOf(w)
          if (idx !== -1) {
            command = text.slice(idx + w.length).trim()
            break
          }
        }

        if (command && finalText) {
          // Have a complete command right after wake word
          await executeCommand(command)
          commandModeRef.current = false
          setCommandMode(false)
        } else {
          // Wait up to 4 seconds for the user to finish speaking
          clearTimeout(commandTimerRef.current)
          commandTimerRef.current = setTimeout(() => {
            commandModeRef.current = false
            setCommandMode(false)
          }, 4000)
        }
      } else if (finalText) {
        // In command mode — user finished speaking their command
        clearTimeout(commandTimerRef.current)
        commandModeRef.current = false
        setCommandMode(false)
        // Use the text after wake word if we captured it above, else full text
        const commandText = WAKE_WORDS.reduce((t, w) => {
          const idx = t.indexOf(w)
          return idx !== -1 ? t.slice(idx + w.length).trim() : t
        }, finalText.toLowerCase().trim())
        if (commandText) await executeCommand(commandText)
      }
    }

    recognitionRef.current = recognition
    try { recognition.start() } catch {}
  }, [processInput]) // eslint-disable-line react-hooks/exhaustive-deps

  async function executeCommand(text) {
    if (!text || processing) return
    setProcessing(true)
    try {
      await processInput(text)
    } finally {
      setProcessing(false)
    }
  }

  useEffect(() => {
    if (!supported) return
    if (enabled) startListening()
    else         stopListening()
    return () => stopListening()
  }, [enabled, supported]) // eslint-disable-line react-hooks/exhaustive-deps

  return { listening, transcript, commandMode, supported, processing, startListening, stopListening }
}
