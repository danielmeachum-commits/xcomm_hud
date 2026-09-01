"use client"

import { ArrowUpRight } from "lucide-react"
import Link from "next/link"

import { CodeBadge } from "@/components/equipment/code-badge"
import { UtcDefContents } from "@/components/equipment/utc-def-contents"
import { UtcManforContents } from "@/components/equipment/utc-manfor-contents"
import { buttonVariants } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  MEFPAK_HALVES,
} from "@/lib/equipment-meta"
import type { Enclave, UtcDef } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

/** What a UTC brings, over the package that carries it.
 *
 *  A bottom sheet rather than a navigation because the question it answers —
 *  "what's actually in that one?" — is asked *while* reading the package, and
 *  leaving the page to answer it loses the list you were comparing against.
 *  Bottom rather than side: the contents are columns, and columns want width.
 *
 *  Read-only on purpose. Editing lives on the definition page, one link away:
 *  a sheet that could edit would need its own properties sheet nested inside
 *  it, and two stacked dialogs is a worse answer than a link. */
export function UtcDefPeekSheet({
  def,
  enclaves,
  onClose,
}: {
  def: UtcDef | null
  enclaves: Enclave[]
  onClose: () => void
}) {
  const { w } = useWorkspace()
  const Icon = def ? ASSET_CATEGORY_ICONS[def.category] : null

  return (
    <Sheet open={!!def} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="bottom"
        // Tall enough for a full column without becoming a second page; the
        // contents scroll inside it.
        className="max-h-[75svh] rounded-t-2xl"
      >
        {def && (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                <span>{def.name}</span>
                <CodeBadge code={def.code} tone="strong" />
                {Icon && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Icon className="size-3" />
                    {ASSET_CATEGORY_LABELS[def.category]}
                  </span>
                )}
              </SheetTitle>
              <SheetDescription>
                {def.description || "No description."}
              </SheetDescription>
            </SheetHeader>

            {/* Both halves, MANFOR first — the question this sheet answers is
                "what does that one put on the ground", and a packing list with
                nobody to unpack it is half an answer. */}
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pb-2">
              <section className="flex flex-col gap-2">
                <HalfHeading half="manfor" />
                <UtcManforContents def={def} />
              </section>
              <section className="flex min-w-0 flex-col gap-2">
                <HalfHeading half="logdet" />
                <UtcDefContents def={def} enclaves={enclaves} />
              </section>
            </div>

            <div className="flex justify-end px-6 pt-2 pb-6">
              {/* A real anchor, not a Button with a click handler: this
                  navigates, so middle-click and open-in-new-tab have to work. */}
              <Link
                href={w(`/admin/utcs/${def.id}`)}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
              >
                Open definition
                <ArrowUpRight data-icon="inline-end" />
              </Link>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Both names and the icon, at sheet scale — the same pairing the definition
 *  page shows, one type size down. */
function HalfHeading({ half }: { half: keyof typeof MEFPAK_HALVES }) {
  const { plain, code, icon: Icon } = MEFPAK_HALVES[half]
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-medium">
      <Icon className="size-3.5 text-muted-foreground" />
      {plain}
      <span className="font-semibold uppercase tracking-widest text-muted-foreground">
        {code}
      </span>
    </h3>
  )
}
