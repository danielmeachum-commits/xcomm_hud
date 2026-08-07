"use client"

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
  open: boolean
  onOpenChange: (open: boolean) => void
  derived: DerivedStatus
  target: "service" | "gateway"
  targetId: number
  targetName: string
  /** Whether to offer writing the derived value back as a validation.
   *
   *  False when the target is already in `derived` mode — the chain IS the
   *  displayed status there, so "apply" would be a no-op dressed up as a
   *  decision. The dialog then reads as an explanation rather than a prompt,
   *  which is the whole reason it can be opened from a status cell. */
  canApply?: boolean
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
 * Explains how a derived status was reached: the reported-vs-derived pair, the
 * hole in the chain if there is one, every backing capability, and (since §7)
 * the transport paths the delivery depends on.
 *
 * Split out of DerivedStatusBadge so a status cell can open the same
 * explanation without also inheriting the badge's trigger and its
 * only-when-disagreeing visibility rule.
 */
export function DerivedStatusDialog({
  open,
  onOpenChange,
  derived,
  target,
  targetId,
  targetName,
  canApply = true,
}: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const backing = derived.backing
  const gateways = derived.backing_gateways ?? []
  const bad = backing.filter((b) => b.status !== "up" && b.status !== "unvalidated")
  const hole = derived.required_unvalidated > 0
  const next = derived.derived ? toTargetStatus(derived.derived, target) : ""
  const showApply = canApply && derived.disagrees && !!derived.derived

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
      onOpenChange(false)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} disablePointerDismissal>
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
              {derived.derived ? (
                <>
                  <StatusIndicator
                    state={statusToIndicatorState(derived.derived)}
                  />
                  {statusLabel(derived.derived)}
                </>
              ) : (
                <span className="text-muted-foreground">No opinion</span>
              )}
            </div>
          </div>
        </div>

        {hole && (
          <p className="rounded-md border border-muted-foreground/30 bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
            <strong>
              {derived.required_unvalidated} of {derived.required_total}
            </strong>{" "}
            required {derived.required_total === 1 ? "dependency" : "dependencies"}{" "}
            {derived.required_unvalidated === 1 ? "has" : "have"} never been
            validated, so this is computed on incomplete information:{" "}
            {derived.unvalidated_labels.join(", ")}.
          </p>
        )}

        <div>
          <div className="mb-1.5 text-xs font-medium">
            {backing.length - bad.length} of {backing.length} backing{" "}
            {backing.length === 1 ? "capability" : "capabilities"} healthy
            {derived.required_total > 0 && (
              <span className="ml-1 font-normal text-muted-foreground">
                · {derived.required_total} required
              </span>
            )}
          </div>
          {backing.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No equipment is bound to this yet.
            </p>
          ) : (
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
                    {b.superseded_by_gateway_id ? (
                      // Counted at the gateway instead. Saying so beats
                      // hiding the row: the dependency did not disappear,
                      // it moved up a level.
                      <span
                        title={`Counted through ${
                          gateways.find(
                            (g) => g.gateway_id === b.superseded_by_gateway_id,
                          )?.name ?? "the gateway"
                        }, not separately`}
                        className="rounded-full border border-dashed border-border px-1 py-px text-[9px] uppercase tracking-wide text-muted-foreground"
                      >
                        via gateway
                      </span>
                    ) : (
                      b.required && (
                        <span
                          title={
                            b.group_key
                              ? `Required — redundant with others in "${b.group_key}"`
                              : "Required"
                          }
                          className="rounded-full border border-border px-1 py-px text-[9px] uppercase tracking-wide"
                        >
                          {b.group_key ? `req · ${b.group_key}` : "req"}
                        </span>
                      )
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    {statusLabel(b.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {gateways.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium">
              {gateways.length} transport{" "}
              {gateways.length === 1 ? "path" : "paths"}
            </div>
            <ul className="flex flex-col gap-1">
              {gateways.map((g) => (
                <li
                  key={g.gateway_id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-xs"
                >
                  <span className="flex items-center gap-1.5">
                    <StatusIndicator
                      state={statusToIndicatorState(
                        (g.contributed_status ?? "unvalidated") as never,
                      )}
                    />
                    <span>{g.name}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {g.pace}
                    </span>
                    {g.required && (
                      <span
                        title={
                          g.group_key
                            ? `Required — redundant with others in "${g.group_key}"`
                            : "Required"
                        }
                        className="rounded-full border border-border px-1 py-px text-[9px] uppercase tracking-wide"
                      >
                        {g.group_key ? `req · ${g.group_key}` : "req"}
                      </span>
                    )}
                  </span>
                  <span
                    className="text-muted-foreground"
                    title={
                      g.from_chain
                        ? "From this gateway's own equipment"
                        : `No equipment bound — using the reported status (${g.reported_status})`
                    }
                  >
                    {g.contributed_status
                      ? statusLabel(g.contributed_status)
                      : "No opinion"}
                    {!g.from_chain && g.contributed_status ? " (reported)" : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {showApply ? (
          <>
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
                onClick={() => onOpenChange(false)}
                disabled={pending}
              >
                Leave as reported
              </Button>
              <Button type="button" onClick={apply} disabled={pending}>
                {pending ? "Applying…" : `Apply ${statusLabel(next as never)}`}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              {canApply
                ? "Equipment agrees with the reported status."
                : "This service is in derived mode, so the chain above is already what it displays. Switch it back to reported on the service page to set the status by hand."}
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
