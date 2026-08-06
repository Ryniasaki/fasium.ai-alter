from __future__ import annotations

import base64
import json
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation
from typing import Any
from urllib.parse import urlencode
import httpx

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

from ..models.database import PaymentOrder, User
from ..services.config import get_settings
from ..services.logger import get_main_logger
from ..services.runtime_cache import cache_delete_prefix, cache_key
from ..services.ws_manager import credit_ws_manager


CREDIT_PACKAGE_AMOUNTS = {
    1: "0.01",
    1000: "9.9",
    11368: "98",
    71760: "598",
}
CREDIT_PACKAGES = tuple(CREDIT_PACKAGE_AMOUNTS.keys())
POINT_PACKAGE_AMOUNTS = {
    1: "0.50",
    2600: "9.9",
    8000: "30",
    26000: "98",
}
POINT_PACKAGES = tuple(POINT_PACKAGE_AMOUNTS.keys())
CREDIT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS = 1000
CREDIT_FIRST_PURCHASE_BONUS_CREDITS = 1000
POINT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS = 2600
POINT_FIRST_PURCHASE_BONUS_CREDITS = 2600
PAID_TRADE_STATUSES = {"TRADE_SUCCESS", "TRADE_FINISHED"}
OPEN_ORDER_STATUSES = {"pending"}
# Unpaid payment orders remain valid for 24 hours before being auto-canceled.
PAYMENT_ORDER_EXPIRATION_MINUTES = 24 * 60


def _user_value(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _is_admin_user(user: Any) -> bool:
    try:
        return int(_user_value(user, "group", 0) or 0) == 1000
    except (TypeError, ValueError):
        return False


def _is_package_visible_to_user(user: Any, credits: int) -> bool:
    if credits == 1:
        return _is_admin_user(user)
    return True


def _format_alipay_public_key(raw_key: str) -> str:
    key = (raw_key or "").strip()
    if "BEGIN PUBLIC KEY" in key:
        return key
    chunks = [key[index : index + 64] for index in range(0, len(key), 64)]
    return "-----BEGIN PUBLIC KEY-----\n" + "\n".join(chunks) + "\n-----END PUBLIC KEY-----\n"


def _load_private_key_pem() -> str:
    settings = get_settings()
    if settings.alipay_private_key:
        return settings.alipay_private_key.replace("\\n", "\n")
    if settings.alipay_private_key_base64:
        return base64.b64decode(settings.alipay_private_key_base64).decode("utf-8")
    raise ValueError("ALIPAY_PRIVATE_KEY or ALIPAY_PRIVATE_KEY_BASE64 is required")


def _load_private_key():
    pem = _load_private_key_pem().encode("utf-8")
    return serialization.load_pem_private_key(pem, password=None)


def _load_alipay_public_key():
    settings = get_settings()
    if not settings.alipay_public_key:
        raise ValueError("ALIPAY_PUBLIC_KEY is required")
    pem = _format_alipay_public_key(settings.alipay_public_key).encode("utf-8")
    return serialization.load_pem_public_key(pem)


def _stringify_param(value: Any) -> str:
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    return str(value)


def _amounts_match(left: Any, right: Any) -> bool:
    try:
        return Decimal(str(left)).normalize() == Decimal(str(right)).normalize()
    except (InvalidOperation, TypeError, ValueError):
        return str(left) == str(right)


def _sign_content(params: dict[str, Any]) -> str:
    pairs = []
    for key in sorted(params):
        value = params[key]
        if key == "sign" or value is None or value == "":
            continue
        pairs.append(f"{key}={_stringify_param(value)}")
    return "&".join(pairs)


def sign_params(params: dict[str, Any]) -> str:
    signature = _load_private_key().sign(
        _sign_content(params).encode("utf-8"),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode("utf-8")


def _build_gateway_params(method: str, biz_content: dict[str, Any]) -> dict[str, Any]:
    settings = get_settings()
    if not settings.alipay_app_id:
        raise ValueError("ALIPAY_APP_ID is required")
    params: dict[str, Any] = {
        "app_id": settings.alipay_app_id,
        "method": method,
        "format": "JSON",
        "charset": "utf-8",
        "sign_type": "RSA2",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "version": "1.0",
        "biz_content": json.dumps(biz_content, ensure_ascii=False, separators=(",", ":")),
    }
    app_auth_token = (settings.alipay_app_auth_token or "").strip()
    if app_auth_token:
        params["app_auth_token"] = app_auth_token
    params["sign"] = sign_params(params)
    return params


def verify_notify(params: dict[str, Any]) -> bool:
    sign = params.get("sign")
    if not sign:
        return False
    try:
        _load_alipay_public_key().verify(
            base64.b64decode(str(sign)),
            _sign_content(params).encode("utf-8"),
            padding.PKCS1v15(),
            hashes.SHA256(),
        )
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


async def _call_alipay_api(method: str, biz_content: dict[str, Any], extra_params: dict[str, Any] | None = None) -> dict[str, Any]:
    settings = get_settings()
    params = _build_gateway_params(method, biz_content)
    if extra_params:
        params.update(extra_params)
        params["sign"] = sign_params(params)
    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            settings.alipay_gateway,
            data={key: _stringify_param(value) for key, value in params.items()},
            headers={"content-type": "application/x-www-form-urlencoded; charset=utf-8"},
        )
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict):
        raise ValueError("Invalid response from Alipay gateway")
    response_key = f"{method.replace('.', '_')}_response"
    payload = data.get(response_key)
    if not isinstance(payload, dict):
        raise ValueError("Invalid response payload from Alipay gateway")
    response_code = str(payload.get("code") or "")
    if response_code != "10000":
        raise ValueError(str(payload.get("sub_msg") or payload.get("msg") or "Alipay request failed"))
    return payload


