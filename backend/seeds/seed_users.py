"""
Seed user accounts for development.
Safe to re-run — skips existing emails.
"""

import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.api_keys import ApiKey
from models.database import AsyncSessionLocal
from models.user_settings import UserSettings
from models.users import User
from services.auth import generate_api_key, hash_api_key, hash_password
from sqlalchemy import select

USERS = [
    {
        "name": "Dev User",
        "email": "caarent@kyc.com",
        "password": "password123",
        "role": "user",
        "plan": "pro",
        "webhook_url": None,
        "webhook_secret": None,
        "api_key_name": "Default",
        "environment": "sandbox",
    },
    {
        "name": "Admin",
        "email": "admin@kyc.com",
        "password": "password123",
        "role": "admin",
        "plan": "enterprise",
        "webhook_url": None,
        "webhook_secret": None,
        "api_key_name": "Admin Key",
        "environment": "production",
    },
]


async def seed() -> None:
    async with AsyncSessionLocal() as session:
        for data in USERS:
            result = await session.execute(
                select(User).where(User.email == data["email"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                print(f"  skip  {data['email']} (already exists)")
                continue

            user_id = str(uuid.uuid4())
            user = User(
                id=user_id,
                name=data["name"],
                email=data["email"],
                password_hash=hash_password(data["password"]),
                role=data["role"],
                plan=data["plan"],
                status="active",
                webhook_url=data["webhook_url"],
                webhook_secret=data["webhook_secret"],
            )
            session.add(user)
            await session.flush()

            session.add(UserSettings(user_id=user_id))
            await session.flush()

            raw_key = generate_api_key()
            session.add(
                ApiKey(
                    id=str(uuid.uuid4()),
                    user_id=user_id,
                    name=data["api_key_name"],
                    key_hash=hash_api_key(raw_key),
                    environment=data["environment"],
                )
            )
            await session.commit()

            print(f"  created {data['email']} (role={data['role']})")
            print(f"    API Key : {raw_key}")
            print(f"    Password: {data['password']}")


if __name__ == "__main__":
    print("Seeding users...")
    asyncio.run(seed())
    print("Done.")
