"use client"

import type { ReactNode } from "react"
import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

interface TocItem {
  title: ReactNode
  url: string
  depth: number
}

/** Collapsible "On this page" rail (the fumadocs page-map). */
export function DocsToc({ items }: { items: TocItem[] }) {
  const [open, setOpen] = useState(true)
  if (items.length === 0) return null
  return (
    <aside className="hidden w-56 shrink-0 xl:block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mb-2 flex w-full items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span>On this page</span>
        <ChevronDown
          className={cn(
            "ml-auto size-3.5 transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && (
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
      )}
    </aside>
  )
}
