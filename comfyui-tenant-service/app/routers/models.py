from __future__ import annotations

import base64
import binascii
import json
import mimetypes
import random
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..models.database import get_db
from ..routers.auth import get_current_user
from ..services.config import get_settings
from ..services.image_storage import image_storage_service
from ..services.lora_service import lora_service
from ..services.logger import get_main_logger
from ..services.poloapi_client import PoloAPIError, call_poloapi_image_chat
from ..services.poloapi_usage_service import log_poloapi_usage
from ..services.task_record_service import task_record_service

router = APIRouter()
logger = get_main_logger()
settings = get_settings()


def _get_username(current_user: Any) -> str:
    return current_user.username if hasattr(current_user, "username") else current_user["username"]


def _safe_subdir(name: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]+", "-", name.strip()).strip("-")
    if not normalized:
        normalized = "lora"
    return normalized[:50]


def _normalize_access_list(raw_value: Optional[str]) -> List[str]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
        if isinstance(parsed, list):
            return [str(item) for item in parsed if isinstance(item, (str, int))]
        if isinstance(parsed, str):
            return [parsed]
    except json.JSONDecodeError:
        pass
    return [value.strip() for value in raw_value.split(",") if value.strip()]


def _extract_data_url(content: Any) -> Optional[str]:
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
        text_payload = "\n".join(parts)
    elif isinstance(content, dict):
        text_value = content.get("text")
        if isinstance(text_value, str):
            text_payload = text_value

    if not text_payload:
        return None
    match = re.search(r"(data:image/[^;]+;base64,[A-Za-z0-9+/=]+)", text_payload)
    return match.group(1) if match else None


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
    if path_value.startswith("http://") or path_value.startswith("https://"):
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
            # Original relative path as-is (handles `output\\...`)
            normalized_candidates.append(Path(candidate))

            # Relative to current working directory
            normalized_candidates.append(Path.cwd() / path_obj)

            # Relative to base storage (strip duplicated `output/` prefix)
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


