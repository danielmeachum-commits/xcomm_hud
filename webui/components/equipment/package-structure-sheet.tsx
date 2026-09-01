"use client"

import { Network } from "lucide-react"
import { useState } from "react"

import { PackageCanvas } from "@/components/equipment/package-canvas"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import type { Enclave, EquipmentType, PackageDef, UtcDef } from "@/lib/types"

/**
 * "Structure" button that opens the package's shape in a bottom sheet.
 *
 * A sheet rather than a tab beside the contents list, for the same reason the
 * org chart is one: the chart answers a question you ask *while* reading the
 * list — what does this actually resolve to — and a tab makes answering it
 * cost you the list you were reading. It also lets the page stay narrow; as a
 * tab, the chart's width dragged the whole page wide and the header reflowed
 * every time you switched.
 *
 * Bottom rather than side: a tree spreads sideways, and width is the thing it
 * is always short of. Sibling of `OrgChartSheet` on the personnel side.
 */
export function PackageStructureSheet({
  def,
  utcDefs,
  enclaves,
  types,
}: {
  def: PackageDef
  utcDefs: UtcDef[]
  enclaves: Enclave[]
  types: EquipmentType[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="outline" size="sm" className="gap-1.5">
            <Network className="size-3.5" />
            Structure
          </Button>
        }
      />
      <SheetContent side="bottom" className="data-[side=bottom]:h-[88vh]">
        <SheetHeader className="pb-3">
          <SheetTitle>{def.name} structure</SheetTitle>
          <SheetDescription>
            Everything this package resolves to: the roles it fills, the UTCs in
            each, and the people and gear those UTCs bring.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 px-4 pb-4">
          <PackageCanvas
            def={def}
            utcDefs={utcDefs}
            enclaves={enclaves}
            types={types}
            className="h-full"
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
