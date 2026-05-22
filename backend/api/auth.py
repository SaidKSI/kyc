import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.dashboard_sessions import DashboardSession
from models.database import get_session
from models.users import User
from schemas.auth import LoginRequest, LoginResponse
from services.auth import create_jwt, hash_api_key, verify_jwt, verify_password

router = APIRouter(prefix="/v1/auth", tags=["auth"])

_bearer = HTTPBearer(auto_error=False)

_SESSION_TTL_HOURS = 8


@router.post("/login", response_model=LoginResponse)
async def login(
    data: LoginRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(User).where(
            User.email == data.email,
            User.status == "active",
            User.deleted_at.is_(None),
        )
    )
    user = result.scalar_one_or_none()
    if not user or not verify_password(data.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_jwt(subject=user.id, expires_minutes=_SESSION_TTL_HOURS * 60)

    token_hash = hash_api_key(token)
    session.add(
        DashboardSession(
            id=str(uuid.uuid4()),
            user_id=user.id,
            token_hash=token_hash,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            expires_at=datetime.now(timezone.utc) + timedelta(hours=_SESSION_TTL_HOURS),
        )
    )
    await session.commit()

    return LoginResponse(
        access_token=token,
        user_id=user.id,
        name=user.name,
        role=user.role,
    )


@router.post("/logout", status_code=204)
async def logout(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
):
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")

    try:
        verify_jwt(credentials.credentials)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    token_hash = hash_api_key(credentials.credentials)
    result = await session.execute(
        select(DashboardSession).where(
            DashboardSession.token_hash == token_hash,
            DashboardSession.revoked_at.is_(None),
        )
    )
    dash_session = result.scalar_one_or_none()
    if dash_session:
        dash_session.revoked_at = datetime.now(timezone.utc)
        await session.commit()
