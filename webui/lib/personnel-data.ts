// Static reference data for personnel — branches, ranks, colors, icons.
// Mirrors api/personnel_data.py; keep them aligned.

import {
  Anchor,
  LifeBuoy,
  Plane,
  Rocket,
  Shield,
  Star,
  User,
  type LucideIcon,
} from "lucide-react"

import { formatDurationShort } from "@/lib/time"

export type Branch =
  | "air_force"
  | "army"
  | "navy"
  | "marines"
  | "space_force"
  | "coast_guard"

export type PersonnelType = "military" | "civilian"

export interface RankEntry {
  grade: string // E-1, O-3, W-2, GS-13, etc.
  short: string // abbreviation shown on the pill (must be unique per branch)
  full: string // long form for the picker
  // Filename stem (no extension) under /insignia/ranks/{branch}/. Omitted when
  // no insignia exists (e.g. E-1 Airman Basic) — resolver falls back to the
  // branch lucide icon. Named to match the files actually on disk, which use
  // a {grade}-{descriptive-name} scheme rather than the abbreviation.
  insignia?: string
}

export const BRANCHES: Branch[] = [
  "air_force",
  "army",
  "navy",
  "marines",
  "space_force",
  "coast_guard",
]

export const BRANCH_LABELS: Record<Branch, string> = {
  air_force: "Air Force",
  army: "Army",
  navy: "Navy",
  marines: "Marine Corps",
  space_force: "Space Force",
  coast_guard: "Coast Guard",
}

// Service colors used for the personnel pill background and accents. Chosen
// for contrast on both light and dark backgrounds — text is always rendered
// white so the pill reads at a glance.
export const BRANCH_COLORS: Record<Branch | "civilian", string> = {
  air_force: "#00308F", // USAF blue
  army: "#4B5320", // OD green
  navy: "#000080", // Navy blue
  marines: "#8B0000", // Scarlet
  space_force: "#1D2951", // Space Force dark navy
  coast_guard: "#003366", // Coast Guard dark blue
  civilian: "#4B5563", // neutral slate
}

export const BRANCH_ICONS: Record<Branch | "civilian", LucideIcon> = {
  air_force: Plane,
  army: Shield,
  navy: Anchor,
  marines: Star,
  space_force: Rocket,
  coast_guard: LifeBuoy,
  civilian: User,
}

// insignia stems match the files in /insignia/ranks/air_force/. E-1 has no
// insignia (blank sleeve) so it falls back to the branch icon. First Sergeant
// is a special duty (diamond in the chevron) held by an E-7/E-8/E-9 — carried
// as distinct selectable entries with a ◆ marker so the right insignia renders.
const AF_ENLISTED: RankEntry[] = [
  { grade: "E-1", short: "AB", full: "Airman Basic" },
  { grade: "E-2", short: "Amn", full: "Airman", insignia: "E-2-airman" },
  { grade: "E-3", short: "A1C", full: "Airman First Class", insignia: "E-3-airman-first-class" },
  { grade: "E-4", short: "SrA", full: "Senior Airman", insignia: "E-4-senior-airman" },
  { grade: "E-5", short: "SSgt", full: "Staff Sergeant", insignia: "E-5-staff-sergeant" },
  { grade: "E-6", short: "TSgt", full: "Technical Sergeant", insignia: "E-6-technical-sergeant" },
  { grade: "E-7", short: "MSgt", full: "Master Sergeant", insignia: "E-7-master-sergeant" },
  { grade: "E-7", short: "MSgt ◆", full: "Master Sergeant (First Sergeant)", insignia: "E-7-master-sergeant-First-Sergeant" },
  { grade: "E-8", short: "SMSgt", full: "Senior Master Sergeant", insignia: "E-8-senior-master-sergeant" },
  { grade: "E-8", short: "SMSgt ◆", full: "Senior Master Sergeant (First Sergeant)", insignia: "E-8-senior-master-sergeant-First-Sergeant" },
  { grade: "E-9", short: "CMSgt", full: "Chief Master Sergeant", insignia: "E-9-chief-master-sergeant" },
  { grade: "E-9", short: "CMSgt ◆", full: "Chief Master Sergeant (First Sergeant)", insignia: "E-9-chief-master-sergeant-First-Sergeant" },
  { grade: "E-9", short: "CCM", full: "Command Chief Master Sergeant", insignia: "E-9-command-chief-master-sergeant" },
  { grade: "E-9", short: "CMSAF", full: "Chief Master Sergeant of the Air Force", insignia: "E-9-chief-master-sergeant-of-the-air-force" },
]

