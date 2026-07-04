"""Site property templates + per-site properties.

Workspace-scoped templates define a set of typed key-value fields
(text, number, phone, email, url, date, bool, long_text). Applying a
template to a site copies its definitions into per-site rows. Sites
can also carry `custom` properties added ad-hoc.

Revision ID: 0015_site_property_templates
Revises: 0014_service_gateway_status
Create Date: 2026-07-03
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0015_site_property_templates"
down_revision = "0014_service_gateway_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_property_template",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="CASCADE",
            name="fk_site_property_template_workspace",
        ),
        sa.UniqueConstraint(
            "workspace_id", "name", name="uq_site_property_template_workspace_name"
        ),
    )
    op.create_index(
        "ix_site_property_template_workspace_id",
        "site_property_template",
        ["workspace_id"],
    )

    op.create_table(
        "site_property_definition",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("template_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("group", sa.String(64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["template_id"],
            ["site_property_template.id"],
            ondelete="CASCADE",
            name="fk_site_property_definition_template",
        ),
        sa.UniqueConstraint(
            "template_id", "key", name="uq_site_property_definition_template_key"
        ),
    )
    op.create_index(
        "ix_site_property_definition_template_id",
        "site_property_definition",
        ["template_id"],
    )

    op.create_table(
        "site_property",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("site_id", sa.BigInteger(), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("label", sa.String(128), nullable=False),
        sa.Column("type", sa.String(16), nullable=False),
        sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("group", sa.String(64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("value", JSONB(), nullable=True),
        sa.Column("source", sa.String(16), nullable=False, server_default="custom"),
        sa.ForeignKeyConstraint(
            ["site_id"],
            ["site.id"],
            ondelete="CASCADE",
            name="fk_site_property_site",
        ),
        sa.UniqueConstraint("site_id", "key", name="uq_site_property_site_key"),
    )
    op.create_index("ix_site_property_site_id", "site_property", ["site_id"])


def downgrade() -> None:
    op.drop_index("ix_site_property_site_id", table_name="site_property")
    op.drop_table("site_property")
    op.drop_index(
        "ix_site_property_definition_template_id",
        table_name="site_property_definition",
    )
    op.drop_table("site_property_definition")
    op.drop_index(
        "ix_site_property_template_workspace_id",
        table_name="site_property_template",
    )
    op.drop_table("site_property_template")
