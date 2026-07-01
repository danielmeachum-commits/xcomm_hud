"""Manual site status column with site-oriented values.

Site status becomes a manually-set posture describing the site itself, not a
rollup of its services. Values differ from service statuses on purpose:
operational / limited / degraded / maintenance / standby / offline / setup.

Revision ID: 0011_site_manual_status
Revises: 0010_event_type_general
Create Date: 2026-07-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0011_site_manual_status"
down_revision = "0010_event_type_general"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "site",
        sa.Column(
            "status", sa.String(16), nullable=False, server_default="operational"
        ),
    )


def downgrade() -> None:
    op.drop_column("site", "status")
