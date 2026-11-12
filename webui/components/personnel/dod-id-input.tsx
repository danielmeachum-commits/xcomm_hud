"use client"

import { Check, CreditCard } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { extractEdipi } from "@/lib/cac"

// A scanner types a whole barcode in well under this; normalizing only once
// input pauses keeps a half-typed PDF417 from matching as a Code 39 code.
const SETTLE_MS = 120

/**
 * The pending change to someone's CAC enrollment, as a form holds it:
 * `""` — leave it as it is; `null` — remove it; anything else — enroll this
 * DoD ID (10 digits; the API also accepts a raw scan). Send `edipi` only
 * when this isn't `""`.
 */
export type CacChange = string | null

/** The body fields for a CacChange: nothing, or `edipi`. */
export function cacPayload(change: CacChange): { edipi?: string | null } {
  if (change === "") return {}
  return { edipi: change === null ? null : change.trim() || null }
}

/**
 * Write-only DoD ID (CAC) enrollment. The number is never shown — the API
 * stores only a keyed hash and returns just whether a card is enrolled. Click
 * the field and scan the card (or type the 10 digits): the scanner's
 * barcode is reduced to the DoD ID once it settles, and its trailing Enter
 * is swallowed so it doesn't submit the form.
 */
export function DodIdInput({
  id,
  enrolled,
  value,
  onChange,
  disabled,
}: {
  id: string
  enrolled: boolean
  value: CacChange
  onChange: (value: CacChange) => void
  disabled?: boolean
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [unreadable, setUnreadable] = useState(false)
  const [editing, setEditing] = useState(false)
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  if (value === null) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">
          Card will be removed when you save.
        </span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange("")}
          disabled={disabled}
        >
          Undo
        </Button>
      </div>
    )
  }

  if (enrolled && value === "" && !editing) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
          <Check className="size-4" /> CAC enrolled
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEditing(true)}
          disabled={disabled}
        >
          Re-scan
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onChange(null)}
          disabled={disabled}
        >
          Remove
        </Button>
      </div>
    )
  }

  const read = value !== "" && extractEdipi(value) === value
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          // Masked: a DoD ID isn't shown anywhere, even while entering it.
          type="password"
          value={value}
          inputMode="numeric"
          autoComplete="new-password"
          data-1p-ignore
          data-lpignore="true"
          autoFocus={editing}
          placeholder="Scan the CAC, or type the 10-digit DoD ID"
          onChange={(e) => {
            const raw = e.target.value
            setUnreadable(false)
            onChange(raw)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => {
              const edipi = extractEdipi(raw)
              if (edipi && edipi !== raw) onChange(edipi)
              // A barcode that isn't a readable CAC: don't leave raw card
              // data in the field (or let it be saved) — clear it, say so.
              else if (!edipi && raw.length > 12) {
                onChange("")
                setUnreadable(true)
              }
            }, SETTLE_MS)
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault()
          }}
          disabled={disabled}
        />
        {enrolled && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              onChange("")
              setEditing(false)
            }}
            disabled={disabled}
          >
            Cancel
          </Button>
        )}
      </div>
      {read && (
        <p className="inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CreditCard className="size-3.5" /> Card read — saved when you save.
        </p>
      )}
      {unreadable && (
        <p className="text-xs text-destructive">
          Couldn&apos;t read that card — type the 10-digit DoD ID instead.
        </p>
      )}
    </div>
  )
}
