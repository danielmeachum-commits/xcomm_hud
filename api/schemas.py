"""Pydantic v2 schemas for xcomm_hud API."""

from __future__ import annotations

import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Classification = Literal["U", "CUI", "S", "TS"]
StatusValue = Literal["up", "degraded", "down", "unknown"]
ServiceKind = Literal["voip", "data", "video", "crypto", "other"]
ServiceHosting = Literal["self", "cloud", "hybrid"]
UserRole = Literal["viewer", "operator", "admin"]
SubjectKind = Literal["service", "site"]


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
    status: StatusValue = "unknown"  # computed rollup of services


# --- Service ---


class ServiceIn(BaseModel):
    name: str
    site_id: Optional[int] = None
    kind: ServiceKind = "other"
    hosting: ServiceHosting = "self"
    status: StatusValue = "unknown"
    notes: Optional[str] = None


class ServicePatch(BaseModel):
    name: Optional[str] = None
    site_id: Optional[int] = None
    kind: Optional[ServiceKind] = None
    hosting: Optional[ServiceHosting] = None
    status: Optional[StatusValue] = None
    notes: Optional[str] = None
    note: Optional[str] = None  # optional event note when status changes


class ServiceOut(_ORM):
    id: int
    name: str
    site_id: Optional[int] = None
    kind: ServiceKind
    hosting: ServiceHosting
    status: StatusValue
    notes: Optional[str] = None


# --- Status / rollup ---


class SiteRollup(BaseModel):
    id: int
    name: str
    status: StatusValue
    service_count: int


class ServiceRollup(BaseModel):
    id: int
    name: str
    kind: ServiceKind
    hosting: ServiceHosting
    status: StatusValue
    site_id: Optional[int] = None
    site_name: Optional[str] = None


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


class IngestService(BaseModel):
    name: str
    kind: ServiceKind = "other"
    hosting: ServiceHosting = "self"
    status: StatusValue = "unknown"
    site_name: Optional[str] = None


class IngestPayload(BaseModel):
    source_name: str
    ts: datetime.datetime
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
