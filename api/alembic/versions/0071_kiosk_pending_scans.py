"""Kiosk pending scans: unrecognized cards waiting for an operator.

A check-in station that reads a card it can't place records it here; an
operator links it to a roster person, adds them to the roster, or signs them
in as a guest from the Personnel page. See api/routers/kiosk.py.

Revision ID: 0071_kiosk_pending_scans
Revises: 0070_cac_checkin_stations
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0071_kiosk_pending_scans"
down_revision = "0070_cac_checkin_stations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "kiosk_pending_scan",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "workspace_id",
            sa.BigInteger,
            sa.ForeignKey("workspace.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("edipi", sa.String(10), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column(
            "person_id",
            sa.BigInteger,
            sa.ForeignKey("person.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "station_id",
            sa.BigInteger,
            sa.ForeignKey("checkin_station.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "site_id",
            sa.BigInteger,
            sa.ForeignKey("site.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("first_name", sa.String(64), nullable=True),
        sa.Column("last_name", sa.String(64), nullable=True),
        sa.Column("middle_initial", sa.String(1), nullable=True),
        sa.Column("rank", sa.String(32), nullable=True),
        sa.Column("pay_grade", sa.String(8), nullable=True),
        sa.Column("branch", sa.String(24), nullable=True),
        sa.Column("is_civilian", sa.Boolean, nullable=True),
        sa.Column(
            "card_expired", sa.Boolean, nullable=False, server_default=sa.text("false")
        ),
        sa.Column(
            "scan_count", sa.Integer, nullable=False, server_default=sa.text("1")
        ),
        sa.Column("first_scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("workspace_id", "edipi", name="uq_kiosk_pending_card"),
    )
    op.create_index(
        "ix_kiosk_pending_scan_workspace_id", "kiosk_pending_scan", ["workspace_id"]
    )


def downgrade() -> None:
    op.drop_index(
        "ix_kiosk_pending_scan_workspace_id", table_name="kiosk_pending_scan"
    )
    op.drop_table("kiosk_pending_scan")
