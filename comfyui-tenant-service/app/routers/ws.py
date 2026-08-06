from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect, status
from http.cookies import SimpleCookie

from ..services.auth import verify_token
from ..services.config import get_settings
from ..services.logger import get_main_logger
from ..services.ws_manager import credit_ws_manager, task_ws_manager
from ..models.database import User, get_db

router = APIRouter()

def _resolve_token(websocket: WebSocket) -> str | None:
    query_token = websocket.query_params.get("token")
    if query_token:
        return query_token

    cookie_header = websocket.headers.get("cookie")
    if not cookie_header:
        return None
    cookie = SimpleCookie()
    cookie.load(cookie_header)
    token = cookie.get("access_token")
    return token.value if token else None


@router.websocket("/ws/credits")
async def credit_updates(websocket: WebSocket):
    logger = get_main_logger()
    token = _resolve_token(websocket)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    settings = get_settings()
    try:
        payload = verify_token(token)
    except Exception as exc:
        logger.warning("WS token invalid: %s", exc)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    username = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    if not username or not tenant_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    # Resolve user id
    user_id = None
    current_credit = None
    if settings.is_database_storage():
        db = next(get_db())
        try:
            user = db.query(User).filter(User.username == username).first()
            if not user:
                raise HTTPException(status_code=401, detail="User not found")
            user_id = user.id
            current_credit = int(user.credit or 0)
        finally:
            db.close()
    else:
        db = next(get_db())
        try:
            user = db.get_user_by_username(username)
            if not user:
                raise HTTPException(status_code=401, detail="User not found")
            user_id = user.get("id")
            current_credit = int(user.get("credit") or 0)
        finally:
            pass

    if user_id is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await credit_ws_manager.connect(user_id, websocket)
    if current_credit is not None:
        try:
            await websocket.send_json({"type": "credit_update", "credit": current_credit})
        except Exception:
            credit_ws_manager.disconnect(user_id, websocket)
            await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
            return

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        credit_ws_manager.disconnect(user_id, websocket)


@router.websocket("/ws/tasks")
async def task_updates(websocket: WebSocket):
    logger = get_main_logger()
    token = _resolve_token(websocket)
    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = verify_token(token)
    except Exception as exc:
        logger.warning("Task WS token invalid: %s", exc)
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    username = payload.get("sub")
    tenant_id = payload.get("tenant_id")
    if not username or not tenant_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await task_ws_manager.connect(str(username), websocket)
    try:
        await websocket.send_json({"type": "task_ws_ready", "user": str(username)})
    except Exception:
        task_ws_manager.disconnect(str(username), websocket)
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        task_ws_manager.disconnect(str(username), websocket)
