"""Add expected_return_at for personnel accountability timer.

Optional "expected back" timestamp on a person's current location and on each
location history event. Past this time with no new check-in = overdue.

Revision ID: 0020_personnel_expected_return
Revises: 0019_personnel
Create Date: 2026-07-04
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0020_personnel_expected_return"
down_revision = "0019_personnel"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "personnel",
        sa.Column("expected_return_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "personnel_location_event",
        sa.Column("expected_return_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("personnel_location_event", "expected_return_at")
    op.drop_column("personnel", "expected_return_at")
