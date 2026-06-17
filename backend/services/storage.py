"""
Storage abstraction — swap STORAGE_BACKEND=local|s3 in .env.
Always use this module; never call boto3 or open() directly in routes/tasks.
"""
import asyncio
from abc import ABC, abstractmethod
from functools import partial
from pathlib import Path

from core.config import settings

ALLOWED_SLOTS = {"doc_front", "doc_back", "selfie"}
ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _ext_for(content_type: str) -> str:
    return {"image/png": "png", "image/webp": "webp"}.get(content_type, "jpg")


class StorageBackend(ABC):
    @abstractmethod
    async def save(
        self,
        verification_id: str,
        slot: str,
        file_bytes: bytes,
        content_type: str = "image/jpeg",
    ) -> str:
        """Persist file, return storage key."""

    @abstractmethod
    def get_url(self, key: str, expires: int = 900) -> str:
        """Return accessible URL (presigned for S3, API path for local)."""

    @abstractmethod
    async def read_bytes(self, key: str) -> bytes:
        """Read raw file bytes — used by ML pipeline workers."""

    @abstractmethod
    async def delete(self, key: str) -> None:
        """Remove file from storage."""


class LocalStorage(StorageBackend):
    def __init__(self, upload_dir: str) -> None:
        self.base = Path(upload_dir)
        self.base.mkdir(parents=True, exist_ok=True)

    async def save(
        self,
        verification_id: str,
        slot: str,
        file_bytes: bytes,
        content_type: str = "image/jpeg",
    ) -> str:
        if slot not in ALLOWED_SLOTS:
            raise ValueError(f"Unknown slot: {slot}")
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ValueError(f"Unsupported content type: {content_type}")

        dest_dir = self.base / verification_id
        dest_dir.mkdir(parents=True, exist_ok=True)

        ext = _ext_for(content_type)
        key = f"{verification_id}/{slot}.{ext}"

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, (self.base / key).write_bytes, file_bytes)
        return key

    def get_url(self, key: str, expires: int = 900) -> str:
        # Served by FastAPI static mount at /uploads (local dev only)
        return f"/uploads/{key}"

    async def read_bytes(self, key: str) -> bytes:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, (self.base / key).read_bytes)

    async def delete(self, key: str) -> None:
        path = self.base / key
        if path.exists():
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, path.unlink)


class S3Storage(StorageBackend):
    def __init__(self) -> None:
        import boto3

        self._client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint or None,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            region_name=settings.s3_region,
        )
        self._bucket = settings.s3_bucket

    def generate_upload_url(
        self,
        verification_id: str,
        slot: str,
        content_type: str = "image/jpeg",
        expires: int = 900,
    ) -> str:
        """Presigned PUT URL for direct browser-to-S3 upload."""
        ext = _ext_for(content_type)
        key = f"{verification_id}/{slot}.{ext}"
        return self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket,
                "Key": key,
                "ContentType": content_type,
                "ServerSideEncryption": "AES256",
            },
            ExpiresIn=expires,
        )

    async def save(
        self,
        verification_id: str,
        slot: str,
        file_bytes: bytes,
        content_type: str = "image/jpeg",
    ) -> str:
        if slot not in ALLOWED_SLOTS:
            raise ValueError(f"Unknown slot: {slot}")
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise ValueError(f"Unsupported content type: {content_type}")

        ext = _ext_for(content_type)
        key = f"{verification_id}/{slot}.{ext}"

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            partial(
                self._client.put_object,
                Bucket=self._bucket,
                Key=key,
                Body=file_bytes,
                ContentType=content_type,
                ServerSideEncryption="AES256",
            ),
        )
        return key

    def get_url(self, key: str, expires: int = 900) -> str:
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=expires,
        )

    async def read_bytes(self, key: str) -> bytes:
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            partial(self._client.get_object, Bucket=self._bucket, Key=key),
        )
        return response["Body"].read()

    async def delete(self, key: str) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            partial(self._client.delete_object, Bucket=self._bucket, Key=key),
        )


def _build_storage() -> StorageBackend:
    if settings.storage_backend == "s3":
        return S3Storage()
    return LocalStorage(settings.upload_dir)


storage: StorageBackend = _build_storage()
