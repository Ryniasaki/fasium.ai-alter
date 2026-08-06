from __future__ import annotations

import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from typing import Any

import httpx

from ..models.database import PaymentOrder, User
from ..services.alipay_service import (
    POINT_FIRST_PURCHASE_BONUS_CREDITS,
    POINT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS,
    OPEN_ORDER_STATUSES,
    _amounts_match,
    _cancel_order_locally,
    _expire_order_if_needed,
    _has_successful_payment_order,
    _invalidate_user_cache,
    _is_package_visible_to_user,
    _serialize_order,
    POINT_PACKAGE_AMOUNTS,
    POINT_PACKAGES,
)
from ..services.config import get_settings
from ..services.logger import get_main_logger
from ..services.ws_manager import credit_ws_manager


STRIPE_CHECKOUT_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions"
STRIPE_CHECKOUT_SESSION_URL = "https://api.stripe.com/v1/checkout/sessions/{session_id}"
STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300
def _user_value(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _amount_to_minor_units(amount: str) -> int:
    decimal_amount = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return int((decimal_amount * 100).to_integral_value(rounding=ROUND_HALF_UP))


def _major_amount_from_minor_units(amount_total: Any) -> str:
    return str((Decimal(int(amount_total)) / Decimal(100)).quantize(Decimal("0.01")))


def _stripe_return_urls() -> tuple[str, str]:
    settings = get_settings()
    fallback_base = settings.public_base_url.rstrip("/")
    success_url = settings.stripe_success_url or f"{fallback_base}/points?stripe_status=success&session_id={{CHECKOUT_SESSION_ID}}"
    cancel_url = settings.stripe_cancel_url or f"{fallback_base}/points?stripe_status=cancel"
    return success_url, cancel_url


async def _create_checkout_session(
    out_trade_no: str,
    credits: int,
    total_amount: str,
    subject: str,
    user_id: int,
) -> dict[str, Any]:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required")

    success_url, cancel_url = _stripe_return_urls()
    payload = {
        "mode": "payment",
        "client_reference_id": out_trade_no,
        "success_url": success_url,
        "cancel_url": cancel_url,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": settings.stripe_currency.lower(),
        "line_items[0][price_data][unit_amount]": str(_amount_to_minor_units(total_amount)),
        "line_items[0][price_data][product_data][name]": subject,
        "line_items[0][price_data][product_data][description]": f"Fasium {credits} points",
        "metadata[out_trade_no]": out_trade_no,
        "metadata[user_id]": str(user_id),
        "metadata[credits]": str(credits),
    }

    try:
        async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
            response = await client.post(
                STRIPE_CHECKOUT_SESSIONS_URL,
                data=payload,
                auth=(settings.stripe_secret_key, ""),
            )
    except httpx.RequestError as exc:
        raise ValueError("Unable to connect to Stripe API. Check local network or proxy settings.") from exc
    if response.status_code >= 400:
        try:
            error_payload = response.json()
            message = error_payload.get("error", {}).get("message")
        except Exception:
            message = response.text
        raise ValueError(message or "Stripe Checkout Session creation failed")
    data = response.json()
    if not isinstance(data, dict) or not data.get("url") or not data.get("id"):
        raise ValueError("Stripe did not return a Checkout URL")
    return data


async def _retrieve_checkout_session(session_id: str) -> dict[str, Any]:
    settings = get_settings()
    if not settings.stripe_secret_key:
        raise ValueError("STRIPE_SECRET_KEY is required")
    if not session_id.startswith("cs_"):
        raise ValueError("Invalid Stripe Checkout Session ID")

    try:
        async with httpx.AsyncClient(timeout=20.0, trust_env=False) as client:
            response = await client.get(
                STRIPE_CHECKOUT_SESSION_URL.format(session_id=session_id),
                auth=(settings.stripe_secret_key, ""),
            )
    except httpx.RequestError as exc:
        raise ValueError("Unable to connect to Stripe API. Check local network or proxy settings.") from exc

    if response.status_code >= 400:
        try:
            error_payload = response.json()
            message = error_payload.get("error", {}).get("message")
        except Exception:
            message = response.text
        raise ValueError(message or "Stripe Checkout Session lookup failed")

    data = response.json()
    if not isinstance(data, dict) or not data.get("id"):
        raise ValueError("Stripe did not return a Checkout Session")
    return data


async def create_stripe_payment_order(db, current_user: Any, credits: int) -> dict[str, Any]:
    if credits not in POINT_PACKAGES:
        raise ValueError("Unsupported credit package")
    if not _is_package_visible_to_user(current_user, credits):
        raise ValueError("Unsupported credit package")

    settings = get_settings()
    package_amount = POINT_PACKAGE_AMOUNTS[credits]
    user_id = int(_user_value(current_user, "id"))
    tenant_id = int(_user_value(current_user, "tenant_id"))
    username = _user_value(current_user, "username")
    is_json_storage = settings.is_json_storage()

    if is_json_storage:
        orders = db._load_data("payment_orders")
        expired_any = False
        for item in orders:
            if int(item.get("user_id") or 0) != user_id:
                continue
            if str(item.get("status") or "") not in OPEN_ORDER_STATUSES:
                continue
            before_status = str(item.get("status") or "")
            expired = _expire_order_if_needed(db, item, True)
            after_status = str(expired.get("status") or "") if isinstance(expired, dict) else before_status
            if before_status != after_status:
                expired_any = True
        if expired_any:
            orders = db._load_data("payment_orders")
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
        credits == POINT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS
        and not _has_successful_payment_order(db, user_id, is_json_storage)
    ):
        bonus_credits = POINT_FIRST_PURCHASE_BONUS_CREDITS
    effective_credits = credits + bonus_credits

    out_trade_no = f"ST{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{uuid.uuid4().hex[:12].upper()}"
    subject = f"Fasium {credits} Points"
    session = await _create_checkout_session(out_trade_no, credits, package_amount, subject, user_id)
    checkout_url = str(session["url"])
    session_id = str(session["id"])
    now = datetime.utcnow()

    if is_json_storage:
        orders = db._load_data("payment_orders")
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
            "qr_code": checkout_url,
            "status": "pending",
            "created_at": now.isoformat(),
            "paid_at": None,
            "credited_at": None,
            "stripe_session_id": session_id,
            "payment_method": "stripe_checkout",
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
            qr_code=checkout_url,
            status="pending",
            raw_notify=json.dumps({"stripe_session_id": session_id, "payment_method": "stripe_checkout"}),
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
        "qr_code": checkout_url,
        "payment_url": checkout_url,
        "payment_method": "stripe_checkout",
        "stripe_session_id": session_id,
    }


