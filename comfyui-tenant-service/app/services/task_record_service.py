"""
任务记录服务
管理tenant任务记录
"""
import base64
import binascii
import json
import mimetypes
import re
import uuid
from datetime import datetime
from typing import Dict, Any, Optional, List, Tuple
from sqlalchemy import text
from sqlalchemy.orm import Session
from ..models.database import TenantTaskRecord, ProjectRecord
from ..models.database import get_db
from ..services.image_storage import image_storage_service
from ..services.logger import get_task_record_logger
from ..services.config import get_settings
from ..services.sheet_markdown_storage import persist_sheet_markdown
from ..services.ws_manager import fire_and_forget, task_ws_manager
from ..services.runtime_cache import cache_delete, cache_delete_prefix, cache_key

logger = get_task_record_logger()

_DATA_IMAGE_URL_RE = re.compile(r"^data:(?P<mime>[^;]+);base64,(?P<data>[A-Za-z0-9+/=\s]+)$", re.IGNORECASE)


def _is_data_image_url(value: Any) -> bool:
    return isinstance(value, str) and value.strip().startswith("data:image/")


def _decode_data_image_url(data_url: str) -> Optional[Tuple[bytes, str]]:
    if not isinstance(data_url, str):
        return None
    match = _DATA_IMAGE_URL_RE.match(data_url.strip())
    if not match:
        return None
    mime_type = (match.group("mime") or "image/png").split(";", 1)[0].strip().lower() or "image/png"
    encoded = match.group("data") or ""
    try:
        return base64.b64decode(encoded), mime_type
    except (ValueError, binascii.Error):
        return None


def _guess_image_extension(mime_type: str) -> str:
    normalized_mime = (mime_type or "image/png").split(";", 1)[0].strip().lower() or "image/png"
    extension = mimetypes.guess_extension(normalized_mime) or ".png"
    if extension == ".jpe":
        extension = ".jpg"
    return extension.lstrip(".")


