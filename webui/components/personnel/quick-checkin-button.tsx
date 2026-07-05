"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

interface Props {
  personId: number
  siteId: number
  label?: string
}

/**
 * One-click check-in: signs a person in as on-site at `siteId`, now, clearing
 * any expected-return timer. Used per-row on the site personnel tab for people
 * assigned there who aren't currently on-station.
 */
export function QuickCheckInButton({ personId, siteId, label = "Check in" }: Props) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function checkin(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setPending(true)
    try {
      const res = await fetch(`/api/be/personnel/${personId}/checkin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "on_site",
          site_id: siteId,
          changed_at: new Date().toISOString(),
          expected_return_at: null,
        }),
      })
      if (res.ok) router.refresh()
      else alert("Failed to check in")
    } finally {
      setPending(false)
    }
  }

  return (
    <Button size="sm" variant="outline" onClick={checkin} disabled={pending}>
      {pending ? "…" : label}
    </Button>
  )
}
