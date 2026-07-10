"""Knowledge Hub sections — top-level grouping for doc pages.

Global (workspace_id NULL) or workspace-scoped; a workspace section shadows a
global one with the same slug, same as doc_page. Pages attach via
doc_page.section_id; a NULL section_id is the implicit "General" section the UI
always shows.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import DocSection, Workspace
from pubsub import notify
from schemas import DocSectionIn, DocSectionOut, DocSectionPatch

log = logging.getLogger(__name__)

# prefix /doc-sections (kept parallel to /doc-pages; /docs is FastAPI Swagger).
router = APIRouter(prefix="/doc-sections", tags=["doc_sections"])


def _out(section: DocSection) -> DocSectionOut:
    out = DocSectionOut.model_validate(section)
    out.is_global = section.workspace_id is None
    return out


def _load_section(db: Session, section_id: int, workspace: Workspace) -> DocSection:
    """404 unless the section is global or belongs to the current workspace."""
    section = db.get(DocSection, section_id)
    if section is None or (
        section.workspace_id is not None and section.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doc section not found")
    return section


@router.get("", response_model=list[DocSectionOut])
def list_doc_sections(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    rows = (
        db.query(DocSection)
        .filter(
            or_(
                DocSection.workspace_id == workspace.id,
                DocSection.workspace_id.is_(None),
            )
        )
        .order_by(DocSection.display_order, DocSection.title)
        .all()
    )
    # Shadow-resolve: a workspace section wins over a global with the same slug.
    by_slug: dict[str, DocSection] = {}
    for section in rows:
        existing = by_slug.get(section.slug)
        if existing is None or (
            existing.workspace_id is None and section.workspace_id is not None
        ):
            by_slug[section.slug] = section
    return [_out(s) for s in by_slug.values()]


@router.post("", response_model=DocSectionOut, status_code=status.HTTP_201_CREATED)
def create_doc_section(
    body: DocSectionIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user=Depends(requires("operator")),
):
    workspace_id = None if body.scope == "global" else workspace.id
    section = DocSection(
        workspace_id=workspace_id,
        slug=body.slug,
        title=body.title,
        description=body.description,
        icon=body.icon,
        display_order=body.display_order,
        created_by=current_user.id,
    )
    db.add(section)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"A section with slug '{body.slug}' already exists in this scope",
        )
    notify(background_tasks)
    return _out(section)


@router.patch("/{section_id}", response_model=DocSectionOut)
def patch_doc_section(
    section_id: int,
    body: DocSectionPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    section = _load_section(db, section_id, workspace)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(section, k, v)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A section with that slug already exists in this scope",
        )
    notify(background_tasks)
    return _out(section)


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_doc_section(
    section_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    # doc_page.section_id is ON DELETE SET NULL, so pages fall back to General.
    section = _load_section(db, section_id, workspace)
    db.delete(section)
    notify(background_tasks)
