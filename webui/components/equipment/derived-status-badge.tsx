"use client"

import { TriangleAlert } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { statusLabel, statusToIndicatorState } from "@/lib/status"
import type { DerivedStatus } from "@/lib/types"

interface Props {
  derived: DerivedStatus | undefined
  /** Which reported thing this sits next to, so Apply can write it back
   *  through the existing validation endpoint. */
  target: "service" | "gateway"
  targetId: number
  targetName: string
}

/** Maps an equipment status onto the vocabulary the target actually accepts.
 *  Gateways say "active" where equipment says "up", and neither service nor
 *  gateway has a "maintenance" state — the closest honest answer is
 *  "degraded", not silence. */
function toTargetStatus(
  derived: string,
  target: "service" | "gateway",
): string {
  if (derived === "up") return target === "gateway" ? "active" : "up"
  if (derived === "maintenance") return "degraded"
  return derived
}

/**
 * Shows equipment-derived status beside the reported one, and offers to apply
 * it. Deliberately never writes on its own — see api/equipment_status.py for
 * why the human stays in the loop. Renders nothing when there's no
 * disagreement, so the UI stays quiet in the normal case.
 */
export function DerivedStatusBadge({
  derived,
  target,
  targetId,
  targetName,
}: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!derived || !derived.disagrees || !derived.derived) return null

  const backing = derived.backing
  const bad = backing.filter((b) => b.status !== "up" && b.status !== "unvalidated")
  const next = toTargetStatus(derived.derived, target)

  async function apply() {
    setPending(true)
    setError(null)
    try {
      // Goes through the normal validation endpoint so the change is
      // attributed to whoever clicked, not to the system.
      const path =
        target === "service"
          ? `/api/be/services/${targetId}/validate`
          : `/api/be/gateways/${targetId}/validate`
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: next,
          note: `Applied from equipment: ${bad
            .map((b) => `${b.equipment_code} ${b.label} ${b.status}`)
            .join(", ")}`,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.detail ?? `Request failed (${res.status})`)
      }
      setOpen(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen(true)
        }}
        title={`Equipment suggests ${statusLabel(derived.derived)}`}
        className="inline-flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 transition-colors hover:brightness-110 dark:text-amber-400"
      >
        <TriangleAlert className="size-3" />
        Gear says {statusLabel(derived.derived)}
      </button>

      <Dialog open={open} onOpenChange={setOpen} disablePointerDismissal>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{targetName}</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-6 rounded-lg border border-border p-3">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Reported
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm">
                <StatusIndicator
                  state={statusToIndicatorState(derived.reported as never)}
                />
                {statusLabel(derived.reported as never)}
              </div>
            </div>
            <div className="text-muted-foreground">→</div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Equipment says
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-sm">
                <StatusIndicator state={statusToIndicatorState(derived.derived)} />
                {statusLabel(derived.derived)}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-1.5 text-xs font-medium">
              {backing.length - bad.length} of {backing.length} backing{" "}
              {backing.length === 1 ? "capability" : "capabilities"} healthy
            </div>
            <ul className="flex flex-col gap-1">
              {backing.map((b) => (
                <li
                  key={b.capability_id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    <StatusIndicator state={statusToIndicatorState(b.status)} />
                    <span className="font-mono">{b.equipment_code}</span>
                    <span className="text-muted-foreground">{b.label}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {statusLabel(b.status)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs text-muted-foreground">
            Nothing has been changed. Applying records{" "}
            <strong>{statusLabel(next as never)}</strong> as a normal
            validation, attributed to you.
          </p>
          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Leave as reported
            </Button>
            <Button type="button" onClick={apply} disabled={pending}>
              {pending ? "Applying…" : `Apply ${statusLabel(next as never)}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
