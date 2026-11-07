"use client"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatLocal, formatZulu } from "@/lib/time"

/** "YYYY-MM-DDTHH:mm" in local time — the value format of
 *  <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`
}

/** ISO string for a datetime-local value, or null if it isn't a valid time. */
export function localInputToIso(value: string): string | null {
  const ms = new Date(value).getTime()
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

/**
 * When an event happened — for logging one after the fact, or correcting the
 * time on one already logged. Same look as the validation dialog's "When":
 * the input is local time, with the Local and Zulu readings beside it so the
 * value can be checked against a log kept in either.
 */
export function EventTimeField({
  id,
  value,
  onChange,
  disabled,
  hint,
}: {
  id: string
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  hint?: string
}) {
  const iso = localInputToIso(value)
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>When (local time)</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          disabled={disabled}
          onClick={() => onChange(toLocalInput(new Date()))}
        >
          Now
        </Button>
      </div>
      <Input
        id={id}
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      <div className="grid grid-cols-2 gap-3 rounded-md border bg-muted/20 p-2 text-[11px]">
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Local</div>
          <div className="font-mono">{iso ? formatLocal(iso) : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-muted-foreground">Zulu</div>
          <div className="font-mono">{iso ? formatZulu(iso) : "—"}</div>
        </div>
      </div>
      {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  )
}