class LoraRecordResponse(BaseModel):
    lora_id: str
    owner_user_id: str
    name: str
    description: Optional[str] = None
    access_user_ids: List[str] = Field(default_factory=list)
    file_entries: List[Dict[str, Optional[str]]] = Field(default_factory=list)
    directory: Optional[str] = None
    training_status: int = 1
    preview_entry: Optional[Dict[str, Optional[str]]] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class LoraUpdatePayload(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    access_user_ids: Optional[List[str]] = None


@router.get("/models/lora", response_model=Dict[str, List[LoraRecordResponse]])
async def list_lora_records(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = _get_username(current_user)
    records = lora_service.list_records(db, username)
    return {"items": [LoraRecordResponse(**record) for record in records]}


@router.post("/models/lora", response_model=LoraRecordResponse)
async def create_lora_record(
    name: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    access_user_ids: Optional[str] = Form(None),
    files: List[UploadFile] = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = _get_username(current_user)
    if not files:
        raise HTTPException(status_code=400, detail="至少上传一个文件")

    final_name = name.strip() if isinstance(name, str) else ""
    if not final_name:
        final_name = datetime.utcnow().strftime("%Y%m%d_%H%M%S")

    access_list = _normalize_access_list(access_user_ids)
    safe_subdir = f"lora/{_safe_subdir(final_name)}_{uuid4().hex[:6]}"
    stored_entries: List[Dict[str, Optional[str]]] = []

    for upload in files:
        data = await upload.read()
        if not data:
            continue
        try:
            stored = image_storage_service.store_uploaded_image(
                user_id=username,
                file_bytes=data,
                original_filename=upload.filename,
                content_type=upload.content_type,
                subdir=safe_subdir,
            )
            stored["filename"] = upload.filename or ""
            stored_entries.append(stored)
        except ValueError as exc:
            logger.error("Failed to store lora file: %s", exc)
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not stored_entries:
        raise HTTPException(status_code=400, detail="未能保存任何文件")

    directory = str(image_storage_service.base_storage_path / username / safe_subdir)
    record = lora_service.create_record(
        db=db,
        owner_user_id=username,
        name=final_name,
        file_entries=stored_entries,
        directory=directory,
        access_user_ids=access_list,
        description=description,
    )
    return LoraRecordResponse(**record)


@router.patch("/models/lora/{lora_id}", response_model=LoraRecordResponse)
async def update_lora_record(
    lora_id: str,
    payload: LoraUpdatePayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = _get_username(current_user)
    record = lora_service.update_record(
        db,
        lora_id,
        username,
        name=payload.name,
        description=payload.description,
        access_user_ids=payload.access_user_ids,
    )
    if not record:
        raise HTTPException(status_code=404, detail="记录不存在或无权限")
    return LoraRecordResponse(**record)


@router.delete("/models/lora/{lora_id}", response_model=Dict[str, str])
async def delete_lora_record(
    lora_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = _get_username(current_user)
    existing = lora_service.get_record(db, lora_id)
    if not existing or existing.get("owner_user_id") != username:
        raise HTTPException(status_code=404, detail="记录不存在或无权限")

    success = lora_service.delete_record(db, lora_id, username)
    if not success:
        raise HTTPException(status_code=404, detail="删除失败")

    for file_entry in existing.get("file_entries") or []:
        try:
            image_storage_service.delete_entry(file_entry)
        except Exception as exc:
            logger.warning("删除 LoRA 存储对象失败 %s: %s", file_entry, exc)
    preview_entry = existing.get("preview_entry")
    if isinstance(preview_entry, dict):
        try:
            image_storage_service.delete_entry(preview_entry)
        except Exception as exc:
            logger.warning("删除 LoRA 预览对象失败 %s: %s", preview_entry, exc)

    directory = existing.get("directory")
    if directory:
        try:
            target = Path(directory)
            if target.exists() and target.is_dir():
                for child in target.glob("**/*"):
                    if child.is_file():
                        child.unlink(missing_ok=True)
                for child in sorted(target.glob("**/*"), reverse=True):
                    if child.is_dir():
                        child.rmdir()
                target.rmdir()
        except Exception as exc:
            logger.warning("删除本地LoRA目录失败 %s: %s", directory, exc)

    return {"detail": "删除成功"}


@router.post("/models/lora/{lora_id}/preview", response_model=LoraRecordResponse)
async def generate_lora_preview(
    lora_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    username = _get_username(current_user)
    record = lora_service.get_record(db, lora_id)
    if not record or record.get("owner_user_id") != username:
        raise HTTPException(status_code=404, detail="记录不存在或无权限")

    file_entries = record.get("file_entries") or []
    if not file_entries:
        raise HTTPException(status_code=400, detail="没有可用的训练素材，无法测试模型")

    shuffled_entries = [entry for entry in file_entries if entry]
    random.shuffle(shuffled_entries)
    sample_count = min(3, len(shuffled_entries))
    images_payload: List[tuple[bytes, str]] = []

    record_directory = record.get("directory")
    for entry in shuffled_entries:
        loaded = await _load_entry_payload(entry, record_directory)
        if not loaded:
            continue
        payload, mime_type = loaded
        images_payload.append((payload, mime_type))
        if len(images_payload) >= sample_count:
            break

    if not images_payload:
        raise HTTPException(status_code=400, detail="无法读取训练素材文件")

    prompt = (
        "参考我提供的图片中的服装，9:16 结合我提供的图片再生成一张不带模特的新服装图片，"
        "保持高质感光线与姿态，自然呈现。"
    )

    try:
        polo_response = await call_poloapi_image_chat(
            prompt,
            images_payload,
            model=settings.poloapi_baokuan_model or settings.poloapi_default_model,
        )
    except PoloAPIError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    choices = polo_response.get("choices") or []
    if not choices:
        raise HTTPException(status_code=502, detail="未从模型获取到图片结果")
    message = (choices[0] or {}).get("message") or {}
    data_url = _extract_data_url(message.get("content"))
    if not data_url:
        raise HTTPException(status_code=502, detail="模型返回的图片格式无法解析")

    if "," not in data_url:
        raise HTTPException(status_code=502, detail="不支持的图片编码")
    header, encoded = data_url.split(",", 1)
    mime_match = re.match(r"data:(?P<mime>[^;]+);base64", header)
    if not mime_match:
        raise HTTPException(status_code=502, detail="不支持的图片编码格式")
    mime_type = mime_match.group("mime")
    try:
        image_bytes = base64.b64decode(encoded)
    except (ValueError, binascii.Error) as exc:  # type: ignore[name-defined]
        raise HTTPException(status_code=502, detail="解析图片数据失败") from exc

    try:
        stored_entry = image_storage_service.store_uploaded_image(
            user_id=username,
            file_bytes=image_bytes,
            original_filename=f"{lora_id}_preview_{uuid4().hex[:6]}.png",
            content_type=mime_type,
            subdir=f"lora_previews/{lora_id}",
        )
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    storage_paths: List[str] = []
    if isinstance(stored_entry, dict):
        for key in ("original", "localPath", "thumbnail", "thumbnailPath"):
            value = stored_entry.get(key)
            if value:
                storage_paths.append(str(value))

    log_poloapi_usage(
        db,
        user_id=username,
        endpoint=f"/models/lora/{lora_id}/preview",
        model=settings.poloapi_baokuan_model or settings.poloapi_default_model,
        prompt=prompt,
        response_text=_sanitize_poloapi_text(_extract_poloapi_text(polo_response)),
        image_paths=storage_paths or None,
    )

    runninghub_task_id = f"model_test_{uuid4().hex[:10]}"
    tenant_task_id = task_record_service.create_task_record(
        username,
        runninghub_task_id,
        db,
        task_type="lora_preview",
    )

    try:
        updated_record = lora_service.set_preview_entry(db, lora_id, username, stored_entry)
        if not updated_record:
            raise HTTPException(status_code=404, detail="记录不存在或无权限")

        result_payload = {
            "lora_id": lora_id,
            "generated_at": datetime.utcnow().isoformat(),
        }
        updated = task_record_service.update_task_success(
            tenant_task_id,
            result_payload,
            [stored_entry],
            db,
        )
        if not updated:
            raise HTTPException(status_code=500, detail="任务记录更新失败")
    except HTTPException as exc:
        task_record_service.update_task_failed(tenant_task_id, exc.detail if isinstance(exc.detail, str) else str(exc.detail), db)
        raise
    except Exception as exc:
        task_record_service.update_task_failed(tenant_task_id, str(exc), db)
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return LoraRecordResponse(**updated_record)
