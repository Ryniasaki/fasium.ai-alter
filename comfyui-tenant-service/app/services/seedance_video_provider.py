from __future__ import annotations

import base64
import mimetypes
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx

from .config import get_settings
from .image_storage import image_storage_service

try:
    from PIL import Image
except ImportError:  # pragma: no cover - optional dependency
    Image = None


class SeedanceVideoProviderError(RuntimeError):
    """Raised when Seedance video generation fails."""


class SeedanceVideoProvider:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.api_key = (self.settings.seedance_api_key or "").strip()
        if not self.api_key:
            raise SeedanceVideoProviderError("SEEDANCE_API_KEY must be configured")
        self.base_url = (self.settings.seedance_api_base_url or "").strip().rstrip("/")
        if not self.base_url:
            raise SeedanceVideoProviderError("SEEDANCE_API_BASE_URL must be configured")
        self.model_id = (self.settings.seedance_model_id or "doubao-seedance-2-0-260128").strip()
        if not self.model_id:
            raise SeedanceVideoProviderError("SEEDANCE_MODEL_ID must be configured")

    @staticmethod
    def _to_data_url(file_bytes: bytes, mime_type: str, filename: str = "reference.png") -> str:
        content_type = (mime_type or "").strip().lower()
        if not content_type or "/" not in content_type:
            guessed = mimetypes.guess_type(filename)[0] or "image/png"
            content_type = guessed
        return f"data:{content_type};base64,{base64.b64encode(file_bytes).decode('utf-8')}"

    @staticmethod
    def _infer_ratio(file_bytes: bytes, fallback: str = "16:9") -> str:
        if Image is None:
            return fallback
        try:
            with Image.open(BytesIO(file_bytes)) as image:
                width, height = image.size
            if not width or not height:
                return fallback
            aspect = width / height
            if aspect >= 1.35:
                return "16:9"
            if aspect <= 0.75:
                return "9:16"
            return "1:1"
        except Exception:
            return fallback

    @staticmethod
    def _normalize_resolution(resolution: Optional[str]) -> Optional[str]:
        value = str(resolution or "").strip()
        if not value:
            return None
        normalized = value.lower()
        if normalized in {"720p", "1080p", "480p"}:
            return normalized
        return value

    @staticmethod
    def _normalize_input_image(file_bytes: bytes, mime_type: str) -> Tuple[bytes, str]:
        normalized_mime = (mime_type or "").strip().lower()
        if Image is None:
            if normalized_mime.startswith("image/"):
                return file_bytes, normalized_mime
            return file_bytes, "image/png"

        try:
            with Image.open(BytesIO(file_bytes)) as image:
                source = image.convert("RGBA") if image.mode in {"RGBA", "LA", "P"} else image.convert("RGB")
                output = BytesIO()
                if source.mode == "RGBA":
                    background = Image.new("RGB", source.size, (255, 255, 255))
                    background.paste(source, mask=source.getchannel("A"))
                    background.save(output, format="PNG", optimize=True)
                else:
                    source.save(output, format="PNG", optimize=True)
                return output.getvalue(), "image/png"
        except Exception:
            if normalized_mime.startswith("image/"):
                return file_bytes, normalized_mime
            return file_bytes, "image/png"

    async def _request_json(self, method: str, path: str, *, json_body: Dict[str, Any] | None = None) -> Dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
            response = await client.request(
                method,
                f"{self.base_url}{path}",
                headers=headers,
                json=json_body,
            )
        try:
            payload = response.json()
        except Exception:
            payload = {"detail": response.text}
        if response.status_code >= 400:
            if isinstance(payload, dict):
                error = payload.get("error")
                if isinstance(error, dict):
                    message = error.get("message") or error.get("Message") or response.text or "Seedance request failed"
                    code = error.get("code") or error.get("Code")
                    raise SeedanceVideoProviderError(f"{code}: {message}" if code else str(message))
                detail = payload.get("detail") or payload.get("message") or response.text or "Seedance request failed"
                raise SeedanceVideoProviderError(str(detail))
            raise SeedanceVideoProviderError(response.text or "Seedance request failed")
        if not isinstance(payload, dict):
            raise SeedanceVideoProviderError("Seedance response is invalid")
        return payload

    async def create_video_task(
        self,
        *,
        prompt: str,
        duration: Optional[float] = None,
        resolution: Optional[str] = None,
        input_images: Tuple[Tuple[str, bytes, str], ...],
        mode: Optional[str] = None,
        aspect_ratio: Optional[str] = None,
    ) -> Dict[str, Any]:
        mode_value = (mode or "reference").strip().lower().replace("_", "-")
        if mode_value != "reference":
            raise SeedanceVideoProviderError("Seedance 2.0 currently supports reference mode only")
        if not input_images:
            raise SeedanceVideoProviderError("At least one input image is required")

        content: list[Dict[str, Any]] = [
            {
                "type": "text",
                "text": prompt.strip(),
            }
        ]
        for filename, file_bytes, mime_type in input_images:
            normalized_bytes, normalized_mime = self._normalize_input_image(file_bytes, mime_type)
            content.append(
                {
                    "type": "image_url",
                    "image_url": {
                        "url": self._to_data_url(normalized_bytes, normalized_mime, filename),
                    },
                    "role": "reference_image",
                }
            )

        ratio_value = (aspect_ratio or "").strip()
        if not ratio_value or ratio_value == "auto":
            ratio_value = self._infer_ratio(input_images[0][1])

        resolution_value = self._normalize_resolution(resolution)

        payload: Dict[str, Any] = {
            "model": self.model_id,
            "content": content,
            "generate_audio": False,
            "watermark": True,
            "duration": int(duration or 5),
        }
        if ratio_value:
            payload["ratio"] = ratio_value
        if resolution_value:
            payload["resolution"] = resolution_value

        response = await self._request_json("POST", "/contents/generations/tasks", json_body=payload)
        task_id = str(
            response.get("id")
            or response.get("task_id")
            or response.get("taskId")
            or (response.get("data") or {}).get("id")
            or (response.get("data") or {}).get("task_id")
            or ""
        ).strip()
        if not task_id:
            raise SeedanceVideoProviderError("Seedance create task returned no task id")

        return {
            "task_id": task_id,
            "model": "Seedance 2.0",
            "model_id": self.model_id,
            "billing_model": f"ark:{self.model_id}",
            "mode": mode_value,
            "aspect_ratio": ratio_value or "auto",
            "resolution": resolution_value or "720p",
            "input_image_count": len(input_images),
            "create_response": response,
        }

    async def describe_task(self, task_id: str) -> Dict[str, Any]:
        return await self._request_json("GET", f"/contents/generations/tasks/{task_id}")

    @staticmethod
    def _extract_video_url(detail: Dict[str, Any]) -> Optional[str]:
        content = detail.get("content")
        if isinstance(content, dict):
            for key in ("video_url", "videoUrl", "url"):
                value = content.get(key)
                if isinstance(value, str) and value:
                    return value
        if isinstance(content, list):
            for item in content:
                if not isinstance(item, dict):
                    continue
                for key in ("video_url", "videoUrl", "url"):
                    value = item.get(key)
                    if isinstance(value, str) and value:
                        return value
        for key in ("video_url", "videoUrl", "url"):
            value = detail.get(key)
            if isinstance(value, str) and value:
                return value
        return None

    def parse_task_detail(self, detail: Dict[str, Any]) -> Dict[str, Any]:
        raw_status = str(detail.get("status") or detail.get("Status") or "").strip().lower()
        if raw_status in {"succeeded", "success", "completed", "finish"}:
            status = "FINISH"
        elif raw_status in {"failed", "fail", "error", "canceled", "cancelled"}:
            status = "FAILED"
        else:
            status = "RUNNING"

        video_url = self._extract_video_url(detail)
        progress = 100 if status == "FINISH" else (50 if status == "RUNNING" else None)
        message = str(detail.get("message") or detail.get("Message") or detail.get("error") or "")

        return {
            "status": status,
            "progress": progress,
            "err_code": 0,
            "message": message,
            "video_url": video_url,
            "detail": detail,
        }

    async def store_video_output(
        self,
        *,
        user_id: str,
        video_url: str,
        task_id: str,
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True, trust_env=False) as client:
            response = await client.get(video_url)
            response.raise_for_status()
        content_type = response.headers.get("content-type") or "video/mp4"
        extension = Path(video_url.split("?", 1)[0]).suffix.lstrip(".").lower()
        if not extension:
            extension = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) or ".mp4"
            extension = extension.lstrip(".")
        if extension == "quicktime":
            extension = "mov"
        return image_storage_service.store_uploaded_video(
            user_id=user_id,
            file_bytes=response.content,
            original_filename=f"{task_id}.{extension or 'mp4'}",
            content_type=content_type,
            subdir="board-videos",
        )
