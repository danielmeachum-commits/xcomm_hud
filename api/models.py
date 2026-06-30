"""SQLAlchemy 2.x declarative models for xcomm_hud."""

from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


SERVICE_STATUS_VALUES = ("up", "degraded", "down", "unknown", "offline", "setup")
GATEWAY_STATUS_VALUES = ("active", "ready", "degraded", "down", "offline", "setup")
STATUS_VALUES = SERVICE_STATUS_VALUES  # legacy alias
SERVICE_KINDS = ("voice", "data", "other")
SERVICE_CATEGORIES = ("critical", "sustainment", "other")
SERVICE_REACH = ("local", "external")
GATEWAY_KINDS = ("milsat", "commercial", "other")
GATEWAY_PACE = ("primary", "alternate", "contingency", "emergency")
USER_ROLES = ("viewer", "operator", "admin")
VALIDATION_SOURCES = ("manual", "ingest")
SUBJECT_KINDS = ("service", "site", "gateway", "site_fpcon", "site_emcon")
FPCON_LEVELS = ("normal", "alpha", "bravo", "charlie", "delta")
EMCON_LEVELS = ("a", "b", "c", "d")


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
    fpcon: Mapped[str] = mapped_column(String(16), nullable=False, default="normal")
    emcon: Mapped[str] = mapped_column(String(8), nullable=False, default="a")
    show_fpcon: Mapped[bool] = mapped_column(default=True, nullable=False)
    show_emcon: Mapped[bool] = mapped_column(default=True, nullable=False)
    lat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    lon: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    services: Mapped[list["Service"]] = relationship("Service", back_populates="site")
    gateways: Mapped[list["Gateway"]] = relationship(
        "Gateway", back_populates="site", cascade="all, delete-orphan"
    )
    canvas_position: Mapped[Optional["SiteCanvasPosition"]] = relationship(
        "SiteCanvasPosition",
        back_populates="site",
        uselist=False,
        cascade="all, delete-orphan",
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


class ServiceTemplate(Base):
    __tablename__ = "service_template"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    category: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    reach: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    icon: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # null = all 6 status values allowed; otherwise restricts the picker.
    allowed_statuses: Mapped[Optional[list[str]]] = mapped_column(JSONB, nullable=True)


class Service(Base):
    __tablename__ = "service"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False
    )
    service_template_id: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        ForeignKey("service_template.id", ondelete="SET NULL"),
        nullable=True,
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    category: Mapped[str] = mapped_column(String(24), nullable=False, default="other")
    reach: Mapped[str] = mapped_column(String(16), nullable=False, default="local")
    icon: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Which PACE tiers this service uses. Defaults to all four (full fan-out =
    # previous behavior). Operators clear PACE letters a service can't use.
    enabled_pace: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: ["primary", "alternate", "contingency", "emergency"],
    )
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    site: Mapped["Site"] = relationship("Site", back_populates="services")


class Gateway(Base):
    __tablename__ = "gateway"
    __table_args__ = (
        UniqueConstraint("site_id", "name", name="uq_gateway_site_name"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="other")
    provider: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    pace: Mapped[str] = mapped_column(String(16), nullable=False, default="primary")
    validated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    site: Mapped["Site"] = relationship("Site", back_populates="gateways")


class SiteCanvasPosition(Base):
    __tablename__ = "site_canvas_position"

    site_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("site.id", ondelete="CASCADE"), primary_key=True
    )
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    site: Mapped["Site"] = relationship("Site", back_populates="canvas_position")


class CanvasAnnotation(Base):
    __tablename__ = "canvas_annotation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )


class Validation(Base):
    """Append-only audit of every status change.

    One row per validation event: who said *this* subject is in *this* state at
    *this* time, with optional notes. Drives the reporting feed and history view.
    """

    __tablename__ = "validation"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    validated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, index=True
    )
    subject_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    subject_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    prev_status: Mapped[Optional[str]] = mapped_column(String(16), nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    source: Mapped[str] = mapped_column(String(16), nullable=False, default="manual")
    validated_by_user_id: Mapped[Optional[int]] = mapped_column(
        BigInteger, ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
