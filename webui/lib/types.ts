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
  | "team"
  | "unit"
  | "work_center"
  | "workspace"

export type EventType = "validation" | "general" | "personnel"

export type RecordClass = "log" | "event"

export type Severity = "info" | "notice" | "warning" | "critical"

export const SEVERITIES: readonly Severity[] = [
  "info",
  "notice",
  "warning",
  "critical",
]

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
  "site",
  "team",
  "unit",
  "work_center",
  "workspace",
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
  workspace_id: number | null
  record_class: RecordClass
  severity: Severity
  type_slug: string | null
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

export interface EventTypeDef {
  id: number
  workspace_id: number | null
  slug: string
  label: string
  description: string | null
  category: string | null
  record_class: RecordClass
  default_severity: Severity
  icon: string | null
  color: string | null
  allowed_subject_kinds: SubjectKind[]
  is_builtin: boolean
  is_system: boolean
  retired_at: string | null
  created_by_user_id: number | null
  created_at: string
}

export interface RuleActionStep {
  action: string
  params: Record<string, unknown>
}

export interface RuleComputedField {
  name: string
  kind: "template" | "expr"
  template?: string | null
  expr?: unknown
}

export interface Rule {
  id: number
  workspace_id: number | null
  name: string
  description: string | null
  trigger: string
  conditions: unknown
  enrichers: string[]
  computed: RuleComputedField[]
  actions: RuleActionStep[]
  enabled: boolean
  is_builtin: boolean
  on_error: "abort" | "skip"
  priority: number
  created_by_user_id: number | null
  created_at: string
  updated_at: string
}

export interface RuleExecution {
  id: number
  rule_id: number
  trigger: string
  fired_at: string
  status: string
  error: string | null
  context: Record<string, unknown> | null
}

export interface RuleFieldMeta {
  key: string
  label: string
  type: string
  values?: string[]
}

export interface RuleTriggerMeta {
  key: string
  label: string
  fields: RuleFieldMeta[]
  enrichers: string[]
  event_type: EventType
}

export interface RuleEnricherMeta {
  key: string
  label: string
  fields: RuleFieldMeta[]
}

export interface RuleActionMeta {
  key: string
  label: string
  params: RuleFieldMeta[]
}

export interface RulesMeta {
  triggers: RuleTriggerMeta[]
  enrichers: RuleEnricherMeta[]
  actions: RuleActionMeta[]
}

export interface EventSummary {
  total_events: number
  total_logs: number
  events_today: number
  by_severity: Record<string, number>
  by_type: Record<string, number>
  activity_24h: number[]
  exercise_phase: string | null
  exercise_phase_at: string | null
  personnel_on_site: number
  services_down: number
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
  /** Holds a workspace personnel id — for roles like a site's OIC/NCOIC.
   *  Rendered as a person pill. */
  | "personnel"

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
  /** Service branch of the org — prepopulates a new member's branch. */
  branch: Branch | null
  /** At most one per workspace — preselected when adding personnel. */
  is_default: boolean
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

export interface TeamLead {
  work_center_id: number
  personnel_id: number
}

export interface Team {
  id: number
  workspace_id: number
  name: string
  /** Short code for compact display, e.g. "FCP1". */
  slug: string | null
  description: string | null
  color: string | null
  ncoic_id: number | null
  leads: TeamLead[]
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
  /** Unit commander/OIC — at most one per unit, officers only, requires a
   *  unit; rendered with a gold star beside the name everywhere. */
  is_commander: boolean
  affiliation: string | null
  escort: string | null
  branch: Branch | null
  rank: string | null
  skill_level: number | null
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

// --- Documents ---

export interface Folder {
  id: number
  workspace_id: number
  site_id: number | null
  parent_id: number | null
  name: string
  created_at: string
}

export interface Document {
  id: number
  workspace_id: number
  site_id: number | null
  folder_id: number | null
  title: string
  description: string | null
  category: string | null
  filename: string
  content_type: string
  size_bytes: number
  created_by: number | null
  created_by_username: string | null
  created_at: string
  updated_at: string
  current_version_no: number | null
  version_count: number
}

export interface DocumentVersion {
  id: number
  document_id: number
  version_no: number
  filename: string
  content_type: string
  size_bytes: number
  note: string | null
  created_by: number | null
  created_by_username: string | null
  created_at: string
  is_current: boolean
}

export interface EnclaveSource {
  id: number
  name: string
  scoi_url: string | null
  last_contact_at: string | null
  sync_status: string
  notes: string | null
}

export interface DocPage {
  id: number
  parent_id: number | null
  section_id: number | null
  slug: string
  title: string
  description: string | null
  content: string
  display_order: number
  created_by: number | null
  created_by_username: string | null
  created_at: string
  updated_at: string
}

export interface DocSection {
  id: number
  slug: string
  title: string
  description: string | null
  icon: string | null
  display_order: number
  created_at: string
  updated_at: string
}

export interface ApiError {
  detail: string
}
