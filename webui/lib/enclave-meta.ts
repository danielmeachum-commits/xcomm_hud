import type { Enclave } from "@/lib/types"

/** Enclave colors are stored as hex, not tailwind classes — the DB never holds
 *  class names in this codebase. That means enclave chips have to be styled
 *  inline rather than through a lookup table, unlike status or category. */
export function enclaveChipStyle(color: string | null): React.CSSProperties {
  if (!color) return {}
  return {
    // Low-alpha fill with a solid border of the same hue reads as a tag
    // without competing with the status colors that share these surfaces.
    backgroundColor: `${color}1f`,
    borderColor: `${color}80`,
    color: color,
  }
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
