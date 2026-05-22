from datetime import datetime, timezone

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.api_keys import ApiKey
from models.database import get_session
from models.operators import Operator
from models.verification import Verification
from services.auth import hash_api_key, verify_jwt

_bearer = HTTPBearer(auto_error=False)


async def get_operator(
    x_api_key: str = Header(..., alias="X-API-Key"),
    session: AsyncSession = Depends(get_session),
) -> Operator:
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
        select(Operator).where(
            Operator.id == api_key_record.operator_id,
            Operator.status == "active",
            Operator.deleted_at.is_(None),
        )
    )
    operator = result2.scalar_one_or_none()
    if not operator:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Operator not found or suspended")

    # Track last usage — committed by the route handler
    api_key_record.last_used_at = datetime.now(timezone.utc)

    return operator


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


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
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
