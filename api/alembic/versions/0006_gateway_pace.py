"""Gateway PACE priority (primary/alternate/contingency/emergency).

Revision ID: 0006_gateway_pace
Revises: 0005_catalog_crud_display_order
Create Date: 2026-06-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_gateway_pace"
down_revision = "0005_catalog_crud_display_order"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "gateway",
        sa.Column(
            "pace",
            sa.String(16),
            nullable=False,
            server_default="primary",
        ),
    )


def downgrade() -> None:
    op.drop_column("gateway", "pace")
