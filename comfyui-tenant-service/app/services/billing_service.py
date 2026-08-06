from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Optional, Tuple

from .config import get_settings
from .logger import get_main_logger
from ..models.database import BillingUsage, ModelBillingRate, Tenant, User
from ..services.ws_manager import credit_ws_manager


def _extract_user_info(current_user: Any) -> Tuple[Optional[int], Optional[int]]:
    if isinstance(current_user, dict):
        return current_user.get("id"), current_user.get("tenant_id")
    settings = get_settings()
    if settings.is_database_storage():
        return getattr(current_user, "id", None), getattr(current_user, "tenant_id", None)
    return None, None


def _user_value(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _normalize_role(role: Any) -> str:
    value = str(role or "").strip().lower()
    if value in {"manager", "employee", "user"}:
        return value
    return "user"


def _resolve_billing_user(db, current_user: Any) -> Any:
    settings = get_settings()
    role = _normalize_role(_user_value(current_user, "role", "user"))
    if role != "employee":
        return current_user

    manager_username = _user_value(current_user, "manager_username")
    if not manager_username:
        return current_user

    if settings.is_database_storage():
        manager = db.query(User).filter(User.username == manager_username).first()
        return manager or current_user

    manager = db.get_user_by_username(manager_username)
    return manager or current_user


def _clamp_non_negative(value: int) -> int:
    return max(0, int(value))


def _load_tenant_settings(db, tenant_id: int) -> dict:
    settings = get_settings()
    raw_settings = None
    if settings.is_json_storage():
        tenant = db.get_tenant_by_id(tenant_id)
        raw_settings = tenant.get("settings") if tenant else None
    else:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        raw_settings = tenant.settings if tenant else None
    if isinstance(raw_settings, dict):
        return dict(raw_settings)
    if isinstance(raw_settings, str) and raw_settings.strip():
        try:
            parsed = json.loads(raw_settings)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return {}


def is_billing_enabled(db, tenant_id: int) -> bool:
    settings = _load_tenant_settings(db, tenant_id)
    billing_settings = settings.get("billing")
    if isinstance(billing_settings, dict) and "enabled" in billing_settings:
        return bool(billing_settings.get("enabled"))
    if "billing_enabled" in settings:
        return bool(settings.get("billing_enabled"))
    return True


def set_billing_enabled(db, tenant_id: int, enabled: bool) -> dict:
    settings = get_settings()
    settings_payload = _load_tenant_settings(db, tenant_id)
    billing_settings = settings_payload.get("billing")
    if not isinstance(billing_settings, dict):
        billing_settings = {}
    billing_settings["enabled"] = bool(enabled)
    settings_payload["billing"] = billing_settings
    serialized = json.dumps(settings_payload, ensure_ascii=False)

    if settings.is_json_storage():
        updated = db.update_tenant_settings(tenant_id, serialized)
        if not updated:
            raise ValueError("Tenant not found")
        return settings_payload

    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if tenant is None:
        raise ValueError("Tenant not found")
    tenant.settings = serialized
    db.add(tenant)
    db.commit()
    return settings_payload


def get_model_rate(db, model: str) -> int:
    if not model:
        return 1
    settings = get_settings()
    if settings.is_json_storage():
        rate = db.get_model_billing_rate(model)
        return rate if isinstance(rate, int) else 1
    record = db.query(ModelBillingRate).filter(ModelBillingRate.model == model).first()
    if record is None:
        return 1
    return int(record.credit or 1)


def upsert_model_rate(db, model: str, credit: int):
    credit_value = _clamp_non_negative(credit)
    settings = get_settings()
    if settings.is_json_storage():
        return db.upsert_model_billing_rate(model, credit_value)
    record = db.query(ModelBillingRate).filter(ModelBillingRate.model == model).first()
    if record:
        record.credit = credit_value
    else:
        record = ModelBillingRate(model=model, credit=credit_value)
        db.add(record)
    db.commit()
    db.refresh(record)
    return record


def delete_model_rate(db, model: str) -> bool:
    settings = get_settings()
    if settings.is_json_storage():
        return db.delete_model_billing_rate(model)
    record = db.query(ModelBillingRate).filter(ModelBillingRate.model == model).first()
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def list_model_rates(db):
    settings = get_settings()
    if settings.is_json_storage():
        return db.list_model_billing_rates()
    return (
        db.query(ModelBillingRate)
        .order_by(ModelBillingRate.updated_at.desc())
        .all()
    )


def list_usage_models(db) -> list[str]:
    settings = get_settings()
    if settings.is_json_storage():
        usage = db._load_data("billing_usage")
        models = {item.get("model") for item in usage if isinstance(item, dict)}
        return sorted(model for model in models if model)
    rows = db.query(BillingUsage.model).distinct().all()
    return sorted({row[0] for row in rows if row and row[0]})


def charge_model_usage(
    db,
    current_user: Any,
    endpoint: str,
    model: str,
    status: str = "success",
    tenant_task_id: Optional[str] = None,
) -> Optional[dict]:
    logger = get_main_logger()
    settings = get_settings()
    if settings.pressure_test_mode:
        return None
    current_user_id, _ = _extract_user_info(current_user)
    actor_user_id = current_user_id
    actor_username = _user_value(current_user, "username")
    billing_user = _resolve_billing_user(db, current_user)
    user_id, tenant_id = _extract_user_info(billing_user)
    if user_id is None or tenant_id is None:
        logger.warning("Billing skipped: missing user/tenant info endpoint=%s model=%s", endpoint, model)
        return None

    if not is_billing_enabled(db, tenant_id):
        settings = get_settings()
        balance_before = None
        balance_after = None
        billing_info = {
            "credits": 0,
            "endpoint": endpoint,
            "model": model,
            "status": status,
            "charged_at": datetime.utcnow().isoformat(),
        }
        try:
            if settings.is_json_storage():
                user = db.get_user_by_id(user_id)
                balance_before = int(user.get("credit") or 0) if user else 0
                balance_after = balance_before
                db.log_billing_usage(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    actor_user_id=actor_user_id,
                    actor_username=actor_username,
                    endpoint=endpoint,
                    model=model,
                    credits=0,
                    status=status,
                    tenant_task_id=tenant_task_id,
                    balance_before=balance_before,
                    balance_after=balance_after,
                )
                if tenant_task_id:
                    try:
                        from ..services.task_record_service import task_record_service

                        task_record_service.update_task_billing(tenant_task_id, billing_info, db)
                    except Exception:
                        pass
                return {
                    "credits": 0,
                    "balance_before": balance_before,
                    "balance_after": balance_after,
                }

            user = db.query(User).filter(User.id == user_id).first()
            balance_before = int(user.credit or 0) if user else 0
            balance_after = balance_before
            usage = BillingUsage(
                tenant_id=tenant_id,
                user_id=user_id,
                tenant_task_id=tenant_task_id,
                actor_user_id=actor_user_id,
                actor_username=actor_username,
                endpoint=endpoint,
                model=model,
                credits=0,
                status=status,
                balance_before=balance_before,
                balance_after=balance_after,
            )
            db.add(usage)
            db.commit()
            if tenant_task_id:
                try:
                    from ..services.task_record_service import task_record_service

                    task_record_service.update_task_billing(tenant_task_id, billing_info, db)
                except Exception:
                    pass
            return {
                "credits": 0,
                "balance_before": balance_before,
                "balance_after": balance_after,
            }
        except Exception as exc:
            logger.warning("Billing disabled log failed endpoint=%s model=%s err=%s", endpoint, model, exc)
            return {"credits": 0, "balance_before": balance_before, "balance_after": balance_after}

    credits = _clamp_non_negative(get_model_rate(db, model))
    billing_info = {
        "credits": credits,
        "endpoint": endpoint,
        "model": model,
        "status": status,
        "charged_at": datetime.utcnow().isoformat(),
    }
    balance_before = None
    balance_after = None

    try:
        if settings.is_json_storage():
            user = db.get_user_by_id(user_id)
            balance_before = int(user.get("credit") or 0) if user else 0
            updated = db.adjust_credit_for_user(user_id, -credits)
            balance_after = int(updated.get("credit") or 0) if updated else max(0, balance_before - credits)
            db.log_billing_usage(
                tenant_id=tenant_id,
                user_id=user_id,
                actor_user_id=actor_user_id,
                actor_username=actor_username,
                endpoint=endpoint,
                model=model,
                credits=credits,
                status=status,
                tenant_task_id=tenant_task_id,
                balance_before=balance_before,
                balance_after=balance_after,
            )
            try:
                awaitable = credit_ws_manager.send_credit_update(user_id, balance_after)
                if hasattr(awaitable, "__await__"):
                    import asyncio

                    asyncio.create_task(awaitable)
                if current_user_id and current_user_id != user_id:
                    shadow = credit_ws_manager.send_credit_update(current_user_id, balance_after)
                    if hasattr(shadow, "__await__"):
                        asyncio.create_task(shadow)
            except Exception:
                pass
            if tenant_task_id:
                try:
                    from ..services.task_record_service import task_record_service

                    task_record_service.update_task_billing(tenant_task_id, billing_info, db)
                except Exception:
                    pass
            return {
                "credits": credits,
                "balance_before": balance_before,
                "balance_after": balance_after,
            }

        user = db.query(User).filter(User.id == user_id).first()
        balance_before = int(user.credit or 0) if user else 0
        balance_after = max(0, balance_before - credits)
        if user:
            user.credit = balance_after
            db.add(user)
        usage = BillingUsage(
            tenant_id=tenant_id,
            user_id=user_id,
            tenant_task_id=tenant_task_id,
            actor_user_id=actor_user_id,
            actor_username=actor_username,
            endpoint=endpoint,
            model=model,
            credits=credits,
            status=status,
            balance_before=balance_before,
            balance_after=balance_after,
        )
        db.add(usage)
        db.commit()
        try:
            awaitable = credit_ws_manager.send_credit_update(user_id, balance_after)
            if hasattr(awaitable, "__await__"):
                import asyncio

                asyncio.create_task(awaitable)
            if current_user_id and current_user_id != user_id:
                shadow = credit_ws_manager.send_credit_update(current_user_id, balance_after)
                if hasattr(shadow, "__await__"):
                    asyncio.create_task(shadow)
        except Exception:
            pass
        if tenant_task_id:
            try:
                from ..services.task_record_service import task_record_service

                task_record_service.update_task_billing(tenant_task_id, billing_info, db)
            except Exception:
                pass
        return {
            "credits": credits,
            "balance_before": balance_before,
            "balance_after": balance_after,
        }
    except Exception as exc:
        logger.warning("Billing log failed endpoint=%s model=%s err=%s", endpoint, model, exc)
        return None


def should_charge_runninghub(endpoint: str) -> bool:
    if not endpoint:
        return False
    if endpoint.startswith("tasks/"):
        return False
    if endpoint.startswith("upload"):
        return False
    if endpoint.startswith("generate"):
        return True
    if endpoint.startswith("complete_"):
        return True
    return endpoint in {"super_resolution", "remove_background", "svg_vectorization", "variant_overlay"}
