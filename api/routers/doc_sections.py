"""Knowledge Hub sections — top-level grouping for doc pages.

Sections are global, shared across all workspaces. Pages attach via
doc_page.section_id; a NULL section_id is the implicit "General" section the UI
always shows.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import DocSection
from pubsub import notify
from schemas import DocSectionIn, DocSectionOut, DocSectionPatch

log = logging.getLogger(__name__)

# prefix /doc-sections (kept parallel to /doc-pages; /docs is FastAPI Swagger).
router = APIRouter(prefix="/doc-sections", tags=["doc_sections"])


def _load_section(db: Session, section_id: int) -> DocSection:
    section = db.get(DocSection, section_id)
    if section is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Doc section not found")
    return section


@router.get("", response_model=list[DocSectionOut])
def list_doc_sections(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
):
    return (
        db.query(DocSection)
        .order_by(DocSection.display_order, DocSection.title)
        .all()
    )


@router.post("", response_model=DocSectionOut, status_code=status.HTTP_201_CREATED)
def create_doc_section(
    body: DocSectionIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user=Depends(requires("operator")),
):
    section = DocSection(
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
            f"A section with slug '{body.slug}' already exists",
        )
    notify(background_tasks)
    return section


@router.patch("/{section_id}", response_model=DocSectionOut)
def patch_doc_section(
    section_id: int,
    body: DocSectionPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("operator")),
):
    section = _load_section(db, section_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(section, k, v)
    try:
        db.flush()
    except IntegrityError:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "A section with that slug already exists",
        )
    notify(background_tasks)
    return section


@router.delete("/{section_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_doc_section(
    section_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    _=Depends(requires("admin")),
):
    # doc_page.section_id is ON DELETE SET NULL, so pages fall back to General.
    section = _load_section(db, section_id)
    db.delete(section)
    notify(background_tasks)
