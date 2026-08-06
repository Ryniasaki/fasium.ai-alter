from datetime import timedelta
import re
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field
from sqlalchemy import func

from ..models.database import BillingUsage, Tenant, User, get_db
from ..services.auth import (
    authenticate_user,
    create_access_token,
    get_password_hash,
    verify_password,
    verify_token,
)
from ..services.config import get_settings
from ..services.logger import get_auth_logger
from ..services.runtime_cache import cache_delete_prefix, cache_get_json, cache_key, cache_set_json
from ..services.ws_manager import credit_ws_manager

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/token")
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
INVITE_BONUS_CREDITS = 1000
INVITE_MAX_SUCCESSFUL_REFERRALS = 3


def _safe_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _user_value(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _normalize_role(role: Any) -> str:
    value = str(role or "").strip().lower()
    if value in {"manager", "employee", "user"}:
        return value
    return "user"


def _serialize_user(user: Any, settings) -> dict:
    role = _normalize_role(_user_value(user, "role", "user"))
    manager_username = _user_value(user, "manager_username")
    max_active_employees = _safe_int(_user_value(user, "max_active_employees", 5), 5)
    return {
        "id": _safe_int(_user_value(user, "id", 0), 0),
        "username": _user_value(user, "username"),
        "email": _user_value(user, "email"),
        "tenant_id": _safe_int(_user_value(user, "tenant_id", 1), 1),
        "is_active": bool(_user_value(user, "is_active", True)),
        "credit": _safe_int(_user_value(user, "credit", 0), 0),
        "group": _safe_int(_user_value(user, "group", settings.user_default_group), settings.user_default_group),
        "role": role,
        "manager_username": manager_username if role == "employee" else None,
        "max_active_employees": max_active_employees if role == "manager" else 0,
    }


def _is_manager(user: Any) -> bool:
    return _normalize_role(_user_value(user, "role", "user")) == "manager"


def _is_employee(user: Any) -> bool:
    return _normalize_role(_user_value(user, "role", "user")) == "employee"


def _get_username(user: Any) -> str:
    return str(_user_value(user, "username", ""))


def _is_valid_email(value: str) -> bool:
    return bool(EMAIL_PATTERN.match((value or "").strip()))


def _serialize_auth_user_record(user: Any, settings) -> dict:
    payload = _serialize_user(user, settings)
    payload["hashed_password"] = _user_value(user, "hashed_password", "")
    payload["created_at"] = _user_value(user, "created_at")
    payload["last_login"] = _user_value(user, "last_login")
    return payload


def _invalidate_auth_cache(username: str, tenant_id: Any, settings) -> None:
    cache_delete_prefix(cache_key("auth", "current_user", settings.storage_type, username))
    cache_delete_prefix(cache_key("auth", "me", settings.storage_type, username, tenant_id))


def _count_successful_referrals(db, settings, inviter_username: str) -> int:
    if settings.is_database_storage():
        return db.query(User).filter(User.referred_by_username == inviter_username).count()
    users = db._load_data("users")
    return sum(1 for item in users if item.get("referred_by_username") == inviter_username)


def _append_invite_summary(payload: dict, db, settings) -> dict:
    username = str(payload.get("username") or "").strip().lower()
    if not username:
        payload["successful_referrals"] = 0
        payload["invite_limit"] = INVITE_MAX_SUCCESSFUL_REFERRALS
        return payload

    successful_referrals = _count_successful_referrals(db, settings, username)
    payload["successful_referrals"] = successful_referrals
    payload["invite_limit"] = INVITE_MAX_SUCCESSFUL_REFERRALS
    return payload


def _inviter_reward_available(db, settings, inviter_username: str) -> bool:
    return _count_successful_referrals(db, settings, inviter_username) < INVITE_MAX_SUCCESSFUL_REFERRALS


async def ensure_default_tenant(db, settings):
    try:
        if settings.is_database_storage():
            default_tenant = db.query(Tenant).filter(Tenant.id == 1).first()
            if not default_tenant:
                import uuid

                default_tenant = Tenant(
                    id=1,
                    name="Default Tenant",
                    api_key=str(uuid.uuid4()),
                    is_active=True,
                )
                db.add(default_tenant)
                db.commit()
        else:
            default_tenant = db.get_tenant_by_id(1)
            if not default_tenant:
                db.create_tenant(name="Default Tenant", settings="{}")
        return True
    except Exception as exc:
        logger = get_auth_logger()
        logger.error(f"Failed to ensure default tenant: {exc}")
        return False


class UserCreate(BaseModel):
    username: str
    email: Optional[str] = None
    phone: str
    password: str
    tenant_id: int = 1
    invite_code: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    email: Optional[str] = None
    tenant_id: int
    is_active: bool
    credit: Optional[int] = None
    group: Optional[int] = None
    role: str = "user"
    manager_username: Optional[str] = None
    max_active_employees: int = 5
    successful_referrals: int = 0
    invite_limit: int = INVITE_MAX_SUCCESSFUL_REFERRALS


class Token(BaseModel):
    access_token: str
    token_type: str


class AuthenticatedUser:
    def __init__(self, payload: dict):
        self._payload = dict(payload or {})

    def __getattr__(self, item: str):
        try:
            return self._payload[item]
        except KeyError as exc:
            raise AttributeError(item) from exc

    def __getitem__(self, item: str):
        return self._payload[item]

    def get(self, item: str, default: Any = None) -> Any:
        return self._payload.get(item, default)

    def to_dict(self) -> dict:
        return dict(self._payload)


class ChangePasswordPayload(BaseModel):
    current_password: str
    new_password: str


class EmployeeCreatePayload(BaseModel):
    username: str = Field(..., min_length=1, max_length=50)
    password: str = Field(..., min_length=6, max_length=255)
    email: Optional[str] = Field(default=None, max_length=100)
    is_active: bool = True


class EmployeeStatusPayload(BaseModel):
    is_active: bool


class EmployeePasswordPayload(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=255)


@router.post("/register", response_model=UserResponse)
async def register(user_data: UserCreate, db=Depends(get_db)):
    logger = get_auth_logger()
    settings = get_settings()
    normalized_username = user_data.username.strip().lower()
    normalized_email = (user_data.email or normalized_username).strip().lower()
    normalized_invite_code = (user_data.invite_code or "").strip().lower()
    logger.info(f"User register request: {normalized_username}")

    if not _is_valid_email(normalized_username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username must be a valid email address")
    if not _is_valid_email(normalized_email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email must be a valid email address")

    user_data.username = normalized_username
    user_data.email = normalized_email
    user_data.invite_code = normalized_invite_code or None

    if not await ensure_default_tenant(db, settings):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create default tenant",
        )

    if settings.is_database_storage():
        if db.query(User).filter(User.username == user_data.username).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already registered")
        if user_data.email and db.query(User).filter(User.email == user_data.email).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

        inviter = None
        if user_data.invite_code:
            inviter = db.query(User).filter(User.username == user_data.invite_code).first()
            if not inviter:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite link is invalid")
            if inviter.username == user_data.username:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite link is invalid")
        inviter_reward_available = bool(inviter and _inviter_reward_available(db, settings, inviter.username))

        db_user = User(
            username=user_data.username,
            email=user_data.email,
            hashed_password=get_password_hash(user_data.password),
            tenant_id=user_data.tenant_id,
            credit=settings.user_default_credit + (INVITE_BONUS_CREDITS if inviter else 0),
            group=settings.user_default_group,
            role="user",
            manager_username=None,
            referred_by_username=inviter.username if inviter else None,
            max_active_employees=5,
        )
        db.add(db_user)
        if inviter and inviter_reward_available:
            inviter.credit = _safe_int(getattr(inviter, "credit", 0), 0) + INVITE_BONUS_CREDITS
            db.add(inviter)
        db.commit()
        db.refresh(db_user)
        if inviter and inviter_reward_available:
            db.refresh(inviter)
            _invalidate_auth_cache(inviter.username, inviter.tenant_id, settings)
            await credit_ws_manager.send_credit_update(int(inviter.id), int(inviter.credit or 0))
        return UserResponse(**_serialize_user(db_user, settings))

    try:
        existing_user = db.get_user_by_username(user_data.username)
        if existing_user:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already registered")
        if user_data.email:
            existing_email = db.get_user_by_email(user_data.email)
            if existing_email:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

        inviter = None
        if user_data.invite_code:
            inviter = db.get_user_by_username(user_data.invite_code)
            if not inviter:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite link is invalid")
            if inviter.get("username") == user_data.username:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invite link is invalid")
        inviter_reward_available = bool(inviter and _inviter_reward_available(db, settings, inviter.get("username") or ""))

        user = db.create_user(
            username=user_data.username,
            password_hash=get_password_hash(user_data.password),
            tenant_id=user_data.tenant_id,
            email=user_data.email,
            role="user",
            manager_username=None,
            referred_by_username=inviter.get("username") if inviter else None,
            max_active_employees=5,
            is_active=True,
        )
        if inviter:
            db.add_credit_to_user(int(user.get("id") or 0), INVITE_BONUS_CREDITS)
        if inviter and inviter_reward_available:
            db.add_credit_to_user(int(inviter.get("id") or 0), INVITE_BONUS_CREDITS)
        if inviter and inviter_reward_available:
            updated_user = db.get_user_by_username(user_data.username) or user
            updated_inviter = db.get_user_by_username(str(inviter.get("username") or "")) or inviter
            _invalidate_auth_cache(str(updated_inviter.get("username") or ""), updated_inviter.get("tenant_id"), settings)
            await credit_ws_manager.send_credit_update(int(updated_inviter.get("id") or 0), int(updated_inviter.get("credit") or 0))
            user = updated_user
        elif inviter:
            updated_user = db.get_user_by_username(user_data.username) or user
            user = updated_user
        return UserResponse(**_serialize_user(user, settings))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@router.post("/token", response_model=Token)
async def login(form_data: OAuth2PasswordRequestForm = Depends(), db=Depends(get_db)):
    logger = get_auth_logger()
    settings = get_settings()
    logger.info(f"User login request: {form_data.username}")

    user = authenticate_user(db, form_data.username, form_data.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect username or password")

    if not bool(_user_value(user, "is_active", True)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    access_token = create_access_token(
        data={"sub": _user_value(user, "username"), "tenant_id": _user_value(user, "tenant_id")},
        expires_delta=timedelta(minutes=10080),
    )
    return {"access_token": access_token, "token_type": "bearer"}


async def get_current_user(token: str = Depends(oauth2_scheme), db=Depends(get_db)):
    settings = get_settings()
    payload = verify_token(token)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    cache_id = cache_key("auth", "current_user", settings.storage_type, username)
    cached_user = cache_get_json(cache_id)
    if isinstance(cached_user, dict):
        return AuthenticatedUser(cached_user)

    if settings.is_database_storage():
        user = db.query(User).filter(User.username == username).first()
    else:
        user = db.get_user_by_username(username)

    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if not bool(_user_value(user, "is_active", True)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User is disabled")

    serialized_user = _serialize_auth_user_record(user, settings)
    cache_set_json(cache_id, serialized_user, ttl_seconds=10)
    return AuthenticatedUser(serialized_user)


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db=Depends(get_db),
):
    cache_id = cache_key("auth", "me", _get_username(current_user), _user_value(current_user, "tenant_id"), settings.storage_type)
    cached_payload = cache_get_json(cache_id)
    if isinstance(cached_payload, dict):
        return UserResponse(**cached_payload)

    payload = _serialize_user(current_user, settings)
    if payload["role"] == "employee" and payload.get("manager_username"):
        manager_username = payload.get("manager_username")
        if settings.is_database_storage():
            manager = db.query(User).filter(User.username == manager_username).first()
            if manager:
                payload["credit"] = _safe_int(getattr(manager, "credit", 0), 0)
        else:
            manager = db.get_user_by_username(manager_username)
            if manager:
                payload["credit"] = _safe_int(manager.get("credit", 0), 0)
    payload = _append_invite_summary(payload, db, settings)
    cache_set_json(cache_id, payload, ttl_seconds=5)
    return UserResponse(**payload)


def _get_manager_active_limit(manager: Any) -> int:
    return max(1, _safe_int(_user_value(manager, "max_active_employees", 5), 5))


def _count_active_employees(db, settings, manager_username: str) -> int:
    if settings.is_database_storage():
        return (
            db.query(User)
            .filter(
                User.role == "employee",
                User.manager_username == manager_username,
                User.is_active == True,  # noqa: E712
            )
            .count()
        )
    return db.count_active_employees_for_manager(manager_username)


def _list_employees(db, settings, manager_username: str):
    if settings.is_database_storage():
        return (
            db.query(User)
            .filter(User.role == "employee", User.manager_username == manager_username)
            .order_by(User.created_at.desc())
            .all()
        )
    return db.list_employees_for_manager(manager_username)


def _get_employee(db, settings, manager_username: str, employee_username: str):
    if settings.is_database_storage():
        return (
            db.query(User)
            .filter(
                User.username == employee_username,
                User.role == "employee",
                User.manager_username == manager_username,
            )
            .first()
        )
    employee = db.get_user_by_username(employee_username)
    if not employee:
        return None
    if _normalize_role(employee.get("role")) != "employee":
        return None
    if employee.get("manager_username") != manager_username:
        return None
    return employee


@router.get("/employees")
async def list_my_employees(
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db=Depends(get_db),
):
    if not _is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager only")
    manager_username = _get_username(current_user)
    employees = _list_employees(db, settings, manager_username)
    return {
        "manager": UserResponse(**_serialize_user(current_user, settings)),
        "employees": [UserResponse(**_serialize_user(item, settings)) for item in employees],
    }


@router.get("/employees/consumption")
async def list_employee_consumption(
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db=Depends(get_db),
):
    if not _is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager only")

    manager_username = _get_username(current_user)
    employees = _list_employees(db, settings, manager_username)
    employee_payload = [UserResponse(**_serialize_user(item, settings)).dict() for item in employees]
    if not employee_payload:
        return {"total_consumed": 0, "items": []}

    if settings.is_database_storage():
        id_to_username = {
            int(item["id"]): str(item["username"])
            for item in employee_payload
            if item.get("id") is not None
        }
        if not id_to_username:
            return {"total_consumed": 0, "items": []}
        rows = (
            db.query(
                BillingUsage.actor_user_id,
                func.coalesce(func.sum(BillingUsage.credits), 0),
            )
            .filter(
                BillingUsage.actor_user_id.in_(list(id_to_username.keys())),
                BillingUsage.status == "success",
            )
            .group_by(BillingUsage.actor_user_id)
            .all()
        )
        consumed_map = {id_to_username[int(row[0])]: int(row[1] or 0) for row in rows if row and row[0] is not None}
    else:
        usage_rows = db._load_data("billing_usage")
        id_to_username = {
            int(item["id"]): str(item["username"])
            for item in employee_payload
            if item.get("id") is not None
        }
        consumed_map: dict[str, int] = {}
        for record in usage_rows:
            if not isinstance(record, dict):
                continue
            if str(record.get("status") or "success") != "success":
                continue
            actor_id = record.get("actor_user_id")
            try:
                actor_id_int = int(actor_id)
            except (TypeError, ValueError):
                continue
            username = id_to_username.get(actor_id_int)
            if not username:
                continue
            credits = int(record.get("credits") or 0)
            consumed_map[username] = int(consumed_map.get(username, 0)) + max(0, credits)

    items = []
    total_consumed = 0
    for item in employee_payload:
        username = str(item.get("username") or "")
        consumed = int(consumed_map.get(username, 0))
        total_consumed += consumed
        items.append(
            {
                "id": item.get("id"),
                "username": username,
                "consumed_credit": consumed,
            }
        )
    return {"total_consumed": total_consumed, "items": items}


@router.post("/employees", response_model=UserResponse, status_code=201)
async def create_employee(
    payload: EmployeeCreatePayload,
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db=Depends(get_db),
):
    if not _is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager only")

    manager_username = _get_username(current_user).strip()
    if not _is_valid_email(manager_username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manager username must be an email")

    employee_id = payload.username.strip()
    if not employee_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee id is required")
    if _is_valid_email(employee_id) or "@" in employee_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee id must not be an email")

    manager_domain = manager_username.split("@", 1)[1].strip() if "@" in manager_username else ""
    if not manager_domain:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manager email domain is invalid")

    employee_username = f"{employee_id}@{manager_domain}"
    if len(employee_username) > 50:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Employee id is too long")

    active_limit = _get_manager_active_limit(current_user)
    active_count = _count_active_employees(db, settings, manager_username)
    if payload.is_active and active_count >= active_limit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Active employee limit exceeded ({active_limit})",
        )

    email = payload.email.strip() if payload.email else None
    if settings.is_database_storage():
        if db.query(User).filter(User.username == employee_username).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already registered")
        if email and db.query(User).filter(User.email == email).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

        employee = User(
            username=employee_username,
            email=email,
            hashed_password=get_password_hash(payload.password),
            tenant_id=_safe_int(_user_value(current_user, "tenant_id", 1), 1),
            is_active=payload.is_active,
            credit=0,
            group=_safe_int(_user_value(current_user, "group", settings.user_default_group), settings.user_default_group),
            role="employee",
            manager_username=manager_username,
            max_active_employees=0,
        )
        db.add(employee)
        db.commit()
        db.refresh(employee)
        _invalidate_auth_cache(manager_username, _user_value(current_user, "tenant_id", 1), settings)
        return UserResponse(**_serialize_user(employee, settings))

    if db.get_user_by_username(employee_username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already registered")
    if email and db.get_user_by_email(email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    employee = db.create_user(
        username=employee_username,
        password_hash=get_password_hash(payload.password),
        tenant_id=_safe_int(_user_value(current_user, "tenant_id", 1), 1),
        email=email,
        role="employee",
        manager_username=manager_username,
        max_active_employees=0,
        is_active=payload.is_active,
    )
    db.update_user_fields(employee_username, {"credit": 0, "group": _safe_int(_user_value(current_user, "group", settings.user_default_group), settings.user_default_group)})
    employee = db.get_user_by_username(employee_username) or employee
    _invalidate_auth_cache(manager_username, _user_value(current_user, "tenant_id", 1), settings)
    return UserResponse(**_serialize_user(employee, settings))


@router.patch("/employees/{employee_username}", response_model=UserResponse)
async def update_employee_status(
    employee_username: str,
    payload: EmployeeStatusPayload,
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db=Depends(get_db),
):
    if not _is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager only")

    manager_username = _get_username(current_user)
    employee = _get_employee(db, settings, manager_username, employee_username)
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    if payload.is_active:
        active_limit = _get_manager_active_limit(current_user)
        active_count = _count_active_employees(db, settings, manager_username)
        already_active = bool(_user_value(employee, "is_active", False))
        if not already_active and active_count >= active_limit:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Active employee limit exceeded ({active_limit})",
            )

    if settings.is_database_storage():
        employee.is_active = payload.is_active
        db.add(employee)
        db.commit()
        db.refresh(employee)
        _invalidate_auth_cache(employee_username, _user_value(current_user, "tenant_id", 1), settings)
        return UserResponse(**_serialize_user(employee, settings))

    updated = db.update_user_fields(employee_username, {"is_active": payload.is_active})
    if not updated:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update employee")
    _invalidate_auth_cache(employee_username, _user_value(current_user, "tenant_id", 1), settings)
    return UserResponse(**_serialize_user(updated, settings))


@router.post("/employees/{employee_username}/password")
async def reset_employee_password(
    employee_username: str,
    payload: EmployeePasswordPayload,
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db=Depends(get_db),
):
    if not _is_manager(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Manager only")

    manager_username = _get_username(current_user)
    employee = _get_employee(db, settings, manager_username, employee_username)
    if not employee:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")

    if settings.is_database_storage():
        employee.hashed_password = get_password_hash(payload.new_password)
        db.add(employee)
        db.commit()
        _invalidate_auth_cache(employee_username, _user_value(current_user, "tenant_id", 1), settings)
        return {"username": employee_username, "password": payload.new_password}

    updated = db.update_user_password(employee_username, get_password_hash(payload.new_password))
    if not updated:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update password")
    _invalidate_auth_cache(employee_username, _user_value(current_user, "tenant_id", 1), settings)
    return {"username": employee_username, "password": payload.new_password}


@router.post("/change-password")
async def change_password(
    payload: ChangePasswordPayload,
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db=Depends(get_db),
):
    if not payload.current_password or not payload.new_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing password fields")
    if len(payload.new_password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password must be at least 6 characters")

    if settings.is_database_storage():
        username = _get_username(current_user)
        user = db.query(User).filter(User.username == username).first()
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        if not verify_password(payload.current_password, user.hashed_password):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect current password")
        user.hashed_password = get_password_hash(payload.new_password)
        db.add(user)
        db.commit()
    else:
        if not verify_password(payload.current_password, current_user["hashed_password"]):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect current password")
        updated = db.update_user_password(current_user["username"], get_password_hash(payload.new_password))
        if not updated:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update password")

    _invalidate_auth_cache(_get_username(current_user), _user_value(current_user, "tenant_id", 1), settings)

    return {"status": "ok"}
