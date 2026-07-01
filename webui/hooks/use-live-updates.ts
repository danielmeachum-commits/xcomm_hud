"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function useLiveUpdates(enabled: boolean) {
  const router = useRouter()

  useEffect(() => {
    if (!enabled) return

    const source = new EventSource("/api/stream")
    source.onmessage = () => router.refresh()

    return () => {
      source.close()
    }
  }, [enabled, router])
}
