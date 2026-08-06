import json
import re
from secrets import token_hex
from pathlib import Path
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from pydantic import BaseModel, Field
from sqlalchemy import Boolean, DateTime, Float, Integer, JSON, MetaData, Numeric, String, Table, Text, func, inspect, or_, select
from sqlalchemy.orm import Session

from ..routers.auth import get_current_user, _get_username, _invalidate_auth_cache, _serialize_user, _user_value
from ..services.auth import get_password_hash
from ..services.config import get_settings
from ..services.credit_code_service import credit_code_service
from ..services.ws_manager import credit_ws_manager
from ..services.billing_service import (
    delete_model_rate,
    is_billing_enabled,
    list_model_rates,
    list_usage_models,
    set_billing_enabled,
    upsert_model_rate,
)
from ..services.json_storage import JSONStorage
from ..models.database import BoardBroadcastRecord, get_db, Tenant, User, engine as db_engine

router = APIRouter()
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
ADMIN_RESET_PASSWORD = "00000000"


class CreditCodeCreate(BaseModel):
    credit: int


class ApplyCreditCodePayload(BaseModel):
    code: str


class TenantCreatePayload(BaseModel):
    name: str
    api_key: str | None = None
    is_active: bool = True
    settings: dict | str | None = None


class TenantUpdatePayload(BaseModel):
    name: str | None = None
    api_key: str | None = None
    is_active: bool | None = None
    settings: dict | str | None = None


class UserCreatePayload(BaseModel):
    username: str
    password: str
    tenant_id: int
    email: str | None = None
    group: int | None = None
    credit: int | None = None
    is_active: bool = True
    role: str | None = None
    manager_username: str | None = None
    max_active_employees: int | None = None


class UserUpdatePayload(BaseModel):
    username: str | None = None
    password: str | None = None
    tenant_id: int | None = None
    email: str | None = None
    group: int | None = None
    credit: int | None = None
    is_active: bool | None = None
    role: str | None = None
    manager_username: str | None = None
    max_active_employees: int | None = None


class BillingRatePayload(BaseModel):
    model: str
    credit: int


class BillingSettingsPayload(BaseModel):
    enabled: bool


class ImageProviderSettingsPayload(BaseModel):
    use_vod: bool


class ManagerCreatePayload(BaseModel):
    username: str
    password: str
    email: str | None = None
    tenant_id: int | None = None
    credit: int | None = None
    max_active_employees: int = 5
    is_active: bool = True


class BoardBroadcastCreatePayload(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    content_markdown: str | None = None
    starts_at: str
    ends_at: str
    is_enabled: bool = True
    display_order: int = 0


class BoardBroadcastUpdatePayload(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content_markdown: str | None = None
    starts_at: str | None = None
    ends_at: str | None = None
    is_enabled: bool | None = None
    display_order: int | None = None


ADMIN_DB_TABLE_SCHEMAS = {
    "tenants": {
        "label": "租户表",
        "primary_key": "id",
        "fields": [
            {"name": "id", "label": "ID", "type": "number", "editable": False},
            {"name": "name", "label": "租户名称", "type": "string", "editable": True, "required": True},
            {"name": "api_key", "label": "API Key", "type": "string", "editable": True},
            {"name": "is_active", "label": "是否启用", "type": "boolean", "editable": True},
            {"name": "settings", "label": "设置(JSON)", "type": "json", "editable": True},
            {"name": "created_at", "label": "创建时间", "type": "datetime", "editable": False},
            {"name": "updated_at", "label": "更新时间", "type": "datetime", "editable": False},
        ],
    },
    "users": {
        "label": "用户表",
        "primary_key": "id",
        "fields": [
            {"name": "id", "label": "ID", "type": "number", "editable": False},
            {"name": "username", "label": "用户名", "type": "string", "editable": True, "required": True},
            {"name": "password", "label": "密码", "type": "password", "editable": True, "required": True},
            {"name": "email", "label": "邮箱", "type": "string", "editable": True},
            {"name": "tenant_id", "label": "租户ID", "type": "number", "editable": True, "required": True},
            {"name": "group", "label": "用户组", "type": "number", "editable": True},
            {"name": "credit", "label": "Credit", "type": "number", "editable": True},
            {"name": "is_active", "label": "是否启用", "type": "boolean", "editable": True},
            {"name": "created_at", "label": "创建时间", "type": "datetime", "editable": False},
            {"name": "last_login", "label": "最后登录", "type": "datetime", "editable": False},
        ],
    },
}


def ensure_admin(current_user):
    group = None
    if isinstance(current_user, dict):
        group = current_user.get("group")
    else:
        group = getattr(current_user, "group", None)
    if group != 1000:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


def _is_valid_email(value: str) -> bool:
    return bool(EMAIL_PATTERN.match((value or "").strip()))


def _get_current_tenant_id(current_user) -> int | None:
    if isinstance(current_user, dict):
        return current_user.get("tenant_id")
    return getattr(current_user, "tenant_id", None)


def _serialize_db_user(user: User, settings):
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "tenant_id": user.tenant_id,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login": user.last_login.isoformat() if user.last_login else None,
        "credit": user.credit or 0,
        "group": user.group or settings.user_default_group,
        "role": user.role or "user",
        "manager_username": user.manager_username,
        "max_active_employees": user.max_active_employees or 5,
    }


def _serialize_db_tenant(tenant: Tenant):
    parsed_settings = None
    if tenant.settings:
        try:
            parsed_settings = json.loads(tenant.settings)
        except (TypeError, json.JSONDecodeError):
            parsed_settings = tenant.settings
    return {
        "id": tenant.id,
        "name": tenant.name,
        "api_key": tenant.api_key,
        "is_active": tenant.is_active,
        "settings": parsed_settings,
        "created_at": tenant.created_at.isoformat() if tenant.created_at else None,
        "updated_at": tenant.updated_at.isoformat() if tenant.updated_at else None,
    }


def _normalize_settings_payload(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, str):
        trimmed = value.strip()
        if not trimmed:
            return None
        try:
            json.loads(trimmed)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"settings must be valid JSON: {exc}")  # type: ignore[arg-type]
        return trimmed
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="settings must be JSON string or object")


