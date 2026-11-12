// TypeScript types matching the xcomm_hud API contract.

export type Role = "viewer" | "operator" | "admin"

/** `unvalidated` is the seed state — nobody has said anything about this yet.
 *  It is NOT an assessment: it carries no ordering and constrains nothing, and
 *  every rank table and clamp in the API carves it out for exactly that
 *  reason. PersonnelStatus keeps a separate `unknown` meaning "never signed
 *  in", which is a different fact about a different kind of subject. */
export type ServiceStatus =
  | "up"
  | "degraded"
  | "down"
  | "unvalidated"
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
  | "unvalidated"

/** Service-shaped status value (legacy name). Keeps existing imports working. */
export type StatusValue = ServiceStatus

/** Union across every status kind that shares the validation `status` column:
 *  service/gateway/site statuses plus FPCON and EMCON levels, and personnel
 *  sign-in states carried by subject_kind="personnel_location" events. */
export type AnyStatus =
  | ServiceStatus
  | GatewayStatus
  | SiteStatus
  | EquipmentStatus
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
  | "document"
  | "doc_page"
  // The equipment tier's kinds were never mirrored here, so the feed rendered
  // them as their raw slug ("utc_instance") while every other kind had a
  // label. Adding them means SUBJECT_KIND_LABELS stops compiling until each
  // one is named, which is the point.
  | "equipment"
  | "equipment_capability"
  | "equipment_link"
  | "utc_instance"
  | "package_instance"

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
  /** The gateway IS the device providing the service on this path. */
  same_device: boolean
}

export interface Service {
  /** The DELIVERY id — one service at one site. Unchanged across the
   *  Service/ServiceDelivery split: every stored reference still resolves. */
  id: number
  /** The shared identity. Two sites' "NIPR Web" have the same service_id,
   *  which is what makes "is NIPR up anywhere?" answerable. */
  service_id: number
  name: string
  site_id: number
  service_template_id: number | null
  /** Which network this is on. Inherited from the template at creation.
   *  Names like "SIPR Web" are unchanged — this just means nothing has to
   *  parse them to know. */
  enclave_id: number | null
  kind: ServiceKind
  /** Criticality AT THIS SITE. Per delivery: the same service can be
   *  critical at the main site and sustainment at an extension. */
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  description: string | null
  /** The value to DISPLAY. In derived mode this is the dependency chain's
   *  answer; otherwise the operator's. */
  status: ServiceStatus
  /** The stored human value, whatever mode this is in. */
  reported_status: ServiceStatus
  status_mode: StatusMode
  derived_status: EquipmentStatus | null
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
  /** Every enabled path is a same-device gateway, so local status follows
   *  those cells instead of being validated by hand. */
  local_follows_gateways: boolean
}

export interface ServiceTemplate {
  id: number
  name: string
  enclave_id: number | null
  kind: ServiceKind
  category: ServiceCategory
  reach: ServiceReach
  icon: string | null
  description: string | null
  allowed_statuses: StatusValue[] | null
}

