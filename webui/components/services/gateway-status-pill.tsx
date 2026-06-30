"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

import StatusIndicator from "@/components/8starlabs-ui/status-indicator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { STATUS_VALUES, statusLabel, statusToIndicatorState } from "@/lib/status"
import type { StatusValue } from "@/lib/types"

interface Props {
  gatewayId: number
  status: StatusValue
  className?: string
}

export function GatewayStatusPill({ gatewayId, status, className }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [optimistic, setOptimistic] = useState<StatusValue | null>(null)
  const current = optimistic ?? status

  function setStatus(next: StatusValue) {
    if (next === current) return
    setOptimistic(next)
    startTransition(async () => {
      const res = await fetch(`/api/be/gateways/${gatewayId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      })
      if (!res.ok) {
        setOptimistic(null)
        return
      }
      router.refresh()
      setOptimistic(null)
    })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border bg-background/60 px-2 py-1 text-xs uppercase tracking-wider transition-colors hover:bg-accent disabled:opacity-60",
          pending && "opacity-70",
          className,
        )}
        disabled={pending}
      >
        <StatusIndicator state={statusToIndicatorState(current)} size="sm" />
        <span>{statusLabel(current)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={6}>
        {STATUS_VALUES.map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={(e) => {
              e.stopPropagation()
              setStatus(s)
            }}
            className="flex items-center gap-2"
          >
            <StatusIndicator state={statusToIndicatorState(s)} size="sm" />
            <span>{statusLabel(s)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