def _public_storage_reference(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    raw = value.strip()
    if not raw:
        return raw
    if raw.startswith(("http://", "https://", "/api/proxy/static/images/")):
        return raw

    normalized = raw.replace("\\", "/")
    if "/output/" in normalized:
        normalized = normalized.split("/output/", 1)[1]
    elif normalized.startswith("output/"):
        normalized = normalized[len("output/"):]

    normalized = normalized.lstrip("/")
    if not normalized:
        return raw
    return f"/api/proxy/static/images/{normalized}"


def _store_board_image_bytes(
    *,
    user_id: str,
    project_id: str,
    asset_id: str,
    payload: bytes,
    mime_type: str,
) -> Optional[Dict[str, Any]]:
    normalized_mime = (mime_type or "image/png").split(";", 1)[0].strip().lower() or "image/png"
    extension = _guess_image_extension(normalized_mime)
    subdir = f"projects/{project_id}/board" if project_id else "projects/board"

    try:
        if extension == "svg":
            return image_storage_service._store_binary_bytes(  # noqa: SLF001 - internal normalization helper
                user_id=user_id,
                payload=payload,
                extension="svg",
                content_type="image/svg+xml",
                subdir=subdir,
            )
        return image_storage_service.store_uploaded_image(
            user_id=user_id,
            file_bytes=payload,
            original_filename=f"{asset_id or uuid.uuid4().hex}.{extension}",
            content_type=normalized_mime,
            subdir=subdir,
        )
    except Exception as exc:
        logger.warning("画板图片转存失败 project_id=%s asset_id=%s: %s", project_id, asset_id, exc)
        return None


def _normalize_board_data_url_reference(
    *,
    raw_value: str,
    user_id: str,
    project_id: str,
    asset_id: str,
    cache: Dict[str, Dict[str, str]],
) -> Optional[Dict[str, str]]:
    normalized_raw = raw_value.strip()
    if not normalized_raw:
        return None

    cached = cache.get(normalized_raw)
    if cached is not None:
        return cached

    decoded = _decode_data_image_url(normalized_raw)
    if not decoded:
        return None

    payload, mime_type = decoded
    storage_entry = _store_board_image_bytes(
        user_id=user_id,
        project_id=project_id,
        asset_id=asset_id,
        payload=payload,
        mime_type=mime_type,
    )
    if not storage_entry:
        return None

    original_reference = _public_storage_reference(storage_entry.get("original") or storage_entry.get("localPath"))
    preview_reference = _public_storage_reference(
        storage_entry.get("thumbnail")
        or storage_entry.get("thumbnailPath")
        or storage_entry.get("original")
        or storage_entry.get("localPath")
    )

    normalized_entry = {
        "original": original_reference if isinstance(original_reference, str) and original_reference else normalized_raw,
        "preview": preview_reference if isinstance(preview_reference, str) and preview_reference else (original_reference if isinstance(original_reference, str) else normalized_raw),
    }
    cache[normalized_raw] = normalized_entry
    return normalized_entry


def _normalize_project_board_assets(
    project_content: Optional[Dict[str, Any]],
    *,
    user_id: Optional[str],
    project_id: Optional[str],
) -> Tuple[Dict[str, Any], bool]:
    if not isinstance(project_content, dict):
        return project_content, False

    board = project_content.get("board")
    if not isinstance(board, dict):
        return project_content, False

    canvas_assets = board.get("canvasAssets")
    if not isinstance(canvas_assets, list):
        return project_content, False

    owner_id = (user_id or "").strip()
    board_project_id = (project_id or "").strip()
    if not owner_id or not board_project_id:
        return project_content, False

    cache: Dict[str, Dict[str, str]] = {}
    changed = False
    normalized_assets: List[Any] = []

    for asset in canvas_assets:
        if not isinstance(asset, dict):
            normalized_assets.append(asset)
            continue

        updated_asset = dict(asset)
        asset_id = str(asset.get("id") or board_project_id)
        url_value = asset.get("url")
        preview_value = asset.get("previewUrl")
        url_is_data = _is_data_image_url(url_value)
        preview_is_data = _is_data_image_url(preview_value)

        if url_is_data:
            normalized_url = _normalize_board_data_url_reference(
                raw_value=str(url_value).strip(),
                user_id=owner_id,
                project_id=board_project_id,
                asset_id=asset_id,
                cache=cache,
            )
            if normalized_url:
                original_reference = normalized_url.get("original")
                preview_reference = normalized_url.get("preview")
                if isinstance(original_reference, str) and original_reference and original_reference != url_value:
                    updated_asset["url"] = original_reference
                    changed = True
                if preview_is_data:
                    normalized_preview = normalized_url.get("preview") if isinstance(preview_value, str) and preview_value.strip() == str(url_value).strip() else None
                    if not normalized_preview:
                        normalized_preview = _normalize_board_data_url_reference(
                            raw_value=str(preview_value).strip(),
                            user_id=owner_id,
                            project_id=board_project_id,
                            asset_id=f"{asset_id}-preview",
                            cache=cache,
                        ) if isinstance(preview_value, str) else None
                        normalized_preview = normalized_preview.get("original") if normalized_preview else None
                    if isinstance(normalized_preview, str) and normalized_preview and normalized_preview != preview_value:
                        updated_asset["previewUrl"] = normalized_preview
                        changed = True
                elif not isinstance(preview_value, str) or not preview_value.strip():
                    if isinstance(preview_reference, str) and preview_reference and preview_reference != preview_value:
                        updated_asset["previewUrl"] = preview_reference
                        changed = True
            normalized_assets.append(updated_asset)
            continue

        if preview_is_data:
            normalized_preview = _normalize_board_data_url_reference(
                raw_value=str(preview_value).strip(),
                user_id=owner_id,
                project_id=board_project_id,
                asset_id=f"{asset_id}-preview",
                cache=cache,
            )
            if normalized_preview:
                original_reference = normalized_preview.get("original")
                if isinstance(original_reference, str) and original_reference and original_reference != preview_value:
                    updated_asset["previewUrl"] = original_reference
                    changed = True

        normalized_assets.append(updated_asset)

    if not changed:
        return project_content, False

    normalized_board = dict(board)
    normalized_board["canvasAssets"] = normalized_assets
    normalized_content = dict(project_content)
    normalized_content["board"] = normalized_board
    return normalized_content, True


class SQLProjectStorage:
    def __init__(self, session: Session):
        self.db = session

    def _normalize_content(self, project_content: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        content = dict(project_content or {})
        task_ids = content.get("task_ids")
        if task_ids is None:
            task_ids = []
        elif not isinstance(task_ids, list):
            task_ids = [task_ids]
        content["task_ids"] = list(dict.fromkeys(task_ids))
        return content

    def _deserialize_content(self, raw: Any) -> Dict[str, Any]:
        if raw is None:
            return {}
        if isinstance(raw, (dict, list)):
            return dict(raw) if isinstance(raw, dict) else {"task_ids": list(raw)}
        if isinstance(raw, str):
            try:
                data = json.loads(raw)
                return data if isinstance(data, dict) else {}
            except (json.JSONDecodeError, TypeError, ValueError):
                return {}
        return {}

    def _serialize_content(self, content: Dict[str, Any]) -> str:
        return json.dumps(content or {}, ensure_ascii=False)

    def _record_to_dict(self, record: ProjectRecord) -> Dict[str, Any]:
        return {
            "project_id": getattr(record, "project_id", None),
            "user_id": getattr(record, "user_id", None),
            "project_content": self._deserialize_content(getattr(record, "project_content", None)),
            "created_at": getattr(record, "created_at", None).isoformat() if getattr(record, "created_at", None) else None,
            "updated_at": getattr(record, "updated_at", None).isoformat() if getattr(record, "updated_at", None) else None,
        }

    def create_project(
        self,
        user_id: str,
        project_content: Optional[Dict[str, Any]] = None,
        project_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        content = self._normalize_content(project_content)
        final_project_id = (
            project_id
            or (project_content or {}).get("project_id")
            or f"project_{uuid.uuid4().hex[:16]}"
        )

        existing = (
            self.db.query(ProjectRecord)
            .filter(ProjectRecord.project_id == final_project_id)
            .first()
        )
        if existing:
            raise ValueError(f"Project ID already exists: {final_project_id}")

        try:
            now = datetime.utcnow()
            record = ProjectRecord(
                project_id=final_project_id,
                user_id=user_id,
                project_content=self._serialize_content(content),
                created_at=now,
                updated_at=now,
            )
            self.db.add(record)
            self.db.commit()
            self.db.refresh(record)
            return self._record_to_dict(record)
        except Exception:
            self.db.rollback()
            raise

    def get_project_by_id(self, project_id: str) -> Optional[Dict[str, Any]]:
        record = (
            self.db.query(ProjectRecord)
            .filter(ProjectRecord.project_id == project_id)
            .first()
        )
        if not record:
            return None
        return self._record_to_dict(record)

    def get_project_access_summary(self, project_id: str) -> Optional[Dict[str, Any]]:
        bind = getattr(self.db, "bind", None)
        dialect_name = getattr(getattr(bind, "dialect", None), "name", "")

        try:
            if dialect_name == "sqlite":
                row = (
                    self.db.execute(
                        text(
                            """
                            SELECT
                                project_id,
                                user_id,
                                COALESCE(json_extract(project_content, '$.task_ids'), '[]') AS task_ids_json,
                                created_at,
                                updated_at
                            FROM tenant_projects
                            WHERE project_id = :project_id
                            LIMIT 1
                            """
                        ),
                        {"project_id": project_id},
                    )
                    .mappings()
                    .first()
                )
            elif dialect_name in {"postgresql", "postgres"}:
                row = (
                    self.db.execute(
                        text(
                            """
                            SELECT
                                project_id,
                                user_id,
                                COALESCE((project_content::json -> 'task_ids')::text, '[]') AS task_ids_json,
                                created_at,
                                updated_at
                            FROM tenant_projects
                            WHERE project_id = :project_id
                            LIMIT 1
                            """
                        ),
                        {"project_id": project_id},
                    )
                    .mappings()
                    .first()
                )
            else:
                row = None

            if row:
                raw_task_ids = row.get("task_ids_json")
                if isinstance(raw_task_ids, str):
                    try:
                        task_ids = json.loads(raw_task_ids)
                    except (json.JSONDecodeError, TypeError, ValueError):
                        task_ids = []
                elif isinstance(raw_task_ids, list):
                    task_ids = raw_task_ids
                else:
                    task_ids = []

                if not isinstance(task_ids, list):
                    task_ids = []

                return {
                    "project_id": row.get("project_id"),
                    "user_id": row.get("user_id"),
                    "task_ids": [task_id for task_id in task_ids if isinstance(task_id, str)],
                    "created_at": row.get("created_at").isoformat() if row.get("created_at") else None,
                    "updated_at": row.get("updated_at").isoformat() if row.get("updated_at") else None,
                }
        except Exception as exc:
            logger.warning(f"轻量读取项目摘要失败，回退到完整项目读取: {exc}")

        project = self.get_project_by_id(project_id)
        if not project:
            return None

        content = project.get("project_content") or {}
        task_ids = content.get("task_ids") if isinstance(content, dict) else []
        if not isinstance(task_ids, list):
            task_ids = []

        return {
            "project_id": project.get("project_id"),
            "user_id": project.get("user_id"),
            "task_ids": [task_id for task_id in task_ids if isinstance(task_id, str)],
            "created_at": project.get("created_at"),
            "updated_at": project.get("updated_at"),
        }

    def list_projects(self, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        query = self.db.query(ProjectRecord)
        if user_id:
            query = query.filter(ProjectRecord.user_id == user_id)
        records = query.all()
        return [self._record_to_dict(record) for record in records]

    def add_task_to_project(
        self,
        project_id: str,
        task_id: str,
        user_id: Optional[str] = None,
        project_content: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        record = (
            self.db.query(ProjectRecord)
            .filter(ProjectRecord.project_id == project_id)
            .first()
        )

        try:
            if record is None:
                if user_id is None:
                    raise ValueError("user_id is required when creating a new project")
                content = self._normalize_content(project_content)
                content["task_ids"].append(task_id)
                now = datetime.utcnow()
                record = ProjectRecord(
                    project_id=project_id,
                    user_id=user_id,
                    project_content=self._serialize_content(content),
                    created_at=now,
                    updated_at=now,
                )
                self.db.add(record)
                self.db.commit()
                self.db.refresh(record)
                return self._record_to_dict(record)

            if user_id and record.user_id and record.user_id != user_id:
                raise ValueError("Project owner mismatch")

            content = self._normalize_content(
                self._deserialize_content(record.project_content)
            )
            if task_id not in content["task_ids"]:
                content["task_ids"].append(task_id)
                record.project_content = self._serialize_content(content)
                record.updated_at = datetime.utcnow()
                self.db.commit()
                self.db.refresh(record)

            return self._record_to_dict(record)
        except Exception:
            self.db.rollback()
            raise

    def remove_task_from_project(
        self,
        project_id: str,
        task_id: str,
        user_id: Optional[str] = None,
    ) -> bool:
        record = (
            self.db.query(ProjectRecord)
            .filter(ProjectRecord.project_id == project_id)
            .first()
        )
        if record is None:
            return False

        if user_id and record.user_id and record.user_id != user_id:
            raise ValueError("Project owner mismatch")

        content = self._normalize_content(
            self._deserialize_content(record.project_content)
        )
        if task_id not in content["task_ids"]:
            return False

        try:
            content["task_ids"].remove(task_id)
            record.project_content = self._serialize_content(content)
            record.updated_at = datetime.utcnow()
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            raise

    def update_project_content(
        self,
        project_id: str,
        updates: Dict[str, Any],
        user_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        record = (
            self.db.query(ProjectRecord)
            .filter(ProjectRecord.project_id == project_id)
            .first()
        )
        if record is None:
            return None

        if user_id and record.user_id and record.user_id != user_id:
            raise ValueError("Project owner mismatch")

        content = self._normalize_content(
            self._deserialize_content(record.project_content)
        )
        updates = dict(updates or {})
        task_ids_override = updates.pop("task_ids", None)
        if task_ids_override is not None:
            if not isinstance(task_ids_override, list):
                raise ValueError("task_ids must be a list when provided in updates")
            content["task_ids"] = list(dict.fromkeys(task_ids_override))

        content.update(updates)
        content = persist_sheet_markdown(content, user_id or record.user_id, project_id)
        try:
            record.project_content = self._serialize_content(content)
            record.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(record)
            return self._record_to_dict(record)
        except Exception:
            self.db.rollback()
            raise

    def delete_project(
        self,
        project_id: str,
        user_id: Optional[str] = None,
        confirm_name: Optional[str] = None,
    ) -> bool:
        record = (
            self.db.query(ProjectRecord)
            .filter(ProjectRecord.project_id == project_id)
            .first()
        )
        if record is None:
            return False

        if user_id and record.user_id and record.user_id != user_id:
            raise ValueError("Project owner mismatch")

        content = self._normalize_content(
            self._deserialize_content(record.project_content)
        )
        if content.get("protected"):
            project_name = str(content.get("name") or project_id).strip()
            if not confirm_name or confirm_name.strip() != project_name:
                raise ValueError("Protected project deletion requires an exact project name confirmation")

        try:
            self.db.delete(record)
            self.db.commit()
            return True
        except Exception:
            self.db.rollback()
            raise

class TaskRecordService:
    """任务记录服务"""
    
    def __init__(self):
        pass

    def _invalidate_task_caches(self, user_id: Optional[str], tenant_task_id: Optional[str] = None, task_type: Optional[str] = None) -> None:
        if not user_id:
            return
        settings = get_settings()
        scope = str(settings.storage_type)
        cache_delete_prefix(cache_key("tenant", "tasks", "history", scope, user_id))
        cache_delete_prefix(cache_key("tenant", "tasks", "history", "count", scope, user_id))
        cache_delete_prefix(cache_key("tenant", "tasks", "history", "types", scope, user_id))
        cache_delete_prefix(cache_key("tenant", "tasks", "status", scope, user_id))
        if tenant_task_id:
            cache_delete(cache_key("tenant", "tasks", "status", scope, user_id, tenant_task_id))
        if task_type:
            cache_delete_prefix(cache_key("tenant", "tasks", "history", "count", scope, user_id, task_type))
            cache_delete_prefix(cache_key("tenant", "tasks", "history", scope, user_id, task_type))

    def _notify_task_update(self, user_id: Optional[str], task_payload: Optional[Dict[str, Any]]) -> None:
        if not user_id or not isinstance(task_payload, dict):
            return
        fire_and_forget(task_ws_manager.send_task_update(str(user_id), task_payload))

    def _notify_task_update_by_id(self, tenant_task_id: str, db) -> None:
        task = self.get_task_record_by_tenant_id(tenant_task_id, db)
        if not task:
            return
        self._notify_task_update(task.get("user_id"), task)
    
    def _record_to_dict(self, record) -> Dict[str, Any]:
        """
        将数据库模型或字典统一转换为字典
        """
        if isinstance(record, dict):
            return record

        def _try_load_json(value: Optional[str]):
            if value is None:
                return None
            if isinstance(value, (dict, list)):
                return value
            try:
                return json.loads(value)
            except (TypeError, ValueError):
                return value

        return {
            "id": getattr(record, "id", None),
            "tenant_task_id": getattr(record, "tenant_task_id", None),
            "user_id": getattr(record, "user_id", None),
            "runninghub_task_id": getattr(record, "runninghub_task_id", None),
            "task_type": getattr(record, "task_type", None),
            "status": getattr(record, "status", None),
            "created_at": getattr(record, "created_at", None).isoformat() if getattr(record, "created_at", None) else None,
            "completed_at": getattr(record, "completed_at", None).isoformat() if getattr(record, "completed_at", None) else None,
            "result_data": _try_load_json(getattr(record, "result_data", None)),
            "storage_paths": _try_load_json(getattr(record, "storage_paths", None)),
            "error_message": getattr(record, "error_message", None),
        }
    
    def _get_project_storage(self, db):
        """
        Return a storage backend that understands project.json operations.
        """
        if db and hasattr(db, "query"):
            return SQLProjectStorage(db)

        from ..services.json_storage import JSONStorage
        return JSONStorage()

    def _attach_task_to_project(
        self,
        db,
        project_id: str,
        tenant_task_id: str,
        user_id: str,
        project_content: Optional[Dict[str, Any]] = None,
    ):
        """
        Link a task record to a project entry stored in project.json.
        """
        try:
            storage = self._get_project_storage(db)
            if hasattr(storage, "add_task_to_project"):
                normalized_content = project_content
                if isinstance(project_content, dict):
                    normalized_content, _ = _normalize_project_board_assets(
                        project_content,
                        user_id=user_id,
                        project_id=project_id,
                    )
                storage.add_task_to_project(
                    project_id=project_id,
                    task_id=tenant_task_id,
                    user_id=user_id,
                    project_content=normalized_content,
                )
        except Exception as exc:
            logger.error(f"附加任务到项目失败: {str(exc)}")

    def create_task_record(
        self, 
        user_id: str, 
        runninghub_task_id: str, 
        db,
        task_type: str = None,
        project_id: Optional[str] = None,
        project_content: Optional[Dict[str, Any]] = None,
        result_data: Optional[Dict[str, Any]] = None,
    ) -> str:
        """
        创建任务记录
        
        Args:
            user_id: 用户ID
            runninghub_task_id: RunningHub任务ID
            db: 数据库会话或JSON存储
            task_type: 任务类型（如 "targeted_redesign", "image_edit" 等）
            project_id: 可选的项目ID，用于在project.json中对任务分组
            project_content: 当需要新建项目时附带的内容

        Returns:
            tenant_task_id: Tenant任务ID
        """
        tenant_task_id = f"tenant_{uuid.uuid4().hex[:16]}"
        
        # 检查是否使用数据库存储
        if hasattr(db, 'add'):  # SQLAlchemy session
            task_record = TenantTaskRecord(
                tenant_task_id=tenant_task_id,
                user_id=user_id,
                runninghub_task_id=runninghub_task_id,
                task_type=task_type,
                status="PENDING",
                result_data=json.dumps(result_data, ensure_ascii=False) if isinstance(result_data, dict) else None,
            )
            
            db.add(task_record)
            db.commit()
            db.refresh(task_record)
        else:
            # JSON存储模式，使用JSONStorage
            task_record = db.create_task_record(
                tenant_task_id=tenant_task_id,
                user_id=user_id,
                runninghub_task_id=runninghub_task_id,
                task_type=task_type,
                result_data=result_data,
            )
        
        if project_id:
            self._attach_task_to_project(
                db=db,
                project_id=project_id,
                tenant_task_id=tenant_task_id,
                user_id=user_id,
                project_content=project_content,
            )

        logger.info(f"创建任务记录: {tenant_task_id}, 用户: {user_id}, RunningHub任务: {runninghub_task_id}")
        self._notify_task_update_by_id(tenant_task_id, db)
        self._invalidate_task_caches(user_id, tenant_task_id, task_type)
        return tenant_task_id
    
    def update_task_success(
        self,
        tenant_task_id: str,
        result_data: Dict[str, Any],
        storage_paths: List[Any],
        db
    ) -> bool:
        """
        更新任务为成功状态
        
        Args:
            tenant_task_id: Tenant任务ID
            result_data: 结果数据
            storage_paths: 存储路径列表
            db: 数据库会话
            
        Returns:
            是否更新成功
        """
        try:
            # 检查是否使用数据库存储
            if hasattr(db, 'query'):  # SQLAlchemy session
                task_record = db.query(TenantTaskRecord).filter(
                    TenantTaskRecord.tenant_task_id == tenant_task_id
                ).first()
                
                if not task_record:
                    logger.error(f"未找到任务记录: {tenant_task_id}")
                    return False
                
                existing_billing = None
                if task_record.result_data:
                    try:
                        existing_payload = json.loads(task_record.result_data)
                        if isinstance(existing_payload, dict) and "billing" in existing_payload:
                            existing_billing = existing_payload.get("billing")
                    except Exception:
                        existing_billing = None
                if isinstance(result_data, dict) and existing_billing is not None and "billing" not in result_data:
                    result_data["billing"] = existing_billing

                task_record.status = "SUCCESS"
                task_record.completed_at = datetime.now()
                task_record.result_data = json.dumps(result_data, ensure_ascii=False)
                task_record.storage_paths = json.dumps(storage_paths, ensure_ascii=False)
                
                db.commit()
                logger.info(f"任务记录更新为成功: {tenant_task_id}")
                self._notify_task_update_by_id(tenant_task_id, db)
                self._invalidate_task_caches(str(task_record.user_id), tenant_task_id, task_record.task_type)
                return True
            else:
                # JSON存储模式，使用JSONStorage
                success = db.update_task_success(tenant_task_id, result_data, storage_paths)
                if success:
                    self._notify_task_update_by_id(tenant_task_id, db)
                    record = db.get_task_record_by_tenant_id(tenant_task_id) if hasattr(db, "get_task_record_by_tenant_id") else None
                    if isinstance(record, dict):
                        self._invalidate_task_caches(str(record.get("user_id") or ""), tenant_task_id, record.get("task_type"))
                return success
            
        except Exception as e:
            logger.error(f"更新任务记录失败: {str(e)}")
            if hasattr(db, 'rollback'):
                db.rollback()
            return False

    def update_task_billing(
        self,
        tenant_task_id: str,
        billing_info: Dict[str, Any],
        db,
    ) -> bool:
        try:
            if hasattr(db, "query"):
                task_record = db.query(TenantTaskRecord).filter(
                    TenantTaskRecord.tenant_task_id == tenant_task_id
                ).first()
                if not task_record:
                    logger.error(f"未找到任务记录: {tenant_task_id}")
                    return False
                existing = {}
                if task_record.result_data:
                    try:
                        existing = json.loads(task_record.result_data)
                    except Exception:
                        existing = {}
                if not isinstance(existing, dict):
                    existing = {}
                existing["billing"] = billing_info
                task_record.result_data = json.dumps(existing, ensure_ascii=False)
                db.commit()
                self._notify_task_update_by_id(tenant_task_id, db)
                self._invalidate_task_caches(str(task_record.user_id), tenant_task_id, task_record.task_type)
                return True
            success = db.update_task_billing(tenant_task_id, billing_info)
            if success:
                self._notify_task_update_by_id(tenant_task_id, db)
                record = db.get_task_record_by_tenant_id(tenant_task_id) if hasattr(db, "get_task_record_by_tenant_id") else None
                if isinstance(record, dict):
                    self._invalidate_task_caches(str(record.get("user_id") or ""), tenant_task_id, record.get("task_type"))
            return success
        except Exception as e:
            logger.error(f"更新任务计费信息失败: {str(e)}")
            if hasattr(db, "rollback"):
                db.rollback()
            return False
    
    def update_task_failed(
        self,
        tenant_task_id: str,
        error_message: str,
        db
    ) -> bool:
        """
        更新任务为失败状态
        
        Args:
            tenant_task_id: Tenant任务ID
            error_message: 错误信息
            db: 数据库会话
            
        Returns:
            是否更新成功
        """
        try:
            # 检查是否使用数据库存储
            if hasattr(db, 'query'):  # SQLAlchemy session
                task_record = db.query(TenantTaskRecord).filter(
                    TenantTaskRecord.tenant_task_id == tenant_task_id
                ).first()
                
                if not task_record:
                    logger.error(f"未找到任务记录: {tenant_task_id}")
                    return False
                
                task_record.status = "FAILED"
                task_record.completed_at = datetime.now()
                task_record.error_message = error_message
                
                db.commit()
                logger.info(f"任务记录更新为失败: {tenant_task_id}")
                self._notify_task_update_by_id(tenant_task_id, db)
                self._invalidate_task_caches(str(task_record.user_id), tenant_task_id, task_record.task_type)
                return True
            else:
                # JSON存储模式，使用JSONStorage
                success = db.update_task_failed(tenant_task_id, error_message)
                if success:
                    self._notify_task_update_by_id(tenant_task_id, db)
                    record = db.get_task_record_by_tenant_id(tenant_task_id) if hasattr(db, "get_task_record_by_tenant_id") else None
                    if isinstance(record, dict):
                        self._invalidate_task_caches(str(record.get("user_id") or ""), tenant_task_id, record.get("task_type"))
                return success
            
        except Exception as e:
            logger.error(f"更新任务记录失败: {str(e)}")
            if hasattr(db, 'rollback'):
                db.rollback()
            return False
    
    def get_task_record(self, tenant_task_id: str, db) -> Optional[Dict[str, Any]]:
        """
        获取任务记录
        
        Args:
            tenant_task_id: Tenant任务ID
            db: 数据库会话
            
        Returns:
            任务记录字典，未找到返回None
        """
        try:
            # 检查是否使用数据库存储
            if hasattr(db, 'query'):  # SQLAlchemy session
                task_record = db.query(TenantTaskRecord).filter(
                    TenantTaskRecord.tenant_task_id == tenant_task_id
                ).first()
                
                if task_record:
                    return task_record.to_dict()
                return None
            else:
                # JSON存储模式，使用JSONStorage
                return db.get_task_record_by_tenant_id(tenant_task_id)
            
        except Exception as e:
            logger.error(f"获取任务记录失败: {str(e)}")
            return None
    
    def get_user_tasks(
        self, 
        user_id: str, 
        limit: int = 50, 
        db = None,
        offset: int = 0,
        task_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        获取用户的任务记录
        
        Args:
            user_id: 用户ID
            limit: 限制数量
            db: 数据库会话或JSON存储
            offset: 偏移量
            
        Returns:
            任务记录列表
        """
        try:
            if db is None:
                db = next(get_db())
            
            # 检查是否使用数据库存储
            if hasattr(db, 'query'):  # SQLAlchemy session
                query = db.query(TenantTaskRecord).filter(
                    TenantTaskRecord.user_id == user_id
                ).order_by(TenantTaskRecord.created_at.desc())

                if task_type:
                    query = query.filter(TenantTaskRecord.task_type == task_type)

                task_records = query.offset(offset).limit(limit).all()
                
                return [self._record_to_dict(record) for record in task_records]
            else:
                # JSON存储模式，使用JSONStorage
                return db.get_user_tasks(user_id, limit, offset, task_type)
            
        except Exception as e:
            logger.error(f"获取用户任务记录失败: {str(e)}")
            return []

    def get_user_task_count(
        self,
        user_id: str,
        db = None,
        task_type: Optional[str] = None,
    ) -> int:
        """
        获取用户任务记录总数

        Args:
            user_id: 用户ID
            db: 数据库会话或JSON存储
            task_type: 可选的任务类型筛选

        Returns:
            任务总数
        """
        try:
            if db is None:
                db = next(get_db())

            if hasattr(db, "query"):  # SQLAlchemy session
                query = db.query(TenantTaskRecord).filter(
                    TenantTaskRecord.user_id == user_id
                )

                if task_type:
                    query = query.filter(TenantTaskRecord.task_type == task_type)

                return query.count()
            else:
                # JSON storage
                return db.get_user_task_count(user_id, task_type)
        except Exception as e:
            logger.error(f"获取用户任务数量失败: {str(e)}")
            return 0

    def get_task_record_by_tenant_id(
        self,
        tenant_task_id: str,
        db = None
    ) -> Optional[Dict[str, Any]]:
        """
        通过 tenant_task_id 获取任务记录
        """
        try:
            if db is None:
                db = next(get_db())

            if hasattr(db, "query"):
                task_record = (
                    db.query(TenantTaskRecord)
                    .filter(TenantTaskRecord.tenant_task_id == tenant_task_id)
                    .first()
                )
                if not task_record:
                    return None
                return self._record_to_dict(task_record)
            else:
                return db.get_task_record_by_tenant_id(tenant_task_id)
        except Exception as e:
            logger.error(f"获取任务记录失败: {str(e)}")
            return None

    def update_task_status(
        self,
        tenant_task_id: str,
        status: str,
        db,
        error_message: Optional[str] = None
    ) -> bool:
        """
        更新任务记录状态
        """
        try:
            if hasattr(db, "query"):
                task_record = (
                    db.query(TenantTaskRecord)
                    .filter(TenantTaskRecord.tenant_task_id == tenant_task_id)
                    .first()
                )
                if not task_record:
                    logger.error(f"未找到任务记录: {tenant_task_id}")
                    return False

                task_record.status = status
                if error_message is not None:
                    task_record.error_message = error_message
                if status in {"FAILED", "ERROR"}:
                    task_record.completed_at = datetime.utcnow()
                elif status in {"PENDING", "RUNNING", "PROCESSING", "COMPLETING"}:
                    task_record.completed_at = None

                db.commit()
                self._notify_task_update_by_id(tenant_task_id, db)
                self._invalidate_task_caches(str(task_record.user_id), tenant_task_id, task_record.task_type)
                return True
            else:
                success = db.update_task_status(tenant_task_id, status, error_message)
                if success:
                    self._notify_task_update_by_id(tenant_task_id, db)
                    record = db.get_task_record_by_tenant_id(tenant_task_id) if hasattr(db, "get_task_record_by_tenant_id") else None
                    if isinstance(record, dict):
                        self._invalidate_task_caches(str(record.get("user_id") or ""), tenant_task_id, record.get("task_type"))
                return success
        except Exception as e:
            logger.error(f"更新任务状态失败: {str(e)}")
            if hasattr(db, "rollback"):
                db.rollback()
            return False

    def delete_user_tasks(
        self,
        user_id: str,
        task_ids: Optional[List[str]] = None,
        task_type: Optional[str] = None,
        db = None,
    ) -> int:
        """
        删除用户的任务记录，可按任务ID列表或任务类型过滤

        Args:
            user_id: 用户ID
            task_ids: 要删除的任务tenant_task_id列表，为空表示删除全部
            task_type: 可选的任务类型筛选
            db: 数据库会话或JSON存储

        Returns:
            删除的任务数量
        """
        try:
            if db is None:
                db = next(get_db())

            # SQLAlchemy
            if hasattr(db, "query"):
                query = db.query(TenantTaskRecord).filter(
                    TenantTaskRecord.user_id == user_id
                )

                if task_type:
                    query = query.filter(TenantTaskRecord.task_type == task_type)

                if task_ids:
                    query = query.filter(TenantTaskRecord.tenant_task_id.in_(task_ids))

                count = query.count()
                if count > 0:
                    query.delete(synchronize_session=False)
                    db.commit()
                self._invalidate_task_caches(user_id)
                return count

            # JSON storage
            if task_ids:
                deleted = db.delete_user_tasks(user_id, task_ids)
                self._invalidate_task_caches(user_id, None, task_type)
                return deleted
            deleted = db.delete_all_user_tasks(user_id, task_type)
            self._invalidate_task_caches(user_id, None, task_type)
            return deleted

        except Exception as e:
            logger.error(f"删除用户任务记录失败: {str(e)}")
            if hasattr(db, "rollback"):
                db.rollback()
            return 0

    def get_user_task_types(
        self,
        user_id: str,
        db = None,
    ) -> List[str]:
        """
        获取用户任务记录所包含的所有任务类型（去重）
        """
        try:
            if db is None:
                db = next(get_db())

            if hasattr(db, "query"):  # SQLAlchemy session
                types = (
                    db.query(TenantTaskRecord.task_type)
                    .filter(TenantTaskRecord.user_id == user_id)
                    .distinct()
                    .all()
                )
                return sorted(
                    [t[0] for t in types if isinstance(t, (list, tuple)) and t and t[0]]
                    + [
                        t.task_type
                        for t in types
                        if hasattr(t, "task_type") and t.task_type
                    ]
                )
            else:
                return db.get_user_task_types(user_id)
        except Exception as e:
            logger.error(f"获取用户任务类型失败: {str(e)}")
            return []

    # Project helpers -------------------------------------------------
    def create_project(
        self,
        user_id: str,
        project_content: Optional[Dict[str, Any]] = None,
        project_id: Optional[str] = None,
        db = None,
    ) -> Optional[Dict[str, Any]]:
        """
        创建一个新的项目记录，存储于 project.json
        """
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "create_project"):
                final_project_id = (
                    project_id
                    or (project_content or {}).get("project_id")
                    or f"project_{uuid.uuid4().hex[:16]}"
                )
                normalized_content = project_content
                if isinstance(project_content, dict):
                    normalized_content, _ = _normalize_project_board_assets(
                        project_content,
                        user_id=user_id,
                        project_id=final_project_id,
                    )
                return storage.create_project(user_id, normalized_content, final_project_id)
        except Exception as exc:
            logger.error(f"创建项目失败: {str(exc)}")
        return None

    def get_project(self, project_id: str, db = None) -> Optional[Dict[str, Any]]:
        """按ID获取项目"""
        return self.get_project_by_id(project_id, db)

    def list_projects(self, user_id: Optional[str] = None, db = None) -> List[Dict[str, Any]]:
        """列出全部或指定用户的项目"""
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "list_projects"):
                projects = storage.list_projects(user_id)
                normalized_projects: List[Dict[str, Any]] = []
                for project in projects:
                    if not isinstance(project, dict):
                        normalized_projects.append(project)
                        continue

                    project_content = project.get("project_content")
                    normalized_content, changed = _normalize_project_board_assets(
                        project_content,
                        user_id=project.get("user_id"),
                        project_id=project.get("project_id"),
                    )
                    if changed and hasattr(storage, "update_project_content"):
                        try:
                            updated_project = storage.update_project_content(
                                project.get("project_id"),
                                {"board": normalized_content.get("board")},
                                project.get("user_id"),
                            )
                            if updated_project:
                                normalized_projects.append(updated_project)
                                continue
                        except Exception as exc:
                            logger.warning(f"规范化项目列表中的画板失败: {project.get('project_id')}, {str(exc)}")

                        project = dict(project)
                        project["project_content"] = normalized_content

                    normalized_projects.append(project)

                return normalized_projects
        except Exception as exc:
            logger.error(f"获取项目列表失败: {str(exc)}")
        return []

    def get_project_by_id(self, project_id: str, db = None) -> Optional[Dict[str, Any]]:
        """按ID获取单个项目记录"""
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "get_project_by_id"):
                project = storage.get_project_by_id(project_id)
                if not project or not isinstance(project, dict):
                    return project

                project_content = project.get("project_content")
                normalized_content, changed = _normalize_project_board_assets(
                    project_content,
                    user_id=project.get("user_id"),
                    project_id=project.get("project_id") or project_id,
                )
                if changed and isinstance(normalized_content, dict) and hasattr(storage, "update_project_content"):
                    try:
                        updated_project = storage.update_project_content(
                            project_id,
                            {"board": normalized_content.get("board")},
                            project.get("user_id"),
                        )
                        if updated_project:
                            return updated_project
                    except Exception as exc:
                        logger.warning(f"规范化项目画板失败: {project_id}, {str(exc)}")
                    project = dict(project)
                    project["project_content"] = normalized_content
                return project
        except Exception as exc:
            logger.error(f"获取项目失败: {str(exc)}")
        return None

    def get_project_access_summary(self, project_id: str, db = None) -> Optional[Dict[str, Any]]:
        """按ID获取轻量项目摘要，仅包含权限判断和任务列表所需字段"""
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "get_project_access_summary"):
                return storage.get_project_access_summary(project_id)

            project = storage.get_project_by_id(project_id) if hasattr(storage, "get_project_by_id") else None
            if not project:
                return None

            content = project.get("project_content") or {}
            task_ids = content.get("task_ids") if isinstance(content, dict) else []
            if not isinstance(task_ids, list):
                task_ids = []

            return {
                "project_id": project.get("project_id"),
                "user_id": project.get("user_id"),
                "task_ids": [task_id for task_id in task_ids if isinstance(task_id, str)],
                "created_at": project.get("created_at"),
                "updated_at": project.get("updated_at"),
            }
        except Exception as exc:
            logger.error(f"获取项目摘要失败: {str(exc)}")
        return None

    def add_task_to_project(
        self,
        project_id: str,
        tenant_task_id: str,
        user_id: str,
        project_content: Optional[Dict[str, Any]] = None,
        db = None,
    ) -> Optional[Dict[str, Any]]:
        """手动将任务添加到项目"""
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "add_task_to_project"):
                normalized_content = project_content
                if isinstance(project_content, dict):
                    normalized_content, _ = _normalize_project_board_assets(
                        project_content,
                        user_id=user_id,
                        project_id=project_id,
                    )
                return storage.add_task_to_project(
                    project_id, tenant_task_id, user_id, normalized_content
                )
        except Exception as exc:
            logger.error(f"项目添加任务失败: {str(exc)}")
        return None

    def remove_task_from_project(
        self,
        project_id: str,
        tenant_task_id: str,
        user_id: Optional[str] = None,
        db = None,
    ) -> bool:
        """将任务从项目中移除"""
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "remove_task_from_project"):
                return storage.remove_task_from_project(project_id, tenant_task_id, user_id)
        except Exception as exc:
            logger.error(f"项目移除任务失败: {str(exc)}")
        return False

    def update_project_content(
        self,
        project_id: str,
        updates: Dict[str, Any],
        user_id: Optional[str] = None,
        db = None,
    ) -> Optional[Dict[str, Any]]:
        """更新项目内容"""
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "update_project_content"):
                normalized_updates = updates
                if isinstance(updates, dict):
                    normalized_updates, _ = _normalize_project_board_assets(
                        updates,
                        user_id=user_id,
                        project_id=project_id,
                    )
                return storage.update_project_content(project_id, normalized_updates, user_id)
        except Exception as exc:
            logger.error(f"更新项目内容失败: {str(exc)}")
        return None

    def delete_project(
        self,
        project_id: str,
        user_id: Optional[str] = None,
        confirm_name: Optional[str] = None,
        db = None,
    ) -> bool:
        """删除项目，但不会删除关联任务记录"""
        try:
            if db is None:
                db = next(get_db())
            storage = self._get_project_storage(db)
            if hasattr(storage, "delete_project"):
                return storage.delete_project(project_id, user_id, confirm_name)
        except ValueError as exc:
            logger.error(f"删除项目失败（参数）: {str(exc)}")
            raise
        except Exception as exc:
            logger.error(f"删除项目失败: {str(exc)}")
        return False

# 全局实例
task_record_service = TaskRecordService()
