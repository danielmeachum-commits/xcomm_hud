import React from "react"
import { cn } from "@/lib/utils"

interface StatusIndicatorProps {
  state: "active" | "down" | "fixing" | "idle" | "offline" | "setup" | "ready"
  color?: string
  label?: string
  className?: string
  size?: "sm" | "md" | "lg"
  labelClassName?: string
}

const getStateColors = (state: StatusIndicatorProps["state"]) => {
  switch (state) {
    case "active":
      return { dot: "bg-green-500", ping: "bg-green-300" }
    case "ready":
      // PACE standby: available but not currently primary. Sky blue, static.
      return { dot: "bg-sky-500 ring-2 ring-sky-300/40", ping: "bg-sky-300" }
    case "down":
      return { dot: "bg-red-500", ping: "bg-red-300" }
    case "fixing":
      return { dot: "bg-yellow-500", ping: "bg-yellow-300" }
    case "setup":
      return { dot: "bg-sky-500", ping: "bg-sky-300" }
    case "offline":
      // Intentional off — solid dark with a slate ring, no pulse, distinct from "idle".
      return { dot: "bg-slate-900 ring-2 ring-slate-500", ping: "bg-slate-500" }
    case "idle":
    default:
      return { dot: "bg-slate-400 dark:bg-slate-600", ping: "bg-slate-400" }
  }
}

const getSizeClasses = (size: StatusIndicatorProps["size"]) => {
  switch (size) {
    case "sm":
      return { dot: "h-2 w-2", ping: "h-2 w-2" }
    case "lg":
      return { dot: "h-4 w-4", ping: "h-4 w-4" }
    case "md":
    default:
      return { dot: "h-3 w-3", ping: "h-3 w-3" }
  }
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({
  state = "idle",
  label,
  className,
  size = "md",
  labelClassName,
}) => {
  // Pulse for live/transitioning states. Offline + idle are visually static.
  const shouldAnimate =
    state === "active" ||
    state === "fixing" ||
    state === "down" ||
    state === "setup"
  const colors = getStateColors(state)
  const sizeClasses = getSizeClasses(size)

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="relative flex items-center">
        {shouldAnimate && (
          <span
            className={cn(
              "absolute inline-flex rounded-full opacity-75 animate-ping",
              sizeClasses.ping,
              colors.ping,
            )}
          />
        )}
        <span
          className={cn(
            "relative inline-flex rounded-full",
            sizeClasses.dot,
            colors.dot,
          )}
        />
      </div>
      {label && (
        <p
          className={cn(
            "text-sm text-slate-700 dark:text-slate-300",
            labelClassName,
          )}
        >
          {label}
        </p>
      )}
    </div>
  )
}

export default StatusIndicator
