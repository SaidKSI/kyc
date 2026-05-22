from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.api_keys import ApiKey
from models.database import get_session
from models.users import User
from models.verification import Verification
from services.auth import hash_api_key, verify_jwt

_bearer = HTTPBearer(auto_error=False)


async def get_user(
    x_api_key: str = Header(..., alias="X-API-Key"),
    session: AsyncSession = Depends(get_session),
) -> User:
    """API key authentication — returns the owning User."""
    key_hash = hash_api_key(x_api_key)
    result = await session.execute(
        select(ApiKey)
        .where(ApiKey.key_hash == key_hash, ApiKey.revoked_at.is_(None))
    )
    api_key_record = result.scalar_one_or_none()
    if not api_key_record:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid API key")
    if api_key_record.expires_at and api_key_record.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="API key expired")

    result2 = await session.execute(
        select(User).where(
            User.id == api_key_record.user_id,
            User.status == "active",
            User.deleted_at.is_(None),
        )
    )
    user = result2.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or suspended")

    api_key_record.last_used_at = datetime.now(timezone.utc)
    return user


async def get_verification_by_token(
    token: str,
    session: AsyncSession = Depends(get_session),
) -> Verification:
    result = await session.execute(
        select(Verification).where(Verification.session_token == token)
    )
    ver = result.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Session not found")
    if ver.session_expires_at and ver.session_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Session expired")
    return ver


async def get_jwt_payload(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """JWT authentication — returns raw token payload dict."""
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required",
        )
    try:
        return verify_jwt(credentials.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
        ) from exc


async def get_current_user(
    payload: dict = Depends(get_jwt_payload),
    session: AsyncSession = Depends(get_session),
) -> User:
    """JWT authentication — returns full User model from DB."""
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    result = await session.execute(
        select(User).where(
            User.id == user_id,
            User.status == "active",
            User.deleted_at.is_(None),
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or suspended")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    """Require role == 'admin'. Use as a dependency on admin routes."""
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user