ADMIN_DB_TABLE_CONFIG = {
    "tenants": {
        "schema": ADMIN_DB_TABLE_SCHEMAS["tenants"],
        "model": Tenant,
        "search_fields": [Tenant.name, Tenant.api_key],
        "order_by": Tenant.created_at.desc(),
    },
    "users": {
        "schema": ADMIN_DB_TABLE_SCHEMAS["users"],
        "model": User,
        "search_fields": [User.username, User.email],
        "order_by": User.created_at.desc(),
    },
}

def _infer_field_type(column_type) -> str:
    if isinstance(column_type, (Integer,)):
        return "number"
    if isinstance(column_type, (Float, Numeric)):
        return "number"
    if isinstance(column_type, (Boolean,)):
        return "boolean"
    if isinstance(column_type, (DateTime,)):
        return "datetime"
    if isinstance(column_type, (JSON,)):
        return "json"
    if isinstance(column_type, (Text,)):
        return "string"
    if isinstance(column_type, (String,)):
        return "string"
    return "string"


def _build_schema_from_table(table_name: str, inspector) -> dict:
    columns = inspector.get_columns(table_name)
    pk = inspector.get_pk_constraint(table_name) or {}
    pk_columns = pk.get("constrained_columns") or []
    primary_key = pk_columns[0] if pk_columns else (columns[0]["name"] if columns else "id")
    fields = []
    for col in columns:
        col_type = col.get("type")
        fields.append(
            {
                "name": col["name"],
                "label": col["name"],
                "type": _infer_field_type(col_type),
                "editable": False,
            }
        )
    return {
        "name": table_name,
        "label": table_name,
        "primary_key": primary_key,
        "fields": fields,
        "read_only": True,
    }


def _serialize_generic_record(record) -> dict:
    payload = {}
    for key, value in record.items():
        if hasattr(value, "isoformat"):
            payload[key] = value.isoformat()
        else:
            payload[key] = value
    return payload


def _serialize_table_record(table_name: str, record, settings):
    if table_name == "users":
        return _serialize_db_user(record, settings)
    if table_name == "tenants":
        return _serialize_db_tenant(record)
    return {}


def _serialize_billing_rate(rate) -> dict:
    if isinstance(rate, dict):
        return rate
    return {
        "id": rate.id,
        "model": rate.model,
        "credit": rate.credit,
        "created_at": rate.created_at.isoformat() if rate.created_at else None,
        "updated_at": rate.updated_at.isoformat() if rate.updated_at else None,
    }


