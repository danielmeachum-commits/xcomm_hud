"use client"

import { ArrowRight, Search } from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { aggregateCapabilities } from "@/components/equipment/catalog-detail-sheets"
import { CodeBadge } from "@/components/equipment/code-badge"
import { GlobalBadge } from "@/components/equipment/global-badge"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import {
  enclaveChipClass,
  enclaveChipStyle,
  enclaveLabel,
} from "@/lib/enclave-meta"
import {
  ASSET_CATEGORY_ICONS,
  ASSET_CATEGORY_LABELS,
  ASSET_CATEGORY_VALUES,
  CAPABILITY_LABELS,
  utcUsesEnclaves,
} from "@/lib/equipment-meta"
import type {
  AssetCategory,
  Enclave,
  EquipmentType,
  UtcDef,
  UtcDefLine,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

/** One slice of a UTC's bill of materials — an enclave's worth of gear, or
 *  the whole thing for a UTC that doesn't divide by enclave. */
interface Group {
  key: string
  /** Null for Common, and for a UTC whose category doesn't use enclaves. */
  enclave: Enclave | null
  lines: UtcDefLine[]
  /** Pieces, not lines — a line calling for 24 cables is 24 items. */
  units: number
}

interface UtcCard {
  def: UtcDef
  groups: Group[]
  units: number
  /** Comm UTCs divide by enclave and get a chip each; everything else gets
   *  one peek behind the item count. See `utcUsesEnclaves`. */
  byEnclave: boolean
}

interface Props {
  utcDefs: UtcDef[]
  types: EquipmentType[]
  enclaves: Enclave[]
  isAdmin: boolean
}

function unitsOf(lines: UtcDefLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0)
}

/** Splits a definition's lines the way the definition page's board does:
 *  enclaves in catalog order, Common last. A column holding nothing says
 *  nothing, so an enclave the UTC is silent about doesn't appear at all. */
function groupsOf(def: UtcDef, enclaves: Enclave[]): Group[] {
  const lines = [...def.lines].sort((a, b) => a.display_order - b.display_order)
  if (!utcUsesEnclaves(def.category)) {
    return lines.length > 0
      ? [{ key: "all", enclave: null, lines, units: unitsOf(lines) }]
      : []
  }

  const groups: Group[] = enclaves
    .map((e) => ({
      key: `e${e.id}`,
      enclave: e as Enclave | null,
      lines: lines.filter((l) => l.enclave_id === e.id),
      units: 0,
    }))
    .filter((g) => g.lines.length > 0)
    .map((g) => ({ ...g, units: unitsOf(g.lines) }))

  // A line tagged with an enclave this view wasn't handed (retired, or from
  // another workspace) still has to appear — falling through to Common is
  // wrong but visible, where dropping it silently is not.
  const known = new Set(enclaves.map((e) => e.id))
  const common = lines.filter(
    (l) => l.enclave_id === null || !known.has(l.enclave_id),
  )
  if (common.length > 0) {
    groups.push({
      key: "common",
      enclave: null,
      lines: common,
      units: unitsOf(common),
    })
  }
  return groups
}

/** What a slice holds, on hover or focus: the gear, then what that gear can
 *  do. Peeking rather than expanding because the full board is a wide,
 *  side-scrolling thing that cannot fit a card this narrow — and the
 *  definition page one click away is where it belongs. */
