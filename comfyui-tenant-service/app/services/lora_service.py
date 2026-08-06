from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..models.database import TenantLoraRecord
from ..services.logger import get_main_logger


class LoraService:
    def __init__(self) -> None:
        self.logger = get_main_logger()

    def _deserialize_field(self, value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (dict, list)):
            return value
        if isinstance(value, str):
            try:
                return json.loads(value)
            except (TypeError, ValueError):
                return value
        return value

    def _serialize_list(self, value: Optional[List[str]]) -> str:
        return json.dumps(list(dict.fromkeys(value or [])))

    def _parse_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            return value
        if isinstance(value, str):
            try:
                cleaned = value.replace("Z", "+00:00")
                parsed = datetime.fromisoformat(cleaned)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                else:
                    parsed = parsed.astimezone(timezone.utc)
                return parsed
            except ValueError:
                pass
        return datetime.now(timezone.utc)

    def _compute_training_status(self, record: Dict[str, Any]) -> int:
        created_at_raw = record.get("created_at")
        created_at = self._parse_datetime(created_at_raw) if created_at_raw else datetime.now(timezone.utc)
        elapsed = (datetime.now(timezone.utc) - created_at).total_seconds()

        lora_id = record.get("lora_id") or ""
        digest = hashlib.sha256(lora_id.encode("utf-8")).hexdigest()
        seed = int(digest[:8], 16) if digest else 0

        offset1 = seed % 10
        offset2 = (seed // 10) % 10
        offset3 = (seed // 100) % 30

        file_entries = record.get("file_entries") or []
        image_count = len(file_entries) if isinstance(file_entries, list) else 1
        image_count = max(image_count, 1)

        stage1 = 60 + offset1
        stage2 = int((image_count / 2) * 60) + offset2
        stage3 = 30 + offset3

        if elapsed < stage1:
            return 1
        if elapsed < stage1 + stage2:
            return 2
        if elapsed < stage1 + stage2 + stage3:
            return 3
        return 4

    def _record_to_dict(self, record: Any) -> Dict[str, Any]:
        if isinstance(record, dict):
            normalized = dict(record)
            normalized.setdefault("access_user_ids", [])
            normalized.setdefault("file_entries", [])
            normalized.setdefault("training_status", 1)
            normalized.setdefault("preview_entry", None)
            normalized["training_status"] = self._compute_training_status(normalized)
            return normalized

        data = {
            "lora_id": getattr(record, "lora_id", None),
            "owner_user_id": getattr(record, "owner_user_id", None),
            "name": getattr(record, "name", None),
            "description": getattr(record, "description", None),
            "access_user_ids": self._deserialize_field(getattr(record, "access_user_ids", None)) or [],
            "file_entries": self._deserialize_field(getattr(record, "file_entries", None)) or [],
            "directory": getattr(record, "directory", None),
            "training_status": getattr(record, "training_status", 1),
            "preview_entry": self._deserialize_field(getattr(record, "preview_entry", None)),
            "created_at": getattr(record, "created_at", None).isoformat() if getattr(record, "created_at", None) else None,
            "updated_at": getattr(record, "updated_at", None).isoformat() if getattr(record, "updated_at", None) else None,
        }
        data["training_status"] = self._compute_training_status(data)
        return data

    def list_records(self, db: Session | Any, user_id: str) -> List[Dict[str, Any]]:
        try:
            if hasattr(db, "query"):
                query = (
                    db.query(TenantLoraRecord)
                    .filter(
                        or_(
                            TenantLoraRecord.owner_user_id == user_id,
                            TenantLoraRecord.access_user_ids.like(f'%"{user_id}"%'),
                        )
                    )
                    .order_by(TenantLoraRecord.created_at.desc())
                )
                return [self._record_to_dict(record) for record in query.all()]
            records = db.list_lora_records(user_id)
            return [self._record_to_dict(record) for record in records]
        except Exception as exc:
            self.logger.error("Failed to list lora records: %s", exc)
            return []

    def create_record(
        self,
        db: Session | Any,
        owner_user_id: str,
        name: str,
        file_entries: List[Dict[str, Any]],
        directory: str,
        access_user_ids: Optional[List[str]] = None,
        description: Optional[str] = None,
    ) -> Dict[str, Any]:
        safe_access = list(dict.fromkeys(access_user_ids or []))
        try:
            if hasattr(db, "add"):
                lora_id = f"lora_{uuid.uuid4().hex[:12]}"
                record = TenantLoraRecord(
                    lora_id=lora_id,
                    owner_user_id=owner_user_id,
                    name=name,
                    description=description,
                    access_user_ids=self._serialize_list(safe_access),
                    file_entries=json.dumps(file_entries, ensure_ascii=False),
                    directory=directory,
                    training_status=1,
                    preview_entry=None,
                )
                db.add(record)
                db.commit()
                db.refresh(record)
                return self._record_to_dict(record)
            return self._record_to_dict(
                db.create_lora_record(
                    owner_user_id=owner_user_id,
                    name=name,
                    file_entries=file_entries,
                    directory=directory,
                    access_user_ids=safe_access,
                    description=description,
                    preview_entry=None,
                )
            )
        except Exception as exc:
            if hasattr(db, "rollback"):
                db.rollback()
            self.logger.error("Failed to create lora record: %s", exc)
            raise

    def update_record(
        self,
        db: Session | Any,
        lora_id: str,
        owner_user_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        access_user_ids: Optional[List[str]] = None,
        preview_entry: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        updates: Dict[str, Any] = {}
        if name is not None:
            updates["name"] = name
        if description is not None:
            updates["description"] = description
        if access_user_ids is not None:
            safe_access = list(dict.fromkeys(access_user_ids))
            if hasattr(db, "query"):
                updates["access_user_ids"] = self._serialize_list(safe_access)
            else:
                updates["access_user_ids"] = safe_access
        if preview_entry is not None:
            if hasattr(db, "query"):
                updates["preview_entry"] = json.dumps(preview_entry, ensure_ascii=False)
            else:
                updates["preview_entry"] = preview_entry

        if not updates:
            return self.get_record(db, lora_id)

        try:
            if hasattr(db, "query"):
                record = (
                    db.query(TenantLoraRecord)
                    .filter(
                        TenantLoraRecord.lora_id == lora_id,
                        TenantLoraRecord.owner_user_id == owner_user_id,
                    )
                    .first()
                )
                if not record:
                    return None
                for key, value in updates.items():
                    setattr(record, key, value)
                record.updated_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(record)
                return self._record_to_dict(record)
            updated = db.update_lora_record(lora_id, owner_user_id, updates)
            return self._record_to_dict(updated) if updated else None
        except Exception as exc:
            if hasattr(db, "rollback"):
                db.rollback()
            self.logger.error("Failed to update lora record: %s", exc)
            raise

    def delete_record(self, db: Session | Any, lora_id: str, owner_user_id: str) -> bool:
        try:
            if hasattr(db, "query"):
                record = (
                    db.query(TenantLoraRecord)
                    .filter(
                        TenantLoraRecord.lora_id == lora_id,
                        TenantLoraRecord.owner_user_id == owner_user_id,
                    )
                    .first()
                )
                if not record:
                    return False
                db.delete(record)
                db.commit()
                return True
            return db.delete_lora_record(lora_id, owner_user_id)
        except Exception as exc:
            if hasattr(db, "rollback"):
                db.rollback()
            self.logger.error("Failed to delete lora record: %s", exc)
            return False

    def get_record(self, db: Session | Any, lora_id: str) -> Optional[Dict[str, Any]]:
        try:
            if hasattr(db, "query"):
                record = (
                    db.query(TenantLoraRecord)
                    .filter(TenantLoraRecord.lora_id == lora_id)
                    .first()
                )
                return self._record_to_dict(record) if record else None
            record = db.get_lora_record(lora_id)
            return self._record_to_dict(record) if record else None
        except Exception as exc:
            self.logger.error("Failed to fetch lora record: %s", exc)
            return None

    def set_preview_entry(
        self,
        db: Session | Any,
        lora_id: str,
        owner_user_id: str,
        preview_entry: Optional[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        try:
            if hasattr(db, "query"):
                record = (
                    db.query(TenantLoraRecord)
                    .filter(
                        TenantLoraRecord.lora_id == lora_id,
                        TenantLoraRecord.owner_user_id == owner_user_id,
                    )
                    .first()
                )
                if not record:
                    return None
                record.preview_entry = json.dumps(preview_entry, ensure_ascii=False) if preview_entry else None
                record.updated_at = datetime.now(timezone.utc)
                db.commit()
                db.refresh(record)
                return self._record_to_dict(record)
            updates = {"preview_entry": preview_entry}
            updated = db.update_lora_record(lora_id, owner_user_id, updates)
            return self._record_to_dict(updated) if updated else None
        except Exception as exc:
            if hasattr(db, "rollback"):
                db.rollback()
            self.logger.error("Failed to set preview entry: %s", exc)
            raise

    @staticmethod
    def build_directory_path(base_output: Path, user_id: str, subdir: str) -> str:
        return str((base_output / user_id / subdir).resolve())


lora_service = LoraService()
