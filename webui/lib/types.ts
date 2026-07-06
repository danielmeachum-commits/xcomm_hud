// TypeScript types matching the xcomm_hud API contract.

export type Role = "viewer" | "operator" | "admin"

export type ServiceStatus =
  | "up"
  | "degraded"
  | "down"
  | "unknown"
  | "offline"
  | "setup"

/** Cell status is a superset of ServiceStatus that also allows "ready" —
 *  a cell can inherit that value from a gateway on PACE standby via the
 *  R9 cascade in the API. Also used for rolled-up `service.effective_status`
 *  for the same reason. */
export type CellStatus = ServiceStatus | "ready"

export type GatewayStatus =
  | "active"
  | "ready"
  | "degraded"
  | "down"
  | "offline"
  | "setup"

/** Manually set posture describing the site itself — not a rollup of its
 *  services. Distinct from ServiceStatus on purpose. */
export type SiteStatus =
  | "operational"
  | "limited"
  | "degraded"
  | "maintenance"
  | "standby"
  | "offline"
  | "setup"

/** Service-shaped status value (legacy name). Keeps existing imports working. */
export type StatusValue = ServiceStatus

/** Union across every status kind that shares the validation `status` column:
 *  service/gateway/site statuses plus FPCON and EMCON levels, and personnel
 *  sign-in states carried by subject_kind="personnel_location" events. */
export type AnyStatus =
  | ServiceStatus
  | GatewayStatus
  | SiteStatus
  | Fpcon
  | Emcon
  | PersonnelStatus

export type ServiceKind = "voice" | "data" | "other"

export type ServiceCategory = "critical" | "sustainment" | "other"

export type ServiceReach = "local" | "external"

export type GatewayKind = "milsat" | "commercial" | "other"

export type GatewayPace = "primary" | "alternate" | "contingency" | "emergency"

export type Fpcon = "normal" | "alpha" | "bravo" | "charlie" | "delta"

export type Emcon = "a" | "b" | "c" | "d"

export type SubjectKind =
  | "service"
  | "site"
  | "gateway"
  | "service_gateway"
  | "site_fpcon"
  | "site_emcon"
  | "site_status"
  | "personnel_location"
  | "system"
  | "mission"
  | "exercise"

export type EventType = "validation" | "general" | "personnel"

export const VALIDATION_SUBJECT_KINDS: readonly SubjectKind[] = [
  "service",
  "site",
  "gateway",
  "service_gateway",
  "site_fpcon",
  "site_emcon",
  "site_status",
]

export const PERSONNEL_SUBJECT_KINDS: readonly SubjectKind[] = [
  "personnel_location",
]

export const GENERAL_SUBJECT_KINDS: readonly SubjectKind[] = [
  "system",
  "mission",
  "exercise",
]

export interface Workspace {
  id: number
  slug: string
  name: string
  description: string | null
  tags: string[]
  is_default: boolean
  created_at: string
  updated_at: string
}

export interface Me {
  user_id: number
  username: string
  display_name: string | null
  role: Role
  current_workspace: Workspace
  workspaces: Workspace[]
}

export interface User {
  id: number
  username: string
  display_name: string | null
  role: Role
  disabled_at: string | null
}

export interface Site {
  id: number
  workspace_id: number
  name: string
  location_label: string | null
  status: SiteStatus
  fpcon: Fpcon
  emcon: Emcon
  show_fpcon: boolean
  show_emcon: boolean
  lat: number | null
  lon: number | null
  notes: string | null
}

export interface ServiceGatewayStatus {
  gateway_id: number
  /** Raw stored value — the operator's last cell validation, or the R9
   *  cascade value ("ready") when the underlying gateway was flipped to
   *  PACE standby. */
  status: CellStatus
  /** Displayed value: applies R10 gateway/local overrides and R11 clamp
   *  to the raw stored status. UI should render this. */
  effective_status: CellStatus
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
}

export interface Service {
  id: number
  name: string
  site_id: number
  service_template_id: number | null
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  description: string | null
  status: ServiceStatus
  /** Rolled-up effective status — may resolve to "ready" if every reachable
   *  path routes through a gateway on PACE standby, so uses CellStatus. */
  effective_status: CellStatus
  allowed_statuses: ServiceStatus[] | null
  enabled_pace: GatewayPace[]
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
  display_order: number
  notes: string | null
  /** Per-(service × gateway) matrix cells for every gateway on this site
   *  whose PACE tier the service enables. Materialized by the API on read. */
  gateway_statuses: ServiceGatewayStatus[]
}

export interface ServiceTemplate {
  id: number
  name: string
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  description: string | null
  allowed_statuses: StatusValue[] | null
}

export interface Gateway {
  id: number
  site_id: number
  name: string
  kind: GatewayKind
  provider: string | null
  status: GatewayStatus
  pace: GatewayPace
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
  display_order: number
  notes: string | null
}

