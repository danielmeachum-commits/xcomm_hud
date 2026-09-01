"""Give a UTC definition a MANFOR — the people, not just the equipment.

MEFPAK registers a UTC as two halves: the LOGDET says what deploys, the MANFOR
says who deploys with it. The catalog has only ever held the LOGDET
(`utc_def_line`), so a UTC in this app was a pile of gear that arrived on site
with nobody to set it up. This adds the other half.

A row is an AUTHORIZATION, not a person: a shop, a skill level, and how many.
Who actually fills it is decided per deployment against the roster, which is
why nothing here points at `personnel` — the whole point of a template is that
it holds before anyone is named.

The shop is stored as a NAME rather than an FK to `work_center`, and that is
forced: `work_center.workspace_id` is NOT NULL while `utc_def.workspace_id` is
nullable, so a global UTC — which is what the seeded catalog rows are — cannot
point at any one workspace's shop. `EquipmentTypeWorkCenter` solved the same
collision with a workspace-scoped join table, but the shop a position draws
from is part of the template rather than a local staffing choice, so it travels
with the row the way every cross-reference in an export bundle already does:
by name.

`skill_level` deliberately reuses the vocabulary of `personnel.skill_level`
(migration 0024): 1 Helper, 3 Apprentice, 5 Journeyman, 7 Craftsman,
9 Superintendent. Storing the requirement in the same units as the fact is what
makes "who on the roster can source this UTC?" a comparison rather than a
string parse.

Three columns and no more, deliberately. Grade, duty title, SEI and who leads
the team were all tried here and taken back out: the first two are implied by
the shop and the level closely enough not to be worth typing twice, and the
last two are facts about a DEPLOYMENT rather than the template — which of two
7-levels runs this particular site is decided when the package goes out.

One row per (shop, skill level), enforced. Positions are added by naming the
pair and are read-only afterwards, so two rows saying "Sys Ops 7-level" can
only ever be a mistake — the second one means three of them, and the count
column is how a MANFOR says three. `utc_def_line` needed the same guard in two
pieces and this borrows the shape: a UNIQUE constraint for rows that carry a
level, plus a partial index for the ones that don't, because NULLs are distinct
in a UNIQUE constraint and "Sys Ops, no level" twice really is a duplicate.

The two starter UTCs seeded in 0040 get a MANFOR here. A comms package that
lists a TACLANE and no one cleared to key it describes half a deployment, and
the seeded LOGDET is what every fresh instance reads as the worked example.

Revision ID: 0063_utc_def_manfor
Revises: 0062_equip_category_work_center
Create Date: 2026-09-01
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0063_utc_def_manfor"
down_revision = "0062_equip_category_work_center"
branch_labels = None
depends_on = None


# utc code -> [(shop, skill level, qty)]
#
# Work centers are created per workspace and seeded by no migration, so these
# names are the SHAPE a shop name takes rather than a guaranteed match. A name
# that resolves to nothing renders as the text it is, which is the price of
# letting a global template name a shop at all.
_STARTER_MANFOR = {
    "6KFCP": [
        ("Sys Ops", 7, 1),
        ("Sys Ops", 5, 2),
        ("Network Ops", 5, 1),
        ("RF", 5, 1),
    ],
    "6KFCX": [
        ("RF", 7, 1),
        ("Network Ops", 5, 1),
    ],
}


def _seed_starter_manfor() -> None:
    """Attach the starter MANFOR to the global UTCs seeded in 0040.

    Scoped to `workspace_id IS NULL` and skipped when the code is absent, so an
    instance that never ran 0040's seed (or has since retired those rows)
    upgrades cleanly instead of erroring on a missing id.
    """
    conn = op.get_bind()
    for code, positions in _STARTER_MANFOR.items():
        utc_id = conn.execute(
            sa.text(
                "SELECT id FROM utc_def "
                "WHERE workspace_id IS NULL AND code = :code"
            ),
            {"code": code},
        ).scalar_one_or_none()
        if utc_id is None:
            continue
        for order, (work_center, skill_level, quantity) in enumerate(positions):
            conn.execute(
                sa.text(
                    """
                    INSERT INTO utc_def_manfor_line
                        (utc_def_id, work_center, skill_level, quantity,
                         display_order)
                    VALUES
                        (:utc_id, :work_center, :skill_level, :quantity, :order)
                    """
                ),
                {
                    "utc_id": utc_id,
                    "work_center": work_center,
                    "skill_level": skill_level,
                    "quantity": quantity,
                    "order": order,
                },
            )


def upgrade() -> None:
    op.create_table(
        "utc_def_manfor_line",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("utc_def_id", sa.BigInteger(), nullable=False),
        sa.Column("work_center", sa.String(length=128), nullable=False),
        sa.Column("skill_level", sa.SmallInteger(), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(["utc_def_id"], ["utc_def.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "utc_def_id",
            "work_center",
            "skill_level",
            name="uq_utc_def_manfor_shop_level",
        ),
    )
    op.create_index(
        "ix_utc_def_manfor_line_utc_def_id",
        "utc_def_manfor_line",
        ["utc_def_id"],
    )
    # NULLs are distinct in a UNIQUE constraint, so the level-less slice needs
    # its own guard. Same two-part shape as `utc_def_line`'s enclave uniqueness.
    op.create_index(
        "uq_utc_def_manfor_shop_no_level",
        "utc_def_manfor_line",
        ["utc_def_id", "work_center"],
        unique=True,
        postgresql_where=sa.text("skill_level IS NULL"),
    )
    _seed_starter_manfor()


def downgrade() -> None:
    op.drop_index(
        "uq_utc_def_manfor_shop_no_level", table_name="utc_def_manfor_line"
    )
    op.drop_index(
        "ix_utc_def_manfor_line_utc_def_id", table_name="utc_def_manfor_line"
    )
    op.drop_table("utc_def_manfor_line")
