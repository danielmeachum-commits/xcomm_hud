"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { MoonStar } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

/**
 * End-of-day reset: sends the whole workspace roster to Unknown, clearing the
 * accountability board for a fresh start. Gated behind a confirm dialog.
 */
export function EndOfDayButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/be/personnel/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "unknown" }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.detail ?? "Failed to reset statuses")
      }
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setError(null)
        setOpen(v)
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" variant="outline" className="gap-1.5">
            <MoonStar className="size-3.5" />
            End of day
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset all statuses?</DialogTitle>
          <DialogDescription>
            This sets every person in the workspace to Unknown, clearing sites
            and expected-return timers. Their location history is preserved.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button onClick={reset} disabled={pending}>
            {pending ? "Resetting…" : "Reset all to Unknown"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
