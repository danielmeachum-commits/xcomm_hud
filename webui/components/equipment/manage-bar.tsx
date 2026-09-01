"use client"

import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** The bar that owns a manage mode: the only way out of it, and the only way
 *  to commit it.
 *
 *  Always on while managing, so leaving the mode is never something you have
 *  to go looking for. Its buttons follow the state: nothing to save yet means
 *  one Done, and the moment there is, Cancel and Save take over.
 *
 *  Sticky to the bottom of the scrolling pane, because with several columns or
 *  groups open the bar is well below the fold, and an action bar you have to
 *  scroll to find is one you will not find.
 *
 *  Shared by the UTC, package and equipment type detail pages. It was copied
 *  between the first two verbatim; a third page wanting it is what made the
 *  copy worth ending, since the whole point is that manage mode feels the same
 *  wherever you meet it. */
export function ManageBar({
  hint,
  notice,
  error,
  dirty,
  pending,
  blocked,
  onCancel,
  onSave,
}: {
  /** What to say at rest — how the editor below is meant to be used. */
  hint: string
  /** One-shot line about what an action just did. Outranks the hint: a drop
   *  that merged two rows into one is worth saying out loud. */
  notice?: string | null
  error?: string | null
  dirty: boolean
  pending: boolean
  /** Held back while the editor above is in a state the API would reject.
   *  Cancel stays live — being stuck in a bad state is not being stuck. */
  blocked?: boolean
  onCancel: () => void
  onSave: () => void
}) {
  return (
    <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-background/85 p-2 pl-3.5 shadow-lg backdrop-blur-sm">
      <p
        className={cn(
          "mr-auto text-xs",
          error ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {error ?? notice ?? (dirty ? "Unsaved changes." : hint)}
      </p>
      {dirty ? (
        <>
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={pending || blocked}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      ) : (
        <Button size="sm" onClick={onCancel}>
          <Check data-icon="inline-start" />
          Done
        </Button>
      )}
    </div>
  )
}
