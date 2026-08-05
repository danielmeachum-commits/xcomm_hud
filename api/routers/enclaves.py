"""Enclaves: the networks gear and services belong to (NIPR, SIPR, ACBN, BICES).

Same global-vs-workspace shape as the equipment catalog and Rule/EventTypeDef:
`workspace_id IS NULL` is a globally-seeded, admin-managed row (the named
networks are service-wide facts), a non-null workspace_id is a local addition.
Reads merge both; writing a global row needs `admin`.

Deletes are soft (`retired_at`) because equipment, services and UTC lines hold
foreign keys here — hard-deleting an enclave would strip tagged gear of the
answer to "which network is this on".

The hierarchy is flat over the wire: `parent_id` only, no nesting in the
response, tree assembled client-side. Same as Folder and DocPage.
"""

from __future__ import annotations

import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Enclave, User, Workspace
from pubsub import notify
from schemas import EnclaveIn, EnclaveOut, EnclavePatch

router = APIRouter(tags=["enclaves"])

# A hierarchy this shallow (transport -> NIPR/SIPR -> ACBN/BICES) has no reason
# to run deep. The cap is a backstop against a cycle the check below missed,
# not a modelling opinion.
_MAX_DEPTH = 8


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def _require_write(row_workspace_id: int | None, user: User) -> None:
    """Global rows are admin-only; workspace rows need operator.

    Mirrors equipment_catalog._require_write — the route dependency already
    established `operator`, so this only adds the extra bar for globals.
    """
    if row_workspace_id is None and user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Editing a global enclave requires admin",
        )


def _visible(workspace: Workspace, include_retired: bool):
    """Global rows plus this workspace's own, optionally including retired."""
    q = (Enclave.workspace_id.is_(None)) | (Enclave.workspace_id == workspace.id)
    if include_retired:
        return q
    return q & (Enclave.retired_at.is_(None))


def _out(row: Enclave) -> EnclaveOut:
    out = EnclaveOut.model_validate(row)
    out.is_global = row.workspace_id is None
    return out


def _load(db: Session, enclave_id: int, workspace: Workspace) -> Enclave:
    row = db.get(Enclave, enclave_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enclave not found")
    return row


def _check_parent(
    db: Session,
    workspace: Workspace,
    parent_id: int | None,
    child_id: int | None = None,
) -> None:
    """Reject a parent that is missing, invisible, or would form a cycle.

    Folder and DocPage get away without this because their UIs can't reparent a
    node into its own subtree. This one is editable from a form with a plain
    dropdown, so a cycle is one mis-click away — and a cycle here would hang
    every consumer that walks to the root.
    """
    if parent_id is None:
        return
    if parent_id == child_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "An enclave cannot be its own parent"
        )
    parent = db.get(Enclave, parent_id)
    if parent is None or (
        parent.workspace_id is not None and parent.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Parent enclave not found")
    # A workspace row may nest under a global one, but never the reverse: a
    # global enclave that depended on one workspace's row would be broken for
    # everyone else.
    if parent.workspace_id is not None and child_id is not None:
        child = db.get(Enclave, child_id)
        if child is not None and child.workspace_id is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "A global enclave cannot nest under a workspace enclave",
            )
    # Walk to the root. If child_id shows up, this edit closes a loop.
    seen: set[int] = set()
    cursor: Enclave | None = parent
    for _ in range(_MAX_DEPTH):
        if cursor is None:
            return
        if child_id is not None and cursor.id == child_id:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "That parent is nested under this enclave — it would form a cycle",
            )
        if cursor.id in seen:
            break
        seen.add(cursor.id)
        cursor = db.get(Enclave, cursor.parent_id) if cursor.parent_id else None
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Enclave nesting is too deep"
        )
    if cursor is not None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Enclave nesting is already cyclic"
        )


@router.get("/enclaves", response_model=list[EnclaveOut])
def list_enclaves(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    include_retired: bool = Query(default=False),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(Enclave)
        .filter(_visible(workspace, include_retired))
        .order_by(Enclave.display_order, Enclave.name)
        .all()
    )
    return [_out(r) for r in rows]


@router.post("/enclaves", response_model=EnclaveOut, status_code=status.HTTP_201_CREATED)
def create_enclave(
    body: EnclaveIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    # `global` here means "seed the shared list" — admins only.
    make_global: bool = Query(default=False, alias="global"),
    current_user: User = Depends(requires("operator")),
):
    owner_id = None if make_global else workspace.id
    _require_write(owner_id, current_user)
    _check_parent(db, workspace, body.parent_id)
    row = Enclave(workspace_id=owner_id, **body.model_dump())
    db.add(row)
    db.flush()
    db.refresh(row)
    notify(background_tasks, "enclaves")
    return _out(row)


@router.patch("/enclaves/{enclave_id}", response_model=EnclaveOut)
def patch_enclave(
    enclave_id: int,
    body: EnclavePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load(db, enclave_id, workspace)
    _require_write(row.workspace_id, current_user)
    data = body.model_dump(exclude_unset=True)
    retired = data.pop("retired", None)
    if "parent_id" in data:
        _check_parent(db, workspace, data["parent_id"], child_id=row.id)
    for k, v in data.items():
        setattr(row, k, v)
    if retired is not None:
        row.retired_at = _now() if retired else None
    db.flush()
    db.refresh(row)
    notify(background_tasks, "enclaves")
    return _out(row)


@router.delete("/enclaves/{enclave_id}", status_code=status.HTTP_204_NO_CONTENT)
def retire_enclave(
    enclave_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    """Soft delete. Tagged equipment and services keep pointing here — an
    enclave that gear still references must stay resolvable."""
    row = _load(db, enclave_id, workspace)
    _require_write(row.workspace_id, current_user)
    row.retired_at = _now()
    db.flush()
    notify(background_tasks, "enclaves")