export interface CanvasPosition {
  site_id: number
  x: number
  y: number
}

export interface CanvasAnnotation {
  id: number
  text: string
  x: number
  y: number
}

export interface MapBundle {
  sites: Site[]
  positions: CanvasPosition[]
  services: Service[]
  gateways: Gateway[]
  annotations: CanvasAnnotation[]
}

export interface SiteRollup {
  id: number
  name: string
  status: SiteStatus
  fpcon: Fpcon
  emcon: Emcon
  show_fpcon: boolean
  show_emcon: boolean
  service_count: number
  gateway_count: number
}

export interface ServiceRollup {
  id: number
  name: string
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  status: StatusValue
  /** Same superset as Service.effective_status — can be "ready". */
  effective_status: CellStatus
  allowed_statuses: StatusValue[] | null
  site_id: number
  site_name: string
  validated_at: string | null
}

export interface StatusRollup {
  sites: SiteRollup[]
  services: ServiceRollup[]
}

export interface Event {
  id: number
  event_type: EventType
  validated_at: string
  subject_kind: SubjectKind
  subject_id: number | null
  second_subject_id: number | null
  subject_name: string | null
  subject_label: string | null
  site_id: number | null
  site_name: string | null
  prev_status: AnyStatus | null
  status: AnyStatus | null
  source: "manual" | "ingest"
  validated_by_user_id: number | null
  validated_by_username: string | null
  note: string | null
  edited_at: string | null
  hidden_at: string | null
  hidden_by_user_id: number | null
}

export type SitePropertyType =
  | "text"
  | "long_text"
  | "number"
  | "phone"
  | "email"
  | "url"
  | "date"
  | "bool"

export type SitePropertySource = "template" | "custom"

export interface SitePropertyDefinition {
  id: number
  template_id: number
  key: string
  label: string
  type: SitePropertyType
  required: boolean
  group: string | null
  description: string | null
  display_order: number
}

export interface SitePropertyTemplate {
  id: number
  workspace_id: number
  name: string
  description: string | null
  /** Ordered list of section names. Definitions still store their group
   *  as a freeform string; this controls section render order and lets an
   *  empty section persist between edits. */
  group_order: string[]
  created_at: string
  updated_at: string
  definitions: SitePropertyDefinition[]
}

/** Scalar JSON — text/number/bool. Dates/emails/urls/phones ride as strings. */
export type SitePropertyValue = string | number | boolean | null

export interface SiteProperty {
  id: number
  site_id: number
  key: string
  label: string
  type: SitePropertyType
  required: boolean
  group: string | null
  description: string | null
  display_order: number
  value: SitePropertyValue
  source: SitePropertySource
}

export interface SitePropertyTemplateExport {
  format_version: 1
  exported_at: string
  name: string
  description: string | null
  group_order: string[]
  definitions: Array<{
    key: string
    label: string
    type: SitePropertyType
    required: boolean
    group: string | null
    description: string | null
    display_order: number
  }>
}

// --- Personnel ---

export type PersonnelType = "military" | "civilian"

export type Branch =
  | "air_force"
  | "army"
  | "navy"
  | "marines"
  | "space_force"
  | "coast_guard"

export interface Unit {
  id: number
  workspace_id: number
  name: string
  description: string | null
  parent_unit_id: number | null
  created_at: string
  updated_at: string
}

export interface WorkCenter {
  id: number
  workspace_id: number
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface Team {
  id: number
  workspace_id: number
  name: string
  description: string | null
  color: string | null
  created_at: string
  updated_at: string
}

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

export interface Personnel {
  id: number
  workspace_id: number
  personnel_type: PersonnelType
  is_guest: boolean
  affiliation: string | null
  escort: string | null
  branch: Branch | null
  rank: string | null
  last_name: string
  first_name: string
  cellphone: string | null
  dsn: string | null
  sipr_number: string | null
  email: string | null
  notes: string | null
  work_center_id: number | null
  unit_id: number | null
  supervisor_id: number | null
  assigned_site_id: number | null
  room_number: string | null
  team_ids: number[]
  current_status: PersonnelStatus
  current_site_id: number | null
  current_status_since: string | null
  current_status_note: string | null
  expected_return_at: string | null
  created_at: string
  updated_at: string
}

export interface PersonnelLocationEvent {
  id: number
  personnel_id: number
  status: PersonnelStatus
  site_id: number | null
  note: string | null
  expected_return_at: string | null
  changed_at: string
  changed_by_user_id: number | null
}

export interface PersonnelCsvImportResult {
  imported: number
  skipped: number
  created_work_centers: string[]
  created_units: string[]
  errors: string[]
}

export interface EnclaveSource {
  id: number
  name: string
  scoi_url: string | null
  last_contact_at: string | null
  sync_status: string
  notes: string | null
}

export interface ApiError {
  detail: string
}
