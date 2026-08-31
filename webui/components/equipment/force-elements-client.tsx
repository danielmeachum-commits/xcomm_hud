"use client"

import {
  ArrowRight,
  Boxes,
  CircleDot,
  CornerDownRight,
  Search,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { useMemo, useState } from "react"

import { CodeBadge } from "@/components/equipment/code-badge"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import { buttonVariants } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemActions,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import type { PackageDef, UtcDef, UtcRoleHint } from "@/lib/types"
import { cn } from "@/lib/utils"
import { useWorkspace } from "@/lib/workspace"

const ROLE_LABELS: Record<UtcRoleHint, string> = {
  primary: "Primary",
  extension: "Extension",
  either: "Any role",
}

/** The pair reads as a topology, because that is what the roles are: a primary
 *  is a node, an extension is something hanging off one — "takes signal off the
 *  primary UTC over an RF shot", in the seed data's own words. CircleDot is the
 *  node; CornerDownRight is the spur descending from it.
 *
 *  These replace the generic Boxes glyph every item used to carry. That icon
 *  was identical on every row and so said nothing; the role costs no space
 *  here because the slot was already being paid for. `either` keeps Boxes —
 *  the API's default role_hint genuinely means "no particular position". */
const ROLE_ICONS: Record<UtcRoleHint, LucideIcon> = {
  primary: CircleDot,
  extension: CornerDownRight,
  either: Boxes,
}

// ===================== derived shapes =====================

interface UtcRow {
  key: string
  def: UtcDef
  /** Null in the orphan section: a role is a property of package membership,
   *  not of the UTC, so a UTC in no package has none. */
  role: UtcRoleHint | null
  quantity: number
  haystack: string
}

interface PackageCard {
  key: string
  def: PackageDef
  utcs: UtcRow[]
  /** A search matched inside the list rather than on the package itself, so
   *  the answer is behind the trigger and the card should open itself. */
  openOnSearch: boolean
}

/** This page answers one question: which packages exist, and which UTCs does
 *  each carry in which role. What a UTC is *made of* — its enclaves, its
 *  equipment types, what they can do — is a different question with a different
 *  answer, so nothing here reads `def.lines`. The equipment catalog holds that
 *  view, and duplicating it here only made the force structure harder to see. */
function buildUtcRow(
  key: string,
  def: UtcDef,
  role: UtcRoleHint | null,
  quantity: number,
): UtcRow {
  return {
    key,
    def,
    role,
    quantity,
    haystack: [def.code, def.name, def.description ?? ""]
      .join(" ")
      .toLowerCase(),
  }
}

// ===================== small presentational pieces =====================

// ===================== the UTC item =====================

function UtcItem({ utc }: { utc: UtcRow }) {
  const RoleIcon = utc.role ? ROLE_ICONS[utc.role] : Boxes
  const roleLabel = utc.role ? ROLE_LABELS[utc.role] : "UTC"
  return (
    <Item variant="muted" className="items-start" title={roleLabel}>
      <ItemMedia variant="icon">
        <RoleIcon className="text-foreground" />
        {/* The glyph alone is unlabelled, so the word stays available to
            screen readers and on hover even though it no longer prints. */}
        <span className="sr-only">{roleLabel}</span>
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex-wrap gap-2">
          <span>{utc.def.name}</span>
          <CodeBadge code={utc.def.code} />
        </ItemTitle>
        {utc.def.description && (
          <ItemDescription className="line-clamp-none">
            {utc.def.description}
          </ItemDescription>
        )}
      </ItemContent>
      {utc.quantity > 1 && (
        <ItemActions>
          <span className="font-mono text-xs text-muted-foreground">
            ×{utc.quantity}
          </span>
        </ItemActions>
      )}
    </Item>
  )
}

// ===================== the page =====================

interface Props {
  utcDefs: UtcDef[]
  packageDefs: PackageDef[]
}

export function ForceElementsClient({ utcDefs, packageDefs }: Props) {
  const { w } = useWorkspace()
  const [query, setQuery] = useState("")

  const q = query.trim().toLowerCase()

  const utcById = useMemo(
    () => new Map(utcDefs.map((d) => [d.id, d])),
    [utcDefs],
  )

  const cards: PackageCard[] = useMemo(
    () =>
      packageDefs.map((p) => ({
        key: `p${p.id}`,
        def: p,
        openOnSearch: false,
        utcs: p.utcs
          .map((link) => {
            const def = utcById.get(link.utc_def_id)
            return def
              ? buildUtcRow(
                  `p${p.id}-u${link.id}`,
                  def,
                  link.role_hint,
                  link.quantity,
                )
              : null
          })
          .filter((u): u is UtcRow => u !== null),
      })),
    [packageDefs, utcById],
  )

  /** UTC definitions no package composes. They exist, they cost money, and the
   *  old catalog's flat table was the only place they showed up — dropping them
   *  here would make a real row invisible. */
  const orphans: UtcRow[] = useMemo(() => {
    const used = new Set(
      packageDefs.flatMap((p) => p.utcs.map((u) => u.utc_def_id)),
    )
    return utcDefs
      .filter((d) => !used.has(d.id))
      .map((d) => buildUtcRow(`o${d.id}`, d, null, 1))
  }, [packageDefs, utcDefs])

  /** A card survives the filter on its own name, or on a UTC it carries. When
   *  the package itself matched, every UTC stays — you asked for that package,
   *  not for a slice of it. Otherwise only the UTCs that matched remain. */
  const visibleCards = useMemo(() => {
    if (!q) return cards
    return cards
      .map((c) => {
        const own = [c.def.code, c.def.name, c.def.description ?? ""]
          .join(" ")
          .toLowerCase()
        // Matching the package by name keeps every UTC, but the hit may still
        // be inside the list — open it either way when one of them matches.
        const hit = c.utcs.filter((u) => u.haystack.includes(q))
        if (own.includes(q)) return { ...c, openOnSearch: hit.length > 0 }
        return hit.length > 0
          ? { ...c, utcs: hit, openOnSearch: true }
          : null
      })
      .filter((c): c is PackageCard => c !== null)
  }, [cards, q])

  const visibleOrphans = useMemo(
    () => (q ? orphans.filter((u) => u.haystack.includes(q)) : orphans),
    [orphans, q],
  )

  const nothingMatched = visibleCards.length === 0 && visibleOrphans.length === 0

  return (
    <div className="flex flex-col gap-4">
      <div className="relative mx-auto w-full max-w-lg">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search package or UTC…"
          className="pl-8"
          aria-label="Search force elements"
        />
      </div>

      {nothingMatched && (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {packageDefs.length === 0 && utcDefs.length === 0
            ? "No packages or UTC definitions yet."
            : "Nothing matches that search."}
        </p>
      )}

      {visibleCards.map((c) => (
        <Card
          key={c.key}
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

          </CardHeader>
          <CardContent>
            {c.utcs.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No UTCs — this package definition is empty.
              </p>
            ) : (
              <Accordion
                // Remounting on a query change lets `defaultValue` do the work:
                // a card whose match is inside the list opens itself, and the
                // reader can still collapse it without the page arguing back.
                key={`${c.key}|${q}`}
                defaultValue={c.openOnSearch ? ["utcs"] : []}
                className="rounded-none border-0"
              >
                <AccordionItem
                  value="utcs"
                  // shadcn's AccordionItem tints itself with
                  // `data-open:bg-muted/50` while open. That reads as a
                  // selected panel in a stack of them; here the accordion IS
                  // the card body, so expanding it repainted the card.
                  className="border-b-0 data-open:bg-transparent"
                >
                  <AccordionTrigger className="items-center p-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:no-underline">
                    {c.utcs.length} {c.utcs.length === 1 ? "UTC" : "UTCs"}
                  </AccordionTrigger>
                  <AccordionContent
                    // shadcn hardcodes px-4 on the panel and routes this
                    // className to the inner div, so the padding cannot be
                    // overridden directly. The negative margin pulls the
                    // content back out to the padding edge — flush with the
                    // trigger — without clipping, since overflow-hidden cuts
                    // at the padding box, not the content box.
                    className="-mx-4 pt-3 pb-0"
                  >
                    {/* No separators: ItemGroup's own gap already parts the
                        items, and each one is a filled block with its own role
                        header — a rule between them was a third divider doing
                        work the first two had done. */}
                    <ItemGroup>
                      {c.utcs.map((u) => (
                        <UtcItem key={u.key} utc={u} />
                      ))}
                    </ItemGroup>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}
          </CardContent>
          {/* Footer rather than the header's action slot: at the end of the
              card it sits where the eye already is after reading the UTCs, and
              full width it cannot be skimmed past. */}
          <CardFooter className="border-t">
            {/* A styled Link rather than <Button render={<Link/>}>: this
                navigates, so it has to stay a real anchor. Button's Base UI
                primitive either warns about losing button semantics or, with
                nativeButton={false}, stamps role="button" over the link role —
                and then middle-click and open-in-new-tab read wrong to
                assistive tech. buttonVariants gives the same styling on an
                honest <a>. */}
            <Link
              href={w(`/admin/force-elements/${c.def.id}`)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "w-full",
              )}
            >
              Details
              <ArrowRight data-icon="inline-end" />
            </Link>
          </CardFooter>
        </Card>
      ))}

      {visibleOrphans.length > 0 && (
        <>
          <div className="mx-auto flex w-full max-w-lg items-center gap-3 pt-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Not in any package
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
          {/* One card each, same shape as a package card: a UTC that no package
              composes is still a force element in its own right, not a footnote
              to the ones that are. */}
          {visibleOrphans.map((u) => (
            <Card
              key={u.key}
              className="mx-auto w-full max-w-lg [--card-spacing:--spacing(8)]"
            >
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span>{u.def.name}</span>
                  <CodeBadge code={u.def.code} />
                </CardTitle>
                {u.def.description && (
                  <CardDescription>{u.def.description}</CardDescription>
                )}
              </CardHeader>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}