async def _create_precreate_qr(out_trade_no: str, credits: int, total_amount: str, subject: str) -> str:
    settings = get_settings()
    notify_url = settings.alipay_notify_url or f"{settings.public_base_url.rstrip('/')}/payments/alipay/notify"
    payload = await _call_alipay_api(
        "alipay.trade.precreate",
        {
            "out_trade_no": out_trade_no,
            "total_amount": total_amount,
            "subject": subject,
            "body": f"Credits package {credits}",
        },
        {"notify_url": notify_url},
    )
    qr_code = str(payload.get("qr_code") or "")
    if not qr_code:
        raise ValueError("Alipay did not return a QR code")
    return qr_code


def _create_page_pay_url(out_trade_no: str, credits: int, total_amount: str, subject: str) -> str:
    settings = get_settings()
    notify_url = settings.alipay_notify_url or f"{settings.public_base_url.rstrip('/')}/payments/alipay/notify"
    params = _build_gateway_params(
        "alipay.trade.page.pay",
        {
            "out_trade_no": out_trade_no,
            "total_amount": total_amount,
            "subject": subject,
            "body": f"Credits package {credits}",
            "product_code": "FAST_INSTANT_TRADE_PAY",
        },
    )
    params["notify_url"] = notify_url
    if settings.alipay_return_url:
        params["return_url"] = settings.alipay_return_url
    params["sign"] = sign_params(params)
    return f"{settings.alipay_gateway}?{urlencode({key: _stringify_param(value) for key, value in params.items()})}"


def _has_successful_payment_order(db, user_id: int, is_json_storage: bool) -> bool:
    if is_json_storage:
        orders = db._load_data("payment_orders")
        return any(
            int(item.get("user_id") or 0) == user_id and str(item.get("status") or "") == "credited"
            for item in orders
        )

    order = (
        db.query(PaymentOrder)
        .filter(PaymentOrder.user_id == user_id, PaymentOrder.status == "credited")
        .first()
    )
    return order is not None


async def _close_alipay_trade(out_trade_no: str) -> None:
    await _call_alipay_api("alipay.trade.close", {"out_trade_no": out_trade_no})


