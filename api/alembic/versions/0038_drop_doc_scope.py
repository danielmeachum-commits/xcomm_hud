"""Knowledge Hub goes global-only: drop workspace scope from doc pages/sections.

Removes doc_page.workspace_id and doc_section.workspace_id (and the per-scope
slug constraints), replacing them with a single global unique constraint on
slug. Every existing page/section becomes global.

Revision ID: 0038_drop_doc_scope
Revises: 0037_doc_sections
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0038_drop_doc_scope"
down_revision = "0037_doc_sections"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # doc_page
    op.drop_index("uq_doc_page_global_slug", table_name="doc_page")
    op.drop_index("ix_doc_page_workspace_id", table_name="doc_page")
    op.drop_constraint("uq_doc_page_ws_slug", "doc_page", type_="unique")
    op.drop_constraint("fk_doc_page_workspace", "doc_page", type_="foreignkey")
    op.drop_column("doc_page", "workspace_id")
    op.create_unique_constraint("uq_doc_page_slug", "doc_page", ["slug"])

    # doc_section
    op.drop_index("uq_doc_section_global_slug", table_name="doc_section")
    op.drop_index("ix_doc_section_workspace_id", table_name="doc_section")
    op.drop_constraint("uq_doc_section_ws_slug", "doc_section", type_="unique")
    op.drop_constraint("fk_doc_section_workspace", "doc_section", type_="foreignkey")
    op.drop_column("doc_section", "workspace_id")
    op.create_unique_constraint("uq_doc_section_slug", "doc_section", ["slug"])


def downgrade() -> None:
    # doc_section
    op.drop_constraint("uq_doc_section_slug", "doc_section", type_="unique")
    op.add_column(
        "doc_section", sa.Column("workspace_id", sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        "fk_doc_section_workspace",
        "doc_section",
        "workspace",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_doc_section_workspace_id", "doc_section", ["workspace_id"])
    op.create_unique_constraint(
        "uq_doc_section_ws_slug", "doc_section", ["workspace_id", "slug"]
    )
    op.create_index(
        "uq_doc_section_global_slug",
        "doc_section",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    # doc_page
    op.drop_constraint("uq_doc_page_slug", "doc_page", type_="unique")
    op.add_column(
        "doc_page", sa.Column("workspace_id", sa.BigInteger(), nullable=True)
    )
    op.create_foreign_key(
        "fk_doc_page_workspace",
        "doc_page",
        "workspace",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_doc_page_workspace_id", "doc_page", ["workspace_id"])
    op.create_unique_constraint(
        "uq_doc_page_ws_slug", "doc_page", ["workspace_id", "slug"]
    )
    op.create_index(
        "uq_doc_page_global_slug",
        "doc_page",
        ["slug"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )
