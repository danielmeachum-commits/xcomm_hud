"""Documentation pages — markdown authored in-app, stored in Postgres.

The Knowledge Hub is global: every page is shared across all workspaces. The
tree shape lives in `parent_id` + `display_order` — the list endpoint returns a
flat set and the UI assembles the hierarchy.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from action_registry import record_action
from db import get_db
from deps import get_current_workspace, requires
from models import DocPage, User, Workspace
from pubsub import notify
from schemas import DocPageIn, DocPageOut, DocPagePatch

log = logging.getLogger(__name__)

# NOTE: prefix is /doc-pages, not /docs — FastAPI serves its Swagger UI at /docs.
router = APIRouter(prefix="/doc-pages", tags=["doc_pages"])


def _out(page: DocPage, username: Optional[str]) -> DocPageOut:
    out = DocPageOut.model_validate(page)
    out.created_by_username = username
    return out


def _record_doc_page_event(
    db: Session,
    *,
    action_slug: str,
    workspace_id: int,
    page: DocPage,
    user_id: int,
) -> None:
    """Best-effort audit row — a registry/catalog miss must not fail the mutation."""
    try:
        record_action(
            db,
            action_slug=action_slug,
            workspace_id=workspace_id,
            subject_kind="doc_page",
            subject_id=page.id,
            subject_label=page.title,
            user_id=user_id,
            source="manual",
            event_type="general",
        )
    except Exception:
        log.warning("Failed to record %s for doc_page %s", action_slug, page.id)


def _load_doc_page(db: Session, page_id: int) -> DocPage:
    page = db.get(DocPage, page_id)
    if page is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doc page not found")
    return page


def _validate_parent(db: Session, parent_id: int, self_id: Optional[int]) -> None:
    if self_id is not None and parent_id == self_id:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "A page cannot be its own parent"
        )
    _load_doc_page(db, parent_id)


@router.get("", response_model=list[DocPageOut])
def list_doc_pages(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(DocPage, User.username)
        .outerjoin(User, DocPage.created_by == User.id)
        .order_by(DocPage.display_order, DocPage.title)
        .all()
    )
    return [_out(page, username) for page, username in rows]


@router.get("/by-slug/{slug}", response_model=DocPageOut)
def get_doc_page_by_slug(
    slug: str,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    row = (
        db.query(DocPage, User.username)
        .outerjoin(User, DocPage.created_by == User.id)
        .filter(DocPage.slug == slug)
        .first()
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doc page not found")
    return _out(row[0], row[1])


@router.get("/{page_id}", response_model=DocPageOut)
def get_doc_page(
    page_id: int,
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    page = _load_doc_page(db, page_id)
    username = (
        db.query(User.username).filter(User.id == page.created_by).scalar()
        if page.created_by is not None
        else None
    )
    return _out(page, username)


@router.post("", response_model=DocPageOut, status_code=status.HTTP_201_CREATED)
def create_doc_page(
    body: DocPageIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    if body.parent_id is not None:
        _validate_parent(db, body.parent_id, None)
    page = DocPage(
        parent_id=body.parent_id,
        section_id=body.section_id,
        slug=body.slug,
        title=body.title,
        description=body.description,
        content=body.content,
        display_order=body.display_order,
        created_by=current_user.id,
    )
    db.add(page)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A doc page with slug '{body.slug}' already exists in this scope",
        )
    _record_doc_page_event(
        db,
        action_slug="doc_page.created",
        workspace_id=workspace.id,
        page=page,
        user_id=current_user.id,
    )
    notify(background_tasks)
    return _out(page, current_user.username)


@router.patch("/{page_id}", response_model=DocPageOut)
def patch_doc_page(
    page_id: int,
    body: DocPagePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    page = _load_doc_page(db, page_id)
    updates = body.model_dump(exclude_unset=True)
    if updates.get("parent_id") is not None:
        _validate_parent(db, updates["parent_id"], page.id)
    for k, v in updates.items():
        setattr(page, k, v)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A doc page with that slug already exists in this scope",
        )
    _record_doc_page_event(
        db,
        action_slug="doc_page.updated",
        workspace_id=workspace.id,
        page=page,
        user_id=current_user.id,
    )
    notify(background_tasks)
    username = (
        db.query(User.username).filter(User.id == page.created_by).scalar()
        if page.created_by is not None
        else None
    )
    return _out(page, username)


@router.delete("/{page_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_doc_page(
    page_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("admin")),
):
    page = _load_doc_page(db, page_id)
    _record_doc_page_event(
        db,
        action_slug="doc_page.deleted",
        workspace_id=workspace.id,
        page=page,
        user_id=current_user.id,
    )
    db.delete(page)
    notify(background_tasks)
