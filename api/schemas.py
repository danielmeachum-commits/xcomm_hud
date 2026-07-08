"""Pydantic v2 schemas for xcomm_hud API."""

from __future__ import annotations

import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

StatusValue = Literal["up", "degraded", "down", "unknown", "offline", "setup"]
ServiceStatusValue = StatusValue
GatewayStatusValue = Literal["active", "ready", "degraded", "down", "offline", "setup"]
# A cell can inherit "ready" from a gateway on PACE standby (R9 cascade in
# api/effective.py), so its allowed set is a superset of ServiceStatus.
CellStatusValue = Literal[
    "up", "degraded", "down", "unknown", "offline", "setup", "ready"
]
SiteStatusValue = Literal[
    "operational", "limited", "degraded", "maintenance", "standby", "offline", "setup"
]
# Event rows for FPCON/EMCON/site-status changes reuse the `status` column to
# record the new level — keep this union in sync with FPCON_LEVELS,
# EMCON_LEVELS, and SITE_STATUS_VALUES.
AnyStatusValue = Literal[
    "up", "active", "ready", "degraded", "down", "unknown", "offline", "setup",
    "operational", "limited", "maintenance", "standby",
    "normal", "alpha", "bravo", "charlie", "delta",
    "a", "b", "c", "d",
    # Personnel sign-in states — appear on Event rows with
    # subject_kind == "personnel_location".
    "on_site", "traveling", "off_site", "out_of_office", "lunch", "leave",
    "sick", "training",
]
ServiceKind = Literal["voice", "data", "other"]
ServiceCategory = Literal["critical", "sustainment", "other"]
ServiceReach = Literal["local", "external"]
GatewayKind = Literal["milsat", "commercial", "other"]
GatewayPace = Literal["primary", "alternate", "contingency", "emergency"]
UserRole = Literal["viewer", "operator", "admin"]
SubjectKind = Literal[
    "service",
    "site",
    "gateway",
    "service_gateway",
    "site_fpcon",
    "site_emcon",
    "site_status",
    "personnel_location",
    "system",
    "mission",
    "exercise",
    "team",
    "unit",
    "work_center",
    "workspace",
]
EventType = Literal["validation", "general", "personnel"]
RecordClass = Literal["log", "event"]
Severity = Literal["info", "notice", "warning", "critical"]

# Which subject_kinds belong to which event_type. Used for validation on both
# create and list endpoints.
VALIDATION_SUBJECT_KINDS = {
    "service",
    "site",
    "gateway",
    "service_gateway",
    "site_fpcon",
    "site_emcon",
    "site_status",
}
PERSONNEL_SUBJECT_KINDS = {"personnel_location"}
GENERAL_SUBJECT_KINDS = {
    "system",
    "mission",
    "exercise",
    "site",
    "team",
    "unit",
    "work_center",
    "workspace",
}
Fpcon = Literal["normal", "alpha", "bravo", "charlie", "delta"]
Emcon = Literal["a", "b", "c", "d"]


class _ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Users ---


class UserOut(_ORM):
    id: int
    username: str
    display_name: Optional[str] = None
    role: UserRole
    disabled_at: Optional[datetime.datetime] = None


class UserIn(BaseModel):
    username: str
    password: str
    display_name: Optional[str] = None
    role: UserRole = "viewer"


class UserPatch(BaseModel):
    display_name: Optional[str] = None
    role: Optional[UserRole] = None
    password: Optional[str] = None
    disabled: Optional[bool] = None


class WorkspaceIn(BaseModel):
    name: str
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class WorkspacePatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None


class WorkspaceOut(_ORM):
    id: int
    slug: str
    name: str
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    is_default: bool = False
    created_at: datetime.datetime
    updated_at: datetime.datetime


class WorkspaceDuplicateIn(BaseModel):
    name: str
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class WorkspaceSelectIn(BaseModel):
    workspace_id: int


# --- Workspace export / import ---
#
# Portable, ID-free representation of a workspace. Sites are referenced by
# name inside the envelope so services / gateways / positions can hang off
# them without hard-coded ids. `format_version` guards against future breaking
# changes; bump on any incompatible schema shift.


