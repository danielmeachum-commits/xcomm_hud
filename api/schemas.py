"""Pydantic v2 schemas for xcomm_hud API."""

from __future__ import annotations

import datetime
from typing import Any, Literal, Optional, get_args

from pydantic import BaseModel, ConfigDict, Field

# `unvalidated` is the seed state: nobody has said anything about this yet.
# It was called `unknown`, which read as an assessment ("we looked and can't
# tell") and never was one — every rank table and clamp in effective.py has a
# carve-out saying it carries no ordering and constrains nothing, precisely
# because it means absence rather than badness. The name now says that.
#
# Nothing in this system expresses "assessed, inconclusive". If that is ever
# wanted it is a NEW value, not this one reinterpreted.
StatusValue = Literal["up", "degraded", "down", "unvalidated", "offline", "setup"]
ServiceStatusValue = StatusValue
GatewayStatusValue = Literal["active", "ready", "degraded", "down", "offline", "setup"]
# A cell can inherit "ready" from a gateway on PACE standby (R9 cascade in
# api/effective.py), so its allowed set is a superset of ServiceStatus.
CellStatusValue = Literal[
    "up", "degraded", "down", "unvalidated", "offline", "setup", "ready"
]
SiteStatusValue = Literal[
    "operational", "limited", "degraded", "maintenance", "standby", "offline", "setup"
]
# Event rows for FPCON/EMCON/site-status changes reuse the `status` column to
# record the new level — keep this union in sync with FPCON_LEVELS,
# EMCON_LEVELS, and SITE_STATUS_VALUES.
AnyStatusValue = Literal[
    "up", "active", "ready", "degraded", "down", "unvalidated", "offline", "setup",
    "operational", "limited", "maintenance", "standby",
    "normal", "alpha", "bravo", "charlie", "delta",
    "a", "b", "c", "d",
    # Personnel sign-in states — appear on Event rows with
    # subject_kind == "personnel_location".
    #
    # `unknown` here is PERSONNEL's, not the old service/equipment seed value:
    # it means the person has never signed in. It shares nothing with
    # `unvalidated` above beyond the English word, and PersonnelStatusValue
    # deliberately keeps it — renaming that one would say something false about
    # a human's whereabouts.
    "unknown",
    "on_site", "traveling", "off_site", "out_of_office", "lunch", "leave",
    "sick", "training",
]
ServiceKind = Literal["voice", "data", "other"]
ServiceCategory = Literal["critical", "sustainment", "other"]
ServiceReach = Literal["local", "external"]
GatewayKind = Literal["milsat", "commercial", "other"]
GatewayPace = Literal["primary", "alternate", "contingency", "emergency"]
# --- Equipment tier (mirrors the tuples in models.py) ---
EquipmentCategory = Literal[
    "radio", "satcom", "crypto", "network", "compute", "power", "antenna",
    "cable", "other",
]
CapabilityKind = Literal[
    "voice", "data", "video", "satcom_rf", "los_rf", "routing", "switching",
    "crypto", "power", "other",
]
# Its own set — gear goes to `maintenance`, services and gateways don't.
EquipmentStatusValue = Literal[
    "up", "degraded", "down", "maintenance", "offline", "unvalidated"
]
EquipmentLinkKind = Literal["los", "satcom", "fiber", "cable", "wireless", "other"]
EquipmentLinkDirection = Literal["bidirectional", "a_to_b"]
UtcRole = Literal["primary", "extension", "independent"]
UtcRoleHint = Literal["primary", "extension", "either"]
CapabilityBindRole = Literal["endpoint", "transport"]
# `reported` = a human owns the status; `derived` = the dependency chain
# does, and the reported field goes read-only. Per delivery and per
# gateway, independently switchable.
StatusMode = Literal["reported", "derived"]
CapabilitySource = Literal["template", "custom"]
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
    "document",
    "doc_page",
    "equipment",
    "equipment_capability",
    "equipment_link",
    "utc_instance",
    "package_instance",
]
# Runtime view of the Literal above. `SubjectKind` stays the single declaration
# of what a kind may be; anything needing membership at runtime derives it here
# instead of repeating the list.
SUBJECT_KINDS: frozenset[str] = frozenset(get_args(SubjectKind))


class SubjectKinds:
    """Named constant per subject kind, for feed-row write sites to reference.

    Event rows are only type-checked on the way *out* (EventOut), so a kind
    invented at a `record_action` call site inserts fine and then breaks the
    whole feed at serialization time — which is how `doc_page` escaped twice.
    Going through these constants turns an invented kind into an AttributeError
    at the write itself (immediately, for module-level tables like
    action_registry.ACTIONS), and `record_action` rejects anything outside
    SUBJECT_KINDS that reaches it from data instead — so no unknown kind can
    reach the Event table.
    """

    SERVICE: SubjectKind = "service"
    SITE: SubjectKind = "site"
    GATEWAY: SubjectKind = "gateway"
    SERVICE_GATEWAY: SubjectKind = "service_gateway"
    SITE_FPCON: SubjectKind = "site_fpcon"
    SITE_EMCON: SubjectKind = "site_emcon"
    SITE_STATUS: SubjectKind = "site_status"
    PERSONNEL_LOCATION: SubjectKind = "personnel_location"
    SYSTEM: SubjectKind = "system"
    MISSION: SubjectKind = "mission"
    EXERCISE: SubjectKind = "exercise"
    TEAM: SubjectKind = "team"
    UNIT: SubjectKind = "unit"
    WORK_CENTER: SubjectKind = "work_center"
    WORKSPACE: SubjectKind = "workspace"
    DOCUMENT: SubjectKind = "document"
    DOC_PAGE: SubjectKind = "doc_page"
    EQUIPMENT: SubjectKind = "equipment"
    EQUIPMENT_CAPABILITY: SubjectKind = "equipment_capability"
    EQUIPMENT_LINK: SubjectKind = "equipment_link"
    UTC_INSTANCE: SubjectKind = "utc_instance"
    PACKAGE_INSTANCE: SubjectKind = "package_instance"


