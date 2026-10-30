"""Move who a person is onto a global roster; keep their part in each picture.

The property-book split (0059), applied to people. `person` holds identity —
name, rank, unit, contact details, supervisor, command — once for the unit.
`personnel` stays as a workspace's entry for that person: where they're
assigned, where they are now, their shop and teams in this picture, guest
details, notes. Its ids and every inbound foreign key (location history, team
membership and leads, site properties, events) are untouched.

`person.workspace_id` takes the enclave shape: NULL is the shared roster, a
workspace id is a person local to that picture. Guests are the local ones —
a visitor escorted through one exercise is not on the unit's books.

Identity is the row id. The backfill makes one person per personnel row and
reuses its id, rather than guessing that two rows in different workspaces with
the same name are the same person; linking someone into another picture is
done deliberately, by id. Since every existing row becomes its own person, two
pictures that each had a commander for the same unit now have two people
claiming one command — the lowest id keeps it.

The shop stays per picture (`personnel.work_center_id`): shops can be local to
a workspace, and a global row can't point at something only one picture sees.

Revision ID: 0067_global_roster
Revises: 0066_global_work_centers_units
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0067_global_roster"
down_revision = "0066_global_work_centers_units"
branch_labels = None
depends_on = None


# Columns that move from personnel to person, copied by name both ways.
# supervisor_id moves too but needs translating, so it's handled separately.
_IDENTITY = [
    "personnel_type",
    "branch",
    "rank",
    "skill_level",
    "last_name",
    "first_name",
    "cellphone",
    "dsn",
    "sipr_number",
    "email",
    "unit_id",
    "is_commander",
]


def upgrade() -> None:
    conn = op.get_bind()

    op.create_table(
        "person",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column(
            "workspace_id",
            sa.BigInteger,
            sa.ForeignKey("workspace.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "personnel_type",
            sa.String(16),
            nullable=False,
            server_default="military",
        ),
        sa.Column("branch", sa.String(24), nullable=True),
        sa.Column("rank", sa.String(32), nullable=True),
        sa.Column("skill_level", sa.SmallInteger, nullable=True),
        sa.Column("last_name", sa.String(64), nullable=False),
        sa.Column("first_name", sa.String(64), nullable=False),
        sa.Column("cellphone", sa.String(32), nullable=True),
        sa.Column("dsn", sa.String(32), nullable=True),
        sa.Column("sipr_number", sa.String(32), nullable=True),
        sa.Column("email", sa.String(128), nullable=True),
        sa.Column(
            "unit_id",
            sa.BigInteger,
            sa.ForeignKey("unit.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "supervisor_id",
            sa.BigInteger,
            sa.ForeignKey("person.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "is_commander",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index("ix_person_workspace_id", "person", ["workspace_id"])
    op.create_index("ix_person_unit_id", "person", ["unit_id"])
    op.create_index("ix_person_supervisor_id", "person", ["supervisor_id"])

    # --- backfill: one person per personnel row, same id ---
    cols = ", ".join(_IDENTITY)
    conn.execute(
        sa.text(
            f"INSERT INTO person (id, workspace_id, {cols}, "
            "created_at, updated_at) "
            f"SELECT id, CASE WHEN is_guest THEN workspace_id END, {cols}, "
            "created_at, updated_at FROM personnel"
        )
    )
    # Ids line up, so a supervisor pointer carries over as-is.
    conn.execute(
        sa.text(
            "UPDATE person SET supervisor_id = p.supervisor_id "
            "FROM personnel p WHERE p.id = person.id"
        )
    )
    conn.execute(
        sa.text(
            "SELECT setval(pg_get_serial_sequence('person', 'id'), "
            "COALESCE((SELECT max(id) FROM person), 0) + 1, false)"
        )
    )
    # One commander per unit across the roster: the lowest id keeps it.
    conn.execute(
        sa.text(
            "UPDATE person SET is_commander = false "
            "WHERE is_commander AND unit_id IS NOT NULL AND id <> ("
            "  SELECT min(c.id) FROM person c "
            "  WHERE c.is_commander AND c.unit_id = person.unit_id)"
        )
    )
    op.create_index(
        "uq_person_unit_commander",
        "person",
        ["unit_id"],
        unique=True,
        postgresql_where=sa.text("is_commander AND unit_id IS NOT NULL"),
    )

    # --- personnel: point at the person, drop what moved ---
    op.add_column(
        "personnel",
        sa.Column(
            "person_id",
            sa.BigInteger,
            sa.ForeignKey("person.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    conn.execute(sa.text("UPDATE personnel SET person_id = id"))
    op.alter_column("personnel", "person_id", nullable=False)
    op.create_index("ix_personnel_person_id", "personnel", ["person_id"])
    op.create_unique_constraint(
        "uq_personnel_workspace_person", "personnel", ["workspace_id", "person_id"]
    )

    op.drop_index("uq_personnel_unit_commander", table_name="personnel")
    op.drop_index("ix_personnel_unit_id", table_name="personnel")
    op.drop_index("ix_personnel_supervisor_id", table_name="personnel")
    for col in _IDENTITY + ["supervisor_id"]:
        op.drop_column("personnel", col)


def downgrade() -> None:
    conn = op.get_bind()

    # Re-add nullable, copy back, then tighten — every picture a person is in
    # gets its own copy of who they are, as before 0067.
    op.add_column(
        "personnel",
        sa.Column(
            "personnel_type",
            sa.String(16),
            nullable=True,
            server_default="military",
        ),
    )
    op.add_column("personnel", sa.Column("branch", sa.String(24), nullable=True))
    op.add_column("personnel", sa.Column("rank", sa.String(32), nullable=True))
    op.add_column(
        "personnel", sa.Column("skill_level", sa.SmallInteger, nullable=True)
    )
    op.add_column("personnel", sa.Column("last_name", sa.String(64), nullable=True))
    op.add_column(
        "personnel", sa.Column("first_name", sa.String(64), nullable=True)
    )
    op.add_column("personnel", sa.Column("cellphone", sa.String(32), nullable=True))
    op.add_column("personnel", sa.Column("dsn", sa.String(32), nullable=True))
    op.add_column(
        "personnel", sa.Column("sipr_number", sa.String(32), nullable=True)
    )
    op.add_column("personnel", sa.Column("email", sa.String(128), nullable=True))
    op.add_column(
        "personnel",
        sa.Column(
            "unit_id",
            sa.BigInteger,
            sa.ForeignKey("unit.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "personnel",
        sa.Column(
            "supervisor_id",
            sa.BigInteger,
            sa.ForeignKey("personnel.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.add_column(
        "personnel",
        sa.Column(
            "is_commander",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
    )

    sets = ", ".join(f"{c} = pr.{c}" for c in _IDENTITY)
    conn.execute(
        sa.text(
            f"UPDATE personnel SET {sets} FROM person pr "
            "WHERE pr.id = personnel.person_id"
        )
    )
    # A supervisor survives only where they're in the same picture.
    conn.execute(
        sa.text(
            "UPDATE personnel SET supervisor_id = sup.id "
            "FROM person pr, personnel sup "
            "WHERE pr.id = personnel.person_id "
            "  AND sup.person_id = pr.supervisor_id "
            "  AND sup.workspace_id = personnel.workspace_id"
        )
    )
    op.alter_column("personnel", "personnel_type", nullable=False)
    op.alter_column("personnel", "last_name", nullable=False)
    op.alter_column("personnel", "first_name", nullable=False)
    op.create_index("ix_personnel_unit_id", "personnel", ["unit_id"])
    op.create_index("ix_personnel_supervisor_id", "personnel", ["supervisor_id"])
    # Per workspace, as 0066 left it: a person is unique per unit globally and
    # once per picture, so the copies can't collide.
    op.create_index(
        "uq_personnel_unit_commander",
        "personnel",
        ["workspace_id", "unit_id"],
        unique=True,
        postgresql_where=sa.text("is_commander AND unit_id IS NOT NULL"),
    )

    op.drop_constraint(
        "uq_personnel_workspace_person", "personnel", type_="unique"
    )
    op.drop_index("ix_personnel_person_id", table_name="personnel")
    op.drop_column("personnel", "person_id")
    op.drop_table("person")