def verify_stripe_signature(payload: bytes, signature_header: str, endpoint_secret: str) -> bool:
    parts = {}
    for item in signature_header.split(","):
        key, _, value = item.partition("=")
        if key and value:
            parts.setdefault(key, []).append(value)
    timestamp_values = parts.get("t") or []
    signatures = parts.get("v1") or []
    if not timestamp_values or not signatures:
        return False
    try:
        timestamp = int(timestamp_values[0])
    except ValueError:
        return False
    if abs(time.time() - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS:
        return False
    signed_payload = f"{timestamp}.".encode("utf-8") + payload
    expected = hmac.new(endpoint_secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return any(hmac.compare_digest(expected, signature) for signature in signatures)


async def process_stripe_notify(db, payload: bytes, signature_header: str | None) -> bool:
    logger = get_main_logger()
    settings = get_settings()
    if not settings.stripe_webhook_secret:
        logger.warning("Stripe webhook received but STRIPE_WEBHOOK_SECRET is not configured")
        return False
    if not signature_header or not verify_stripe_signature(payload, signature_header, settings.stripe_webhook_secret):
        logger.warning("Stripe webhook signature invalid")
        return False

    try:
        event = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError:
        return False
    if event.get("type") != "checkout.session.completed":
        return True
    session = event.get("data", {}).get("object", {})
    if not isinstance(session, dict) or str(session.get("payment_status") or "") != "paid":
        return True

    metadata = session.get("metadata") if isinstance(session.get("metadata"), dict) else {}
    out_trade_no = str(metadata.get("out_trade_no") or session.get("client_reference_id") or "")
    if not out_trade_no:
        return False
    amount_total = session.get("amount_total")
    total_amount = _major_amount_from_minor_units(amount_total) if amount_total is not None else None

    if settings.is_json_storage():
        orders = db._load_data("payment_orders")
        order = next((item for item in orders if item.get("out_trade_no") == out_trade_no), None)
        if not order:
            return False
        return await _apply_stripe_paid_order(db, order, str(session.get("id") or ""), total_amount, event)

    order = db.query(PaymentOrder).filter(PaymentOrder.out_trade_no == out_trade_no).first()
    if not order:
        return False
    return await _apply_stripe_paid_order(db, order, str(session.get("id") or ""), total_amount, event)


def _find_stripe_order_by_session(db, current_user: Any, session_id: str) -> Any | None:
    settings = get_settings()
    user_id = int(_user_value(current_user, "id"))
    if settings.is_json_storage():
        return next(
            (
                item
                for item in db._load_data("payment_orders")
                if int(item.get("user_id") or 0) == user_id
                and str(item.get("stripe_session_id") or "") == session_id
            ),
            None,
        )

    orders = db.query(PaymentOrder).filter(PaymentOrder.user_id == user_id).all()
    for order in orders:
        raw_notify = str(order.raw_notify or "")
        if session_id in raw_notify:
            return order
    return None


async def sync_stripe_payment_order(db, current_user: Any, session_id: str) -> dict[str, Any]:
    session = await _retrieve_checkout_session(session_id)
    order = _find_stripe_order_by_session(db, current_user, session_id)
    if not order:
        raise ValueError("Order not found")

    payment_status = str(session.get("payment_status") or "")
    amount_total = session.get("amount_total")
    total_amount = _major_amount_from_minor_units(amount_total) if amount_total is not None else None
    if payment_status == "paid":
        applied = await _apply_stripe_paid_order(
            db,
            order,
            session_id,
            total_amount,
            {"source": "checkout_session_sync", "checkout_session": session},
        )
        if not applied:
            raise ValueError("Stripe payment could not be applied to this order")
        order = _find_stripe_order_by_session(db, current_user, session_id) or order
    else:
        order = _expire_order_if_needed(db, order, get_settings().is_json_storage())

    return {
        "order": _serialize_order(order, get_settings().is_json_storage()),
        "stripe_payment_status": payment_status,
    }


async def _apply_stripe_paid_order(
    db,
    order_like: Any,
    session_id: str | None,
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
                item["stripe_session_id"] = session_id
                item["raw_notify"] = raw_notify
                item["payment_method"] = "stripe_checkout"
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
    order_like.alipay_trade_no = session_id
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


async def resume_stripe_payment_order(db, current_user: Any, out_trade_no: str) -> dict[str, Any]:
    settings = get_settings()
    user_id = int(_user_value(current_user, "id"))
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
    payment_url = str(order.get("qr_code") if settings.is_json_storage() else order.qr_code)
    credits = int(order.get("credits") if settings.is_json_storage() else order.credits)
    total_amount = str(order.get("total_amount") if settings.is_json_storage() else order.total_amount)
    return {
        "out_trade_no": out_trade_no,
        "credits": credits,
        "total_amount": total_amount,
        "qr_code": payment_url,
        "payment_url": payment_url,
        "payment_method": "stripe_checkout",
    }


async def cancel_stripe_payment_order(db, current_user: Any, out_trade_no: str) -> dict[str, Any]:
    settings = get_settings()
    user_id = int(_user_value(current_user, "id"))
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
    order = _cancel_order_locally(db, order, settings.is_json_storage())
    return _serialize_order(order, settings.is_json_storage())