function GroupPeek({
  group,
  label,
  typesById,
  children,
}: {
  group: Group
  label: string
  typesById: Map<number, EquipmentType>
  children: React.ReactNode
}) {
  const capabilities = aggregateCapabilities(group.lines, typesById)

  return (
    <HoverCard>
      {/* Base UI's trigger is an anchor by default; these open a peek rather
          than navigate, so they have to be buttons. */}
      <HoverCardTrigger
        render={<button type="button" />}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        {children}
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-64 p-3">
        <p className="flex items-baseline justify-between gap-2 border-b border-border pb-1.5 text-xs font-semibold">
          <span>{label}</span>
          <span className="font-normal tabular-nums text-muted-foreground">
            {group.units} item{group.units === 1 ? "" : "s"}
          </span>
        </p>
        <ul className="flex flex-col gap-1 pt-2">
          {group.lines.map((l) => (
            <li key={l.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate">
                {l.equipment_type_title ?? "Unknown equipment type"}
              </span>
              {l.quantity > 1 && (
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  ×{l.quantity}
                </span>
              )}
            </li>
          ))}
        </ul>
        {capabilities.length > 0 && (
          <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
            {capabilities.map((k) => CAPABILITY_LABELS[k]).join(" · ")}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}

/** Every UTC definition, one card each — the list the packages page can't be,
 *  since a UTC in no package is as real as one in three. Same card shape as a
 *  package, one level down: what it is up top, the way in at the foot. */
export function UtcDefsClient({ utcDefs, types, enclaves, isAdmin }: Props) {
  const { w } = useWorkspace()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<AssetCategory | "all">("all")

  const typesById = useMemo(() => new Map(types.map((t) => [t.id, t])), [types])

  /** Categories that actually have a UTC, so the filter never offers a dead
   *  option. */
  const presentCategories = useMemo(
    () => ASSET_CATEGORY_VALUES.filter((c) => utcDefs.some((d) => d.category === c)),
    [utcDefs],
  )

  const cards: UtcCard[] = useMemo(
    () =>
      utcDefs.map((def) => ({
        def,
        groups: groupsOf(def, enclaves),
        units: unitsOf(def.lines),
        byEnclave: utcUsesEnclaves(def.category),
      })),
    [utcDefs, enclaves],
  )

  /** A card survives the filter on its own name, or on a piece of gear it
   *  carries — people look for the UTC that brings a TACLANE more often than
   *  they look for one by its code. */
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cards.filter((c) => {
      if (category !== "all" && c.def.category !== category) return false
      if (!q) return true
      const own = [c.def.code, c.def.name, c.def.description ?? ""]
        .join(" ")
        .toLowerCase()
      if (own.includes(q)) return true
      return c.def.lines.some((l) =>
        `${l.equipment_type_title ?? ""} ${l.equipment_type_short_name ?? ""}`
          .toLowerCase()
          .includes(q),
      )
    })
  }, [cards, query, category])

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search code, name, or the gear inside…"
            className="pl-8"
            aria-label="Search UTC definitions"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              category === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            All
          </button>
          {presentCategories.map((c) => {
            const Icon = ASSET_CATEGORY_ICONS[c]
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c === category ? "all" : c)}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
                  category === c
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon className="size-3" />
                {ASSET_CATEGORY_LABELS[c]}
              </button>
            )
          })}
        </div>
      </div>

      {!isAdmin && (
        <p className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
          Global catalog rows are read-only for your role. You can still add
          workspace-local entries.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {visible.length === 0 && (
          <p className="mx-auto w-full max-w-lg rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {utcDefs.length === 0
              ? "No UTC definitions yet."
              : "Nothing matches that search."}
          </p>
        )}

        {visible.map((c) => (
          <Card
            key={c.def.id}
            className="mx-auto w-full max-w-lg [--card-spacing:--spacing(4)]"
          >
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <span>{c.def.name}</span>
                <CodeBadge code={c.def.code} tone="strong" />
              </CardTitle>
              {c.def.description && (
                <CardDescription>{c.def.description}</CardDescription>
              )}
              {c.def.is_global && (
                <CardAction>
                  <GlobalBadge />
                </CardAction>
              )}
            </CardHeader>

            {/* The enclaves this UTC supports, not its capabilities: every
                comm UTC can do voice and data, so that line said the same
                thing on every card. Which enclaves it carries is what tells
                them apart — and the capabilities are still a hover away,
                per enclave, where they mean something. */}
            <CardContent className="flex flex-wrap items-center gap-1.5">
              {c.groups.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  No equipment — this UTC definition is empty.
                </span>
              ) : c.byEnclave ? (
                <>
                  {c.groups.map((g) => (
                    <GroupPeek
                      key={g.key}
                      group={g}
                      label={g.enclave ? g.enclave.name : "Common"}
                      typesById={typesById}
                    >
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors",
                          g.enclave
                            ? enclaveChipClass(g.enclave.color)
                            : "border-border bg-muted/50 text-muted-foreground",
                        )}
                        style={
                          g.enclave ? enclaveChipStyle(g.enclave.color) : undefined
                        }
                      >
                        {g.enclave ? enclaveLabel(g.enclave) : "Common"}
                        <span className="tabular-nums opacity-70">
                          {g.units}
                        </span>
                      </span>
                    </GroupPeek>
                  ))}
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                    {c.units} item{c.units === 1 ? "" : "s"}
                  </span>
                </>
              ) : (
                // Nothing to divide by, so the count itself is the peek —
                // one affordance per card either way.
                <GroupPeek
                  group={c.groups[0]}
                  label={ASSET_CATEGORY_LABELS[c.def.category]}
                  typesById={typesById}
                >
                  <span className="text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground">
                    {c.units} item{c.units === 1 ? "" : "s"}
                  </span>
                </GroupPeek>
              )}
            </CardContent>

            <CardFooter className="border-t">
              {/* A styled Link rather than <Button render={<Link/>}>: this
                  navigates, so it has to stay a real anchor — middle-click and
                  open-in-new-tab have to read right to assistive tech. */}
              <Link
                href={w(`/admin/utcs/${c.def.id}`)}
                className={cn(buttonVariants({ variant: "outline" }), "w-full")}
              >
                Details
                <ArrowRight data-icon="inline-end" />
              </Link>
            </CardFooter>
          </Card>
        ))}
      </div>
    </>
  )
}
