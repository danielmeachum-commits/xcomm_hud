import Link from "next/link"
import { ChevronRight, Home } from "lucide-react"

import { cn } from "@/lib/utils"

export interface CrumbItem {
  label: string
  href?: string
}

interface Props {
  items: CrumbItem[]
  className?: string
}

export function Breadcrumbs({ items, className }: Props) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn(
        "flex items-center gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <Link
        href="/"
        className="inline-flex items-center gap-1 hover:text-foreground"
      >
        <Home className="size-3" />
        <span>Overview</span>
      </Link>
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1">
          <ChevronRight className="size-3" />
          {it.href ? (
            <Link href={it.href} className="hover:text-foreground">
              {it.label}
            </Link>
          ) : (
            <span className="text-foreground">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
