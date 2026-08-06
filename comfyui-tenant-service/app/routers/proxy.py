import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, Body, UploadFile, File, Form
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse, RedirectResponse, Response
import httpx
from sqlalchemy.orm import Session
from pathlib import Path
import mimetypes
from datetime import datetime, timedelta, timezone
import json
from io import BytesIO
import base64
import binascii
import math
import re
import uuid
import zipfile
from typing import Any, Dict, List, Optional, Sequence, Literal, Tuple
from urllib.parse import unquote, urlparse
from pydantic import BaseModel, Field, model_validator
try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - optional dependency
    Image = None
    ImageOps = None
from ..models.database import BoardBroadcastRecord, get_db, Tenant, TenantTaskRecord, User
from ..routers.auth import get_current_user
from ..services.logger import get_proxy_logger
from ..services.config import get_settings
from ..services.poloapi_client import PoloAPIError, call_poloapi_chat, call_poloapi_image_chat, resolve_poloapi_model
from ..services.poloapi_usage_service import log_poloapi_usage
from ..services.billing_service import charge_model_usage, should_charge_runninghub, get_model_rate, is_billing_enabled
from ..services.task_completion_service import complete_task_with_storage_impl
from ..services.task_queue import enqueue_task_completion
from ..services.task_timeout import is_task_timed_out
from ..services.openai_image_provider import (
    ImageProviderError,
    VOD_IMAGE2_REQUEST_MARKERS,
    openai_image_provider_service,
    resolve_vod_image_task_config,
)
from ..services.vod_video_provider import VodVideoProvider, VodVideoProviderError
from ..services.seedance_video_provider import SeedanceVideoProvider, SeedanceVideoProviderError
from ..services.image_storage import image_storage_service
from ..services.runtime_cache import cache_delete, cache_delete_prefix, cache_get_json, cache_key, cache_set_json

router = APIRouter()
settings = get_settings()

RUNNING_STATUSES = {"PENDING", "RUNNING", "PROCESSING", "COMPLETING"}
SUCCESS_STATUSES = {"SUCCESS", "COMPLETED"}
FAILED_STATUSES = {"FAILED", "ERROR"}
LLM_UPLOAD_MAX_LONG_EDGE = 2000
LLM_UPLOAD_TARGET_BYTES = 2 * 1024 * 1024



class ToolSummary(BaseModel):
    name: str
    displayName: Optional[str] = None
    href: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    focus: Optional[str] = None
    impact: Optional[str] = None
    tag: Optional[str] = None
    status: Optional[str] = None


class TaskBatchDownloadRequest(BaseModel):
    tenant_task_id: str
    image_urls: Optional[List[str]] = None
    batch_id: Optional[str] = None


class ToolAgentRequest(BaseModel):
    question: str
    tools: List[ToolSummary]
    history: Optional[List[Dict[str, Any]]] = None
    image_data_url: Optional[str] = None

    @model_validator(mode="after")
    def _validate_fields(self):
        has_question = bool(self.question and str(self.question).strip())
        has_image = bool(self.image_data_url and str(self.image_data_url).strip())
        if not has_question and not has_image:
            raise ValueError("question or image_data_url is required")
        if not self.tools:
            raise ValueError("tools cannot be empty")
        return self


def _safe_json_load(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError, ValueError):
            return value
    return value


def _normalize_board_video_model(raw_model: Optional[str]) -> str:
    value = (raw_model or "").strip()
    if not value:
        return "Kling 3.0-Omni"
    normalized = value.lower()
    if "seedance" in normalized:
        return "Seedance 2.0"
    return "Kling 3.0-Omni"


def _resolve_board_video_provider_kind(raw_model: Optional[str]) -> str:
    return "seedance" if _normalize_board_video_model(raw_model) == "Seedance 2.0" else "vod"


def _normalize_sora2_size(raw_size: Optional[str], width: int, height: int) -> str:
    supported = {"720x1280", "1280x720", "1024x1792", "1792x1024"}
    candidate = (raw_size or "").strip().lower()
    if candidate in supported:
        return candidate
    return "1792x1024" if width >= height else "1024x1792"


def _prepare_llm_upload_image(
    file_bytes: bytes,
    *,
    filename: Optional[str] = None,
    content_type: Optional[str] = None,
) -> Tuple[bytes, str]:
    if Image is None or ImageOps is None:
        return file_bytes, content_type or "image/jpeg"

    logger = get_proxy_logger()
    try:
        image = Image.open(BytesIO(file_bytes))
        image = ImageOps.exif_transpose(image)
    except Exception as exc:
        logger.warning("LLM image upload decode failed filename=%s error=%s", filename, exc)
        raise HTTPException(status_code=400, detail=f"图片 {filename or ''} 无法解析或格式无效")

    width, height = image.size
    long_edge = max(width, height)
    if long_edge > LLM_UPLOAD_MAX_LONG_EDGE:
        scale = LLM_UPLOAD_MAX_LONG_EDGE / long_edge
        image = image.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )

    if image.mode in ("RGBA", "LA"):
        background = Image.new("RGB", image.size, (255, 255, 255))
        alpha = image.getchannel("A")
        background.paste(image.convert("RGB"), mask=alpha)
        image = background
    elif image.mode != "RGB":
        image = image.convert("RGB")

    output = BytesIO()
    quality = 92
    while True:
        output.seek(0)
        output.truncate(0)
        image.save(output, format="JPEG", quality=quality, optimize=True)
        if output.tell() <= LLM_UPLOAD_TARGET_BYTES or quality <= 55:
            break
        quality -= 7

    normalized_bytes = output.getvalue()
    if len(normalized_bytes) != len(file_bytes) or long_edge > LLM_UPLOAD_MAX_LONG_EDGE:
        logger.info(
            "LLM image normalized filename=%s original=%dB %sx%s normalized=%dB %sx%s quality=%s",
            filename,
            len(file_bytes),
            width,
            height,
            len(normalized_bytes),
            image.width,
            image.height,
            quality,
        )

    return normalized_bytes, "image/jpeg"


def _prepare_sora2_input_image(file_bytes: bytes, requested_size: Optional[str]) -> Tuple[bytes, str]:
    if Image is None or ImageOps is None:
        # Pillow unavailable: fallback to conservative default size.
        return file_bytes, (requested_size or "1024x1792")

    image = Image.open(BytesIO(file_bytes))
    width, height = image.size
    target_size = _normalize_sora2_size(requested_size, width, height)
    target_width, target_height = [int(part) for part in target_size.split("x")]

    if (width, height) == (target_width, target_height):
        return file_bytes, target_size

    # Ensure input image exactly matches requested size to satisfy upstream inpaint constraints.
    normalized = ImageOps.fit(
        image.convert("RGB"),
        (target_width, target_height),
        method=Image.Resampling.LANCZOS,
        centering=(0.5, 0.5),
    )
    buffer = BytesIO()
    normalized.save(buffer, format="PNG")
    return buffer.getvalue(), target_size


