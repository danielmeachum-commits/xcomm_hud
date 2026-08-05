"""Equipment catalog: types, capabilities, UTC definitions, package definitions.

The hub previously stopped at Site + Service, so there was no record of the
actual boxes and no way to say what a piece of gear can do. This lays the
reference layer: `equipment_type` is a model of gear ("AN/PRC-117G") carrying
its NSN and the nicknames people actually use, and
`equipment_type_capability` declares what that model can do (voice, data,
satcom_rf, los_rf). Capabilities are the join point that lets one radio be
simultaneously a service endpoint and a transport path — registering an
instance materializes these declarations into editable per-kit rows.

`utc_def` + `utc_def_line` hold the authorized bill of materials; `package_def`
+ `package_def_utc` compose UTCs into a high-level package (FCP). Serialized
vs bulk is deliberately NOT stored on the line item — it comes from
`equipment_type.serialized`, so a type can't disagree with itself across UTCs.

Catalog rows follow the Rule/EventTypeDef pattern: workspace_id NULL means a
globally-seeded, admin-managed row; non-NULL is a workspace-local addition.
The partial unique indexes enforce one global row per title/code while leaving
workspaces free to define their own.

A small starter catalog is seeded at the bottom — enough to exercise the
deploy wizard without hand-entering NSNs first.

Revision ID: 0040_equipment_catalog
Revises: 0039_rule_key_version
Create Date: 2026-08-04
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0040_equipment_catalog"
down_revision = "0039_rule_key_version"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "equipment_type",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("short_name", sa.String(64), nullable=True),
        sa.Column(
            "aliases", JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column("nsn", sa.String(20), nullable=True),
        sa.Column("lin", sa.String(12), nullable=True),
        sa.Column(
            "category", sa.String(16), nullable=False, server_default="other"
        ),
        sa.Column(
            "serialized", sa.Boolean(), nullable=False, server_default=sa.text("true")
        ),
        sa.Column("id_prefix", sa.String(4), nullable=False, server_default="R"),
        sa.Column("manufacturer", sa.String(128), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("icon", sa.String(64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
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
            name="fk_equipment_type_workspace",
        ),
        sa.UniqueConstraint(
            "workspace_id", "title", name="uq_equipment_type_workspace_title"
        ),
    )
    op.create_index("ix_equipment_type_workspace_id", "equipment_type", ["workspace_id"])
    op.create_index("ix_equipment_type_nsn", "equipment_type", ["nsn"])
    # One global row per title; workspace rows are covered by the unique
    # constraint above (NULLs don't collide there, hence this partial index).
    op.create_index(
        "uq_equipment_type_global_title",
        "equipment_type",
        ["title"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    op.create_table(
        "equipment_type_capability",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("label", sa.String(96), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "display_order", sa.Integer(), nullable=False, server_default="0"
        ),
        sa.Column(
            "materialize_by_default",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.ForeignKeyConstraint(
            ["equipment_type_id"],
            ["equipment_type.id"],
            ondelete="CASCADE",
            name="fk_equipment_type_capability_type",
        ),
        sa.UniqueConstraint(
            "equipment_type_id",
            "kind",
            "label",
            name="uq_equipment_type_capability_kind_label",
        ),
    )

    op.create_table(
        "utc_def",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
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
            name="fk_utc_def_workspace",
        ),
        sa.UniqueConstraint("workspace_id", "code", name="uq_utc_def_workspace_code"),
    )
    op.create_index("ix_utc_def_workspace_id", "utc_def", ["workspace_id"])
    op.create_index(
        "uq_utc_def_global_code",
        "utc_def",
        ["code"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    op.create_table(
        "utc_def_line",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("utc_def_id", sa.BigInteger(), nullable=False),
        sa.Column("equipment_type_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["utc_def_id"],
            ["utc_def.id"],
            ondelete="CASCADE",
            name="fk_utc_def_line_utc",
        ),
        # RESTRICT: a type that appears in a UTC's bill of materials can't be
        # hard-deleted out from under it. Retire it instead.
        sa.ForeignKeyConstraint(
            ["equipment_type_id"],
            ["equipment_type.id"],
            ondelete="RESTRICT",
            name="fk_utc_def_line_type",
        ),
        sa.UniqueConstraint(
            "utc_def_id", "equipment_type_id", name="uq_utc_def_line_type"
        ),
    )

    op.create_table(
        "package_def",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("workspace_id", sa.BigInteger(), nullable=True),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
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
            name="fk_package_def_workspace",
        ),
        sa.UniqueConstraint(
            "workspace_id", "code", name="uq_package_def_workspace_code"
        ),
    )
    op.create_index("ix_package_def_workspace_id", "package_def", ["workspace_id"])
    op.create_index(
        "uq_package_def_global_code",
        "package_def",
        ["code"],
        unique=True,
        postgresql_where=sa.text("workspace_id IS NULL"),
    )

    op.create_table(
        "package_def_utc",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("package_def_id", sa.BigInteger(), nullable=False),
        sa.Column("utc_def_id", sa.BigInteger(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column(
            "role_hint", sa.String(16), nullable=False, server_default="either"
        ),
        sa.Column("display_order", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["package_def_id"],
            ["package_def.id"],
            ondelete="CASCADE",
            name="fk_package_def_utc_package",
        ),
        sa.ForeignKeyConstraint(
            ["utc_def_id"],
            ["utc_def.id"],
            ondelete="RESTRICT",
            name="fk_package_def_utc_utc",
        ),
        sa.UniqueConstraint(
            "package_def_id", "utc_def_id", name="uq_package_def_utc_pair"
        ),
    )

    _seed_starter_catalog()


# Starter catalog. Global rows (workspace_id NULL). Kept small on purpose —
# it exists so the deploy wizard has something to pick on a fresh install,
# not to be an authoritative equipment master.
#   title, short_name, aliases, nsn, category, serialized, id_prefix, capabilities
_STARTER_TYPES = [
    (
        "AN/PRC-117G",
        "117G",
        ["117G", "radio", "manpack"],
        "5820-01-523-9937",
        "radio",
        True,
        "R",
        [
            ("voice", "Voice net"),
            ("data", "Data / IP"),
            ("satcom_rf", "SATCOM (TSM/DAMA)"),
            ("los_rf", "Line of sight"),
        ],
    ),
    (
        "AN/PRC-152A",
        "152",
        ["152", "152A", "handheld", "radio"],
        "5820-01-568-4425",
        "radio",
        True,
        "R",
        [("voice", "Voice net"), ("los_rf", "Line of sight")],
    ),
    (
        "RF Kit (LOS Extension)",
        "RFK",
        ["RFK", "rf kit", "extension kit"],
        None,
        "antenna",
        True,
        "K",
        [("los_rf", "Line of sight shot")],
    ),
    (
        "KG-175D TACLANE Micro",
        "TACLANE",
        ["taclane", "kg-175", "crypto"],
        "5810-01-538-0289",
        "crypto",
        True,
        "C",
        [("crypto", "Type 1 encryption"), ("routing", "Ciphertext routing")],
    ),
    (
        "Cisco Catalyst 9200 (24-port)",
        "SW-24",
        ["switch", "9200", "catalyst"],
        "5895-01-679-1234",
        "network",
        True,
        "S",
        [("switching", "Layer 2 switching"), ("routing", "Layer 3 routing")],
    ),
    (
        "Deployable Server (DTC)",
        "DTC",
        ["dtc", "server"],
        None,
        "compute",
        True,
        "V",
        [("data", "Local services"), ("routing", "Gateway routing")],
    ),
    (
        "CAT-5e Patch Cable, 25ft",
        "CAT5-25",
        ["cable", "patch cable"],
        "6145-01-441-8035",
        "cable",
        False,
        "X",
        [],
    ),
    (
        "BB-2590 Rechargeable Battery",
        "BB-2590",
        ["battery", "2590"],
        "6140-01-490-4316",
        "power",
        False,
        "X",
        [],
    ),
]

# code, name, description, [(type title, quantity)]
_STARTER_UTCS = [
    (
        "6KFCP",
        "FCP Primary Comms Package",
        "Primary services package — voice, data, and the SATCOM shot.",
        [
            ("AN/PRC-117G", 2),
            ("KG-175D TACLANE Micro", 1),
            ("Cisco Catalyst 9200 (24-port)", 1),
            ("Deployable Server (DTC)", 1),
            ("CAT-5e Patch Cable, 25ft", 12),
            ("BB-2590 Rechargeable Battery", 8),
        ],
    ),
    (
        "6KFCX",
        "FCP Extension Package",
        "Extension site — takes signal off the primary UTC over an RF shot.",
        [
            ("RF Kit (LOS Extension)", 2),
            ("AN/PRC-152A", 2),
            ("Cisco Catalyst 9200 (24-port)", 1),
            ("CAT-5e Patch Cable, 25ft", 6),
            ("BB-2590 Rechargeable Battery", 4),
        ],
    ),
]


def _seed_starter_catalog() -> None:
    """Insert the starter global catalog rows.

    Written with explicit selects rather than bulk_insert-with-known-ids
    because the sequences are fresh and we need the generated ids to wire up
    capabilities and UTC lines.
    """
    conn = op.get_bind()

    type_ids: dict[str, int] = {}
    for (
        title,
        short_name,
        aliases,
        nsn,
        category,
        serialized,
        id_prefix,
        capabilities,
    ) in _STARTER_TYPES:
        type_id = conn.execute(
            sa.text(
                """
                INSERT INTO equipment_type
                    (workspace_id, title, short_name, aliases, nsn, category,
                     serialized, id_prefix)
                VALUES
                    (NULL, :title, :short_name, CAST(:aliases AS jsonb), :nsn,
                     :category, :serialized, :id_prefix)
                RETURNING id
                """
            ),
            {
                "title": title,
                "short_name": short_name,
                "aliases": json.dumps(aliases),
                "nsn": nsn,
                "category": category,
                "serialized": serialized,
                "id_prefix": id_prefix,
            },
        ).scalar_one()
        type_ids[title] = type_id

        for order, (kind, label) in enumerate(capabilities):
            conn.execute(
                sa.text(
                    """
                    INSERT INTO equipment_type_capability
                        (equipment_type_id, kind, label, display_order,
                         materialize_by_default)
                    VALUES (:type_id, :kind, :label, :order, true)
                    """
                ),
                {"type_id": type_id, "kind": kind, "label": label, "order": order},
            )

    utc_ids: dict[str, int] = {}
    for code, name, description, lines in _STARTER_UTCS:
        utc_id = conn.execute(
            sa.text(
                """
                INSERT INTO utc_def (workspace_id, code, name, description)
                VALUES (NULL, :code, :name, :description)
                RETURNING id
                """
            ),
            {"code": code, "name": name, "description": description},
        ).scalar_one()
        utc_ids[code] = utc_id

        for order, (type_title, quantity) in enumerate(lines):
            conn.execute(
                sa.text(
                    """
                    INSERT INTO utc_def_line
                        (utc_def_id, equipment_type_id, quantity, display_order)
                    VALUES (:utc_id, :type_id, :quantity, :order)
                    """
                ),
                {
                    "utc_id": utc_id,
                    "type_id": type_ids[type_title],
                    "quantity": quantity,
                    "order": order,
                },
            )

    package_id = conn.execute(
        sa.text(
            """
            INSERT INTO package_def (workspace_id, code, name, description)
            VALUES (NULL, 'FCP', 'Flyaway Comms Package',
                    'Primary UTC plus an extension UTC linked by an RF shot.')
            RETURNING id
            """
        )
    ).scalar_one()
    for order, (code, role_hint) in enumerate(
        [("6KFCP", "primary"), ("6KFCX", "extension")]
    ):
        conn.execute(
            sa.text(
                """
                INSERT INTO package_def_utc
                    (package_def_id, utc_def_id, quantity, role_hint, display_order)
                VALUES (:package_id, :utc_id, 1, :role_hint, :order)
                """
            ),
            {
                "package_id": package_id,
                "utc_id": utc_ids[code],
                "role_hint": role_hint,
                "order": order,
            },
        )


def downgrade() -> None:
    op.drop_table("package_def_utc")
    op.drop_index("uq_package_def_global_code", table_name="package_def")
    op.drop_index("ix_package_def_workspace_id", table_name="package_def")
    op.drop_table("package_def")
    op.drop_table("utc_def_line")
    op.drop_index("uq_utc_def_global_code", table_name="utc_def")
    op.drop_index("ix_utc_def_workspace_id", table_name="utc_def")
    op.drop_table("utc_def")
    op.drop_table("equipment_type_capability")
    op.drop_index("uq_equipment_type_global_title", table_name="equipment_type")
    op.drop_index("ix_equipment_type_nsn", table_name="equipment_type")
    op.drop_index("ix_equipment_type_workspace_id", table_name="equipment_type")
    op.drop_table("equipment_type")
