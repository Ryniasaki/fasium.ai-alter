from __future__ import annotations

import asyncio
import base64
import binascii
import json
import mimetypes
import random
import re
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..routers.auth import get_current_user
from ..services.config import get_settings
from ..services.image_storage import image_storage_service
from ..services.logger import get_main_logger
from ..services.lora_service import lora_service
from ..services.poloapi_client import PoloAPIError, call_poloapi_image_chat
from ..services.poloapi_usage_service import log_poloapi_usage
from ..services.task_record_service import task_record_service

router = APIRouter()
settings = get_settings()
logger = get_main_logger()


class TrendingReport(BaseModel):
    id: str
    headline: str
    generated_at: str
    markdown_path: str
    content: str


class TrendingGenerateRequest(BaseModel):
    collection_id: str
    trend_id: Optional[str] = None
    trend_name: str
    trend_summary: str
    trend_description: Optional[str] = None
    use_reference_model: bool = Field(default=False, alias="useReferenceModel")
    reference_lora_id: Optional[str] = Field(default=None, alias="referenceLoraId")
    reference_image_data_url: Optional[str] = Field(default=None, alias="referenceImageDataUrl")

    class Config:
        allow_population_by_field_name = True


def _get_repo_root() -> Path:
    storage_path = Path(settings.json_storage_path).resolve()
    return storage_path.parent


def _resolve_path(value: str) -> Optional[Path]:
    if not value:
        return None
    path = Path(value)
    if not path.is_absolute():
        path = (_get_repo_root() / path).resolve()
    if path.exists():
        return path
    return None


def _get_username(current_user: Any) -> str:
    return current_user.username if hasattr(current_user, "username") else current_user["username"]


def _resolve_entry_path(entry: Any, record_directory: Optional[str] = None) -> Optional[Path]:
    path_value: Optional[str] = None
    if isinstance(entry, str):
        path_value = entry
    elif isinstance(entry, dict):
        for key in ("original", "localPath", "path"):
            candidate = entry.get(key)
            if isinstance(candidate, str) and candidate:
                path_value = candidate
                break
    if not path_value:
        return None

    url_prefix = "/api/proxy/static/images/"
    if path_value.startswith(("http://", "https://")):
        return None

    base_storage = image_storage_service.base_storage_path.resolve()
    candidate_strings: List[str] = [path_value]
    if path_value.startswith(url_prefix):
        candidate_strings.append(path_value[len(url_prefix) :])

    normalized_candidates: List[Path] = []
    record_dir_path = Path(record_directory) if record_directory else None

    for candidate in candidate_strings:
        path_obj = Path(candidate)
        if path_obj.is_absolute():
            normalized_candidates.append(path_obj)
        else:
            normalized_candidates.append(Path(candidate))
            normalized_candidates.append(Path.cwd() / path_obj)

            stripped = Path(candidate.lstrip("./\\"))
            stripped_parts = stripped.parts
            if stripped_parts and stripped_parts[0].lower() == base_storage.name.lower():
                stripped = Path(*stripped_parts[1:]) if len(stripped_parts) > 1 else Path(".")
            normalized_candidates.append(base_storage / stripped)

            if record_dir_path:
                normalized_candidates.append(record_dir_path / path_obj.name)
                normalized_candidates.append(record_dir_path / path_obj)

    for candidate in normalized_candidates:
        resolved = candidate.resolve()
        if resolved.exists():
            return resolved

    return normalized_candidates[0].resolve() if normalized_candidates else None


def _extract_entry_reference(entry: Any) -> Optional[str]:
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        for key in ("original", "localPath", "path"):
            candidate = entry.get(key)
            if isinstance(candidate, str) and candidate:
                return candidate
    return None


async def _load_entry_payload(entry: Any, record_directory: Optional[str] = None) -> Optional[tuple[bytes, str]]:
    reference = _extract_entry_reference(entry)
    if not reference:
        return None
    if reference.startswith(("http://", "https://")):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(reference)
                response.raise_for_status()
                mime_type = response.headers.get("content-type") or mimetypes.guess_type(reference)[0] or "image/png"
                return response.content, mime_type
        except Exception:
            return None

    path = _resolve_entry_path(entry, record_directory)
    if not path or not path.exists():
        return None
    try:
        payload = path.read_bytes()
    except OSError:
        return None
    mime_type = mimetypes.guess_type(str(path))[0] or "image/png"
    return payload, mime_type


