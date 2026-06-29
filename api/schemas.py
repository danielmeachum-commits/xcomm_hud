"""Pydantic v2 schemas for xcomm_hud API."""

from __future__ import annotations

import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Classification = Literal["U", "CUI", "S", "TS"]
StatusValue = Literal["up", "degraded", "down", "unknown"]
EquipmentKind = Literal["router", "switch", "server", "crypto", "phone", "other"]
ServiceKind = Literal["voip", "data", "video", "crypto", "other"]
ServiceHosting = Literal["self", "cloud", "hybrid"]
ComponentRole = Literal["primary", "backup", "uplink", "dependency"]
UserRole = Literal["viewer", "operator", "admin"]
SubjectKind = Literal["equipment", "service", "utc", "site"]


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


class MeOut(BaseModel):
    user_id: int
    username: str
    display_name: Optional[str] = None
    role: UserRole


# --- Site ---


class SiteIn(BaseModel):
    name: str
    location_label: Optional[str] = None
    classification: Classification = "U"
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SitePatch(BaseModel):
    name: Optional[str] = None
    location_label: Optional[str] = None
    classification: Optional[Classification] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None


class SiteOut(_ORM):
    id: int
    name: str
    location_label: Optional[str] = None
    classification: Classification
    lat: Optional[float] = None
    lon: Optional[float] = None
    notes: Optional[str] = None
    status: StatusValue = "unknown"  # computed rollup


# --- UTC ---


class UTCIn(BaseModel):
    designation: str
    name: Optional[str] = None
    notes: Optional[str] = None


class UTCPatch(BaseModel):
    designation: Optional[str] = None
    name: Optional[str] = None
    notes: Optional[str] = None


class UTCOut(_ORM):
    id: int
    site_id: int
    designation: str
    name: Optional[str] = None
    notes: Optional[str] = None
    status: StatusValue = "unknown"  # computed rollup


# --- Equipment ---


class EquipmentIn(BaseModel):
    site_id: int
    utc_id: Optional[int] = None
    name: str
    kind: EquipmentKind = "other"
    vendor: Optional[str] = None
    model: Optional[str] = None
    role: Optional[str] = None
    status: StatusValue = "unknown"
    notes: Optional[str] = None


class EquipmentPatch(BaseModel):
    utc_id: Optional[int] = None
    name: Optional[str] = None
    kind: Optional[EquipmentKind] = None
    vendor: Optional[str] = None
    model: Optional[str] = None
    role: Optional[str] = None
    status: Optional[StatusValue] = None
    notes: Optional[str] = None
    clear_manual_override: bool = False


class EquipmentOut(_ORM):
    id: int
    site_id: int
    utc_id: Optional[int] = None
    name: str
    kind: EquipmentKind
    vendor: Optional[str] = None
    model: Optional[str] = None
    role: Optional[str] = None
    status: StatusValue
    manual_status_override: bool
    source_enclave_id: Optional[int] = None
    source_device_ref: Optional[str] = None
    notes: Optional[str] = None


# --- Service ---


class ServiceComponentIn(BaseModel):
    equipment_id: int
    role: ComponentRole = "primary"
    required: bool = True


class ServiceComponentOut(_ORM):
    equipment_id: int
    role: ComponentRole
    required: bool


class ServiceIn(BaseModel):
    name: str
    site_id: Optional[int] = None
    kind: ServiceKind = "other"
    hosting: ServiceHosting = "self"
    notes: Optional[str] = None
    components: list[ServiceComponentIn] = Field(default_factory=list)


class ServicePatch(BaseModel):
    name: Optional[str] = None
    site_id: Optional[int] = None
    kind: Optional[ServiceKind] = None
    hosting: Optional[ServiceHosting] = None
    status: Optional[StatusValue] = None
    notes: Optional[str] = None
    clear_manual_override: bool = False


class ServiceOut(_ORM):
    id: int
    name: str
    site_id: Optional[int] = None
    kind: ServiceKind
    hosting: ServiceHosting
    status: StatusValue
    manual_status_override: bool
    notes: Optional[str] = None
    components: list[ServiceComponentOut] = Field(default_factory=list)


# --- Status / rollup ---


class SiteRollup(BaseModel):
    id: int
    name: str
    status: StatusValue
    utc_count: int
    equipment_count: int
    service_count: int


class ServiceRollup(BaseModel):
    id: int
    name: str
    kind: ServiceKind
    hosting: ServiceHosting
    status: StatusValue
    site_id: Optional[int] = None


class StatusRollupOut(BaseModel):
    sites: list[SiteRollup]
    services: list[ServiceRollup]


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
    ingest_token: str  # plaintext, shown once


class IngestEquipment(BaseModel):
    ref: str  # source-side identifier
    name: str
    kind: EquipmentKind = "other"
    status: StatusValue = "unknown"
    site_name: Optional[str] = None
    utc_designation: Optional[str] = None
    notes: Optional[str] = None


class IngestServiceComponent(BaseModel):
    equipment_ref: str
    role: ComponentRole = "primary"
    required: bool = True


class IngestService(BaseModel):
    name: str
    kind: ServiceKind = "other"
    hosting: ServiceHosting = "self"
    status: StatusValue = "unknown"
    site_name: Optional[str] = None
    components: list[IngestServiceComponent] = Field(default_factory=list)


class IngestPayload(BaseModel):
    source_name: str
    ts: datetime.datetime
    equipment: list[IngestEquipment] = Field(default_factory=list)
    services: list[IngestService] = Field(default_factory=list)


class IngestAck(BaseModel):
    accepted: bool
    enclave_source_id: int


# --- Status event ---


class StatusEventOut(_ORM):
    id: int
    ts: datetime.datetime
    subject_kind: SubjectKind
    subject_id: int
    old_state: Optional[StatusValue] = None
    new_state: StatusValue
    source: Literal["manual", "ingest"]
    actor_user_id: Optional[int] = None
    note: Optional[str] = None
