"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

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

interface Props {
  personId: number
  label?: string
}

// on_site is a check-in and traveling needs a destination, so the menu offers
// only the site-less away statuses.
const CHECKOUT_STATUSES = PERSONNEL_STATUSES.filter(
  (s) => s !== "on_site" && s !== "traveling",
)

/**
 * Per-row check-out: a dropdown button that signs a person out to a chosen
 * site-less away status, now, clearing any expected-return timer. Used on the
 * site personnel tab for people currently on-site here (including guests).
 */
export function QuickCheckOutButton({ personId, label = "Check out" }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function checkout(status: string) {
    setPending(true)
    try {
      const res = await fetch(`/api/be/personnel/${personId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          site_id: null,
          changed_at: new Date().toISOString(),
          expected_return_at: null,
        }),
      })
      if (res.ok) router.refresh()
      else alert("Failed to check out")
    } finally {
      setPending(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="icon-sm"
            variant="outline"
            disabled={pending}
            aria-label={label}
            title={`${label}…`}
            className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
          >
            <LogOut className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {CHECKOUT_STATUSES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => checkout(s)}>
            {PERSONNEL_STATUS_LABELS[s]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
