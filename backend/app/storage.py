from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator
from urllib.parse import quote

import httpx


class SupabaseStorage:
    def __init__(self) -> None:
        self.url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        self.service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        self.bucket = os.environ.get("SUPABASE_STORAGE_BUCKET", "eventconnect-cards")
        if not self.url or not self.service_key:
            raise RuntimeError("Supabase private storage is not configured.")

    def _object_url(self, object_path: str) -> str:
        return f"{self.url}/storage/v1/object/{quote(self.bucket, safe='')}/{quote(object_path, safe='/')}"

    def upload(self, object_path: str, content: bytes, content_type: str) -> str:
        try:
            response = httpx.put(
                self._object_url(object_path),
                content=content,
                headers={
                    "Authorization": f"Bearer {self.service_key}",
                    "apikey": self.service_key,
                    "Content-Type": content_type,
                    "x-upsert": "true",
                },
                timeout=30,
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise RuntimeError("Private image upload to Supabase Storage failed.") from error
        return f"supabase://{self.bucket}/{object_path}"

    @contextmanager
    def local_copy(self, storage_uri: str) -> Iterator[str]:
        prefix = f"supabase://{self.bucket}/"
        if not storage_uri.startswith(prefix):
            raise ValueError("Image path does not belong to the configured private bucket.")
        object_path = storage_uri[len(prefix):]
        try:
            response = httpx.get(
                self._object_url(object_path),
                headers={
                    "Authorization": f"Bearer {self.service_key}",
                    "apikey": self.service_key,
                },
                timeout=30,
            )
            response.raise_for_status()
        except httpx.HTTPError as error:
            raise RuntimeError("Private image download from Supabase Storage failed.") from error

        suffix = Path(object_path).suffix
        temporary_path: str | None = None
        try:
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as image:
                temporary_path = image.name
                image.write(response.content)
            yield temporary_path
        finally:
            if temporary_path:
                Path(temporary_path).unlink(missing_ok=True)
