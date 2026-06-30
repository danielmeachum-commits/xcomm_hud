"""Add service categories/reach/icon, gateways, canvas positions + annotations.

Revision ID: 0002_categories_gateways_canvas
Revises: 0001_baseline
Create Date: 2026-06-29
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0002_categories_gateways_canvas"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Extend service with category, reach, icon
    with op.batch_alter_table("service") as b:
        b.add_column(
            sa.Column("category", sa.String(24), nullable=False, server_default="other")
        )
        b.add_column(
            sa.Column("reach", sa.String(16), nullable=False, server_default="local")
        )
        b.add_column(sa.Column("icon", sa.String(64), nullable=True))

    # Seeded catalog of standardized services
    op.create_table(
        "service_template",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="other"),
        sa.Column("category", sa.String(24), nullable=False, server_default="other"),
        sa.Column("reach", sa.String(16), nullable=False, server_default="local"),
        sa.Column("default_hosting", sa.String(16), nullable=False, server_default="self"),
        sa.Column("icon", sa.String(64), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )

    op.execute(
        """
        INSERT INTO service_template (name, kind, category, reach, default_hosting, icon) VALUES
            ('NIPR Web',   'data', 'core_critical_local', 'external', 'hybrid', 'globe'),
            ('SIPR Web',   'data', 'core_critical_local', 'external', 'hybrid', 'shield'),
            ('VoIP',       'voip', 'core_critical_local', 'both',     'hybrid', 'phone'),
            ('VoIP Chat',  'data', 'core_critical_local', 'both',     'hybrid', 'message-square'),
            ('VoSIP',      'voip', 'core_critical_local', 'both',     'hybrid', 'phone-call'),
            ('VoSIP Chat', 'data', 'core_critical_local', 'both',     'hybrid', 'lock')
        """
    )

    # Gateways — per-site uplinks
    op.create_table(
        "gateway",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("site_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False, server_default="other"),
        sa.Column("provider", sa.String(128), nullable=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="unknown"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["site_id"], ["site.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("site_id", "name", name="uq_gateway_site_name"),
    )

    # Site positions on the top-level map
    op.create_table(
        "site_canvas_position",
        sa.Column("site_id", sa.BigInteger(), nullable=False),
        sa.Column("x", sa.Float(), nullable=False, server_default="0"),
        sa.Column("y", sa.Float(), nullable=False, server_default="0"),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["site_id"], ["site.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id"),
    )

    # Free-form annotations on the map
    op.create_table(
        "canvas_annotation",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("x", sa.Float(), nullable=False, server_default="0"),
        sa.Column("y", sa.Float(), nullable=False, server_default="0"),
        sa.Column("classification", sa.String(8), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("canvas_annotation")
    op.drop_table("site_canvas_position")
    op.drop_table("gateway")
    op.drop_table("service_template")
    with op.batch_alter_table("service") as b:
        b.drop_column("icon")
        b.drop_column("reach")
        b.drop_column("category")
