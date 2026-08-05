"use client"

import { X } from "lucide-react"
import { useState } from "react"

import { cn } from "@/lib/utils"

/** Normalizes the same way the API does, so what you see typed is what gets
 *  stored. Keep in sync with `_norm_tags` in api/routers/equipment_catalog.py. */
function normalize(raw: string): string {
  return raw.trim().toLowerCase()
}

interface Props {
  value: string[]
  onChange: (tags: string[]) => void
  /** Tags already used elsewhere in the catalog — offered as you type so the
   *  vocabulary converges without being enforced. */
  suggestions?: string[]
  disabled?: boolean
  id?: string
}

/** Chip-style multi-select for free-form tags. Enter or comma commits the
 *  current draft; Backspace on an empty field removes the last chip. */
export function TagsInput({
  value,
  onChange,
  suggestions = [],
  disabled,
  id,
}: Props) {
  const [draft, setDraft] = useState("")

  function add(raw: string) {
    const tag = normalize(raw)
    if (!tag || value.includes(tag)) {
      setDraft("")
      return
    }
    onChange([...value, tag])
    setDraft("")
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      add(draft)
    } else if (e.key === "Backspace" && !draft && value.length > 0) {
      remove(value[value.length - 1])
    }
  }

  const draftNorm = normalize(draft)
  const offered = draftNorm
    ? suggestions
        .filter((s) => s.includes(draftNorm) && !value.includes(s))
        .slice(0, 6)
    : []

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "flex min-h-9 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1",
          disabled && "opacity-50",
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
          >
            {tag}
            {!disabled && (
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remove tag ${tag}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => add(draft)}
          disabled={disabled}
          placeholder={value.length === 0 ? "Add a tag…" : ""}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
      {offered.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {offered.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-full border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
