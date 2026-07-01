"""Introduce workspaces to hold one operating picture per exercise / mission.

Creates the `workspace` table, seeds a "Garrison" default workspace, moves all
existing sites and canvas annotations into it, and gives users a per-user
`current_workspace_id` so their selection persists across sessions. Also
relaxes `site.name` from globally unique to unique-per-workspace so a "Garrison
HQ" in one workspace can coexist with an identically named simulated site in
another.

Revision ID: 0012_workspaces
Revises: 0011_site_manual_status
Create Date: 2026-07-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB


revision = "0012_workspaces"
down_revision = "0011_site_manual_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace",
        sa.Column(
            "id",
            sa.BigInteger(),
            sa.Identity(always=False),
            primary_key=True,
        ),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "tags",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "is_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
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
    )

    # Seed the Garrison workspace and remember its id for backfill.
    conn = op.get_bind()
    default_id = conn.execute(
        sa.text(
            """
            INSERT INTO workspace (name, description, tags, is_default)
            VALUES ('Garrison', 'Default baseline workspace', '["garrison"]'::jsonb, true)
            RETURNING id
            """
        )
    ).scalar_one()

    # --- site.workspace_id ---
    op.add_column(
        "site",
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
    )
    conn.execute(
        sa.text("UPDATE site SET workspace_id = :wid").bindparams(wid=default_id)
    )
    op.alter_column("site", "workspace_id", nullable=False)
    op.create_foreign_key(
        "fk_site_workspace",
        "site",
        "workspace",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_site_workspace_id", "site", ["workspace_id"])

    # Swap the global-unique name constraint for a per-workspace one.
    op.drop_constraint("site_name_key", "site", type_="unique")
    op.create_unique_constraint(
        "uq_site_workspace_name", "site", ["workspace_id", "name"]
    )

    # --- canvas_annotation.workspace_id ---
    op.add_column(
        "canvas_annotation",
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
    )
    conn.execute(
        sa.text(
            "UPDATE canvas_annotation SET workspace_id = :wid"
        ).bindparams(wid=default_id)
    )
    op.alter_column("canvas_annotation", "workspace_id", nullable=False)
    op.create_foreign_key(
        "fk_canvas_annotation_workspace",
        "canvas_annotation",
        "workspace",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_canvas_annotation_workspace_id",
        "canvas_annotation",
        ["workspace_id"],
    )

    # --- user.current_workspace_id ---
    op.add_column(
        "user",
        sa.Column("current_workspace_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_user_current_workspace",
        "user",
        "workspace",
        ["current_workspace_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_user_current_workspace", "user", type_="foreignkey")
    op.drop_column("user", "current_workspace_id")

    op.drop_index("ix_canvas_annotation_workspace_id", table_name="canvas_annotation")
    op.drop_constraint(
        "fk_canvas_annotation_workspace",
        "canvas_annotation",
        type_="foreignkey",
    )
    op.drop_column("canvas_annotation", "workspace_id")

    op.drop_constraint("uq_site_workspace_name", "site", type_="unique")
    op.create_unique_constraint("site_name_key", "site", ["name"])
    op.drop_index("ix_site_workspace_id", table_name="site")
    op.drop_constraint("fk_site_workspace", "site", type_="foreignkey")
    op.drop_column("site", "workspace_id")

    op.drop_table("workspace")