// The Air Force reintroduced warrant officers in 2024 (cyber / IT specialties).
const AF_WARRANT: RankEntry[] = [
  { grade: "W-1", short: "WO1", full: "Warrant Officer 1", insignia: "W1-warrant-officer-1" },
  { grade: "W-2", short: "CW2", full: "Chief Warrant Officer 2", insignia: "W2-chief-warrant-officer-2" },
  { grade: "W-3", short: "CW3", full: "Chief Warrant Officer 3", insignia: "W3-chief-warrant-officer-3" },
  { grade: "W-4", short: "CW4", full: "Chief Warrant Officer 4", insignia: "W4-chief-warrant-officer-4" },
  { grade: "W-5", short: "CW5", full: "Chief Warrant Officer 5", insignia: "W5-chief-warrant-officer-5" },
]

const AF_OFFICER: RankEntry[] = [
  { grade: "O-1", short: "2d Lt", full: "Second Lieutenant", insignia: "O-1-second-lieutenant" },
  { grade: "O-2", short: "1st Lt", full: "First Lieutenant", insignia: "O-2-first-lieutenant" },
  { grade: "O-3", short: "Capt", full: "Captain", insignia: "O-3-captain" },
  { grade: "O-4", short: "Maj", full: "Major", insignia: "O-4-major" },
  { grade: "O-5", short: "Lt Col", full: "Lieutenant Colonel", insignia: "O-5-lieutenant-colonel" },
  { grade: "O-6", short: "Col", full: "Colonel", insignia: "O-6-colonel" },
  { grade: "O-7", short: "Brig Gen", full: "Brigadier General", insignia: "O-7-Brigadier-General" },
  { grade: "O-8", short: "Maj Gen", full: "Major General", insignia: "O-8-Major-General" },
  { grade: "O-9", short: "Lt Gen", full: "Lieutenant General", insignia: "O-9-Lieutenant-General" },
  { grade: "O-10", short: "Gen", full: "General", insignia: "O-10-General" },
  // Five-star wartime rank — only ever held by Hap Arnold. Included because the
  // insignia file exists; harmless to keep at the bottom of the picker.
  { grade: "Special", short: "GAF", full: "General of the Air Force", insignia: "General-of-the-Air-Force" },
]

const SF_ENLISTED: RankEntry[] = [
  { grade: "E-1", short: "Spc1", full: "Specialist 1" },
  { grade: "E-2", short: "Spc2", full: "Specialist 2" },
  { grade: "E-3", short: "Spc3", full: "Specialist 3" },
  { grade: "E-4", short: "Spc4", full: "Specialist 4" },
  { grade: "E-5", short: "Sgt", full: "Sergeant" },
  { grade: "E-6", short: "TSgt", full: "Technical Sergeant" },
  { grade: "E-7", short: "MSgt", full: "Master Sergeant" },
  { grade: "E-8", short: "SMSgt", full: "Senior Master Sergeant" },
  { grade: "E-9", short: "CMSgt", full: "Chief Master Sergeant" },
]

const ARMY_ENLISTED: RankEntry[] = [
  { grade: "E-1", short: "PVT", full: "Private" },
  { grade: "E-2", short: "PV2", full: "Private Second Class" },
  { grade: "E-3", short: "PFC", full: "Private First Class" },
  { grade: "E-4", short: "SPC", full: "Specialist" },
  { grade: "E-4", short: "CPL", full: "Corporal" },
  { grade: "E-5", short: "SGT", full: "Sergeant" },
  { grade: "E-6", short: "SSG", full: "Staff Sergeant" },
  { grade: "E-7", short: "SFC", full: "Sergeant First Class" },
  { grade: "E-8", short: "MSG", full: "Master Sergeant" },
  { grade: "E-8", short: "1SG", full: "First Sergeant" },
  { grade: "E-9", short: "SGM", full: "Sergeant Major" },
  { grade: "E-9", short: "CSM", full: "Command Sergeant Major" },
  { grade: "E-9", short: "SMA", full: "Sergeant Major of the Army" },
]

