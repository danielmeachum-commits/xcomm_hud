"use client"

import { CircleHelp, TriangleAlert } from "lucide-react"
import { useState } from "react"

import { DerivedStatusDialog } from "@/components/equipment/derived-status-dialog"
import { statusLabel } from "@/lib/status"
import type { DerivedStatus } from "@/lib/types"

interface Props {
  derived: DerivedStatus | undefined
  /** Which reported thing this sits next to, so Apply can write it back
   *  through the existing validation endpoint. */
  target: "service" | "gateway"
  targetId: number
  targetName: string
}

/**
 * Shows equipment-derived status beside the reported one, and offers to apply
 * it. Deliberately never writes on its own — see api/equipment_status.py for
 * why the human stays in the loop. Renders nothing when there's no
 * disagreement, so the UI stays quiet in the normal case.
 *
 * The explanation itself lives in DerivedStatusDialog, which a status cell can
 * also open directly — this component is only the badge and the rule for when
 * it should appear.
 */
export function DerivedStatusBadge({
  derived,
  target,
  targetId,
  targetName,
}: Props) {
  const [open, setOpen] = useState(false)

  if (!derived) return null

  // The hole in the chain is its OWN signal, not part of the status. It shows
  // even when nothing disagrees — "everything I can see is up, and there are
  // three things I cannot see" is the case this exists to make visible, and
  // it is invisible in the status vocabulary by design.
  const hole = derived.required_unvalidated > 0
  if ((!derived.disagrees || !derived.derived) && !hole) return null

  // Nothing to apply, but a gap worth showing. Clickable now, because the
  // labels alone don't say WHICH dependencies are unvalidated once there is
  // more than one.
  if (!derived.disagrees || !derived.derived) {
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setOpen(true)
          }}
          title={`Not validated: ${derived.unvalidated_labels.join(", ")}`}
          className="inline-flex items-center gap-1 rounded-full border border-muted-foreground/30 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <CircleHelp className="size-3" />
          {derived.required_unvalidated} of {derived.required_total} unvalidated
        </button>
        <DerivedStatusDialog
          open={open}
          onOpenChange={setOpen}
          derived={derived}
          target={target}
          targetId={targetId}
          targetName={targetName}
        />
      </>
    )
  }

  return (
    <>
      <button
        type="button"
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

      <DerivedStatusDialog
        open={open}
        onOpenChange={setOpen}
        derived={derived}
        target={target}
        targetId={targetId}
        targetName={targetName}
      />
    </>
  )
}
