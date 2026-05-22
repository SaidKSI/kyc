"""CLI: create a user account + initial API key."""
import argparse
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.api_keys import ApiKey
from models.database import AsyncSessionLocal, Base, engine
from models.users import User
from services.auth import generate_api_key, hash_api_key, hash_password


async def main(name: str, email: str, password: str, role: str, webhook_url: str | None, webhook_secret: str | None) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    raw_key = generate_api_key()
    user = User(
        id=str(uuid.uuid4()),
        name=name,
        email=email,
        password_hash=hash_password(password),
        role=role,
        plan="free",
        status="active",
        webhook_url=webhook_url,
        webhook_secret=webhook_secret,
    )
    api_key = ApiKey(
        id=str(uuid.uuid4()),
        user_id=user.id,
        name="Default",
        key_hash=hash_api_key(raw_key),
        environment="production",
    )

    async with AsyncSessionLocal() as session:
        session.add(user)
        await session.flush()
        session.add(api_key)
        await session.commit()

    print(f"\nUser created")
    print(f"  ID:      {user.id}")
    print(f"  Name:    {user.name}")
    print(f"  Email:   {user.email}")
    print(f"  Role:    {user.role}")
    print(f"  API Key: {raw_key}")
    print(f"\n  Save this API key — shown only once.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a KYC user account")
    parser.add_argument("--name", required=True, help="Display name")
    parser.add_argument("--email", required=True, help="Login email")
    parser.add_argument("--password", required=True, help="Login password")
    parser.add_argument("--role", default="user", choices=["user", "admin"])
    parser.add_argument("--webhook-url", default=None)
    parser.add_argument("--webhook-secret", default=None)
    args = parser.parse_args()
    asyncio.run(main(args.name, args.email, args.password, args.role, args.webhook_url, args.webhook_secret))