const ARMY_WARRANT: RankEntry[] = [
  { grade: "W-1", short: "WO1", full: "Warrant Officer 1" },
  { grade: "W-2", short: "CW2", full: "Chief Warrant Officer 2" },
  { grade: "W-3", short: "CW3", full: "Chief Warrant Officer 3" },
  { grade: "W-4", short: "CW4", full: "Chief Warrant Officer 4" },
  { grade: "W-5", short: "CW5", full: "Chief Warrant Officer 5" },
]

const ARMY_OFFICER: RankEntry[] = [
  { grade: "O-1", short: "2LT", full: "Second Lieutenant" },
  { grade: "O-2", short: "1LT", full: "First Lieutenant" },
  { grade: "O-3", short: "CPT", full: "Captain" },
  { grade: "O-4", short: "MAJ", full: "Major" },
  { grade: "O-5", short: "LTC", full: "Lieutenant Colonel" },
  { grade: "O-6", short: "COL", full: "Colonel" },
  { grade: "O-7", short: "BG", full: "Brigadier General" },
  { grade: "O-8", short: "MG", full: "Major General" },
  { grade: "O-9", short: "LTG", full: "Lieutenant General" },
  { grade: "O-10", short: "GEN", full: "General" },
]

const NAVY_ENLISTED: RankEntry[] = [
  { grade: "E-1", short: "SR", full: "Seaman Recruit" },
  { grade: "E-2", short: "SA", full: "Seaman Apprentice" },
  { grade: "E-3", short: "SN", full: "Seaman" },
  { grade: "E-4", short: "PO3", full: "Petty Officer Third Class" },
  { grade: "E-5", short: "PO2", full: "Petty Officer Second Class" },
  { grade: "E-6", short: "PO1", full: "Petty Officer First Class" },
  { grade: "E-7", short: "CPO", full: "Chief Petty Officer" },
  { grade: "E-8", short: "SCPO", full: "Senior Chief Petty Officer" },
  { grade: "E-9", short: "MCPO", full: "Master Chief Petty Officer" },
  {
    grade: "E-9",
    short: "MCPON",
    full: "Master Chief Petty Officer of the Navy",
  },
]

const NAVY_WARRANT: RankEntry[] = [
  { grade: "W-2", short: "CWO2", full: "Chief Warrant Officer 2" },
  { grade: "W-3", short: "CWO3", full: "Chief Warrant Officer 3" },
  { grade: "W-4", short: "CWO4", full: "Chief Warrant Officer 4" },
  { grade: "W-5", short: "CWO5", full: "Chief Warrant Officer 5" },
]

const NAVY_OFFICER: RankEntry[] = [
  { grade: "O-1", short: "ENS", full: "Ensign" },
  { grade: "O-2", short: "LTJG", full: "Lieutenant Junior Grade" },
  { grade: "O-3", short: "LT", full: "Lieutenant" },
  { grade: "O-4", short: "LCDR", full: "Lieutenant Commander" },
  { grade: "O-5", short: "CDR", full: "Commander" },
  { grade: "O-6", short: "CAPT", full: "Captain" },
  { grade: "O-7", short: "RDML", full: "Rear Admiral (Lower Half)" },
  { grade: "O-8", short: "RADM", full: "Rear Admiral" },
  { grade: "O-9", short: "VADM", full: "Vice Admiral" },
  { grade: "O-10", short: "ADM", full: "Admiral" },
]

const MARINES_ENLISTED: RankEntry[] = [
  { grade: "E-1", short: "Pvt", full: "Private" },
  { grade: "E-2", short: "PFC", full: "Private First Class" },
  { grade: "E-3", short: "LCpl", full: "Lance Corporal" },
  { grade: "E-4", short: "Cpl", full: "Corporal" },
  { grade: "E-5", short: "Sgt", full: "Sergeant" },
  { grade: "E-6", short: "SSgt", full: "Staff Sergeant" },
  { grade: "E-7", short: "GySgt", full: "Gunnery Sergeant" },
  { grade: "E-8", short: "MSgt", full: "Master Sergeant" },
  { grade: "E-8", short: "1stSgt", full: "First Sergeant" },
  { grade: "E-9", short: "MGySgt", full: "Master Gunnery Sergeant" },
  { grade: "E-9", short: "SgtMaj", full: "Sergeant Major" },
  {
    grade: "E-9",
    short: "SgtMajMC",
    full: "Sergeant Major of the Marine Corps",
  },
]

