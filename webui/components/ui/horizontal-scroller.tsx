"use client"

import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

/** A horizontally-scrolling strip that an ordinary mouse can actually scroll.
 *
 *  `overflow-x: auto` alone is not enough in practice. A plain wheel produces
 *  only `deltaY`, which a horizontal scroller ignores, so a user with a normal
 *  mouse has no gesture at all — and on platforms with overlay scrollbars
 *  (Firefox on Linux, macOS by default) there is no visible bar to drag
 *  either. The strip looks stuck even though it is scrollable.
 *
 *  So this does three things:
 *   - translates vertical wheel into horizontal scroll,
 *   - keeps the scrollbar permanently visible rather than on-hover,
 *   - makes the region focusable, which is what lets a keyboard user reach the
 *     off-screen content with arrow keys (WCAG 2.1.1).
 */
export function HorizontalScroller({
  className,
  children,
  label,
}: {
  className?: string
  children: React.ReactNode
  /** Names the scrollable region for assistive tech. */
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function onWheel(e: WheelEvent) {
      const el = ref.current
      if (!el) return
      const max = el.scrollWidth - el.clientWidth
      // Nothing to the side: leave the page's own scrolling alone.
      if (max <= 0) return
      // A trackpad already sending horizontal delta needs no help from us.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      // At either end, let the gesture fall through to the page — otherwise
      // the board becomes a trap you cannot scroll past.
      if (
        (e.deltaY < 0 && el.scrollLeft <= 0) ||
        (e.deltaY > 0 && el.scrollLeft >= max - 1)
      ) {
        return
      }
      e.preventDefault()
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY))
    }

    // Native listener with `passive: false`: React registers wheel handlers
    // passively at the root, where preventDefault() is ignored and warns.
    el.addEventListener("wheel", onWheel, { passive: false })
    return () => el.removeEventListener("wheel", onWheel)
  }, [])

  return (
    <div
      ref={ref}
      // Focusable so the off-screen columns are reachable without a pointer.
      // A scroll container with no keyboard path is a real accessibility bug,
      // not a nicety — this is the whole content of the page.
      tabIndex={0}
      role="region"
      aria-label={label}
      className={cn(
        // `w-0 min-w-full` is what actually keeps this strip from stretching
        // its ancestors. `overflow-x-auto` alone does NOT stop the content's
        // intrinsic width propagating up: the flex `main` in the app shell has
        // `min-width: auto`, so it grew to the board's width and carried the
        // page header off-screen with it. Width 0 means this box contributes
        // nothing to any ancestor's intrinsic width; `min-w-full` then puts it
        // back to the parent's width. Verified: without it `main` measured
        // 839px inside an 839px viewport starting at x=256; with it, 575px.
        //
        // Do not pass a `min-w-*` class in `className` — tailwind-merge would
        // drop `min-w-full` and the stretching returns.
        "w-0 min-w-full overflow-x-auto overscroll-x-contain",
        // Always show the bar. `thin` is honored by Firefox and by Chrome 121+;
        // the -webkit rules cover older WebKit, which ignores scrollbar-width.
        "[scrollbar-width:thin] [&::-webkit-scrollbar]:h-2",
        "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {children}
    </div>
  )
}
