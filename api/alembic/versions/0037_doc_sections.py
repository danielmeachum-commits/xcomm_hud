"""Doc sections: top-level grouping for Knowledge Hub pages.

Sections are global (workspace_id NULL) or workspace-scoped, shadowing by slug
like doc_page. Pages reference a section via doc_page.section_id (NULL = the
implicit "General" section).

Revision ID: 0037_doc_sections
Revises: 0036_doc_pages
Create Date: 2026-07-10
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0037_doc_sections"
down_revision = "0036_doc_pages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "doc_section",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("slug", sa.String(160), nullable=False),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("icon", sa.String(48), nullable=True),
        sa.Column(
            "display_order", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
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
            name="fk_doc_section_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["user.id"],
            ondelete="SET NULL",
            name="fk_doc_section_created_by",
        ),
        sa.UniqueConstraint(
            "workspace_id", "slug", name="uq_doc_section_ws_slug"
        ),
    )
    op.create_index("ix_doc_section_workspace_id", "doc_section", ["workspace_id"])
    op.create_index(
        "uq_doc_section_global_slug",
        "doc_section",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    op.add_column(
        "doc_page",
        sa.Column("section_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_doc_page_section",
        "doc_page",
        "doc_section",
        ["section_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_doc_page_section", "doc_page", type_="foreignkey")
    op.drop_column("doc_page", "section_id")
    op.drop_index("uq_doc_section_global_slug", table_name="doc_section")
    op.drop_index("ix_doc_section_workspace_id", table_name="doc_section")
    op.drop_table("doc_section")
