from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from ..models.database import get_db
from ..routers.auth import get_current_user
from ..services.alipay_service import (
    CREDIT_PACKAGE_AMOUNTS,
    CREDIT_PACKAGES,
    CREDIT_FIRST_PURCHASE_BONUS_CREDITS,
    CREDIT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS,
    POINT_PACKAGE_AMOUNTS,
    POINT_PACKAGES,
    POINT_FIRST_PURCHASE_BONUS_CREDITS,
    POINT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS,
    _is_package_visible_to_user,
    cancel_payment_order,
    create_payment_order,
    get_order_status,
    list_orders_for_user,
    process_alipay_notify,
    resume_payment_order,
)
from ..services.stripe_service import (
    cancel_stripe_payment_order,
    create_stripe_payment_order,
    process_stripe_notify,
    resume_stripe_payment_order,
    sync_stripe_payment_order,
)
from ..services.config import get_settings

router = APIRouter()


class CreateAlipayOrderPayload(BaseModel):
    credits: int


class CreateStripeOrderPayload(BaseModel):
    credits: int


class SyncStripeOrderPayload(BaseModel):
    session_id: str


@router.get("/packages")
async def list_credit_packages(provider: str | None = None, current_user=Depends(get_current_user)):
    normalized_provider = (provider or "").strip().lower()
    currency = "CNY"
    package_amounts = CREDIT_PACKAGE_AMOUNTS
    package_ids = CREDIT_PACKAGES
    if normalized_provider in {"points", "stripe"}:
        currency = get_settings().stripe_currency.upper()
        package_amounts = POINT_PACKAGE_AMOUNTS
        package_ids = POINT_PACKAGES
        first_purchase_bonus = POINT_FIRST_PURCHASE_BONUS_CREDITS
        first_purchase_package = POINT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS
    else:
        first_purchase_bonus = CREDIT_FIRST_PURCHASE_BONUS_CREDITS
        first_purchase_package = CREDIT_FIRST_PURCHASE_DOUBLE_PACKAGE_CREDITS
    return {
        "packages": [
            {
                "credits": credits,
                "amount": package_amounts[credits],
                "currency": currency,
                "first_purchase_bonus_credits": (
                    first_purchase_bonus if credits == first_purchase_package else 0
                ),
            }
            for credits in package_ids
            if _is_package_visible_to_user(current_user, credits)
        ]
    }


@router.post("/alipay/orders")
async def create_alipay_order(
    payload: CreateAlipayOrderPayload,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    try:
        return await create_payment_order(db, current_user, payload.credits)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/stripe/orders")
async def create_stripe_order(
    payload: CreateStripeOrderPayload,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    try:
        return await create_stripe_payment_order(db, current_user, payload.credits)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/orders")
async def list_payment_orders(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    orders = await list_orders_for_user(db, current_user)
    return {"orders": orders}


@router.get("/orders/{out_trade_no}")
async def get_payment_order(
    out_trade_no: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    order = await get_order_status(db, current_user, out_trade_no)
    if not order:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Order not found")
    return {"order": order}


@router.post("/orders/{out_trade_no}/resume")
async def resume_order_payment(
    out_trade_no: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    try:
        return await resume_payment_order(db, current_user, out_trade_no)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/orders/{out_trade_no}/cancel")
async def cancel_order_payment(
    out_trade_no: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    try:
        order = await cancel_payment_order(db, current_user, out_trade_no)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"order": order}


@router.post("/stripe/orders/sync")
async def sync_stripe_order_payment(
    payload: SyncStripeOrderPayload,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    try:
        return await sync_stripe_payment_order(db, current_user, payload.session_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/stripe/orders/{out_trade_no}/resume")
async def resume_stripe_order_payment(
    out_trade_no: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    try:
        return await resume_stripe_payment_order(db, current_user, out_trade_no)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/stripe/orders/{out_trade_no}/cancel")
async def cancel_stripe_order_payment(
    out_trade_no: str,
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    try:
        order = await cancel_stripe_payment_order(db, current_user, out_trade_no)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"order": order}


@router.post("/alipay/notify", response_class=PlainTextResponse)
async def alipay_notify(request: Request, db=Depends(get_db)):
    form = await request.form()
    params = {key: str(value) for key, value in form.multi_items()}
    success = await process_alipay_notify(db, params)
    return "success" if success else "failure"


@router.post("/stripe/notify")
async def stripe_notify(request: Request, db=Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    success = await process_stripe_notify(db, payload, signature)
    if not success:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid Stripe webhook")
    return {"received": True}