def _parse_broadcast_datetime(raw_value: str | None, field_name: str) -> datetime:
    if not raw_value or not str(raw_value).strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} is required")
    try:
        parsed = datetime.fromisoformat(str(raw_value).strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{field_name} must be valid ISO datetime") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _validate_broadcast_window(
    *,
    starts_at: datetime,
    ends_at: datetime,
    original_starts_at: datetime | None = None,
) -> None:
    now = _utc_now()
    starts_at = _as_utc(starts_at) or starts_at
    ends_at = _as_utc(ends_at) or ends_at
    original_starts_at = _as_utc(original_starts_at)
    if ends_at <= starts_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="ends_at must be later than starts_at")
    if starts_at < now:
        if original_starts_at is None or abs((original_starts_at - starts_at).total_seconds()) > 1:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="starts_at cannot be earlier than current time")


def _serialize_board_broadcast(record: BoardBroadcastRecord) -> dict:
    starts_at = _as_utc(record.starts_at)
    ends_at = _as_utc(record.ends_at)
    created_at = _as_utc(record.created_at)
    updated_at = _as_utc(record.updated_at)
    return {
        "id": record.id,
        "title": record.title,
        "content_markdown": record.content_markdown or "",
        "is_enabled": bool(record.is_enabled),
        "starts_at": starts_at.isoformat() if starts_at else None,
        "ends_at": ends_at.isoformat() if ends_at else None,
        "display_order": record.display_order or 0,
        "created_by": record.created_by,
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
    }


def _normalize_public_asset_path(value: str | None) -> str | None:
    if not value:
        return None
    raw = str(value)
    if raw.startswith(("http://", "https://", "/api/proxy/static/images/")):
        return raw
    relative = re.sub(r"^output[\\\/]", "", raw).replace("\\", "/").lstrip("/")
    if not relative:
        return None
    return f"/api/proxy/static/images/{relative}"


def _get_env_file_path() -> Path:
    env_path = Path(__file__).resolve().parents[2] / ".env"
    if env_path.exists():
        return env_path
    return env_path


def _set_env_value(key: str, value: str) -> None:
    env_path = _get_env_file_path()
    lines: list[str] = []
    if env_path.exists():
        lines = env_path.read_text(encoding="utf-8").splitlines()

    updated = False
    next_lines: list[str] = []
    for line in lines:
        if line.startswith(f"{key}="):
            next_lines.append(f"{key}={value}")
            updated = True
        else:
            next_lines.append(line)
    if not updated:
        next_lines.append(f"{key}={value}")

    env_path.write_text("\n".join(next_lines) + "\n", encoding="utf-8")

@router.get("/credit-codes")
async def list_credit_codes(current_user=Depends(get_current_user)):
    ensure_admin(current_user)
    return {"codes": credit_code_service.list_codes()}


@router.post("/credit-codes")
async def create_credit_code(payload: CreditCodeCreate, current_user=Depends(get_current_user)):
    ensure_admin(current_user)
    if payload.credit < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Credit must be non-negative")
    record = credit_code_service.create_code(payload.credit)
    return record


@router.delete("/credit-codes/{code}")
async def delete_credit_code(code: str, current_user=Depends(get_current_user)):
    ensure_admin(current_user)
    removed = credit_code_service.delete_code(code)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Code not found")
    return {"detail": "deleted"}


