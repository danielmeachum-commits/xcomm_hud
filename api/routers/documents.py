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
from sqlalchemy import func
from sqlalchemy.orm import Session

import storage
from action_registry import record_action
from db import get_db
from deps import get_current_workspace, requires
from models import (
    MAX_UPLOAD_BYTES,
    Document,
    DocumentVersion,
    Folder,
    User,
    Workspace,
)
from pubsub import notify
from schemas import DocumentOut, DocumentPatch, DocumentVersionOut

log = logging.getLogger("xcomm_hud.documents")

router = APIRouter(prefix="/documents", tags=["documents"])


def _load_document_in_workspace(
    db: Session, document_id: int, workspace: Workspace
) -> Document:
    doc = db.get(Document, document_id)
    if doc is None or doc.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return doc


def _load_version_of_document(
    db: Session, version_id: int, doc: Document
) -> DocumentVersion:
    version = db.get(DocumentVersion, version_id)
    if version is None or version.document_id != doc.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return version


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


def _out(
    doc: Document,
    username: Optional[str],
    current_version_no: Optional[int] = None,
    version_count: int = 1,
) -> DocumentOut:
    out = DocumentOut.model_validate(doc)
    out.created_by_username = username
    out.current_version_no = current_version_no
    out.version_count = version_count
    return out


def _version_stats(db: Session, doc: Document) -> tuple[Optional[int], int]:
    """(current version's number, total versions) for one document."""
    current_no = None
    if doc.current_version_id is not None:
        current_no = (
            db.query(DocumentVersion.version_no)
            .filter(DocumentVersion.id == doc.current_version_id)
            .scalar()
        )
    count = (
        db.query(func.count(DocumentVersion.id))
        .filter(DocumentVersion.document_id == doc.id)
        .scalar()
        or 0
    )
    return current_no, max(count, 1)


@router.get("", response_model=list[DocumentOut])
def list_documents(
    site_id: Optional[int] = None,
    folder_id: Optional[int] = None,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    q = (
        db.query(Document, User.username, DocumentVersion.version_no)
        .outerjoin(User, User.id == Document.created_by)
        .outerjoin(DocumentVersion, DocumentVersion.id == Document.current_version_id)
        .filter(Document.workspace_id == workspace.id)
    )
    if site_id is None:
        q = q.filter(Document.site_id.is_(None))
    else:
        q = q.filter(Document.site_id == site_id)
    if folder_id is not None:
        q = q.filter(Document.folder_id == folder_id)
    rows = q.order_by(Document.created_at.desc()).all()

    # One grouped query for the counts instead of a subquery per row.
    counts: dict[int, int] = {}
    if rows:
        counts = dict(
            db.query(DocumentVersion.document_id, func.count(DocumentVersion.id))
            .filter(DocumentVersion.document_id.in_([doc.id for doc, _, _ in rows]))
            .group_by(DocumentVersion.document_id)
            .all()
        )
    return [
        _out(doc, username, current_no, max(counts.get(doc.id, 0), 1))
        for doc, username, current_no in rows
    ]


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
    version = DocumentVersion(
        document_id=doc.id,
        version_no=1,
        filename=filename,
        content_type=content_type,
        size_bytes=size,
        storage_key=key,
        created_by=current_user.id,
    )
    db.add(version)
    db.flush()
    doc.current_version_id = version.id
    _record_document_event(
        db,
        action_slug="document.uploaded",
        workspace_id=workspace.id,
        doc=doc,
        user_id=current_user.id,
    )
    notify(background_tasks)
    return _out(doc, current_user.username, current_version_no=1, version_count=1)


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
    current_no, count = _version_stats(db, doc)
    return _out(doc, username, current_no, count)


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


@router.get("/{document_id}/versions", response_model=list[DocumentVersionOut])
def list_document_versions(
    document_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    doc = _load_document_in_workspace(db, document_id, workspace)
    rows = (
        db.query(DocumentVersion, User.username)
        .outerjoin(User, User.id == DocumentVersion.created_by)
        .filter(DocumentVersion.document_id == doc.id)
        .order_by(DocumentVersion.version_no.desc())
        .all()
    )
    out = []
    for version, username in rows:
        item = DocumentVersionOut.model_validate(version)
        item.created_by_username = username
        item.is_current = version.id == doc.current_version_id
        out.append(item)
    return out


@router.post("/{document_id}/versions", response_model=DocumentOut)
def add_document_version(
    document_id: int,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    note: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    doc = _load_document_in_workspace(db, document_id, workspace)

    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            f"File exceeds the {MAX_UPLOAD_BYTES // (1024 * 1024)} MB upload limit",
        )

    version_no = (
        db.query(func.max(DocumentVersion.version_no))
        .filter(DocumentVersion.document_id == doc.id)
        .scalar()
        or 0
    ) + 1

    filename = _sanitize_filename(file.filename or "")
    content_type = file.content_type or "application/octet-stream"
    key = (
        f"workspaces/{workspace.id}/documents/{uuid.uuid4()}/v{version_no}/{filename}"
    )
    storage.put_stream(key, file.file, content_type, size)

    version = DocumentVersion(
        document_id=doc.id,
        version_no=version_no,
        filename=filename,
        content_type=content_type,
        size_bytes=size,
        storage_key=key,
        note=note,
        created_by=current_user.id,
    )
    db.add(version)
    db.flush()

    # updated_at refreshes via the model's onupdate hook on flush.
    doc.filename = filename
    doc.content_type = content_type
    doc.size_bytes = size
    doc.storage_key = key
    doc.current_version_id = version.id
    db.flush()

    _record_document_event(
        db,
        action_slug="document.version_added",
        workspace_id=workspace.id,
        doc=doc,
        user_id=current_user.id,
    )
    notify(background_tasks)
    _, count = _version_stats(db, doc)
    return _out(doc, current_user.username, version_no, count)


@router.post("/{document_id}/versions/{version_id}/restore", response_model=DocumentOut)
def restore_document_version(
    document_id: int,
    version_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    doc = _load_document_in_workspace(db, document_id, workspace)
    version = _load_version_of_document(db, version_id, doc)

    # updated_at refreshes via the model's onupdate hook on flush.
    doc.filename = version.filename
    doc.content_type = version.content_type
    doc.size_bytes = version.size_bytes
    doc.storage_key = version.storage_key
    doc.current_version_id = version.id
    db.flush()

    _record_document_event(
        db,
        action_slug="document.version_restored",
        workspace_id=workspace.id,
        doc=doc,
        user_id=current_user.id,
    )
    notify(background_tasks)
    current_no, count = _version_stats(db, doc)
    return _out(doc, current_user.username, current_no, count)


@router.get("/{document_id}/versions/{version_id}/download")
def download_document_version(
    document_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    doc = _load_document_in_workspace(db, document_id, workspace)
    version = _load_version_of_document(db, version_id, doc)
    body = storage.open_stream(version.storage_key)
    return StreamingResponse(
        body.iter_chunks(),
        media_type=version.content_type,
        headers={"Content-Disposition": f'attachment; filename="{version.filename}"'},
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
    # Every version owns a distinct object; sweep them all (the document's
    # own storage_key duplicates the current version's, hence the set).
    keys = {
        key
        for (key,) in db.query(DocumentVersion.storage_key)
        .filter(DocumentVersion.document_id == doc.id)
        .all()
    }
    keys.add(doc.storage_key)
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            log.warning("Failed to delete object %s from storage", key)
    _record_document_event(
        db,
        action_slug="document.deleted",
        workspace_id=workspace.id,
        doc=doc,
        user_id=current_user.id,
    )
    db.delete(doc)
    notify(background_tasks)