async def create_payment_order(db, current_user: Any, credits: int) -> dict[str, Any]:
    if credits not in CREDIT_PACKAGES:
        raise ValueError("Unsupported credit package")
    if not _is_package_visible_to_user(current_user, credits):
        raise ValueError("Unsupported credit package")
    package_amount = CREDIT_PACKAGE_AMOUNTS[credits]

    settings = get_settings()
    user_id = int(current_user.get("id") if isinstance(current_user, dict) else getattr(current_user, "id"))
    tenant_id = int(current_user.get("tenant_id") if isinstance(current_user, dict) else getattr(current_user, "tenant_id"))
    username = current_user.get("username") if isinstance(current_user, dict) else getattr(current_user, "username", None)
    is_json_storage = settings.is_json_storage()

    if is_json_storage:
        orders = db._load_data("payment_orders")
        expired_any = False
        for item in orders:
            if int(item.get("user_id") or 0) != user_id:
                continue
            if str(item.get("status") or "") not in OPEN_ORDER_STATUSES:
                continue
            if not _is_order_expired(item, True):
                continue
            item["status"] = "canceled"
            expired_any = True
        if expired_any:
            db._save_data("payment_orders", orders)
        existing_open_order = next(
            (
                item
                for item in orders
                if int(item.get("user_id") or 0) == user_id
                and str(item.get("status") or "") in OPEN_ORDER_STATUSES
            ),
            None,
        )
        if existing_open_order:
            raise ValueError("You already have a pending order")
    else:
        existing_open_orders = (
            db.query(PaymentOrder)
            .filter(PaymentOrder.user_id == user_id, PaymentOrder.status.in_(tuple(OPEN_ORDER_STATUSES)))
            .all()
        )
        for item in existing_open_orders:
            _expire_order_if_needed(db, item, False)
        existing_open_order = (
            db.query(PaymentOrder)
            .filter(PaymentOrder.user_id == user_id, PaymentOrder.status.in_(tuple(OPEN_ORDER_STATUSES)))
            .first()
        )
        if existing_open_order:
            raise ValueError("You already have a pending order")

    bonus_credits = 0
    if (
        credits == CREDIT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS
        and not _has_successful_payment_order(db, user_id, is_json_storage)
    ):
        bonus_credits = CREDIT_FIRST_PURCHASE_BONUS_CREDITS
    effective_credits = credits + bonus_credits

    out_trade_no = f"CR{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:12].upper()}"
    subject = f"Fasium Credits {credits}"
    payment_url = _create_page_pay_url(out_trade_no, credits, package_amount, subject)
    now = datetime.utcnow()

    if is_json_storage:
        record = {
            "id": len(orders) + 1,
            "out_trade_no": out_trade_no,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "username": username,
            "credits": effective_credits,
            "package_credits": credits,
            "bonus_credits": bonus_credits,
            "total_amount": package_amount,
            "subject": subject,
            "qr_code": payment_url,
            "status": "pending",
            "created_at": now.isoformat(),
            "paid_at": None,
            "credited_at": None,
        }
        orders.append(record)
        db._save_data("payment_orders", orders)
    else:
        record = PaymentOrder(
            out_trade_no=out_trade_no,
            tenant_id=tenant_id,
            user_id=user_id,
            username=username,
            credits=effective_credits,
            total_amount=package_amount,
            subject=subject,
            qr_code=payment_url,
            status="pending",
        )
        db.add(record)
        db.commit()
        db.refresh(record)

    return {
        "out_trade_no": out_trade_no,
        "credits": effective_credits,
        "package_credits": credits,
        "bonus_credits": bonus_credits,
        "total_amount": package_amount,
        "qr_code": payment_url,
        "payment_url": payment_url,
        "payment_method": "alipay_page_pay",
    }


