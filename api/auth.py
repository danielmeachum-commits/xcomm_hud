"""Session cookie auth using itsdangerous + argon2-cffi."""

from __future__ import annotations

import os
import time
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from fastapi import Cookie, HTTPException, status

from db import SessionLocal
from models import User

ph = PasswordHasher()

COOKIE_NAME = "xcomm_hud_session"
COOKIE_MAX_AGE = 12 * 3600  # 12 hours in seconds
SALT = "xcomm-hud-session"


def _get_secret_key() -> str:
    raw = os.environ.get("XCOMM_HUD_SECRET_KEY", "")
    if not raw:
        raise RuntimeError("XCOMM_HUD_SECRET_KEY is not set")
    return raw


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_get_secret_key(), salt=SALT)


def create_session_cookie(user_id: int) -> str:
    s = _serializer()
    payload = {"user_id": user_id, "issued_at": int(time.time())}
    return s.dumps(payload)


def decode_session_cookie(token: str) -> Optional[dict]:
    s = _serializer()
    try:
        return s.loads(token, max_age=COOKIE_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None


def hash_password(password: str) -> str:
    return ph.hash(password)


def verify_password(hash_: str, password: str) -> bool:
    try:
        ph.verify(hash_, password)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def authenticate_user(db, username: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.username == username).first()
    if not user:
        return None
    if not verify_password(user.password_hash, password):
        return None
    if user.disabled_at is not None:
        return None
    return user


def get_current_user(
    xcomm_hud_session: Optional[str] = Cookie(default=None, alias=COOKIE_NAME),
):
    if not xcomm_hud_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    payload = decode_session_cookie(xcomm_hud_session)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid",
        )
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.id == payload["user_id"]).first()
        if user is None or user.disabled_at is not None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or disabled",
            )
        return user
    finally:
        db.close()
