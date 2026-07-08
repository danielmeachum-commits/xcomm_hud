"""Rules CRUD + registry metadata + execution log.

Rules are the user-editable reactive layer: "when <trigger> [if
<conditions>] then <actions>". Global rows (workspace_id NULL, is_builtin)
are the seeded system behavior — admins may retune them (e.g. promote
service validations onto the timeline) but not delete them; workspace
rows are operator-editable. `/rules/meta` describes the code registries
(triggers, their payload fields, enrichers, actions) so the wizard can
build condition/action forms without hardcoding.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from db import get_db
from deps import get_current_workspace, requires
from models import Rule, RuleExecution, User, Workspace
from pubsub import notify
from rules_engine import (
    ACTION_DEFS,
    ENRICHERS,
    TRIGGERS,
    apply_computed,
    evaluate_condition,
    rules_meta,
)
from schemas import (
    RuleExecutionOut,
    RuleIn,
    RuleOut,
    RulePatch,
    RuleTestIn,
    RuleTestOut,
)

router = APIRouter(prefix="/rules", tags=["rules"])


def _validate_refs(body: RuleIn | RulePatch) -> None:
    trigger = getattr(body, "trigger", None)
    if trigger is not None and trigger not in TRIGGERS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown trigger '{trigger}'"
        )
    if body.enrichers:
        for name in body.enrichers:
            if name not in ENRICHERS:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Unknown enricher '{name}'",
                )
    if body.actions:
        for step in body.actions:
            if step.action not in ACTION_DEFS:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY,
                    f"Unknown action '{step.action}'",
                )


@router.get("/meta")
def get_meta(_=Depends(requires("viewer"))) -> dict:
    return rules_meta()


@router.post("/test", response_model=RuleTestOut)
def test_rule(
    body: RuleTestIn,
    _=Depends(requires("viewer")),
):
    """Dry-run computed fields + conditions against a sample payload.

    Shows every intermediate value so a rule that silently doesn't match
    can be debugged from the wizard instead of the database. Enrichers
    aren't executed — their fields are just more sample inputs.
    """
    ctx = dict(body.sample)
    computed = [c.model_dump() for c in body.computed]
    apply_computed(computed, ctx)
    matched = evaluate_condition(body.conditions, ctx)
    return RuleTestOut(
        computed_values={c["name"]: ctx.get(c["name"]) for c in computed},
        matched=matched,
    )


@router.get("", response_model=list[RuleOut])
def list_rules(
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
    trigger: str | None = Query(default=None),
):
    q = db.query(Rule).filter(
        (Rule.workspace_id == workspace.id) | (Rule.workspace_id.is_(None))
    )
    if trigger:
        q = q.filter(Rule.trigger == trigger)
    return q.order_by(Rule.is_builtin.desc(), Rule.priority, Rule.id).all()


@router.post("", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(
    body: RuleIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    _validate_refs(body)
    row = Rule(
        workspace_id=workspace.id,
        created_by_user_id=current_user.id,
        **body.model_dump(),
    )
    # Custom rules are always non-blocking: a user rule failure must never
    # abort the underlying mutation. Only seeded record-keeping rules abort.
    row.on_error = "skip"
    db.add(row)
    db.flush()
    notify(background_tasks)
    return row


def _load_editable(
    db: Session, rule_id: int, workspace: Workspace, current_user: User
) -> Rule:
    """Workspace rules are operator-editable; builtin rules admin-only."""
    row = db.get(Rule, rule_id)
    if row is None or (
        row.workspace_id is not None and row.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rule not found")
    if row.workspace_id is None and current_user.role != "admin":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can modify built-in rules"
        )
    return row


@router.patch("/{rule_id}", response_model=RuleOut)
def patch_rule(
    rule_id: int,
    body: RulePatch,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_editable(db, rule_id, workspace, current_user)
    _validate_refs(body)
    data = body.model_dump(exclude_unset=True)
    clear_conditions = data.pop("conditions_clear", False)
    if row.is_builtin:
        # Builtin rules keep their trigger — it's what makes them "the
        # record-service-validations rule". Everything else is tunable.
        data.pop("trigger", None)
    if "actions" in data and data["actions"] is not None:
        data["actions"] = [
            step if isinstance(step, dict) else step.model_dump()
            for step in data["actions"]
        ]
    for k, v in data.items():
        setattr(row, k, v)
    if clear_conditions:
        row.conditions = None
    db.flush()
    notify(background_tasks)
    return row


@router.delete("/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    current_user: User = Depends(requires("operator")),
):
    row = _load_editable(db, rule_id, workspace, current_user)
    if row.is_builtin:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Built-in rules can't be deleted — disable them instead",
        )
    db.delete(row)
    db.flush()
    notify(background_tasks)


@router.get("/{rule_id}/executions", response_model=list[RuleExecutionOut])
def list_executions(
    rule_id: int,
    db: Session = Depends(get_db),
    workspace: Workspace = Depends(get_current_workspace),
    _=Depends(requires("viewer")),
    limit: int = Query(default=20, ge=1, le=200),
):
    rule = db.get(Rule, rule_id)
    if rule is None or (
        rule.workspace_id is not None and rule.workspace_id != workspace.id
    ):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Rule not found")
    q = db.query(RuleExecution).filter(RuleExecution.rule_id == rule_id)
    # Builtin rules fire across workspaces — scope the log to the caller's.
    if rule.workspace_id is None:
        q = q.filter(
            (RuleExecution.workspace_id == workspace.id)
            | (RuleExecution.workspace_id.is_(None))
        )
    return q.order_by(RuleExecution.fired_at.desc()).limit(limit).all()
