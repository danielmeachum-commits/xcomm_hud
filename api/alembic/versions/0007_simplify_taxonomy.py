"""Simplify category + kind taxonomy.

- service.category: core_critical_local → critical
- service.kind: voip → voice; video/crypto → other
- gateway.kind: isp/modem → commercial; satellite → milsat

Revision ID: 0007_simplify_taxonomy
Revises: 0006_gateway_pace
Create Date: 2026-06-30
"""

from __future__ import annotations

from alembic import op

revision = "0007_simplify_taxonomy"
down_revision = "0006_gateway_pace"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE service SET category = 'critical' WHERE category = 'core_critical_local'"
    )
    op.execute(
        "UPDATE service_template SET category = 'critical' WHERE category = 'core_critical_local'"
    )
    op.execute("UPDATE service SET kind = 'voice' WHERE kind = 'voip'")
    op.execute("UPDATE service_template SET kind = 'voice' WHERE kind = 'voip'")
    op.execute("UPDATE service SET kind = 'other' WHERE kind IN ('video', 'crypto')")
    op.execute(
        "UPDATE service_template SET kind = 'other' WHERE kind IN ('video', 'crypto')"
    )
    op.execute(
        "UPDATE gateway SET kind = 'commercial' WHERE kind IN ('isp', 'modem')"
    )
    op.execute("UPDATE gateway SET kind = 'milsat' WHERE kind = 'satellite'")


def downgrade() -> None:
    op.execute("UPDATE gateway SET kind = 'satellite' WHERE kind = 'milsat'")
    op.execute("UPDATE gateway SET kind = 'isp' WHERE kind = 'commercial'")
    op.execute("UPDATE service SET kind = 'voip' WHERE kind = 'voice'")
    op.execute("UPDATE service_template SET kind = 'voip' WHERE kind = 'voice'")
    op.execute(
        "UPDATE service SET category = 'core_critical_local' WHERE category = 'critical'"
    )
    op.execute(
        "UPDATE service_template SET category = 'core_critical_local' WHERE category = 'critical'"
    )
