"use client"

import { useState } from "react"
import { Check, Copy } from "lucide-react"

import { cn } from "@/lib/utils"

interface Props {
  label: string
  value: string | null | undefined
  /** When provided, wraps the value in a link (mailto:, tel:, sms:). */
  linkPrefix?: "mailto:" | "tel:" | "sms:"
  className?: string
}

/**
 * Label + value + copy button row. Used on the personnel detail page for
 * cellphone, DSN, SIPR, and email. Shows "—" when the value is missing so
 * the layout doesn't shift once someone fills it in.
 */
export function CopyField({ label, value, linkPrefix, className }: Props) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // ignore — some browsers block clipboard in certain contexts
    }
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-input px-3 py-2",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {value ? (
          linkPrefix ? (
            <a
              href={`${linkPrefix}${value}`}
              className="block truncate text-sm text-foreground hover:underline"
            >
              {value}
            </a>
          ) : (
            <div className="truncate text-sm text-foreground">{value}</div>
          )
        ) : (
          <div className="text-sm text-muted-foreground">—</div>
        )}
      </div>
      <button
        type="button"
        onClick={copy}
        disabled={!value}
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground",
          "disabled:opacity-40",
        )}
        aria-label={`Copy ${label}`}
      >
        {copied ? (
          <Check className="size-3.5" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
      </button>
    </div>
  )
}