class ExportedSite(BaseModel):
    name: str
    location_label: Optional[str] = None
    fpcon: Fpcon = "normal"
    emcon: Emcon = "a"
    show_fpcon: bool = True
    show_emcon: bool = True
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class ExportedService(BaseModel):
    site_name: str
    service_template_name: Optional[str] = None
    name: str
    kind: ServiceKind = "other"
    category: ServiceCategory = "other"
    reach: ServiceReach = "local"
    icon: Optional[str] = None
    description: Optional[str] = None
    display_order: int = 0
    notes: Optional[str] = None
    enabled_pace: list[GatewayPace] = Field(default_factory=lambda: list(_DEFAULT_PACE))


class ExportedGateway(BaseModel):
    site_name: str
    name: str
    kind: GatewayKind = "other"
    provider: Optional[str] = None
    pace: GatewayPace = "primary"
    display_order: int = 0
    notes: Optional[str] = None


class ExportedPosition(BaseModel):
    site_name: str
    x: float = 0.0
    y: float = 0.0


class ExportedAnnotation(BaseModel):
    text: str = ""
    x: float = 0.0
    y: float = 0.0


class ExportedWorkspaceMeta(BaseModel):
    name: str
    description: Optional[str] = None
    tags: list[str] = Field(default_factory=list)


class WorkspaceExport(BaseModel):
    # v2 added units / work_centers / teams / personnel. Old (v1) payloads
    # remain valid — the new lists default to empty.
    format_version: Literal[1, 2] = 2
    exported_at: datetime.datetime
    workspace: ExportedWorkspaceMeta
    sites: list[ExportedSite] = Field(default_factory=list)
    services: list[ExportedService] = Field(default_factory=list)
    gateways: list[ExportedGateway] = Field(default_factory=list)
    positions: list[ExportedPosition] = Field(default_factory=list)
    annotations: list[ExportedAnnotation] = Field(default_factory=list)
    units: list["ExportedUnit"] = Field(default_factory=list)
    work_centers: list["ExportedWorkCenter"] = Field(default_factory=list)
    teams: list["ExportedTeam"] = Field(default_factory=list)
    personnel: list["ExportedPersonnel"] = Field(default_factory=list)


class WorkspaceImportIn(BaseModel):
    """Envelope from `GET /workspaces/{id}/export`, optionally with a name override.

    When `name_override` is provided it takes precedence over `payload.workspace.name`
    — used from the UI when the source name would collide with an existing
    workspace on this instance.
    """

    payload: WorkspaceExport
    name_override: Optional[str] = None


class MeOut(BaseModel):
    user_id: int
    username: str
    display_name: Optional[str] = None
    role: UserRole
    current_workspace: WorkspaceOut
    workspaces: list[WorkspaceOut] = Field(default_factory=list)


# --- Site ---


class SiteIn(BaseModel):
    name: str
    location_label: Optional[str] = None
    status: SiteStatusValue = "operational"
    fpcon: Fpcon = "normal"
    emcon: Emcon = "a"
    show_fpcon: bool = True
    show_emcon: bool = True
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SitePatch(BaseModel):
    name: Optional[str] = None
    location_label: Optional[str] = None
    fpcon: Optional[Fpcon] = None
    emcon: Optional[Emcon] = None
    show_fpcon: Optional[bool] = None
    show_emcon: Optional[bool] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SiteOut(_ORM):
    id: int
    workspace_id: int
    name: str
    location_label: Optional[str] = None
    status: SiteStatusValue = "operational"
    fpcon: Fpcon
    emcon: Emcon
    show_fpcon: bool = True
    show_emcon: bool = True
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


# --- Service template ---


class ServiceTemplateIn(BaseModel):
    name: str
    kind: ServiceKind = "other"
    category: ServiceCategory = "other"
    reach: ServiceReach = "local"
    icon: Optional[str] = None
    description: Optional[str] = None
    allowed_statuses: Optional[list[StatusValue]] = None


class ServiceTemplatePatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[ServiceKind] = None
    category: Optional[ServiceCategory] = None
    reach: Optional[ServiceReach] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    allowed_statuses: Optional[list[StatusValue]] = None


class ServiceTemplateOut(_ORM):
    id: int
    name: str
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    description: Optional[str] = None
    allowed_statuses: Optional[list[StatusValue]] = None


