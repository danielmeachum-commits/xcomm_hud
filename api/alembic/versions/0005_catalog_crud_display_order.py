"""Catalog CRUD, allowed_statuses, service.template FK, and display_order.

Revision ID: 0005_catalog_crud_display_order
Revises: 0004_show_toggles
Create Date: 2026-06-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005_catalog_crud_display_order"
down_revision = "0004_show_toggles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Allowed statuses on the catalog (null = all 6 allowed).
    op.add_column(
        "service_template",
        sa.Column("allowed_statuses", postgresql.JSONB(), nullable=True),
    )

    # Pre-set: cloud-side services (NIPR Web, SIPR Web) skip setup + offline
    # which only apply to local infrastructure deployments.
    op.execute(
        """
        UPDATE service_template
           SET allowed_statuses = '["up","degraded","down","unknown"]'::jsonb
         WHERE name IN ('NIPR Web', 'SIPR Web')
        """
    )

    # Track which catalog entry a service was instantiated from. Optional —
    # legacy / fully-custom services have NULL.
    op.add_column(
        "service",
        sa.Column("service_template_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_service_service_template",
        "service",
        "service_template",
        ["service_template_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Manual ordering on the per-site canvas.
    op.add_column(
        "service",
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "gateway",
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("gateway", "display_order")
    op.drop_column("service", "display_order")
    op.drop_constraint("fk_service_service_template", "service", type_="foreignkey")
    op.drop_column("service", "service_template_id")
    op.drop_column("service_template", "allowed_statuses")