const MARINES_WARRANT: RankEntry[] = [
  { grade: "W-1", short: "WO", full: "Warrant Officer" },
  { grade: "W-2", short: "CWO2", full: "Chief Warrant Officer 2" },
  { grade: "W-3", short: "CWO3", full: "Chief Warrant Officer 3" },
  { grade: "W-4", short: "CWO4", full: "Chief Warrant Officer 4" },
  { grade: "W-5", short: "CWO5", full: "Chief Warrant Officer 5" },
]

const MARINES_OFFICER: RankEntry[] = [
  { grade: "O-1", short: "2ndLt", full: "Second Lieutenant" },
  { grade: "O-2", short: "1stLt", full: "First Lieutenant" },
  { grade: "O-3", short: "Capt", full: "Captain" },
  { grade: "O-4", short: "Maj", full: "Major" },
  { grade: "O-5", short: "LtCol", full: "Lieutenant Colonel" },
  { grade: "O-6", short: "Col", full: "Colonel" },
  { grade: "O-7", short: "BGen", full: "Brigadier General" },
  { grade: "O-8", short: "MajGen", full: "Major General" },
  { grade: "O-9", short: "LtGen", full: "Lieutenant General" },
  { grade: "O-10", short: "Gen", full: "General" },
]

const COAST_GUARD_ENLISTED: RankEntry[] = [
  { grade: "E-1", short: "SR", full: "Seaman Recruit" },
  { grade: "E-2", short: "SA", full: "Seaman Apprentice" },
  { grade: "E-3", short: "SN", full: "Seaman" },
  { grade: "E-4", short: "PO3", full: "Petty Officer Third Class" },
  { grade: "E-5", short: "PO2", full: "Petty Officer Second Class" },
  { grade: "E-6", short: "PO1", full: "Petty Officer First Class" },
  { grade: "E-7", short: "CPO", full: "Chief Petty Officer" },
  { grade: "E-8", short: "SCPO", full: "Senior Chief Petty Officer" },
  { grade: "E-9", short: "MCPO", full: "Master Chief Petty Officer" },
  {
    grade: "E-9",
    short: "MCPOCG",
    full: "Master Chief Petty Officer of the Coast Guard",
  },
]

export const RANKS_BY_BRANCH: Record<Branch, RankEntry[]> = {
  air_force: [...AF_ENLISTED, ...AF_WARRANT, ...AF_OFFICER],
  army: [...ARMY_ENLISTED, ...ARMY_WARRANT, ...ARMY_OFFICER],
  navy: [...NAVY_ENLISTED, ...NAVY_WARRANT, ...NAVY_OFFICER],
  marines: [...MARINES_ENLISTED, ...MARINES_WARRANT, ...MARINES_OFFICER],
  space_force: [...SF_ENLISTED, ...AF_OFFICER],
  coast_guard: [...COAST_GUARD_ENLISTED, ...NAVY_OFFICER],
}

export const CIVILIAN_RANKS: RankEntry[] = [
  ...Array.from({ length: 15 }, (_, i) => {
    const n = i + 1
    return {
      grade: `GS-${n}`,
      short: `GS-${n}`,
      full: `General Schedule ${n}`,
    }
  }),
  { grade: "SES", short: "SES", full: "Senior Executive Service" },
  { grade: "SL", short: "SL", full: "Senior Level" },
  { grade: "ST", short: "ST", full: "Scientific/Technical" },
]

export const DEFAULT_BRANCH: Branch = "air_force"

export function ranksFor(
  personnelType: PersonnelType,
  branch: Branch | null,
): RankEntry[] {
  if (personnelType === "civilian") return CIVILIAN_RANKS
  if (!branch) return RANKS_BY_BRANCH.air_force
  return RANKS_BY_BRANCH[branch]
}

export interface RankGroup {
  label: string
  ranks: RankEntry[]
}

function rankTier(grade: string): "enlisted" | "warrant" | "officer" | "other" {
  if (grade.startsWith("E-")) return "enlisted"
  if (grade.startsWith("W-")) return "warrant"
  if (grade.startsWith("O-")) return "officer"
  return "other"
}

/** Ranks split into Enlisted / Warrant / Officer sections for a grouped
 *  <select>. Civilians get a single "Civilian" group. Empty groups are
 *  dropped so branches without warrant officers don't render an empty header. */
