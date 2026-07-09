"""Document CRUD — metadata in Postgres, file bytes in object storage.

Uploads are multipart; the file streams to S3-compatible storage (see
api/storage.py) under a per-document key and only metadata lands in the
`document` table. Downloads stream back through the API so object storage
never needs to be exposed to browsers.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    UploadFile,
    status,
)
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import storage
from action_registry import record_action
from db import get_db
from deps import get_current_workspace, requires
from models import MAX_UPLOAD_BYTES, Document, Folder, User, Workspace
from pubsub import notify
from schemas import DocumentOut, DocumentPatch

log = logging.getLogger("xcomm_hud.documents")

router = APIRouter(prefix="/documents", tags=["documents"])


def _load_document_in_workspace(
    db: Session, document_id: int, workspace: Workspace
) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or doc.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


def _check_folder_in_workspace(
    db: Session, folder_id: int, workspace: Workspace
) -> None:
    folder = db.get(Folder, folder_id)
    if folder is None or folder.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Folder not found")


def _sanitize_filename(name: str) -> str:
    """Keep the basename and collapse anything exotic to underscores."""
    name = os.path.basename(name or "")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._") or "file"
    return name[:255]


def _record_document_event(
    db: Session,
    *,
    action_slug: str,
    workspace_id: int,
    doc: Document,
    user_id: int,
) -> None:
    """Best-effort feed row — a registry/catalog miss must not fail the mutation."""
    try:
        record_action(
            db,
            action_slug=action_slug,
            workspace_id=workspace_id,
            subject_kind="document",
            subject_id=doc.id,
            subject_label=doc.title,
            user_id=user_id,
            source="manual",
            event_type="general",
        )
    except Exception:
        log.warning("Failed to record %s for document %s", action_slug, doc.id)


def _out(doc: Document, username: Optional[str]) -> DocumentOut:
    out = DocumentOut.model_validate(doc)
    out.created_by_username = username
    return out


@router.get("", response_model=list[DocumentOut])
def list_documents(
    site_id: Optional[int] = None,
    folder_id: Optional[int] = None,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    q = (
        db.query(Document, User.username)
        .outerjoin(User, User.id == Document.created_by)
        .filter(Document.workspace_id == workspace.id)
    )
    if site_id is None:
        q = q.filter(Document.site_id.is_(None))
    else:
        q = q.filter(Document.site_id == site_id)
    if folder_id is not None:
        q = q.filter(Document.folder_id == folder_id)
    rows = q.order_by(Document.created_at.desc()).all()
    return [_out(doc, username) for doc, username in rows]


@router.post("", response_model=DocumentOut, status_code=status.HTTP_201_CREATED)
def create_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    title: str = Form(...),
    description: Optional[str] = Form(None),
    category: Optional[str] = Form(None),
    folder_id: Optional[int] = Form(None),
    site_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    if folder_id is not None:
        _check_folder_in_workspace(db, folder_id, workspace)

    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit",
        )

    filename = _sanitize_filename(file.filename or "")
    content_type = file.content_type or "application/octet-stream"
    key = f"workspaces/{workspace.id}/documents/{uuid.uuid4()}/{filename}"
    storage.put_stream(key, file.file, content_type, size)

    doc = Document(
        workspace_id=workspace.id,
        site_id=site_id,
        folder_id=folder_id,
        title=title,
        description=description,
        category=category,
        filename=filename,
        content_type=content_type,
        size_bytes=size,
        storage_key=key,
        created_by=current_user.id,
    )
    db.add(doc)
    db.flush()
    _record_document_event(
        db,
        action_slug="document.uploaded",
        workspace_id=workspace.id,
        doc=doc,
        user_id=current_user.id,
    )
    notify(background_tasks)
    return _out(doc, current_user.username)


@router.patch("/{document_id}", response_model=DocumentOut)
def patch_document(
    document_id: int,
    body: DocumentPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    doc = _load_document_in_workspace(db, document_id, workspace)
    updates = body.model_dump(exclude_unset=True)
    if updates.get("folder_id") is not None:
        _check_folder_in_workspace(db, updates["folder_id"], workspace)
    for k, v in updates.items():
        setattr(doc, k, v)
    db.flush()
    notify(background_tasks)
    username = None
    if doc.created_by is not None:
        u = db.get(User, doc.created_by)
        if u:
            username = u.username
    return _out(doc, username)


@router.get("/{document_id}/download")
def download_document(
    document_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    doc = _load_document_in_workspace(db, document_id, workspace)
    body = storage.open_stream(doc.storage_key)
    return StreamingResponse(
        body.iter_chunks(),
        media_type=doc.content_type,
        headers={"Content-Disposition": f'attachment; filename="{doc.filename}"'},
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("admin")),
):
    doc = _load_document_in_workspace(db, document_id, workspace)
    try:
        storage.delete(doc.storage_key)
    except Exception:
        log.warning("Failed to delete object %s from storage", doc.storage_key)
    _record_document_event(
        db,
        action_slug="document.deleted",
        workspace_id=workspace.id,
        doc=doc,
        user_id=current_user.id,
    )
    db.delete(doc)
    notify(background_tasks)