def _serialize_order(order_like: Any, is_json_storage: bool) -> dict[str, Any]:
    if is_json_storage:
        return {
            "out_trade_no": order_like.get("out_trade_no"),
            "credits": order_like.get("credits"),
            "package_credits": order_like.get("package_credits"),
            "bonus_credits": order_like.get("bonus_credits"),
            "total_amount": order_like.get("total_amount"),
            "qr_code": order_like.get("qr_code"),
            "status": order_like.get("status"),
            "created_at": order_like.get("created_at"),
            "credited_at": order_like.get("credited_at"),
            "paid_at": order_like.get("paid_at"),
        }
    return {
        "out_trade_no": order_like.out_trade_no,
        "credits": order_like.credits,
        "package_credits": None,
        "bonus_credits": None,
        "total_amount": order_like.total_amount,
        "qr_code": order_like.qr_code,
        "status": order_like.status,
        "created_at": order_like.created_at.isoformat() if order_like.created_at else None,
        "credited_at": order_like.credited_at.isoformat() if order_like.credited_at else None,
        "paid_at": order_like.paid_at.isoformat() if order_like.paid_at else None,
    }


def _invalidate_user_cache(username: str | None, tenant_id: int) -> None:
    if not username:
        return
    settings = get_settings()
    cache_delete_prefix(cache_key("auth", "current_user", settings.storage_type, username))
    cache_delete_prefix(cache_key("auth", "me", username, tenant_id, settings.storage_type))


def _parse_order_created_at(order_like: Any, is_json_storage: bool) -> datetime | None:
    raw_value = order_like.get("created_at") if is_json_storage else order_like.created_at
    if not raw_value:
        return None
    if isinstance(raw_value, datetime):
        if raw_value.tzinfo is not None:
            return raw_value.astimezone(timezone.utc).replace(tzinfo=None)
        return raw_value
    try:
        parsed = datetime.fromisoformat(str(raw_value))
        if parsed.tzinfo is not None:
            return parsed.astimezone(timezone.utc).replace(tzinfo=None)
        return parsed
    except ValueError:
        return None


def _is_order_expired(order_like: Any, is_json_storage: bool) -> bool:
    created_at = _parse_order_created_at(order_like, is_json_storage)
    if created_at is None:
        return False
    return datetime.utcnow() - created_at >= timedelta(minutes=PAYMENT_ORDER_EXPIRATION_MINUTES)


def _cancel_order_locally(db, order_like: Any, is_json_storage: bool) -> Any:
    if is_json_storage:
        orders = db._load_data("payment_orders")
        for item in orders:
            if item.get("out_trade_no") == order_like.get("out_trade_no"):
                item["status"] = "canceled"
                order_like = item
                break
        db._save_data("payment_orders", orders)
        return order_like

    order_like.status = "canceled"
    db.add(order_like)
    db.commit()
    db.refresh(order_like)
    return order_like


def _expire_order_if_needed(db, order_like: Any, is_json_storage: bool) -> Any:
    status_value = order_like.get("status") if is_json_storage else order_like.status
    if status_value not in OPEN_ORDER_STATUSES:
        return order_like
    if not _is_order_expired(order_like, is_json_storage):
        return order_like
    return _cancel_order_locally(db, order_like, is_json_storage)