@router.get("/billing-rates")
async def list_billing_rates(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_admin(current_user)
    rates = list_model_rates(db)
    return {"items": [_serialize_billing_rate(rate) for rate in rates]}


@router.get("/billing-settings")
async def get_billing_settings(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_admin(current_user)
    tenant_id = _get_current_tenant_id(current_user)
    if tenant_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant not found")
    return {"enabled": is_billing_enabled(db, tenant_id)}


@router.post("/billing-settings")
async def update_billing_settings(
    payload: BillingSettingsPayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    tenant_id = _get_current_tenant_id(current_user)
    if tenant_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant not found")
    try:
        settings_payload = set_billing_enabled(db, tenant_id, payload.enabled)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    billing_settings = settings_payload.get("billing") if isinstance(settings_payload, dict) else {}
    return {"enabled": bool(billing_settings.get("enabled", payload.enabled))}


@router.get("/image-provider-settings")
async def get_image_provider_settings(current_user=Depends(get_current_user)):
    ensure_admin(current_user)
    settings = get_settings()
    provider = (settings.image_provider or "poloapi").strip().lower()
    return {
        "image_provider": provider,
        "use_vod": provider == "vod",
    }


@router.post("/image-provider-settings")
async def update_image_provider_settings(
    payload: ImageProviderSettingsPayload,
    current_user=Depends(get_current_user),
):
    ensure_admin(current_user)
    provider = "vod" if payload.use_vod else "poloapi"
    _set_env_value("IMAGE_PROVIDER", provider)
    return {
        "image_provider": provider,
        "use_vod": payload.use_vod,
        "detail": "IMAGE_PROVIDER updated in .env. Restart the tenant service to apply the change.",
    }


@router.get("/broadcasts")
async def list_board_broadcasts(
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)
    items = (
        db.query(BoardBroadcastRecord)
        .order_by(
            BoardBroadcastRecord.display_order.desc(),
            BoardBroadcastRecord.starts_at.desc(),
            BoardBroadcastRecord.id.desc(),
        )
        .all()
    )
    return {"items": [_serialize_board_broadcast(item) for item in items]}


@router.post("/broadcasts")
async def create_board_broadcast(
    payload: BoardBroadcastCreatePayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)

    starts_at = _parse_broadcast_datetime(payload.starts_at, "starts_at")
    ends_at = _parse_broadcast_datetime(payload.ends_at, "ends_at")
    _validate_broadcast_window(starts_at=starts_at, ends_at=ends_at)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title is required")

    creator = current_user.get("username") if isinstance(current_user, dict) else getattr(current_user, "username", None)
    record = BoardBroadcastRecord(
        title=title,
        content_markdown=(payload.content_markdown or "").strip(),
        is_enabled=payload.is_enabled,
        starts_at=starts_at,
        ends_at=ends_at,
        display_order=payload.display_order or 0,
        created_by=creator,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return {"item": _serialize_board_broadcast(record)}


@router.patch("/broadcasts/{broadcast_id}")
async def update_board_broadcast(
    broadcast_id: int,
    payload: BoardBroadcastUpdatePayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)

    record = db.query(BoardBroadcastRecord).filter(BoardBroadcastRecord.id == broadcast_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broadcast not found")

    starts_at = record.starts_at
    ends_at = record.ends_at
    if payload.starts_at is not None:
        starts_at = _parse_broadcast_datetime(payload.starts_at, "starts_at")
    if payload.ends_at is not None:
        ends_at = _parse_broadcast_datetime(payload.ends_at, "ends_at")
    _validate_broadcast_window(starts_at=starts_at, ends_at=ends_at, original_starts_at=record.starts_at)

    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="title is required")
        record.title = title
    if payload.content_markdown is not None:
        record.content_markdown = payload.content_markdown.strip()
    if payload.is_enabled is not None:
        record.is_enabled = payload.is_enabled
    if payload.display_order is not None:
        record.display_order = payload.display_order
    record.starts_at = starts_at
    record.ends_at = ends_at

    db.add(record)
    db.commit()
    db.refresh(record)
    return {"item": _serialize_board_broadcast(record)}


@router.delete("/broadcasts/{broadcast_id}")
async def delete_board_broadcast(
    broadcast_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)

    record = db.query(BoardBroadcastRecord).filter(BoardBroadcastRecord.id == broadcast_id).first()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Broadcast not found")
    db.delete(record)
    db.commit()
    return {"detail": "deleted"}


@router.post("/broadcasts/upload")
async def upload_board_broadcast_image(
    file: UploadFile = File(...),
    current_user=Depends(get_current_user),
):
    ensure_admin(current_user)
    from ..services.image_storage import image_storage_service

    try:
        payload = await file.read()
    finally:
        await file.close()

    if not payload:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

    username = current_user.get("username") if isinstance(current_user, dict) else getattr(current_user, "username", None)
    if not username:
        username = "admin"

    try:
        entry = image_storage_service.store_uploaded_image(
            user_id=str(username),
            file_bytes=payload,
            original_filename=file.filename,
            content_type=file.content_type,
            subdir="broadcasts",
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store broadcast image") from exc

    original_url = _normalize_public_asset_path(
        entry.get("original") or entry.get("localPath") or entry.get("path")
    )
    thumbnail_url = _normalize_public_asset_path(
        entry.get("thumbnail") or entry.get("thumbnailPath")
    )
    return {
        "url": original_url,
        "thumbnail_url": thumbnail_url,
        "storage": entry,
    }


@router.get("/billing-rates/suggestions")
async def list_billing_rate_suggestions(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    ensure_admin(current_user)
    settings = get_settings()
    suggested = set(list_usage_models(db))
    for model in (
        settings.llm_default_model,
        settings.gemini_default_model,
        settings.poloapi_default_model,
        settings.poloapi_baokuan_model,
    ):
        if model:
            suggested.add(model)
    return {"models": sorted(suggested)}


@router.post("/billing-rates")
async def upsert_billing_rate(
    payload: BillingRatePayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    model = (payload.model or "").strip()
    if not model:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Model is required")
    if payload.credit < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Credit must be non-negative")
    record = upsert_model_rate(db, model, payload.credit)
    return {"item": _serialize_billing_rate(record)}


@router.delete("/billing-rates/{model}")
async def delete_billing_rate(
    model: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    model_name = model.strip()
    if not model_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Model is required")
    removed = delete_model_rate(db, model_name)
    if not removed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Model not found")
    return {"detail": "deleted"}


@router.get("/users")
async def list_users(
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    page = max(page, 1)
    page_size = max(1, min(page_size, 50))

    if settings.is_database_storage():
        query = db.query(User)
        if search:
            keyword = f"%{search.strip()}%"
            query = query.filter(
                or_(User.username.ilike(keyword), User.email.ilike(keyword))
            )
        total = query.count()
        items = (
            query.order_by(User.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
            .all()
        )
        return {
            "total": total,
            "items": [_serialize_db_user(item, settings) for item in items],
        }

    storage = JSONStorage()
    return storage.list_users(search=search, page=page, page_size=page_size)


@router.post("/managers")
async def create_manager_account(
    payload: ManagerCreatePayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()

    tenant_id = payload.tenant_id or _get_current_tenant_id(current_user)
    if tenant_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant not found")

    username = (payload.username or "").strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username is required")
    if not _is_valid_email(username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manager username must be an email")
    if len(payload.password or "") < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters")

    email_value = username
    max_active = max(1, int(payload.max_active_employees or 5))
    credit_value = payload.credit if payload.credit is not None else settings.user_default_credit

    if settings.is_database_storage():
        if db.query(User).filter(User.username == username).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
        if email_value and db.query(User).filter(User.email == email_value).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant not found")

        manager = User(
            username=username,
            email=email_value,
            hashed_password=get_password_hash(payload.password),
            tenant_id=tenant_id,
            group=settings.user_default_group,
            credit=credit_value,
            is_active=payload.is_active,
            role="manager",
            manager_username=None,
            max_active_employees=max_active,
        )
        db.add(manager)
        db.commit()
        db.refresh(manager)
        return {"record": _serialize_db_user(manager, settings)}

    storage = JSONStorage()
    if storage.get_user_by_username(username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
    if email_value and storage.get_user_by_email(email_value):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")

    manager = storage.create_user(
        username=username,
        password_hash=get_password_hash(payload.password),
        tenant_id=tenant_id,
        email=email_value,
        role="manager",
        manager_username=None,
        max_active_employees=max_active,
        is_active=payload.is_active,
    )
    storage.update_user_fields(
        username,
        {
            "group": settings.user_default_group,
            "credit": int(credit_value),
        },
    )
    manager = storage.get_user_by_username(username) or manager
    return {"record": manager}


@router.post("/users/{user_id}/apply-credit-code")
async def apply_credit_code_to_user(
    user_id: int,
    payload: ApplyCreditCodePayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()

    try:
        redeemed = credit_code_service.redeem_code(payload.code, used_by=str(user_id))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    credit_delta = int(redeemed.get("credit", 0))
    if credit_delta < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Credit must be non-negative")

    if settings.is_database_storage():
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        user.credit = (user.credit or 0) + credit_delta
        db.add(user)
        db.commit()
        db.refresh(user)
        serialized = _serialize_db_user(user, settings)
        try:
            awaitable = credit_ws_manager.send_credit_update(user_id, int(user.credit or 0))
            if hasattr(awaitable, "__await__"):
                import asyncio

                asyncio.create_task(awaitable)
        except Exception:
            pass
        return {"user": serialized, "code": redeemed}

    storage = JSONStorage()
    try:
        updated_user = storage.add_credit_to_user(user_id, credit_delta)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    try:
        awaitable = credit_ws_manager.send_credit_update(user_id, int(updated_user.get("credit") or 0))
        if hasattr(awaitable, "__await__"):
            import asyncio

            asyncio.create_task(awaitable)
    except Exception:
        pass
    return {"user": updated_user, "code": redeemed}


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()

    if settings.is_database_storage():
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        user.hashed_password = get_password_hash(ADMIN_RESET_PASSWORD)
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        user = db.get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        username = str(user.get("username") or "").strip()
        if not username:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User username is missing")
        updated = db.update_user_password(username, get_password_hash(ADMIN_RESET_PASSWORD))
        if not updated:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update password")
        user = db.get_user_by_id(user_id) or user

    _invalidate_auth_cache(_get_username(user), _user_value(user, "tenant_id", 1), settings)
    return {"user": _serialize_user(user, settings), "password": ADMIN_RESET_PASSWORD}


@router.get("/db/tables")
async def list_admin_tables(current_user=Depends(get_current_user)):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)
    tables = []
    for name, config in ADMIN_DB_TABLE_CONFIG.items():
        schema = config["schema"]
        tables.append(
            {
                "name": name,
                "label": schema["label"],
                "primary_key": schema["primary_key"],
                "fields": schema["fields"],
            }
        )
    inspector = inspect(db_engine)
    for table_name in inspector.get_table_names():
        if table_name in ADMIN_DB_TABLE_CONFIG:
            continue
        schema = _build_schema_from_table(table_name, inspector)
        tables.append(schema)
    return {"storage_type": settings.storage_type, "tables": tables}


def _require_database_storage(settings):
    if not settings.is_database_storage():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin DB 工具需要 STORAGE_TYPE=sqlite/mysql/postgresql",
        )


@router.get("/db/{table_name}")
async def list_admin_table_records(
    table_name: str,
    search: str | None = None,
    page: int = 1,
    page_size: int = 20,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)

    table_cfg = ADMIN_DB_TABLE_CONFIG.get(table_name)
    if not table_cfg:
        inspector = inspect(db.get_bind())
        if table_name not in inspector.get_table_names():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Table not found")
        metadata = MetaData()
        table = Table(table_name, metadata, autoload_with=db.get_bind())
        page = max(1, page)
        page_size = max(1, min(page_size, 100))
        query = select(table)
        count_query = select(func.count()).select_from(table)
        if search:
            keyword = f"%{search.strip()}%"
            filters = []
            for column in table.c:
                column_type = column.type
                if isinstance(column_type, (String, Text)):
                    filters.append(column.ilike(keyword))
            if filters:
                query = query.where(or_(*filters))
                count_query = count_query.where(or_(*filters))
        pk = inspector.get_pk_constraint(table_name) or {}
        pk_columns = pk.get("constrained_columns") or []
        if pk_columns:
            query = query.order_by(table.c[pk_columns[0]].desc())
        total = db.execute(count_query).scalar() or 0
        rows = (
            db.execute(
                query.offset((page - 1) * page_size).limit(page_size)
            )
            .mappings()
            .all()
        )
        serialized = [_serialize_generic_record(dict(row)) for row in rows]
        return {"total": total, "items": serialized}

    page = max(1, page)
    page_size = max(1, min(page_size, 100))

    query = db.query(table_cfg["model"])
    if search:
        keyword = f"%{search.strip()}%"
        filters = []
        for field in table_cfg.get("search_fields", []):
            filters.append(field.ilike(keyword))
        if filters:
            query = query.filter(or_(*filters))
    total = query.count()
    order_by = table_cfg.get("order_by")
    if order_by is not None:
        query = query.order_by(order_by)
    items = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    serialized = [_serialize_table_record(table_name, item, settings) for item in items]
    return {"total": total, "items": serialized}


@router.post("/db/{table_name}")
async def create_admin_table_record(
    table_name: str,
    payload: dict,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)
    table_cfg = ADMIN_DB_TABLE_CONFIG.get(table_name)
    if not table_cfg:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is read-only")

    if table_name == "tenants":
        data = TenantCreatePayload(**payload)
        existing = db.query(Tenant).filter(Tenant.name == data.name).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant name already exists")
        api_key = data.api_key or f"tsk_{token_hex(16)}"
        if db.query(Tenant).filter(Tenant.api_key == api_key).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="API key already exists")
        tenant = Tenant(
            name=data.name,
            api_key=api_key,
            is_active=data.is_active,
            settings=_normalize_settings_payload(data.settings),
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        return {"record": _serialize_db_tenant(tenant)}

    if table_name == "users":
        data = UserCreatePayload(**payload)
        existing = db.query(User).filter(User.username == data.username).first()
        if existing:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
        email_value = data.email.strip() if data.email else None
        if email_value:
            email_dup = db.query(User).filter(User.email == email_value).first()
            if email_dup:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
        tenant = db.query(Tenant).filter(Tenant.id == data.tenant_id).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant not found")
        user = User(
            username=data.username,
            email=email_value,
            hashed_password=get_password_hash(data.password),
            tenant_id=data.tenant_id,
            group=data.group or settings.user_default_group,
            credit=data.credit if data.credit is not None else settings.user_default_credit,
            is_active=data.is_active,
            role=data.role or "user",
            manager_username=data.manager_username,
            max_active_employees=data.max_active_employees if data.max_active_employees is not None else 5,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"record": _serialize_db_user(user, settings)}

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported table")


@router.put("/db/{table_name}/{record_id}")
async def update_admin_table_record(
    table_name: str,
    record_id: int,
    payload: dict,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)
    table_cfg = ADMIN_DB_TABLE_CONFIG.get(table_name)
    if not table_cfg:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is read-only")

    if table_name == "tenants":
        data = TenantUpdatePayload(**payload)
        tenant = db.query(Tenant).filter(Tenant.id == record_id).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
        if data.name:
            duplicate = (
                db.query(Tenant)
                .filter(Tenant.name == data.name, Tenant.id != tenant.id)
                .first()
            )
            if duplicate:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant name already exists")
            tenant.name = data.name
        if data.api_key:
            duplicate_key = (
                db.query(Tenant)
                .filter(Tenant.api_key == data.api_key, Tenant.id != tenant.id)
                .first()
            )
            if duplicate_key:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="API key already exists")
            tenant.api_key = data.api_key
        if data.is_active is not None:
            tenant.is_active = data.is_active
        if data.settings is not None:
            tenant.settings = _normalize_settings_payload(data.settings)
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        return {"record": _serialize_db_tenant(tenant)}

    if table_name == "users":
        data = UserUpdatePayload(**payload)
        user = db.query(User).filter(User.id == record_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if data.username:
            duplicate = (
                db.query(User)
                .filter(User.username == data.username, User.id != user.id)
                .first()
            )
            if duplicate:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already exists")
            user.username = data.username
        if data.email is not None:
            email_value = data.email.strip() if data.email else None
            if email_value:
                duplicate_email = (
                    db.query(User)
                    .filter(User.email == email_value, User.id != user.id)
                    .first()
                )
                if duplicate_email:
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists")
            user.email = email_value
        if data.tenant_id is not None:
            tenant = db.query(Tenant).filter(Tenant.id == data.tenant_id).first()
            if not tenant:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant not found")
            user.tenant_id = data.tenant_id
        if data.password:
            user.hashed_password = get_password_hash(data.password)
        if data.group is not None:
            user.group = data.group
        if data.credit is not None:
            user.credit = data.credit
        if data.is_active is not None:
            user.is_active = data.is_active
        if data.role is not None:
            user.role = data.role
        if data.manager_username is not None:
            user.manager_username = data.manager_username or None
        if data.max_active_employees is not None:
            user.max_active_employees = data.max_active_employees
        db.add(user)
        db.commit()
        db.refresh(user)
        return {"record": _serialize_db_user(user, settings)}

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported table")


@router.delete("/db/{table_name}/{record_id}")
async def delete_admin_table_record(
    table_name: str,
    record_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ensure_admin(current_user)
    settings = get_settings()
    _require_database_storage(settings)
    table_cfg = ADMIN_DB_TABLE_CONFIG.get(table_name)
    if not table_cfg:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Table is read-only")

    if table_name == "tenants":
        tenant = db.query(Tenant).filter(Tenant.id == record_id).first()
        if not tenant:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
        tenant_user_count = db.query(User).filter(User.tenant_id == tenant.id).count()
        if tenant_user_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="请先删除或转移该租户下的用户",
            )
        db.delete(tenant)
        db.commit()
        return {"detail": "deleted"}

    if table_name == "users":
        user = db.query(User).filter(User.id == record_id).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        db.delete(user)
        db.commit()
        return {"detail": "deleted"}

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported table")
