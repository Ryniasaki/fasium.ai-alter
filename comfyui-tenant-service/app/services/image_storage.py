"""
Image storage service.

Supports the legacy local `output/` directory and an optional Tencent COS backend.
"""
from __future__ import annotations

import io
import mimetypes
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

import httpx

from ..services.config import get_settings
from ..services.logger import get_image_storage_logger

try:
    from PIL import Image
    from PIL import ImageDraw
    from PIL import ImageOps
except ImportError:  # pragma: no cover - optional dependency
    Image = None
    ImageDraw = None
    ImageOps = None

try:
    import cairosvg
except ImportError:  # pragma: no cover - optional dependency
    cairosvg = None

try:
    from qcloud_cos import CosConfig, CosS3Client
except ImportError:  # pragma: no cover - optional dependency
    CosConfig = None
    CosS3Client = None

logger = get_image_storage_logger()


class ImageStorageService:
    """Store generated and uploaded assets either locally or in Tencent COS."""

    THUMBNAIL_DIR_NAME = "thumbnail"
    THUMBNAIL_SIZE = (512, 512)
    THUMBNAIL_FORMAT = "WEBP"
    THUMBNAIL_QUALITY = 75
    UPLOAD_MAX_LONG_EDGE = 2000

    def __init__(self, base_storage_path: str = "./output"):
        self.settings = get_settings()
        self.base_storage_path = Path(base_storage_path)
        self.base_storage_path.mkdir(parents=True, exist_ok=True)
        self.output_storage_backend = (self.settings.output_storage_backend or "local").strip().lower()
        self._cos_client = None
        logger.info(
            "Image storage initialized. backend=%s, local_path=%s",
            self.output_storage_backend,
            self.base_storage_path.absolute(),
        )

    @property
    def use_cos(self) -> bool:
        return self.output_storage_backend == "cos"

    def _ensure_cos_client(self):
        if not self.use_cos:
            return None
        if self._cos_client is not None:
            return self._cos_client
        if CosConfig is None or CosS3Client is None:
            raise RuntimeError("cos-python-sdk-v5 is required when OUTPUT_STORAGE_BACKEND=cos")
        if not self.settings.output_cos_secret_id or not self.settings.output_cos_secret_key:
            raise RuntimeError("OUTPUT_COS_SECRET_ID and OUTPUT_COS_SECRET_KEY must be configured")
        if not self.settings.output_cos_bucket:
            raise RuntimeError("OUTPUT_COS_BUCKET must be configured")
        config = CosConfig(
            Region=self.settings.output_cos_region,
            SecretId=self.settings.output_cos_secret_id,
            SecretKey=self.settings.output_cos_secret_key,
            Scheme="https",
        )
        self._cos_client = CosS3Client(config)
        return self._cos_client

    def _normalize_subdir(self, subdir: Optional[str]) -> Path:
        if not subdir:
            return Path()
        parts = [part for part in Path(subdir).parts if part not in ("", ".", "..")]
        return Path(*parts) if parts else Path()

    def _relative_path(self, user_id: str, filename: str, *, subdir: Optional[str] = None) -> Path:
        normalized_subdir = self._normalize_subdir(subdir)
        return Path(user_id) / normalized_subdir / filename if normalized_subdir.parts else Path(user_id) / filename

    def _thumbnail_relative_path(self, original_relative_path: Path) -> Path:
        return (
            original_relative_path.parent
            / self.THUMBNAIL_DIR_NAME
            / f"{original_relative_path.stem}.webp"
        )

    def _video_relative_path(self, user_id: str, filename: str) -> Path:
        return Path(user_id) / "video" / filename

    def _cos_prefix(self) -> str:
        return (self.settings.output_cos_prefix or "root/fasium/output").strip().strip("/")

    def _storage_key(self, relative_path: Path) -> str:
        prefix = self._cos_prefix()
        suffix = relative_path.as_posix().lstrip("/")
        return f"{prefix}/{suffix}" if prefix else suffix

    def _public_base_url(self) -> str:
        configured = (self.settings.output_cos_public_base_url or "").strip().rstrip("/")
        if configured:
            return configured
        bucket = self.settings.output_cos_bucket or ""
        region = self.settings.output_cos_region
        return f"https://{bucket}.cos.{region}.myqcloud.com"

    def _public_url(self, storage_key: str) -> str:
        return f"{self._public_base_url()}/{storage_key.lstrip('/')}"

    def _build_result_entry(
        self,
        *,
        original_reference: str,
        thumbnail_reference: Optional[str],
        file_type: str,
        original_key: Optional[str] = None,
        thumbnail_key: Optional[str] = None,
        passthrough: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        result = {
            "original": original_reference,
            "localPath": original_reference,
            "thumbnail": thumbnail_reference,
            "thumbnailPath": thumbnail_reference,
            "fileType": file_type,
            "storedAt": datetime.now().isoformat(),
        }
        if original_key:
            result["storageKey"] = original_key
        if thumbnail_key:
            result["thumbnailStorageKey"] = thumbnail_key
        if passthrough:
            for key in ("fileUrl", "taskCostTime", "nodeId"):
                if key in passthrough:
                    result[key] = passthrough.get(key)
        return result

    def _upload_to_cos(self, *, data: bytes, relative_path: Path, content_type: Optional[str] = None) -> Tuple[str, str]:
        client = self._ensure_cos_client()
        storage_key = self._storage_key(relative_path)
        client.put_object(
            Bucket=self.settings.output_cos_bucket,
            Body=data,
            Key=storage_key,
            EnableMD5=False,
            ContentType=content_type or "application/octet-stream",
        )
        return storage_key, self._public_url(storage_key)

    def _write_local(self, *, data: bytes, relative_path: Path) -> str:
        target = self.base_storage_path / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return str(target)

    def _store_blob(
        self,
        *,
        data: bytes,
        relative_path: Path,
        content_type: Optional[str] = None,
    ) -> Tuple[str, Optional[str]]:
        if self.use_cos:
            key, url = self._upload_to_cos(data=data, relative_path=relative_path, content_type=content_type)
            return url, key
        return self._write_local(data=data, relative_path=relative_path), None

    def _generate_svg_thumbnail_bytes(self, source_bytes: bytes) -> Optional[bytes]:
        if Image is None:
            logger.warning("Pillow is not installed; thumbnails are disabled")
            return None

        rasterized_bytes: Optional[bytes] = None
        if cairosvg is not None:
            try:
                rasterized_bytes = cairosvg.svg2png(
                    bytestring=source_bytes,
                    output_width=self.THUMBNAIL_SIZE[0],
                    output_height=self.THUMBNAIL_SIZE[1],
                )
            except Exception as exc:
                logger.warning("Failed to rasterize SVG thumbnail with cairosvg: %s", exc)

        try:
            if rasterized_bytes:
                with Image.open(io.BytesIO(rasterized_bytes)) as img:
                    img.thumbnail(self.THUMBNAIL_SIZE, getattr(Image, "Resampling", Image).LANCZOS)
                    if img.mode not in ("RGB", "RGBA"):
                        img = img.convert("RGBA")
                    output = io.BytesIO()
                    img.save(
                        output,
                        format=self.THUMBNAIL_FORMAT,
                        quality=self.THUMBNAIL_QUALITY,
                        method=6,
                    )
                    return output.getvalue()

            # Fallback thumbnail so SVG/TXT-backed vectors still have a valid webp preview path.
            canvas = Image.new("RGBA", self.THUMBNAIL_SIZE, (248, 250, 252, 255))
            if ImageDraw is not None:
                draw = ImageDraw.Draw(canvas)
                draw.rounded_rectangle((40, 40, 472, 472), radius=28, outline=(203, 213, 225, 255), width=4, fill=(255, 255, 255, 255))
                draw.rectangle((160, 120, 352, 312), outline=(100, 116, 139, 255), width=6)
                draw.polygon([(352, 120), (312, 120), (352, 160)], fill=(226, 232, 240, 255))
                draw.text((206, 356), "SVG", fill=(71, 85, 105, 255))
            output = io.BytesIO()
            canvas.save(
                output,
                format=self.THUMBNAIL_FORMAT,
                quality=self.THUMBNAIL_QUALITY,
                method=6,
            )
            return output.getvalue()
        except Exception as exc:
            logger.error("Failed to generate SVG thumbnail: %s", exc)
            return None

    def _generate_thumbnail_bytes(self, source_bytes: bytes, file_type: Optional[str] = None) -> Optional[bytes]:
        if Image is None:
            logger.warning("Pillow is not installed; thumbnails are disabled")
            return None
        normalized_type = (file_type or "").lower()
        if normalized_type == "svg" or self._looks_like_svg(source_bytes.decode("utf-8", errors="ignore")):
            return self._generate_svg_thumbnail_bytes(source_bytes)
        try:
            with Image.open(io.BytesIO(source_bytes)) as img:
                img.thumbnail(self.THUMBNAIL_SIZE, getattr(Image, "Resampling", Image).LANCZOS)
                if img.mode not in ("RGB", "RGBA"):
                    img = img.convert("RGBA")
                output = io.BytesIO()
                img.save(
                    output,
                    format=self.THUMBNAIL_FORMAT,
                    quality=self.THUMBNAIL_QUALITY,
                    method=6,
                )
                return output.getvalue()
        except Exception as exc:
            logger.error("Failed to generate thumbnail: %s", exc)
            return None

    def _resize_uploaded_image_bytes(
        self,
        source_bytes: bytes,
        extension: str,
    ) -> bytes:
        if Image is None or ImageOps is None:
            logger.warning("Pillow is not installed; uploaded image resizing is disabled")
            return source_bytes

        normalized_extension = (extension or "").lower()
        if normalized_extension == "svg":
            return source_bytes

        try:
            with Image.open(io.BytesIO(source_bytes)) as img:
                img = ImageOps.exif_transpose(img)
                width, height = img.size
                long_edge = max(width, height)
                if long_edge <= self.UPLOAD_MAX_LONG_EDGE:
                    return source_bytes

                scale = self.UPLOAD_MAX_LONG_EDGE / long_edge
                target_size = (
                    max(1, round(width * scale)),
                    max(1, round(height * scale)),
                )
                resized = img.resize(
                    target_size,
                    getattr(Image, "Resampling", Image).LANCZOS,
                )

                output = io.BytesIO()
                save_format = (img.format or normalized_extension or "PNG").upper()
                if save_format == "JPG":
                    save_format = "JPEG"
                if save_format == "JPEG" and resized.mode not in ("RGB", "L"):
                    resized = resized.convert("RGB")

                save_kwargs: Dict[str, Any] = {"format": save_format}
                if save_format in ("JPEG", "WEBP"):
                    save_kwargs.update({"quality": 95, "optimize": True})
                elif save_format == "PNG":
                    save_kwargs["optimize"] = True

                resized.save(output, **save_kwargs)
                logger.info(
                    "Resized uploaded image from %sx%s to %sx%s",
                    width,
                    height,
                    target_size[0],
                    target_size[1],
                )
                return output.getvalue()
        except Exception as exc:
            logger.warning("Failed to resize uploaded image; storing original bytes: %s", exc)
            return source_bytes

    def _store_image_bytes(
        self,
        *,
        user_id: str,
        image_bytes: bytes,
        extension: str,
        content_type: Optional[str],
        subdir: Optional[str] = None,
        passthrough: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{uuid.uuid4().hex[:6]}.{extension}"
        relative_path = self._relative_path(user_id, filename, subdir=subdir)
        original_reference, original_key = self._store_blob(
            data=image_bytes,
            relative_path=relative_path,
            content_type=content_type or mimetypes.guess_type(filename)[0] or "image/png",
        )

        thumbnail_reference = None
        thumbnail_key = None
        thumbnail_bytes = self._generate_thumbnail_bytes(image_bytes, extension)
        if thumbnail_bytes:
            thumb_relative = self._thumbnail_relative_path(relative_path)
            thumbnail_reference, thumbnail_key = self._store_blob(
                data=thumbnail_bytes,
                relative_path=thumb_relative,
                content_type="image/webp",
            )

        return self._build_result_entry(
            original_reference=original_reference,
            thumbnail_reference=thumbnail_reference,
            file_type=extension,
            original_key=original_key,
            thumbnail_key=thumbnail_key,
            passthrough=passthrough,
        )

    def _store_binary_bytes(
        self,
        *,
        user_id: str,
        payload: bytes,
        extension: str,
        content_type: Optional[str],
        subdir: Optional[str] = None,
        passthrough: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{uuid.uuid4().hex[:6]}.{extension}"
        relative_path = self._relative_path(user_id, filename, subdir=subdir)
        original_reference, original_key = self._store_blob(
            data=payload,
            relative_path=relative_path,
            content_type=content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream",
        )
        thumbnail_reference = None
        thumbnail_key = None
        thumbnail_bytes = self._generate_thumbnail_bytes(payload, extension)
        if thumbnail_bytes:
            thumb_relative = self._thumbnail_relative_path(relative_path)
            thumbnail_reference, thumbnail_key = self._store_blob(
                data=thumbnail_bytes,
                relative_path=thumb_relative,
                content_type="image/webp",
            )
        return self._build_result_entry(
            original_reference=original_reference,
            thumbnail_reference=thumbnail_reference,
            file_type=extension,
            original_key=original_key,
            thumbnail_key=thumbnail_key,
            passthrough=passthrough,
        )

    def _store_video_bytes(
        self,
        *,
        user_id: str,
        payload: bytes,
        extension: str,
        content_type: Optional[str],
        passthrough: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{uuid.uuid4().hex[:6]}.{extension}"
        relative_path = self._video_relative_path(user_id, filename)
        original_reference, original_key = self._store_blob(
            data=payload,
            relative_path=relative_path,
            content_type=content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream",
        )
        return self._build_result_entry(
            original_reference=original_reference,
            thumbnail_reference=None,
            file_type=extension,
            original_key=original_key,
            passthrough=passthrough,
        )

    async def _download_bytes(self, url: str, *, timeout: float = 30.0) -> Tuple[bytes, Optional[str]]:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(url)
            response.raise_for_status()
            return response.content, response.headers.get("content-type")

    async def download_and_store_images(
        self,
        user_id: str,
        outputs: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Download task outputs and store them under local output/ or COS.
        """
        image_types = {"png", "jpg", "jpeg", "gif", "webp"}
        video_types = {"mp4", "mov", "webm", "avi", "mkv", "mpeg", "mpg"}
        text_types = {"txt"}
        vector_types = {"svg"}

        stored_outputs: List[Dict[str, Any]] = []

        for output in outputs:
            try:
                file_url = output.get("fileUrl")
                file_type = (output.get("fileType") or "").lower()
                if not file_type and file_url:
                    parsed = urlparse(file_url)
                    file_type = Path(parsed.path).suffix.lstrip(".").lower()

                if not file_url:
                    stored_outputs.append(output)
                    continue

                if file_type in image_types:
                    data, content_type = await self._download_bytes(file_url, timeout=30.0)
                    stored_outputs.append(
                        self._store_image_bytes(
                            user_id=user_id,
                            image_bytes=data,
                            extension=file_type or "png",
                            content_type=content_type,
                            passthrough=output,
                        )
                    )
                elif file_type in video_types:
                    data, content_type = await self._download_bytes(file_url, timeout=60.0)
                    stored_outputs.append(
                        self._store_video_bytes(
                            user_id=user_id,
                            payload=data,
                            extension=file_type or "mp4",
                            content_type=content_type,
                            passthrough=output,
                        )
                    )
                elif file_type in text_types or file_type in vector_types:
                    data, content_type = await self._download_bytes(file_url, timeout=30.0)
                    final_type = "svg" if self._looks_like_svg(data.decode("utf-8", errors="ignore")) else (file_type or "txt")
                    stored_outputs.append(
                        self._store_binary_bytes(
                            user_id=user_id,
                            payload=data,
                            extension=final_type,
                            content_type=content_type or ("image/svg+xml" if final_type == "svg" else "text/plain"),
                            passthrough=output,
                        )
                    )
                else:
                    stored_outputs.append(output)
            except Exception as exc:
                logger.error("Failed to process output asset: %s", exc)
                stored_outputs.append(output)

        return stored_outputs

    def store_uploaded_image(
        self,
        user_id: str,
        file_bytes: bytes,
        original_filename: Optional[str] = None,
        content_type: Optional[str] = None,
        subdir: Optional[str] = None,
    ) -> Dict[str, Optional[str]]:
        """
        Store an uploaded image in local output/ or COS and create a thumbnail.
        """
        allowed_types = {"png", "jpg", "jpeg", "gif", "webp"}

        suffix = ""
        if original_filename:
            suffix = Path(original_filename).suffix.lower()
        if not suffix and content_type and "/" in content_type:
            suffix = f".{content_type.split('/')[-1].lower()}"
        if not suffix:
            suffix = ".png"

        extension = suffix.lstrip(".")
        if extension not in allowed_types:
            raise ValueError(f"Only image uploads are supported: {', '.join(sorted(allowed_types))}")

        file_bytes = self._resize_uploaded_image_bytes(file_bytes, extension)

        return self._store_image_bytes(
            user_id=user_id,
            image_bytes=file_bytes,
            extension=extension,
            content_type=content_type or mimetypes.guess_type(f"file.{extension}")[0] or "image/png",
            subdir=subdir,
        )

    def store_uploaded_video(
        self,
        user_id: str,
        file_bytes: bytes,
        original_filename: Optional[str] = None,
        content_type: Optional[str] = None,
        subdir: Optional[str] = None,
    ) -> Dict[str, Optional[str]]:
        """
        Store an uploaded video in local output/ or COS.
        """
        allowed_types = {"mp4", "mov", "webm", "avi", "mkv", "mpeg", "mpg"}

        suffix = ""
        if original_filename:
            suffix = Path(original_filename).suffix.lower()
        if not suffix and content_type and "/" in content_type:
            suffix = f".{content_type.split('/')[-1].lower()}"
        if not suffix:
            suffix = ".mp4"

        extension = suffix.lstrip(".")
        if extension not in allowed_types:
            raise ValueError(f"Only video uploads are supported: {', '.join(sorted(allowed_types))}")

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{timestamp}_{uuid.uuid4().hex[:6]}.{extension}"
        if subdir:
            relative_path = self._relative_path(user_id, filename, subdir=subdir)
        else:
            relative_path = self._video_relative_path(user_id, filename)

        original_reference, original_key = self._store_blob(
            data=file_bytes,
            relative_path=relative_path,
            content_type=content_type or mimetypes.guess_type(filename)[0] or "video/mp4",
        )
        return self._build_result_entry(
            original_reference=original_reference,
            thumbnail_reference=None,
            file_type=extension,
            original_key=original_key,
        )

    def _looks_like_svg(self, content: str) -> bool:
        snippet = content.lstrip()[:500].lower()
        if not snippet:
            return False
        if snippet.startswith("<svg") or snippet.startswith("<?xml"):
            return True
        return "<svg" in snippet

    def sync_all_thumbnails(self):
        """
        Sync thumbnails for the local backend.
        """
        if self.use_cos:
            logger.info("Skipping local thumbnail sync because OUTPUT_STORAGE_BACKEND=cos")
            return
        for user_dir in self.base_storage_path.iterdir():
            if not user_dir.is_dir():
                continue
            if user_dir.name == self.THUMBNAIL_DIR_NAME:
                continue
            self._sync_user_thumbnails(user_dir)

    def _sync_user_thumbnails(self, user_dir: Path):
        if self.use_cos:
            return
        if Image is None:
            logger.warning("Pillow is not installed; skipping thumbnail sync")
            return

        for root, dirs, _ in os.walk(user_dir):
            current_dir = Path(root)
            if current_dir.name == self.THUMBNAIL_DIR_NAME:
                continue
            if self.THUMBNAIL_DIR_NAME in dirs:
                dirs.remove(self.THUMBNAIL_DIR_NAME)

            thumbnail_dir = current_dir / self.THUMBNAIL_DIR_NAME
            thumbnail_dir.mkdir(parents=True, exist_ok=True)

            originals = {
                file.stem: file
                for file in current_dir.iterdir()
                if file.is_file()
            }
            thumbnails = {
                file.name: file
                for file in thumbnail_dir.iterdir()
                if file.is_file()
            }

            for stem, original_path in originals.items():
                expected_name = f"{stem}.webp"
                if expected_name not in thumbnails:
                    try:
                        thumb_bytes = self._generate_thumbnail_bytes(original_path.read_bytes())
                        if thumb_bytes:
                            (thumbnail_dir / expected_name).write_bytes(thumb_bytes)
                    except Exception as exc:
                        logger.error("Failed to sync thumbnail %s: %s", original_path, exc)

            expected_names = {f"{stem}.webp" for stem in originals.keys()}
            for name, thumb_path in thumbnails.items():
                if name not in expected_names:
                    try:
                        thumb_path.unlink(missing_ok=True)
                        logger.info("Deleted stale thumbnail: %s", thumb_path)
                    except Exception as exc:
                        logger.error("Failed to delete thumbnail %s: %s", thumb_path, exc)

    def get_image_url(self, local_path: str, base_url: str = "http://localhost:8081") -> str:
        if local_path.startswith(("http://", "https://")):
            return local_path
        relative_path = Path(local_path).relative_to(self.base_storage_path)
        return f"{base_url}/static/images/{relative_path}"

    def delete_entry(self, entry: Dict[str, Any]) -> None:
        if not isinstance(entry, dict):
            return
        original_key = entry.get("storageKey")
        thumbnail_key = entry.get("thumbnailStorageKey")
        if self.use_cos and original_key:
            client = self._ensure_cos_client()
            client.delete_object(Bucket=self.settings.output_cos_bucket, Key=original_key)
            if thumbnail_key:
                client.delete_object(Bucket=self.settings.output_cos_bucket, Key=thumbnail_key)
            return

        for key in ("original", "localPath", "thumbnail", "thumbnailPath"):
            value = entry.get(key)
            if not value or str(value).startswith(("http://", "https://")):
                continue
            try:
                path = Path(str(value))
                if path.exists() and path.is_file():
                    path.unlink(missing_ok=True)
            except Exception as exc:
                logger.warning("Failed to delete local storage entry %s: %s", value, exc)


# Global instance
image_storage_service = ImageStorageService()