async def _apply_paid_order(
    db,
    order_like: Any,
    trade_no: str | None,
    total_amount: str | None,
    raw_payload: dict[str, Any],
) -> bool:
    settings = get_settings()
    now = datetime.utcnow()
    raw_notify = json.dumps(raw_payload, ensure_ascii=False)

    if settings.is_json_storage():
        if not _amounts_match(order_like.get("total_amount"), total_amount):
            return False
        if order_like.get("credited_at"):
            return True
        updated_user = db.add_credit_to_user(int(order_like["user_id"]), int(order_like["credits"]))
        orders = db._load_data("payment_orders")
        for item in orders:
            if item.get("out_trade_no") == order_like.get("out_trade_no"):
                item["status"] = "credited"
                item["alipay_trade_no"] = trade_no
                item["raw_notify"] = raw_notify
                item["paid_at"] = now.isoformat()
                item["credited_at"] = now.isoformat()
                order_like = item
                break
        db._save_data("payment_orders", orders)
        _invalidate_user_cache(order_like.get("username"), int(order_like["tenant_id"]))
        await credit_ws_manager.send_credit_update(int(order_like["user_id"]), int(updated_user.get("credit") or 0))
        return True

    if not _amounts_match(order_like.total_amount, total_amount):
        return False
    if order_like.credited_at is not None:
        return True
    user = db.query(User).filter(User.id == order_like.user_id).first()
    if not user:
        return False
    user.credit = int(user.credit or 0) + int(order_like.credits)
    order_like.status = "credited"
    order_like.alipay_trade_no = trade_no
    order_like.raw_notify = raw_notify
    order_like.paid_at = now
    order_like.credited_at = now
    db.add(user)
    db.add(order_like)
    db.commit()
    db.refresh(user)
    _invalidate_user_cache(order_like.username, int(order_like.tenant_id))
    await credit_ws_manager.send_credit_update(int(order_like.user_id), int(user.credit or 0))
    return True


async def process_alipay_notify(db, params: dict[str, Any]) -> bool:
    logger = get_main_logger()
    settings = get_settings()
    logger.info(
        "Alipay notify received out_trade_no=%s trade_status=%s body_keys=%s",
        params.get("out_trade_no"),
        params.get("trade_status"),
        ",".join(sorted(params.keys())),
    )
    if not verify_notify(params):
        logger.warning(
            "Alipay notify signature invalid out_trade_no=%s trade_status=%s",
            params.get("out_trade_no"),
            params.get("trade_status"),
        )
        return False
    if params.get("app_id") != settings.alipay_app_id:
        logger.warning(
            "Alipay notify app_id mismatch out_trade_no=%s app_id=%s",
            params.get("out_trade_no"),
            params.get("app_id"),
        )
        return False

    out_trade_no = str(params.get("out_trade_no") or "")
    trade_status = str(params.get("trade_status") or "")
    total_amount = str(params.get("total_amount") or "")
    if not out_trade_no or trade_status not in PAID_TRADE_STATUSES:
        return True

    now = datetime.utcnow()
    raw_notify = json.dumps(params, ensure_ascii=False)
    if settings.is_json_storage():
        orders = db._load_data("payment_orders")
        order = next((item for item in orders if item.get("out_trade_no") == out_trade_no), None)
        if not order:
            logger.warning("Alipay notify order not found out_trade_no=%s", out_trade_no)
            return False
        return await _apply_paid_order(db, order, params.get("trade_no"), total_amount, params)

    order = db.query(PaymentOrder).filter(PaymentOrder.out_trade_no == out_trade_no).first()
    if not order:
        logger.warning("Alipay notify order not found out_trade_no=%s", out_trade_no)
        return False
    return await _apply_paid_order(db, order, params.get("trade_no"), total_amount, params)


async def _query_alipay_trade(out_trade_no: str) -> dict[str, Any] | None:
    return await _call_alipay_api("alipay.trade.query", {"out_trade_no": out_trade_no})


async def _settle_order_from_trade_query(db, order_like: Any, query_payload: dict[str, Any]) -> bool:
    trade_status = str(query_payload.get("trade_status") or "")
    if trade_status not in PAID_TRADE_STATUSES:
        return False
    return await _apply_paid_order(
        db,
        order_like,
        str(query_payload.get("trade_no") or ""),
        str(query_payload.get("total_amount") or ""),
        {"source": "trade_query", **query_payload},
    )


