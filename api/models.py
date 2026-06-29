"""SQLAlchemy 2.x declarative models for xcomm_hud.

The hub model is intentionally lean: Site + Service are the only domain
objects leadership sees. Equipment-level detail lives in scoi.
"""

from __future__ import annotations

import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    String,
    Text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


STATUS_VALUES = ("up", "degraded", "down", "unknown")
SERVICE_KINDS = ("voip", "data", "video", "crypto", "other")
SERVICE_HOSTING = ("self", "cloud", "hybrid")
USER_ROLES = ("viewer", "operator", "admin")
STATUS_EVENT_SOURCES = ("manual", "ingest")
SUBJECT_KINDS = ("service", "site")


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

    services: Mapped[list["Service"]] = relationship(
        "Service", back_populates="site"
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
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now
    )
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_now, onupdate=_now
    )

    site: Mapped[Optional["Site"]] = relationship("Site", back_populates="services")


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