export function groupedRanks(
  personnelType: PersonnelType,
  branch: Branch | null,
): RankGroup[] {
  if (personnelType === "civilian") {
    return [{ label: "Civilian", ranks: CIVILIAN_RANKS }]
  }
  const all = ranksFor(personnelType, branch)
  const buckets: { label: string; tier: string }[] = [
    { label: "Enlisted", tier: "enlisted" },
    { label: "Warrant Officer", tier: "warrant" },
    { label: "Officer", tier: "officer" },
    { label: "Other", tier: "other" },
  ]
  return buckets
    .map((b) => ({
      label: b.label,
      ranks: all.filter((r) => rankTier(r.grade) === b.tier),
    }))
    .filter((g) => g.ranks.length > 0)
}

/** Label for a rank option in the picker: "E-5 · SSgt — Staff Sergeant".
 *  Grade "Special" is dropped from the prefix since it isn't a pay grade. */
export function rankOptionLabel(r: RankEntry): string {
  const gradePrefix = r.grade === "Special" ? "" : `${r.grade} · `
  return `${gradePrefix}${r.short} — ${r.full}`
}

// --- AFSC skill levels (Air Force enlisted) ---

export const SKILL_LEVELS = [1, 3, 5, 7, 9] as const
export type SkillLevel = (typeof SKILL_LEVELS)[number]

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  1: "Helper",
  3: "Apprentice",
  5: "Journeyman",
  7: "Craftsman",
  9: "Superintendent",
}

/** "7 — Craftsman" for display; null-safe for people without one. */
export function skillLevelLabel(level: number | null): string | null {
  if (level == null) return null
  const name = SKILL_LEVEL_LABELS[level as SkillLevel]
  return name ? `${level} — ${name}` : String(level)
}

/** Pay grade for a person's rank ("E-5", "O-3", …), from the branch catalog.
 *  Falls back to parsing the rank string itself (covers civilian "GS-13" and
 *  freeform CSV values shaped like a grade). */
export function rankGrade(
  personnelType: PersonnelType,
  branch: Branch | null,
  rank: string | null,
): string | null {
  if (!rank) return null
  const entry = ranksFor(personnelType, branch).find((r) => r.short === rank)
  if (entry) return entry.grade
  return /^(?:E|O|W|GS)-\d+$/.test(rank) ? rank : null
}

/** Commissioned/warrant officers (grade O-x, W-x, or a five-star Special).
 *  Gates commander eligibility and the org chart's officer section. */
export function isOfficerGrade(
  personnelType: PersonnelType,
  branch: Branch | null,
  rank: string | null,
): boolean {
  const grade = rankGrade(personnelType, branch, rank)
  return (
    grade != null &&
    (grade === "Special" || grade.startsWith("O-") || grade.startsWith("W-"))
  )
}

/** First sergeants — the AF diamond special-duty variants ("MSgt ◆" …) or
 *  the branches where First Sergeant is itself a rank (Army 1SG, Marine
 *  1stSgt). Matched via the catalog's full rank name. */
export function isFirstSergeantRank(
  personnelType: PersonnelType,
  branch: Branch | null,
  rank: string | null,
): boolean {
  if (!rank) return false
  const entry = ranksFor(personnelType, branch).find((r) => r.short === rank)
  return entry?.full.includes("First Sergeant") ?? false
}

/** Skill levels only apply to Air Force enlisted members. */
export function skillLevelApplies(
  personnelType: PersonnelType,
  branch: Branch | null,
  rank: string | null,
): boolean {
  if (personnelType !== "military" || branch !== "air_force") return false
  return rankGrade(personnelType, branch, rank)?.startsWith("E-") ?? false
}

/** Typical skill level by grade: E-4 & below 5, E-5/E-6 7, E-7 & up 9.
 *  A suggestion only — members in training hold 1/3, so the form lets the
 *  user override. */
export function defaultSkillLevel(
  personnelType: PersonnelType,
  branch: Branch | null,
  rank: string | null,
): SkillLevel | null {
  if (!skillLevelApplies(personnelType, branch, rank)) return null
  const grade = rankGrade(personnelType, branch, rank)
  const n = Number(grade?.slice(2))
  if (!Number.isFinite(n)) return null
  if (n <= 4) return 5
  if (n <= 6) return 7
  return 9
}

/** Sort key for rank seniority — higher is more senior. Officers over
 *  warrants over enlisted; SES/SL/ST over GS; unknown ranks sort last. */
