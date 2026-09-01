import { CodeBadge } from "@/components/equipment/code-badge"
import { HorizontalScroller } from "@/components/ui/horizontal-scroller"
import { Item, ItemActions, ItemContent, ItemGroup, ItemTitle } from "@/components/ui/item"
import {
  enclaveHeadingClass,
  enclaveHeadingStyle,
} from "@/lib/enclave-meta"
import { utcEnclaveColumns, utcUsesEnclaves } from "@/lib/equipment-meta"
import type { Enclave, UtcDef, UtcDefLine } from "@/lib/types"
import { cn } from "@/lib/utils"

/** A UTC definition's bill of materials, read-only.
 *
 *  Shared by the definition page and the peek sheet on the package page, so
 *  the two can never describe the same UTC differently. Reads the line's
 *  denormalized `equipment_type_title` rather than taking a catalog prop —
 *  the API already sends it, and a component that needs the whole catalog to
 *  render one UTC can't be dropped into a sheet.
 *
 *  Comm UTCs divide by enclave and get columns; everything else gets one list.
 *  See `utcUsesEnclaves`. */
export function UtcDefContents({
  def,
  enclaves,
  className,
}: {
  def: UtcDef
  enclaves: Enclave[]
  className?: string
}) {
  const lines = [...def.lines].sort((a, b) => a.display_order - b.display_order)

  if (lines.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        No equipment — this UTC definition is empty.
      </p>
    )
  }

  if (!utcUsesEnclaves(def.category)) {
    return (
      <ItemGroup className={className}>
        {lines.map((l) => (
          <LineItem key={l.id} line={l} />
        ))}
      </ItemGroup>
    )
  }

  const columns = utcEnclaveColumns(def, enclaves)

  return (
    <HorizontalScroller
      label={`${def.code} bill of materials, by enclave`}
      className={cn("flex items-start gap-4 pb-2", className)}
    >
      {columns.map((c) => (
        <div
          key={c.enclave?.id ?? "common"}
          className="flex w-60 shrink-0 flex-col gap-2"
        >
          <ColumnHeading
            enclave={c.enclave}
            units={c.lines.reduce((a, l) => a + l.quantity, 0)}
          />
          <ItemGroup>
            {c.lines.map((l) => (
              <LineItem key={l.id} line={l} />
            ))}
          </ItemGroup>
        </div>
      ))}
    </HorizontalScroller>
  )
}

/** The enclave's hue as text over a rule, with no fill or border box — a chip
 *  is a label attached to a thing, and repeating it as every column's header
 *  turns the board into a field of pills. Matches `enclaveHeadingStyle`. */
export function ColumnHeading({
  enclave,
  units,
}: {
  enclave: Enclave | null
  /** Total pieces in the column, not rows — a column of one line calling for
   *  24 cables is 24 items. */
  units: number
}) {
  return (
    <div className="flex items-baseline gap-2 border-b border-border px-1 pb-1.5">
      <h3
        className={cn(
          "text-xs font-semibold",
          enclave ? enclaveHeadingClass(enclave.color) : "text-muted-foreground",
        )}
        style={enclave ? enclaveHeadingStyle(enclave.color) : undefined}
      >
        {enclave ? enclave.name : "Common"}
      </h3>
      {units > 0 && (
        <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
          {units} item{units === 1 ? "" : "s"}
        </span>
      )}
    </div>
  )
}

/** A quantity of one prints nothing: it's the default, and "×1" is a number to
 *  decode rather than a fact to read. */
function LineItem({ line }: { line: UtcDefLine }) {
  return (
    <Item variant="muted" size="sm">
      {/* `min-w-0` because Item is flex-wrap and ItemContent is flex-1 with the
          default `min-width: auto` — without it a long title can't shrink below
          its min-content width and shoves the quantity onto its own line. */}
      <ItemContent className="min-w-0">
        <ItemTitle className="flex-wrap gap-2">
          <span className="truncate">
            {line.equipment_type_title ?? "Unknown equipment type"}
          </span>
          {line.equipment_type_short_name && (
            <CodeBadge code={line.equipment_type_short_name} />
          )}
        </ItemTitle>
      </ItemContent>
      {line.quantity > 1 && (
        <ItemActions>
          <span className="text-xs tabular-nums text-muted-foreground">
            ×{line.quantity}
          </span>
        </ItemActions>
      )}
    </Item>
  )
}