# --- Service ---


_DEFAULT_PACE: list[GatewayPace] = ["primary", "alternate", "contingency", "emergency"]


class ServiceIn(BaseModel):
    name: str
    site_id: int
    service_template_id: Optional[int] = None
    kind: ServiceKind = "other"
    category: ServiceCategory = "other"
    reach: ServiceReach = "local"
    icon: Optional[str] = None
    description: Optional[str] = None
    status: StatusValue = "unknown"
    notes: Optional[str] = None
    enabled_pace: list[GatewayPace] = Field(default_factory=lambda: list(_DEFAULT_PACE))


class ServicePatch(BaseModel):
    name: Optional[str] = None
    site_id: Optional[int] = None
    service_template_id: Optional[int] = None
    kind: Optional[ServiceKind] = None
    category: Optional[ServiceCategory] = None
    reach: Optional[ServiceReach] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None
    enabled_pace: Optional[list[GatewayPace]] = None


class ServiceValidateIn(BaseModel):
    status: StatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None  # override; defaults to now
    # When true (default) cell states cascade per R10/R11 when this local
    # status is written. UI leaves the "cascade to cells" checkbox on unless
    # the operator opts out.
    cascade: bool = True


class SiteFpconIn(BaseModel):
    level: Fpcon
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None


class SiteEmconIn(BaseModel):
    level: Emcon
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None


class SiteStatusIn(BaseModel):
    status: SiteStatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None


class ServiceGatewayStatusOut(_ORM):
    """One matrix cell — this service's reachability via one gateway.

    `status` is the raw stored value (last operator validation). `effective_status`
    reflects R10 gateway/local overrides and R11 clamp so the UI can render
    it directly without re-implementing the rules.
    """

    gateway_id: int
    status: CellStatusValue
    effective_status: CellStatusValue = "unknown"
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None


class ServiceGatewayStatusValidateIn(BaseModel):
    status: StatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None


class ServiceOut(_ORM):
    id: int
    name: str
    site_id: int
    service_template_id: Optional[int] = None
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    description: Optional[str] = None
    status: StatusValue
    # Rolled-up status can be "ready" when every reachable path routes
    # through a gateway in PACE standby, so the effective side allows the
    # cell-status superset (StatusValue + "ready").
    effective_status: CellStatusValue = "unknown"
    allowed_statuses: Optional[list[StatusValue]] = None  # from template if has one
    enabled_pace: list[GatewayPace] = Field(
        default_factory=lambda: list(_DEFAULT_PACE)
    )
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
    display_order: int = 0
    notes: Optional[str] = None
    # Per-gateway matrix cells. One entry per gateway on this site whose PACE
    # tier the service enables — auto-materialized by the API on read.
    gateway_statuses: list[ServiceGatewayStatusOut] = Field(default_factory=list)


# --- Gateway ---


class GatewayIn(BaseModel):
    name: str
    kind: GatewayKind = "other"
    provider: Optional[str] = None
    status: GatewayStatusValue = "ready"
    pace: GatewayPace = "primary"
    notes: Optional[str] = None


class GatewayPatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[GatewayKind] = None
    provider: Optional[str] = None
    pace: Optional[GatewayPace] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None


class GatewayValidateIn(BaseModel):
    status: GatewayStatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None  # override; defaults to now
    # When true (default) every cell for this gateway is snapped to a new
    # value per R8/R9/R10. Off leaves cells untouched — useful when the
    # operator is just recording gateway state without re-driving cells.
    cascade: bool = True


class GatewayOut(_ORM):
    id: int
    site_id: int
    name: str
    kind: GatewayKind
    provider: Optional[str] = None
    status: GatewayStatusValue
    pace: GatewayPace = "primary"
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
    display_order: int = 0
    notes: Optional[str] = None


# --- Canvas ---


class CanvasPositionIn(BaseModel):
    x: float
    y: float


class CanvasPositionOut(BaseModel):
    site_id: int
    x: float
    y: float


class CanvasAnnotationIn(BaseModel):
    text: str = ""
    x: float = 0.0
    y: float = 0.0


class CanvasAnnotationPatch(BaseModel):
    text: Optional[str] = None
    x: Optional[float] = None
    y: Optional[float] = None