export function rankSeniority(
  personnelType: PersonnelType,
  branch: Branch | null,
  rank: string | null,
): number {
  const grade = rankGrade(personnelType, branch, rank)
  if (!grade) return 0
  if (grade === "Special") return 311 // five-star, above O-10
  // Senior civilian tiers sit above the GS ladder but below military ranks.
  if (grade === "SES") return 62
  if (grade === "SL") return 61
  if (grade === "ST") return 60
  const n = Number(grade.slice(grade.indexOf("-") + 1))
  if (!Number.isFinite(n)) return 0
  if (grade.startsWith("O-")) return 300 + n
  if (grade.startsWith("W-")) return 200 + n
  if (grade.startsWith("E-")) return 100 + n
  if (grade.startsWith("GS-")) return n // civilian ladder, below military
  return 0
}

export function branchColor(
  branch: Branch | null,
  personnelType: PersonnelType,
): string {
  if (personnelType === "civilian" || !branch) return BRANCH_COLORS.civilian
  return BRANCH_COLORS[branch]
}

export function branchIcon(
  branch: Branch | null,
  personnelType: PersonnelType,
): LucideIcon {
  if (personnelType === "civilian" || !branch) return BRANCH_ICONS.civilian
  return BRANCH_ICONS[branch]
}

// --- Insignia asset resolvers ---
// Rendered in `<RankInsignia>` and `<BranchSeal>` in components/personnel/.
// Files live under webui/public/insignia/ — see the README there.

/** Image extension for insignia assets. Change to `.svg` if you use SVG files. */
export const INSIGNIA_EXT = ".png"

/** URL for a branch seal / service mark (or null if not applicable). */
export function branchSealPath(
  branch: Branch | null,
  personnelType: PersonnelType,
): string | null {
  if (personnelType === "civilian" || !branch) return null
  return `/insignia/branches/${branch}${INSIGNIA_EXT}`
}

// Lookup of (branch → rank short → insignia filename stem), built once from
// RANKS_BY_BRANCH. The stems are idiosyncratic ({grade}-{name}, mixed case),
// so we resolve by table rather than by encoding the abbreviation into a path.
const INSIGNIA_STEM_BY_BRANCH: Record<Branch, Record<string, string>> =
  Object.fromEntries(
    BRANCHES.map((b) => [
      b,
      Object.fromEntries(
        RANKS_BY_BRANCH[b]
          .filter((r) => r.insignia)
          .map((r) => [r.short, r.insignia as string]),
      ),
    ]),
  ) as Record<Branch, Record<string, string>>

/** URL for a rank insignia image (or null if we can't confidently pick one). */
export function rankInsigniaPath(
  branch: Branch | null,
  personnelType: PersonnelType,
  rank: string | null,
): string | null {
  if (personnelType === "civilian" || !branch || !rank) return null
  const stem = INSIGNIA_STEM_BY_BRANCH[branch]?.[rank]
  if (!stem) return null
  return `/insignia/ranks/${branch}/${encodeURIComponent(stem)}${INSIGNIA_EXT}`
}

// --- Sign-in board ---

export type PersonnelStatus =
  | "unknown"
  | "on_site"
  | "traveling"
  | "off_site"
  | "out_of_office"
  | "lunch"
  | "leave"
  | "sick"
  | "training"

// Order shown in the check-in dropdown. on_site + traveling take a site.
export const PERSONNEL_STATUSES: PersonnelStatus[] = [
  "on_site",
  "traveling",
  "off_site",
  "out_of_office",
  "lunch",
  "leave",
  "sick",
  "training",
  "unknown",
]

/** Statuses that carry a site: on_site = present location, traveling = destination. */
export const SITE_BEARING_STATUSES: PersonnelStatus[] = ["on_site", "traveling"]

// Preset accent palette for teams — categorical slots in fixed order, chosen
// so adjacent hues stay CVD-distinguishable and every value clears 3:1 on the
// dark surface (team colors always render beside the team's name, never as
// the only carrier of identity).
export const TEAM_COLOR_PRESETS: Array<{ value: string; label: string }> = [
  { value: "#2a78d6", label: "Blue" },
  { value: "#1baf7a", label: "Teal" },
  { value: "#eda100", label: "Amber" },
  { value: "#008300", label: "Green" },
  { value: "#6d5fd0", label: "Violet" },
  { value: "#e34948", label: "Red" },
  { value: "#e87ba4", label: "Pink" },
  { value: "#eb6834", label: "Orange" },
]

