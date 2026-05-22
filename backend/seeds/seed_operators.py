"""
Seed operator accounts for development.
Safe to re-run — skips existing emails.
"""
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select

from models.api_keys import ApiKey
from models.database import AsyncSessionLocal
from models.operator_settings import OperatorSettings
from models.operators import Operator
from services.auth import generate_api_key, hash_api_key, hash_password

OPERATORS = [
    {
        "name": "Dev Operator",
        "email": "dev@kyc.local",
        "password": "devpassword123",
        "plan": "pro",
        "webhook_url": None,
        "webhook_secret": None,
        "api_key_name": "Default",
        "environment": "sandbox",
    },
]


async def seed() -> None:
    async with AsyncSessionLocal() as session:
        for data in OPERATORS:
            result = await session.execute(
                select(Operator).where(Operator.email == data["email"])
            )
            existing = result.scalar_one_or_none()
            if existing:
                print(f"  skip  {data['email']} (already exists)")
                continue

            op_id = str(uuid.uuid4())
            op = Operator(
                id=op_id,
                name=data["name"],
                email=data["email"],
                password_hash=hash_password(data["password"]),
                plan=data["plan"],
                status="active",
                webhook_url=data["webhook_url"],
                webhook_secret=data["webhook_secret"],
            )
            session.add(op)
            await session.flush()

            # Default settings row
            session.add(OperatorSettings(operator_id=op_id))
            await session.flush()

            # Initial API key
            raw_key = generate_api_key()
            session.add(
                ApiKey(
                    id=str(uuid.uuid4()),
                    operator_id=op_id,
                    name=data["api_key_name"],
                    key_hash=hash_api_key(raw_key),
                    environment=data["environment"],
                )
            )
            await session.commit()

            print(f"  created {data['email']}")
            print(f"    API Key : {raw_key}")
            print(f"    Password: {data['password']}")


if __name__ == "__main__":
    print("Seeding operators...")
    asyncio.run(seed())
    print("Done.")
