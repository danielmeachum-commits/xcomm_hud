"use client"

import { useState } from "react"

import {
  branchIcon,
  branchSealPath,
  rankInsigniaPath,
} from "@/lib/personnel-data"
import type { Branch, PersonnelType } from "@/lib/types"
import { cn } from "@/lib/utils"

interface RankProps {
  branch: Branch | null
  personnelType: PersonnelType
  rank: string | null
  /** Pixel size — controls both width and height. */
  size?: number
  className?: string
}

/**
 * Renders a rank insignia image from `/insignia/ranks/{branch}/{rank}.png`.
 * If the file is missing (404 → onError), falls back to the branch's lucide
 * icon so the UI never shows a broken image.
 */
export function RankInsignia({
  branch,
  personnelType,
  rank,
  size = 20,
  className,
}: RankProps) {
  const [errored, setErrored] = useState(false)
  const src = rankInsigniaPath(branch, personnelType, rank)

  if (!src || errored) {
    const Icon = branchIcon(branch, personnelType)
    return (
      <Icon
        width={size}
        height={size}
        className={className}
        aria-hidden
      />
    )
  }
  return (
    <img
      src={src}
      alt={rank ?? ""}
      width={size}
      height={size}
      className={cn("inline-block object-contain", className)}
      onError={() => setErrored(true)}
    />
  )
}

interface BranchProps {
  branch: Branch | null
  personnelType: PersonnelType
  size?: number
  className?: string
}

/**
 * Renders a branch seal from `/insignia/branches/{branch}.png` with the same
 * fallback behavior as RankInsignia. Used for larger displays where a full
 * seal makes more sense than the small rank chevrons.
 */
export function BranchSeal({
  branch,
  personnelType,
  size = 48,
  className,
}: BranchProps) {
  const [errored, setErrored] = useState(false)
  const src = branchSealPath(branch, personnelType)

  if (!src || errored) {
    const Icon = branchIcon(branch, personnelType)
    return (
      <Icon
        width={size * 0.55}
        height={size * 0.55}
        className={className}
        aria-hidden
      />
    )
  }
  return (
    <img
      src={src}
      alt={branch ?? ""}
      width={size}
      height={size}
      className={cn("inline-block object-contain", className)}
      onError={() => setErrored(true)}
    />
  )
}
