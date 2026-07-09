"""Document file versioning: immutable per-upload history rows.

Adds `document_version` — one immutable row per uploaded file, sequential
`version_no` per document — and `document.current_version_id`, which says
which version the document's denormalized file columns mirror (not
necessarily the newest; Restore repoints it). Existing documents are
backfilled as version 1 of themselves.

Revision ID: 0035_document_versions
Revises: 0034_documents
Create Date: 2026-07-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0035_document_versions"
down_revision = "0034_documents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_version",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.BigInteger(), nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("filename", sa.String(512), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(1024), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.BigInteger(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(
            ["document_id"],
            ["document.id"],
            ondelete="CASCADE",
            name="fk_document_version_document",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["user.id"],
            ondelete="SET NULL",
            name="fk_document_version_created_by",
        ),
        sa.UniqueConstraint("storage_key", name="uq_document_version_storage_key"),
        sa.UniqueConstraint("document_id", "version_no", name="uq_document_version_no"),
    )
    op.create_index(
        "ix_document_version_document_id", "document_version", ["document_id"]
    )

    op.add_column(
        "document",
        sa.Column("current_version_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_document_current_version",
        "document",
        "document_version",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Backfill: every existing document becomes version 1 of itself.
    op.execute(
        """
        INSERT INTO document_version
            (document_id, version_no, filename, content_type, size_bytes,
             storage_key, note, created_by, created_at)
        SELECT id, 1, filename, content_type, size_bytes,
               storage_key, NULL, created_by, created_at
        FROM document
        """
    )
    op.execute(
        """
        UPDATE document d
        SET current_version_id = dv.id
        FROM document_version dv
        WHERE dv.document_id = d.id AND dv.version_no = 1
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_document_current_version", "document", type_="foreignkey")
    op.drop_column("document", "current_version_id")
    op.drop_index("ix_document_version_document_id", table_name="document_version")
    op.drop_table("document_version")
