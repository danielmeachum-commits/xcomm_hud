"""Kiosk guest requests: a visitor without a CAC asks the desk to sign them in.

A guest request is a pending-scan row with no card (`edipi_hash` NULL —
Postgres treats NULLs as distinct, so the per-card unique constraint still
holds) plus who they are and who they're visiting.

Revision ID: 0073_kiosk_guest_requests
Revises: 0072_hash_dod_ids
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0073_kiosk_guest_requests"
down_revision = "0072_hash_dod_ids"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("kiosk_pending_scan", "edipi_hash", nullable=True)
    op.add_column(
        "kiosk_pending_scan", sa.Column("affiliation", sa.String(128), nullable=True)
    )
    op.add_column(
        "kiosk_pending_scan", sa.Column("escort", sa.String(128), nullable=True)
    )


def downgrade() -> None:
    op.execute("DELETE FROM kiosk_pending_scan WHERE edipi_hash IS NULL")
    op.drop_column("kiosk_pending_scan", "escort")
    op.drop_column("kiosk_pending_scan", "affiliation")
    op.alter_column("kiosk_pending_scan", "edipi_hash", nullable=False)
