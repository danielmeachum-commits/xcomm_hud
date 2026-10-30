"""Make work centers global-or-workspace, and units global.

A workspace is an operating picture, not a tenant — the property book (0059)
already moved on that reasoning. The shops a unit is organized into and the
unit itself are facts about the organization, not about one exercise, and
keeping them per-workspace left every global template unable to name them:
`equipment_type_work_center` needed a workspace-scoped join to say who owns a
TACLANE, and a MANFOR line names its shop by string because there was no row
a global UTC could point at.

Work centers take the enclave shape: `workspace_id IS NULL` is a shared,
admin-managed row, a non-null one is a local addition (the non-players a
particular picture accounts for). A standard set is seeded. Units go fully
global — there is no local squadron.

Rows that already exist are folded into the new shape rather than dropped:

* A workspace work center named like a seeded one is merged into the global
  row, with everything that pointed at it repointed.
* Units with the same name across workspaces collapse onto the oldest, and at
  most one keeps `is_default`.

The roster stays per-workspace for now, which breaks one invariant: a unit has
one commander, but the same commander exists once per workspace. The
commander index gains `workspace_id` until personnel moves too.

Revision ID: 0066_global_work_centers_units
Revises: 0065_drop_force_elements
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0066_global_work_centers_units"
down_revision = "0065_drop_force_elements"
branch_labels = None
depends_on = None


# name, description. AFSC is left for the unit to fill in — a shop can draw on
# more than one specialty, and a guessed code is worse than a blank one.
_SEED_WORK_CENTERS = [
    ("CFP", "Communications Focal Point"),
    ("Net Ops", "Network Operations"),
    ("Sys Ops", "Systems Operations"),
    ("RF", "Radio frequency transmissions"),
    ("CSS", "Commander Support Staff"),
    ("Leadership", None),
]

# 0063's starter MANFOR said "Network Ops"; the shop is called Net Ops.
_MANFOR_RENAMES = [("Network Ops", "Net Ops")]


def _merge_work_centers(conn) -> None:
    """Fold each workspace row named like a global one into the global row."""
    dupes = conn.execute(
        sa.text(
            """
            SELECT l.id AS local_id, g.id AS global_id
            FROM work_center l
            JOIN work_center g
              ON g.workspace_id IS NULL AND l.workspace_id IS NOT NULL
             AND lower(g.name) = lower(l.name)
            """
        )
    ).all()
    for local_id, global_id in dupes:
        params = {"local": local_id, "global": global_id}
        conn.execute(
            sa.text(
                "UPDATE personnel SET work_center_id = :global "
                "WHERE work_center_id = :local"
            ),
            params,
        )
        # Both join tables are unique on their work center within a scope, so
        # a row that would collide with one already on the global is dropped.
        conn.execute(
            sa.text(
                """
                DELETE FROM team_work_center_lead l
                WHERE l.work_center_id = :local AND EXISTS (
                    SELECT 1 FROM team_work_center_lead g
                    WHERE g.work_center_id = :global AND g.team_id = l.team_id
                )
                """
            ),
            params,
        )
        conn.execute(
            sa.text(
                "UPDATE team_work_center_lead SET work_center_id = :global "
                "WHERE work_center_id = :local"
            ),
            params,
        )
        conn.execute(
            sa.text(
                """
                DELETE FROM equipment_type_work_center l
                WHERE l.work_center_id = :local AND EXISTS (
                    SELECT 1 FROM equipment_type_work_center g
                    WHERE g.work_center_id = :global
                      AND g.workspace_id = l.workspace_id
                      AND g.equipment_type_id = l.equipment_type_id
                )
                """
            ),
            params,
        )
        conn.execute(
            sa.text(
                "UPDATE equipment_type_work_center SET work_center_id = :global "
                "WHERE work_center_id = :local"
            ),
            params,
        )
        conn.execute(
            sa.text("DELETE FROM work_center WHERE id = :local"), params
        )


def _merge_units(conn) -> None:
    """Collapse same-named units from different workspaces onto the oldest."""
    dupes = conn.execute(
        sa.text(
            """
            SELECT u.id AS dupe_id, k.keep_id
            FROM unit u
            JOIN (
                SELECT lower(name) AS lname, min(id) AS keep_id
                FROM unit GROUP BY lower(name) HAVING count(*) > 1
            ) k ON lower(u.name) = k.lname AND u.id <> k.keep_id
            """
        )
    ).all()
    for dupe_id, keep_id in dupes:
        params = {"dupe": dupe_id, "keep": keep_id}
        conn.execute(
            sa.text("UPDATE personnel SET unit_id = :keep WHERE unit_id = :dupe"),
            params,
        )
        conn.execute(
            sa.text(
                "UPDATE unit SET parent_unit_id = :keep "
                "WHERE parent_unit_id = :dupe AND id <> :keep"
            ),
            params,
        )
        conn.execute(
            sa.text(
                "UPDATE unit SET parent_unit_id = NULL "
                "WHERE id = :keep AND parent_unit_id = :dupe"
            ),
            params,
        )
        conn.execute(sa.text("DELETE FROM unit WHERE id = :dupe"), params)
    # One default left standing — the oldest.
    conn.execute(
        sa.text(
            """
            UPDATE unit SET is_default = false
            WHERE is_default AND id <> (SELECT min(id) FROM unit WHERE is_default)
            """
        )
    )


def upgrade() -> None:
    conn = op.get_bind()

    # --- work centers: global-or-workspace ---
    op.alter_column("work_center", "workspace_id", nullable=True)
    op.add_column(
        "work_center", sa.Column("afsc", sa.String(length=64), nullable=True)
    )
    # NULL never equals NULL, so (workspace_id, name) says nothing about the
    # global rows — the same partial-index answer enclaves use.
    op.create_index(
        "uq_work_center_global_name",
        "work_center",
        ["name"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )
    for name, description in _SEED_WORK_CENTERS:
        conn.execute(
            sa.text(
                """
                INSERT INTO work_center (workspace_id, name, description,
                                         created_at, updated_at)
                VALUES (NULL, :name, :description, now(), now())
                """
            ),
            {"name": name, "description": description},
        )
    _merge_work_centers(conn)

    for old, new in _MANFOR_RENAMES:
        conn.execute(
            sa.text(
                "UPDATE utc_def_manfor_line SET work_center = :new "
                "WHERE work_center = :old"
            ),
            {"old": old, "new": new},
        )

    # --- one commander per unit, per workspace, while the roster is local ---
    # Before the unit merge: two workspaces' commanders of the same squadron
    # land on one unit row there, which the old index would refuse.
    op.drop_index("uq_personnel_unit_commander", table_name="personnel")
    op.create_index(
        "uq_personnel_unit_commander",
        "personnel",
        ["workspace_id", "unit_id"],
        unique=True,
        postgresql_where=sa.text("is_commander AND unit_id IS NOT NULL"),
    )

    # --- units: global ---
    _merge_units(conn)
    op.drop_index("uq_unit_workspace_default", table_name="unit")
    op.drop_constraint("uq_unit_workspace_name", "unit", type_="unique")
    op.drop_index("ix_unit_workspace_id", table_name="unit")
    op.drop_column("unit", "workspace_id")
    op.create_unique_constraint("uq_unit_name", "unit", ["name"])
    op.create_index(
        "uq_unit_default",
        "unit",
        ["is_default"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )


def _ref_workspaces(conn, sql: str, row_id: int) -> set[int]:
    return {r[0] for r in conn.execute(sa.text(sql), {"id": row_id})}


def _split_units(conn, default_ws: int) -> None:
    """Hand each shared unit back to the workspaces whose people use it.

    The unit's own row goes to the default workspace when that is one of them
    (or nobody uses it), and every other workspace gets a copy with its people
    repointed. Without that, two workspaces' commanders of one squadron would
    land on one per-workspace row and the narrowed commander index refuses.
    """
    copies: dict[tuple[int, int], int] = {}  # (orig unit, workspace) -> copy
    for (unit_id,) in conn.execute(sa.text("SELECT id FROM unit")).all():
        wss = _ref_workspaces(
            conn,
            "SELECT DISTINCT workspace_id FROM personnel WHERE unit_id = :id",
            unit_id,
        )
        home = default_ws if not wss or default_ws in wss else min(wss)
        conn.execute(
            sa.text("UPDATE unit SET workspace_id = :ws WHERE id = :id"),
            {"ws": home, "id": unit_id},
        )
        for ws in sorted(wss - {home}):
            copy_id = conn.execute(
                sa.text(
                    """
                    INSERT INTO unit (workspace_id, name, description, branch,
                                      is_default, parent_unit_id,
                                      created_at, updated_at)
                    SELECT :ws, name, description, branch, is_default,
                           parent_unit_id, created_at, now()
                    FROM unit WHERE id = :id
                    RETURNING id
                    """
                ),
                {"ws": ws, "id": unit_id},
            ).scalar_one()
            copies[(unit_id, ws)] = copy_id
            conn.execute(
                sa.text(
                    "UPDATE personnel SET unit_id = :copy "
                    "WHERE unit_id = :id AND workspace_id = :ws"
                ),
                {"copy": copy_id, "id": unit_id, "ws": ws},
            )
    # A copy's parent should be its own workspace's copy of that parent.
    for (_, ws), copy_id in copies.items():
        parent = conn.execute(
            sa.text("SELECT parent_unit_id FROM unit WHERE id = :id"),
            {"id": copy_id},
        ).scalar_one()
        if parent is not None and (parent, ws) in copies:
            conn.execute(
                sa.text("UPDATE unit SET parent_unit_id = :p WHERE id = :id"),
                {"p": copies[(parent, ws)], "id": copy_id},
            )


# Every table that points at a work center, with the SQL expression for the
# workspace a pointing row belongs to.
_WC_REFS = [
    ("personnel", "workspace_id"),
    ("equipment_type_work_center", "workspace_id"),
    (
        "team_work_center_lead",
        "(SELECT workspace_id FROM team WHERE team.id = team_id)",
    ),
]


def _repoint_work_center(conn, old: int, new: int, ws: int) -> None:
    params = {"old": old, "new": new, "ws": ws}
    # Join rows that would collide with one already on the target go first.
    conn.execute(
        sa.text(
            """
            DELETE FROM equipment_type_work_center o
            WHERE o.work_center_id = :old AND o.workspace_id = :ws AND EXISTS (
                SELECT 1 FROM equipment_type_work_center n
                WHERE n.work_center_id = :new AND n.workspace_id = :ws
                  AND n.equipment_type_id = o.equipment_type_id
            )
            """
        ),
        params,
    )
    conn.execute(
        sa.text(
            """
            DELETE FROM team_work_center_lead o
            WHERE o.work_center_id = :old AND EXISTS (
                SELECT 1 FROM team_work_center_lead n
                WHERE n.work_center_id = :new AND n.team_id = o.team_id
            )
            """
        ),
        params,
    )
    for table, ws_expr in _WC_REFS:
        conn.execute(
            sa.text(
                f"UPDATE {table} SET work_center_id = :new "
                f"WHERE work_center_id = :old AND {ws_expr} = :ws"
            ),
            params,
        )


def _split_work_centers(conn, default_ws: int) -> None:
    """Hand each shared shop back to the workspaces that use it.

    Where a workspace already has a local shop of the same name, its rows move
    onto that one — the local shop is the one somebody made on purpose.
    """
    union = " UNION ".join(
        f"SELECT {ws_expr} FROM {table} WHERE work_center_id = :id"
        for table, ws_expr in _WC_REFS
    )
    globals_ = conn.execute(
        sa.text("SELECT id, name FROM work_center WHERE workspace_id IS NULL")
    ).all()
    for wc_id, name in globals_:
        wss = _ref_workspaces(conn, union, wc_id) or {default_ws}
        home = default_ws if default_ws in wss else min(wss)
        keep_home = True
        for ws in sorted(wss):
            local = conn.execute(
                sa.text(
                    "SELECT id FROM work_center "
                    "WHERE workspace_id = :ws AND name = :name"
                ),
                {"ws": ws, "name": name},
            ).scalar_one_or_none()
            if local is not None:
                _repoint_work_center(conn, wc_id, local, ws)
                if ws == home:
                    keep_home = False
            elif ws != home:
                copy_id = conn.execute(
                    sa.text(
                        """
                        INSERT INTO work_center (workspace_id, name, description,
                                                 created_at, updated_at)
                        SELECT :ws, name, description, created_at, now()
                        FROM work_center WHERE id = :id
                        RETURNING id
                        """
                    ),
                    {"ws": ws, "id": wc_id},
                ).scalar_one()
                _repoint_work_center(conn, wc_id, copy_id, ws)
        if keep_home:
            conn.execute(
                sa.text("UPDATE work_center SET workspace_id = :ws WHERE id = :id"),
                {"ws": home, "id": wc_id},
            )
        else:
            conn.execute(
                sa.text("DELETE FROM work_center WHERE id = :id"), {"id": wc_id}
            )


def downgrade() -> None:
    # Shared rows go back to the workspaces that use them (see the split
    # helpers). Merges made on the way up are not undone: two workspaces that
    # each had an "RF" get one copy each, but a renamed "rf" stays "RF".
    conn = op.get_bind()
    default_ws = conn.execute(
        sa.text("SELECT id FROM workspace WHERE is_default")
    ).scalar_one()

    op.drop_index("uq_unit_default", table_name="unit")
    op.drop_constraint("uq_unit_name", "unit", type_="unique")
    op.add_column("unit", sa.Column("workspace_id", sa.BigInteger(), nullable=True))
    _split_units(conn, default_ws)
    op.alter_column("unit", "workspace_id", nullable=False)
    op.create_foreign_key(
        "unit_workspace_id_fkey",
        "unit",
        "workspace",
        ["workspace_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_unit_workspace_id", "unit", ["workspace_id"])
    op.create_unique_constraint(
        "uq_unit_workspace_name", "unit", ["workspace_id", "name"]
    )
    op.create_index(
        "uq_unit_workspace_default",
        "unit",
        ["workspace_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )

    op.drop_index("uq_personnel_unit_commander", table_name="personnel")
    op.create_index(
        "uq_personnel_unit_commander",
        "personnel",
        ["unit_id"],
        unique=True,
        postgresql_where=sa.text("is_commander AND unit_id IS NOT NULL"),
    )

    for old, new in _MANFOR_RENAMES:
        conn.execute(
            sa.text(
                "UPDATE utc_def_manfor_line SET work_center = :old "
                "WHERE work_center = :new"
            ),
            {"old": old, "new": new},
        )

    op.drop_index("uq_work_center_global_name", table_name="work_center")
    op.drop_column("work_center", "afsc")
    _split_work_centers(conn, default_ws)
    op.alter_column("work_center", "workspace_id", nullable=False)