async def get_order_status(db, current_user: Any, out_trade_no: str) -> dict[str, Any] | None:
    user_id = int(current_user.get("id") if isinstance(current_user, dict) else getattr(current_user, "id"))
    settings = get_settings()
    if settings.is_json_storage():
        orders = db._load_data("payment_orders")
        order = next(
            (item for item in orders if item.get("out_trade_no") == out_trade_no and int(item.get("user_id") or 0) == user_id),
            None,
        )
        if not order:
            return None
        order = _expire_order_if_needed(db, order, True)
        if order.get("status") == "pending":
            try:
                query_payload = await _query_alipay_trade(out_trade_no)
            except Exception:
                query_payload = None
            if isinstance(query_payload, dict):
                await _settle_order_from_trade_query(db, order, query_payload)
                orders = db._load_data("payment_orders")
                order = next(
                    (item for item in orders if item.get("out_trade_no") == out_trade_no and int(item.get("user_id") or 0) == user_id),
                    order,
                )
        return _serialize_order(order, True)

    order = (
        db.query(PaymentOrder)
        .filter(PaymentOrder.out_trade_no == out_trade_no, PaymentOrder.user_id == user_id)
        .first()
    )
    if not order:
        return None
    order = _expire_order_if_needed(db, order, False)
    if order.status == "pending":
        try:
            query_payload = await _query_alipay_trade(out_trade_no)
        except Exception:
            query_payload = None
        if isinstance(query_payload, dict):
            await _settle_order_from_trade_query(db, order, query_payload)
            order = (
                db.query(PaymentOrder)
                .filter(PaymentOrder.out_trade_no == out_trade_no, PaymentOrder.user_id == user_id)
                .first()
            ) or order
    return _serialize_order(order, False)


async def list_orders_for_user(db, current_user: Any, limit: int = 20) -> list[dict[str, Any]]:
    user_id = int(current_user.get("id") if isinstance(current_user, dict) else getattr(current_user, "id"))
    settings = get_settings()
    if settings.is_json_storage():
        orders = [
            item
            for item in db._load_data("payment_orders")
            if int(item.get("user_id") or 0) == user_id
        ]
        expired_any = False
        for item in orders:
            if str(item.get("status") or "") not in OPEN_ORDER_STATUSES:
                continue
            if not _is_order_expired(item, True):
                continue
            item["status"] = "canceled"
            expired_any = True
        if expired_any:
            all_orders = db._load_data("payment_orders")
            for stored_item in all_orders:
                if int(stored_item.get("user_id") or 0) != user_id:
                    continue
                if str(stored_item.get("status") or "") not in OPEN_ORDER_STATUSES:
                    continue
                if not _is_order_expired(stored_item, True):
                    continue
                stored_item["status"] = "canceled"
            db._save_data("payment_orders", all_orders)
            orders = [
                item
                for item in all_orders
                if int(item.get("user_id") or 0) == user_id
            ]
        for item in orders:
            if str(item.get("status") or "") != "pending":
                continue
            try:
                query_payload = await _query_alipay_trade(str(item.get("out_trade_no") or ""))
            except Exception:
                query_payload = None
            if isinstance(query_payload, dict):
                await _settle_order_from_trade_query(db, item, query_payload)
        orders = [
            item
            for item in db._load_data("payment_orders")
            if int(item.get("user_id") or 0) == user_id
        ]
        orders.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return [_serialize_order(item, True) for item in orders[:limit]]

    orders = (
        db.query(PaymentOrder)
        .filter(PaymentOrder.user_id == user_id)
        .order_by(PaymentOrder.id.desc())
        .limit(limit)
        .all()
    )
    for item in orders:
        _expire_order_if_needed(db, item, False)
        if item.status != "pending":
            continue
        try:
            query_payload = await _query_alipay_trade(item.out_trade_no)
        except Exception:
            query_payload = None
        if isinstance(query_payload, dict):
            await _settle_order_from_trade_query(db, item, query_payload)
    orders = (
        db.query(PaymentOrder)
        .filter(PaymentOrder.user_id == user_id)
        .order_by(PaymentOrder.id.desc())
        .limit(limit)
        .all()
    )
    return [_serialize_order(item, False) for item in orders]


