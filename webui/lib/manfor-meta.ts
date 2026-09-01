// Static reference data for the MANFOR — the manpower half of a UTC.
//
// Kept out of `equipment-meta.ts` on purpose: that file is about gear, and a
// MANFOR is about people. What it shares is with `personnel-data.ts`, which is
// the point — a position states a requirement in the same units a person's
// record states the fact, so the two can be compared rather than parsed. That
// goes for how it is WRITTEN too: skill levels render through
// `skillLevelLabel` there rather than through a copy of it here, so a slot and
// the person who might fill it are never described in two different ways.

import type { UtcDefManforLine } from "@/lib/types"

/** Authorized strength: what the MANFOR adds up to in people, not in rows. A
 *  position calling for two technicians is two people. */
export function manforStrength(manfor: UtcDefManforLine[]): number {
  return manfor.reduce((a, p) => a + p.quantity, 0)
}

/** "5 people" — the strength said the way the LOGDET says "22 items". */
export function peopleLabel(n: number): string {
  return n === 1 ? "1 person" : `${n} people`
}

/** MANFOR order: the order the editor stored, which is the order whoever
 *  wrote it meant. Nothing is promoted above it — who leads the team is a fact
 *  about a deployment, not about the template. */
export function sortedManfor(manfor: UtcDefManforLine[]): UtcDefManforLine[] {
  return [...manfor].sort((a, b) => a.display_order - b.display_order)
}
