"""Printable reports."""
from __future__ import annotations

import datetime
import re

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Site, User, Workspace
from schemas import SummaryReportIn
from summary_report import build_summary_pdf

router = APIRouter(prefix="/reports", tags=["reports"])


@router.post("/summary")
def summary_report(
    body: SummaryReportIn,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    user: User = Depends(requires("viewer")),
):
    """The status summary as a PDF download: every site (or the ones asked
    for), its posture, services and gateways, with the remarks typed at
    export. Read-only, so any viewer can produce one. Remarks aren't stored."""
    if body.site_ids:
        known = {
            sid for (sid,) in db.query(Site.id).filter(
                Site.workspace_id == workspace.id, Site.id.in_(body.site_ids)
            )
        }
        if known != set(body.site_ids):
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Site not found")
    pdf = build_summary_pdf(
        db, workspace, user, body.remark, body.site_remarks, body.site_ids,
        body.events_log,
    )
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d-%H%MZ")
    slug = re.sub(r"[^a-z0-9]+", "-", workspace.name.lower()).strip("-") or "workspace"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="xcomm-summary-{slug}-{stamp}.pdf"'},
    )
