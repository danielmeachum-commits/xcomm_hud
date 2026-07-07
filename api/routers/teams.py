"""Team CRUD — many-to-many overlay across work centers per workspace.

Beyond name/color, a team carries a short slug ("FCP1"), an NCOIC, and a
designated lead per work center (scoped to the team — FCP1's Tech Control
lead can differ from FCP2's). Leads are replaced as a whole set on write.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Personnel, Team, TeamWorkCenterLead, WorkCenter, Workspace
from pubsub import notify
from schemas import TeamIn, TeamLeadIn, TeamOut, TeamPatch

router = APIRouter(prefix="/teams", tags=["personnel"])


def _check_unique(
    db: Session,
    workspace: Workspace,
    field,
    value: str,
    label: str,
    exclude_id: int | None = None,
) -> None:
    q = db.query(Team).filter(Team.workspace_id == workspace.id, field == value)
    if exclude_id is not None:
        q = q.filter(Team.id != exclude_id)
    if q.first():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Team {label} already exists")


def _check_ncoic(db: Session, workspace: Workspace, ncoic_id: int) -> None:
    person = db.get(Personnel, ncoic_id)
    if person is None or person.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "NCOIC not found")


def _build_leads(
    db: Session, workspace: Workspace, leads: list[TeamLeadIn]
) -> list[TeamWorkCenterLead]:
    seen: set[int] = set()
    rows: list[TeamWorkCenterLead] = []
    for lead in leads:
        if lead.work_center_id in seen:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "Duplicate work center in leads",
            )
        seen.add(lead.work_center_id)
        wc = db.get(WorkCenter, lead.work_center_id)
        if wc is None or wc.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Work center not found"
            )
        person = db.get(Personnel, lead.personnel_id)
        if person is None or person.workspace_id != workspace.id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "Lead not found"
            )
        rows.append(
            TeamWorkCenterLead(
                work_center_id=lead.work_center_id,
                personnel_id=lead.personnel_id,
            )
        )
    return rows


def _normalize_slug(slug: str | None) -> str | None:
    """Slugs are compact codes — trim and uppercase; empty collapses to null
    so it doesn't collide on the per-workspace unique constraint."""
    if slug is None:
        return None
    slug = slug.strip().upper()
    return slug or None


@router.get("", response_model=list[TeamOut])
def list_teams(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
):
    return (
        db.query(Team)
        .filter(Team.workspace_id == workspace.id)
        .order_by(Team.name)
        .all()
    )


@router.post("", response_model=TeamOut, status_code=status.HTTP_201_CREATED)
def create_team(
    body: TeamIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    data = body.model_dump()
    data["slug"] = _normalize_slug(data.get("slug"))
    leads = data.pop("leads")
    _check_unique(db, workspace, Team.name, data["name"], "name")
    if data["slug"]:
        _check_unique(db, workspace, Team.slug, data["slug"], "slug")
    if data["ncoic_id"] is not None:
        _check_ncoic(db, workspace, data["ncoic_id"])
    team = Team(workspace_id=workspace.id, **data)
    team.leads = _build_leads(db, workspace, body.leads or [])
    db.add(team)
    db.flush()
    notify(background_tasks)
    return team


def _load(db: Session, team_id: int, workspace: Workspace) -> Team:
    team = db.get(Team, team_id)
    if team is None or team.workspace_id != workspace.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Team not found")
    return team


@router.patch("/{team_id}", response_model=TeamOut)
def patch_team(
    team_id: int,
    body: TeamPatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("operator")),
):
    team = _load(db, team_id, workspace)
    data = body.model_dump(exclude_unset=True)
    if "slug" in data:
        data["slug"] = _normalize_slug(data["slug"])
    if "name" in data and data["name"] != team.name:
        _check_unique(db, workspace, Team.name, data["name"], "name", team.id)
    if data.get("slug") and data["slug"] != team.slug:
        _check_unique(db, workspace, Team.slug, data["slug"], "slug", team.id)
    if data.get("ncoic_id") is not None:
        _check_ncoic(db, workspace, data["ncoic_id"])
    leads = data.pop("leads", None)
    for k, v in data.items():
        setattr(team, k, v)
    if leads is not None:
        team.leads = _build_leads(db, workspace, body.leads or [])
    db.flush()
    notify(background_tasks)
    return team


@router.delete("/{team_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_team(
    team_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("admin")),
):
    team = _load(db, team_id, workspace)
    db.delete(team)
    notify(background_tasks)