class CanvasAnnotationOut(_ORM):
    id: int
    text: str
    x: float
    y: float


class MapBundle(BaseModel):
    sites: list[SiteOut]
    positions: list[CanvasPositionOut]
    services: list[ServiceOut]
    gateways: list[GatewayOut]
    annotations: list[CanvasAnnotationOut]


# --- Status / rollup ---


class SiteRollup(BaseModel):
    id: int
    name: str
    status: SiteStatusValue
    fpcon: Fpcon
    emcon: Emcon
    show_fpcon: bool = True
    show_emcon: bool = True
    service_count: int
    gateway_count: int


class ServiceRollup(BaseModel):
    id: int
    name: str
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    status: StatusValue
    # Same rationale as ServiceOut.effective_status — rollup can be "ready".
    effective_status: CellStatusValue
    allowed_statuses: Optional[list[StatusValue]] = None
    site_id: int
    site_name: str
    validated_at: Optional[datetime.datetime] = None


class StatusRollupOut(BaseModel):
    sites: list[SiteRollup]
    services: list[ServiceRollup]


# --- Event feed ---


class EventOut(_ORM):
    id: int
    event_type: EventType = "validation"
    workspace_id: Optional[int] = None
    record_class: RecordClass = "log"
    severity: Severity = "info"
    type_slug: Optional[str] = None
    validated_at: datetime.datetime
    subject_kind: SubjectKind
    subject_id: Optional[int] = None
    second_subject_id: Optional[int] = None
    subject_name: Optional[str] = None
    subject_label: Optional[str] = None
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    prev_status: Optional[AnyStatusValue] = None
    status: Optional[AnyStatusValue] = None
    source: Literal["manual", "ingest"]
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
    note: Optional[str] = None
    edited_at: Optional[datetime.datetime] = None
    hidden_at: Optional[datetime.datetime] = None
    hidden_by_user_id: Optional[int] = None


class EventCreateIn(BaseModel):
    event_type: EventType = "validation"
    subject_kind: SubjectKind
    subject_id: Optional[int] = None
    subject_label: Optional[str] = None
    status: Optional[AnyStatusValue] = None
    prev_status: Optional[AnyStatusValue] = None
    note: Optional[str] = None
    # Catalog type for declarable (general) events — resolves record_class,
    # severity, and allowed scopes from EventTypeDef.
    type_slug: Optional[str] = None
    severity: Optional[Severity] = None
    validated_at: Optional[datetime.datetime] = None


class EventNotePatch(BaseModel):
    note: Optional[str] = None


class EventEditIn(BaseModel):
    note: Optional[str] = None
    status: Optional[AnyStatusValue] = None
    validated_at: Optional[datetime.datetime] = None


class EventBulkIds(BaseModel):
    ids: list[int]


# --- Event type catalog ---


class EventTypeDefOut(_ORM):
    id: int
    workspace_id: Optional[int] = None
    slug: str
    label: str
    description: Optional[str] = None
    category: Optional[str] = None
    record_class: RecordClass = "event"
    default_severity: Severity = "notice"
    icon: Optional[str] = None
    color: Optional[str] = None
    allowed_subject_kinds: list[SubjectKind] = Field(default_factory=list)
    is_builtin: bool = False
    is_system: bool = False
    retired_at: Optional[datetime.datetime] = None
    created_by_user_id: Optional[int] = None
    created_at: datetime.datetime


class EventTypeDefIn(BaseModel):
    slug: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]*$")
    label: str = Field(min_length=1, max_length=128)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=48)
    record_class: RecordClass = "event"
    default_severity: Severity = "notice"
    icon: Optional[str] = None
    color: Optional[str] = None
    allowed_subject_kinds: list[SubjectKind] = Field(default_factory=list)


