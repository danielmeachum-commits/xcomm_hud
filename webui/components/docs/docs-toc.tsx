"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { PanelRight, PanelRightClose } from "lucide-react"

interface TocItem {
  title: ReactNode
  url: string
  depth: number
}

/** Collapsible "On this page" rail (the fumadocs page-map). Collapses to a thin
 * strip with a toggle, mirroring the left nav's collapse. */
export function DocsToc({ items }: { items: TocItem[] }) {
  const [collapsed, setCollapsed] = useState(false)
  if (items.length === 0) return null

  if (collapsed) {
    return (
      <div className="sticky top-6 hidden shrink-0 self-start xl:block">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Show outline"
          aria-label="Show outline"
        >
          <PanelRight className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <aside className="sticky top-6 hidden max-h-[calc(100dvh-3rem)] w-56 shrink-0 self-start overflow-y-auto xl:block">
      <div className="mb-2 flex items-center justify-between gap-1">
        <span className="text-xs font-medium text-muted-foreground">
          On this page
        </span>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="Hide outline"
          aria-label="Hide outline"
        >
          <PanelRightClose className="size-4" />
        </button>
      </div>
      <ul className="space-y-1 text-sm">
        {items.map((item) => (
          <li
            key={item.url}
            style={{ paddingLeft: Math.max(0, item.depth - 1) * 12 }}
          >
            <a
              href={item.url}
              className="block truncate text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.title}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  )
}