/** "TSgt Doe, Jane" — compact person label for selects and badges. */
export function personLabel(p: {
  rank: string | null
  last_name: string
  first_name: string
}): string {
  return `${p.rank ? `${p.rank} ` : ""}${p.last_name}, ${p.first_name}`
}

export const PERSONNEL_STATUS_LABELS: Record<PersonnelStatus, string> = {
  on_site: "On site",
  traveling: "Traveling",
  off_site: "Off site",
  out_of_office: "Out of office",
  lunch: "Lunch",
  leave: "Leave",
  sick: "Sick",
  training: "Training",
  unknown: "Unknown",
}

// Base dot/border colors per status. describeLocation() overrides on_site to
// green (assigned) vs amber (temporary), and forces red when overdue.
const GREEN = "#16a34a"
const AMBER = "#f59e0b"
export const PERSONNEL_STATUS_COLORS: Record<PersonnelStatus, string> = {
  on_site: GREEN,
  traveling: "#3b82f6", // blue
  off_site: "#ea580c", // orange
  out_of_office: "#ea580c", // orange
  lunch: "#eab308", // yellow
  leave: "#a855f7", // purple
  sick: "#ef4444", // red
  training: "#0ea5e9", // sky
  unknown: "#6b7280", // gray
}
const OVERDUE = "#ef4444" // red

export interface LocationDescriptor {
  /** Composed label, e.g. "Bravo Site (Temporarily - 3hrs)". */
  text: string
  /** Elapsed since the status was set, e.g. "1hr ago" (null for unknown). */
  durationText: string | null
  /** Past the expected-return time with no newer check-in. */
  overdue: boolean
  /** Dot / border color to render. */
  color: string
}

interface LocationInput {
  status: PersonnelStatus
  currentSiteId: number | null
  assignedSiteId: number | null
  since: string | null
  expectedReturnAt: string | null
}

/**
 * Compose the location board display for a person's current status, deriving
 * "at assigned site" vs "temporary" from currentSiteId vs assignedSiteId and
 * appending an optional expected-duration qualifier. Mirrors the display the
 * product owner specified, e.g.:
 *   Alpha Site (Assigned) · 1hr ago
 *   Bravo Site (Temporarily - 3hrs) · 1hr ago
 *   Traveling to Bravo Site (Temporarily) · 5min ago
 *   Lunch (1hr) · 1hr ago      ← turns red once elapsed passes the expected hour
 */
export function describeLocation(
  input: LocationInput,
  siteName: (id: number | null) => string | undefined,
): LocationDescriptor {
  const { status, currentSiteId, assignedSiteId, since, expectedReturnAt } =
    input
  const expDur = formatDurationShort(since, expectedReturnAt)
  // Elapsed since the status was set, in the same "1hr / 5min" vocabulary as
  // the expected-duration qualifier (rather than timeAgo's "1h / 5m").
  const elapsed = since ? formatDurationShort(since, new Date().toISOString()) : null
  const overdue = expectedReturnAt
    ? new Date(expectedReturnAt).getTime() < Date.now()
    : false
  const atAssigned =
    currentSiteId != null && currentSiteId === assignedSiteId

  const withDur = (base: string) => (expDur ? `${base} - ${expDur}` : base)

  let text: string
  let color: string
  switch (status) {
    case "on_site": {
      const name = siteName(currentSiteId) ?? "On site"
      if (atAssigned) {
        text = `${name} (Assigned)`
        color = GREEN
      } else {
        text = `${name} (${withDur("Temporarily")})`
        color = AMBER
      }
      break
    }
    case "traveling": {
      const name = siteName(currentSiteId)
      const base = name ? `Traveling to ${name}` : "Traveling"
      const qual = atAssigned ? "Returning" : withDur("Temporarily")
      text = `${base} (${qual})`
      color = PERSONNEL_STATUS_COLORS.traveling
      break
    }
    case "unknown":
      text = "Unknown"
      color = PERSONNEL_STATUS_COLORS.unknown
      break
    default: {
      // Site-less reasons: append the expected duration bare, e.g. "Lunch (1hr)".
      const label = PERSONNEL_STATUS_LABELS[status]
      text = expDur ? `${label} (${expDur})` : label
      color = PERSONNEL_STATUS_COLORS[status]
    }
  }

  return {
    text,
    durationText:
      status !== "unknown" && since
        ? elapsed
          ? `${elapsed} ago`
          : "just now"
        : null,
    overdue,
    color: overdue ? OVERDUE : color,
  }
}