class EventTypeDefPatch(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    category: Optional[str] = Field(default=None, max_length=48)
    record_class: Optional[RecordClass] = None
    default_severity: Optional[Severity] = None
    icon: Optional[str] = None
    color: Optional[str] = None
    allowed_subject_kinds: Optional[list[SubjectKind]] = None


# --- Rules engine ---


class RuleActionStep(BaseModel):
    action: str
    params: dict[str, Any] = Field(default_factory=dict)


class RuleComputedField(BaseModel):
    """A derived field: template = {field} interpolation; expr = a value
    expression tree (arithmetic, cat, coalesce, if, ...)."""

    name: str = Field(min_length=1, max_length=48, pattern=r"^[a-z][a-z0-9_]*$")
    kind: Literal["template", "expr"] = "template"
    template: Optional[str] = None
    expr: Optional[Any] = None


class RuleOut(_ORM):
    id: int
    workspace_id: Optional[int] = None
    name: str
    description: Optional[str] = None
    trigger: str
    conditions: Optional[Any] = None
    enrichers: list[str] = Field(default_factory=list)
    computed: list[RuleComputedField] = Field(default_factory=list)
    actions: list[RuleActionStep] = Field(default_factory=list)
    enabled: bool = True
    is_builtin: bool = False
    on_error: Literal["abort", "skip"] = "skip"
    priority: int = 100
    created_by_user_id: Optional[int] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class RuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    description: Optional[str] = None
    trigger: str
    conditions: Optional[Any] = None
    enrichers: list[str] = Field(default_factory=list)
    computed: list[RuleComputedField] = Field(default_factory=list)
    actions: list[RuleActionStep] = Field(min_length=1)
    enabled: bool = True
    on_error: Literal["abort", "skip"] = "skip"
    priority: int = 100


class RulePatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    trigger: Optional[str] = None
    conditions: Optional[Any] = None
    # Sentinel-free clearing: send conditions_clear=true to drop conditions.
    conditions_clear: bool = False
    enrichers: Optional[list[str]] = None
    computed: Optional[list[RuleComputedField]] = None
    actions: Optional[list[RuleActionStep]] = None
    enabled: Optional[bool] = None
    on_error: Optional[Literal["abort", "skip"]] = None
    priority: Optional[int] = None


class RuleTestIn(BaseModel):
    """Dry-run a rule draft: computed fields + conditions evaluated against
    a caller-supplied sample payload. Pure evaluation — no side effects."""

    computed: list[RuleComputedField] = Field(default_factory=list)
    conditions: Optional[Any] = None
    sample: dict[str, Any] = Field(default_factory=dict)


class RuleTestOut(BaseModel):
    computed_values: dict[str, Any]
    matched: bool


class RuleExecutionOut(_ORM):
    id: int
    rule_id: int
    trigger: str
    fired_at: datetime.datetime
    status: str
    error: Optional[str] = None
    context: Optional[dict[str, Any]] = None


class EventSummaryOut(BaseModel):
    """Counts backing the events-page widget row."""

    total_events: int
    total_logs: int
    events_today: int
    by_severity: dict[str, int]
    by_type: dict[str, int]
    # 24 hourly buckets (oldest first) of event-class records — sparkline data.
    activity_24h: list[int]
    exercise_phase: Optional[str] = None
    exercise_phase_at: Optional[datetime.datetime] = None
    personnel_on_site: int = 0
    services_down: int = 0


# --- Enclave source / ingest ---


class EnclaveSourceIn(BaseModel):
    name: str
    scoi_url: Optional[str] = None
    notes: Optional[str] = None


class EnclaveSourceOut(_ORM):
    id: int
    name: str
    scoi_url: Optional[str] = None
    last_contact_at: Optional[datetime.datetime] = None
    sync_status: str
    notes: Optional[str] = None


class EnclaveSourceCreated(BaseModel):
    enclave_source: EnclaveSourceOut
    ingest_token: str


class IngestService(BaseModel):
    name: str
    kind: ServiceKind = "other"
    status: StatusValue = "unknown"
    site_name: Optional[str] = None


class IngestPayload(BaseModel):
    source_name: str
    ts: datetime.datetime
    services: list[IngestService] = Field(default_factory=list)


class IngestAck(BaseModel):
    accepted: bool
    enclave_source_id: int


# --- Site property templates ---

# "personnel" holds a workspace personnel id — for roles like a site's
# OIC/NCOIC. Rendered as a person pill in the UI.
SitePropertyType = Literal[
    "text",
    "long_text",
    "number",
    "phone",
    "email",
    "url",
    "date",
    "bool",
    "personnel",
]
SitePropertySource = Literal["template", "custom"]


class SitePropertyDefinitionIn(BaseModel):
    key: str
    label: str
    type: SitePropertyType = "text"
    required: bool = False
    group: Optional[str] = None
    description: Optional[str] = None
    display_order: int = 0


class SitePropertyDefinitionPatch(BaseModel):
    key: Optional[str] = None
    label: Optional[str] = None
    type: Optional[SitePropertyType] = None
    required: Optional[bool] = None
    group: Optional[str] = None
    description: Optional[str] = None
    display_order: Optional[int] = None


class SitePropertyDefinitionOut(_ORM):
    id: int
    template_id: int
    key: str
    label: str
    type: SitePropertyType
    required: bool = False
    group: Optional[str] = None
    description: Optional[str] = None
    display_order: int = 0


class SitePropertyTemplateIn(BaseModel):
    name: str
    description: Optional[str] = None
    group_order: list[str] = Field(default_factory=list)


class SitePropertyTemplatePatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    group_order: Optional[list[str]] = None


class SitePropertyTemplateOut(_ORM):
    id: int
    workspace_id: int
    name: str
    description: Optional[str] = None
    group_order: list[str] = Field(default_factory=list)
    created_at: datetime.datetime
    updated_at: datetime.datetime
    definitions: list[SitePropertyDefinitionOut] = Field(default_factory=list)


class SitePropertyTemplateDuplicateIn(BaseModel):
    name: str
    description: Optional[str] = None


class RenameGroupIn(BaseModel):
    """Rename or delete a group in one atomic operation.

    `old` is the current group name (`None` means the implicit ungrouped
    bucket — cannot be renamed but can absorb definitions on delete of
    another group). `new` is the destination name; pass `None` to remove
    the group entirely, moving its definitions to ungrouped.
    """

    old: Optional[str]
    new: Optional[str]


# Portable, ID-free representation of a template. `format_version` guards
# breaking changes; bump on any incompatible schema shift.


class ExportedSitePropertyDefinition(BaseModel):
    key: str
    label: str
    type: SitePropertyType = "text"
    required: bool = False
    group: Optional[str] = None
    description: Optional[str] = None
    display_order: int = 0


class SitePropertyTemplateExport(BaseModel):
    format_version: Literal[1] = 1
    exported_at: datetime.datetime
    name: str
    description: Optional[str] = None
    group_order: list[str] = Field(default_factory=list)
    definitions: list[ExportedSitePropertyDefinition] = Field(default_factory=list)


class SitePropertyTemplateImportIn(BaseModel):
    payload: SitePropertyTemplateExport
    name_override: Optional[str] = None


# --- Per-site properties ---


class SitePropertyIn(BaseModel):
    """Create a custom (ad-hoc) property on a site."""

    key: str
    label: str
    type: SitePropertyType = "text"
    required: bool = False
    group: Optional[str] = None
    description: Optional[str] = None
    display_order: int = 0
    value: Optional[Any] = None


class SitePropertyPatch(BaseModel):
    key: Optional[str] = None
    label: Optional[str] = None
    type: Optional[SitePropertyType] = None
    required: Optional[bool] = None
    group: Optional[str] = None
    description: Optional[str] = None
    display_order: Optional[int] = None
    value: Optional[Any] = None


class SitePropertyValueIn(BaseModel):
    """Value-only write for the Details tab inline editor."""

    value: Optional[Any] = None


class SitePropertyOut(_ORM):
    id: int
    site_id: int
    key: str
    label: str
    type: SitePropertyType
    required: bool = False
    group: Optional[str] = None
    description: Optional[str] = None
    display_order: int = 0
    value: Optional[Any] = None
    source: SitePropertySource = "custom"


class SiteApplyTemplateIn(BaseModel):
    """Apply a template's definitions to a site.

    `mode="add"` keeps existing properties untouched — new definitions are
    added, existing keys are left alone. `mode="replace"` removes any
    template-sourced properties not in the template and refreshes the rest;
    custom (ad-hoc) properties survive either mode.
    """

    template_id: int
    mode: Literal["add", "replace"] = "add"


# --- Personnel, work centers, teams, units ---

PersonnelType = Literal["military", "civilian"]
Branch = Literal[
    "air_force", "army", "navy", "marines", "space_force", "coast_guard"
]
PersonnelStatusValue = Literal[
    "unknown",
    "on_site",
    "traveling",
    "off_site",
    "out_of_office",
    "lunch",
    "leave",
    "sick",
    "training",
]
# AFSC skill level (Air Force enlisted): 1 Helper, 3 Apprentice, 5 Journeyman,
# 7 Craftsman, 9 Superintendent.
SkillLevel = Literal[1, 3, 5, 7, 9]


class UnitIn(BaseModel):
    name: str
    description: Optional[str] = None
    branch: Optional[Branch] = None
    is_default: bool = False
    parent_unit_id: Optional[int] = None


class UnitPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    branch: Optional[Branch] = None
    is_default: Optional[bool] = None
    parent_unit_id: Optional[int] = None


class UnitOut(_ORM):
    id: int
    workspace_id: int
    name: str
    description: Optional[str] = None
    branch: Optional[Branch] = None
    is_default: bool = False
    parent_unit_id: Optional[int] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class WorkCenterIn(BaseModel):
    name: str
    description: Optional[str] = None


class WorkCenterPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class WorkCenterOut(_ORM):
    id: int
    workspace_id: int
    name: str
    description: Optional[str] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class TeamLeadIn(BaseModel):
    work_center_id: int
    personnel_id: int


class TeamIn(BaseModel):
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    ncoic_id: Optional[int] = None
    leads: list[TeamLeadIn] = []


class TeamPatch(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    ncoic_id: Optional[int] = None
    # Omitted → untouched; provided → replaces the full lead set.
    leads: Optional[list[TeamLeadIn]] = None


class TeamLeadOut(_ORM):
    work_center_id: int
    personnel_id: int


class TeamOut(_ORM):
    id: int
    workspace_id: int
    name: str
    slug: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    ncoic_id: Optional[int] = None
    leads: list[TeamLeadOut] = []
    created_at: datetime.datetime
    updated_at: datetime.datetime


class PersonnelIn(BaseModel):
    personnel_type: PersonnelType = "military"
    is_guest: bool = False
    is_commander: bool = False
    affiliation: Optional[str] = None
    escort: Optional[str] = None
    branch: Optional[Branch] = "air_force"
    rank: Optional[str] = None
    skill_level: Optional[SkillLevel] = None
    last_name: str
    first_name: str
    cellphone: Optional[str] = None
    dsn: Optional[str] = None
    sipr_number: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    work_center_id: Optional[int] = None
    unit_id: Optional[int] = None
    supervisor_id: Optional[int] = None
    assigned_site_id: Optional[int] = None
    room_number: Optional[str] = None
    team_ids: list[int] = Field(default_factory=list)


class PersonnelPatch(BaseModel):
    personnel_type: Optional[PersonnelType] = None
    is_guest: Optional[bool] = None
    is_commander: Optional[bool] = None
    affiliation: Optional[str] = None
    escort: Optional[str] = None
    branch: Optional[Branch] = None
    rank: Optional[str] = None
    skill_level: Optional[SkillLevel] = None
    last_name: Optional[str] = None
    first_name: Optional[str] = None
    cellphone: Optional[str] = None
    dsn: Optional[str] = None
    sipr_number: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    work_center_id: Optional[int] = None
    unit_id: Optional[int] = None
    supervisor_id: Optional[int] = None
    assigned_site_id: Optional[int] = None
    room_number: Optional[str] = None
    team_ids: Optional[list[int]] = None


class PersonnelOut(_ORM):
    id: int
    workspace_id: int
    personnel_type: PersonnelType
    is_guest: bool = False
    is_commander: bool = False
    affiliation: Optional[str] = None
    escort: Optional[str] = None
    branch: Optional[Branch] = None
    rank: Optional[str] = None
    skill_level: Optional[int] = None
    last_name: str
    first_name: str
    cellphone: Optional[str] = None
    dsn: Optional[str] = None
    sipr_number: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    work_center_id: Optional[int] = None
    unit_id: Optional[int] = None
    supervisor_id: Optional[int] = None
    assigned_site_id: Optional[int] = None
    room_number: Optional[str] = None
    team_ids: list[int] = Field(default_factory=list)
    current_status: PersonnelStatusValue = "unknown"
    current_site_id: Optional[int] = None
    current_status_since: Optional[datetime.datetime] = None
    current_status_note: Optional[str] = None
    expected_return_at: Optional[datetime.datetime] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class PersonnelCheckInIn(BaseModel):
    """Sign-in / sign-out: set the person's current location status.

    `site_id` carries the present location for `on_site` (required) and the
    destination for `traveling`; it is ignored for site-less statuses. The
    endpoint appends a PersonnelLocationEvent row and updates the denormalized
    current_* fields on the Personnel row so lists stay fast.
    `expected_return_at` is an optional accountability timer.
    """

    status: PersonnelStatusValue
    site_id: Optional[int] = None
    note: Optional[str] = None
    expected_return_at: Optional[datetime.datetime] = None
    changed_at: Optional[datetime.datetime] = None  # override; defaults to now


class PersonnelCheckInBulkIn(BaseModel):
    """Apply one status to many people at once (multi check-in/out, roll call).

    `site_id` is required when `status` is on_site/traveling and ignored
    otherwise, matching the single check-in. Ids not in the workspace are
    silently skipped.
    """

    person_ids: list[int]
    status: PersonnelStatusValue
    site_id: Optional[int] = None
    note: Optional[str] = None
    expected_return_at: Optional[datetime.datetime] = None
    changed_at: Optional[datetime.datetime] = None


class PersonnelResetIn(BaseModel):
    """End-of-day reset: send the whole workspace roster to `status`."""

    status: PersonnelStatusValue = "unknown"


class PersonnelResetOut(BaseModel):
    reset: int


class PersonnelLocationEventOut(_ORM):
    id: int
    personnel_id: int
    status: PersonnelStatusValue
    site_id: Optional[int] = None
    note: Optional[str] = None
    expected_return_at: Optional[datetime.datetime] = None
    changed_at: datetime.datetime
    changed_by_user_id: Optional[int] = None


class PersonnelCsvImportIn(BaseModel):
    """Bulk import from CSV. `csv_text` is the raw file body as string.

    Column mapping (header row required, case-insensitive):
      first_name, last_name, personnel_type, branch, rank, cellphone, dsn,
      sipr_number, email, notes, work_center, unit, room_number.
    Missing optional columns are fine. Work center / unit are matched by
    name and auto-created if missing.
    """

    csv_text: str
    # If true, missing work centers / units named in the CSV are created.
    # Off means unknown names are ignored (person still imports without them).
    create_missing: bool = True


class PersonnelCsvImportOut(BaseModel):
    imported: int
    skipped: int
    created_work_centers: list[str] = Field(default_factory=list)
    created_units: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)


# Portable export shapes — reference parents by name, no ids.


class ExportedUnit(BaseModel):
    name: str
    description: Optional[str] = None
    parent_unit_name: Optional[str] = None


class ExportedWorkCenter(BaseModel):
    name: str
    description: Optional[str] = None


class ExportedTeam(BaseModel):
    name: str
    description: Optional[str] = None
    color: Optional[str] = None


class ExportedPersonnel(BaseModel):
    personnel_type: PersonnelType = "military"
    branch: Optional[Branch] = None
    rank: Optional[str] = None
    skill_level: Optional[int] = None
    last_name: str
    first_name: str
    cellphone: Optional[str] = None
    dsn: Optional[str] = None
    sipr_number: Optional[str] = None
    email: Optional[str] = None
    notes: Optional[str] = None
    work_center_name: Optional[str] = None
    unit_name: Optional[str] = None
    # Supervisor referenced by "Last, First" — enough given personnel are
    # workspace-scoped and rarely duplicated. If duplicates exist, first
    # match wins on import.
    supervisor_key: Optional[str] = None
    assigned_site_name: Optional[str] = None
    room_number: Optional[str] = None
    team_names: list[str] = Field(default_factory=list)
    # Current sign-in state at export time. Preserved through duplicate/import
    # so a snapshot doesn't lose the location board.
    current_status: PersonnelStatusValue = "unknown"
    current_site_name: Optional[str] = None
    current_status_note: Optional[str] = None
    expected_return_at: Optional[datetime.datetime] = None
