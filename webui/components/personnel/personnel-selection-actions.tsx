"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ChevronDown, LogIn, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  PERSONNEL_STATUSES,
  PERSONNEL_STATUS_LABELS,
} from "@/lib/personnel-data"
import type { Site } from "@/lib/types"

// on_site is the check-in; traveling needs a destination — both excluded here.
const CHECKOUT_STATUSES = PERSONNEL_STATUSES.filter(
  (s) => s !== "on_site" && s !== "traveling",
)

interface Props {
  site: Site
  ids: number[]
  /** Called after a successful apply so the table can clear its selection. */
  onDone: () => void
}

/**
 * Bulk action bar for the currently selected personnel rows: check them all in
 * (on-site here) or out to a chosen status, via the bulk endpoint.
 */
export function PersonnelSelectionActions({ site, ids, onDone }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function apply(status: string, siteId: number | null) {
    if (ids.length === 0) return
    setPending(true)
    try {
      const res = await fetch(`/api/be/personnel/checkin-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_ids: ids,
          status,
          site_id: siteId,
          changed_at: new Date().toISOString(),
        }),
      })
      if (res.ok) {
        onDone()
        router.refresh()
      } else {
        alert("Bulk update failed")
      }
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => apply("on_site", site.id)}
        className="gap-1.5 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
      >
        <LogIn className="size-3.5" />
        Check in
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              className="gap-1.5 border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
            >
              <LogOut className="size-3.5" />
              Check out
              <ChevronDown className="size-3.5 opacity-60" />
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {CHECKOUT_STATUSES.map((s) => (
            <DropdownMenuItem key={s} onClick={() => apply(s, null)}>
              {PERSONNEL_STATUS_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
