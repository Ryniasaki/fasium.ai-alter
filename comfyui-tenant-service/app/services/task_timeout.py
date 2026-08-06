"""Helpers for deciding when a task has exceeded its allowed runtime."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Optional


def _coerce_datetime(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        if text.endswith("Z"):
            text = f"{text[:-1]}+00:00"
        try:
            return datetime.fromisoformat(text)
        except ValueError:
            return None
    return None


def is_task_timed_out(created_at: Any, timeout_seconds: float, now: Optional[datetime] = None) -> bool:
    created_dt = _coerce_datetime(created_at)
    if created_dt is None:
        return False

    current_dt = now or datetime.utcnow()
    if current_dt.tzinfo is not None:
        current_dt = current_dt.replace(tzinfo=None)
    if created_dt.tzinfo is not None:
        created_dt = created_dt.replace(tzinfo=None)

    return current_dt - created_dt >= timedelta(seconds=float(timeout_seconds))
