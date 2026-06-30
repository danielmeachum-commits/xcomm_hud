"""Validation feed — append-only history suitable for reporting export."""

from __future__ import annotations

import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from db import get_db
from deps import requires
from models import Gateway, Service, Site, User, Validation
from schemas import SubjectKind, ValidationOut

router = APIRouter(prefix="/validations", tags=["validations"])


def _enrich(db: Session, v: Validation) -> ValidationOut:
    out = ValidationOut.model_validate(v)
    if v.validated_by_user_id is not None:
        u = db.get(User, v.validated_by_user_id)
        if u:
            out.validated_by_username = u.username
    if v.subject_kind == "service":
        svc = db.get(Service, v.subject_id)
        if svc:
            out.subject_name = svc.name
            out.site_id = svc.site_id
            site = db.get(Site, svc.site_id)
            if site:
                out.site_name = site.name
    elif v.subject_kind == "gateway":
        gw = db.get(Gateway, v.subject_id)
        if gw:
            out.subject_name = gw.name
            out.site_id = gw.site_id
            site = db.get(Site, gw.site_id)
            if site:
                out.site_name = site.name
    elif v.subject_kind == "site":
        site = db.get(Site, v.subject_id)
        if site:
            out.subject_name = site.name
            out.site_id = site.id
            out.site_name = site.name
    return out


@router.get("", response_model=list[ValidationOut])
def list_validations(
    db: Session = Depends(get_db),
    _=Depends(requires("viewer")),
    site_id: Optional[int] = Query(default=None),
    subject_kind: Optional[SubjectKind] = Query(default=None),
    subject_id: Optional[int] = Query(default=None),
    since: Optional[datetime.datetime] = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
):
    q = db.query(Validation)
    if subject_kind:
        q = q.filter(Validation.subject_kind == subject_kind)
    if subject_id:
        q = q.filter(Validation.subject_id == subject_id)
    if since:
        q = q.filter(Validation.validated_at >= since)
    rows = q.order_by(Validation.validated_at.desc()).limit(limit).all()

    enriched = [_enrich(db, v) for v in rows]
    if site_id is not None:
        enriched = [v for v in enriched if v.site_id == site_id]
    return enriched
