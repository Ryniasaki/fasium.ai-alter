from datetime import datetime, timedelta
from typing import Dict, Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from ..models.database import User, Tenant
from .config import get_settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    settings = get_settings()
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)
    to_encode.update({"exp": expire})

    signing_algorithm = settings.get_jwt_signing_algorithm()
    if signing_algorithm == "RS256":
        private_key = settings.get_jwt_private_key_pem()
        if private_key:
            return jwt.encode(
                to_encode,
                private_key,
                algorithm="RS256",
                headers={"kid": settings.jwt_key_id},
            )
        if not settings.jwt_allow_hs256_fallback:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="JWT RS256 private key is missing",
            )

    # Fallback/rollback path to keep service available during migration.
    return jwt.encode(
        to_encode,
        settings.get_hs256_legacy_secret(),
        algorithm="HS256",
    )


def _get_unverified_header(token: str) -> Dict[str, str]:
    try:
        header = jwt.get_unverified_header(token)
        if isinstance(header, dict):
            return {str(k): str(v) for k, v in header.items()}
    except JWTError:
        pass
    return {}


def verify_token(token: str) -> dict:
    settings = get_settings()
    verify_algorithms = settings.get_jwt_verify_algorithms()
    header = _get_unverified_header(token)
    token_alg = header.get("alg", "").upper()
    token_kid = header.get("kid")

    last_error: Optional[Exception] = None

    ordered_algs = [token_alg] if token_alg else []
    ordered_algs.extend([alg for alg in verify_algorithms if alg not in ordered_algs])

    for algorithm in ordered_algs:
        if algorithm == "RS256":
            public_keys = settings.get_jwt_public_keys()
            if not public_keys:
                continue

            candidate_keys = []
            if token_kid and token_kid in public_keys:
                candidate_keys.append(public_keys[token_kid])
            candidate_keys.extend([value for kid, value in public_keys.items() if kid != token_kid])

            for public_key in candidate_keys:
                try:
                    return jwt.decode(token, public_key, algorithms=["RS256"])
                except JWTError as exc:
                    last_error = exc

        if algorithm == "HS256":
            if not settings.jwt_allow_hs256_fallback:
                continue
            try:
                return jwt.decode(token, settings.get_hs256_legacy_secret(), algorithms=["HS256"])
            except JWTError as exc:
                last_error = exc

    # Last-resort backward compatibility if old ALGORITHM setting is still used.
    try:
        return jwt.decode(
            token,
            settings.get_effective_secret_key(),
            algorithms=[settings.algorithm],
        )
    except JWTError as exc:
        last_error = exc

    if last_error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid token",
    )


def authenticate_user(db, username: str, password: str):
    """认证用户，支持数据库和 JSON 存储模式"""
    settings = get_settings()

    if settings.is_database_storage():
        user = db.query(User).filter(User.username == username).first()
        if not user:
            return None
        if not bool(getattr(user, "is_active", True)):
            return None
        if not verify_password(password, user.hashed_password):
            return None
        return user
    else:
        user = db.get_user_by_username(username)
        if not user:
            return None
        if not bool(user.get("is_active", True)):
            return None
        if not verify_password(password, user["hashed_password"]):
            return None
        return user


def get_tenant_by_api_key(db, api_key: str):
    """根据 API key 获取租户，支持数据库和 JSON 存储模式"""
    settings = get_settings()

    if settings.is_database_storage():
        return (
            db.query(Tenant)
            .filter(Tenant.api_key == api_key, Tenant.is_active == True)
            .first()
        )
    else:
        return db.get_tenant_by_api_key(api_key)
