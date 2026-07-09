/** Friendly display labels for registry action slugs — the system-triggered
 *  actions (api/action_registry.py) that aren't in the user-editable
 *  catalog. Catalog types resolve their label from EventTypeDef instead. */

import type { SubjectKind } from "./types"

/** Human labels for subject kinds — shared by the timeline and log table so
 *  the "kind" reads the same in both ("Site status", "Cell", "Personnel"). */
export const SUBJECT_KIND_LABELS: Record<SubjectKind, string> = {
  workspace: "Workspace",
  site: "Site",
  site_status: "Site status",
  site_fpcon: "FPCON",
  site_emcon: "EMCON",
  team: "Team",
  unit: "Unit",
  work_center: "Work center",
  system: "System",
  mission: "Mission",
  exercise: "Exercise",
  service: "Service",
  gateway: "Gateway",
  service_gateway: "Cell",
  personnel_location: "Personnel",
}

export const REGISTRY_TYPE_LABELS: Record<string, string> = {
  "service.validate": "Validation",
  "gateway.validate": "Validation",
  "cell.validate": "Validation",
  "site.validate": "Validation",
  "site.status": "Site status",
  "site.fpcon": "FPCON change",
  "site.emcon": "EMCON change",
  "personnel.checkin": "Sign-in",
}
