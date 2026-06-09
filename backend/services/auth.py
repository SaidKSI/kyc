import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt as _bcrypt
from jose import JWTError, jwt

from core.config import settings


def hash_api_key(raw_key: str) -> str:
    return hmac.HMAC(
        settings.api_key_salt.encode(),
        raw_key.encode(),
        hashlib.sha256,
    ).hexdigest()


def verify_api_key(raw_key: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_api_key(raw_key), stored_hash)


def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return _bcrypt.checkpw(plain.encode(), hashed.encode())


def generate_api_key() -> str:
    return f"kyc_{secrets.token_urlsafe(32)}"


def create_jwt(subject: str, expires_minutes: int = 480) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(minutes=expires_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def verify_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError as exc:
        raise ValueError(f"Invalid token: {exc}") from exc
