"""Rename saved kits to force elements.

Naming only — no column is added, dropped or retyped, and no row moves. The
tables held the right concept under a word the unit does not say out loud: a
grouping of UTCs realized with the specific gear that fills them is a FORCE
ELEMENT, which is what a TPFDD calls it and what the people using this app
call it. "Kit" was a placeholder that outlived its welcome.

Renamed rather than recreated so the data survives. Postgres carries indexes,
foreign keys and check constraints across an ALTER TABLE ... RENAME, so the
only thing that needs saying explicitly is the constraint and index NAMES —
those keep their old spelling through a rename and would otherwise leave
`uq_equipment_kit_*` sitting on a table called `force_element`, which is how a
schema starts lying about itself.

`equipment_kit_utc.kit_id` becomes `force_element_id`, and the `kit_utc_id` on
item and bulk becomes `force_element_utc_id`: each points at its parent row,
and a name that says which table it points at is worth the rename while
everything else is moving anyway.

The `package_def_id` column is left exactly as it is. Whether the package
template level survives is a separate decision from what this thing is called,
and folding the two together would make one of them impossible to revert on
its own.

`subject_kind` is the one place where the rename touches DATA rather than
schema. It is a stored string — `validation.subject_kind` (the table `Event` maps to),
and inside the `event_type_def.allowed_subject_kinds` array — so every event already written
against a saved kit says "equipment_kit". Renaming only the Python constant
would leave those rows pointing at a kind the app no longer declares, and
`SubjectKinds` refuses to import when its members and the Literal disagree, so
the value has to move with it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0064_force_elements"
down_revision = "0063_utc_def_manfor"
branch_labels = None
depends_on = None


# old -> new, parents before children so a rename never lands on a name that
# is still occupied.
_TABLES = [
    ("equipment_kit", "force_element"),
    ("equipment_kit_utc", "force_element_utc"),
    ("equipment_kit_item", "force_element_item"),
    ("equipment_kit_bulk", "force_element_bulk"),
]

# (table after rename, old constraint/index name, new name)
_CONSTRAINTS = [
    ("force_element", "uq_equipment_kit_name", "uq_force_element_name"),
    (
        "force_element_item",
        "uq_equipment_kit_item_pair",
        "uq_force_element_item_pair",
    ),
    (
        "force_element_bulk",
        "uq_equipment_kit_bulk_type_enclave",
        "uq_force_element_bulk_type_enclave",
    ),
]

_INDEXES = [
    ("uq_equipment_kit_global_name", "uq_force_element_global_name"),
    (
        "uq_equipment_kit_bulk_type_no_enclave",
        "uq_force_element_bulk_type_no_enclave",
    ),
]


def _move_subject_kind(old: str, new: str) -> None:
    """Repoint stored event subjects, in both places a kind is written.

    `Event` maps to the legacy table `validation`, and event types live in
    `event_type_def` — both spellings are the table names, not typos.
    `subject_kind` is a plain column; `allowed_subject_kinds`
    is a JSONB array, so that one is rebuilt element by element rather than
    string-replaced — a substring swap across the whole document would also hit
    any other kind that happens to contain the old name.
    """
    op.execute(
        sa.text(
            "UPDATE validation SET subject_kind = :new WHERE subject_kind = :old"
        ).bindparams(old=old, new=new)
    )
    op.execute(
        sa.text(
            """
            UPDATE event_type_def
            SET allowed_subject_kinds = (
                SELECT jsonb_agg(
                    CASE WHEN elem = to_jsonb(CAST(:old AS text))
                         THEN to_jsonb(CAST(:new AS text))
                         ELSE elem END
                )
                FROM jsonb_array_elements(allowed_subject_kinds) AS elem
            )
            WHERE allowed_subject_kinds @> jsonb_build_array(CAST(:old AS text))
            """
        ).bindparams(old=old, new=new)
    )


# Seeded in 0058 under the old word. The SLUGS stay ("kit.saved",
# "kit.deleted") — events already point at them and a slug is an identifier,
# not a label — but the names are what show up in the events feed.
_EVENT_TYPE_LABELS = [
    ("kit.saved", "Kit saved", "Force element saved"),
    ("kit.deleted", "Kit deleted", "Force element deleted"),
]


def _relabel_event_types(reverse: bool = False) -> None:
    for slug, old, new in _EVENT_TYPE_LABELS:
        frm, to = (new, old) if reverse else (old, new)
        op.execute(
            sa.text(
                "UPDATE event_type_def SET label = :to "
                "WHERE slug = :slug AND label = :frm"
            ).bindparams(slug=slug, frm=frm, to=to)
        )


def upgrade() -> None:
    for old, new in _TABLES:
        op.rename_table(old, new)

    op.alter_column(
        "force_element_utc", "kit_id", new_column_name="force_element_id"
    )
    op.alter_column(
        "force_element_item", "kit_utc_id", new_column_name="force_element_utc_id"
    )
    op.alter_column(
        "force_element_bulk", "kit_utc_id", new_column_name="force_element_utc_id"
    )

    for table, old, new in _CONSTRAINTS:
        op.execute(f'ALTER TABLE {table} RENAME CONSTRAINT "{old}" TO "{new}"')
    for old, new in _INDEXES:
        op.execute(f'ALTER INDEX "{old}" RENAME TO "{new}"')

    _move_subject_kind("equipment_kit", "force_element")
    _relabel_event_types()


def downgrade() -> None:
    _relabel_event_types(reverse=True)
    _move_subject_kind("force_element", "equipment_kit")

    for old, new in _INDEXES:
        op.execute(f'ALTER INDEX "{new}" RENAME TO "{old}"')
    for table, old, new in _CONSTRAINTS:
        op.execute(f'ALTER TABLE {table} RENAME CONSTRAINT "{new}" TO "{old}"')

    op.alter_column(
        "force_element_utc", "force_element_id", new_column_name="kit_id"
    )
    op.alter_column(
        "force_element_item", "force_element_utc_id", new_column_name="kit_utc_id"
    )
    op.alter_column(
        "force_element_bulk", "force_element_utc_id", new_column_name="kit_utc_id"
    )

    for old, new in reversed(_TABLES):
        op.rename_table(new, old)
