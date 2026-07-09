"use client"

import { useEffect, useState } from "react"

import { formatLocal, formatLocalTime, timeAgo } from "@/lib/time"

interface Props {
  iso: string | null | undefined
  /** Text shown server-side and before mount. Defaults to "—". */
  placeholder?: string
  className?: string
}

/** Renders local-time formatted ISO. Defers to after hydration so the SSR
 *  output matches across server (UTC, default locale) and client (user's
 *  browser locale + timezone) — both render the placeholder initially, then
 *  client swaps in the real value. */
export function LocalTime({ iso, placeholder = "—", className }: Props) {
  const [text, setText] = useState(placeholder)
  useEffect(() => {
    setText(formatLocal(iso))
  }, [iso])
  return <span className={className}>{text}</span>
}

/** Local clock time "18:25L", hydration-safe (placeholder until mount). */
export function LocalClock({ iso, placeholder = "—", className }: Props) {
  const [text, setText] = useState(placeholder)
  useEffect(() => {
    setText(formatLocalTime(iso))
  }, [iso])
  return <span className={className}>{text}</span>
}

/** "3m ago" / "yesterday" etc — re-ticks every 30s. */
export function TimeAgo({ iso, placeholder = "—", className }: Props) {
  const [text, setText] = useState(placeholder)
  useEffect(() => {
    setText(timeAgo(iso))
    const t = setInterval(() => setText(timeAgo(iso)), 30_000)
    return () => clearInterval(t)
  }, [iso])
  return <span className={className}>{text}</span>
}