async def _collect_reference_images(record: Dict[str, Any], sample_count: int = 3) -> List[tuple[bytes, str]]:
    file_entries = record.get("file_entries") or []
    if not isinstance(file_entries, list):
        return []
    selectable = [entry for entry in file_entries if entry]
    if not selectable:
        return []

    random.shuffle(selectable)
    collected: List[tuple[bytes, str]] = []
    record_directory = record.get("directory")

    for entry in selectable:
        loaded = await _load_entry_payload(entry, record_directory)
        if not loaded:
            continue
        payload, mime_type = loaded
        collected.append((payload, mime_type))
        if len(collected) >= sample_count:
            break

    return collected


@router.get("/trending", response_model=Dict[str, List[TrendingReport]])
def list_trending_reports() -> Dict[str, List[TrendingReport]]:
    index_path = Path(settings.json_storage_path).resolve() / "report" / "report_index.json"
    if not index_path.exists():
        return {"reports": []}

    try:
        payload = json.loads(index_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        logger.error("Failed to parse report index: %s", exc)
        raise HTTPException(status_code=500, detail="Invalid report index file.") from exc

    reports_data = payload.get("reports", [])
    if not isinstance(reports_data, list):
        return {"reports": []}

    items: List[TrendingReport] = []
    for entry in sorted(reports_data, key=lambda x: x.get("generated_at", ""), reverse=True):
        markdown_path = _resolve_path(entry.get("markdown", ""))
        if not markdown_path:
            continue
        try:
            content = markdown_path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Failed to read markdown %s: %s", markdown_path, exc)
            continue

        report_id = markdown_path.stem
        items.append(
            TrendingReport(
                id=report_id,
                headline=entry.get("headline") or report_id,
                generated_at=entry.get("generated_at") or "",
                markdown_path=str(markdown_path),
                content=content,
            )
        )

    return {"reports": items}


def _extract_data_url(content: Any) -> Optional[str]:
    """
    Returns the first data URL found inside the PoloAPI response content.
    """

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


def _sanitize_poloapi_text(text: str) -> str:
    if not text:
        return text
    return re.sub(r"data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+", "[image]", text)


def _decode_base64_data_url(data_url: str) -> Optional[tuple[bytes, str]]:
    if not data_url or not isinstance(data_url, str):
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


@router.post("/trending/generate_baokuan")
async def generate_trending_baokuan(
    payload: TrendingGenerateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    根据趋势解读自动调用 PoloAPI 生成单模特服装预览，并登记到任务记录。
    """

    username = _get_username(current_user)

    trend_summary = (payload.trend_summary or "").strip()
    if not trend_summary:
        raise HTTPException(status_code=400, detail="trend_summary is required")

    instruction = (
        "You are a creative fashion image model. Generate a single human model full-body preview that perfectly "
        "matches the described trend. Keep accessories cohesive, maintain editorial lighting, output only one image "
        "encoded as a data URL, and ensure the composition uses a 9:16 aspect ratio."
    )
    detail = (payload.trend_description or "").strip()
    prompt_parts = [
        f"Collection ID: {payload.collection_id}",
        f"Trend Name: {payload.trend_name}",
        f"Trend Summary: {trend_summary}",
    ]
    if detail:
        prompt_parts.append(f"Trend Detail: {detail}")
    prompt_parts.append(
        "Requirement: produce an outfit suitable for this trend with a single model posing naturally. "
        "Do not include additional models or distracting backgrounds."
    )
    prompt_parts.append(instruction)

    reference_images: List[tuple[bytes, str]] = []
    reference_prompt_notes: List[str] = []
    should_use_reference = bool(payload.use_reference_model and payload.reference_lora_id)
    if should_use_reference:
        record = lora_service.get_record(db, payload.reference_lora_id)
        if not record:
            raise HTTPException(status_code=404, detail="选择的模型不存在")
        access_list = record.get("access_user_ids") or []
        owner_user_id = record.get("owner_user_id")
        if owner_user_id != username and username not in access_list:
            raise HTTPException(status_code=403, detail="无权使用该模型")

        lora_images = await _collect_reference_images(record)
        if not lora_images:
            raise HTTPException(status_code=400, detail="该模型没有可用的参考素材")

        reference_images.extend(lora_images)
        reference_prompt_notes.append("不要出现原图中的元素，只需要参考，生成出的图片应该与参考图有明显区别但保留其调性。")

    inline_reference = (payload.reference_image_data_url or "").strip()
    if inline_reference:
        decoded = _decode_base64_data_url(inline_reference)
        if not decoded:
            raise HTTPException(status_code=400, detail="参考图片格式不受支持")
        reference_images.insert(0, decoded)
        reference_prompt_notes.append("请参考我提供的服装图，创作出细节上有变化但保留整体质感与风格的衍生款。")

    for note in reference_prompt_notes:
        prompt_parts.append(note)

    prompt = "\n".join(prompt_parts)

    async def _generate_single(index: int) -> Dict[str, Any]:
        try:
            polo_response = await call_poloapi_image_chat(
                prompt,
                images=reference_images if reference_images else None,
                model=settings.poloapi_baokuan_model or settings.poloapi_default_model,
            )
        except PoloAPIError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        choices = polo_response.get("choices") or []
        if not choices:
            raise HTTPException(status_code=502, detail="PoloAPI did not return any choices")
        message = (choices[0] or {}).get("message") or {}
        data_url = _extract_data_url(message.get("content"))
        if not data_url:
            raise HTTPException(status_code=502, detail="Failed to parse PoloAPI image output")

        header, encoded = data_url.split(",", 1)
        mime_match = re.match(r"data:(?P<mime>[^;]+);base64", header)
        if not mime_match:
            raise HTTPException(status_code=502, detail="Unsupported PoloAPI image format")
        mime_type = mime_match.group("mime")

        try:
            image_bytes = base64.b64decode(encoded)
        except (ValueError, binascii.Error) as exc:  # type: ignore[name-defined]
            raise HTTPException(status_code=502, detail="Failed to decode PoloAPI image data") from exc

        try:
            storage_entry = image_storage_service.store_uploaded_image(
                user_id=username,
                file_bytes=image_bytes,
                original_filename=f"{payload.trend_id or 'trend'}_{index+1}_{uuid4().hex[:4]}.png",
                content_type=mime_type,
                subdir="t2i",
            )
        except ValueError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

        storage_paths: List[str] = []
        if isinstance(storage_entry, dict):
            for key in ("original", "localPath", "thumbnail", "thumbnailPath"):
                value = storage_entry.get(key)
                if value:
                    storage_paths.append(str(value))

        log_poloapi_usage(
            db,
            user_id=username,
            endpoint="/trending/generate_baokuan",
            model=settings.poloapi_baokuan_model or settings.poloapi_default_model,
            prompt=prompt,
            response_text=_sanitize_poloapi_text(_extract_poloapi_text(polo_response)),
            image_paths=storage_paths or None,
        )

        return storage_entry

    batch_id = uuid4().hex
    try:
        stored_entries = await asyncio.gather(*(_generate_single(idx) for idx in range(4)))
    except HTTPException:
        raise
    except Exception as exc:  # pragma: no cover - defensive
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    runninghub_task_id = f"poloapi_{uuid4().hex[:12]}"
    tenant_task_id = task_record_service.create_task_record(
        username,
        runninghub_task_id,
        db,
        task_type="trending_baokuan",
    )

    result_payload = {
        "batch_id": batch_id,
        "collection_id": payload.collection_id,
        "trend_id": payload.trend_id,
        "trend_name": payload.trend_name,
        "image_count": len(stored_entries),
    }

    updated = task_record_service.update_task_success(
        tenant_task_id,
        result_payload,
        stored_entries,
        db,
    )
    if not updated:
        raise HTTPException(status_code=500, detail="Failed to update task record")

    return {
        "tenantTaskId": tenant_task_id,
        "batchId": batch_id,
        "taskType": "trending_baokuan",
        "images": stored_entries,
    }


@router.post("/trending/generate_tongkuan")
async def generate_trending_tongkuan(
    payload: TrendingGenerateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Dict[str, Any]:
    """
    临时共用爆款生成逻辑，用于“生成同款”入口。
    """

    return await generate_trending_baokuan(payload, current_user=current_user, db=db)