# Adding a kind means adding it to the Literal and to the class above; this
# refuses to import if only one of the two happened.
_declared_kinds = {v for k, v in vars(SubjectKinds).items() if not k.startswith("_")}
if _declared_kinds != SUBJECT_KINDS:
    raise RuntimeError(
        "SubjectKinds is out of sync with the SubjectKind literal — "
        f"missing constants for {sorted(SUBJECT_KINDS - _declared_kinds)}, "
        f"unknown kinds {sorted(_declared_kinds - SUBJECT_KINDS)}"
    )
del _declared_kinds

EventType = Literal["validation", "general", "personnel"]
RecordClass = Literal["log", "event"]
Severity = Literal["info", "notice", "warning", "critical"]

# Which subject_kinds belong to which event_type. Used for validation on both
# create and list endpoints.
VALIDATION_SUBJECT_KINDS = {
    SubjectKinds.SERVICE,
    SubjectKinds.SITE,
    SubjectKinds.GATEWAY,
    SubjectKinds.SERVICE_GATEWAY,
    SubjectKinds.SITE_FPCON,
    SubjectKinds.SITE_EMCON,
    SubjectKinds.SITE_STATUS,
    # Equipment and its capabilities carry an operator-validated status, so
    # their changes belong on the validation feed alongside services and
    # gateways. Note this does NOT make them cascade into service/gateway
    # status — see the advisory-only contract in api/effective.py.
    SubjectKinds.EQUIPMENT,
    SubjectKinds.EQUIPMENT_CAPABILITY,
}
PERSONNEL_SUBJECT_KINDS = {SubjectKinds.PERSONNEL_LOCATION}
GENERAL_SUBJECT_KINDS = {
    SubjectKinds.SYSTEM,
    SubjectKinds.MISSION,
    SubjectKinds.EXERCISE,
    SubjectKinds.SITE,
    SubjectKinds.TEAM,
    SubjectKinds.UNIT,
    SubjectKinds.WORK_CENTER,
    SubjectKinds.WORKSPACE,
    # Structural changes, not status changes — a UTC being deployed or a link
    # being rewired is news, but it isn't a validation.
    SubjectKinds.EQUIPMENT_LINK,
    SubjectKinds.UTC_INSTANCE,
    SubjectKinds.PACKAGE_INSTANCE,
}
# Free-text scopes — general events on these ride on subject_label alone and
# have no row to resolve.
LABEL_ONLY_SUBJECT_KINDS = {
    SubjectKinds.SYSTEM,
    SubjectKinds.MISSION,
    SubjectKinds.EXERCISE,
}
Fpcon = Literal["normal", "alpha", "bravo", "charlie", "delta"]
Emcon = Literal["a", "b", "c", "d"]
# Static on purpose: classification levels are stable enough that a managed
# lookup table would be ceremony around a constant. Descriptive metadata only —
# nothing orders, ranks or branches on these. See the Enclave model docstring.
Classification = Literal["unclassified", "cui", "secret", "top_secret"]


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
    enclave_name: Optional[str] = None
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


class ExportedEnclave(BaseModel):
    """A workspace-LOCAL enclave only.

    Global enclaves aren't exported — they're shared by definition and resolve
    on import by name against the target instance. Parent travels by name for
    the same reason.
    """

    name: str
    short_name: Optional[str] = None
    color: Optional[str] = None
    classification: Optional[Classification] = None
    display_order: int = 0
    parent_name: Optional[str] = None
    notes: Optional[str] = None


class ExportedEquipmentTypeCapability(BaseModel):
    kind: CapabilityKind
    label: str
    description: Optional[str] = None
    display_order: int = 0
    materialize_by_default: bool = True


class ExportedEquipmentType(BaseModel):
    """A workspace-LOCAL catalog type only.

    Global catalog rows are not exported — they're shared by definition and
    are resolved on import by title against the target instance's catalog.
    """

    title: str
    short_name: Optional[str] = None
    aliases: list[str] = Field(default_factory=list)
    nsn: Optional[str] = None
    lin: Optional[str] = None
    category: EquipmentCategory = "other"
    serialized: bool = True
    id_prefix: str = "R"
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    capabilities: list[ExportedEquipmentTypeCapability] = Field(default_factory=list)
    # By name, like every other cross-reference in the envelope.
    enclave_names: list[str] = Field(default_factory=list)


class ExportedUtcDefLine(BaseModel):
    equipment_type_title: str
    quantity: int = 1
    enclave_name: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0


