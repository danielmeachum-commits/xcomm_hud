"use client"

import { useEffect, useState } from "react"

const KEY = "kh-font-scale"
const MIN = 0.85
const MAX = 1.5
const STEP = 0.1

/** Reading text-size control for the Knowledge Hub. Writes a `--kh-font-scale`
 * CSS variable on :root (consumed by `.kh-reader` in docs.css) and persists the
 * choice, so it holds across pages and the popped-out tab. */
export function ReaderControls() {
  const [scale, setScale] = useState(1)

  useEffect(() => {
    const stored = parseFloat(localStorage.getItem(KEY) ?? "")
    if (!Number.isNaN(stored)) apply(stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function apply(value: number) {
    const clamped = Math.min(MAX, Math.max(MIN, Math.round(value * 100) / 100))
    setScale(clamped)
    document.documentElement.style.setProperty("--kh-font-scale", String(clamped))
    localStorage.setItem(KEY, String(clamped))
  }

  return (
    <div
      role="group"
      aria-label="Text size"
      className="inline-flex items-center overflow-hidden rounded-md border border-border"
    >
      <button
        type="button"
        title="Smaller text"
        aria-label="Smaller text"
        onClick={() => apply(scale - STEP)}
        disabled={scale <= MIN}
        className="flex h-7 w-7 items-center justify-center text-xs leading-none text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        A
      </button>
      <span className="h-4 w-px bg-border" />
      <button
        type="button"
        title="Larger text"
        aria-label="Larger text"
        onClick={() => apply(scale + STEP)}
        disabled={scale >= MAX}
        className="flex h-7 w-7 items-center justify-center text-base leading-none text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        A
      </button>
    </div>
  )
}
