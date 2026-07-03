"""Per-(service, gateway) status link table backing the matrix view.

Each row is one (service × gateway) intersection: the operator's last
validated answer to "does this service work through this gateway right
now?". Cells are materialized lazily by the API on first read/write and
seeded with `unknown`. See api/effective.py for the cascade rules that
govern how gateway and local-service status changes propagate here.

Revision ID: 0014_service_gateway_status
Revises: 0013_workspace_slug
Create Date: 2026-07-02
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0014_service_gateway_status"
down_revision = "0013_workspace_slug"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "service_gateway_status",
        sa.Column("service_id", sa.BigInteger(), nullable=False),
        sa.Column("gateway_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.String(16),
            nullable=False,
            server_default="unknown",
        ),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("validated_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["service_id"],
            ["service.id"],
            ondelete="CASCADE",
            name="fk_service_gateway_status_service",
        ),
        sa.ForeignKeyConstraint(
            ["gateway_id"],
            ["gateway.id"],
            ondelete="CASCADE",
            name="fk_service_gateway_status_gateway",
        ),
        sa.ForeignKeyConstraint(
            ["validated_by_user_id"],
            ["user.id"],
            ondelete="SET NULL",
            name="fk_service_gateway_status_user",
        ),
        sa.PrimaryKeyConstraint(
            "service_id", "gateway_id", name="pk_service_gateway_status"
        ),
    )
    # Composite PK indexes on (service_id, gateway_id) so lookup by service
    # is free; add a separate gateway_id index so cascade queries triggered
    # by a gateway status change ("find every cell for this gateway") don't
    # need a full scan.
    op.create_index(
        "ix_service_gateway_status_gateway_id",
        "service_gateway_status",
        ["gateway_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_service_gateway_status_gateway_id",
        table_name="service_gateway_status",
    )
    op.drop_table("service_gateway_status")