def _to_iso(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _parse_iso_datetime(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        # Accept both "...Z" and "+00:00" flavors.
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


def _normalize_sora_status_payload(payload: Any) -> Dict[str, Any]:
    """
    Normalize upstream Sora payload shape.
    Some providers return:
    1) {"status": "...", "url": "..."}
    2) {"code": "...", "data": {"status": "...", "url": "..."}}
    """
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if isinstance(data, dict) and data.get("status"):
        merged = dict(payload)
        merged.update(data)
        return merged
    return payload


def _resolve_video_base_url() -> str:
    return (settings.poloapi_video_base_url or settings.poloapi_base_url or "https://work.poloapi.com/v1").rstrip("/")


def _normalize_veo_duration_seconds(raw_value: Optional[str]) -> int:
    try:
        value = int((raw_value or "").strip())
    except (TypeError, ValueError, AttributeError):
        return 8
    if value in {4, 6, 8}:
        return value
    return 8


def _veo_aspect_ratio_from_size(size_value: Optional[str]) -> str:
    raw = (size_value or "").strip().lower()
    if "x" in raw:
        parts = raw.split("x", 1)
        try:
            width = int(parts[0])
            height = int(parts[1])
            return "16:9" if width >= height else "9:16"
        except ValueError:
            pass
    return "16:9"


def _extract_first_http_url(payload: Any) -> Optional[str]:
    queue: List[Any] = [payload]
    while queue:
        current = queue.pop(0)
        if isinstance(current, dict):
            for key, value in current.items():
                if isinstance(value, str) and value.startswith(("http://", "https://")) and key.lower() in {
                    "url",
                    "uri",
                    "downloadurl",
                    "download_uri",
                }:
                    return value
                if isinstance(value, (dict, list)):
                    queue.append(value)
        elif isinstance(current, list):
            queue.extend(current)
    return None


def _redact_message_images(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    sanitized: List[Dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict) and part.get("type") == "image_url":
                    parts.append({"type": "image_url", "image_url": {"url": "[image]"}})
                else:
                    parts.append(part)
            sanitized.append({**message, "content": parts})
        else:
            sanitized.append(message)
    return sanitized


def _sanitize_poloapi_text(text: str) -> str:
    if not text:
        return text
    return re.sub(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+", "[image]", text)


def _summarize_poloapi_content(payload: Dict[str, Any]) -> Dict[str, Any]:
    choices = payload.get("choices") or []
    if not choices:
        return {"choices": 0}
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    summary: Dict[str, Any] = {"choices": len(choices), "content_type": type(content).__name__}
    if isinstance(content, list):
        summary["parts"] = [
            {
                "type": part.get("type") if isinstance(part, dict) else type(part).__name__,
                "has_image_url": isinstance(part, dict) and isinstance(part.get("image_url"), dict),
            }
            for part in content
        ]
    elif isinstance(content, dict):
        summary["type"] = content.get("type")
        image_url = content.get("image_url")
        summary["has_image_url"] = isinstance(image_url, dict)
    return summary


def _extract_poloapi_data_url(payload: Dict[str, Any]) -> Optional[str]:
    choices = payload.get("choices") or []
    if not choices:
        return None
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")

    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "image_url":
                image_url = (block.get("image_url") or {}).get("url")
                if isinstance(image_url, str) and image_url.startswith("data:image/"):
                    return image_url
    elif isinstance(content, dict):
        if content.get("type") == "image_url":
            image_url = (content.get("image_url") or {}).get("url")
            if isinstance(image_url, str) and image_url.startswith("data:image/"):
                return image_url

    text_payload = ""
    if isinstance(content, str):
        text_payload = content
    elif isinstance(content, list):
        parts: List[str] = []
        for block in content:
            if isinstance(block, dict):
                text_value = block.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
            elif isinstance(block, str):
                parts.append(block)
        text_payload = "".join(parts)
    elif isinstance(content, dict):
        text_value = content.get("text")
        if isinstance(text_value, str):
            text_payload = text_value

    if not text_payload:
        return None

    match = re.search(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)", text_payload)
    if match:
        return match.group(1)
    return None


def _decode_data_url(data_url: str) -> Optional[Tuple[bytes, str]]:
    if not data_url:
        return None
    match = re.match(r"data:(?P<mime>[^;]+);base64,(?P<data>[A-Za-z0-9+/=]+)", data_url.strip())
    if not match:
        return None
    mime_type = match.group("mime") or "image/png"
    encoded = match.group("data") or ""
    try:
        return base64.b64decode(encoded), mime_type
    except (ValueError, binascii.Error):  # type: ignore[name-defined]
        return None


def _extract_poloapi_text(payload: Dict[str, Any]) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for block in content:
            if isinstance(block, dict):
                text_value = block.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
            elif isinstance(block, str):
                parts.append(block)
        return "".join(parts)
    if isinstance(content, dict):
        text_value = content.get("text")
        return text_value if isinstance(text_value, str) else ""
    return ""


def _resolve_local_path_from_url(url: str) -> Optional[Path]:
    if not url:
        return None
    raw = unquote(url.split("?", 1)[0])
    prefixes = ["/api/proxy/static/images/", "/proxy/static/images/", "/static/images/"]
    relative = None
    for prefix in prefixes:
        if prefix in raw:
            relative = raw.split(prefix, 1)[1]
            break
    if raw.startswith("output/"):
        relative = raw[len("output/") :]
    if not relative:
        return None
    try:
        relative = relative.lstrip("/\\")
        base_storage = image_storage_service.base_storage_path.resolve()
        candidates = [
            base_storage / Path(relative),
            Path.cwd() / "output" / Path(relative),
            Path.cwd().parent / "output" / Path(relative),
        ]
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
                if resolved.exists():
                    return resolved
            except Exception:
                continue
    except Exception:
        return None


def _normalize_storage_relative_path(value: str) -> Optional[str]:
    if not isinstance(value, str):
        return None
    raw = unquote(value.split("?", 1)[0]).replace("\\", "/").strip()
    if not raw:
        return None

    if raw.startswith("https:/") and not raw.startswith("https://"):
        raw = "https://" + raw[len("https:/") :].lstrip("/")
    elif raw.startswith("http:/") and not raw.startswith("http://"):
        raw = "http://" + raw[len("http:/") :].lstrip("/")

    parsed = urlparse(raw)
    path_value = parsed.path if parsed.scheme in ("http", "https") else raw

    if parsed.scheme in ("http", "https") and not parsed.netloc and path_value:
        compact = path_value.lstrip("/")
        if "/" in compact:
            maybe_host, maybe_path = compact.split("/", 1)
            if "." in maybe_host:
                path_value = "/" + maybe_path
    if not path_value:
        return None

    prefixes = ["/api/proxy/static/images/", "/proxy/static/images/", "/static/images/"]
    for prefix in prefixes:
        if path_value.startswith(prefix):
            path_value = path_value[len(prefix) :]
            break

    path_value = path_value.lstrip("/")
    cos_prefix = (settings.output_cos_prefix or "root/fasium/output").strip().strip("/")
    if cos_prefix and path_value.startswith(f"{cos_prefix}/"):
        path_value = path_value[len(cos_prefix) + 1 :]
    elif path_value == cos_prefix:
        path_value = ""
    if path_value.startswith("thumbnail/output/"):
        path_value = path_value[len("thumbnail/") :]
    if path_value.startswith("output/"):
        path_value = path_value[len("output/") :]
    path_value = path_value.lstrip("/")
    return path_value or None


def _public_storage_reference(value: Any) -> Any:
    if not isinstance(value, str) or not value.strip():
        return value
    raw = value.strip()
    if raw.startswith(("http://", "https://", "/api/proxy/static/images/")):
        return raw
    relative = _normalize_storage_relative_path(raw)
    if not relative:
        return raw
    return f"/api/proxy/static/images/{relative}"


def _public_storage_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    public_entry = dict(entry)
    for key in ("original", "localPath", "thumbnail", "thumbnailPath"):
        if key in public_entry:
            public_entry[key] = _public_storage_reference(public_entry.get(key))
    return public_entry


def _resolve_internal_image_proxy_url(value: str) -> Optional[str]:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        return raw

    path = raw
    if path.startswith("/api/proxy/static/images/"):
        path = path.replace("/api/proxy/static/images/", "/proxy/static/images/", 1)
    elif path.startswith("/static/images/"):
        path = path.replace("/static/images/", "/proxy/static/images/", 1)
    elif not path.startswith("/proxy/static/images/"):
        relative = _normalize_storage_relative_path(path)
        if not relative:
            return None
        path = f"/proxy/static/images/{relative}"

    if not path.startswith("/"):
        path = "/" + path
    return f"http://localhost:8081{path}"


def _resolve_cos_url_from_reference(value: str) -> Optional[str]:
    relative = _normalize_storage_relative_path(value)
    if not relative:
        return None
    prefix = (settings.output_cos_prefix or "root/fasium/output").strip().strip("/")
    public_base = (settings.output_cos_public_base_url or "").strip().rstrip("/")
    if not public_base:
        bucket = (settings.output_cos_bucket or "").strip()
        region = (settings.output_cos_region or "ap-shanghai").strip()
        if not bucket:
            return None
        public_base = f"https://{bucket}.cos.{region}.myqcloud.com"
    return f"{public_base}/{prefix}/{relative.lstrip('/')}"


def _build_data_url(payload: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(payload).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


async def _resolve_chat_image_reference(value: str) -> Optional[Tuple[bytes, str]]:
    raw = (value or "").strip()
    if not raw:
        return None

    if raw.startswith("data:image/"):
        return _decode_data_url(raw)

    local_path = _resolve_local_path_from_url(raw)
    if local_path and local_path.exists():
        mime_type = mimetypes.guess_type(str(local_path))[0] or "image/png"
        try:
            return local_path.read_bytes(), mime_type
        except Exception:
            return None

    candidate_urls: List[str] = []
    internal_url = _resolve_internal_image_proxy_url(raw)
    if internal_url:
        candidate_urls.append(internal_url)

    cos_url = _resolve_cos_url_from_reference(raw)
    if cos_url and cos_url not in candidate_urls:
        candidate_urls.append(cos_url)

    if raw.startswith(("http://", "https://")) and raw not in candidate_urls:
        candidate_urls.append(raw)

    for candidate_url in candidate_urls:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(candidate_url)
                response.raise_for_status()
                payload_bytes = response.content
                mime_type = response.headers.get("content-type") or mimetypes.guess_type(candidate_url)[0] or "image/png"
                return payload_bytes, mime_type
        except Exception:
            continue

    return None


def _save_inline_data_image(payload: bytes, mime_type: str, *, prefix: str = "chat_inline") -> Optional[Path]:
    try:
        base_dir = (Path(settings.output_storage_path or "./output").resolve() / "chat-inline")
        base_dir.mkdir(parents=True, exist_ok=True)
        clean_mime = (mime_type or "image/png").split(";", 1)[0].strip().lower()
        suffix = mimetypes.guess_extension(clean_mime) or ".png"
        if suffix == ".jpe":
            suffix = ".jpg"
        path = base_dir / f"{prefix}_{uuid.uuid4().hex[:16]}{suffix}"
        path.write_bytes(payload)
        return path
    except Exception:
        return None


def _summarize_chat_messages(messages: List[Dict[str, Any]]) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"count": len(messages), "roles": [], "image_parts": 0, "text_parts": 0}
    details: List[Dict[str, Any]] = []
    for idx, message in enumerate(messages):
        if not isinstance(message, dict):
            continue
        role = str(message.get("role") or "unknown")
        summary["roles"].append(role)
        content = message.get("content")
        msg_detail: Dict[str, Any] = {"index": idx, "role": role, "content_type": type(content).__name__}
        if isinstance(content, str):
            msg_detail["text_len"] = len(content)
        elif isinstance(content, list):
            parts_info: List[Dict[str, Any]] = []
            for part in content:
                if not isinstance(part, dict):
                    continue
                ptype = part.get("type")
                if ptype == "text":
                    text = part.get("text")
                    if isinstance(text, str):
                        summary["text_parts"] += 1
                        parts_info.append({"type": "text", "text_len": len(text)})
                elif ptype == "image_url":
                    image_url = part.get("image_url")
                    url = image_url.get("url") if isinstance(image_url, dict) else image_url
                    if isinstance(url, str):
                        summary["image_parts"] += 1
                        is_data = url.startswith("data:image/")
                        parts_info.append(
                            {
                                "type": "image_url",
                                "is_data_url": is_data,
                                "url_len": len(url),
                            }
                        )
            msg_detail["parts"] = parts_info
        details.append(msg_detail)
    summary["details"] = details
    return summary


def _build_chat_debug_snapshot(messages: List[Dict[str, Any]], model_name: str) -> Dict[str, Any]:
    sanitized_messages: List[Dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        msg = dict(message)
        content = msg.get("content")
        if isinstance(content, list):
            sanitized_parts: List[Any] = []
            for part in content:
                if not isinstance(part, dict):
                    sanitized_parts.append(part)
                    continue
                part_copy = dict(part)
                if part_copy.get("type") == "image_url":
                    image_url = part_copy.get("image_url")
                    url = image_url.get("url") if isinstance(image_url, dict) else image_url
                    if isinstance(url, str) and url.startswith("data:image/"):
                        match = re.match(r"data:(?P<mime>[^;]+);base64,(?P<data>[A-Za-z0-9+/=]+)", url.strip())
                        if match:
                            mime_type = match.group("mime") or "image/png"
                            encoded = match.group("data") or ""
                            part_copy["image_url"] = {
                                "url": f"data:{mime_type};base64,<redacted>",
                                "meta": {
                                    "base64_len": len(encoded),
                                    "preview": encoded[:16],
                                },
                            }
                sanitized_parts.append(part_copy)
            msg["content"] = sanitized_parts
        sanitized_messages.append(msg)

    return {
        "model": model_name,
        "stream": False,
        "messages": sanitized_messages,
    }


def _save_chat_debug_snapshot(snapshot: Dict[str, Any]) -> Optional[Path]:
    try:
        base_dir = (Path(settings.output_storage_path or "./output").resolve() / "chat-debug")
        base_dir.mkdir(parents=True, exist_ok=True)
        path = base_dir / f"chat_request_{uuid.uuid4().hex[:16]}.json"
        path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
        return path
    except Exception:
        return None


def _truncate_for_log(value: Optional[str], limit: int = 1500) -> str:
    if not value:
        return ""
    if len(value) <= limit:
        return value
    return f"{value[:limit]}... (truncated {len(value) - limit} chars)"


def _normalize_storage_entries(storage_paths: Any) -> List[Dict[str, Optional[str]]]:
    if not storage_paths:
        return []
    if isinstance(storage_paths, str):
        try:
            storage_paths = json.loads(storage_paths)
        except (json.JSONDecodeError, TypeError, ValueError):
            storage_paths = [storage_paths]
    if not isinstance(storage_paths, Sequence) or isinstance(storage_paths, (bytes, bytearray)):
        storage_paths = [storage_paths]

    normalized: List[Dict[str, Optional[str]]] = []
    for entry in storage_paths:
        if isinstance(entry, dict):
            normalized.append(
                {
                    "original": entry.get("original") or entry.get("localPath") or entry.get("path"),
                    "thumbnail": entry.get("thumbnail") or entry.get("thumbnailPath"),
                }
            )
        else:
            normalized.append({"original": entry, "thumbnail": None})
    return normalized


def _coerce_thumbnail_path(original_path: Optional[str], thumbnail_path: Optional[str]) -> Optional[str]:
    source_path = thumbnail_path or original_path
    if not source_path:
        return None
    if str(source_path).startswith(("http://", "https://")):
        return str(source_path)
    try:
        path_obj = Path(str(source_path))
    except Exception:
        return source_path

    stem = path_obj.stem
    if not stem:
        return str(source_path)

    parts = list(path_obj.parts)
    if "thumbnail" in parts:
        target_dir = path_obj.parent
    else:
        target_dir = path_obj.parent / "thumbnail"
    return str(target_dir / f"{stem}.webp")


def _resolve_storage_file(raw_path: Optional[str], output_root: Path) -> Optional[Path]:
    if not raw_path:
        return None
    candidates: List[Path] = []
    raw_candidate = Path(raw_path)
    if raw_candidate.is_absolute():
        candidates.append(raw_candidate)
    else:
        candidates.append((Path.cwd() / raw_candidate).resolve())
        stripped = re.sub(r"^output[\\\/]", "", raw_path)
        candidates.append((output_root / stripped).resolve())
        candidates.append((output_root / raw_candidate).resolve())
    seen: set[str] = set()
    for candidate in candidates:
        try:
            key = str(candidate)
            if key in seen:
                continue
            seen.add(key)
            if candidate.exists() and candidate.is_file():
                return candidate
        except Exception:
            continue
    return None


def _build_history_item(record: Dict[str, Any]) -> Dict[str, Any]:
    storage_entries = _normalize_storage_entries(record.get("storage_paths"))
    image_urls: List[str] = []
    thumbnail_urls: List[str] = []

    for entry in storage_entries:
        original_path = entry.get("original")
        thumbnail_path = entry.get("thumbnail")

        if original_path:
            if str(original_path).startswith(("http://", "https://")):
                image_urls.append(str(original_path))
            else:
                relative_path = re.sub(r"^output[\\\/]", "", str(original_path))
                normalized_path = relative_path.replace("\\", "/")
                image_urls.append(f"/api/proxy/static/images/{normalized_path}")
                if not thumbnail_path:
                    thumbnail_path = original_path

        thumbnail_path = _coerce_thumbnail_path(original_path, thumbnail_path)

        if thumbnail_path:
            if str(thumbnail_path).startswith(("http://", "https://")):
                thumbnail_urls.append(str(thumbnail_path))
            else:
                relative_thumb = re.sub(r"^output[\\\/]", "", str(thumbnail_path))
                normalized_thumb = relative_thumb.replace("\\", "/")
                thumbnail_urls.append(f"/api/proxy/static/images/{normalized_thumb}")

    if not thumbnail_urls and image_urls:
        thumbnail_urls = image_urls.copy()

    result_data = _safe_json_load(record.get("result_data"))
    storage_paths = _safe_json_load(record.get("storage_paths"))
    thumbnail_paths = _safe_json_load(record.get("thumbnail_paths"))

    return {
        "id": record.get("id"),
        "tenant_task_id": record.get("tenant_task_id"),
        "user_id": record.get("user_id"),
        "runninghub_task_id": record.get("runninghub_task_id"),
        "task_type": record.get("task_type"),
        "status": record.get("status"),
        "created_at": _to_iso(record.get("created_at")),
        "completed_at": _to_iso(record.get("completed_at")),
        "result_data": result_data,
        "storage_paths": storage_paths,
        "thumbnail_paths": thumbnail_paths,
        "image_urls": image_urls,
        "thumbnail_urls": thumbnail_urls,
        "error_message": record.get("error_message"),
    }


def _history_cache_key(username: str, page: int, limit: int, task_type: Optional[str], settings_scope: str) -> str:
    return cache_key("tenant", "tasks", "history", settings_scope, username, page, limit, task_type or "all")


def _history_count_cache_key(username: str, task_type: Optional[str], settings_scope: str) -> str:
    return cache_key("tenant", "tasks", "history", "count", settings_scope, username, task_type or "all")


def _history_types_cache_key(username: str, settings_scope: str) -> str:
    return cache_key("tenant", "tasks", "history", "types", settings_scope, username)


def _task_status_cache_key(username: str, task_id: str, settings_scope: str) -> str:
    return cache_key("tenant", "tasks", "status", settings_scope, username, task_id)


def _invalidate_user_task_caches(username: str, task_ids: Optional[List[str]] = None) -> None:
    scope = str(settings.storage_type)
    cache_delete_prefix(cache_key("tenant", "tasks", "history", scope, username))
    cache_delete_prefix(cache_key("tenant", "tasks", "status", scope, username))
    cache_delete_prefix(cache_key("tenant", "tasks", "history", "count", scope, username))
    cache_delete_prefix(cache_key("tenant", "tasks", "history", "types", scope, username))
    if task_ids:
        for task_id in task_ids:
            cache_delete(_task_status_cache_key(username, task_id, scope))


def _get_username(current_user: Any) -> str:
    if settings.is_database_storage():
        return current_user.username
    return current_user["username"]


def _serialize_board_broadcast(record: BoardBroadcastRecord) -> Dict[str, Any]:
    starts_at = record.starts_at.replace(tzinfo=timezone.utc) if record.starts_at and record.starts_at.tzinfo is None else record.starts_at
    ends_at = record.ends_at.replace(tzinfo=timezone.utc) if record.ends_at and record.ends_at.tzinfo is None else record.ends_at
    updated_at = record.updated_at.replace(tzinfo=timezone.utc) if record.updated_at and record.updated_at.tzinfo is None else record.updated_at
    return {
        "id": record.id,
        "title": record.title,
        "content_markdown": record.content_markdown or "",
        "starts_at": starts_at.isoformat() if starts_at else None,
        "ends_at": ends_at.isoformat() if ends_at else None,
        "display_order": record.display_order or 0,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def _user_value(user: Any, key: str, default: Any = None) -> Any:
    if settings.is_database_storage():
        return getattr(user, key, default)
    if isinstance(user, dict):
        return user.get(key, default)
    return default


def _normalize_role(role: Any) -> str:
    value = str(role or "").strip().lower()
    if value in {"manager", "employee", "user"}:
        return value
    return "user"


def _is_manager_user(user: Any) -> bool:
    group = _user_value(user, "group", None)
    if group == 1000:
        return False
    return _normalize_role(_user_value(user, "role", "user")) == "manager"


def _is_employee_user(user: Any) -> bool:
    return _normalize_role(_user_value(user, "role", "user")) == "employee"


def _list_manager_employee_usernames(db: Session, manager_username: str) -> List[str]:
    if settings.is_database_storage():
        rows = (
            db.query(User.username)
            .filter(User.role == "employee", User.manager_username == manager_username)
            .all()
        )
        return [row[0] for row in rows if row and row[0]]
    users = db.list_employees_for_manager(manager_username)
    return [item.get("username") for item in users if item.get("username")]


def _resolve_credit_owner_user(db: Session, current_user: Any) -> Any:
    if not _is_employee_user(current_user):
        return current_user
    manager_username = _user_value(current_user, "manager_username")
    if not manager_username:
        return current_user
    if settings.is_database_storage():
        manager = db.query(User).filter(User.username == manager_username).first()
        return manager or current_user
    manager = db.get_user_by_username(manager_username)
    return manager or current_user


def _ensure_not_manager_write(current_user: Any) -> None:
    if _is_manager_user(current_user):
        raise HTTPException(status_code=403, detail="Manager is read-only for board changes")


def _can_manager_view_project_owner(db: Session, current_user: Any, project_owner: Optional[str]) -> bool:
    if not project_owner or not _is_manager_user(current_user):
        return False
    manager_username = _get_username(current_user)
    if project_owner == manager_username:
        return True
    return project_owner in _list_manager_employee_usernames(db, manager_username)


def _normalize_project_record(project: Dict[str, Any], include_board: bool = True) -> Dict[str, Any]:
    if not isinstance(project, dict):
        return project

    content = project.get("project_content") or {}
    if not include_board and isinstance(content, dict) and "board" in content:
        content = {**content}
        content.pop("board", None)

    return {
        "project_id": project.get("project_id"),
        "user_id": project.get("user_id"),
        "project_content": content,
        "created_at": _to_iso(project.get("created_at")),
        "updated_at": _to_iso(project.get("updated_at")),
    }


def _get_project_sort_timestamp(project: Dict[str, Any]) -> datetime:
    if not isinstance(project, dict):
        return datetime.min.replace(tzinfo=timezone.utc)

    updated_at = project.get("updated_at")
    if isinstance(updated_at, datetime):
        return updated_at if updated_at.tzinfo else updated_at.replace(tzinfo=timezone.utc)

    created_at = project.get("created_at")
    if isinstance(created_at, datetime):
        return created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)

    for raw_value in (updated_at, created_at):
        if isinstance(raw_value, str) and raw_value:
            normalized = raw_value.replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(normalized)
                return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
            except ValueError:
                continue

    return datetime.min.replace(tzinfo=timezone.utc)


def _sort_projects(projects: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        projects,
        key=lambda project: (
            _get_project_sort_timestamp(project),
            str(project.get("created_at") or ""),
            str(project.get("project_id") or ""),
        ),
        reverse=True,
    )


def _paginate_projects(projects: List[Dict[str, Any]], page: int, page_size: int) -> Dict[str, Any]:
    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, 9))
    total = len(projects)
    total_pages = max(1, math.ceil(total / safe_page_size)) if total > 0 else 1
    start = (safe_page - 1) * safe_page_size
    end = start + safe_page_size
    items = projects[start:end] if start < total else []
    return {
        "items": items,
        "page": safe_page,
        "page_size": safe_page_size,
        "total": total,
        "total_pages": total_pages,
    }


class ProjectCreateRequest(BaseModel):
    project_id: Optional[str] = Field(default=None, description="自定义项目ID，可选")
    name: Optional[str] = Field(
        default=None,
        max_length=200,
        description="项目名称，未提供 project_content 时必填",
    )
    description: Optional[str] = Field(default=None, max_length=2000)
    task_ids: Optional[List[str]] = Field(default=None, description="初始关联任务ID列表")
    project_content: Optional[Dict[str, Any]] = Field(default=None, description="自定义项目内容")
    metadata: Optional[Dict[str, Any]] = Field(
        default=None, description="附加元数据，将合并到 project_content.metadata 中"
    )

    @model_validator(mode="after")
    def _ensure_content(self) -> "ProjectCreateRequest":
        if not self.project_content and not self.name:
            raise ValueError("name 或 project_content 至少提供一个")
        return self

    def to_project_content(self) -> Dict[str, Any]:
        content = dict(self.project_content or {})

        if self.name is not None:
            content.setdefault("name", self.name)
        if self.description is not None:
            content.setdefault("description", self.description)

        if self.metadata:
            merged_metadata = dict(content.get("metadata") or {})
            merged_metadata.update(self.metadata)
            content["metadata"] = merged_metadata

        if self.task_ids is not None:
            content["task_ids"] = self.task_ids

        return content


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200, description="项目名称")
    description: Optional[str] = Field(default=None, max_length=2000)
    task_ids: Optional[List[str]] = Field(default=None, description="完整任务ID列表（覆盖）")
    project_content: Optional[Dict[str, Any]] = Field(default=None, description="需要合并的项目内容")
    metadata: Optional[Dict[str, Any]] = Field(
        default=None, description="附加元数据，将合并到 project_content.metadata 中"
    )

    def to_updates(self) -> Dict[str, Any]:
        content = dict(self.project_content or {})

        if self.name is not None:
            content["name"] = self.name
        if self.description is not None:
            content["description"] = self.description

        if self.metadata:
            merged_metadata = dict(content.get("metadata") or {})
            merged_metadata.update(self.metadata)
            content["metadata"] = merged_metadata

        if self.task_ids is not None:
            content["task_ids"] = self.task_ids

        return content


class DeleteProjectRequest(BaseModel):
    confirm_name: Optional[str] = Field(default=None, max_length=200, description="受保护项目删除时必填，需与项目名称完全一致")


class ProjectTaskUpdateRequest(BaseModel):
    task_ids: List[str] = Field(..., min_length=1, description="要加入项目的任务ID列表")

    @model_validator(mode="after")
    def _deduplicate(self) -> "ProjectTaskUpdateRequest":
        self.task_ids = list(dict.fromkeys(self.task_ids))
        if not self.task_ids:
            raise ValueError("task_ids 不能为空")
        return self


class ProjectTeamMemberPayload(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=255, description="被授予访问权的用户ID")
    permission: Literal["viewer", "editor"] = Field(
        default="viewer", description="访问权限等级，如 viewer/editor"
    )


class ProjectInvitePayload(BaseModel):
    target_user_id: str = Field(..., min_length=1, max_length=255, description="被邀请的用户ID")
    permission: Literal["viewer", "editor"] = Field(
        default="viewer", description="邀请授予的权限"
    )
    expires_at: Optional[datetime] = Field(
        default=None, description="邀请过期时间，可选"
    )
    message: Optional[str] = Field(default=None, max_length=500, description="可选备注")


class ProjectInviteStatusPayload(BaseModel):
    status: Literal["pending", "accepted", "declined", "cancelled"] = Field(
        ..., description="邀请最新状态"
    )


class SheetDesignImagePayload(BaseModel):
    mimeType: Optional[str] = Field(default=None, description="图像的 MIME 类型，例如 image/png")
    data: str = Field(..., description="Base64 编码的图像数据（不包含 data: 前缀）")


class SheetMaterialPayload(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    specs: Optional[str] = None


class SheetBriefPayload(BaseModel):
    description: str = ""
    designImages: List[SheetDesignImagePayload] = Field(default_factory=list)
    materials: List[SheetMaterialPayload] = Field(default_factory=list)


class SheetBriefRequest(BaseModel):
    brief: SheetBriefPayload


class BillOfMaterialsItemPayload(BaseModel):
    item: str
    description: str


class SpecSheetItemPayload(BaseModel):
    pointOfMeasure: str
    measurement: str


class TechPackPayload(BaseModel):
    description: str
    billOfMaterials: List[BillOfMaterialsItemPayload]
    specSheet: List[SpecSheetItemPayload]
    constructionDetails: List[str]


class SheetTechPackRequest(BaseModel):
    brief: SheetBriefPayload


class SheetCostEstimationRequest(BaseModel):
    brief: SheetBriefPayload
    techPack: TechPackPayload


def _extract_status(payload: Dict[str, Any]) -> Optional[str]:
    if not isinstance(payload, dict):
        return None

    status = payload.get("status")
    if isinstance(status, str):
        return status

    nested_keys = ("data", "task", "result", "response")
    for key in nested_keys:
        nested = payload.get(key)
        if isinstance(nested, dict):
            nested_status = nested.get("status") or nested.get("state")
            if isinstance(nested_status, str):
                return nested_status
        elif isinstance(nested, str):
            return nested

    return None


def _resolve_runninghub_model(endpoint: str, content_type: str, body: bytes) -> str:
    if "application/json" in (content_type or "") and body:
        try:
            payload = json.loads(body)
        except Exception:
            payload = None
        if isinstance(payload, dict):
            for key in ("model", "workflow_id", "workflowId", "workflow", "checkpoint", "base_model"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return f"runninghub:{value.strip()}"
    return f"runninghub:{endpoint}"


def _ensure_sufficient_credit(db: Session, current_user: Any, model: str, endpoint: str) -> None:
    if not model:
        return
    if settings.pressure_test_mode:
        return
    billing_user = _resolve_credit_owner_user(db, current_user)
    if settings.is_database_storage():
        tenant_id = billing_user.tenant_id
        user_id = billing_user.id
    else:
        tenant_id = billing_user.get("tenant_id")
        user_id = billing_user.get("id")

    if tenant_id is None or user_id is None:
        raise HTTPException(status_code=401, detail="User not found")

    if not is_billing_enabled(db, tenant_id):
        return

    credits = max(0, int(get_model_rate(db, model)))
    if credits <= 0:
        return

    if settings.is_database_storage():
        user = db.query(User).filter(User.id == user_id).first()
        balance = int(user.credit or 0) if user else 0
    else:
        user = db.get_user_by_id(user_id)
        balance = int(user.get("credit") or 0) if user else 0

    if balance - credits < 0:
        raise HTTPException(
            status_code=402,
            detail={
                "detail": "Insufficient credit",
                "endpoint": endpoint,
                "model": model,
                "balance": balance,
                "required": credits,
            },
        )


class DeleteTasksRequest(BaseModel):
    task_ids: list[str] | None = None
    task_type: str | None = None


class RefreshTaskStatusRequest(BaseModel):
    tenant_task_ids: list[str]

async def proxy_to_runninghub(
    request: Request,
    endpoint: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
    charge_enabled: bool = True,
):
    logger = get_proxy_logger()
    # 获取用户名，支持两种存储模式
    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]
    
    logger.info(f"代理请求: {endpoint}, 用户: {username}")
    
    # Get tenant info
    if settings.is_json_storage():
        tenant = db.get_tenant_by_id(tenant_id)
    else:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    
    # Prepare request to backend service
    backend_url = f"{settings.runninghub_service_url}/v1/{endpoint}"
    
    # Get request body and headers
    body = await request.body()
    content_type = request.headers.get("content-type", "application/json")

    if charge_enabled and should_charge_runninghub(endpoint):
        model_name = _resolve_runninghub_model(endpoint, content_type, body)
        _ensure_sufficient_credit(db, current_user, model_name, f"/runninghub/{endpoint}")
    
    # Prepare headers
    headers = {
        "Content-Type": content_type
    }
    
    try:
        logger.info(f"准备请求后端服务: {backend_url}")
        logger.info(f"请求方法: {request.method}")
        logger.info(f"内容类型: {content_type}")
        
        # 测试连接
        try:
            async with httpx.AsyncClient(timeout=5.0) as test_client:
                # 测试基本连接
                test_response = await test_client.get(f"{settings.runninghub_service_url}/docs")
                logger.info(f"连接测试成功: {test_response.status_code}")
                
                # 测试健康检查端点
                try:
                    health_response = await test_client.get(f"{settings.runninghub_service_url}/health")
                    logger.info(f"健康检查: {health_response.status_code}")
                except Exception as health_e:
                    logger.warning(f"健康检查失败: {str(health_e)}")
                    
        except httpx.ConnectError as connect_e:
            logger.error(f"无法连接到RunningHub服务器: {str(connect_e)}")
            logger.error(f"请检查RunningHub服务器是否在 {settings.runninghub_service_url} 运行")
        except httpx.TimeoutException as timeout_e:
            logger.error(f"连接RunningHub服务器超时: {str(timeout_e)}")
        except Exception as test_e:
            logger.error(f"连接测试失败: {str(test_e)}")
            logger.error(f"错误类型: {type(test_e).__name__}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            # For file uploads, we need to handle multipart/form-data differently
            if "multipart/form-data" in content_type:
                logger.info("处理文件上传请求")
                # Parse the multipart data and forward it
                form_data = await request.form()
                files = {}
                data = {}
                
                # 准备 httpx 的文件上传格式
                httpx_files = {}
                httpx_data = {}
                
                for key, value in form_data.items():
                    if hasattr(value, 'filename'):  # It's a file
                        file_content = await value.read()
                        # httpx 文件格式: (filename, content, content_type)
                        httpx_files[key] = (value.filename, file_content, value.content_type)
                        logger.info(f"文件: {key} = {value.filename} ({len(file_content)} bytes)")
                    else:
                        httpx_data[key] = value
                        logger.info(f"数据: {key} = {value}")
                
                logger.info(f"发送文件上传请求到: {backend_url}")
                logger.info(f"httpx_files: {list(httpx_files.keys())}")
                logger.info(f"httpx_data: {httpx_data}")
                
                response = await client.post(
                    backend_url,
                    files=httpx_files,
                    data=httpx_data,
                    timeout=30.0
                )
            else:
                logger.info("处理JSON请求")
                # For JSON requests
                response = await client.request(
                    method=request.method,
                    url=backend_url,
                    headers=headers,
                    content=body,
                    timeout=30.0
                )
            
            logger.info(f"后端响应: {response.status_code}")
            logger.info(f"后端响应头: {dict(response.headers)}")
            
            # 检查响应状态码
            if response.status_code >= 400:
                logger.error(f"后端服务返回错误状态码: {response.status_code}")
                try:
                    error_text = response.text
                    logger.error(f"后端错误响应内容: {error_text}")
                except Exception as e:
                    logger.error(f"无法读取错误响应内容: {str(e)}")
            elif charge_enabled and should_charge_runninghub(endpoint):
                model_name = _resolve_runninghub_model(endpoint, content_type, body)
                charge_model_usage(db, current_user, f"/runninghub/{endpoint}", model_name)
            
            # Return response
            if response.headers.get("content-type", "").startswith("application/json"):
                try:
                    response_data = response.json()
                    logger.info(f"后端响应数据: {response_data}")
                    return JSONResponse(
                        content=response_data,
                        status_code=response.status_code
                    )
                except Exception as e:
                    logger.error(f"解析JSON响应失败: {str(e)}")
                    return JSONResponse(
                        content={"error": "Failed to parse JSON response", "raw_response": response.text},
                        status_code=response.status_code
                    )
            else:
                response_text = response.text
                logger.info(f"后端响应文本: {response_text}")
                return JSONResponse(
                    content={"data": response_text},
                    status_code=response.status_code
                )
            
    except httpx.TimeoutException as e:
        logger.error(f"请求超时: {str(e)}")
        logger.error(f"超时详情: 请求URL={backend_url}, 超时时间=30秒")
        raise HTTPException(status_code=504, detail=f"Backend service timeout: {str(e)}")
    except httpx.ConnectError as e:
        logger.error(f"连接错误: {str(e)}")
        logger.error(f"连接详情: 目标URL={backend_url}, 错误类型={type(e).__name__}")
        logger.error(f"可能原因: RunningHub服务器未启动或网络不可达")
        raise HTTPException(status_code=503, detail=f"Cannot connect to backend service: {str(e)}")
    except httpx.HTTPStatusError as e:
        logger.error(f"HTTP状态错误: {e.response.status_code}")
        logger.error(f"响应头: {dict(e.response.headers)}")
        try:
            error_content = e.response.text
            logger.error(f"错误响应内容: {error_content}")
        except Exception as content_e:
            logger.error(f"无法读取错误响应内容: {str(content_e)}")
        raise HTTPException(status_code=e.response.status_code, detail=f"Backend service returned {e.response.status_code}")
    except httpx.RequestError as e:
        logger.error(f"请求错误: {str(e)}")
        logger.error(f"请求详情: URL={backend_url}, 方法={request.method}")
        raise HTTPException(status_code=502, detail=f"Backend service error: {str(e)}")
    except Exception as e:
        logger.error(f"未知错误: {str(e)}")
        logger.error(f"错误类型: {type(e).__name__}")
        logger.error(f"错误详情: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Internal server error: {str(e)}")

@router.post("/llm/palette_from_image")
async def palette_from_image(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    接收前端上传的图片与提示词，转发至租户配置的LLM视觉端点，要求返回RGB配色组。
    返回格式：{ "groups": [ { "colors": [ {r,g,b}, ... ] }, ... ] }
    """
    logger = get_proxy_logger()

    # 读取租户LLM配置
    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]

    if settings.is_json_storage():
        tenant = db.get_tenant_by_id(tenant_id)
    else:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    raw_settings = getattr(tenant, "settings", None) if settings.is_database_storage() else tenant.get("settings")
    tenant_settings = {}
    if raw_settings:
        if isinstance(raw_settings, dict):
            tenant_settings = raw_settings
        elif isinstance(raw_settings, str):
            try:
                tenant_settings = json.loads(raw_settings)
            except json.JSONDecodeError:
                tenant_settings = {}

    llm_nested = tenant_settings.get("llm") if isinstance(tenant_settings.get("llm"), dict) else {}
    llm_service_url = (
        llm_nested.get("service_url")
        or llm_nested.get("endpoint")
        or tenant_settings.get("llm_service_url")
        or tenant_settings.get("llm_endpoint")
        or settings.llm_service_url
    )
    llm_api_key = (
        llm_nested.get("api_key")
        or tenant_settings.get("llm_api_key")
        or settings.llm_api_key
    )
    llm_vision_path = llm_nested.get("vision_path") or "/chat/completions"

    if not llm_service_url or not llm_api_key:
        raise HTTPException(status_code=500, detail="LLM service is not configured")

    log_context = {
        "user": username,
        "tenant": tenant_id,
        "target_url": None,
        "model": None,
        "payload_bytes": None,
        "prompt_len": None,
        "compressed": False,
    }

    # 读取表单：文件+提示词
    form = await request.form()
    file = form.get("file")
    prompt = form.get("prompt") or "请返回RGB配色组的JSON。"
    if not hasattr(file, 'filename'):
        raise HTTPException(status_code=400, detail="file is required")

    file_bytes = await file.read()
    log_context["payload_bytes"] = len(file_bytes)
    log_context["prompt_len"] = len(str(prompt)) if prompt else 0
    original_size = len(file_bytes)
    compressed_mime = None

    # 如果图片过大（>1MB），尝试压缩到 512KB 以下再发送给 LLM
    if original_size > 1024 * 1024:
        if Image is None:
            logger.warning(
                f"palette_from_image: Pillow not installed, cannot compress large image (size={original_size} bytes)"
            )
        else:
            try:
                image = Image.open(BytesIO(file_bytes))
                image = image.convert("RGB")

                target_size = 512 * 1024
                quality = 95
                buffer = BytesIO()

                def save_image(img, q):
                    buffer.seek(0)
                    buffer.truncate(0)
                    img.save(buffer, format="JPEG", quality=q, optimize=True)

                working_image = image
                save_image(working_image, quality)

                while buffer.tell() > target_size and quality > 10:
                    quality -= 5
                    save_image(working_image, quality)

                if buffer.tell() > target_size:
                    # 继续压缩：逐步缩小尺寸
                    min_side = 128
                    while buffer.tell() > target_size and (working_image.width > min_side or working_image.height > min_side):
                        new_width = max(min_side, int(working_image.width * 0.9))
                        new_height = max(min_side, int(working_image.height * 0.9))
                        if new_width == working_image.width and new_height == working_image.height:
                            break
                        resample = Image.LANCZOS if hasattr(Image, "LANCZOS") else Image.BICUBIC
                        working_image = working_image.resize((new_width, new_height), resample)
                        save_image(working_image, max(quality, 40))

                compressed_bytes = buffer.getvalue()
                if len(compressed_bytes) < original_size and len(compressed_bytes) <= target_size:
                    logger.info(
                        "palette_from_image: compressed image from %d bytes to %d bytes (quality=%d)",
                        original_size,
                        len(compressed_bytes),
                        quality,
                    )
                    file_bytes = compressed_bytes
                    log_context["payload_bytes"] = len(file_bytes)
                    compressed_mime = "image/jpeg"
                    log_context["compressed"] = True
                else:
                    logger.info(
                        f"palette_from_image: compression did not reach target size (original={original_size}, result={len(compressed_bytes)})"
                    )
            except Exception as comp_err:
                logger.warning(f"palette_from_image: image compression failed: {comp_err}")

    # 参考 llm-request-example.html：使用 data URL 的 image_url 方式
    import base64
    import mimetypes
    mime, _ = mimetypes.guess_type(file.filename)
    if compressed_mime:
        mime = compressed_mime
    else:
        mime = mime or "image/png"
    b64 = base64.b64encode(file_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    def build_payload_preview(original_payload: Dict[str, Any]) -> Dict[str, Any]:
        preview_messages: List[Dict[str, Any]] = []
        for message in original_payload.get("messages", []):
            sanitized_contents: List[Dict[str, Any]] = []
            for piece in message.get("content", []):
                if isinstance(piece, dict) and piece.get("type") == "image_url":
                    sanitized_contents.append(
                        {
                            "type": "image_url",
                            "image_url": {
                                "mime": mime,
                                "bytes": len(file_bytes),
                                "base64_omitted": True,
                            },
                        }
                    )
                elif isinstance(piece, dict) and piece.get("type") == "text":
                    text_value = str(piece.get("text", ""))[:500]
                    sanitized_contents.append({"type": "text", "text": text_value})
            preview_messages.append(
                {
                    "role": message.get("role"),
                    "content": sanitized_contents,
                }
            )
        return {
            "model": original_payload.get("model"),
            "response_format": original_payload.get("response_format"),
            "stream": original_payload.get("stream"),
            "messages": preview_messages,
        }

    payload = {
        "model": (llm_nested.get("default_model") or llm_nested.get("model") or tenant_settings.get("llm_default_model") or settings.llm_default_model or "gpt-4.1"),
        "messages": [
            {"role": "system", "content": "你是服装配色顾问，只输出JSON，无多余文字。"},
            {"role": "user", "content": [
                {"type": "text", "text": str(prompt)},
                {"type": "image_url", "image_url": {"url": data_url}}
            ]}
        ],
        "response_format": {"type": "json_object"},
        "stream": False
    }

    target_url = f"{llm_service_url.rstrip('/')}{llm_vision_path}"
    log_context["target_url"] = target_url
    log_context["model"] = payload.get("model")
    log_context["request_preview"] = build_payload_preview(payload)

    def _finalize_palette_response(content: Dict[str, Any]):
        charge_model_usage(db, current_user, "/llm/palette_from_image", payload.get("model") or "unknown")
        return JSONResponse(content=content)

    _ensure_sufficient_credit(db, current_user, payload.get("model") or "unknown", "/llm/palette_from_image")

    try:
        response_preview: Optional[str] = None
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                target_url,
                headers={
                    "Authorization": f"Bearer {llm_api_key}",
                    "Content-Type": "application/json"
                },
                json=payload
            )
            text = resp.text
            response_preview = text[:2000]
            # 兼容不同LLM响应结构，尽力提取JSON
            data = None
            try:
                data = resp.json()
            except Exception:
                pass
            # 常见OpenAI样式
            if isinstance(data, dict):
                content = None
                try:
                    content = data.get("choices", [{}])[0].get("message", {}).get("content")
                except Exception:
                    content = None
                if isinstance(content, str):
                    try:
                        return _finalize_palette_response(json.loads(content))
                    except Exception:
                        return _finalize_palette_response({"groups": []})
            # 回退：直接尝试将文本解析为JSON
            try:
                return _finalize_palette_response(json.loads(text))
            except Exception:
                return _finalize_palette_response({"groups": []})
    except Exception as e:
        if response_preview is not None:
            log_context["response_preview"] = response_preview
        logger.exception("palette_from_image 调用失败: %s | context=%s", e, log_context)
        raise HTTPException(status_code=500, detail="Palette generation failed")

    if not payload.get("model"):
        payload["model"] = llm_default_model

    headers = {
        "Authorization": f"Bearer {llm_api_key}",
        "Content-Type": "application/json"
    }

    logger.info(f"转发LLM请求到: {target_url}")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(target_url, json=payload, headers=headers)
    except httpx.TimeoutException as exc:
        logger.error(f"LLM服务请求超时: {exc}")
        raise HTTPException(status_code=504, detail="LLM service timeout")
    except httpx.HTTPError as exc:
        logger.error(f"LLM服务请求错误: {exc}")
        raise HTTPException(status_code=502, detail="LLM service request failed")

    logger.info(f"LLM响应状态码: {response.status_code}")

    if response.status_code >= 400:
        try:
            error_payload = response.json()
        except Exception:
            error_payload = {"detail": response.text}
        logger.error(f"LLM服务返回错误: {error_payload}")
        return JSONResponse(content=error_payload, status_code=response.status_code)

    try:
        data = response.json()
    except ValueError:
        logger.error("LLM响应非JSON格式")
        return JSONResponse(
            content={"error": "Invalid response from LLM service", "raw_response": response.text},
            status_code=response.status_code
        )

    return JSONResponse(content=data, status_code=response.status_code)


@router.post("/llm/poloapi/image_chat")
async def poloapi_image_chat(
    prompt: str = Form(..., description="文本提示，不能为空"),
    files: List[UploadFile] = File(..., description="1-9 张图片"),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    直接将 prompt 与多张图片转发至 PoloAPI 。返回其 JSON 响应。
    """

    logger = get_proxy_logger()
    prompt_value = (prompt or "").strip()
    if not prompt_value:
        raise HTTPException(status_code=400, detail="prompt is required")

    if not files or len(files) == 0:
        raise HTTPException(status_code=400, detail="至少上传一张图片")
    if len(files) > 9:
        raise HTTPException(status_code=400, detail="一次最多支持 9 张图片")

    images_payload: List[Tuple[bytes, str]] = []
    for file in files:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail=f"图片 {file.filename or ''} 内容为空")
        images_payload.append((file_bytes, file.content_type or "image/jpeg"))

    model_name = resolve_poloapi_model(
        fallback_model=settings.poloapi_image_model or settings.poloapi_default_model,
        mode="image",
    )
    _ensure_sufficient_credit(db, current_user, model_name, "/llm/poloapi/image_chat")

    try:
        response = await call_poloapi_image_chat(prompt_value, images_payload, model=model_name)
    except PoloAPIError as exc:
        logger.error("PoloAPI 调用失败: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    log_poloapi_usage(
        db,
        user_id=_get_username(current_user),
        endpoint="/llm/poloapi/image_chat",
        model=model_name,
        prompt=prompt_value,
        response_text=_sanitize_poloapi_text(_extract_poloapi_text(response)),
    )

    charge_model_usage(db, current_user, "/llm/poloapi/image_chat", model_name)
    return response


@router.post("/llm/poloapi/chat")
async def poloapi_chat(
    prompt: str = Form(..., description="文本提示，不能为空"),
    files: Optional[List[UploadFile]] = File(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    使用 PoloAPI 调用 Gemini 2.5 Flash（支持可选图片）。
    """

    logger = get_proxy_logger()
    prompt_value = (prompt or "").strip()
    if not prompt_value:
        raise HTTPException(status_code=400, detail="prompt is required")

    images_payload: List[Tuple[bytes, str]] = []
    for file in files or []:
        file_bytes = await file.read()
        if not file_bytes:
            raise HTTPException(status_code=400, detail=f"图片 {file.filename or ''} 内容为空")
        normalized_bytes, normalized_mime = _prepare_llm_upload_image(
            file_bytes,
            filename=file.filename,
            content_type=file.content_type,
        )
        images_payload.append((normalized_bytes, normalized_mime))

    model_name = resolve_poloapi_model(
        fallback_model=(
            settings.poloapi_image_model
            if images_payload
            else settings.poloapi_text_model
        ) or settings.poloapi_default_model,
        mode="image" if images_payload else "text",
    )
    _ensure_sufficient_credit(db, current_user, model_name, "/llm/poloapi/chat")

    try:
        response = await call_poloapi_image_chat(
            prompt_value,
            images_payload if images_payload else None,
            model=model_name,
        )
    except PoloAPIError as exc:
        logger.error("PoloAPI 调用失败: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    log_poloapi_usage(
        db,
        user_id=_get_username(current_user),
        endpoint="/llm/poloapi/chat",
        model=model_name,
        prompt=prompt_value,
        response_text=_sanitize_poloapi_text(_extract_poloapi_text(response)),
    )

    charge_model_usage(db, current_user, "/llm/poloapi/chat", model_name)
    return {"text": _extract_poloapi_text(response), "raw": response}


async def _poloapi_chat_messages_impl(
    request: Request,
    current_user,
    db: Session,
    *,
    endpoint: str,
    model_mode: Literal["text", "audit"],
    allow_images: bool = True,
) -> Dict[str, Any]:
    logger = get_proxy_logger()
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid request body")

    messages = payload.get("messages")
    if not isinstance(messages, list) or len(messages) == 0:
        raise HTTPException(status_code=400, detail="messages is required")
    passthrough = bool(payload.get("passthrough"))
    debug_mode = bool(payload.get("debug"))
    requested_model = payload.get("model")
    if not isinstance(requested_model, str):
        requested_model = None
    response_format = payload.get("response_format")
    if not isinstance(response_format, dict):
        response_format = None
    temperature = payload.get("temperature")
    if not isinstance(temperature, (int, float)):
        temperature = None

    system_prompt = (
        "You are a professional design assistant for a tool called Fasium. "
        "Help users with their creative projects. Be concise and inspiring. "
        "If the user message includes note content, treat those notes as important design guidance or reminders "
        "and prioritize them when reasoning and advising."
    )
    if (not passthrough) and (not any(isinstance(msg, dict) and msg.get("role") == "system" for msg in messages)):
        messages = [{"role": "system", "content": system_prompt}, *messages]

    project_id = payload.get("projectId")
    asset_ids = payload.get("assetIds") or []
    image_refs = payload.get("imageRefs") or []
    images_payload: List[Tuple[bytes, str]] = []
    image_paths: List[str] = []
    if allow_images and (not passthrough) and project_id and asset_ids:
        from ..services.task_record_service import task_record_service
        from ..services.project_team_service import project_team_service

        username = _get_username(current_user)
        project = task_record_service.get_project_by_id(project_id, db)
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")

        is_owner = project.get("user_id") == username
        if not is_owner:
            member = project_team_service.get_member_entry(project_id, username)
            if not member:
                raise HTTPException(status_code=403, detail="无权访问该项目")

        content = project.get("project_content") or {}
        board = content.get("board") or {}
        canvas_assets = board.get("canvasAssets") or []
        if not isinstance(canvas_assets, list):
            canvas_assets = []
        logger.info(
            "PoloAPI chat assets project=%s asset_ids=%s canvas_assets=%s",
            project_id,
            asset_ids,
            len(canvas_assets),
        )
        asset_map = {item.get("id"): item for item in canvas_assets if isinstance(item, dict)}
        for asset_id in asset_ids:
            asset = asset_map.get(asset_id)
            if not asset:
                logger.warning("PoloAPI chat asset not found: %s", asset_id)
                continue
            url = asset.get("url")
            if not url:
                logger.warning("PoloAPI chat asset missing url: %s", asset_id)
                continue
            if isinstance(url, str) and url.startswith("data:"):
                decoded = _decode_data_url(url)
                if decoded:
                    images_payload.append(decoded)
                else:
                    logger.warning("PoloAPI chat asset data url decode failed: %s", asset_id)
                continue
            decoded = await _resolve_chat_image_reference(url)
            if not decoded:
                logger.warning("PoloAPI chat asset image reference unresolved: %s url=%s", asset_id, url)
                continue
            images_payload.append(decoded)
            image_paths.append(str(url))
        logger.info("PoloAPI chat images collected: %s", len(images_payload))

    if allow_images and isinstance(image_refs, list) and image_refs:
        resolved_refs = 0
        for ref in image_refs:
            if not isinstance(ref, str) or not ref.strip():
                continue
            decoded = await _resolve_chat_image_reference(ref)
            if not decoded:
                logger.warning("PoloAPI chat image reference unresolved: %s", ref)
                continue
            payload_bytes, mime_type = decoded
            images_payload.append((payload_bytes, mime_type))
            image_paths.append(ref.strip())
            resolved_refs += 1
        if resolved_refs:
            logger.info("PoloAPI chat image refs collected: %s", resolved_refs)

    if allow_images:
        # Persist inline base64 images from incoming messages before forwarding to PoloAPI.
        # In passthrough mode, do not mutate caller payload.
        inline_saved = 0
        for message in messages:
            if not isinstance(message, dict) or message.get("role") != "user":
                continue
            content = message.get("content")
            if not isinstance(content, list):
                continue
            for part in content:
                if not isinstance(part, dict):
                    continue
                image_url_block = part.get("image_url")
                if isinstance(image_url_block, dict):
                    raw_url = image_url_block.get("url")
                elif isinstance(image_url_block, str):
                    raw_url = image_url_block
                else:
                    raw_url = None
                if not isinstance(raw_url, str) or not raw_url.startswith("data:image/"):
                    continue
                decoded = _decode_data_url(raw_url)
                if not decoded:
                    logger.warning("PoloAPI chat inline image decode failed")
                    continue
                payload_bytes, mime_type = decoded
                saved_path = _save_inline_data_image(payload_bytes, mime_type)
                if saved_path:
                    image_paths.append(str(saved_path))
                    inline_saved += 1
                if not passthrough:
                    # Normalize to a clean data URL before upstream forwarding.
                    part["image_url"] = {"url": _build_data_url(payload_bytes, mime_type)}
        if inline_saved:
            logger.info("PoloAPI chat inline images persisted: %s", inline_saved)

        if images_payload:
            for idx in range(len(messages) - 1, -1, -1):
                message = messages[idx]
                if isinstance(message, dict) and message.get("role") == "user":
                    content = message.get("content")
                    if isinstance(content, list):
                        parts = content
                    elif isinstance(content, str):
                        parts = [{"type": "text", "text": content}]
                    else:
                        parts = []
                    for image_bytes, mime_type in images_payload:
                        parts.append({"type": "image_url", "image_url": {"url": _build_data_url(image_bytes, mime_type)}})
                    message["content"] = parts
                    logger.info("PoloAPI chat appended images to user message")
                    break

    model_name = resolve_poloapi_model(
        requested_model=requested_model,
        fallback_model=(
            settings.poloapi_audit_model
            if model_mode == "audit"
            else settings.poloapi_text_model
        )
        or settings.poloapi_default_model,
        mode=model_mode,
    )
    msg_summary = _summarize_chat_messages(messages)
    logger.info(
        "PoloAPI chat forward summary model=%s passthrough=%s messages=%s image_parts=%s text_parts=%s",
        model_name,
        passthrough,
        msg_summary.get("count"),
        msg_summary.get("image_parts"),
        msg_summary.get("text_parts"),
    )
    debug_snapshot_path: Optional[str] = None
    if debug_mode:
        snapshot = _build_chat_debug_snapshot(messages, model_name)
        saved = _save_chat_debug_snapshot(snapshot)
        if saved:
            debug_snapshot_path = str(saved)
            logger.info("PoloAPI chat debug snapshot saved: %s", debug_snapshot_path)
        else:
            logger.warning("PoloAPI chat debug snapshot save failed")

    _ensure_sufficient_credit(db, current_user, model_name, endpoint)

    try:
        response = await call_poloapi_chat(
            messages,
            model=model_name,
            response_format=response_format,
            temperature=float(temperature) if temperature is not None else None,
            mode=model_mode,
        )
    except PoloAPIError as exc:
        logger.error("PoloAPI 调用失败: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    log_poloapi_usage(
        db,
        user_id=_get_username(current_user),
        endpoint=endpoint,
        model=model_name,
        prompt=json.dumps(_redact_message_images(messages), ensure_ascii=False),
        response_text=_sanitize_poloapi_text(_extract_poloapi_text(response)),
        image_paths=sorted(set(image_paths)) if image_paths else None,
    )

    charge_model_usage(db, current_user, endpoint, model_name)
    result: Dict[str, Any] = {"text": _extract_poloapi_text(response), "raw": response}
    if debug_mode:
        result["debug"] = {
            "forwarded_model": model_name,
            "passthrough": passthrough,
            "summary": msg_summary,
            "snapshot_path": debug_snapshot_path,
        }
    return result


@router.post("/llm/poloapi/chat_messages")
async def poloapi_chat_messages(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    使用 OpenAI 风格 messages 调用 PoloAPI（主业务链路）。
    """

    return await _poloapi_chat_messages_impl(
        request,
        current_user,
        db,
        endpoint="/llm/poloapi/chat_messages",
        model_mode="text",
    )


@router.post("/llm/poloapi/chat_messages_audit")
async def poloapi_chat_messages_audit(
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    使用 OpenAI 风格 messages 调用 PoloAPI（安全审核专用链路）。
    """

    return await _poloapi_chat_messages_impl(
        request,
        current_user,
        db,
        endpoint="/llm/poloapi/chat_messages_audit",
        model_mode="audit",
        # DeepSeek audit is text-only, so skip all image_url attachment logic here.
        allow_images=False,
    )


@router.post("/llm/sheet/technical_sketches")
async def sheet_technical_sketches(
    payload: SheetBriefRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    brief = payload.brief
    if brief is None:
        raise HTTPException(status_code=400, detail="brief is required")

    logger = get_proxy_logger()
    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]

    logger.info(
        "LLM技术草图请求开始 user=%s tenant=%s desc_len=%s image_count=%s",
        username,
        tenant_id,
        len(brief.description or ""),
        len(brief.designImages or []),
    )

    try:
        llm_config = _resolve_llm_config(current_user, db)
    except HTTPException as exc:
        logger.exception(
            "LLM配置解析失败 user=%s tenant=%s status=%s detail=%s",
            username,
            tenant_id,
            getattr(exc, "status_code", "unknown"),
            getattr(exc, "detail", None),
        )
        raise
    except Exception:
        logger.exception("LLM配置解析未知错误 user=%s tenant=%s", username, tenant_id)
        raise

    results: Dict[str, Any] = {}
    for view in ("front", "back"):
        prompt = _technical_sketch_prompt(view, brief)
        _ensure_sufficient_credit(db, current_user, llm_config.default_model, "/llm/sheet/technical_sketches")
        try:
            sketch = await _call_llm_json(
                llm_config,
                system_prompt=SYSTEM_PROMPT_SKETCH,
                user_prompt=prompt,
                images=brief.designImages,
                schema_name=f"{view}Sketch",
                schema=SKETCH_RESPONSE_SCHEMA,
                log_context={
                    "endpoint": "sheet_technical_sketches",
                    "view": view,
                    "user": username,
                    "tenant": tenant_id,
                },
            )
        except HTTPException as exc:
            logger.exception(
                "LLM技术草图请求失败 user=%s tenant=%s view=%s status=%s detail=%s",
                username,
                tenant_id,
                view,
                getattr(exc, "status_code", "unknown"),
                getattr(exc, "detail", None),
            )
            raise
        except Exception:
            logger.exception(
                "LLM技术草图请求未知错误 user=%s tenant=%s view=%s", username, tenant_id, view
            )
            raise
        if not isinstance(sketch, dict):
            raise HTTPException(status_code=502, detail="LLM returned invalid sketch payload")
        results[view] = {
            "image": sketch.get("image"),
            "annotations": sketch.get("annotations") or [],
        }
        charge_model_usage(db, current_user, "/llm/sheet/technical_sketches", llm_config.default_model)

    logger.info(
        "LLM技术草图完成 user=%s tenant=%s annotations=%s",
        username,
        tenant_id,
        {
            view: len(sketch_payload.get("annotations", []))
            for view, sketch_payload in results.items()
        },
    )
    return results


@router.post("/llm/sheet/lining_sketch")
async def sheet_lining_sketch(
    payload: SheetBriefRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    brief = payload.brief
    if brief is None:
        raise HTTPException(status_code=400, detail="brief is required")
    if not brief.designImages or not LINING_REGEX.search(brief.description or ""):
        return None

    llm_config = _resolve_llm_config(current_user, db)
    _ensure_sufficient_credit(db, current_user, llm_config.default_model, "/llm/sheet/lining_sketch")
    response = await _call_llm_json(
        llm_config,
        system_prompt=SYSTEM_PROMPT_SKETCH,
        user_prompt=_lining_prompt(brief),
        images=brief.designImages,
        schema_name="liningSketch",
        schema=SKETCH_RESPONSE_SCHEMA,
        log_context={
            "endpoint": "sheet_lining_sketch",
            "user": current_user.username if settings.is_database_storage() else current_user["username"],
            "tenant": current_user.tenant_id if settings.is_database_storage() else current_user["tenant_id"],
        },
    )
    charge_model_usage(db, current_user, "/llm/sheet/lining_sketch", llm_config.default_model)
    return response


@router.post("/llm/sheet/tech_pack")
async def sheet_tech_pack(
    payload: SheetTechPackRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    brief = payload.brief
    if brief is None:
        raise HTTPException(status_code=400, detail="brief is required")

    logger = get_proxy_logger()
    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]

    logger.info(
        "LLM tech pack 请求开始 user=%s tenant=%s desc_len=%s materials=%s images=%s",
        username,
        tenant_id,
        len(brief.description or ""),
        len(brief.materials or []),
        len(brief.designImages or []),
    )

    try:
        llm_config = _resolve_llm_config(current_user, db)
    except HTTPException as exc:
        logger.exception(
            "LLM配置解析失败 user=%s tenant=%s status=%s detail=%s",
            username,
            tenant_id,
            getattr(exc, "status_code", "unknown"),
            getattr(exc, "detail", None),
        )
        raise
    except Exception:
        logger.exception("LLM配置解析未知错误 user=%s tenant=%s", username, tenant_id)
        raise

    prompt = _build_detailed_prompt_text(brief, TECH_PACK_PURPOSE)
    _ensure_sufficient_credit(db, current_user, llm_config.default_model, "/llm/sheet/tech_pack")
    try:
        response = await _call_llm_json(
            llm_config,
            system_prompt=SYSTEM_PROMPT_TECH_PACK,
            user_prompt=prompt,
            images=brief.designImages,
            schema_name="TechPack",
            schema=TECH_PACK_RESPONSE_SCHEMA,
            log_context={
                "endpoint": "sheet_tech_pack",
                "user": username,
                "tenant": tenant_id,
            },
        )
    except HTTPException as exc:
        logger.exception(
            "LLM tech pack 请求失败 user=%s tenant=%s status=%s detail=%s",
            username,
            tenant_id,
            getattr(exc, "status_code", "unknown"),
            getattr(exc, "detail", None),
        )
        raise
    except Exception:
        logger.exception("LLM tech pack 请求未知错误 user=%s tenant=%s", username, tenant_id)
        raise

    logger.info(
        "LLM tech pack 请求完成 user=%s tenant=%s keys=%s",
        username,
        tenant_id,
        list(response.keys()) if isinstance(response, dict) else "non-dict",
    )
    charge_model_usage(db, current_user, "/llm/sheet/tech_pack", llm_config.default_model)
    return response


@router.post("/llm/sheet/cost_estimation")
async def sheet_cost_estimation(
    payload: SheetCostEstimationRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    brief = payload.brief
    tech_pack = payload.techPack
    if brief is None or tech_pack is None:
        raise HTTPException(status_code=400, detail="brief and techPack are required")

    llm_config = _resolve_llm_config(current_user, db)
    prompt = _build_cost_prompt(brief, tech_pack)
    _ensure_sufficient_credit(db, current_user, llm_config.default_model, "/llm/sheet/cost_estimation")
    response = await _call_llm_json(
        llm_config,
        system_prompt=SYSTEM_PROMPT_COST,
        user_prompt=prompt,
        images=brief.designImages,
        schema_name="CostEstimation",
        schema=COST_RESPONSE_SCHEMA,
        log_context={
            "endpoint": "sheet_cost_estimation",
            "user": current_user.username if settings.is_database_storage() else current_user["username"],
            "tenant": current_user.tenant_id if settings.is_database_storage() else current_user["tenant_id"],
        },
    )
    charge_model_usage(db, current_user, "/llm/sheet/cost_estimation", llm_config.default_model)
    return response


@router.post("/llm/gemini/chat")
async def gemini_chat_completion(
    payload: Dict[str, Any] = Body(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Proxies OpenAI-compatible chat completion payloads to Gemini 2.5 Flash.
    """
    logger = get_proxy_logger()
    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]

    api_key = settings.gemini_api_key
    base_url = (settings.gemini_base_url or "").rstrip("/")
    default_model = settings.gemini_default_model or "gemini-2.5-flash"

    if not api_key or not base_url:
        logger.error("Gemini配置缺失 user=%s tenant=%s", username, tenant_id)
        raise HTTPException(status_code=500, detail="Gemini service is not configured")

    request_body = dict(payload or {})
    request_body.setdefault("model", default_model)
    if "messages" not in request_body or not isinstance(request_body["messages"], list):
        raise HTTPException(status_code=400, detail="messages array is required")

    _ensure_sufficient_credit(db, current_user, request_body.get("model") or default_model, "/llm/gemini/chat")

    target_url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "x-goog-api-key": api_key,
        "Content-Type": "application/json",
    }

    logger.info(
        "Gemini chat proxy开始 user=%s tenant=%s model=%s",
        username,
        tenant_id,
        request_body.get("model"),
    )

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(target_url, headers=headers, json=request_body)

    text_content = response.text
    try:
        json_content = response.json()
    except ValueError:
        json_content = None

    if response.status_code >= 400:
        logger.error(
            "Gemini chat proxy失败 status=%s body=%s",
            response.status_code,
            _truncate_for_log(text_content),
        )
        detail = json_content or text_content or "Gemini request failed"
        raise HTTPException(status_code=response.status_code, detail=detail)

    logger.info(
        "Gemini chat proxy成功 user=%s tenant=%s status=%s",
        username,
        tenant_id,
        response.status_code,
    )

    charge_model_usage(db, current_user, "/llm/gemini/chat", payload.get("model") or default_model)
    if json_content is not None:
        return JSONResponse(content=json_content, status_code=response.status_code)
    return JSONResponse(
        content={"raw_response": text_content},
        status_code=response.status_code,
    )


@router.post("/agent/tools")
async def recommend_tool_sequence(
    payload: ToolAgentRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    根据 /tools 的列表，调用 Gemini 2.5 Flash（OpenRouter）生成工具调用顺序。
    """
    logger = get_proxy_logger()
    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]

    api_key = settings.gemini_api_key
    base_url = (settings.gemini_base_url or "").rstrip("/")
    default_model = settings.gemini_default_model or "google/gemini-2.5-flash"

    if not api_key or not base_url:
        logger.error("Tool agent Gemini配置缺失 user=%s tenant=%s", username, tenant_id)
        raise HTTPException(status_code=500, detail="Gemini service is not configured")

    tool_lines: List[str] = []
    for tool in payload.tools:
        descriptors = [tool.displayName or tool.name]
        if tool.category:
            descriptors.append(tool.category)
        if tool.focus:
            descriptors.append(tool.focus)

        desc = " / ".join(filter(None, descriptors))
        detail = tool.description or ""
        impact = tool.impact or ""
        href = tool.href or ""
        line = f"- {desc} [{href}]：{detail}"
        if impact:
            line += f"（效果：{impact}）"
        tool_lines.append(line)

    history_lines = ""
    if payload.history:
        trimmed_history = payload.history[:5]
        history_lines = "\n历史对话（可选参考）：\n" + "\n".join(
            f"- {json.dumps(item, ensure_ascii=False)}" for item in trimmed_history
        )

    text_question = payload.question.strip() if payload.question else ""
    user_prompt = (
        f"用户问题：{text_question or '（无文本问题，参考附带图片）'}\n"
        f"可用工具列表：\n{chr(10).join(tool_lines)}\n"
        "请只从上面名单选择工具，组合成最短的可执行路径，避免重复。"
        f"{history_lines}"
    )

    system_prompt = (
        "你是 Fasium 的工具编排助手，只能推荐列表里的功能。"
        "请输出 JSON 对象：{"
        "\"summary\": \"一句话概括方案与价值\","
        "\"plan\": ["
        "{ \"tool\": \"工具显示名\", \"href\": \"/path\", \"reason\": \"选择原因\", \"steps\": [\"执行顺序中的具体动作\"] }"
        "],"
        "\"missingInfo\": [\"缺失的关键信息，若无则返回空数组\"]"
        "}。"
        "若没有匹配的功能，plan 置为空，并在 summary 说明原因。"
    )

    user_message_content: List[Any] = [{"type": "text", "text": user_prompt}]
    if payload.image_data_url:
        user_message_content.append(
            {"type": "image_url", "image_url": {"url": payload.image_data_url}}
        )

    request_body: Dict[str, Any] = {
        "model": default_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message_content},
        ],
        "temperature": 0.4,
        "response_format": {"type": "json_object"},
    }

    target_url = f"{base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if settings.openrouter_referer:
        headers["HTTP-Referer"] = settings.openrouter_referer
    if settings.openrouter_title:
        headers["X-Title"] = settings.openrouter_title

    _ensure_sufficient_credit(db, current_user, request_body.get("model") or default_model, "/agent/tools")

    logger.info(
        "工具编排请求开始 user=%s tenant=%s model=%s",
        username,
        tenant_id,
        request_body.get("model"),
    )

    async with httpx.AsyncClient(timeout=90.0) as client:
        response = await client.post(target_url, headers=headers, json=request_body)

    text_content = response.text
    try:
        json_content = response.json()
    except ValueError:
        json_content = None

    if response.status_code >= 400:
        logger.error(
            "工具编排失败 status=%s body=%s",
            response.status_code,
            _truncate_for_log(text_content),
        )
        detail = json_content or text_content or "Gemini request failed"
        raise HTTPException(status_code=response.status_code, detail=detail)

    parsed: Optional[Dict[str, Any]] = None
    if isinstance(json_content, dict):
        choice_content = (
            json_content.get("choices", [{}])[0] or {}
        ).get("message", {}).get("content")
        if isinstance(choice_content, str):
            try:
                parsed = json.loads(choice_content)
            except (json.JSONDecodeError, TypeError, ValueError):
                parsed = None

        if parsed is None and "choices" not in json_content:
            parsed = json_content

    if parsed is None and text_content:
        try:
            parsed = json.loads(text_content)
        except (json.JSONDecodeError, TypeError, ValueError):
            parsed = {"raw_response": text_content}

    logger.info(
        "工具编排成功 user=%s tenant=%s status=%s",
        username,
        tenant_id,
        response.status_code,
    )

    charge_model_usage(db, current_user, "/agent/tools", request_body.get("model") or default_model)
    return JSONResponse(content=parsed or {}, status_code=response.status_code)


@router.post("/llm/stripe_variations")
async def stripe_variations(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    根据前端传来的条纹RGB与宽度信息，向租户配置的LLM请求风格衍生方案。
    预期返回：{ "variations": [ { "title": "", "styleNote": "", "stripeUnits": [ { "color": {...}, "relativeWidth": 0.0 } ] }, ... ], "guidance": "" }
    """
    logger = get_proxy_logger()

    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]

    logger.info(f"LLM条纹衍生请求, 用户: {username}")

    if settings.is_json_storage():
        tenant = db.get_tenant_by_id(tenant_id)
    else:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    raw_settings = getattr(tenant, "settings", None) if settings.is_database_storage() else tenant.get("settings")
    tenant_settings = {}
    if raw_settings:
        if isinstance(raw_settings, dict):
            tenant_settings = raw_settings
        elif isinstance(raw_settings, str):
            try:
                tenant_settings = json.loads(raw_settings)
            except json.JSONDecodeError:
                tenant_settings = {}

    llm_nested = tenant_settings.get("llm") if isinstance(tenant_settings.get("llm"), dict) else {}
    llm_service_url = (
        llm_nested.get("service_url")
        or llm_nested.get("endpoint")
        or tenant_settings.get("llm_service_url")
        or tenant_settings.get("llm_endpoint")
        or settings.llm_service_url
    )
    llm_api_key = (
        llm_nested.get("api_key")
        or tenant_settings.get("llm_api_key")
        or settings.llm_api_key
    )
    llm_default_model = (
        llm_nested.get("default_model")
        or llm_nested.get("model")
        or tenant_settings.get("llm_default_model")
        or settings.llm_default_model
        or "gpt-4.1"
    )

    if not llm_service_url or not llm_api_key:
        raise HTTPException(status_code=500, detail="LLM service is not configured")

    try:
        body = await request.json()
    except Exception as exc:
        logger.error(f"解析条纹衍生请求JSON失败: {exc}")
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    stripe_units = body.get("stripeUnits") or []
    palette_groups = body.get("paletteGroups") or []
    target_count = body.get("targetCount") or 4

    if not isinstance(stripe_units, list) or len(stripe_units) == 0:
        raise HTTPException(status_code=400, detail="stripeUnits are required")

    def safe_round_width(value: float) -> float:
        try:
            return round(float(value), 2)
        except Exception:
            return 0.0

    normalized_units = []
    for unit in stripe_units:
        if not isinstance(unit, dict):
            continue
        color = unit.get("color") or {}
        width_px = unit.get("widthPx", 0)
        try:
            r = int(color.get("r", 0))
            g = int(color.get("g", 0))
            b = int(color.get("b", 0))
        except Exception:
            r = g = b = 0
        try:
            width_px = max(1, float(width_px))
        except Exception:
            width_px = 1.0
        normalized_units.append({
            "color": {"r": max(0, min(255, r)), "g": max(0, min(255, g)), "b": max(0, min(255, b))},
            "widthPx": safe_round_width(width_px),
        })

    if not normalized_units:
        raise HTTPException(status_code=400, detail="No valid stripe units provided")

    units_json = json.dumps(normalized_units, ensure_ascii=False)
    palette_json = json.dumps(palette_groups, ensure_ascii=False) if palette_groups else "[]"

    prompt = (
        "我们已经提取了一组条纹印花的最小循环单元，包含RGB颜色与相对宽度数据。"
        "请作为资深纺织图案设计师，基于这些信息构思新的艺术化条纹方案。你可以增减色带数量、调整颜色或宽度，"
        "但需要保持色彩协调、适合服装印花的风格，并确保每个方案的相对宽度可归一化。"
        "\n\n原始条纹单元（widthPx 为相对像素宽度）：\n"
        f"{units_json}\n"
        "\n如果有帮助，可参考这些协调配色组（可选）：\n"
        f"{palette_json}\n"
        "\n请输出一个JSON对象，格式如下：\n"
        '{ "variations": [ { "title": "方案名称", "styleNote": "风格说明", "stripeUnits": [ { "color": {"r":0-255,"g":0-255,"b":0-255}, "relativeWidth": 0.00 }, ... ] }, ... ], "guidance": "整体建议" }\n'
        "要求：\n"
        f"1. 给出 {target_count} 个左右的方案（如果灵感有限可少于此数，但至少2个）。\n"
        "2. 每个方案的 stripeUnits 至少包含 3 条色带，relativeWidth 为 0-1 的小数，并保证总和≈1（允许两位小数误差）。\n"
        "3. 可以引入新的颜色或调换顺序，但要与原始风格有联系。\n"
        "4. 仅返回JSON，不要加入额外解释或Markdown。\n"
    )

    payload = {
        "model": llm_default_model,
        "messages": [
            {"role": "system", "content": "你是资深纺织与印花设计师，只能输出JSON对象，不得添加多余文字。"},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.8,
        "response_format": {"type": "json_object"},
        "stream": False,
    }

    target_url = f"{llm_service_url.rstrip('/')}/chat/completions"

    def _finalize_stripe_response(content: Dict[str, Any]):
        charge_model_usage(db, current_user, "/llm/stripe_variations", llm_default_model)
        return JSONResponse(content=content)

    _ensure_sufficient_credit(db, current_user, llm_default_model, "/llm/stripe_variations")

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                target_url,
                headers={
                    "Authorization": f"Bearer {llm_api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.TimeoutException as exc:
        logger.error(f"LLM条纹衍生请求超时: {exc}")
        raise HTTPException(status_code=504, detail="LLM service timeout")
    except httpx.HTTPError as exc:
        logger.error(f"LLM条纹衍生请求失败: {exc}")
        raise HTTPException(status_code=502, detail="LLM service request failed")

    text = resp.text
    data = None
    try:
        data = resp.json()
    except Exception:
        data = None

    if resp.status_code >= 400:
        logger.error(f"LLM条纹衍生服务错误: {text}")
        if isinstance(data, dict):
            raise HTTPException(status_code=resp.status_code, detail=data)
        raise HTTPException(status_code=resp.status_code, detail=text or "LLM service error")

    if isinstance(data, dict):
        content = None
        try:
            content = data.get("choices", [{}])[0].get("message", {}).get("content")
        except Exception:
            content = None
        if isinstance(content, str):
            try:
                return _finalize_stripe_response(json.loads(content))
            except Exception as parse_err:
                logger.warning(f"解析LLM条纹内容失败，返回原始 choices: {parse_err}")
                return _finalize_stripe_response({"variations": []})

    try:
        parsed = json.loads(text)
        return _finalize_stripe_response(parsed)
    except Exception:
        logger.warning("LLM条纹衍生响应非JSON，返回空结果")
        return _finalize_stripe_response({"variations": []})

@router.post("/upload")
async def upload_file(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    return await proxy_to_runninghub(request, "upload", current_user, db)

@router.post("/generate")
async def generate_image(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    return await proxy_to_runninghub(request, "generate", current_user, db)

@router.get("/tasks/history")
async def get_task_history(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
    page: int = 1,
    limit: int = 10,
    task_type: str | None = None,
):
    """
    获取用户的任务历史记录
    """
    from ..services.task_record_service import task_record_service
    
    logger = get_proxy_logger()

    try:
        # 获取用户名
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        page = max(1, int(page or 1))
        limit = min(max(1, int(limit or 10)), 50)
        cache_id = _history_cache_key(username, page, limit, task_type, str(settings.storage_type))
        cached_history = cache_get_json(cache_id)
        if isinstance(cached_history, list):
            return cached_history

        logger.info(f"获取用户任务历史: {username}, 页码: {page}, 限制: {limit}")
        
        # 计算偏移量
        offset = (page - 1) * limit
        
        # 获取用户任务记录
        task_records = task_record_service.get_user_tasks(username, limit, db, offset, task_type)
        
        # 处理任务记录，添加图片URL
        history_items = [_build_history_item(record) for record in task_records]
        
        logger.info(f"返回 {len(history_items)} 条历史记录")
        cache_set_json(cache_id, history_items, ttl_seconds=5)
        return history_items
        
    except Exception as e:
        logger.error(f"获取任务历史失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取任务历史失败: {str(e)}")


@router.get("/broadcasts/active")
async def get_active_board_broadcasts(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _ = _get_username(current_user)
    if not settings.is_database_storage():
        return {"items": []}

    now = datetime.now(timezone.utc)
    items = (
        db.query(BoardBroadcastRecord)
        .filter(BoardBroadcastRecord.is_enabled.is_(True))
        .filter(BoardBroadcastRecord.starts_at <= now)
        .filter(BoardBroadcastRecord.ends_at >= now)
        .order_by(
            BoardBroadcastRecord.display_order.desc(),
            BoardBroadcastRecord.starts_at.desc(),
            BoardBroadcastRecord.id.desc(),
        )
        .all()
    )
    return {"items": [_serialize_board_broadcast(item) for item in items]}


@router.get("/projects")
async def list_projects(
    include_board: bool = True,
    include_shared: bool = False,
    page: int = 1,
    page_size: int = 10,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    列出当前用户的所有项目
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        username = _get_username(current_user)
        if _is_manager_user(current_user):
            employee_usernames = _list_manager_employee_usernames(db, username)
            projects = []
            for employee_username in employee_usernames:
                projects.extend(task_record_service.list_projects(employee_username, db))
        else:
            projects = task_record_service.list_projects(username, db)

        if include_shared:
            from ..services.project_team_service import project_team_service

            memberships = project_team_service.list_user_memberships(username) or []
            shared_projects: List[Dict[str, Any]] = []
            for membership in memberships:
                project_id = membership.get("project_id")
                if not project_id:
                    continue
                project = task_record_service.get_project_by_id(project_id, db)
                if not project:
                    continue
                project_owner = project.get("user_id")
                manager_can_view = _can_manager_view_project_owner(db, current_user, project_owner)
                if project_owner == username or manager_can_view:
                    continue
                shared_projects.append(project)

            merged: Dict[str, Dict[str, Any]] = {}
            for project in [*projects, *shared_projects]:
                project_id = project.get("project_id")
                if project_id:
                    merged[project_id] = project
            projects = list(merged.values())

        paginated = _paginate_projects(_sort_projects(projects), page, page_size)
        normalized = [
            _normalize_project_record(project, include_board=include_board)
            for project in paginated["items"]
        ]
        return {
            "projects": normalized,
            "page": paginated["page"],
            "page_size": paginated["page_size"],
            "total": paginated["total"],
            "total_pages": paginated["total_pages"],
        }
    except Exception as exc:
        logger.error(f"获取项目列表失败: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"获取项目列表失败: {str(exc)}")



@router.post("/projects", status_code=201)
async def create_project(
    payload: ProjectCreateRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    为当前用户创建一个新的项目记录
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        _ensure_not_manager_write(current_user)
        username = _get_username(current_user)
        project = task_record_service.create_project(
            user_id=username,
            project_content=payload.to_project_content(),
            project_id=payload.project_id,
            db=db,
        )

        if not project:
            raise HTTPException(status_code=500, detail="项目创建失败")

        normalized = _normalize_project_record(project)
        return {"project": normalized}
    except ValueError as exc:
        logger.warning(f"项目创建参数错误: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"创建项目失败: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"创建项目失败: {str(exc)}")


@router.patch("/projects/{project_id}")
async def update_project(
    project_id: str,
    payload: ProjectUpdateRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    更新项目内容（合并至 project_content）
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        _ensure_not_manager_write(current_user)
        username = _get_username(current_user)
        updates = payload.to_updates()
        if not updates:
            raise HTTPException(status_code=400, detail="No updates provided")

        updated_project = task_record_service.update_project_content(
            project_id=project_id,
            updates=updates,
            user_id=username,
            db=db,
        )

        if not updated_project:
            raise HTTPException(status_code=404, detail="项目不存在")

        normalized = _normalize_project_record(updated_project)
        return {"project": normalized}
    except ValueError as exc:
        logger.warning(f"更新项目失败（参数）: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"更新项目失败: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"更新项目失败: {str(exc)}")


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: str,
    payload: Optional[DeleteProjectRequest] = None,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    删除一个项目记录，但保留任务历史
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        _ensure_not_manager_write(current_user)
        username = _get_username(current_user)
        deleted = task_record_service.delete_project(
            project_id,
            username,
            payload.confirm_name if payload else None,
            db,
        )
        if not deleted:
            raise HTTPException(status_code=404, detail="项目不存在")
        return {"deleted": True, "project_id": project_id}
    except ValueError as exc:
        logger.warning(f"删除项目失败（参数）: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"删除项目失败: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"删除项目失败: {str(exc)}")


@router.post("/projects/{project_id}/tasks")
async def add_tasks_to_project(
    project_id: str,
    payload: ProjectTaskUpdateRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    将任务记录添加到项目中
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        _ensure_not_manager_write(current_user)
        username = _get_username(current_user)

        if not payload.task_ids:
            raise HTTPException(status_code=400, detail="task_ids 不能为空")

        updated_project = None
        for tenant_task_id in payload.task_ids:
            record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db)
            if not record or record.get("user_id") != username:
                logger.warning(f"任务 {tenant_task_id} 不属于用户 {username}，跳过")
                continue

            updated_project = task_record_service.add_task_to_project(
                project_id=project_id,
                tenant_task_id=tenant_task_id,
                user_id=username,
                db=db,
            )

        if updated_project is None:
            raise HTTPException(status_code=404, detail="未找到可添加的任务或项目")

        normalized = _normalize_project_record(updated_project)
        return {"project": normalized, "added": len(payload.task_ids)}
    except ValueError as exc:
        logger.warning(f"添加任务到项目失败: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"添加任务到项目失败: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"添加任务到项目失败: {str(exc)}")


@router.get("/projects/{project_id}/tasks")
async def get_project_tasks(
    project_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取项目下的所有任务，支持项目成员浏览
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    project = task_record_service.get_project_access_summary(project_id, db)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    project_owner = project.get("user_id")
    is_owner = project_owner == username
    manager_can_view = _can_manager_view_project_owner(db, current_user, project_owner)
    if not is_owner and not manager_can_view:
        member_entry = project_team_service.get_member_entry(project_id, username)
        if not member_entry:
            raise HTTPException(status_code=403, detail="无权查看该项目任务")

    normalized_task_ids = project.get("task_ids") or []
    if not isinstance(normalized_task_ids, list):
        normalized_task_ids = []

    tasks: List[Dict[str, Any]] = []
    if hasattr(db, "query") and normalized_task_ids:
        records = (
            db.query(TenantTaskRecord)
            .filter(TenantTaskRecord.tenant_task_id.in_(normalized_task_ids))
            .all()
        )
        record_map = {
            record.tenant_task_id: task_record_service._record_to_dict(record)
            for record in records
        }
        for tenant_task_id in normalized_task_ids:
            record = record_map.get(tenant_task_id)
            if record:
                tasks.append(_build_history_item(record))
    else:
        for tenant_task_id in normalized_task_ids:
            record = task_record_service.get_task_record_by_tenant_id(
                tenant_task_id, db
            )
            if record:
                tasks.append(_build_history_item(record))

    return {
        "project": {
            "project_id": project.get("project_id"),
            "user_id": project.get("user_id"),
            "project_content": {"task_ids": normalized_task_ids},
            "created_at": project.get("created_at"),
            "updated_at": project.get("updated_at"),
        },
        "tasks": tasks,
    }


@router.post("/projects/{project_id}/uploads", status_code=201)
async def upload_project_images(
    project_id: str,
    files: List[UploadFile] = File(..., description="要上传到项目的图片文件"),
    description: Optional[str] = Form(default=None, description="可选备注"),
    task_type: Optional[str] = Form(default="project_upload", description="记录使用的任务类型标记"),
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    在项目视图中手动上传图片并计入任务记录
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service
    from ..services.image_storage import image_storage_service

    logger = get_proxy_logger()
    username = _get_username(current_user)
    _ensure_not_manager_write(current_user)

    if not files:
        raise HTTPException(status_code=400, detail="请至少上传一张图片")

    project = task_record_service.get_project_by_id(project_id, db)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    is_owner = project.get("user_id") == username
    member_entry = None
    if not is_owner:
        member_entry = project_team_service.get_member_entry(project_id, username)
        if not member_entry or member_entry.get("permission") != "editor":
            raise HTTPException(status_code=403, detail="没有权限上传到该项目")

    final_description = description.strip() if isinstance(description, str) else None
    uploaded_records: List[Dict[str, Any]] = []

    for upload in files:
        try:
            payload = await upload.read()
        except Exception as exc:
            logger.error(f"读取上传文件失败: {exc}")
            raise HTTPException(status_code=500, detail="读取上传文件失败")
        finally:
            await upload.close()

        if not payload:
            raise HTTPException(
                status_code=400,
                detail=f"{upload.filename or '文件'} 内容为空，无法上传",
            )

        try:
            storage_entry = image_storage_service.store_uploaded_image(
                user_id=username,
                file_bytes=payload,
                original_filename=upload.filename,
                content_type=upload.content_type,
                subdir=None,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except Exception as exc:
            logger.error(f"保存上传文件失败: {exc}")
            raise HTTPException(status_code=500, detail="保存上传文件失败")

        runninghub_task_id = f"manual_upload_{uuid.uuid4().hex[:12]}"
        tenant_task_id = task_record_service.create_task_record(
            user_id=username,
            runninghub_task_id=runninghub_task_id,
            db=db,
            task_type=task_type or "project_upload",
            project_id=project_id,
        )

        upload_metadata = {
            "fileName": upload.filename,
            "contentType": upload.content_type,
            "storedAt": datetime.utcnow().isoformat(),
            "uploader": username,
            "projectId": project_id,
        }

        result_data = {
            "source": "project_upload",
            "projectId": project_id,
            "description": final_description,
            "uploads": [upload_metadata],
        }

        updated = task_record_service.update_task_success(
            tenant_task_id=tenant_task_id,
            result_data=result_data,
            storage_paths=[storage_entry],
            db=db,
        )

        if not updated:
            logger.error(f"更新任务记录失败: {tenant_task_id}")
            raise HTTPException(status_code=500, detail="更新任务记录失败")

        record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db)
        if record:
            uploaded_records.append(_build_history_item(record))

    refreshed_project = task_record_service.get_project_by_id(project_id, db)
    logger.info(
        f"用户 {username} 向项目 {project_id} 上传 {len(uploaded_records)} 个文件"
    )
    return {
        "project": _normalize_project_record(refreshed_project or project),
        "records": uploaded_records,
        "uploaded": len(uploaded_records),
    }


@router.delete("/projects/{project_id}/tasks")
async def remove_tasks_from_project(
    project_id: str,
    payload: ProjectTaskUpdateRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    将任务记录从项目中移除，但保留任务历史
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        _ensure_not_manager_write(current_user)
        username = _get_username(current_user)

        removed_count = 0
        for tenant_task_id in payload.task_ids:
            removed = task_record_service.remove_task_from_project(
                project_id=project_id,
                tenant_task_id=tenant_task_id,
                user_id=username,
                db=db,
            )
            if removed:
                removed_count += 1

        if removed_count == 0:
            raise HTTPException(status_code=404, detail="未找到可移除的任务或项目")

        updated_project = task_record_service.get_project_by_id(project_id, db)
        normalized = (
            _normalize_project_record(updated_project) if updated_project else None
        )
        return {"removed": removed_count, "project": normalized}
    except ValueError as exc:
        logger.warning(f"从项目移除任务失败: {exc}")
        raise HTTPException(status_code=400, detail=str(exc))
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"从项目移除任务失败: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"从项目移除任务失败: {str(exc)}")


@router.get("/projects/{project_id}/team")
async def get_project_team(
    project_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取项目的团队访问与邀请信息，仅限项目所有者查看
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    project = task_record_service.get_project_by_id(project_id, db)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    is_owner = project.get("user_id") == username
    member_entry = None
    if not is_owner:
        member_entry = project_team_service.get_member_entry(project_id, username)
        if not member_entry:
            raise HTTPException(status_code=403, detail="没有权限查看该项目团队")

    normalized_project = _normalize_project_record(project)

    members = project_team_service.list_members(project_id) or []
    invites = project_team_service.list_invites(project_id) if is_owner else []

    owner_member = {
        "access_id": f"owner_{project_id}",
        "project_id": project_id,
        "user_id": username,
        "permission": "owner",
        "granted_by_user_id": username,
        "granted_at": project.get("created_at"),
        "updated_at": project.get("updated_at"),
    }

    filtered_members = [member for member in members if member.get("user_id") != username]

    logger.info(f"用户 {username} 请求项目 {project_id} 团队信息")
    return {
        "project": normalized_project,
        "members": [owner_member, *filtered_members],
        "invites": invites,
        "can_manage": is_owner,
        "my_permission": (member_entry or owner_member).get("permission"),
    }


@router.post("/projects/{project_id}/team/members", status_code=201)
async def add_project_member(
    project_id: str,
    payload: ProjectTeamMemberPayload,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    授予其他用户访问项目的权限
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    project = task_record_service.get_project_by_id(project_id, db)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project.get("user_id") != username:
        raise HTTPException(status_code=403, detail="仅项目所有者可以管理团队")

    target_user = payload.user_id.strip()
    if not target_user:
        raise HTTPException(status_code=422, detail="user_id 不能为空")
    if target_user == username:
        raise HTTPException(status_code=400, detail="项目所有者已拥有访问权限")

    member = project_team_service.grant_member(
        project_id=project_id,
        user_id=target_user,
        granted_by_user_id=username,
        permission=payload.permission,
    )

    logger.info(f"用户 {username} 授予 {target_user} 项目 {project_id} 权限 {payload.permission}")
    return {"member": member}


@router.delete("/projects/{project_id}/team/members/{access_id}")
async def remove_project_member(
    project_id: str,
    access_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    移除项目访问成员
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    project = task_record_service.get_project_by_id(project_id, db)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project.get("user_id") != username:
        raise HTTPException(status_code=403, detail="仅项目所有者可以管理团队")
    if access_id.startswith("owner_"):
        raise HTTPException(status_code=400, detail="不能移除项目所有者")

    removed = project_team_service.revoke_member(access_id=access_id, project_id=project_id, user_id=None)
    if not removed:
        raise HTTPException(status_code=404, detail="未找到访问记录")

    logger.info(f"用户 {username} 移除访问记录 {access_id} (项目 {project_id})")
    return {"removed": True}


@router.post("/projects/{project_id}/team/invites", status_code=201)
async def create_project_invite(
    project_id: str,
    payload: ProjectInvitePayload,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    创建一个项目邀请记录
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    project = task_record_service.get_project_by_id(project_id, db)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    if project.get("user_id") != username:
        raise HTTPException(status_code=403, detail="仅项目所有者可以管理团队")

    target_user = payload.target_user_id.strip()
    if not target_user:
        raise HTTPException(status_code=422, detail="target_user_id 不能为空")

    expires_at = payload.expires_at.isoformat() if payload.expires_at else None
    message = payload.message.strip() if payload.message else None

    invite = project_team_service.create_invite(
        project_id=project_id,
        owner_user_id=username,
        target_user_id=target_user,
        permission=payload.permission,
        expires_at=expires_at,
        message=message,
    )

    logger.info(f"用户 {username} 邀请 {target_user} 访问项目 {project_id}")
    return {"invite": invite}


@router.get("/projects/shared")
async def list_shared_projects(
    include_board: bool = True,
    page: int = 1,
    page_size: int = 10,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取当前用户参与但非创建者的项目列表
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    memberships = project_team_service.list_user_memberships(username) or []
    results: List[Dict[str, Any]] = []

    for membership in memberships:
        project_id = membership.get("project_id")
        if not project_id:
            continue

        project = task_record_service.get_project_by_id(project_id, db)
        if not project:
            continue
        if project.get("user_id") == username:
            continue

        normalized = _normalize_project_record(project, include_board=include_board)
        results.append(
            {
                "project": normalized,
                "permission": membership.get("permission", "viewer"),
                "access_id": membership.get("access_id"),
            }
        )

    paginated = _paginate_projects(
        _sort_projects([entry.get("project") for entry in results if isinstance(entry.get("project"), dict)]),
        page,
        page_size,
    )

    permission_by_project_id = {
        entry["project"]["project_id"]: {
            "permission": entry.get("permission", "viewer"),
            "access_id": entry.get("access_id"),
        }
        for entry in results
        if isinstance(entry.get("project"), dict) and entry["project"].get("project_id")
    }

    paginated_results = []
    for project in paginated["items"]:
        project_id = project.get("project_id")
        membership = permission_by_project_id.get(project_id, {})
        normalized = _normalize_project_record(project, include_board=include_board)
        paginated_results.append(
            {
                "project": normalized,
                "permission": membership.get("permission", "viewer"),
                "access_id": membership.get("access_id"),
            }
        )

    logger.info(f"用户 {username} 获取共享项目列表，数量 {len(results)}")
    return {
        "projects": paginated_results,
        "page": paginated["page"],
        "page_size": paginated["page_size"],
        "total": paginated["total"],
        "total_pages": paginated["total_pages"],
    }


@router.get("/projects/invites")
async def list_pending_invites(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取当前用户待处理的项目邀请
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    invites = project_team_service.list_user_invites(username, status="pending")
    results: List[Dict[str, Any]] = []

    for invite in invites or []:
        project_id = invite.get("project_id")
        if not project_id:
            continue
        project = task_record_service.get_project_by_id(project_id, db)
        if not project:
            continue
        normalized = _normalize_project_record(project)
        results.append({"invite": invite, "project": normalized})

    logger.info(f"用户 {username} 获取待处理邀请列表，数量 {len(results)}")
    return {"invites": results}


@router.get("/projects/{project_id}")
async def get_project(
    project_id: str,
    include_board: bool = True,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取单个项目详情（默认包含画板）
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()

    try:
        username = _get_username(current_user)
        project = task_record_service.get_project_by_id(project_id, db)
        if not project:
            raise HTTPException(status_code=404, detail="项目不存在")
        project_owner = project.get("user_id")
        manager_can_view = _can_manager_view_project_owner(db, current_user, project_owner)
        if project_owner != username and not manager_can_view:
            membership = project_team_service.get_member_entry(project_id, username)
            if not membership:
                raise HTTPException(status_code=403, detail="无权限访问该项目")
        normalized = _normalize_project_record(project, include_board=include_board)
        return {"project": normalized}
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"获取项目详情失败: {str(exc)}")
        raise HTTPException(status_code=500, detail=f"获取项目详情失败: {str(exc)}")


@router.patch("/projects/{project_id}/team/invites/{invite_id}")
async def update_project_invite_status(
    project_id: str,
    invite_id: str,
    payload: ProjectInviteStatusPayload,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    更新邀请状态，可用于撤销、接受或拒绝
    """
    from ..services.task_record_service import task_record_service
    from ..services.project_team_service import project_team_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    project = task_record_service.get_project_by_id(project_id, db)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    invite = project_team_service.get_invite(invite_id)
    if not invite or invite.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="未找到邀请记录")

    is_owner = project.get("user_id") == username
    is_target = invite.get("target_user_id") == username

    if not is_owner and not is_target:
        raise HTTPException(status_code=403, detail="无权更新该邀请")

    if is_target and payload.status not in {"accepted", "declined"}:
        raise HTTPException(status_code=403, detail="只能接受或拒绝邀请")

    updated_invite = project_team_service.update_invite_status(invite_id, payload.status)
    if not updated_invite:
        raise HTTPException(status_code=500, detail="邀请状态更新失败")

    if payload.status == "accepted":
        target_user = invite.get("target_user_id")
        owner_user_id = invite.get("owner_user_id") or project.get("user_id")
        if target_user:
            project_team_service.grant_member(
                project_id=project_id,
                user_id=target_user,
                granted_by_user_id=owner_user_id,
                permission=invite.get("permission", "viewer"),
            )

    logger.info(f"用户 {username} 更新邀请 {invite_id} 状态为 {payload.status}")
    return {"invite": updated_invite}


@router.get("/tasks/history/types")
@router.get("/tasks/types")
async def get_task_types(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    获取用户任务历史中存在的所有任务类型
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        cache_id = _history_types_cache_key(username, str(settings.storage_type))
        cached_types = cache_get_json(cache_id)
        if isinstance(cached_types, dict) and isinstance(cached_types.get("types"), list):
            return cached_types

        logger.info(f"获取任务类型列表: {username}")

        types = task_record_service.get_user_task_types(username, db)
        payload = {"types": types}
        cache_set_json(cache_id, payload, ttl_seconds=10)
        return payload
    except Exception as e:
        logger.error(f"获取任务类型列表失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取任务类型失败: {str(e)}")

@router.get("/tasks/history/count")
async def get_task_history_count(
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
    task_type: str | None = None,
):
    """
    获取用户任务历史记录总数
    """ 
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        # 获取用户名
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        cache_id = _history_count_cache_key(username, task_type, str(settings.storage_type))
        cached_total = cache_get_json(cache_id)
        if isinstance(cached_total, dict) and "total" in cached_total:
            return cached_total

        logger.info(f"获取用户任务历史总数: {username}, 任务类型: {task_type or '全部'}")

        total = task_record_service.get_user_task_count(username, db, task_type)
        payload = {"total": total}
        cache_set_json(cache_id, payload, ttl_seconds=5)
        return payload
    except Exception as e:
        logger.error(f"获取任务历史总数失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取任务历史总数失败: {str(e)}")


@router.delete("/tasks/history")
async def delete_task_history(
    payload: DeleteTasksRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    删除用户的任务历史记录，可选按任务ID列表或任务类型筛选
    """
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(
            f"删除用户任务历史: {username}, task_ids={payload.task_ids}, task_type={payload.task_type}"
        )

        if not payload.task_ids and not payload.task_type:
            logger.warning("用户删除任务历史请求缺少筛选条件，默认为清空全部历史")

        deleted_count = task_record_service.delete_user_tasks(
            username,
            payload.task_ids,
            payload.task_type,
            db,
        )

        _invalidate_user_task_caches(username, payload.task_ids or None)
        return {"deleted": deleted_count}
    except Exception as e:
        logger.error(f"删除任务历史失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"删除任务历史失败: {str(e)}")


@router.post("/tasks/download_batch")
async def download_task_batch(
    payload: TaskBatchDownloadRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    打包任务存储的图片并返回 ZIP。
    """

    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()
    username = _get_username(current_user)

    record = task_record_service.get_task_record_by_tenant_id(payload.tenant_task_id, db)
    if not record:
        raise HTTPException(status_code=404, detail="Task record not found")
    owner_id = str(record.get("user_id") or "")
    if owner_id and owner_id != str(username):
        raise HTTPException(status_code=403, detail="Permission denied for this task")

    storage_entries = _normalize_storage_entries(record.get("storage_paths"))
    if not storage_entries:
        raise HTTPException(status_code=400, detail="Task does not contain stored files")

    output_root = Path(settings.output_storage_path).resolve()
    resolved_files: List[Path] = []
    for entry in storage_entries:
        resolved_path = _resolve_storage_file(entry.get("original"), output_root)
        if resolved_path:
            resolved_files.append(resolved_path)

    if not resolved_files:
        raise HTTPException(status_code=404, detail="No files found for this task")

    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for index, file_path in enumerate(resolved_files, start=1):
            arcname = f"{index:02d}_{file_path.name}"
            try:
                zip_file.write(file_path, arcname)
            except FileNotFoundError:
                logger.warning("文件不存在，跳过: %s", file_path)
                continue

    buffer.seek(0)
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", payload.batch_id or payload.tenant_task_id or "batch")
    headers = {
        "Content-Disposition": f'attachment; filename="{safe_name}.zip"',
    }
    return StreamingResponse(buffer, media_type="application/zip", headers=headers)

@router.get("/tasks/{task_id}")
async def get_task_status(task_id: str, request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    logger = get_proxy_logger()
    raw_id = task_id or ""
    decoded_id = unquote(raw_id).strip()
    if settings.is_database_storage():
        username = current_user.username
    else:
        username = current_user["username"]

    if _looks_like_embedded_payload(raw_id, decoded_id):
        from ..services.task_record_service import task_record_service

        # Auto cleanup is intentionally disabled to avoid accidental data loss.
        removed = 0

        logger.warning(
            f"检测到嵌套的 RunningHub 任务ID，已视为取消: user={username}, "
            f"runninghub_id={decoded_id}, removed={removed}"
        )

        message = "任务已取消并从记录中清理" if removed else "任务已取消"
        return {
            "taskId": None,
            "status": "CANCELLED",
            "message": message,
        }

    cache_id = _task_status_cache_key(username, decoded_id or raw_id, str(settings.storage_type))
    cached_status = cache_get_json(cache_id)
    if isinstance(cached_status, dict):
        return cached_status

    response = await proxy_to_runninghub(request, f"tasks/{task_id}", current_user, db)
    if isinstance(response, dict):
        cache_set_json(cache_id, response, ttl_seconds=2)
    return response

def _looks_like_embedded_payload(raw_id: str, decoded_id: str) -> bool:
    for candidate in (raw_id or "", decoded_id or ""):
        cleaned = candidate.strip()
        if not cleaned:
            continue
        if cleaned.startswith("%7B") or cleaned.startswith("%257B"):
            return True
        if cleaned.startswith("{") and ("taskId" in cleaned or "netWssUrl" in cleaned):
            return True
    return False

def _cleanup_corrupted_task_record(
    username: str,
    corrupted_runninghub_id: str,
    task_record_service,
    db,
) -> int:
    logger = get_proxy_logger()
    logger.warning(
        "Auto cleanup disabled: skip deleting records user=%s runninghub_id=%s",
        username,
        corrupted_runninghub_id,
    )
    return 0

@router.post("/tasks/refresh-status")
async def refresh_task_status(
    payload: RefreshTaskStatusRequest,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    from ..services.task_record_service import task_record_service

    logger = get_proxy_logger()
    tenant_task_ids = payload.tenant_task_ids or []

    if not tenant_task_ids:
        return {"tasks": [], "checked_ids": [], "updated_count": 0}

    if settings.is_database_storage():
        username = current_user.username
    else:
        username = current_user["username"]

    checked_ids: List[str] = []
    updated_count = 0
    updated_records: Dict[str, Dict[str, Any]] = {}
    removed_ids: List[str] = []
    now = datetime.utcnow()

    async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
        for tenant_task_id in tenant_task_ids:
            record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db)
            if not record:
                logger.warning(f"未找到任务记录: {tenant_task_id}")
                continue

            if record.get("user_id") != username:
                logger.warning(f"任务 {tenant_task_id} 不属于当前用户，跳过")
                continue

            checked_ids.append(tenant_task_id)
            task_type = str(record.get("task_type") or "").strip().lower()

            if task_type == "admaster_sora2_video":
                existing_status = (record.get("status") or "").upper()
                result_data = _safe_json_load(record.get("result_data")) or {}
                if not isinstance(result_data, dict):
                    result_data = {}

                if existing_status in SUCCESS_STATUSES.union(FAILED_STATUSES):
                    refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                    updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                    continue

                created_at = _parse_iso_datetime(record.get("created_at"))
                if created_at is not None:
                    created_naive = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
                    if now - created_naive > timedelta(minutes=40):
                        if task_record_service.update_task_failed(
                            tenant_task_id,
                            "Sora task timeout after 40 minutes",
                            db,
                        ):
                            updated_count += 1
                        refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                        updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                        continue

                upstream_task_id = (
                    result_data.get("upstream_task_id")
                    or record.get("runninghub_task_id")
                )
                api_key = (settings.poloapi_video_apikey or settings.poloapi_apikey or "").strip()
                if not upstream_task_id or not api_key:
                    logger.warning(f"Sora2 任务 {tenant_task_id} 缺少上游任务ID或API Key")
                    refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                    updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                    continue

                try:
                    response = await client.get(
                        f"{(settings.poloapi_video_base_url or settings.poloapi_base_url or 'https://work.poloapi.com/v1').rstrip('/')}/videos/{upstream_task_id}",
                        headers={"Accept": "application/json", "Authorization": api_key},
                    )
                    response.raise_for_status()
                    status_payload = _normalize_sora_status_payload(
                        response.json() if response.content else {}
                    )
                except Exception as exc:
                    logger.error(f"查询 Sora2 任务 {upstream_task_id} 状态失败: {exc}")
                    refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                    updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                    continue

                upstream_status = str((status_payload.get("status") or "")).strip().lower()
                if not upstream_status and status_payload.get("url") and status_payload.get("progress") == 100:
                    upstream_status = "completed"
                if upstream_status in {"queued", "pending", "running", "processing"}:
                    if existing_status != "RUNNING":
                        if task_record_service.update_task_status(tenant_task_id, "RUNNING", db):
                            updated_count += 1
                elif upstream_status in {"completed", "success"}:
                    video_url = status_payload.get("url")
                    if video_url:
                        if task_record_service.update_task_success(
                            tenant_task_id,
                            result_data={
                                **result_data,
                                "video_url": video_url,
                                "upstream_task_id": upstream_task_id,
                                "model": result_data.get("model") or status_payload.get("model") or settings.poloapi_video_model,
                                "seconds": result_data.get("seconds") or status_payload.get("seconds"),
                                "size": result_data.get("size") or status_payload.get("size"),
                                "status": "completed",
                            },
                            storage_paths=[],
                            db=db,
                        ):
                            updated_count += 1
                    else:
                        if task_record_service.update_task_failed(
                            tenant_task_id,
                            "Sora completed but missing video url",
                            db,
                        ):
                            updated_count += 1
                elif upstream_status in {"failed", "error", "cancelled", "canceled"}:
                    if task_record_service.update_task_failed(
                        tenant_task_id,
                        str(
                            status_payload.get("error")
                            or status_payload.get("error_message")
                            or status_payload.get("message")
                            or "Sora generation failed"
                        ),
                        db,
                    ):
                        updated_count += 1

                refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                continue

            if task_type == "board_video_generation":
                existing_status = (record.get("status") or "").upper()
                result_data = _safe_json_load(record.get("result_data")) or {}
                if not isinstance(result_data, dict):
                    result_data = {}

                if existing_status in SUCCESS_STATUSES.union(FAILED_STATUSES):
                    refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                    updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                    continue

                upstream_task_id = str(
                    result_data.get("upstream_task_id")
                    or record.get("runninghub_task_id")
                    or ""
                ).strip()
                if not upstream_task_id:
                    logger.warning(f"Board video 任务 {tenant_task_id} 缺少上游任务ID")
                    refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                    updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                    continue

                provider_kind = str(result_data.get("provider") or "").strip().lower()
                if provider_kind not in {"seedance", "vod"}:
                    provider_kind = _resolve_board_video_provider_kind(
                        result_data.get("model") if isinstance(result_data.get("model"), str) else None
                    )
                billing_model = str(result_data.get("billing_model") or "").strip()

                try:
                    provider = SeedanceVideoProvider() if provider_kind == "seedance" else VodVideoProvider()
                    if provider_kind == "seedance":
                        detail = await provider.describe_task(upstream_task_id)
                    else:
                        detail = provider.describe_task(upstream_task_id)
                    parsed = provider.parse_task_detail(detail)
                except (SeedanceVideoProviderError, VodVideoProviderError) as exc:
                    logger.error(f"查询 Board video 任务 {upstream_task_id} 状态失败: {exc}")
                    refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                    updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                    continue

                upstream_status = str(parsed.get("status") or "").upper()
                progress = parsed.get("progress")
                message = str(parsed.get("message") or "")

                if upstream_status == "FINISH":
                    err_code = int(parsed.get("err_code") or 0)
                    video_url = parsed.get("video_url")
                    if err_code or not video_url:
                        provider_label = "Seedance" if provider_kind == "seedance" else "VOD"
                        if task_record_service.update_task_failed(
                            tenant_task_id,
                            message or f"{provider_label} task failed with ErrCode={err_code}",
                            db,
                        ):
                            updated_count += 1
                    else:
                        try:
                            storage_entry = await provider.store_video_output(
                                user_id=username,
                                video_url=str(video_url),
                                task_id=upstream_task_id,
                            )
                        except Exception as exc:
                            logger.error(f"存储 Board video 任务 {upstream_task_id} 输出失败: {exc}")
                            if task_record_service.update_task_failed(
                                tenant_task_id,
                                f"Video storage failed: {exc}",
                                db,
                            ):
                                updated_count += 1
                            refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                            updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                            continue

                        if provider_kind == "seedance":
                            model_name = result_data.get("model") or "Seedance 2.0"
                            model_label = billing_model or f"ark:{getattr(provider, 'model_id', settings.seedance_model_id)}"
                            final_model = model_name
                        else:
                            model_name = (
                                (((parsed.get("detail") or {}).get("AigcVideoTask") or {}).get("Input") or {}).get("ModelName")
                                or provider.settings.vod_video_model_name
                                or "Kling"
                            )
                            model_version = (
                                (((parsed.get("detail") or {}).get("AigcVideoTask") or {}).get("Input") or {}).get("ModelVersion")
                                or provider.settings.vod_video_model_version
                                or "3.0-Omni"
                            )
                            model_label = billing_model or f"vod:{model_name}:{model_version}"
                            final_model = f"{model_name} {model_version}"

                        public_storage_entry = _public_storage_entry(storage_entry)
                        public_video_url = public_storage_entry.get("original") or storage_entry.get("original")
                        success_result_data = {
                            "status": "completed",
                            "video_url": public_video_url,
                            "transient_vod_url": video_url,
                            "upstream_task_id": upstream_task_id,
                            "provider": provider_kind,
                            "billing_model": model_label,
                            "model": final_model,
                            "metadata": parsed.get("metadata"),
                            "storage": public_storage_entry,
                        }
                        if task_record_service.update_task_success(
                            tenant_task_id,
                            result_data=success_result_data,
                            storage_paths=[storage_entry],
                            db=db,
                        ):
                            updated_count += 1
                        try:
                            charge_model_usage(db, current_user, "/board/video", model_label, tenant_task_id=tenant_task_id)
                            success_result_data["billing_charged"] = True
                            task_record_service.update_task_success(
                                tenant_task_id,
                                result_data=success_result_data,
                                storage_paths=[storage_entry],
                                db=db,
                            )
                        except Exception as exc:
                            logger.warning("Board video billing failed task_id=%s error=%s", tenant_task_id, exc)
                elif upstream_status in {"FAIL", "FAILED", "ERROR", "CANCELED", "CANCELLED"}:
                    if task_record_service.update_task_failed(
                        tenant_task_id,
                        message or "Board video generation failed",
                        db,
                    ):
                        updated_count += 1
                else:
                    if existing_status != "RUNNING" and task_record_service.update_task_status(tenant_task_id, "RUNNING", db):
                        updated_count += 1

                refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                if progress is not None and refreshed_record:
                    refreshed_record = {
                        **refreshed_record,
                        "result_data": {
                            **(_safe_json_load(refreshed_record.get("result_data")) or {}),
                            "progress": progress,
                        },
                    }
                updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                continue

            runninghub_task_id = record.get("runninghub_task_id")
            if not runninghub_task_id:
                logger.warning(f"任务 {tenant_task_id} 缺少 RunningHub 任务ID")
                continue

            timeout_seconds = int(settings.runninghub_task_timeout_seconds)
            if is_task_timed_out(record.get("created_at"), timeout_seconds, now=now):
                timeout_message = f"RunningHub task timeout after {timeout_seconds} seconds"
                logger.warning(
                    "任务 %s 已超时（%s 秒），标记为失败",
                    tenant_task_id,
                    timeout_seconds,
                )
                if task_record_service.update_task_failed(tenant_task_id, timeout_message, db):
                    updated_count += 1
                refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db) or record
                updated_records[tenant_task_id] = _build_history_item(refreshed_record)
                continue

            try:
                response = await client.get(f"{settings.runninghub_service_url}/v1/tasks/{runninghub_task_id}")
                response.raise_for_status()
                status_payload = response.json()
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    logger.info(
                        f"RunningHub 任务 {runninghub_task_id} 不存在，认为租户任务 {tenant_task_id} 已取消"
                    )
                    existing_status = (record.get("status") or "").upper()
                    if existing_status in RUNNING_STATUSES:
                        if task_record_service.update_task_failed(
                            tenant_task_id,
                            "Upstream task not found (404), record retained",
                            db,
                        ):
                            updated_count += 1
                            continue
                logger.error(
                    f"查询任务 {runninghub_task_id} 状态失败 (HTTP {exc.response.status_code}): {exc}"
                )
                continue
            except Exception as exc:
                logger.error(f"查询任务 {runninghub_task_id} 状态失败: {exc}")
                continue

            status_value = _extract_status(status_payload)
            if not status_value:
                logger.warning(f"无法解析任务 {runninghub_task_id} 状态: {status_payload}")
                continue

            normalized_status = status_value.upper()
            existing_status = (record.get("status") or "").upper()

            logger.info(f"任务 {tenant_task_id} 状态: {existing_status} -> {normalized_status}")

            if normalized_status in SUCCESS_STATUSES:
                try:
                    if enqueue_task_completion(runninghub_task_id, username):
                        logger.info(f"任务 {tenant_task_id} 已投递异步完成处理队列")
                    else:
                        await complete_task_with_storage_impl(runninghub_task_id, username, db)
                    updated_count += 1
                except Exception as exc:
                    logger.error(f"处理成功任务 {runninghub_task_id} 失败: {exc}")
            elif normalized_status in FAILED_STATUSES:
                message = (
                    status_payload.get("message")
                    or status_payload.get("error")
                    or status_payload.get("detail")
                    or status_payload.get("msg")
                    or "任务失败"
                )
                if task_record_service.update_task_failed(tenant_task_id, message, db):
                    updated_count += 1
            elif normalized_status in RUNNING_STATUSES and normalized_status != existing_status:
                if task_record_service.update_task_status(tenant_task_id, normalized_status, db):
                    updated_count += 1

            refreshed_record = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db)
            if refreshed_record:
                updated_records[tenant_task_id] = _build_history_item(refreshed_record)
            else:
                updated_records[tenant_task_id] = _build_history_item(record)

    return {
        "tasks": [updated_records[task_id] for task_id in tenant_task_ids if task_id in updated_records],
        "checked_ids": checked_ids,
        "updated_count": updated_count,
        "removed_ids": removed_ids,
    }

@router.get("/tasks/{task_id}/outputs")
async def get_task_outputs(task_id: str, request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    return await proxy_to_runninghub(request, f"tasks/{task_id}/outputs", current_user, db)

@router.get("/tasks/{task_id}/outputs/stored")
async def get_stored_task_outputs(
    task_id: str, 
    current_user = Depends(get_current_user), 
    db: Session = Depends(get_db)
):
    """
    获取已存储的任务输出
    下载并存储图片到本地，返回本地路径
    """
    from ..services.image_storage import image_storage_service
    from ..services.task_record_service import task_record_service
    import httpx
    
    logger = get_proxy_logger()
    
    try:
        # 获取用户名
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]
        
        logger.info(f"获取存储的任务输出: {task_id}, 用户: {username}")
        
        # 首先从RunningHub获取原始输出
        backend_url = f"{settings.runninghub_service_url}/v1/tasks/{task_id}/outputs"
        
        async with httpx.AsyncClient() as client:
            response = await client.get(backend_url)
            response.raise_for_status()
            outputs_data = response.json()
        
        logger.info(f"从RunningHub获取到输出: {outputs_data}")
        
        # 下载并存储图片
        if "outputs" in outputs_data and outputs_data["outputs"]:
            stored_outputs = await image_storage_service.download_and_store_images(
                username, 
                outputs_data["outputs"]
            )
            
            # 提取存储路径
            storage_entries = []
            for output in stored_outputs:
                original_ref = output.get("original") or output.get("localPath")
                thumbnail_ref = output.get("thumbnail") or output.get("thumbnailPath")
                if original_ref:
                    storage_entries.append({
                        "original": original_ref,
                        "thumbnail": thumbnail_ref,
                    })
            
            # 更新任务记录（如果存在）
            # 这里需要根据task_id查找对应的tenant_task_id
            # 暂时跳过，因为我们需要在创建任务时记录tenant_task_id
            
            # 返回处理后的输出
            return {
                "taskId": task_id,
                "outputs": stored_outputs,
                "storagePaths": storage_entries,
                "message": "图片已下载并完成存储"
            }
        else:
            return outputs_data
            
    except Exception as e:
        logger.error(f"获取存储的任务输出失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"获取任务输出失败: {str(e)}")

@router.post("/generate/image_edit")
async def generate_image_edit(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    return await proxy_to_runninghub(request, "generate/image_edit", current_user, db)

@router.post("/text_to_image")
@router.post("/proxy/text_to_image")
async def text_to_image(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    文生图工作流：创建任务记录并代理到RunningHub
    """
    from ..services.task_record_service import task_record_service
    import json

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始文生图工作流: 用户={username}")

        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("generate/text_to_image", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/generate/text_to_image")

        result = await proxy_to_runninghub(
            request,
            "generate/text_to_image",
            current_user,
            db,
            charge_enabled=False,
        )

        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                response_data = json.loads(response_data.decode("utf-8"))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="text_to_image"
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(文生图): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/generate/text_to_image",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except HTTPException as e:
        raise e
    except Exception as e:
        logger.error(f"文生图工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"文生图生成失败: {str(e)}")


class TenantLLMConfig(BaseModel):
    user: str
    tenant: str
    service_url: str
    api_key: str
    default_model: str
    vision_path: str = "/chat/completions"


def _resolve_llm_config(current_user: Any, db: Session) -> TenantLLMConfig:
    if settings.is_database_storage():
        username = current_user.username
        tenant_id = current_user.tenant_id
    else:
        username = current_user["username"]
        tenant_id = current_user["tenant_id"]

    if settings.is_json_storage():
        tenant = db.get_tenant_by_id(tenant_id)
    else:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    raw_settings = getattr(tenant, "settings", None) if settings.is_database_storage() else tenant.get("settings")
    tenant_settings: Dict[str, Any] = {}
    if raw_settings:
        if isinstance(raw_settings, dict):
            tenant_settings = raw_settings
        elif isinstance(raw_settings, str):
            try:
                tenant_settings = json.loads(raw_settings)
            except json.JSONDecodeError:
                tenant_settings = {}

    llm_nested = tenant_settings.get("llm") if isinstance(tenant_settings.get("llm"), dict) else {}
    llm_service_url = (
        llm_nested.get("service_url")
        or llm_nested.get("endpoint")
        or tenant_settings.get("llm_service_url")
        or tenant_settings.get("llm_endpoint")
        or settings.llm_service_url
    )
    llm_api_key = llm_nested.get("api_key") or tenant_settings.get("llm_api_key") or settings.llm_api_key
    llm_default_model = (
        llm_nested.get("default_model")
        or llm_nested.get("model")
        or tenant_settings.get("llm_default_model")
        or settings.llm_default_model
        or "gpt-4o"
    )
    llm_vision_path = llm_nested.get("vision_path") or "/chat/completions"

    if not llm_service_url or not llm_api_key:
        raise HTTPException(status_code=500, detail="LLM service is not configured")

    config = TenantLLMConfig(
        user=str(username),
        tenant=str(tenant_id),
        service_url=llm_service_url,
        api_key=llm_api_key,
        default_model=llm_default_model,
        vision_path=llm_vision_path,
    )

    logger = get_proxy_logger()
    logger.debug(
        "LLM配置解析成功 user=%s tenant=%s url=%s model=%s vision_path=%s",
        username,
        tenant_id,
        llm_service_url,
        llm_default_model,
        llm_vision_path,
    )

    return config


def _sheet_materials_section(brief: SheetBriefPayload) -> str:
    if not brief.materials:
        return ""
    lines = []
    for material in brief.materials:
        name = (material.name or "").strip()
        specs = (material.specs or "").strip()
        if not name and not specs:
            continue
        if name and specs:
            lines.append(f"- {name}: {specs}")
        elif name:
            lines.append(f"- {name}")
        else:
            lines.append(f"- {specs}")
    if not lines:
        return ""
    return "\n\n**Specified Materials:**\n" + "\n".join(lines)


def _build_user_content(prompt: str, images: List[SheetDesignImagePayload]) -> List[Dict[str, Any]]:
    content: List[Dict[str, Any]] = []
    for image in images[:4]:
        mime = image.mimeType or "image/png"
        data_url = f"data:{mime};base64,{image.data}"
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": data_url},
            }
        )
    content.append({"type": "text", "text": prompt})
    return content


def _extract_message_text(choice_payload: Any) -> str:
    if not choice_payload:
        return ""
    if isinstance(choice_payload, list):
        parts: List[str] = []
        for part in choice_payload:
            if isinstance(part, dict) and part.get("type") == "text":
                text_value = part.get("text")
                if isinstance(text_value, str):
                    parts.append(text_value)
        return "".join(parts)
    if isinstance(choice_payload, str):
        return choice_payload
    return ""


async def _call_llm_json(
    llm_config: TenantLLMConfig,
    *,
    system_prompt: str,
    user_prompt: str,
    images: List[SheetDesignImagePayload],
    schema_name: str,
    schema: Dict[str, Any],
    temperature: float = 0.2,
    log_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    logger = get_proxy_logger()

    context_suffix = ""
    if log_context:
        context_parts = [f"{key}={value}" for key, value in log_context.items()]
        context_suffix = " ".join(context_parts)

    def _ctx(message: str) -> str:
        if context_suffix:
            return f"{message} ({context_suffix})"
        return message

    target_url = f"{llm_config.service_url.rstrip('/')}{llm_config.vision_path}"
    payload: Dict[str, Any] = {
        "model": llm_config.default_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": _build_user_content(user_prompt, images)},
        ],
        "temperature": temperature,
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": schema},
        },
    }

    headers = {
        "Authorization": f"Bearer {llm_config.api_key}",
        "Content-Type": "application/json",
    }

    logger.debug(
        _ctx("调用LLM JSON接口"),
        extra={
            "target_url": target_url,
            "schema": schema_name,
            "model": llm_config.default_model,
            "image_count": len(images or []),
        },
    )

    async with httpx.AsyncClient(timeout=90.0) as client:
        resp = await client.post(target_url, headers=headers, json=payload)

    text_content = resp.text
    logger.debug(
        _ctx("LLM响应收到 status=%s body_len=%s"),
        resp.status_code,
        len(text_content or ""),
    )
    parsed_json: Optional[Dict[str, Any]] = None
    try:
        parsed_json = resp.json()
    except Exception:
        parsed_json = None

    if resp.status_code >= 400:
        logger.error(
            _ctx("LLM请求失败 status=%s body=%s"),
            resp.status_code,
            _truncate_for_log(text_content),
        )
        detail = None
        if parsed_json and isinstance(parsed_json, dict):
            detail = parsed_json.get("error") or parsed_json.get("detail")
        raise HTTPException(status_code=resp.status_code, detail=detail or text_content or "LLM request failed")

    if parsed_json and isinstance(parsed_json, dict):
        choices = parsed_json.get("choices")
        if isinstance(choices, list) and choices:
            message = choices[0].get("message", {}).get("content")
            text_content = _extract_message_text(message) or parsed_json.get("choices")[0].get("message", {}).get("content", "")

    try:
        return json.loads(text_content)
    except json.JSONDecodeError:
        logger.error(
            _ctx("LLM返回内容非JSON body=%s"),
            _truncate_for_log(text_content),
        )
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON content")


LINING_REGEX = re.compile(r"(lining|lined|jacket|blazer|coat|dress with lining|inner layer)", re.IGNORECASE)

SYSTEM_PROMPT_SKETCH = "You are a senior fashion technical illustrator. Always return JSON that matches the schema and embed rendered sketches as base64-encoded PNG strings."
SYSTEM_PROMPT_TECH_PACK = "You are a senior apparel product developer. Return structured JSON suitable for a production tech pack."
SYSTEM_PROMPT_COST = "You are a professional garment production cost accountant. Always enforce the costing rules and respond with JSON only."
TECH_PACK_PURPOSE = "Based on the provided fashion design reference image(s) and description, create a complete production tech pack in JSON format. Use the specified materials as the primary source for the bill of materials."

SKETCH_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "image": {
            "type": "string",
            "description": "Base64 编码的 PNG 图像（不要包含 data: 前缀）",
        },
        "annotations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "x": {"type": "number"},
                    "y": {"type": "number"},
                },
                "required": ["text", "x", "y"],
            },
        },
    },
    "required": ["image", "annotations"],
}

TECH_PACK_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "description": {"type": "string"},
        "billOfMaterials": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item": {"type": "string"},
                    "description": {"type": "string"},
                },
                "required": ["item", "description"],
            },
        },
        "specSheet": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "pointOfMeasure": {"type": "string"},
                    "measurement": {"type": "string"},
                },
                "required": ["pointOfMeasure", "measurement"],
            },
        },
        "constructionDetails": {
            "type": "array",
            "items": {"type": "string"},
        },
    },
    "required": ["description", "billOfMaterials", "specSheet", "constructionDetails"],
}

COST_RESPONSE_SCHEMA: Dict[str, Any] = {
    "type": "object",
    "properties": {
        "garmentType": {"type": "string"},
        "costBreakdown": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "item": {"type": "string"},
                    "consumption": {"type": "string"},
                    "unitPrice": {"type": "string"},
                    "cost": {"type": "number"},
                },
                "required": ["item", "consumption", "unitPrice", "cost"],
            },
        },
        "totalEstimatedCost": {"type": "number"},
        "notes": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["garmentType", "costBreakdown", "totalEstimatedCost", "notes"],
}


def _sanitize_description(text: Optional[str]) -> str:
    if not text:
        return "No description provided."
    return text.replace("`", "'").strip()


def _technical_sketch_prompt(view: str, brief: SheetBriefPayload) -> str:
    description = _sanitize_description(brief.description)
    return f"""**TASK: GENERATE A TECHNICAL FLAT SKETCH OF THE {view.upper()} VIEW ONLY.**
This is a request for the **{view} view**. Do not generate any other view. If you are asked for the back view, you must generate the back view, inferring the design from the references if needed. Generating the wrong view is a failure.

**ABSOLUTE CRITICAL REQUIREMENT (SCALE & HEIGHT):**
You are generating a set of technical flat sketches for a single garment. ALL sketches in this set (front, back, etc.) MUST be drawn to the EXACT SAME SCALE AND HEIGHT. The garment's top and bottom edges must align perfectly if the images were overlaid. Do NOT change the zoom level or scale between views. This consistency is NON-NEGOTIABLE for a professional tech pack.

Now, create a professional, **colored** vector-style technical flat sketch of the requested **{view} view**, resembling a clean Adobe Illustrator drawing. Base the sketch strictly on the provided image(s) and description ("{description}"). The background must be pure white with absolutely no shading or gradients on the garment itself.

Key requirements for the colored flat style:
1. **Color:** The different panels/sections of the garment must be filled with flat, solid colors that accurately represent the design based on the references.
2. **Outlines:** All main garment contour lines must be solid black lines with a uniform, consistent thickness.
3. **Stitching:** All seam lines and stitching details must be represented by clean, consistent dashed black lines.
4. **Presentation:** The garment must be drawn in a flat, symmetrical, and non-posed state, as if laid on a flat surface.
5. **Exclusions & Cropping:** The sketch MUST ONLY show the garment on a torso. EXCLUDE the model's head, hands, and legs. The image should be cropped from the neckline to just below the garment's hem. The final image must be headless and limbless, focusing solely on the clothing item.

This is for a professional production tech pack, so precision and clarity are crucial.

Return a JSON object with:
- `image`: Base64 encoded PNG data (no data: prefix).
- `annotations`: At least five callouts describing key construction areas. Each annotation must include `text`, `x`, `y` where x/y are percentages (0-100) from the top-left of the sketch."""


def _lining_prompt(brief: SheetBriefPayload) -> str:
    description = _sanitize_description(brief.description)
    return f"""Create a professional, **colored** vector-style technical flat sketch of ONLY THE INNER LINING of the garment, resembling a clean Adobe Illustrator drawing. Base the sketch strictly on the provided image(s) and description ("{description}"). The background must be pure white with absolutely no shading or gradients on the garment itself.

Key requirements for the colored flat style:
1. **Color:** The different panels/sections of the lining must be filled with flat, solid colors that accurately represent the design based on the references.
2. **Outlines:** All main lining contour lines must be solid black lines with a uniform, consistent thickness.
3. **Stitching:** All internal seam lines and stitching details must be represented by clean, consistent dashed black lines.
4. **Presentation:** The lining must be drawn in a flat, symmetrical, non-posed state, showing its construction.
5. **Exclusions & Cropping:** The sketch MUST ONLY show the lining on a torso. EXCLUDE the model's head, hands, and legs. The image must be headless and limbless, focusing solely on the lining.

Return JSON with `image` (base64 PNG without data prefix) and `annotations` (list of objects with `text`, `x`, `y`)."""


def _build_detailed_prompt_text(brief: SheetBriefPayload, purpose: str) -> str:
    description = _sanitize_description(brief.description)
    return f"""{purpose}

**Design Description:**
{description}{_sheet_materials_section(brief)}"""


def _build_cost_prompt(brief: SheetBriefPayload, tech_pack: TechPackPayload) -> str:
    bom_lines = "\n".join(f"- {item.item}: {item.description}" for item in tech_pack.billOfMaterials) or "- (empty)"
    construction = "\n".join(tech_pack.constructionDetails) or "- (empty)"
    description = _sanitize_description(brief.description)
    return f"""
You are a professional garment production cost accountant. Your task is to analyze the provided design information and create a detailed cost estimation in JSON format.

**FIXED COSTING RULES (DO NOT DEVIATE):**
- **Currency:** All costs are in RMB (人民币).
- **Labor Costs (per piece):**
    - T-shirt: 20 RMB
    - Shirt: 35 RMB
    - Pants: 35 RMB
    - Dress: 45 RMB
    - Jacket/Coat/Blazer: 100 RMB
- **Fabric Prices (per meter):**
    - Chiffon (雪纺面料): 20 RMB/m
    - Cotton Poplin / poplin (全棉府绸): 25 RMB/m
    - Faux Suede / suede (仿麂皮): 30 RMB/m
- **Fabric Consumption (per piece):**
    - Top (T-shirt, Shirt, Jacket, etc.): 1.8m
    - Pants: 1.8m
    - Dress: 2.0m
- **Trims & Accessories Cost:** Estimate this as 15% of the total fabric cost. If no specific fabric is identified, estimate a fixed cost of 10 RMB.

**INPUT DATA:**
1. **Design Description:** {description}
2. **Bill of Materials:**
{bom_lines}
3. **Construction Details:**
{construction}

**TASK:**
1. Classify the garment (T-shirt, Shirt, Pants, Dress, Jacket).
2. Identify the main fabric. If it matches the price list, use the corresponding price. Otherwise, note the assumption and use 28 RMB/m.
3. Create a cost breakdown with 'Main Fabric', 'Labor Cost', and 'Trims & Accessories'. For each item provide: `item`, `consumption`, `unitPrice`, `cost`.
4. Calculate total cost.
5. Provide notes on assumptions.

Return JSON following the schema."""

@router.post(
    "/complete_image_edit_poloapi",
    summary="统一改图入口",
    description="保持历史路由名不变，但内部会根据 IMAGE_PROVIDER 选择 PoloAPI 或 VOD 改图链路。",
)
async def complete_image_edit_poloapi(
    request: Request,
    prompt: str = Form(...),
    model: Optional[str] = Form(None),
    async_mode: bool = Form(True),
    output_count: int = Form(1),
    project_id: Optional[str] = Form(None),
    file: Optional[UploadFile] = File(None),
    file_url: Optional[str] = Form(None),
    file_2: Optional[UploadFile] = File(None),
    file_2_url: Optional[str] = Form(None),
    file_3: Optional[UploadFile] = File(None),
    file_3_url: Optional[str] = Form(None),
    file_4: Optional[UploadFile] = File(None),
    file_4_url: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    统一图片编辑入口。
    根据 IMAGE_PROVIDER 选择走 PoloAPI 或 VOD。
    """

    from ..services.task_record_service import task_record_service
    from ..services.image_storage import image_storage_service

    # Historical route name retained for compatibility. Provider selection is
    # driven by IMAGE_PROVIDER, so this endpoint now serves as the unified
    # image-edit entry instead of a PoloAPI-only path.
    logger = get_proxy_logger()
    prompt_value = (prompt or "").strip()
    if not prompt_value:
        raise HTTPException(status_code=400, detail="prompt is required")
    if output_count < 1 or output_count > 4:
        raise HTTPException(status_code=400, detail="output_count must be between 1 and 4")

    username = _get_username(current_user)
    normalized_project_id = project_id.strip() if isinstance(project_id, str) and project_id.strip() else None

    if normalized_project_id:
        from ..services.project_team_service import project_team_service

        project = task_record_service.get_project_by_id(normalized_project_id, db)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")

        project_owner = project.get("user_id")
        manager_can_view = _can_manager_view_project_owner(db, current_user, project_owner)
        if project_owner != username and not manager_can_view:
            membership = project_team_service.get_member_entry(normalized_project_id, username)
            if not membership:
                raise HTTPException(status_code=403, detail="No permission to access this project")

    async def load_image_reference(ref: str) -> Tuple[bytes, str]:
        ref_value = (ref or "").strip()
        if not ref_value:
            raise HTTPException(status_code=400, detail="image reference is empty")

        parsed = urlparse(ref_value)
        path_value = _normalize_storage_relative_path(ref_value) or ""
        base_storage = image_storage_service.base_storage_path.resolve()
        candidates: List[Path] = []
        if path_value:
            path_obj = Path(path_value)
            candidates.append(path_obj)
            candidates.append(base_storage / path_obj)

            base_name = base_storage.name.lower()
            lowered = path_value.lower()
            prefix = f"{base_name}/"
            if lowered.startswith(prefix):
                stripped = Path(path_value[len(prefix) :])
                candidates.append(base_storage / stripped)

        for candidate in candidates:
            try:
                resolved = candidate.resolve()
            except Exception:
                continue
            if resolved.exists() and str(resolved).startswith(str(base_storage)):
                data = resolved.read_bytes()
                mime_type = mimetypes.guess_type(resolved.name)[0] or "image/png"
                return data, mime_type

        if parsed.scheme in ("http", "https"):
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.get(ref_value)
            if response.status_code >= 400:
                raise HTTPException(status_code=400, detail="image reference fetch failed")
            mime_type = (response.headers.get("content-type") or "image/png").split(";")[0]
            return response.content, mime_type or "image/png"

        internal_url = _resolve_internal_image_proxy_url(ref_value)
        if internal_url:
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    response = await client.get(internal_url)
                response.raise_for_status()
                mime_type = (response.headers.get("content-type") or "image/png").split(";")[0]
                return response.content, mime_type or "image/png"
            except Exception:
                pass

        if settings.output_storage_backend == "cos":
            cos_url = _resolve_cos_url_from_reference(ref_value)
            if cos_url:
                try:
                    async with httpx.AsyncClient(timeout=30) as client:
                        response = await client.get(cos_url)
                    response.raise_for_status()
                    mime_type = (response.headers.get("content-type") or "image/png").split(";")[0]
                    return response.content, mime_type or "image/png"
                except Exception:
                    pass

        raise HTTPException(status_code=400, detail="image reference not found")

    files = [file, file_2, file_3, file_4]
    file_urls = [file_url, file_2_url, file_3_url, file_4_url]
    images_payload: List[Tuple[str, bytes, str]] = []
    for upload, ref in zip(files, file_urls):
        if upload:
            file_bytes = await upload.read()
            if not file_bytes:
                raise HTTPException(status_code=400, detail=f"图片 {upload.filename or ''} 内容为空")
            images_payload.append(
                (upload.filename or "image.png", file_bytes, upload.content_type or "image/jpeg")
            )
            continue
        if ref:
            file_bytes, mime_type = await load_image_reference(ref)
            reference_name = Path(urlparse(ref).path or ref).name or f"reference_{uuid.uuid4().hex[:8]}.png"
            images_payload.append((reference_name, file_bytes, mime_type))

    requested_model = (model or "").strip() or None
    active_provider = openai_image_provider_service.get_active_provider_name()
    # Choose the concrete provider at runtime instead of hardwiring PoloAPI.
    if active_provider == "vod":
        vod_model_config = resolve_vod_image_task_config(settings=settings, requested_model=requested_model)
        billing_model_name = vod_model_config.billing_model_name or f"{vod_model_config.model_name}:{vod_model_config.model_version}"
        provider_model = requested_model
    else:
        provider_model = requested_model
        if provider_model and provider_model.lower() in VOD_IMAGE2_REQUEST_MARKERS:
            provider_model = None
        billing_model_name = resolve_poloapi_model(
            requested_model=provider_model,
            fallback_model=settings.poloapi_image_model or settings.poloapi_default_model,
            mode="image",
        )

    _ensure_sufficient_credit(db, current_user, billing_model_name, "/complete_image_edit_poloapi")

    current_user_snapshot = {
        "id": _user_value(current_user, "id"),
        "username": username,
        "tenant_id": _user_value(current_user, "tenant_id"),
        "group": _user_value(current_user, "group"),
        "role": _user_value(current_user, "role"),
    }

    async def run_generation_task(tenant_task_id: str, task_index: int) -> List[str]:
        worker_db_gen = get_db()
        worker_db = next(worker_db_gen)
        try:
            task_record_service.update_task_status(tenant_task_id, "RUNNING", worker_db)

            try:
                if images_payload:
                    provider_response = await openai_image_provider_service.edit(
                        request=request,
                        current_user=current_user_snapshot,
                        prompt=prompt_value,
                        response_format="b64_json",
                        model=provider_model,
                        images=images_payload,
                    )
                else:
                    provider_response = await openai_image_provider_service.generate(
                        request=request,
                        current_user=current_user_snapshot,
                        prompt=prompt_value,
                        response_format="b64_json",
                        model=provider_model,
                    )
            except (PoloAPIError, ImageProviderError) as exc:
                logger.error(
                    "Image task failed tenant_task_id=%s provider=%s error=%s",
                    tenant_task_id,
                    active_provider,
                    exc,
                )
                task_record_service.update_task_failed(tenant_task_id, str(exc), worker_db)
                return []

            data_items = provider_response.get("data") or []
            b64_json = None
            if data_items and isinstance(data_items[0], dict):
                b64_json = data_items[0].get("b64_json")
            if not isinstance(b64_json, str) or not b64_json:
                task_record_service.update_task_failed(tenant_task_id, "Failed to parse image provider output", worker_db)
                return []

            try:
                image_bytes = base64.b64decode(b64_json)
            except (ValueError, binascii.Error):
                task_record_service.update_task_failed(tenant_task_id, "Unsupported image provider output", worker_db)
                return []

            try:
                storage_entry = image_storage_service.store_uploaded_image(
                    user_id=username,
                    file_bytes=image_bytes,
                    original_filename=f"redesign_{uuid.uuid4().hex[:6]}_{task_index + 1}.png",
                    content_type="image/png",
                    subdir="redesign",
                )
            except ValueError as exc:
                task_record_service.update_task_failed(tenant_task_id, str(exc), worker_db)
                return []

            storage_paths: List[str] = []
            if isinstance(storage_entry, dict):
                for key in ("original", "localPath", "thumbnail", "thumbnailPath"):
                    value = storage_entry.get(key)
                    if value:
                        storage_paths.append(str(value))

            task_record_service.update_task_success(
                tenant_task_id,
                {"source": active_provider, "output_count": 1, "batch_output_count": output_count},
                [storage_entry],
                worker_db,
            )

            if active_provider == "poloapi":
                log_poloapi_usage(
                    worker_db,
                    user_id=username,
                    endpoint="/complete_image_edit_poloapi",
                    model=billing_model_name,
                    prompt=prompt_value,
                    response_text="",
                    image_paths=storage_paths or None,
                )

            charge_model_usage(
                worker_db,
                current_user_snapshot,
                "/complete_image_edit_poloapi",
                billing_model_name,
                tenant_task_id=tenant_task_id,
            )
            return storage_paths
        except Exception as exc:
            logger.exception(
                "Image task crashed tenant_task_id=%s provider=%s error=%s",
                tenant_task_id,
                active_provider,
                exc,
            )
            task_record_service.update_task_failed(tenant_task_id, f"Internal async task error: {exc}", worker_db)
            return []
        finally:
            worker_db_gen.close()

    tenant_task_ids: List[str] = []
    task_coroutines: List[Any] = []
    for index in range(output_count):
        runninghub_task_id = f"{active_provider}_{uuid.uuid4().hex[:12]}"
        generated_task_id = task_record_service.create_task_record(
            username,
            runninghub_task_id,
            db,
            task_type="targeted_redesign",
            project_id=normalized_project_id,
        )
        tenant_task_ids.append(generated_task_id)
        task_coroutines.append(run_generation_task(generated_task_id, index))

    if async_mode:
        for coroutine in task_coroutines:
            asyncio.create_task(coroutine)
        return {
            "tenantTaskId": tenant_task_ids[0] if len(tenant_task_ids) == 1 else None,
            "tenantTaskIds": tenant_task_ids,
            "status": "PENDING",
            "storagePaths": [],
        }

    results = await asyncio.gather(*task_coroutines)
    storage_paths: List[str] = [path for result in results for path in result]
    return {
        "tenantTaskId": tenant_task_ids[0] if len(tenant_task_ids) == 1 else None,
        "tenantTaskIds": tenant_task_ids,
        "status": "SUCCESS" if storage_paths else "FAILED",
        "storagePaths": storage_paths,
    }


@router.get("/poloapi/tasks/{tenant_task_id}")
async def get_poloapi_task_status(
    tenant_task_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..services.task_record_service import task_record_service

    username = _get_username(current_user)
    task = task_record_service.get_task_record_by_tenant_id(tenant_task_id, db)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("user_id") != username:
        raise HTTPException(status_code=403, detail="No permission to access this task")

    history_item = _build_history_item(task)
    return {
        "tenantTaskId": history_item.get("tenant_task_id"),
        "status": str(history_item.get("status") or "PENDING").upper(),
        "storagePaths": _normalize_storage_entries(history_item.get("storage_paths")),
        "imageUrls": history_item.get("image_urls") or [],
        "thumbnailUrls": history_item.get("thumbnail_urls") or [],
        "errorMessage": history_item.get("error_message"),
        "resultData": history_item.get("result_data"),
        "createdAt": history_item.get("created_at"),
        "completedAt": history_item.get("completed_at"),
    }


@router.post("/complete_image_edit")
async def complete_image_edit(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    完整的图片编辑工作流
    创建任务记录并代理到RunningHub
    """
    from ..services.task_record_service import task_record_service
    import httpx
    
    logger = get_proxy_logger()
    
    try:
        # 获取用户名
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]
        
        logger.info(f"开始完整图片编辑工作流: 用户={username}")
        
        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("complete_image_edit", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/complete_image_edit")

        # 代理到RunningHub
        result = await proxy_to_runninghub(request, "complete_image_edit", current_user, db, charge_enabled=False)
        
        # 检查返回结果类型
        if isinstance(result, JSONResponse):
            # 如果是JSONResponse，提取内容
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode('utf-8'))
            
            # 如果任务创建成功，记录tenant任务
            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username, 
                    runninghub_task_id, 
                    db,
                    task_type="targeted_redesign"  # 标记为Targeted Redesign任务
                )
                
                # 在结果中添加tenant_task_id
                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录: {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/complete_image_edit",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )
                
                # 返回更新后的响应
                return JSONResponse(
                    content=response_data,
                    status_code=result.status_code
                )
        
        return result
        
    except Exception as e:
        logger.error(f"完整图片编辑工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"图片编辑失败: {str(e)}")

@router.post("/complete_pattern_extract")
async def complete_pattern_extract(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    完整印花提取工作流：创建任务记录并代理到RunningHub
    """
    from ..services.task_record_service import task_record_service
    import httpx

    logger = get_proxy_logger()

    try:
        # 获取用户名
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始完整印花提取工作流: 用户={username}")

        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("complete_pattern_extract", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/complete_pattern_extract")

        # 代理到RunningHub
        result = await proxy_to_runninghub(request, "complete_pattern_extract", current_user, db, charge_enabled=False)

        # 处理返回
        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode('utf-8'))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="pattern_extract"
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(印花提取): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/complete_pattern_extract",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except Exception as e:
        logger.error(f"完整印花提取工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"印花提取失败: {str(e)}")

@router.post("/complete_seamless_pattern")
async def complete_seamless_pattern(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    完整无缝图案工作流：创建任务记录并代理到RunningHub
    """
    from ..services.task_record_service import task_record_service
    import httpx

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始完整无缝图案工作流: 用户={username}")

        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("complete_seamless_pattern", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/complete_seamless_pattern")

        result = await proxy_to_runninghub(request, "complete_seamless_pattern", current_user, db, charge_enabled=False)

        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode('utf-8'))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="seamless_pattern"
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(无缝图案): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/complete_seamless_pattern",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except HTTPException as e:
        raise e
    except httpx.RequestError as proxy_error:
        logger.error(f"完整无缝图案工作流代理请求失败: {str(proxy_error)}")
        raise HTTPException(status_code=502, detail="无法连接到运行服务，请稍后重试")
    except Exception as e:
        logger.error(f"完整无缝图案工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"无缝图案生成失败: {str(e)}")

@router.post("/complete_video_generation")
async def complete_video_generation(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    完整视频生成工作流：创建任务记录并代理到RunningHub
    """
    from ..services.task_record_service import task_record_service
    import httpx

    logger = get_proxy_logger()

    try:
        # 获取用户名
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始完整视频生成工作流: 用户={username}")

        # 代理到RunningHub
        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("complete_video_generation", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/complete_video_generation")

        result = await proxy_to_runninghub(request, "complete_video_generation", current_user, db, charge_enabled=False)

        # 处理返回
        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode("utf-8"))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="video_generation"
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(视频生成): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/complete_video_generation",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except Exception as e:
        logger.error(f"完整视频生成工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"视频生成失败: {str(e)}")

@router.post("/super_resolution")
async def super_resolution(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    超级分辨率工作流：上传图片并触发放大
    """
    from ..services.task_record_service import task_record_service
    import httpx

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始超级分辨率工作流: 用户={username}")

        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("super_resolution", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/super_resolution")

        result = await proxy_to_runninghub(request, "super_resolution", current_user, db, charge_enabled=False)

        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode("utf-8"))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="super_resolution"
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(超级分辨率): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/super_resolution",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except Exception as e:
        logger.error(f"超级分辨率工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"超级分辨率失败: {str(e)}")

@router.post("/complete_image_layer")
async def complete_image_layer(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    图像分层工作流：上传图片并触发 RunningHub 图像分层任务
    """
    from ..services.task_record_service import task_record_service
    import httpx

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始图像分层工作流: 用户={username}")

        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("complete_image_layer", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/complete_image_layer")

        result = await proxy_to_runninghub(request, "complete_image_layer", current_user, db, charge_enabled=False)

        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode("utf-8"))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="image_layer",
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(图像分层): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/complete_image_layer",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except Exception as e:
        logger.error(f"图像分层工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"图像分层失败: {str(e)}")

@router.post("/remove_background")
async def remove_background(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    去除背景工作流：上传图片并触发 RunningHub 的去背景任务
    """
    from ..services.task_record_service import task_record_service
    import httpx

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始去除背景工作流: 用户={username}")

        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("remove_background", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/remove_background")

        result = await proxy_to_runninghub(request, "remove_background", current_user, db, charge_enabled=False)

        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode("utf-8"))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="remove_background"
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(去除背景): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/remove_background",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except Exception as e:
        logger.error(f"去除背景工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"去除背景失败: {str(e)}")

@router.post("/svg_vectorization")
async def svg_vectorization(request: Request, current_user = Depends(get_current_user), db: Session = Depends(get_db)):
    """
    SVG 矢量化工作流：上传图片并触发 RunningHub 的矢量化任务
    """
    from ..services.task_record_service import task_record_service
    import httpx

    logger = get_proxy_logger()

    try:
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]

        logger.info(f"开始 SVG 矢量化工作流: 用户={username}")

        content_type = request.headers.get("content-type", "application/json")
        body = await request.body()
        model_name = _resolve_runninghub_model("svg_vectorization", content_type, body)

        _ensure_sufficient_credit(db, current_user, model_name, "/runninghub/svg_vectorization")

        result = await proxy_to_runninghub(request, "svg_vectorization", current_user, db, charge_enabled=False)

        if isinstance(result, JSONResponse):
            response_data = result.body
            if isinstance(response_data, bytes):
                import json
                response_data = json.loads(response_data.decode("utf-8"))

            if isinstance(response_data, dict) and "taskId" in response_data:
                runninghub_task_id = response_data["taskId"]
                tenant_task_id = task_record_service.create_task_record(
                    username,
                    runninghub_task_id,
                    db,
                    task_type="svg_vectorization"
                )

                response_data["tenantTaskId"] = tenant_task_id
                logger.info(f"创建tenant任务记录(SVG 矢量化): {tenant_task_id}")

                charge_model_usage(
                    db,
                    current_user,
                    "/runninghub/svg_vectorization",
                    model_name,
                    tenant_task_id=tenant_task_id,
                )

                return JSONResponse(content=response_data, status_code=result.status_code)

        return result

    except Exception as e:
        logger.error(f"SVG 矢量化工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"SVG 矢量化失败: {str(e)}")

@router.post("/variant_overlay")
async def variant_overlay(
    request: Request,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Variant overlay 工作流：代理到 RunningHub
    """
    logger = get_proxy_logger()
    try:
        result = await proxy_to_runninghub(request, "variant_overlay", current_user, db)
        return result
    except Exception as e:
        logger.error(f"Variant overlay 工作流失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Variant overlay 失败: {str(e)}")

@router.post("/tasks/{task_id}/complete")
async def complete_task_with_storage(
    task_id: str,
    current_user = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    任务完成处理：自动下载图片并更新任务记录
    """
    logger = get_proxy_logger()
    
    try:
        # 获取用户名
        if settings.is_database_storage():
            username = current_user.username
        else:
            username = current_user["username"]
        return await complete_task_with_storage_impl(task_id, username, db)
            
    except Exception as e:
        logger.error(f"处理任务完成失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"任务完成处理失败: {str(e)}")

@router.post("/admaster/sora2/video")
@router.post("/admaster/sora2/video/submit")
async def admaster_sora2_video_submit(
    prompt: str = Form(...),
    file: UploadFile = File(...),
    seconds: Optional[str] = Form(None),
    size: Optional[str] = Form(None),
    model: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    logger = get_proxy_logger()
    from ..services.task_record_service import task_record_service

    prompt_value = (prompt or "").strip()
    if not prompt_value:
        raise HTTPException(status_code=400, detail="prompt is required")

    uploaded_file_bytes = await file.read()
    if not uploaded_file_bytes:
        raise HTTPException(status_code=400, detail="image file is required")

    api_key = (settings.poloapi_video_apikey or settings.poloapi_apikey or "").strip()
    if not api_key:
        raise HTTPException(status_code=500, detail="POLOAPI_VIDEO_APIKEY or POLOAPI_APIKEY is not configured")

    model_name = (model or settings.poloapi_video_model or "veo-3.1-generate-preview").strip() or "veo-3.1-generate-preview"
    seconds_value = (seconds or settings.poloapi_video_seconds or "12").strip() or "12"
    requested_size = (size or "").strip() or None
    resolution_value = (settings.poloapi_video_resolution or "720p").strip() or "720p"
    try:
        file_bytes, size_value = _prepare_sora2_input_image(uploaded_file_bytes, requested_size)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"invalid image file: {exc}")
    bill_model = f"poloapi:{model_name}"
    _ensure_sufficient_credit(db, current_user, bill_model, "/video/sora2")

    video_base_url = _resolve_video_base_url()
    is_google_veo = "generativelanguage.googleapis.com" in video_base_url.lower() and model_name.lower().startswith("veo-")

    try:
        async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
            if is_google_veo:
                google_base_url = video_base_url[:-7] if video_base_url.lower().endswith("/openai") else video_base_url
                google_model = model_name.removeprefix("models/")
                create_response = await client.post(
                    f"{google_base_url}/models/{google_model}:predictLongRunning",
                    headers={
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "x-goog-api-key": api_key,
                    },
                    json={
                        "instances": [
                            {
                                "prompt": prompt_value,
                                "image": {
                                    "bytesBase64Encoded": base64.b64encode(file_bytes).decode("utf-8"),
                                    "mimeType": file.content_type or "image/png",
                                },
                            }
                        ],
                        "parameters": {
                            "durationSeconds": _normalize_veo_duration_seconds(seconds_value),
                            "resolution": resolution_value,
                            "aspectRatio": _veo_aspect_ratio_from_size(size_value),
                        },
                    },
                )
            else:
                create_response = await client.post(
                    f"{video_base_url}/videos",
                    headers={
                        "Accept": "application/json",
                        "Authorization": api_key,
                    },
                    data={
                        "model": model_name,
                        "prompt": prompt_value,
                        "seconds": seconds_value,
                        "size": size_value,
                    },
                    files={
                        "input_reference": (
                            file.filename or "input.png",
                            file_bytes,
                            file.content_type or "image/png",
                        )
                    },
                )

            if create_response.status_code >= 400:
                detail = create_response.text
                logger.error("Sora create failed status=%s detail=%s", create_response.status_code, _truncate_for_log(detail))
                raise HTTPException(status_code=502, detail=f"Sora create failed: {detail or 'upstream error'}")

            create_payload = create_response.json()
            task_id = str(create_payload.get("id") or create_payload.get("name") or "").strip()
            if not task_id:
                logger.error("Sora create response missing id payload=%s", _truncate_for_log(json.dumps(create_payload, ensure_ascii=False)))
                raise HTTPException(status_code=502, detail="Sora create failed: missing task id")

            username = _get_username(current_user)
            tenant_task_id = task_record_service.create_task_record(
                user_id=username,
                runninghub_task_id=task_id,
                db=db,
                task_type="admaster_sora2_video",
            )
            task_record_service.update_task_status(tenant_task_id, "RUNNING", db)
            task_record_service.update_task_status(tenant_task_id, "PENDING", db)

            return {
                "task_id": tenant_task_id,
                "upstream_task_id": task_id,
                "status": "queued",
                "model": model_name,
                "seconds": create_payload.get("seconds") or seconds_value,
                "size": create_payload.get("size") or size_value,
            }
    except httpx.HTTPError as exc:
        logger.error("Sora submit failed: %s", exc)
        raise HTTPException(status_code=502, detail=f"Sora submit failed: {exc}") from exc


@router.get("/admaster/sora2/video/{task_id}")
async def admaster_sora2_video_status(
    task_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    from ..services.task_record_service import task_record_service

    username = _get_username(current_user)
    task = task_record_service.get_task_record_by_tenant_id(task_id, db)
    if not task:
        raise HTTPException(status_code=404, detail="Sora task not found")
    if task.get("user_id") != username:
        raise HTTPException(status_code=403, detail="No permission to access this task")

    now = datetime.utcnow()
    status = str(task.get("status") or "PENDING").strip().upper()
    result_data = _safe_json_load(task.get("result_data")) or {}
    if not isinstance(result_data, dict):
        result_data = {}
    error_message = task.get("error_message")
    created_at = _parse_iso_datetime(task.get("created_at"))

    # No server-side timer polling: refresh only when client requests status.
    if status not in {"SUCCESS", "COMPLETED", "FAILED", "ERROR"}:
        if created_at is not None:
            created_naive = created_at.replace(tzinfo=None) if created_at.tzinfo else created_at
            if now - created_naive > timedelta(minutes=40):
                task_record_service.update_task_failed(task_id, "Sora task timeout after 40 minutes", db)
                task = task_record_service.get_task_record_by_tenant_id(task_id, db) or task
                status = str(task.get("status") or "FAILED").strip().upper()
                error_message = task.get("error_message")
        if status not in {"SUCCESS", "COMPLETED", "FAILED", "ERROR"}:
            upstream_task_id = (
                result_data.get("upstream_task_id")
                or task.get("runninghub_task_id")
            )
            api_key = (settings.poloapi_video_apikey or settings.poloapi_apikey or "").strip()
            model_name = str(result_data.get("model") or settings.poloapi_video_model or "veo-3.1-generate-preview")
            video_base_url = _resolve_video_base_url()
            is_google_veo = "generativelanguage.googleapis.com" in video_base_url.lower() and model_name.lower().startswith("veo-")
            if not upstream_task_id or not api_key:
                raise HTTPException(status_code=500, detail="Sora upstream task metadata missing")
            try:
                async with httpx.AsyncClient(timeout=60.0, trust_env=False) as client:
                    if is_google_veo:
                        google_base_url = video_base_url[:-7] if video_base_url.lower().endswith("/openai") else video_base_url
                        operation_path = str(upstream_task_id).lstrip("/")
                        if operation_path.startswith("operations/"):
                            operation_path = f"models/{model_name.removeprefix('models/')}/{operation_path}"
                        upstream = await client.get(
                            f"{google_base_url}/{operation_path}",
                            headers={"x-goog-api-key": api_key},
                        )
                        if upstream.status_code >= 400:
                            raise HTTPException(
                                status_code=502,
                                detail=f"Sora status query failed: {upstream.text or 'upstream error'}",
                            )
                        op_payload = upstream.json() if upstream.content else {}
                        if not isinstance(op_payload, dict):
                            op_payload = {}
                        if not op_payload.get("done"):
                            payload = {"status": "running"}
                        elif isinstance(op_payload.get("error"), dict):
                            payload = {
                                "status": "failed",
                                "error_message": str(
                                    op_payload.get("error", {}).get("message")
                                    or op_payload.get("error", {}).get("status")
                                    or "Veo generation failed"
                                ),
                            }
                        else:
                            video_url = _extract_first_http_url(op_payload.get("response")) or _extract_first_http_url(op_payload)
                            payload = {"status": "completed", "url": video_url} if video_url else {
                                "status": "failed",
                                "error_message": "Veo completed but missing video url",
                            }
                    else:
                        upstream = await client.get(
                            f"{video_base_url}/videos/{upstream_task_id}",
                            headers={"Accept": "application/json", "Authorization": api_key},
                        )
                        if upstream.status_code >= 400:
                            raise HTTPException(
                                status_code=502,
                                detail=f"Sora status query failed: {upstream.text or 'upstream error'}",
                            )
                        payload = _normalize_sora_status_payload(upstream.json() if upstream.content else {})
                upstream_status = str((payload.get("status") or "")).strip().lower()
                if upstream_status in {"queued", "pending", "running", "processing"}:
                    task_record_service.update_task_status(task_id, "RUNNING", db)
                elif upstream_status in {"completed", "success"}:
                    video_url = payload.get("url")
                    if not video_url:
                        task_record_service.update_task_failed(task_id, "Sora completed but missing video url", db)
                    else:
                        task_record_service.update_task_success(
                            task_id,
                            result_data={
                                **result_data,
                                "video_url": video_url,
                                "upstream_task_id": upstream_task_id,
                                "model": result_data.get("model") or payload.get("model") or model_name,
                                "seconds": result_data.get("seconds") or payload.get("seconds"),
                                "size": result_data.get("size") or payload.get("size"),
                                "status": "completed",
                            },
                            storage_paths=[],
                            db=db,
                        )
                elif upstream_status in {"failed", "error", "cancelled", "canceled"}:
                    task_record_service.update_task_failed(
                        task_id,
                        str(
                            payload.get("error")
                            or payload.get("error_message")
                            or payload.get("message")
                            or "Sora generation failed"
                        ),
                        db,
                    )
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Sora status query failed: {exc}")

            task = task_record_service.get_task_record_by_tenant_id(task_id, db) or task
            status = str(task.get("status") or status).strip().upper()
            result_data = _safe_json_load(task.get("result_data")) or {}
            if not isinstance(result_data, dict):
                result_data = {}
            error_message = task.get("error_message")

    if status in {"SUCCESS", "COMPLETED"} and result_data.get("video_url") and not result_data.get("billing_charged"):
        charge_model_usage(
            db,
            current_user,
            "/video/sora2",
            f"poloapi:{result_data.get('model') or settings.poloapi_video_model or 'veo-3.1-generate-preview'}",
        )
        result_data["billing_charged"] = True
        task_record_service.update_task_success(task_id, result_data=result_data, storage_paths=[], db=db)

    return {
        "task_id": task.get("tenant_task_id") or task_id,
        "status": status.lower(),
        "progress": 100 if status in {"SUCCESS", "COMPLETED"} else None,
        "model": result_data.get("model"),
        "seconds": result_data.get("seconds"),
        "size": result_data.get("size"),
        "video_url": result_data.get("video_url"),
        "error": error_message,
        "created_at": task.get("created_at"),
        "completed_at": task.get("completed_at"),
    }


@router.get("/admaster/sora2/video/task-list")
async def admaster_sora2_video_tasks(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    from ..services.task_record_service import task_record_service

    username = _get_username(current_user)
    records = task_record_service.get_user_tasks(
        user_id=username,
        limit=100,
        db=db,
        offset=0,
        task_type="admaster_sora2_video",
    )
    tasks: List[Dict[str, Any]] = []
    for record in records:
        result_data = _safe_json_load(record.get("result_data")) or {}
        if not isinstance(result_data, dict):
            result_data = {}
        tasks.append(
            {
                "task_id": record.get("tenant_task_id"),
                "status": str(record.get("status") or "PENDING").lower(),
                "progress": 100 if str(record.get("status") or "").upper() in {"SUCCESS", "COMPLETED"} else None,
                "model": result_data.get("model"),
                "seconds": result_data.get("seconds"),
                "size": result_data.get("size"),
                "video_url": result_data.get("video_url"),
                "error": record.get("error_message"),
                "created_at": record.get("created_at"),
                "prompt": result_data.get("prompt"),
                "upstream_task_id": result_data.get("upstream_task_id") or record.get("runninghub_task_id"),
            }
        )

    return {"tasks": tasks}


@router.post("/board/video/submit")
async def board_video_submit(
    prompt: str = Form(...),
    file: UploadFile = File(...),
    file_2: Optional[UploadFile] = File(None),
    file_3: Optional[UploadFile] = File(None),
    duration: Optional[float] = Form(None),
    resolution: Optional[str] = Form(None),
    mode: Optional[str] = Form(None),
    aspect_ratio: Optional[str] = Form(None),
    video_model: Optional[str] = Form(None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    logger = get_proxy_logger()
    from ..services.task_record_service import task_record_service

    prompt_value = (prompt or "").strip()
    if not prompt_value:
        raise HTTPException(status_code=400, detail="prompt is required")

    input_uploads = [file, file_2, file_3]
    input_images = []
    for upload in input_uploads:
        if upload is None:
            continue
        file_bytes = await upload.read()
        if not file_bytes:
            continue
        input_images.append((upload.filename or "reference.png", file_bytes, upload.content_type or "image/png"))

    if not input_images:
        raise HTTPException(status_code=400, detail="reference image is required")

    provider_kind = _resolve_board_video_provider_kind(video_model)
    if provider_kind == "seedance":
        model_label = f"ark:{(settings.seedance_model_id or 'doubao-seedance-2-0-260128').strip()}"
    else:
        model_label = (
            f"vod:{(settings.vod_video_model_name or 'Kling').strip() or 'Kling'}:"
            f"{(settings.vod_video_model_version or '3.0-Omni').strip() or '3.0-Omni'}"
        )
    _ensure_sufficient_credit(db, current_user, model_label, "/board/video")

    try:
        provider = SeedanceVideoProvider() if provider_kind == "seedance" else VodVideoProvider()
        created = await provider.create_video_task(
            prompt=prompt_value,
            input_images=tuple(input_images),
            duration=duration,
            resolution=resolution,
            mode=mode,
            aspect_ratio=aspect_ratio,
        )
    except (VodVideoProviderError, SeedanceVideoProviderError) as exc:
        logger.error("Board video submit failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    username = _get_username(current_user)
    task_result_data = {
        "provider": provider_kind,
        "model": created.get("model") or _normalize_board_video_model(video_model),
        "billing_model": created.get("billing_model") or model_label,
        "upstream_task_id": created["task_id"],
        "mode": created.get("mode"),
        "aspect_ratio": created.get("aspect_ratio"),
        "resolution": created.get("resolution"),
        "first_frame_url": created.get("first_frame_url"),
        "input_image_count": created.get("input_image_count"),
    }
    tenant_task_id = task_record_service.create_task_record(
        user_id=username,
        runninghub_task_id=created["task_id"],
        db=db,
        task_type="board_video_generation",
        result_data=task_result_data,
    )
    task_record_service.update_task_status(tenant_task_id, "RUNNING", db)

    return {
        "task_id": tenant_task_id,
        "upstream_task_id": created["task_id"],
        "status": "running",
        "model": created["model"],
        "provider": provider_kind,
        "billing_model": task_result_data["billing_model"],
        "mode": created.get("mode"),
        "aspect_ratio": created.get("aspect_ratio"),
        "resolution": created.get("resolution"),
        "first_frame_url": created.get("first_frame_url"),
    }


@router.get("/board/video/{task_id}")
async def board_video_status(
    task_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    from ..services.task_record_service import task_record_service

    username = _get_username(current_user)
    task = task_record_service.get_task_record_by_tenant_id(task_id, db)
    if not task:
        raise HTTPException(status_code=404, detail="Video task not found")
    if task.get("user_id") != username:
        raise HTTPException(status_code=403, detail="No permission to access this task")

    status = str(task.get("status") or "PENDING").strip().upper()
    result_data = _safe_json_load(task.get("result_data")) or {}
    if not isinstance(result_data, dict):
        result_data = {}
    provider_kind = _resolve_board_video_provider_kind(result_data.get("model") if isinstance(result_data.get("model"), str) else None)
    provider_kind = str(result_data.get("provider") or provider_kind).strip().lower()
    billing_model = str(result_data.get("billing_model") or "").strip()

    if status in {"SUCCESS", "COMPLETED"}:
        return {
            "task_id": task_id,
            "status": "completed",
            "progress": 100,
            "model": result_data.get("model"),
            "video_url": _public_storage_reference(result_data.get("video_url")),
            "storage": _public_storage_entry(result_data.get("storage") or {}) if isinstance(result_data.get("storage"), dict) else result_data.get("storage"),
            "metadata": result_data.get("metadata"),
            "error": task.get("error_message"),
        }
    if status in {"FAILED", "ERROR"}:
        return {
            "task_id": task_id,
            "status": "failed",
            "progress": None,
            "error": task.get("error_message") or result_data.get("error"),
        }

    upstream_task_id = str(task.get("runninghub_task_id") or result_data.get("upstream_task_id") or "").strip()
    if not upstream_task_id:
        raise HTTPException(status_code=500, detail="Video upstream task id missing")

    try:
        provider = SeedanceVideoProvider() if provider_kind == "seedance" else VodVideoProvider()
        if provider_kind == "seedance":
            detail = await provider.describe_task(upstream_task_id)
        else:
            detail = provider.describe_task(upstream_task_id)
        parsed = provider.parse_task_detail(detail)
    except VodVideoProviderError as exc:
        raise HTTPException(status_code=502, detail=f"VOD status query failed: {exc}") from exc
    except SeedanceVideoProviderError as exc:
        raise HTTPException(status_code=502, detail=f"Seedance status query failed: {exc}") from exc

    upstream_status = str(parsed.get("status") or "").upper()
    progress = parsed.get("progress")
    message = parsed.get("message") or ""

    if upstream_status == "FINISH":
        err_code = int(parsed.get("err_code") or 0)
        video_url = parsed.get("video_url")
        if err_code or not video_url:
            provider_label = "Seedance" if provider_kind == "seedance" else "VOD"
            error_message = message or f"{provider_label} task failed with ErrCode={err_code}"
            task_record_service.update_task_failed(task_id, error_message, db)
            return {"task_id": task_id, "status": "failed", "progress": 100, "error": error_message}

        try:
            storage_entry = await provider.store_video_output(
                user_id=username,
                video_url=str(video_url),
                task_id=upstream_task_id,
            )
        except Exception as exc:
            task_record_service.update_task_failed(task_id, f"Video storage failed: {exc}", db)
            raise HTTPException(status_code=502, detail=f"Video storage failed: {exc}") from exc

        if provider_kind == "seedance":
            model_name = result_data.get("model") or "Seedance 2.0"
            model_label = billing_model or f"ark:{getattr(provider, 'model_id', settings.seedance_model_id)}"
        else:
            model_name = (
                (((parsed.get("detail") or {}).get("AigcVideoTask") or {}).get("Input") or {}).get("ModelName")
                or provider.settings.vod_video_model_name
                or "Kling"
            )
            model_version = (
                (((parsed.get("detail") or {}).get("AigcVideoTask") or {}).get("Input") or {}).get("ModelVersion")
                or provider.settings.vod_video_model_version
                or "3.0-Omni"
            )
            model_label = billing_model or f"vod:{model_name}:{model_version}"
        public_storage_entry = _public_storage_entry(storage_entry)
        public_video_url = public_storage_entry.get("original") or storage_entry.get("original")
        result_data = {
            "status": "completed",
            "video_url": public_video_url,
            "transient_vod_url": video_url,
            "upstream_task_id": upstream_task_id,
            "provider": provider_kind,
            "billing_model": model_label,
            "model": model_name if provider_kind == "seedance" else f"{model_name} {model_version}",
            "metadata": parsed.get("metadata"),
            "storage": public_storage_entry,
        }
        task_record_service.update_task_success(task_id, result_data=result_data, storage_paths=[storage_entry], db=db)
        try:
            charge_model_usage(db, current_user, "/board/video", model_label)
            result_data["billing_charged"] = True
            task_record_service.update_task_success(task_id, result_data=result_data, storage_paths=[storage_entry], db=db)
        except Exception as exc:
            get_proxy_logger().warning("Board video billing failed task_id=%s error=%s", task_id, exc)
        return {
            "task_id": task_id,
            "status": "completed",
            "progress": 100,
            "model": result_data["model"],
            "video_url": result_data["video_url"],
            "storage": public_storage_entry,
            "metadata": parsed.get("metadata"),
        }

    if upstream_status in {"FAIL", "FAILED", "ERROR", "CANCELED", "CANCELLED"}:
        error_message = message or "VOD video generation failed"
        task_record_service.update_task_failed(task_id, error_message, db)
        return {"task_id": task_id, "status": "failed", "progress": progress, "error": error_message}

    if status != "RUNNING":
        task_record_service.update_task_status(task_id, "RUNNING", db)
    return {
        "task_id": task_id,
        "status": "running",
        "progress": progress,
        "error": None,
    }


@router.get("/diagnostics/runninghub")
async def diagnose_runninghub():
    """
    诊断RunningHub服务器状态
    """
    logger = get_proxy_logger()
    settings = get_settings()
    
    diagnostics = {
        "runninghub_url": settings.runninghub_service_url,
        "timestamp": datetime.now().isoformat(),
        "tests": {}
    }
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 测试基本连接
            try:
                response = await client.get(f"{settings.runninghub_service_url}/docs")
                diagnostics["tests"]["docs_endpoint"] = {
                    "status": "success",
                    "status_code": response.status_code,
                    "response_time": "N/A"
                }
            except Exception as e:
                diagnostics["tests"]["docs_endpoint"] = {
                    "status": "failed",
                    "error": str(e),
                    "error_type": type(e).__name__
                }
            
            # 测试健康检查
            try:
                response = await client.get(f"{settings.runninghub_service_url}/health")
                diagnostics["tests"]["health_endpoint"] = {
                    "status": "success",
                    "status_code": response.status_code,
                    "response_time": "N/A"
                }
            except Exception as e:
                diagnostics["tests"]["health_endpoint"] = {
                    "status": "failed",
                    "error": str(e),
                    "error_type": type(e).__name__
                }
            
            # 测试API端点
            try:
                response = await client.get(f"{settings.runninghub_service_url}/v1/")
                diagnostics["tests"]["api_endpoint"] = {
                    "status": "success",
                    "status_code": response.status_code,
                    "response_time": "N/A"
                }
            except Exception as e:
                diagnostics["tests"]["api_endpoint"] = {
                    "status": "failed",
                    "error": str(e),
                    "error_type": type(e).__name__
                }
    
    except Exception as e:
        diagnostics["error"] = str(e)
        logger.error(f"诊断失败: {str(e)}")
    
    return diagnostics

@router.get("/static/images/{file_path:path}")
async def serve_stored_image(file_path: str):
    """
    提供存储的图片文件
    """
    logger = get_proxy_logger()
    
    try:
        relative_path = _normalize_storage_relative_path(file_path or "")
        if not relative_path:
            raise HTTPException(status_code=400, detail="invalid image path")

        output_dir = Path(settings.output_storage_path).resolve()
        full_path = output_dir / relative_path
        
        logger.info(f"请求图片文件: {file_path}")
        logger.info(f"output目录: {output_dir}")
        logger.info(f"完整路径: {full_path}")
        logger.info(f"路径是否存在: {full_path.exists()}")
        
        # 安全检查：确保文件在output目录内
        try:
            resolved_path = full_path.resolve()
            resolved_output = output_dir.resolve()
            if not str(resolved_path).startswith(str(resolved_output)):
                logger.error(f"路径安全检查失败: {resolved_path} 不在 {resolved_output} 内")
                raise HTTPException(status_code=403, detail="Access denied")
        except Exception as path_e:
            logger.error(f"路径解析错误: {str(path_e)}")
            raise HTTPException(status_code=403, detail="Path resolution failed")
        
        if not full_path.exists():
            if settings.output_storage_backend == "cos":
                prefix = (settings.output_cos_prefix or "root/fasium/output").strip().strip("/")
                public_base = (settings.output_cos_public_base_url or "").strip().rstrip("/")
                if not public_base:
                    public_base = f"https://{settings.output_cos_bucket}.cos.{settings.output_cos_region}.myqcloud.com"
                cos_url = f"{public_base}/{prefix}/{relative_path.lstrip('/')}"
                logger.info(f"本地文件不存在，重定向到COS: {cos_url}")
                return RedirectResponse(url=cos_url, status_code=307)

            logger.error(f"文件不存在: {full_path}")
            # 列出output目录内容用于调试
            try:
                if output_dir.exists():
                    files = list(output_dir.rglob("*"))
                    logger.info(f"output目录内容: {[str(f) for f in files]}")
                else:
                    logger.error("output目录不存在")
            except Exception as list_e:
                logger.error(f"列出目录内容失败: {str(list_e)}")
            return Response(
                status_code=404,
                headers={
                    "Cache-Control": "public, max-age=300",
                },
            )
        
        logger.info(f"成功提供文件: {full_path}")
        return FileResponse(full_path)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"提供文件失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to serve file: {str(e)}")


@router.get("/static/markdown/{file_path:path}")
async def serve_stored_markdown(file_path: str):
    """
    提供存储的 Markdown 文件
    """
    logger = get_proxy_logger()

    try:
        relative_path = file_path
        if relative_path.startswith("output/"):
            relative_path = relative_path[len("output/") :]
        relative_path = relative_path.lstrip("/")

        output_dir = Path(settings.output_storage_path).resolve()
        full_path = output_dir / relative_path

        logger.info(f"请求 Markdown 文件: {file_path}")

        try:
            resolved_path = full_path.resolve()
            resolved_output = output_dir.resolve()
            if not str(resolved_path).startswith(str(resolved_output)):
                logger.error(f"路径安全检查失败: {resolved_path} 不在 {resolved_output} 内")
                raise HTTPException(status_code=403, detail="Access denied")
        except Exception as path_e:
            logger.error(f"路径解析错误: {str(path_e)}")
            raise HTTPException(status_code=403, detail="Path resolution failed")

        if not full_path.exists():
            logger.error(f"文件不存在: {full_path}")
            raise HTTPException(status_code=404, detail="File not found")

        return FileResponse(full_path, media_type="text/markdown; charset=utf-8")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"提供 Markdown 文件失败: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to serve file: {str(e)}")
