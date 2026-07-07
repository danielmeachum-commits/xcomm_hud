"use client"

import { useMemo, useState } from "react"
import { Flag } from "lucide-react"

import { PersonnelCanvas } from "@/components/personnel/personnel-canvas"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { Personnel, Site } from "@/lib/types"

interface Props {
  /** The full workspace roster — the chart needs complete supervisor chains. */
  personnel: Personnel[]
  /** People relevant here (e.g. this site's) render full-strength; the rest fade. */
  highlightIds: number[]
  /** Where the chart is being opened from, e.g. a site name. */
  contextLabel: string
  sites: Site[]
  canEdit: boolean
  linkFrom?: { path: string; label: string }
}

/**
 * "Org chart" button that opens the workspace-wide org chart in a bottom
 * sheet. Scoping the org chart to a subset breaks supervisor chains, so the
 * sheet always charts everyone and highlights the subset instead.
 */
export function OrgChartSheet({
  personnel,
  highlightIds,
  contextLabel,
  sites,
  canEdit,
  linkFrom,
}: Props) {
  const [open, setOpen] = useState(false)
  const highlight = useMemo(() => new Set(highlightIds), [highlightIds])
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <Flag className="size-3.5" />
            Org chart
          </Button>
        }
      />
      <SheetContent side="bottom" className="data-[side=bottom]:h-[88vh]">
        <SheetHeader className="pb-3">
          <SheetTitle>Organization</SheetTitle>
          <SheetDescription>
            Whole-workspace org chart — people from {contextLabel} highlighted,
            everyone else dimmed.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 px-4 pb-4">
          <PersonnelCanvas
            mode="org-tree"
            people={personnel}
            highlightIds={highlight}
            sites={sites}
            canEdit={canEdit}
            linkFrom={linkFrom}
            className="h-full"
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
