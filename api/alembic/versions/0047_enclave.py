"""Add the enclave table and seed the named networks.

Enclaves (NIPR, SIPR, ACBN, BICES) were a naming convention — "NIPR Web" vs
"SIPR Web", an icon choice, hand-written capability labels. That held until
behavior needed to hang off it, which per 0044 is the signal a tag deserves a
real column.

Global rows (workspace_id IS NULL) following the equipment catalog pattern, so
a workspace can add its own without editing the shared list. Nesting is
`parent_id` only, flat over the wire, tree assembled in the UI — same as
folder and doc_page.

Not a classification level: no ordering, no severity, no link to the
classification banner tints. See the model docstring.

Revision ID: 0047_enclave
Revises: 0046_rename_scoi_source
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0047_enclave"
down_revision = "0046_rename_scoi_source"
branch_labels = None
depends_on = None


# (name, short_name, color, display_order, parent name or None)
# Transport carries no color on purpose — operators describe it as the
# colorless layer everything else rides on.
_SEED = [
    ("Transport", "TRANS", None, 0, None),
    ("NIPR", "NIPR", "#3f7f3f", 10, "Transport"),
    ("SIPR", "SIPR", "#b03030", 20, "Transport"),
    ("ACBN", "ACBN", "#2f6fb0", 30, "SIPR"),
    ("BICES", "BICES", "#8b5a2b", 40, "SIPR"),
    ("Coalition", "COAL", "#7a4fb0", 50, "Transport"),
]


def upgrade() -> None:
    op.create_table(
        "enclave",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("parent_id", sa.BigInteger(), nullable=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column("short_name", sa.String(24), nullable=True),
        sa.Column("color", sa.String(16), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], ondelete="CASCADE"),
        # SET NULL, not CASCADE: retiring a parent orphans children to the top
        # level rather than deleting rows that tagged gear points at.
        sa.ForeignKeyConstraint(["parent_id"], ["enclave.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("workspace_id", "name", name="uq_enclave_workspace_name"),
        sa.CheckConstraint("parent_id <> id", name="ck_enclave_parent_not_self"),
    )
    op.create_index("ix_enclave_workspace_id", "enclave", ["workspace_id"])
    # Postgres treats NULLs as distinct in a UNIQUE constraint, so the composite
    # above does not constrain the global slice. This partial index does.
    op.create_index(
        "uq_enclave_global_name",
        "enclave",
        ["name"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    enclave = sa.table(
        "enclave",
        sa.column("id", sa.BigInteger),
        sa.column("workspace_id", sa.BigInteger),
        sa.column("parent_id", sa.BigInteger),
        sa.column("name", sa.String),
        sa.column("short_name", sa.String),
        sa.column("color", sa.String),
        sa.column("display_order", sa.Integer),
    )
    conn = op.get_bind()
    # Two passes: insert every row, then wire parents by name. Avoids depending
    # on generated ids and keeps the seed readable as a hierarchy.
    conn.execute(
        enclave.insert(),
        [
            {
                "workspace_id": None,
                "parent_id": None,
                "name": name,
                "short_name": short,
                "color": color,
                "display_order": order,
            }
            for name, short, color, order, _parent in _SEED
        ],
    )
    for name, _short, _color, _order, parent in _SEED:
        if parent is None:
            continue
        conn.execute(
            sa.text(
                """
                UPDATE enclave SET parent_id = (
                    SELECT id FROM enclave
                     WHERE name = :parent AND workspace_id IS NULL
                )
                WHERE name = :name AND workspace_id IS NULL
                """
            ),
            {"parent": parent, "name": name},
        )


def downgrade() -> None:
    op.drop_index("uq_enclave_global_name", table_name="enclave")
    op.drop_index("ix_enclave_workspace_id", table_name="enclave")
    op.drop_table("enclave")
