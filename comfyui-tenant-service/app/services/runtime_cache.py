from __future__ import annotations

import json
import threading
import time
from typing import Any, Optional

try:
    from redis import Redis
except Exception:  # pragma: no cover - optional dependency for local/dev runs
    Redis = None

from .config import get_settings

_REDIS_CLIENT: Optional[Redis] = None
_REDIS_DISABLED = False
_LOCK = threading.RLock()
_MEMORY_CACHE: dict[str, tuple[float, str]] = {}
_REDIS_CONNECT_TIMEOUT_SECONDS = 1
_REDIS_SOCKET_TIMEOUT_SECONDS = 1


def cache_key(*parts: Any) -> str:
    normalized_parts = []
    for part in parts:
        if part is None:
            continue
        value = str(part).strip()
        if value:
            normalized_parts.append(value)
    return ":".join(normalized_parts)


def _get_redis_client() -> Optional[Redis]:
    global _REDIS_CLIENT, _REDIS_DISABLED

    if Redis is None:
        return None

    if _REDIS_DISABLED:
        return None

    if _REDIS_CLIENT is not None:
        return _REDIS_CLIENT

    try:
        settings = get_settings()
        _REDIS_CLIENT = Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=_REDIS_CONNECT_TIMEOUT_SECONDS,
            socket_timeout=_REDIS_SOCKET_TIMEOUT_SECONDS,
            health_check_interval=0,
            retry_on_timeout=False,
        )
        _REDIS_CLIENT.ping()
        return _REDIS_CLIENT
    except Exception:
        _REDIS_DISABLED = True
        return None


def _memory_get(key: str) -> Optional[str]:
    now = time.time()
    with _LOCK:
        entry = _MEMORY_CACHE.get(key)
        if not entry:
            return None
        expires_at, raw_value = entry
        if expires_at and expires_at < now:
            _MEMORY_CACHE.pop(key, None)
            return None
        return raw_value


def _memory_set(key: str, raw_value: str, ttl_seconds: int) -> None:
    expires_at = time.time() + max(1, int(ttl_seconds))
    with _LOCK:
        _MEMORY_CACHE[key] = (expires_at, raw_value)


def _memory_delete(key: str) -> None:
    with _LOCK:
        _MEMORY_CACHE.pop(key, None)


def cache_get_json(key: str) -> Any:
    client = _get_redis_client()
    if client is not None:
        try:
            raw_value = client.get(key)
            if raw_value is None:
                return None
            return json.loads(raw_value)
        except Exception:
            pass

    raw_value = _memory_get(key)
    if raw_value is None:
        return None
    try:
        return json.loads(raw_value)
    except Exception:
        return None


def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    raw_value = json.dumps(value, ensure_ascii=False, default=str)
    client = _get_redis_client()
    if client is not None:
        try:
            client.setex(key, max(1, int(ttl_seconds)), raw_value)
            return
        except Exception:
            pass

    _memory_set(key, raw_value, ttl_seconds)


def cache_delete(key: str) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            client.delete(key)
        except Exception:
            pass

    _memory_delete(key)


def cache_delete_prefix(prefix: str) -> None:
    client = _get_redis_client()
    if client is not None:
        try:
            pattern = f"{prefix}*"
            for match in client.scan_iter(match=pattern):
                client.delete(match)
            return
        except Exception:
            pass

    with _LOCK:
        keys = [key for key in _MEMORY_CACHE if key.startswith(prefix)]
        for key in keys:
            _MEMORY_CACHE.pop(key, None)