export interface Gateway {
  id: number
  reported_status: GatewayStatus
  status_mode: StatusMode
  derived_status: EquipmentStatus | null
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
  /** Cross-site links only — the shots the map draws as edges between site
   *  nodes. Same-site wiring is filtered out by the API. */
  links: EquipmentLink[]
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
  /** Stable identity for global built-ins; null for workspace rules. */
  key: string | null
  version: number
  name: string
  description: string | null
  trigger: string
  conditions: unknown
  enrichers: string[]
  computed: RuleComputedField[]
  actions: RuleActionStep[]
  enabled: boolean
  is_builtin: boolean
  /** Whether this workspace has turned a global built-in off for itself.
   *  Always false for workspace-owned rules. */
  disabled_here: boolean
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

/** Global — units belong to no workspace. */
export interface Unit {
  id: number
  name: string
  description: string | null
  /** Service branch of the org — prepopulates a new member's branch. */
  branch: Branch | null
  /** At most one — preselected when adding personnel. */
  is_default: boolean
  parent_unit_id: number | null
  created_at: string
  updated_at: string
}

export interface WorkCenter {
  id: number
  /** Null for a shared shop; set for one this workspace added for itself. */
  workspace_id: number | null
  is_global: boolean
  name: string
  description: string | null
  /** The specialty or specialties the shop draws on ("3D1X3"). */
  afsc: string | null
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

/** Someone on the global roster — identity only. Each workspace they're in
 *  has its own `Personnel` row for their part in that picture. */
export interface Person {
  id: number
  personnel_type: PersonnelType
  is_commander: boolean
  branch: Branch | null
  rank: string | null
  skill_level: number | null
  last_name: string
  first_name: string
  cellphone: string | null
  dsn: string | null
  sipr_number: string | null
  email: string | null
  /** A CAC is enrolled for check-in. The DoD ID itself is never sent. */
  has_cac: boolean
  unit_id: number | null
  /** A person id, unlike `Personnel.supervisor_id`. */
  supervisor_id: number | null
  workspaces: {
    workspace_id: number
    slug: string
    name: string
    personnel_id: number
  }[]
  created_at: string
  updated_at: string
}

/** A person's entry in one workspace, flattened with their roster identity
 *  (name, rank, unit, contact, supervisor, command). */
export interface Personnel {
  id: number
  workspace_id: number
  person_id: number
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
  has_cac: boolean
  notes: string | null
  work_center_id: number | null
  unit_id: number | null
  /** Their supervisor's personnel id in this workspace — null when the
   *  supervisor isn't in it. */
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

export interface ScoiSource {
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

// ===================== Equipment tier =====================

/** The SUB-category: what kind of box it is, under the `AssetCategory` that
 *  says what world it belongs to. `environmental` arrived when the app started
 *  tracking the HVAC that keeps the comm gear alive. */
export type EquipmentSubcategory =
  | "radio"
  | "satcom"
  | "crypto"
  | "network"
  | "compute"
  | "power"
  | "antenna"
  | "cable"
  | "environmental"
  | "other"

export type CapabilityKind =
  | "voice"
  | "data"
  | "video"
  | "satcom_rf"
  | "los_rf"
  | "routing"
  | "switching"
  | "crypto"
  | "power"
  | "other"

/** Its own set — gear goes to `maintenance`, services and gateways don't. */
export type EquipmentStatus =
  | "up"
  | "degraded"
  | "down"
  | "maintenance"
  | "offline"
  | "unvalidated"

export type EquipmentLinkKind =
  | "los"
  | "satcom"
  | "fiber"
  | "cable"
  | "wireless"
  | "other"

/** `reported` = a human owns the status; `derived` = the dependency chain
 *  does, and the reported field goes read-only. */
export type StatusMode = "reported" | "derived"

export type EquipmentLinkDirection = "bidirectional" | "a_to_b"
export type UtcRole = "primary" | "extension" | "independent"
/** Beyond the two topology roles: `alternate` is a standby for the primary,
 *  and `support` keeps the others alive rather than carrying traffic — HVAC,
 *  PowerPro and the like. Package membership only: neither has a standing place
 *  on the RF topology, so both deploy as `independent`. */
export type UtcRoleHint =
  | "primary"
  | "alternate"
  | "extension"
  | "support"
  | "either"
/** What a thing IS, at the coarsest level that matters — shared by UTCs and
 *  equipment types so the two can be filtered against the same vocabulary.
 *
 *  On a UTC it also decides layout: only `comm` divides its bill of materials
 *  by enclave, since an HVAC or power set has no network to divide along.
 *
 *  Not the same fact as `UtcRoleHint`'s `support`, which is per-package
 *  membership. And one level ABOVE `EquipmentSubcategory`: a TACLANE is
 *  `comm`/`crypto`, an ECU is `environmental`/`environmental`. */
export type AssetCategory = "comm" | "power" | "environmental" | "other"
export type CapabilityBindRole = "endpoint" | "transport"
export type CapabilitySource = "template" | "custom"

// --- enclaves ---

/** Static vocabulary, mirroring `schemas.Classification`. Hardcoded rather than
 *  a managed lookup because the levels are stable. */
export type Classification = "unclassified" | "cui" | "secret" | "top_secret"

/** A network gear and services belong to — NIPR, SIPR, ACBN, BICES.
 *
 *  Flat over the wire: `parent_id` only, tree assembled client-side, same as
 *  Folder and DocPage. `color` is a hex string and is null for the transport
 *  layer, which operators describe as colorless.
 *
 *  Not DEFINED BY a classification level, though it may HAVE one — see
 *  `classification`. Deliberately no ordering or severity. */
export interface Enclave {
  id: number
  /** null = a global, admin-managed row. */
  workspace_id: number | null
  parent_id: number | null
  name: string
  short_name: string | null
  color: string | null
  /** What this enclave is generally understood to carry. Display metadata:
   *  never ordered, ranked, or branched on. Null is a real answer — Transport
   *  declares nothing. */
  classification: Classification | null
  display_order: number
  retired_at: string | null
  notes: string | null
  is_global: boolean
}

// --- catalog ---

export interface EquipmentTypeCapability {
  id: number
  equipment_type_id: number
  kind: CapabilityKind
  label: string
  description: string | null
  display_order: number
  materialize_by_default: boolean
}

export interface EquipmentType {
  id: number
  /** null = a global, admin-managed catalog row. */
  workspace_id: number | null
  title: string
  short_name: string | null
  /** What people actually call it — "117G", "radio". Searched. */
  aliases: string[]
  /** Free-form operator facets — "cci", "hand-receipt". Lowercased by the API.
   *  Nothing branches on these; they exist so units can track what we don't
   *  model. Searched and filterable. */
  tags: string[]
  nsn: string | null
  lin: string | null
  /** The coarse level, shared with `UtcDef.category`. */
  category: AssetCategory
  /** What kind of box it is, under `category`. */
  subcategory: EquipmentSubcategory
  serialized: boolean
  id_prefix: string
  manufacturer: string | null
  model: string | null
  icon: string | null
  description: string | null
  retired_at: string | null
  capabilities: EquipmentTypeCapability[]
  /** Enclaves this model of gear can serve. Empty = unrestricted, NOT
   *  "capable of nothing" — a type whose catalog entry hasn't been filled in
   *  must not block assignments. */
  enclave_ids: number[]
  /** Which work centers answer for this kind of gear. Usually one, flagged
   *  primary, but a type can be shared between shops. Workspace-scoped even
   *  for a global catalog row — see `EquipmentTypeWorkCenter` in the API. */
  work_centers: EquipmentTypeWorkCenter[]
  is_global: boolean
}

export interface EquipmentTypeWorkCenter {
  id: number
  equipment_type_id: number
  work_center_id: number
  is_primary: boolean
  work_center_name: string | null
}

export interface UtcDefLine {
  id: number
  utc_def_id: number
  equipment_type_id: number
  quantity: number
  /** Which enclave's stack this line belongs to. */
  enclave_id: number | null
  notes: string | null
  display_order: number
  equipment_type_title: string | null
  equipment_type_short_name: string | null
  serialized: boolean
}

/** One authorized position on a UTC's MANFOR — the manpower half of MEFPAK,
 *  where `UtcDefLine` is the LOGDET. A shop, a qualification, and how many;
 *  who fills it is decided per deployment. */
export interface UtcDefManforLine {
  id: number
  utc_def_id: number
  /** The shop that provides the body, by name. A name and not an id because
   *  work centers are workspace-scoped and a UTC definition can be global —
   *  see the model docstring. Resolved against `WorkCenter.name` for display. */
  work_center: string
  /** Same 1/3/5/7/9 vocabulary as `Personnel.skill_level`. Null for officer
   *  and civilian slots, which qualify differently. */
  skill_level: number | null
  quantity: number
  display_order: number
}

/** One pre-wired capability: this LOGDET line's capability backs the
 *  service. The line is named by (type, enclave), not by id — lines are saved
 *  delete-and-reinsert, so an id would not survive an edit. */
export interface UtcDefServiceWire {
  id?: number
  equipment_type_id: number
  enclave_id: number | null
  capability_kind: CapabilityKind
  role: CapabilityBindRole
  /** Gates the service in derived status; unrequired wires are context. */
  required: boolean
  /** Required wires sharing a group are redundant (best-of). */
  group_key: string | null
}

/** A service this UTC brings up wherever it deploys. PACE plan and
 *  criticality are NOT here — the deploy wizard asks for both every time. */
export interface UtcDefService {
  id: number
  utc_def_id: number
  service_template_id: number
  display_order: number
  wires: UtcDefServiceWire[]
  service_template_name: string | null
  kind: ServiceKind | null
  enclave_id: number | null
  /** The template's category — a suggestion, never applied unasked. */
  default_category: ServiceCategory | null
}

export interface UtcDefServiceInput {
  service_template_id: number
  wires: Omit<UtcDefServiceWire, "id">[]
}

export interface UtcDef {
  id: number
  workspace_id: number | null
  code: string
  name: string
  description: string | null
  category: AssetCategory
  retired_at: string | null
  /** The LOGDET — what this UTC deploys with. Named `lines` because the table
   *  is; the UI calls it LOGDET. */
  lines: UtcDefLine[]
  /** The MANFOR — who deploys with it. */
  manfor: UtcDefManforLine[]
  /** The services it brings up, pre-wired to the LOGDET above. */
  services: UtcDefService[]
  is_global: boolean
}

export interface PackageDefUtc {
  id: number
  package_def_id: number
  utc_def_id: number
  quantity: number
  role_hint: UtcRoleHint
  display_order: number
  utc_def_code: string | null
  utc_def_name: string | null
}

export interface PackageDef {
  id: number
  workspace_id: number | null
  code: string
  name: string
  description: string | null
  retired_at: string | null
  utcs: PackageDefUtc[]
  is_global: boolean
}

// --- deployed instances ---

export interface PackageInstance {
  id: number
  workspace_id: number
  package_def_id: number | null
  name: string
  notes: string | null
  package_def_code: string | null
  site_ids: number[]
}

export interface UtcInstance {
  id: number
  workspace_id: number
  package_instance_id: number | null
  utc_def_id: number | null
  site_id: number
  name: string
  /** What the operator declared this UTC is for. */
  role: UtcRole
  notes: string | null
  display_order: number
  utc_def_code: string | null
  site_name: string | null
  package_name: string | null
  /** Every site this UTC's gear actually sits at, home site always included.
   *  `site_id` is where the UTC is accountable; this is where it reaches, so
   *  `site_ids.length > 1` is the test for "spread across sites". */
  site_ids: number[]
  /** What the link graph says it actually is. null = not enough links to
   *  tell. A mismatch with `role` is shown, not silently reconciled. */
  derived_role: UtcRole | null
}

/** What a deployed UTC was planned to carry — snapshotted at deploy from what
 *  the operator confirmed, not copied from the def. See UtcCompleteness. */
export interface UtcInstanceLine {
  id: number
  utc_instance_id: number
  equipment_type_id: number
  quantity: number
  /** Snapshotted with the line — which enclave's stack it was part of. */
  enclave_id: number | null
  notes: string | null
  type_title: string | null
  type_short_name: string | null
  serialized: boolean
}

/** `unknown` = deployed before expectations were recorded. Not the same as
 *  "expected nothing", so it must not render as complete. */
export type UtcCompletenessStatus = "complete" | "short" | "over" | "unknown"

export interface UtcCompletenessLine {
  equipment_type_id: number
  type_title: string | null
  type_short_name: string | null
  /** Labels the row for grouping only — the comparison stays per type. */
  enclave_id: number | null
  serialized: boolean
  expected: number
  actual: number
  /** actual - expected. Negative is short, positive is unplanned gear. */
  delta: number
}

export interface UtcCompleteness {
  utc_instance_id: number
  status: UtcCompletenessStatus
  lines: UtcCompletenessLine[]
  /** How this deployment differs from doctrine. Informational — a tailored
   *  UTC that left an enclave's stack home is correct, not deficient. */
  def_variance: UtcCompletenessLine[]
  /** Enclaves the def calls for that this deployment expects nothing from.
   *  Derived from the snapshot, so it stays right when the expected list is
   *  edited mid-mission. These are decisions, NOT shortfalls — never render
   *  them as a problem. */
  unsupported_enclave_ids: number[]
  /** Enclaves this deployment does expect gear from. Sent by the API because
   *  `lines` collapses per type and drops the enclave when a type spans more
   *  than one, so it can't be recovered here. */
  supported_enclave_ids: number[]
}

export interface CapabilityBindings {
  service_ids: number[]
  gateway_ids: number[]
  /** The subset of `service_ids` this capability is declared REQUIRED for. */
  required_service_ids: number[]
  /** Redundancy group per bound service. Bindings sharing a key are OR'd. */
  group_keys: Record<number, string>
}

export interface EquipmentCapability {
  id: number
  equipment_id: number
  kind: CapabilityKind
  label: string
  status: EquipmentStatus
  source: CapabilitySource
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
  notes: string | null
  display_order: number
  bindings: CapabilityBindings
}

export interface Equipment {
  id: number
  workspace_id: number
  equipment_type_id: number
  /** The property-book asset this row was materialized from, if any. */
  asset_id: number | null
  utc_instance_id: number | null
  site_id: number
  /** One piece of gear, one enclave. Null for gear common to all of them —
   *  power, cables, the RF shot. */
  enclave_id: number | null
  /** The human-facing "Equipment ID" — R7421. Not the row id. */
  equipment_code: string
  serial_number: string | null
  status: EquipmentStatus
  validated_at: string | null
  validated_by_user_id: number | null
  validated_by_username: string | null
  notes: string | null
  type_title: string | null
  type_short_name: string | null
  type_category: AssetCategory | null
  type_subcategory: EquipmentSubcategory | null
  nsn: string | null
  site_name: string | null
  utc_name: string | null
  capabilities: EquipmentCapability[]
}

export interface EquipmentHolding {
  id: number
  workspace_id: number
  utc_instance_id: number
  equipment_type_id: number
  authorized_qty: number
  on_hand_qty: number
  notes: string | null
  type_title: string | null
  type_short_name: string | null
  nsn: string | null
}

// --- links and topology ---

export interface EquipmentLink {
  id: number
  workspace_id: number
  a_equipment_id: number
  b_equipment_id: number
  a_capability_id: number | null
  b_capability_id: number | null
  kind: EquipmentLinkKind
  direction: EquipmentLinkDirection
  label: string | null
  status: EquipmentStatus
  notes: string | null
  a_equipment_code: string | null
  b_equipment_code: string | null
  /** What to call the gear on a canvas — the type's short name ("117G"),
   *  falling back to its title. The code is an identifier, not a name. */
  a_equipment_label: string | null
  b_equipment_label: string | null
  a_site_id: number | null
  b_site_id: number | null
  /** Each end's own status, before `status` collapses them to the worst of
   *  the two. The map's per-equipment ports read these. */
  a_status: EquipmentStatus
  b_status: EquipmentStatus
}

export interface BackingCapability {
  capability_id: number
  /** Does this GATE the service, or just stand behind it? Only required
   *  bindings move the derived value. */
  required: boolean
  /** Required bindings sharing a key are OR'd — one live path is enough.
   *  Null means the binding is its own group. */
  group_key: string | null
  equipment_id: number
  equipment_code: string
  label: string
  kind: CapabilityKind
  status: EquipmentStatus
  /** Where the gear physically sits. Differs from the delivery's site exactly
   *  when an extension backs this service from the far end of a shot — which
   *  is what the matrix's "Extends to" column reads. */
  site_id: number | null
  role: CapabilityBindRole | null
  /** Set when this capability also backs a gateway the delivery depends on.
   *  Shown but not counted — it gates the delivery through that gateway
   *  instead. Without this the shared component sits in two redundancy
   *  groups and they stop being independent. */
  superseded_by_gateway_id: number | null
}

/** A gateway standing behind a delivery. Separate from BackingCapability
 *  because a gateway has no equipment_id or kind — but the `required` /
 *  `group_key` semantics are identical, and the group keys share one
 *  namespace, so a capability and a gateway can sit in the same group. */
export interface BackingGateway {
  gateway_id: number
  name: string
  pace: GatewayPace
  /** The operator's value, in gateway vocabulary. */
  reported_status: GatewayStatus
  /** What it contributes to the chain, in equipment vocabulary. Null when it
   *  has nothing to say. */
  contributed_status: EquipmentStatus | null
  /** True when it came from the gateway's own equipment chain rather than
   *  from the reported status. */
  from_chain: boolean
  required: boolean
  group_key: string | null
}

/** A delivery's declared dependency on a transport path. */
export interface DeliveryGatewayDependency {
  service_delivery_id: number
  gateway_id: number
  gateway_name: string
  gateway_pace: GatewayPace
  gateway_status: GatewayStatus
  required: boolean
  group_key: string | null
}

/** Advisory comparison of reported vs equipment-derived status.
 *  Read-only: equipment never writes service or gateway status. */
/** `derived` skips unvalidated capabilities when computing a value — a chain
 *  that returned "unvalidated" for one unchecked port would be useless. What
 *  we don't know is carried BESIDE the status as a count instead. */
export interface DerivedStatus {
  reported: string
  derived: EquipmentStatus | null
  /** True only when equipment says things are meaningfully *worse*. */
  disagrees: boolean
  backing: BackingCapability[]
  /** Gateways this delivery depends on. Always empty for a gateway's own
   *  DerivedStatus — gateways depend on capabilities only, which keeps the
   *  chain one level deep. */
  backing_gateways: BackingGateway[]
  required_total: number
  required_unvalidated: number
  unvalidated_labels: string[]
}

export interface EquipmentPosition {
  equipment_id: number
  x: number
  y: number
}

export interface TopologySiteNode {
  site_id: number
  name: string
  status: SiteStatus
  utc_instance_ids: number[]
}

export interface NetworkTopology {
  sites: TopologySiteNode[]
  utc_instances: UtcInstance[]
  equipment: Equipment[]
  links: EquipmentLink[]
  positions: EquipmentPosition[]
  service_derived: Record<number, DerivedStatus>
  gateway_derived: Record<number, DerivedStatus>
}

export interface SiteEquipmentAdvisory {
  service_derived: Record<number, DerivedStatus>
  gateway_derived: Record<number, DerivedStatus>
}

// --- deploy wizard payload ---

export interface UtcDeployItem {
  equipment_type_id: number
  /** Materialize this workspace's copy of a global property-book asset. The
   *  normal path when deploying from the property book: serial and equipment
   *  ID come from the asset, so nobody retypes them. If this workspace already has a row
   *  for the asset, that row is reused rather than duplicated. */
  asset_id?: number | null
  /** Claim gear the workspace already owns instead of registering new. When
   *  set, the serial, ID, status, and capability fields are ignored — the row
   *  already has them. This is the finite-pool path: a unit deploys the same
   *  radios over and over, and before it existed the second deployment of a
   *  radio was a 409 on its serial. */
  equipment_id?: number | null
  enclave_id?: number | null
  serial_number?: string | null
  equipment_code?: string | null
  status?: EquipmentStatus
  notes?: string | null
  capability_kinds?: string[] | null
}

export interface CapabilityWiring {
  /** Index into the deploy payload's `items` — the equipment rows don't
   *  exist yet when the wizard builds this. */
  item_index: number
  capability_kind: CapabilityKind
  service_id?: number | null
  /** Index into the payload's `services` — a delivery this deploy stands up,
   *  which has no id yet. */
  new_service_index?: number | null
  gateway_id?: number | null
  role?: CapabilityBindRole
  required?: boolean
  group_key?: string | null
}

/** A service the deploy brings up at the site. Joined unchanged when the
 *  site already delivers it; otherwise created with this PACE plan and
 *  criticality, which have no defaults on purpose. */
export interface UtcDeployService {
  service_template_id: number
  enabled_pace: GatewayPace[]
  category: ServiceCategory
}

export interface UtcDeployPayload {
  site_id: number
  name: string
  role: UtcRole
  utc_def_id?: number | null
  package_instance_id?: number | null
  new_package_name?: string | null
  new_package_def_id?: number | null
  notes?: string | null
  items: UtcDeployItem[]
  holdings: {
    equipment_type_id: number
    authorized_qty: number
    on_hand_qty: number
    /** Carried for the expectation snapshot only — bulk gear itself isn't
     *  tagged, since a box of cables serves every enclave. */
    enclave_id?: number | null
    notes?: string | null
  }[]
  services?: UtcDeployService[]
  wiring: CapabilityWiring[]
}

/** Gear this deploy took off a UTC that was already holding it.
 *
 *  Reported, not prevented. `equipment.utc_instance_id` is a single FK, so a
 *  radio is in exactly one UTC or none — claiming it MOVES it, and the UTC
 *  that lost it reads as a shortfall from that moment. Nothing double-counts,
 *  so what is owed to the operator is disclosure rather than a gate. */
export interface ReassignedEquipment {
  equipment_id: number
  equipment_code: string
  serial_number: string | null
  previous_utc_instance_id: number
  previous_utc_name: string
  previous_site_id: number | null
  previous_site_name: string | null
}

export interface UtcDeployResult {
  utc_instance: UtcInstance
  equipment: Equipment[]
  holdings: EquipmentHolding[]
  bindings_created: number
  deliveries_created: number
  deliveries_joined: number
  /** Empty on a deploy that only registered new gear. */
  reassigned: ReassignedEquipment[]
}

// --- the property book ---

/** Where a workspace has this asset in play. Plural by design: planning next
 *  month's exercise while this month's is live means the same radio
 *  legitimately appears in two pictures. A report, never a gate. */
export interface AssetCommitment {
  workspace_id: number
  workspace_name: string
  equipment_id: number
  utc_instance_id: number | null
  utc_name: string | null
  site_name: string | null
}

/** One physical box the unit owns — globally, once. Workspace `Equipment` rows
 *  are per-picture materializations of these. */
export interface EquipmentAsset {
  id: number
  equipment_type_id: number
  equipment_code: string
  serial_number: string | null
  notes: string | null
  retired_at: string | null
  type_title: string | null
  type_short_name: string | null
  nsn: string | null
  capability_kinds: string[]
  commitments: AssetCommitment[]
}

export interface AssetImportResult {
  created: EquipmentAsset[]
  linked: number
  skipped: string[]
}

/** A CAC card reader at a door, bound to one site. Its token is only ever
 *  returned on create / rotate (`CheckinStationWithToken`). */
export type CheckinStationMode = "toggle" | "in" | "out"
export interface CheckinStation {
  id: number
  workspace_id: number
  site_id: number
  site_name: string
  name: string
  mode: CheckinStationMode
  token_hint: string
  disabled: boolean
  last_seen_at: string | null
  created_at: string
}
export interface CheckinStationWithToken extends CheckinStation {
  token: string
}

/** A card a check-in station couldn't place, waiting for an operator to
 *  link it, add the person, or sign them in as a guest. Name/rank/grade are
 *  as read off the card (absent for a back-barcode scan). */
export interface KioskPending {
  id: number
  /** guest_request: a visitor without a CAC used the kiosk's Guest button. */
  kind: "unknown_card" | "not_in_workspace" | "guest_request"
  person_id: number | null
  person_name: string | null
  station_name: string | null
  site_id: number | null
  site_name: string | null
  can_sign_in: boolean
  first_name: string | null
  last_name: string | null
  middle_initial: string | null
  rank: string | null
  pay_grade: string | null
  branch: Branch | null
  is_civilian: boolean | null
  /** Guest requests: as typed at the kiosk. */
  affiliation: string | null
  escort: string | null
  card_expired: boolean
  scan_count: number
  first_scanned_at: string
  last_scanned_at: string
  suggestions: {
    person_id: number
    name: string
    rank: string | null
    branch: Branch | null
    unit_id: number | null
    in_workspace: boolean
  }[]
}

/** One kiosk check-in / check-out, for the activity log. */
export interface CheckinActivity {
  id: number
  at: string
  personnel_id: number
  name: string
  is_guest: boolean
  action: "in" | "out" | "moved"
  site_name: string | null
  from_site_name: string | null
  station_id: number | null
  station_name: string | null
  /** An operator enrolled the card and signed them in from the queue. */
  enrolled_at_desk: boolean
}
