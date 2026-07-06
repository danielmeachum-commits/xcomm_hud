"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogIn } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  PERSONNEL_STATUSES,
  PERSONNEL_STATUS_LABELS,
} from "@/lib/personnel-data"

interface Props {
  personId: number
  siteId: number
  label?: string
}

// Statuses offered on right-click. On-site signs them in here; the away
// statuses are site-less. Traveling needs a destination, so it's excluded.
const CHECKIN_STATUSES = PERSONNEL_STATUSES.filter((s) => s !== "traveling")

/**
 * One-click check-in: signs a person in as on-site at `siteId`, now, clearing
 * any expected-return timer. Right-click for a menu to set a different status
 * instead. Used per-row on the site personnel tab for people assigned there
 * who aren't currently on-station.
 */
export function QuickCheckInButton({ personId, siteId, label = "Check in" }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function setStatus(status: string) {
    setPending(true)
    try {
      const res = await fetch(`/api/be/personnel/${personId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          // on_site carries the present location; away statuses are site-less.
          site_id: status === "on_site" ? siteId : null,
          changed_at: new Date().toISOString(),
          expected_return_at: null,
        }),
      })
      if (res.ok) router.refresh()
      else alert("Failed to update status")
    } finally {
      setPending(false)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            disabled={pending}
            aria-label={label}
            title={`${label} — right-click to set a specific status`}
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setStatus("on_site")
            }}
            className="border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
          >
            <LogIn className="size-3.5" />
          </Button>
        }
      />
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuLabel>Set status to…</ContextMenuLabel>
          <ContextMenuSeparator />
          {CHECKIN_STATUSES.map((s) => (
            <ContextMenuItem key={s} onClick={() => setStatus(s)}>
              {PERSONNEL_STATUS_LABELS[s]}
              {s === "on_site" ? " (here)" : ""}
            </ContextMenuItem>
          ))}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  )
}
