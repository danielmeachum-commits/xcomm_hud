"""Document library: folders + document metadata.

Folders form a workspace-scoped tree (site_id NULL = workspace library,
non-NULL = one site's tab); documents store file metadata while the bytes
live in S3-compatible object storage under `storage_key`. Deleting a
folder cascades to subfolders but leaves documents in place
(folder_id SET NULL) so files aren't silently lost with their container.

Revision ID: 0034_documents
Revises: 0033_system_event_types
Create Date: 2026-07-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034_documents"
down_revision = "0033_system_event_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "folder",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("site_id", sa.BigInteger(), nullable=True),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            ondelete="CASCADE",
            name="fk_folder_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["site_id"],
            ["site.id"],
            ondelete="CASCADE",
            name="fk_folder_site",
        ),
        sa.ForeignKeyConstraint(
            ["parent_id"],
            ["folder.id"],
            ondelete="CASCADE",
            name="fk_folder_parent",
        ),
        sa.UniqueConstraint(
            "workspace_id", "site_id", "parent_id", "name", name="uq_folder_scope_name"
        ),
    )
    op.create_index("ix_folder_workspace_id", "folder", ["workspace_id"])
    op.create_index("ix_folder_site_id", "folder", ["site_id"])

    op.create_table(
        "document",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("site_id", sa.BigInteger(), nullable=True),
        sa.Column("folder_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.String(128), nullable=True),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(1024), nullable=False),
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
            name="fk_document_workspace",
        ),
        sa.ForeignKeyConstraint(
            ["site_id"],
            ["site.id"],
            ondelete="CASCADE",
            name="fk_document_site",
        ),
        sa.ForeignKeyConstraint(
            ["folder_id"],
            ["folder.id"],
            ondelete="SET NULL",
            name="fk_document_folder",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["user.id"],
            ondelete="SET NULL",
            name="fk_document_created_by",
        ),
        sa.UniqueConstraint("storage_key", name="uq_document_storage_key"),
    )
    op.create_index("ix_document_workspace_id", "document", ["workspace_id"])
    op.create_index("ix_document_site_id", "document", ["site_id"])


def downgrade() -> None:
    op.drop_index("ix_document_site_id", table_name="document")
    op.drop_index("ix_document_workspace_id", table_name="document")
    op.drop_table("document")
    op.drop_index("ix_folder_site_id", table_name="folder")
    op.drop_index("ix_folder_workspace_id", table_name="folder")
    op.drop_table("folder")
