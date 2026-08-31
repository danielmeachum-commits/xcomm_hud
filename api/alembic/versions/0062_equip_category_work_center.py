"""Give equipment types the shared asset category, and an owning work center.

Two changes, both about saying who and what a piece of gear is.

1. `equipment_type.category` was the only category equipment had, and it mixes
   two questions: what world the thing belongs to (comm, power, HVAC) and what
   kind of box it is (radio, switch, crypto). Those are different levels, and
   only the first one lines up with `utc_def.category` from 0061. So the old
   column is renamed to `subcategory` and a new `category` takes the shared
   `AssetCategory` vocabulary, which is what lets a UTC and the gear inside it
   be filtered against the same terms.

   Backfilled from the subcategory rather than defaulted flat: everything the
   app has tracked so far is communications equipment except the power tier,
   so the mapping is honest and nothing lands on `other` that shouldn't.
   `environmental` is added to the subcategory vocabulary at the same time —
   the app now tracks the HVAC that keeps the comm gear alive, and it had
   nowhere to sit.

2. `equipment_type_work_center` records which shop answers for a kind of gear.
   A join rather than a column on `equipment_type` for two reasons: there is
   usually one responsible party but sometimes more, and — decisively —
   `work_center.workspace_id` is NOT NULL while `equipment_type.workspace_id`
   is nullable for global catalog rows, so a direct FK from a global type to
   one workspace's work center cannot be expressed at all.

No CHECK constraint on either category, matching `equipment_type.category`
before it and `service.category`: the vocabularies live in schemas.py, and
adding a value should not need a migration.

Revision ID: 0062_equip_category_work_center
Revises: 0061_utc_def_category
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

# Alembic stores this in alembic_version.version_num, a VARCHAR(32) — the
# descriptive name this deserves does not fit.
revision = "0062_equip_category_work_center"
down_revision = "0061_utc_def_category"
branch_labels = None
depends_on = None


# Old value -> the world it belongs to. Everything the catalog carries today is
# comm gear apart from the power tier; `other` stays `other` rather than being
# guessed into a bucket.
_BACKFILL = {
    "radio": "comm",
    "satcom": "comm",
    "crypto": "comm",
    "network": "comm",
    "compute": "comm",
    "antenna": "comm",
    "cable": "comm",
    "power": "power",
    "other": "other",
}


def upgrade() -> None:
    op.alter_column("equipment_type", "category", new_column_name="subcategory")
    op.add_column(
        "equipment_type",
        sa.Column(
            "category",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'comm'"),
        ),
    )
    for sub, cat in _BACKFILL.items():
        op.execute(
            sa.text(
                "UPDATE equipment_type SET category = :cat WHERE subcategory = :sub"
            ).bindparams(cat=cat, sub=sub)
        )

    op.create_table(
        "equipment_type_work_center",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("work_center_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "is_primary",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["equipment_type_id"], ["equipment_type.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["work_center_id"], ["work_center.id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint(
            "workspace_id",
            "equipment_type_id",
            "work_center_id",
            name="uq_equipment_type_work_center",
        ),
    )
    op.create_index(
        "ix_equipment_type_work_center_workspace_id",
        "equipment_type_work_center",
        ["workspace_id"],
    )
    # One primary per type per workspace; any number may be non-primary.
    op.create_index(
        "uq_equipment_type_work_center_primary",
        "equipment_type_work_center",
        ["workspace_id", "equipment_type_id"],
        unique=True,
        postgresql_where=sa.text("is_primary"),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_equipment_type_work_center_primary",
        table_name="equipment_type_work_center",
    )
    op.drop_index(
        "ix_equipment_type_work_center_workspace_id",
        table_name="equipment_type_work_center",
    )
    op.drop_table("equipment_type_work_center")
    op.drop_column("equipment_type", "category")
    op.alter_column("equipment_type", "subcategory", new_column_name="category")
