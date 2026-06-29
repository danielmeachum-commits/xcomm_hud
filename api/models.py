"""SQLAlchemy 2.x declarative models for xcomm_hud."""

from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


# Equipment kinds and status values are kept as plain strings (not PG enums)
# so additions don't require migrations. App-level validation in schemas.py.

EQUIPMENT_KINDS = ("router", "switch", "server", "crypto", "phone", "other")
STATUS_VALUES = ("up", "degraded", "down", "unknown")
SERVICE_KINDS = ("voip", "data", "video", "crypto", "other")
SERVICE_HOSTING = ("self", "cloud", "hybrid")
COMPONENT_ROLES = ("primary", "backup", "uplink", "dependency")
USER_ROLES = ("viewer", "operator", "admin")
STATUS_EVENT_SOURCES = ("manual", "ingest")
SUBJECT_KINDS = ("equipment", "service", "utc", "site")


class User(Base):
    __tablename__ = "user"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="viewer")
    disabled_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class Site(Base):
    __tablename__ = "site"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    location_label: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    classification: Mapped[str] = mapped_column(String(8), nullable=False, default="U")
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    utcs: Mapped[list["UTC"]] = relationship(
        "UTC", back_populates="site", cascade="all, delete-orphan"
    )
    equipment: Mapped[list["Equipment"]] = relationship(
        "Equipment", back_populates="site", cascade="all, delete-orphan"
    )


class EnclaveSource(Base):
    __tablename__ = "enclave_source"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    scoi_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ingest_token_hash: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_contact_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sync_status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )


class UTC(Base):
    __tablename__ = "utc"
    __table_args__ = (
        UniqueConstraint("site_id", "designation", name="uq_utc_site_designation"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False
    )
    designation: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )

    site: Mapped["Site"] = relationship("Site", back_populates="utcs")
    equipment: Mapped[list["Equipment"]] = relationship("Equipment", back_populates="utc")


class Equipment(Base):
    __tablename__ = "equipment"
    __table_args__ = (
        UniqueConstraint("site_id", "name", name="uq_equipment_site_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False
    )
    utc_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("utc.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    vendor: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    model: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    role: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    manual_status_override: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    source_enclave_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("enclave_source.id", ondelete="SET NULL"), nullable=True
    )
    source_device_ref: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    site: Mapped["Site"] = relationship("Site", back_populates="equipment")
    utc: Mapped[Optional["UTC"]] = relationship("UTC", back_populates="equipment")
    service_links: Mapped[list["ServiceComponent"]] = relationship(
        "ServiceComponent", back_populates="equipment", cascade="all, delete-orphan"
    )


class Service(Base):
    __tablename__ = "service"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="SET NULL"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    hosting: Mapped[str] = mapped_column(String(16), nullable=False, default="self")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    manual_status_override: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    components: Mapped[list["ServiceComponent"]] = relationship(
        "ServiceComponent", back_populates="service", cascade="all, delete-orphan"
    )


class ServiceComponent(Base):
    __tablename__ = "service_component"

    service_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("service.id", ondelete="CASCADE"), primary_key=True
    )
    equipment_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("equipment.id", ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="primary")
    required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    service: Mapped["Service"] = relationship("Service", back_populates="components")
    equipment: Mapped["Equipment"] = relationship("Equipment", back_populates="service_links")


class StatusEvent(Base):
    __tablename__ = "status_event"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    ts: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, index=True
    )
    subject_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    subject_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    old_state: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    new_state: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    actor_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
