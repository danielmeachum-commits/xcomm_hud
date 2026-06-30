"""Gateway status rename (up → active, drop unknown, add ready) + service.enabled_pace.

Gateways now run a PACE-aware status set: active (live and serving), ready
(standby), degraded, down, offline, setup. Services gain `enabled_pace` so an
external service can opt in/out of specific PACE tiers — full fan-out preserves
prior behavior.

Revision ID: 0008_gateway_active_ready
Revises: 0007_simplify_taxonomy
Create Date: 2026-06-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0008_gateway_active_ready"
down_revision = "0007_simplify_taxonomy"
branch_labels = None
depends_on = None


_ALL_PACE = '\'["primary", "alternate", "contingency", "emergency"]\'::jsonb'


def upgrade() -> None:
    op.execute("UPDATE gateway SET status = 'active' WHERE status IN ('up', 'unknown')")
    op.add_column(
        "service",
        sa.Column(
            "enabled_pace",
            JSONB,
            nullable=False,
            server_default=sa.text(_ALL_PACE),
        ),
    )


def downgrade() -> None:
    op.drop_column("service", "enabled_pace")
    op.execute("UPDATE gateway SET status = 'unknown' WHERE status = 'ready'")
    op.execute("UPDATE gateway SET status = 'up' WHERE status = 'active'")
