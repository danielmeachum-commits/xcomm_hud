import type { Enclave } from "@/lib/types"

/** Relative luminance, 0 (black) to 1 (white). Only used to decide whether a
 *  color is too dark to render as itself against a dark background. */
function luminance(hex: string): number {
  const h = hex.replace("#", "")
  if (h.length !== 6) return 0.5
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** True when a color can't be rendered literally in both themes — black is the
 *  transport layer's color, and a black chip is invisible on a dark canvas.
 *  These fall back to theme tokens so "black" reads as the foreground color:
 *  black in light mode, near-white in dark. */
export function isNeutralEnclaveColor(color: string | null): boolean {
  return !color || luminance(color) < 0.12
}

/** Enclave colors are stored as hex, not tailwind classes — the DB never holds
 *  class names in this codebase. That means enclave chips are styled inline
 *  rather than through a lookup table, unlike status or category.
 *
 *  Returns {} for neutral colors; pair with `enclaveChipClass` so those render
 *  from theme tokens instead. */
export function enclaveChipStyle(color: string | null): React.CSSProperties {
  if (isNeutralEnclaveColor(color) || !color) return {}
  return {
    // Low-alpha fill with a solid border of the same hue reads as a tag
    // without competing with the status colors that share these surfaces.
    backgroundColor: `${color}1f`,
    borderColor: `${color}80`,
    color: color,
  }
}

/** Classes to apply alongside `enclaveChipStyle`. Empty for colors rendered
 *  literally; theme-token classes for neutral ones. */
export function enclaveChipClass(color: string | null): string {
  return isNeutralEnclaveColor(color)
    ? "border-foreground/40 bg-foreground/10 text-foreground"
    : ""
}

/** Style for an enclave used as a GROUP HEADING rather than as a tag.
 *
 *  A chip is a label attached to a thing. Repeating it as the header of every
 *  group turns a page into a field of pills and loses the one job a heading
 *  has, which is to sit quietly above its contents. This keeps the enclave's
 *  hue as text and a rule, with no fill or border box.
 *
 *  Returns {} for neutral colors, same contract as `enclaveChipStyle` — pair
 *  it with `enclaveHeadingClass`. */
export function enclaveHeadingStyle(color: string | null): React.CSSProperties {
  if (isNeutralEnclaveColor(color) || !color) return {}
  return { color }
}

export function enclaveHeadingClass(color: string | null): string {
  return isNeutralEnclaveColor(color) ? "text-foreground" : ""
}

export function enclaveLabel(e: Enclave): string {
  return e.short_name || e.name
}

/** Depth of an enclave in the parent chain, for indenting a flat list into a
 *  tree. Guards against a cycle the API should have rejected — a bad row must
 *  render wrong, not hang the page. */
export function enclaveDepth(
  enclave: Enclave,
  byId: Map<number, Enclave>,
): number {
  let depth = 0
  const seen = new Set<number>([enclave.id])
  let cursor = enclave.parent_id ? byId.get(enclave.parent_id) : undefined
  while (cursor && depth < 8) {
    if (seen.has(cursor.id)) break
    seen.add(cursor.id)
    depth++
    cursor = cursor.parent_id ? byId.get(cursor.parent_id) : undefined
  }
  return depth
}

/** Flat list ordered so children follow their parent, for tree rendering.
 *  Roots keep their `display_order`; orphans (parent retired or invisible)
 *  surface at the top level rather than disappearing. */
export function enclaveTreeOrder(enclaves: Enclave[]): Enclave[] {
  const byId = new Map(enclaves.map((e) => [e.id, e]))
  const children = new Map<number | null, Enclave[]>()
  for (const e of enclaves) {
    const key = e.parent_id && byId.has(e.parent_id) ? e.parent_id : null
    const bucket = children.get(key)
    if (bucket) bucket.push(e)
    else children.set(key, [e])
  }
  const out: Enclave[] = []
  const visit = (parentId: number | null, guard: number) => {
    if (guard > 8) return
    const bucket = children.get(parentId) ?? []
    for (const e of bucket) {
      out.push(e)
      visit(e.id, guard + 1)
    }
  }
  visit(null, 0)
  // Anything unreachable (only possible via a cycle) still gets rendered.
  if (out.length < enclaves.length) {
    const emitted = new Set(out.map((e) => e.id))
    out.push(...enclaves.filter((e) => !emitted.has(e.id)))
  }
  return out
}
