"""
Run all seeders in order.
Usage: python seeds/run_seeds.py [seeder_name]
       python seeds/run_seeds.py               # runs all
       python seeds/run_seeds.py operators     # runs only seed_operators
"""
import asyncio
import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

SEEDERS = [
    "seeds.seed_users",
]


async def run_one(module_name: str) -> None:
    mod = importlib.import_module(module_name)
    print(f"\n[{module_name.split('.')[-1]}]")
    await mod.seed()


async def main(target: str | None) -> None:
    if target:
        matches = [s for s in SEEDERS if target in s]
        if not matches:
            print(f"No seeder matching '{target}'. Available: {SEEDERS}")
            sys.exit(1)
        for m in matches:
            await run_one(m)
    else:
        for m in SEEDERS:
            await run_one(m)


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(main(arg))
