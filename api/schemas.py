"""Pydantic v2 schemas for xcomm_hud API."""

from __future__ import annotations

import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

StatusValue = Literal["up", "degraded", "down", "unknown", "offline", "setup"]
ServiceStatusValue = StatusValue
GatewayStatusValue = Literal["active", "ready", "degraded", "down", "offline", "setup"]
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
    "system",
    "mission",
    "exercise",
]
EventType = Literal["validation", "general"]

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
GENERAL_SUBJECT_KINDS = {"system", "mission", "exercise"}
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
    format_version: Literal[1] = 1
    exported_at: datetime.datetime
    workspace: ExportedWorkspaceMeta
    sites: list[ExportedSite] = Field(default_factory=list)
    services: list[ExportedService] = Field(default_factory=list)
    gateways: list[ExportedGateway] = Field(default_factory=list)
    positions: list[ExportedPosition] = Field(default_factory=list)
    annotations: list[ExportedAnnotation] = Field(default_factory=list)


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
    status: StatusValue
    effective_status: StatusValue = "unknown"
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
    effective_status: StatusValue = "unknown"  # cascaded; same as status for local
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
    effective_status: StatusValue
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
    validated_at: datetime.datetime
    subject_kind: SubjectKind
    subject_id: Optional[int] = None
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


class EventNotePatch(BaseModel):
    note: Optional[str] = None


class EventBulkIds(BaseModel):
    ids: list[int]


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
