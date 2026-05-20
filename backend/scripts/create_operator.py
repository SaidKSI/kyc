"""CLI: create an operator + API key. Run once per operator."""
import argparse
import asyncio
import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from models.database import AsyncSessionLocal, Base, engine
from models.operators import Operator
from services.auth import generate_api_key, hash_api_key


async def main(name: str, webhook_url: str | None, webhook_secret: str | None) -> None:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    raw_key = generate_api_key()
    op = Operator(
        id=str(uuid.uuid4()),
        name=name,
        api_key_hash=hash_api_key(raw_key),
        webhook_url=webhook_url,
        webhook_secret=webhook_secret,
    )
    async with AsyncSessionLocal() as session:
        session.add(op)
        await session.commit()
        await session.refresh(op)

    print(f"\nOperator created")
    print(f"  ID:      {op.id}")
    print(f"  Name:    {op.name}")
    print(f"  API Key: {raw_key}")
    print(f"\n  Save this API key — shown only once.\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Create a KYC operator")
    parser.add_argument("--name", required=True, help="Operator display name")
    parser.add_argument("--webhook-url", default=None)
    parser.add_argument("--webhook-secret", default=None)
    args = parser.parse_args()
    asyncio.run(main(args.name, args.webhook_url, args.webhook_secret))
