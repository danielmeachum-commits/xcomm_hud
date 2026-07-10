"use client"

import { useEffect, useId, useState } from "react"
import { useTheme } from "next-themes"

/** Renders a mermaid diagram from the fenced ```mermaid block. mermaid is
 * imported dynamically (kept out of the main bundle) and re-rendered on theme
 * change. The `children` come from the <mermaid> element the rehype plugin
 * produces (a single text node = the diagram source). */
export function Mermaid({ children }: { children?: React.ReactNode }) {
  const code = (
    Array.isArray(children) ? children.join("") : String(children ?? "")
  ).trim()
  const { resolvedTheme } = useTheme()
  const rawId = useId()
  const id = "mmd" + rawId.replace(/[^a-zA-Z0-9]/g, "")
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!code) return
    import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: resolvedTheme === "dark" ? "dark" : "default",
        securityLevel: "strict",
      })
      try {
        const { svg } = await mermaid.render(id, code)
        if (!cancelled) {
          setSvg(svg)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setSvg(null)
        }
      }
    })
    return () => {
      cancelled = true
    }
  }, [code, resolvedTheme, id])

  if (error) {
    return (
      <pre className="my-4 overflow-auto rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
        Mermaid error: {error}
      </pre>
    )
  }
  if (!svg) {
    return (
      <div className="my-4 rounded-md border border-border bg-muted/30 p-4 text-center text-xs text-muted-foreground">
        Rendering diagram…
      </div>
    )
  }
  return (
    <div
      className="my-4 flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
