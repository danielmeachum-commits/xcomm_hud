"""Team CRUD — many-to-many overlay across work centers per workspace."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Team, Workspace
from pubsub import notify
from schemas import TeamIn, TeamOut, TeamPatch

router = APIRouter(prefix="/teams", tags=["personnel"])


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
    if (
        db.query(Team)
        .filter(Team.workspace_id == workspace.id, Team.name == body.name)
        .first()
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "Team name already exists")
    team = Team(workspace_id=workspace.id, **body.model_dump())
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
    if "name" in data and data["name"] != team.name:
        clash = (
            db.query(Team)
            .filter(
                Team.workspace_id == workspace.id,
                Team.name == data["name"],
                Team.id != team.id,
            )
            .first()
        )
        if clash:
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Team name already exists"
            )
    for k, v in data.items():
        setattr(team, k, v)
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