async def resume_payment_order(db, current_user: Any, out_trade_no: str) -> dict[str, Any]:
    settings = get_settings()
    user_id = int(current_user.get("id") if isinstance(current_user, dict) else getattr(current_user, "id"))

    if settings.is_json_storage():
        orders = db._load_data("payment_orders")
        order = next(
            (item for item in orders if item.get("out_trade_no") == out_trade_no and int(item.get("user_id") or 0) == user_id),
            None,
        )
    else:
        order = (
            db.query(PaymentOrder)
            .filter(PaymentOrder.out_trade_no == out_trade_no, PaymentOrder.user_id == user_id)
            .first()
        )
    if not order:
        raise ValueError("Order not found")

    order = _expire_order_if_needed(db, order, settings.is_json_storage())
    status_value = order.get("status") if settings.is_json_storage() else order.status
    if status_value not in OPEN_ORDER_STATUSES:
        raise ValueError("Only pending orders can continue payment")

    try:
        query_payload = await _query_alipay_trade(out_trade_no)
    except Exception:
        query_payload = None
    if isinstance(query_payload, dict) and str(query_payload.get("trade_status") or "") in PAID_TRADE_STATUSES:
        await _settle_order_from_trade_query(db, order, query_payload)
        raise ValueError("Order is already paid")

    credits = int(order.get("credits") if settings.is_json_storage() else order.credits)
    total_amount = str(order.get("total_amount") if settings.is_json_storage() else order.total_amount)
    subject = str(order.get("subject") if settings.is_json_storage() else order.subject)
    qr_code = _create_page_pay_url(out_trade_no, credits, total_amount, subject)
    if settings.is_json_storage():
        for item in orders:
            if item.get("out_trade_no") == out_trade_no:
                item["qr_code"] = qr_code
                order = item
                break
        db._save_data("payment_orders", orders)
    else:
        order.qr_code = qr_code
        db.add(order)
        db.commit()
        db.refresh(order)
    return {
        "out_trade_no": out_trade_no,
        "credits": credits,
        "total_amount": total_amount,
        "qr_code": qr_code,
        "payment_url": qr_code,
        "payment_method": "alipay_page_pay",
    }


async def cancel_payment_order(db, current_user: Any, out_trade_no: str) -> dict[str, Any]:
    settings = get_settings()
    logger = get_main_logger()
    user_id = int(current_user.get("id") if isinstance(current_user, dict) else getattr(current_user, "id"))

    if settings.is_json_storage():
        orders = db._load_data("payment_orders")
        order = next(
            (item for item in orders if item.get("out_trade_no") == out_trade_no and int(item.get("user_id") or 0) == user_id),
            None,
        )
    else:
        order = (
            db.query(PaymentOrder)
            .filter(PaymentOrder.out_trade_no == out_trade_no, PaymentOrder.user_id == user_id)
            .first()
        )
    if not order:
        raise ValueError("Order not found")

    order = _expire_order_if_needed(db, order, settings.is_json_storage())
    status_value = order.get("status") if settings.is_json_storage() else order.status
    if status_value not in OPEN_ORDER_STATUSES:
        raise ValueError("Only pending orders can be canceled")

    try:
        query_payload = await _query_alipay_trade(out_trade_no)
    except Exception as exc:
        logger.warning(
            "Alipay trade query failed during cancel, falling back to local cancel. out_trade_no=%s error=%s",
            out_trade_no,
            repr(exc),
        )
        query_payload = None
    if isinstance(query_payload, dict) and str(query_payload.get("trade_status") or "") in PAID_TRADE_STATUSES:
        await _settle_order_from_trade_query(db, order, query_payload)
        raise ValueError("Order is already paid")

    try:
        await _close_alipay_trade(out_trade_no)
    except Exception as exc:
        logger.warning(
            "Alipay trade close failed during cancel, keeping local cancel path. out_trade_no=%s error=%s",
            out_trade_no,
            repr(exc),
        )

    order = _cancel_order_locally(db, order, settings.is_json_storage())
    return _serialize_order(order, settings.is_json_storage())
