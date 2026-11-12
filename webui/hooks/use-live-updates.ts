"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

// The API sends a `ping` event every 20 s on an otherwise quiet stream.
// Hearing nothing for this long means the connection is dead (e.g. a proxy
// left half-open by an API restart), so drop it and reconnect.
const STALE_MS = 50_000
const MIN_RETRY_MS = 1_000
const MAX_RETRY_MS = 30_000

/**
 * Refresh the page's server data whenever the API publishes a change.
 *
 * EventSource reconnects on its own after a dropped stream — but gives up
 * for good if a reconnect gets a non-stream response, which is exactly what
 * happens while the API restarts (the /api/stream proxy answers 502). So
 * reconnect ourselves with backoff, and refresh once on reconnecting to pick
 * up anything published during the gap.
 */
export function useLiveUpdates(enabled: boolean) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return

    let source: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let staleTimer: ReturnType<typeof setTimeout> | undefined
    let delay = MIN_RETRY_MS
    let missed = false
    let stopped = false

    const scheduleReconnect = () => {
      if (stopped) return
      source?.close()
      source = null
      clearTimeout(staleTimer)
      clearTimeout(retryTimer)
      retryTimer = setTimeout(connect, delay)
      delay = Math.min(delay * 2, MAX_RETRY_MS)
    }

    const heard = () => {
      clearTimeout(staleTimer)
      staleTimer = setTimeout(() => {
        missed = true
        scheduleReconnect()
      }, STALE_MS)
    }

    function connect() {
      if (stopped) return
      source = new EventSource("/api/stream")
      source.onopen = () => {
        delay = MIN_RETRY_MS
        heard()
        if (missed) {
          missed = false
          router.refresh()
        }
      }
      source.onmessage = () => {
        heard()
        router.refresh()
      }
      source.addEventListener("ping", heard)
      source.onerror = () => {
        missed = true
        // CONNECTING: the browser is already retrying a dropped stream.
        // CLOSED: it has given up — take over.
        if (source?.readyState === EventSource.CLOSED) scheduleReconnect()
      }
    }

    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      clearTimeout(staleTimer)
      source?.close()
    }
  }, [enabled, router])
}