class ExportedUtcDef(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    lines: list[ExportedUtcDefLine] = Field(default_factory=list)


class ExportedPackageDefUtc(BaseModel):
    utc_def_code: str
    quantity: int = 1
    role_hint: UtcRoleHint = "either"
    display_order: int = 0


class ExportedPackageDef(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    utcs: list[ExportedPackageDefUtc] = Field(default_factory=list)


class ExportedPackageInstance(BaseModel):
    name: str
    package_def_code: Optional[str] = None
    notes: Optional[str] = None


class ExportedUtcInstance(BaseModel):
    name: str
    site_name: str
    package_name: Optional[str] = None
    utc_def_code: Optional[str] = None
    role: UtcRole = "independent"
    notes: Optional[str] = None
    display_order: int = 0


class ExportedEquipmentCapability(BaseModel):
    kind: CapabilityKind
    label: str
    source: CapabilitySource = "template"
    notes: Optional[str] = None
    display_order: int = 0
    # Bindings travel by name, like everything else in the envelope.
    service_names: list[str] = Field(default_factory=list)
    gateway_names: list[str] = Field(default_factory=list)


class ExportedEquipment(BaseModel):
    equipment_code: str
    serial_number: Optional[str] = None
    equipment_type_title: str
    enclave_name: Optional[str] = None
    site_name: str
    utc_name: Optional[str] = None
    notes: Optional[str] = None
    capabilities: list[ExportedEquipmentCapability] = Field(default_factory=list)


class ExportedEquipmentHolding(BaseModel):
    utc_name: str
    equipment_type_title: str
    authorized_qty: int = 0
    on_hand_qty: int = 0
    notes: Optional[str] = None


class ExportedEquipmentLink(BaseModel):
    a_equipment_code: str
    b_equipment_code: str
    kind: EquipmentLinkKind = "other"
    direction: EquipmentLinkDirection = "bidirectional"
    label: Optional[str] = None
    notes: Optional[str] = None


class WorkspaceExport(BaseModel):
    # v2 added units / work_centers / teams / personnel. v3 added the
    # equipment tier. Old (v1/v2) payloads remain valid — every newer list
    # defaults to empty, so importing an older export just yields a
    # workspace with no equipment.
    # v4 added enclaves. Importing a v3 payload just yields untagged rows.
    format_version: Literal[1, 2, 3, 4] = 4
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
    # --- v4: enclaves. Before the equipment tier, because types reference
    # them by name and the importer resolves in list order. ---
    enclaves: list[ExportedEnclave] = Field(default_factory=list)
    # --- v3: equipment tier ---
    equipment_types: list[ExportedEquipmentType] = Field(default_factory=list)
    utc_defs: list[ExportedUtcDef] = Field(default_factory=list)
    package_defs: list[ExportedPackageDef] = Field(default_factory=list)
    package_instances: list[ExportedPackageInstance] = Field(default_factory=list)
    utc_instances: list[ExportedUtcInstance] = Field(default_factory=list)
    equipment: list[ExportedEquipment] = Field(default_factory=list)
    equipment_holdings: list[ExportedEquipmentHolding] = Field(default_factory=list)
    equipment_links: list[ExportedEquipmentLink] = Field(default_factory=list)


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
    # Which network this template is for. Where the NIPR/SIPR distinction
    # lived as a name prefix before `enclave` existed.
    enclave_id: Optional[int] = None
    kind: ServiceKind = "other"
    category: ServiceCategory = "other"
    reach: ServiceReach = "local"
    icon: Optional[str] = None
    description: Optional[str] = None
    allowed_statuses: Optional[list[StatusValue]] = None


class ServiceTemplatePatch(BaseModel):
    name: Optional[str] = None
    enclave_id: Optional[int] = None
    kind: Optional[ServiceKind] = None
    category: Optional[ServiceCategory] = None
    reach: Optional[ServiceReach] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    allowed_statuses: Optional[list[StatusValue]] = None


class ServiceTemplateOut(_ORM):
    id: int
    name: str
    enclave_id: Optional[int] = None
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
    # Copied from the template at creation when not given explicitly.
    enclave_id: Optional[int] = None
    kind: ServiceKind = "other"
    category: ServiceCategory = "other"
    reach: ServiceReach = "local"
    icon: Optional[str] = None
    description: Optional[str] = None
    status: StatusValue = "unvalidated"
    notes: Optional[str] = None
    enabled_pace: list[GatewayPace] = Field(default_factory=lambda: list(_DEFAULT_PACE))


class ServicePatch(BaseModel):
    name: Optional[str] = None
    site_id: Optional[int] = None
    service_template_id: Optional[int] = None
    enclave_id: Optional[int] = None
    kind: Optional[ServiceKind] = None
    category: Optional[ServiceCategory] = None
    reach: Optional[ServiceReach] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None
    enabled_pace: Optional[list[GatewayPace]] = None


class StatusModeIn(BaseModel):
    """Switch a delivery or gateway between reported and derived status."""

    status_mode: StatusMode


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
    effective_status: CellStatusValue = "unvalidated"
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None


class ServiceGatewayStatusValidateIn(BaseModel):
    status: StatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None


class ServiceOut(_ORM):
    """One service AS DELIVERED AT ONE SITE.

    Deliberately still delivery-shaped after the 0054 split: `id` is the
    delivery's id (which is the id this row has always had), and `site_id`,
    `status` and `gateway_statuses` mean exactly what they did before. That
    keeps every existing caller working while the storage underneath is now
    Service + ServiceDelivery.

    `service_id` is the new part — the shared identity two sites' "NIPR Web"
    now have in common. Answering "is NIPR up anywhere?" means grouping on it.
    """

    id: int
    # The identity row. Multiple deliveries share one of these.
    service_id: int
    name: str
    site_id: int
    service_template_id: Optional[int] = None
    enclave_id: Optional[int] = None
    kind: ServiceKind
    category: ServiceCategory
    reach: ServiceReach
    icon: Optional[str] = None
    description: Optional[str] = None
    # The value to DISPLAY. In derived mode this is the dependency chain's
    # answer; otherwise the human's. See equipment_status.resolve_status.
    status: StatusValue
    # The stored human value, whatever mode this is in — so the UI can show
    # "operator says X, chain says Y" without a second request.
    reported_status: StatusValue = "unvalidated"
    status_mode: StatusMode = "reported"
    derived_status: Optional[EquipmentStatusValue] = None
    # Rolled-up status can be "ready" when every reachable path routes
    # through a gateway in PACE standby, so the effective side allows the
    # cell-status superset (StatusValue + "ready").
    effective_status: CellStatusValue = "unvalidated"
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
    reported_status: GatewayStatusValue = "ready"
    status_mode: StatusMode = "reported"
    derived_status: Optional[EquipmentStatusValue] = None
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
    # Stable identity for global built-ins (NULL for workspace rules).
    key: Optional[str] = None
    version: int = 1
    name: str
    description: Optional[str] = None
    trigger: str
    conditions: Optional[Any] = None
    enrichers: list[str] = Field(default_factory=list)
    computed: list[RuleComputedField] = Field(default_factory=list)
    actions: list[RuleActionStep] = Field(default_factory=list)
    enabled: bool = True
    is_builtin: bool = False
    # Whether the requesting workspace has turned this global rule off for
    # itself (WorkspaceRuleState). Always False for workspace-owned rules,
    # whose own `enabled` already reflects their state.
    disabled_here: bool = False
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


class RuleWorkspaceStateIn(BaseModel):
    """A workspace's overlay on a global built-in: turn it off for this
    workspace without touching the shared, code-owned row."""

    disabled: bool


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


class ScoiSourceIn(BaseModel):
    name: str
    scoi_url: Optional[str] = None
    notes: Optional[str] = None


class ScoiSourceOut(_ORM):
    id: int
    name: str
    scoi_url: Optional[str] = None
    last_contact_at: Optional[datetime.datetime] = None
    sync_status: str
    notes: Optional[str] = None


class ScoiSourceCreated(BaseModel):
    scoi_source: ScoiSourceOut
    ingest_token: str


class IngestService(BaseModel):
    name: str
    kind: ServiceKind = "other"
    status: StatusValue = "unvalidated"
    site_name: Optional[str] = None


class IngestPayload(BaseModel):
    source_name: str
    ts: datetime.datetime
    services: list[IngestService] = Field(default_factory=list)


class IngestAck(BaseModel):
    accepted: bool
    scoi_source_id: int


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


# --- Documents / folders ---


class FolderIn(BaseModel):
    name: str
    parent_id: Optional[int] = None
    site_id: Optional[int] = None


class FolderPatch(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None


class FolderOut(_ORM):
    id: int
    workspace_id: int
    site_id: Optional[int] = None
    parent_id: Optional[int] = None
    name: str
    created_at: datetime.datetime


class DocumentPatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    # Explicit null moves the document back to the root (exclude_unset
    # semantics distinguish "omitted" from "set to null").
    folder_id: Optional[int] = None


class DocumentOut(_ORM):
    id: int
    workspace_id: int
    site_id: Optional[int] = None
    folder_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    category: Optional[str] = None
    filename: str
    content_type: str
    size_bytes: int
    created_by: Optional[int] = None
    created_by_username: Optional[str] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime
    current_version_no: Optional[int] = None
    version_count: int = 1


class DocumentVersionOut(_ORM):
    id: int
    document_id: int
    version_no: int
    filename: str
    content_type: str
    size_bytes: int
    note: Optional[str] = None
    created_by: Optional[int] = None
    created_by_username: Optional[str] = None
    created_at: datetime.datetime
    is_current: bool = False


class DocPageIn(BaseModel):
    slug: str
    title: str
    description: Optional[str] = None
    content: str = ""
    parent_id: Optional[int] = None
    section_id: Optional[int] = None
    display_order: int = 0


class DocPagePatch(BaseModel):
    slug: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    # Explicit null detaches the page to the top level (exclude_unset
    # distinguishes "omitted" from "set to null").
    parent_id: Optional[int] = None
    section_id: Optional[int] = None
    display_order: Optional[int] = None


class DocPageOut(_ORM):
    id: int
    parent_id: Optional[int] = None
    section_id: Optional[int] = None
    slug: str
    title: str
    description: Optional[str] = None
    content: str
    display_order: int
    created_by: Optional[int] = None
    created_by_username: Optional[str] = None
    created_at: datetime.datetime
    updated_at: datetime.datetime


class DocPageOrderItem(BaseModel):
    id: int
    parent_id: Optional[int] = None
    display_order: int


class DocPageReorderIn(BaseModel):
    items: list[DocPageOrderItem]


class DocSectionIn(BaseModel):
    slug: str
    title: str
    description: Optional[str] = None
    icon: Optional[str] = None
    display_order: int = 0


class DocSectionPatch(BaseModel):
    slug: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    icon: Optional[str] = None
    display_order: Optional[int] = None


class DocSectionOut(_ORM):
    id: int
    slug: str
    title: str
    description: Optional[str] = None
    icon: Optional[str] = None
    display_order: int
    created_at: datetime.datetime
    updated_at: datetime.datetime


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


# ===================== Enclaves =====================


class EnclaveIn(BaseModel):
    name: str
    short_name: Optional[str] = None
    parent_id: Optional[int] = None
    # Hex ("#8b5a2b"). Null for the transport layer, which has no color.
    color: Optional[str] = None
    # What this enclave is understood to carry. Null is a real answer — an
    # enclave need not declare one. Display metadata; never branched on.
    classification: Optional[Classification] = None
    display_order: int = 0
    notes: Optional[str] = None


class EnclavePatch(BaseModel):
    name: Optional[str] = None
    short_name: Optional[str] = None
    parent_id: Optional[int] = None
    color: Optional[str] = None
    classification: Optional[Classification] = None
    display_order: Optional[int] = None
    notes: Optional[str] = None
    retired: Optional[bool] = None


class EnclaveOut(_ORM):
    id: int
    workspace_id: Optional[int] = None
    parent_id: Optional[int] = None
    name: str
    short_name: Optional[str] = None
    color: Optional[str] = None
    classification: Optional[Classification] = None
    display_order: int = 0
    retired_at: Optional[datetime.datetime] = None
    notes: Optional[str] = None
    is_global: bool = False


# ===================== Equipment: catalog =====================


class EquipmentTypeCapabilityIn(BaseModel):
    kind: CapabilityKind
    label: str
    description: Optional[str] = None
    display_order: int = 0
    materialize_by_default: bool = True


class EquipmentTypeCapabilityOut(_ORM):
    id: int
    equipment_type_id: int
    kind: CapabilityKind
    label: str
    description: Optional[str] = None
    display_order: int = 0
    materialize_by_default: bool = True


class EquipmentTypeIn(BaseModel):
    title: str
    short_name: Optional[str] = None
    aliases: list[str] = Field(default_factory=list)
    # Free-form operator facets. Normalized (lowercased, deduped) by the router.
    tags: list[str] = Field(default_factory=list)
    nsn: Optional[str] = None
    lin: Optional[str] = None
    category: EquipmentCategory = "other"
    serialized: bool = True
    id_prefix: str = "R"
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    capabilities: list[EquipmentTypeCapabilityIn] = Field(default_factory=list)
    # Enclaves this model of gear can serve. Empty = unrestricted, not
    # "capable of nothing".
    enclave_ids: list[int] = Field(default_factory=list)


class EquipmentTypePatch(BaseModel):
    title: Optional[str] = None
    short_name: Optional[str] = None
    aliases: Optional[list[str]] = None
    tags: Optional[list[str]] = None
    nsn: Optional[str] = None
    lin: Optional[str] = None
    category: Optional[EquipmentCategory] = None
    serialized: Optional[bool] = None
    id_prefix: Optional[str] = None
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    retired: Optional[bool] = None


class EquipmentTypeOut(_ORM):
    id: int
    workspace_id: Optional[int] = None
    title: str
    short_name: Optional[str] = None
    aliases: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    nsn: Optional[str] = None
    lin: Optional[str] = None
    category: EquipmentCategory
    serialized: bool
    id_prefix: str
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    retired_at: Optional[datetime.datetime] = None
    capabilities: list[EquipmentTypeCapabilityOut] = Field(default_factory=list)
    # True when workspace_id is NULL — the UI gates editing on this, since
    # only admins may touch the global catalog.
    is_global: bool = False
    # Enclaves this model of gear can serve. Empty = unrestricted.
    enclave_ids: list[int] = Field(default_factory=list)


class UtcDefLineIn(BaseModel):
    equipment_type_id: int
    quantity: int = 1
    # Which enclave's stack this line belongs to — what lets the deploy wizard
    # drop a whole enclave in one action.
    enclave_id: Optional[int] = None
    notes: Optional[str] = None
    display_order: int = 0


class UtcDefLineOut(_ORM):
    id: int
    utc_def_id: int
    equipment_type_id: int
    quantity: int
    enclave_id: Optional[int] = None
    notes: Optional[str] = None
    display_order: int = 0
    # Denormalized for display so the UI doesn't need a second fetch.
    equipment_type_title: Optional[str] = None
    equipment_type_short_name: Optional[str] = None
    serialized: bool = True


class UtcDefIn(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    lines: list[UtcDefLineIn] = Field(default_factory=list)


class UtcDefPatch(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    retired: Optional[bool] = None


class UtcDefOut(_ORM):
    id: int
    workspace_id: Optional[int] = None
    code: str
    name: str
    description: Optional[str] = None
    retired_at: Optional[datetime.datetime] = None
    lines: list[UtcDefLineOut] = Field(default_factory=list)
    is_global: bool = False


class PackageDefUtcIn(BaseModel):
    utc_def_id: int
    quantity: int = 1
    role_hint: UtcRoleHint = "either"
    display_order: int = 0


class PackageDefUtcOut(_ORM):
    id: int
    package_def_id: int
    utc_def_id: int
    quantity: int
    role_hint: UtcRoleHint
    display_order: int = 0
    utc_def_code: Optional[str] = None
    utc_def_name: Optional[str] = None


class PackageDefIn(BaseModel):
    code: str
    name: str
    description: Optional[str] = None
    utcs: list[PackageDefUtcIn] = Field(default_factory=list)


class PackageDefPatch(BaseModel):
    code: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None
    retired: Optional[bool] = None


class PackageDefOut(_ORM):
    id: int
    workspace_id: Optional[int] = None
    code: str
    name: str
    description: Optional[str] = None
    retired_at: Optional[datetime.datetime] = None
    utcs: list[PackageDefUtcOut] = Field(default_factory=list)
    is_global: bool = False


# ===================== Equipment: deployed instances =====================


class PackageInstanceIn(BaseModel):
    name: str
    package_def_id: Optional[int] = None
    notes: Optional[str] = None


class PackageInstancePatch(BaseModel):
    name: Optional[str] = None
    package_def_id: Optional[int] = None
    notes: Optional[str] = None


class PackageInstanceOut(_ORM):
    id: int
    workspace_id: int
    package_def_id: Optional[int] = None
    name: str
    notes: Optional[str] = None
    package_def_code: Optional[str] = None
    # Sites this package currently touches, derived from its UTCs.
    site_ids: list[int] = Field(default_factory=list)


class UtcInstanceIn(BaseModel):
    name: str
    site_id: int
    package_instance_id: Optional[int] = None
    utc_def_id: Optional[int] = None
    role: UtcRole = "independent"
    notes: Optional[str] = None


class UtcInstancePatch(BaseModel):
    name: Optional[str] = None
    site_id: Optional[int] = None
    package_instance_id: Optional[int] = None
    utc_def_id: Optional[int] = None
    role: Optional[UtcRole] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None


class UtcInstanceOut(_ORM):
    id: int
    workspace_id: int
    package_instance_id: Optional[int] = None
    utc_def_id: Optional[int] = None
    site_id: int
    name: str
    role: UtcRole
    notes: Optional[str] = None
    display_order: int = 0
    utc_def_code: Optional[str] = None
    site_name: Optional[str] = None
    package_name: Optional[str] = None
    # Every site this UTC's gear actually sits at, home site always included.
    # `site_id` above is where the UTC is accountable; this is where it reaches.
    # More than one entry means the UTC is spread — which is what an extension
    # really is, rather than a second UTC standing in for one.
    site_ids: list[int] = Field(default_factory=list)
    # What the link graph says this UTC actually is, independent of the
    # operator-declared `role`. Null when there aren't enough links to tell.
    # A mismatch is surfaced in the UI rather than silently reconciled.
    derived_role: Optional[UtcRole] = None


class EquipmentCapabilityIn(BaseModel):
    kind: CapabilityKind
    label: str
    status: EquipmentStatusValue = "unvalidated"
    source: CapabilitySource = "custom"
    notes: Optional[str] = None
    display_order: int = 0


class EquipmentCapabilityPatch(BaseModel):
    label: Optional[str] = None
    notes: Optional[str] = None
    display_order: Optional[int] = None


class CapabilityBindingOut(BaseModel):
    """Where one capability is wired. Both lists are usually short."""

    service_ids: list[int] = Field(default_factory=list)
    gateway_ids: list[int] = Field(default_factory=list)
    # The subset of `service_ids` this capability is declared REQUIRED for,
    # and the redundancy group per binding. Carried so the binding chip can
    # show and toggle "needed for this service" without a second request.
    required_service_ids: list[int] = Field(default_factory=list)
    group_keys: dict[int, str] = Field(default_factory=dict)


class EquipmentCapabilityOut(_ORM):
    id: int
    equipment_id: int
    kind: CapabilityKind
    label: str
    status: EquipmentStatusValue
    source: CapabilitySource
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
    notes: Optional[str] = None
    display_order: int = 0
    bindings: CapabilityBindingOut = Field(default_factory=CapabilityBindingOut)


class EquipmentIn(BaseModel):
    equipment_type_id: int
    site_id: int
    # Which network this gear serves. One piece, one enclave; null for gear
    # common to all of them (power, cables, the RF shot).
    enclave_id: Optional[int] = None
    serial_number: Optional[str] = None
    # Omit to let the server generate `<id_prefix><last 4 of serial>`.
    equipment_code: Optional[str] = None
    utc_instance_id: Optional[int] = None
    status: EquipmentStatusValue = "unvalidated"
    notes: Optional[str] = None
    # Which of the type's declared capabilities to materialize. Omit to take
    # every capability flagged materialize_by_default.
    capability_kinds: Optional[list[str]] = None


class EquipmentPatch(BaseModel):
    equipment_type_id: Optional[int] = None
    site_id: Optional[int] = None
    enclave_id: Optional[int] = None
    serial_number: Optional[str] = None
    equipment_code: Optional[str] = None
    utc_instance_id: Optional[int] = None
    notes: Optional[str] = None


class EquipmentStatusIn(BaseModel):
    status: EquipmentStatusValue
    note: Optional[str] = None
    validated_at: Optional[datetime.datetime] = None


class EquipmentOut(_ORM):
    id: int
    workspace_id: int
    equipment_type_id: int
    utc_instance_id: Optional[int] = None
    site_id: int
    enclave_id: Optional[int] = None
    equipment_code: str
    serial_number: Optional[str] = None
    status: EquipmentStatusValue
    validated_at: Optional[datetime.datetime] = None
    validated_by_user_id: Optional[int] = None
    validated_by_username: Optional[str] = None
    notes: Optional[str] = None
    # Denormalized catalog fields — the list view needs all of these and
    # nobody recognizes a piece of gear by type id.
    type_title: Optional[str] = None
    type_short_name: Optional[str] = None
    type_category: Optional[EquipmentCategory] = None
    nsn: Optional[str] = None
    site_name: Optional[str] = None
    utc_name: Optional[str] = None
    capabilities: list[EquipmentCapabilityOut] = Field(default_factory=list)


class EquipmentHoldingIn(BaseModel):
    equipment_type_id: int
    authorized_qty: int = 0
    on_hand_qty: int = 0
    # Not stored on the holding itself — bulk gear is counted per type, and a
    # type's cables serve every enclave. Carried so the deploy snapshot can
    # record which enclave's stack a bulk line was part of.
    enclave_id: Optional[int] = None
    notes: Optional[str] = None


class EquipmentHoldingPatch(BaseModel):
    authorized_qty: Optional[int] = None
    on_hand_qty: Optional[int] = None
    notes: Optional[str] = None


class EquipmentHoldingOut(_ORM):
    id: int
    workspace_id: int
    utc_instance_id: int
    equipment_type_id: int
    authorized_qty: int
    on_hand_qty: int
    notes: Optional[str] = None
    type_title: Optional[str] = None
    type_short_name: Optional[str] = None
    nsn: Optional[str] = None


# --- what a deployed UTC was planned to carry ---


class UtcInstanceLineIn(BaseModel):
    equipment_type_id: int
    quantity: int = 1
    # Snapshotted like the rest of the line: the enclave this served at deploy
    # time, so a later catalog edit can't rewrite a past deployment.
    enclave_id: Optional[int] = None
    notes: Optional[str] = None


class UtcInstanceLineOut(_ORM):
    id: int
    utc_instance_id: int
    equipment_type_id: int
    quantity: int
    enclave_id: Optional[int] = None
    notes: Optional[str] = None
    type_title: Optional[str] = None
    type_short_name: Optional[str] = None
    serialized: bool = True


# `unknown` is for UTCs deployed before expectations were recorded — no rows
# means "nobody said", which must not be read as "expected nothing".
UtcCompletenessStatus = Literal["complete", "short", "over", "unknown"]


class UtcCompletenessLine(BaseModel):
    equipment_type_id: int
    type_title: Optional[str] = None
    type_short_name: Optional[str] = None
    enclave_id: Optional[int] = None
    serialized: bool = True
    expected: int
    actual: int
    # actual - expected. Negative is short, positive is gear nobody planned for.
    delta: int


class UtcCompletenessOut(BaseModel):
    """Actual contents measured against this deployment's own expected list.

    Deliberately not measured against `utc_def`: leaving an enclave's stack
    home is routine, and reporting those omissions as shortfalls forever would
    train people to ignore the indicator. `def_variance` carries the
    doctrine comparison separately, as information rather than a warning.
    """

    utc_instance_id: int
    status: UtcCompletenessStatus
    lines: list[UtcCompletenessLine] = Field(default_factory=list)
    # Expected-vs-doctrine, populated only when the UTC has a utc_def.
    def_variance: list[UtcCompletenessLine] = Field(default_factory=list)
    # Enclaves the def calls for that this deployment expects nothing from —
    # the stack was left home. DERIVED from the snapshot rather than stored, so
    # it stays correct when the expected list is edited mid-mission. These are
    # not shortfalls and must not be rendered as ones.
    unsupported_enclave_ids: list[int] = Field(default_factory=list)
    # The other half of the same answer: enclaves this deployment's snapshot
    # does expect gear from. Sent rather than left to the client, because
    # `lines` collapses per type and drops the enclave whenever a type spans
    # more than one — a TACLANE on both NIPR and SIPR lands as one unlabelled
    # row, so the enclaves it serves are simply not recoverable there.
    supported_enclave_ids: list[int] = Field(default_factory=list)


# ===================== Equipment: links and topology =====================


class EquipmentLinkIn(BaseModel):
    a_equipment_id: int
    b_equipment_id: int
    a_capability_id: Optional[int] = None
    b_capability_id: Optional[int] = None
    kind: EquipmentLinkKind = "other"
    direction: EquipmentLinkDirection = "bidirectional"
    label: Optional[str] = None
    status: EquipmentStatusValue = "unvalidated"
    notes: Optional[str] = None


class EquipmentLinkPatch(BaseModel):
    a_capability_id: Optional[int] = None
    b_capability_id: Optional[int] = None
    kind: Optional[EquipmentLinkKind] = None
    direction: Optional[EquipmentLinkDirection] = None
    label: Optional[str] = None
    status: Optional[EquipmentStatusValue] = None
    notes: Optional[str] = None


class EquipmentLinkOut(_ORM):
    id: int
    workspace_id: int
    a_equipment_id: int
    b_equipment_id: int
    a_capability_id: Optional[int] = None
    b_capability_id: Optional[int] = None
    kind: EquipmentLinkKind
    direction: EquipmentLinkDirection
    label: Optional[str] = None
    status: EquipmentStatusValue
    notes: Optional[str] = None
    # Denormalized so the canvas can label and group edges in one pass.
    a_equipment_code: Optional[str] = None
    b_equipment_code: Optional[str] = None
    a_site_id: Optional[int] = None
    b_site_id: Optional[int] = None


class BackingCapability(BaseModel):
    """One capability standing behind a service or gateway."""

    capability_id: int
    equipment_id: int
    equipment_code: str
    label: str
    kind: CapabilityKind
    status: EquipmentStatusValue
    role: Optional[CapabilityBindRole] = None
    # Does this gate the service, or just stand behind it? Only `required`
    # bindings move the derived value.
    required: bool = False
    # Required bindings sharing a key are OR'd (one live path is enough);
    # groups AND together. Null = its own group.
    group_key: Optional[str] = None


class DerivedStatus(BaseModel):
    """Advisory comparison of reported vs equipment-derived status.

    This is READ-ONLY on purpose. Equipment never writes gateway or service
    status — doing so would blank the operator's matrix on every blip (see
    `cell_status_from_gateway` in api/effective.py) and would erase the
    human attribution the model records in `validated_by_user_id`. The UI
    shows `derived` next to `reported` and offers an explicit Apply that
    goes through the normal validation endpoint under the operator's name.
    """

    reported: str
    derived: Optional[EquipmentStatusValue] = None
    # True when derived is meaningfully worse than reported — what the UI
    # badges and what the advisory rule fires on.
    disagrees: bool = False
    backing: list[BackingCapability] = Field(default_factory=list)
    # --- the hole in the chain, carried BESIDE the status, never inside it ---
    # `derived` skips unvalidated capabilities when computing a value, because
    # a chain that returned `unvalidated` for one unchecked port would be
    # useless immediately. What we do not know is reported here instead, as a
    # count — modelled on the UTC completeness panel, which already
    # establishes "here is what we cannot see" as its own signal.
    required_total: int = 0
    required_unvalidated: int = 0
    unvalidated_labels: list[str] = Field(default_factory=list)


class CapabilityWiringIn(BaseModel):
    """One proposed capability→target binding from the deploy wizard."""

    # Index into the deploy payload's `items` list, since the equipment rows
    # don't exist yet when the wizard builds this.
    item_index: int
    capability_kind: CapabilityKind
    service_id: Optional[int] = None
    gateway_id: Optional[int] = None
    role: CapabilityBindRole = "endpoint"


class UtcDeployItemIn(BaseModel):
    """One serialized item being registered as part of the deploy."""

    equipment_type_id: int
    serial_number: Optional[str] = None
    equipment_code: Optional[str] = None
    # The enclave this kit serves, carried from the UTC line it came from.
    enclave_id: Optional[int] = None
    status: EquipmentStatusValue = "unvalidated"
    notes: Optional[str] = None
    capability_kinds: Optional[list[str]] = None


class UtcDeployIn(BaseModel):
    """The deploy-a-UTC wizard's single transactional payload.

    Everything lands in one request so a half-built UTC can't exist: the
    utc_instance, its serialized equipment with materialized capabilities,
    its bulk holdings, and the operator-accepted capability bindings.
    """

    site_id: int
    name: str
    role: UtcRole = "independent"
    utc_def_id: Optional[int] = None
    package_instance_id: Optional[int] = None
    # Create a new package instance in the same transaction. Ignored when
    # package_instance_id is set.
    new_package_name: Optional[str] = None
    new_package_def_id: Optional[int] = None
    notes: Optional[str] = None
    items: list[UtcDeployItemIn] = Field(default_factory=list)
    holdings: list[EquipmentHoldingIn] = Field(default_factory=list)
    wiring: list[CapabilityWiringIn] = Field(default_factory=list)


class UtcDeployOut(BaseModel):
    utc_instance: UtcInstanceOut
    equipment: list[EquipmentOut] = Field(default_factory=list)
    holdings: list[EquipmentHoldingOut] = Field(default_factory=list)
    bindings_created: int = 0


class TopologySiteNode(BaseModel):
    site_id: int
    name: str
    status: SiteStatusValue
    utc_instance_ids: list[int] = Field(default_factory=list)


class NetworkTopologyOut(BaseModel):
    """Everything the network canvas needs, in one bundle.

    Built as a single bulk pass in the style of `routers/status.py::rollup` —
    the canvas is the hottest read in the equipment tier and must not N+1.
    """

    sites: list[TopologySiteNode] = Field(default_factory=list)
    utc_instances: list[UtcInstanceOut] = Field(default_factory=list)
    equipment: list[EquipmentOut] = Field(default_factory=list)
    links: list[EquipmentLinkOut] = Field(default_factory=list)
    positions: list["EquipmentPositionOut"] = Field(default_factory=list)
    # Advisory reported-vs-derived, keyed by id. Never written back.
    service_derived: dict[int, DerivedStatus] = Field(default_factory=dict)
    gateway_derived: dict[int, DerivedStatus] = Field(default_factory=dict)


class EquipmentPositionIn(BaseModel):
    x: float
    y: float


class EquipmentPositionOut(BaseModel):
    equipment_id: int
    x: float
    y: float
