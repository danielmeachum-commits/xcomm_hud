"use client"

import { createContext, useCallback, useContext, useEffect, useState } from "react"

import { useLiveUpdates } from "@/hooks/use-live-updates"

const LIVE_STORAGE_KEY = "xcomm_hud:live"

interface LiveContextValue {
  enabled: boolean
  setEnabled: (next: boolean) => void
}

const LiveContext = createContext<LiveContextValue | null>(null)

export function LiveUpdatesProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState(true)

  useEffect(() => {
    const stored = window.localStorage.getItem(LIVE_STORAGE_KEY)
    if (stored === "off") setEnabledState(false)
  }, [])

  const setEnabled = useCallback((next: boolean) => {
    setEnabledState(next)
    window.localStorage.setItem(LIVE_STORAGE_KEY, next ? "on" : "off")
  }, [])

  useLiveUpdates(enabled)

  return (
    <LiveContext.Provider value={{ enabled, setEnabled }}>
      {children}
    </LiveContext.Provider>
  )
}

export function useLive() {
  const ctx = useContext(LiveContext)
  if (!ctx) throw new Error("useLive must be used within LiveUpdatesProvider")
  return ctx
}
