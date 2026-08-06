from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.database import UsageDailyStat, get_db
from ..routers.auth import get_current_user
from ..services.config import get_settings

router = APIRouter()


class UsageEventPayload(BaseModel):
    sessionId: str
    eventType: Literal["start", "heartbeat", "route_change", "end"]
    pagePath: str
    sessionStartedAt: str
    eventAt: str
    deltaMs: int


def _value(user, key: str, default=None):
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _ensure_admin(current_user):
    if _value(current_user, "group") != 1000:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin only")


def _parse_dt(raw: str | None, *, fallback_now: bool) -> datetime | None:
    if not raw:
        return datetime.now(timezone.utc) if fallback_now else None
    value = raw.strip()
    if not value:
        return datetime.now(timezone.utc) if fallback_now else None
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed
    except Exception:
        return datetime.now(timezone.utc) if fallback_now else None


def _to_utc_aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_db_datetime(value: datetime | None) -> datetime | None:
    """
    SQLite often returns naive datetimes even for timezone-aware columns.
    Normalize all DB values to UTC-aware timestamps before comparing them.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _duration_readable(total_ms: int) -> str:
    seconds = max(0, total_ms // 1000)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours}h {minutes}m {secs}s"


@router.post("/analytics/usage")
async def ingest_usage_event(
    payload: UsageEventPayload,
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db: Session = Depends(get_db),
):
    if not settings.is_database_storage():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Usage analytics persistence requires SQL database storage",
        )

    tenant_id = _value(current_user, "tenant_id")
    user_id = _value(current_user, "id")
    username = _value(current_user, "username")

    if tenant_id is None or user_id is None or not username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid user context")

    session_id = (payload.sessionId or "").strip()
    if not session_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="sessionId is required")

    delta_ms = max(0, min(int(payload.deltaMs or 0), 60 * 60 * 1000))
    event_at = _parse_dt(payload.eventAt, fallback_now=True)
    event_at_utc = _to_utc_aware(event_at) or datetime.now(timezone.utc)
    usage_date = event_at_utc.date()

    def _upsert_daily_stat():
        record = (
            db.query(UsageDailyStat)
            .filter(
                UsageDailyStat.tenant_id == int(tenant_id),
                UsageDailyStat.user_id == int(user_id),
                UsageDailyStat.usage_date == usage_date,
            )
            .first()
        )
        if not record:
            record = UsageDailyStat(
                tenant_id=int(tenant_id),
                user_id=int(user_id),
                username=str(username),
                usage_date=usage_date,
                total_online_ms=0,
                event_count=0,
                session_count=0,
                last_session_id=None,
                first_seen_at=event_at_utc,
                last_seen_at=event_at_utc,
            )
            db.add(record)

        record.username = str(username)
        record.total_online_ms = int(record.total_online_ms or 0) + delta_ms
        record.event_count = int(record.event_count or 0) + 1
        if session_id and record.last_session_id != session_id:
            record.session_count = int(record.session_count or 0) + 1
            record.last_session_id = session_id

        first_seen = _normalize_db_datetime(record.first_seen_at)
        if first_seen is None or event_at_utc < first_seen:
            record.first_seen_at = event_at_utc

        last_seen = _normalize_db_datetime(record.last_seen_at)
        if last_seen is None or event_at_utc > last_seen:
            record.last_seen_at = event_at_utc

    _upsert_daily_stat()
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        _upsert_daily_stat()
        db.commit()

    return {"ok": True}


@router.get("/admin/stats/usage")
async def get_usage_stats(
    from_dt: str | None = Query(default=None, alias="from"),
    to_dt: str | None = Query(default=None, alias="to"),
    username: str | None = Query(default=None),
    user_id: int | None = Query(default=None, alias="userId"),
    current_user=Depends(get_current_user),
    settings=Depends(get_settings),
    db: Session = Depends(get_db),
):
    _ensure_admin(current_user)

    if not settings.is_database_storage():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Usage analytics requires SQL database storage",
        )

    tenant_id = _value(current_user, "tenant_id")
    if tenant_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tenant context")

    now = datetime.now(timezone.utc)
    start = _parse_dt(from_dt, fallback_now=False) or (now - timedelta(days=7))
    end = _parse_dt(to_dt, fallback_now=False) or now
    if start > end:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid from/to range")

    start_date = start.astimezone(timezone.utc).date()
    end_date = end.astimezone(timezone.utc).date()

    query = db.query(UsageDailyStat).filter(
        UsageDailyStat.tenant_id == int(tenant_id),
        UsageDailyStat.usage_date >= start_date,
        UsageDailyStat.usage_date <= end_date,
    )

    username_filter = (username or "").strip()
    if username_filter:
        query = query.filter(UsageDailyStat.username == username_filter)
    if user_id is not None:
        query = query.filter(UsageDailyStat.user_id == user_id)

    rows = query.order_by(UsageDailyStat.usage_date.asc(), UsageDailyStat.user_id.asc()).all()

    by_user = {}
    by_day = {}
    total_online_ms = 0
    total_events = 0
    total_sessions = 0
    seen_users = set()

    for row in rows:
        key_user = f"{row.user_id}:{row.username}"
        seen_users.add(key_user)
        total_ms = max(0, int(row.total_online_ms or 0))
        event_count = max(0, int(row.event_count or 0))
        session_count = max(0, int(row.session_count or 0))
        total_online_ms += total_ms
        total_events += event_count
        total_sessions += session_count

        user_row = by_user.get(key_user)
        if not user_row:
            user_row = {
                "userId": row.user_id,
                "username": row.username,
                "totalOnlineMs": 0,
                "eventCount": 0,
                "sessions": 0,
                "lastSeenAt": row.last_seen_at.isoformat() if row.last_seen_at else "",
            }
            by_user[key_user] = user_row
        user_row["totalOnlineMs"] += total_ms
        user_row["eventCount"] += event_count
        user_row["sessions"] += session_count
        last_seen_iso = row.last_seen_at.isoformat() if row.last_seen_at else ""
        if last_seen_iso and (not user_row["lastSeenAt"] or last_seen_iso > user_row["lastSeenAt"]):
            user_row["lastSeenAt"] = last_seen_iso

        day_key = row.usage_date.isoformat()
        day_row = by_day.get(day_key)
        if not day_row:
            day_row = {"date": day_key, "totalOnlineMs": 0, "eventCount": 0, "users": set()}
            by_day[day_key] = day_row
        day_row["totalOnlineMs"] += total_ms
        day_row["eventCount"] += event_count
        day_row["users"].add(key_user)

    by_user_rows = []
    for row in by_user.values():
        total_ms = int(row["totalOnlineMs"])
        by_user_rows.append(
            {
                "userId": row["userId"],
                "username": row["username"],
                "totalOnlineMs": total_ms,
                "totalOnlineReadable": _duration_readable(total_ms),
                "eventCount": row["eventCount"],
                "sessions": row["sessions"],
                "lastSeenAt": row["lastSeenAt"],
            }
        )
    by_user_rows.sort(key=lambda item: item["totalOnlineMs"], reverse=True)

    by_day_rows = []
    for row in by_day.values():
        total_ms = int(row["totalOnlineMs"])
        by_day_rows.append(
            {
                "date": row["date"],
                "totalOnlineMs": total_ms,
                "totalOnlineReadable": _duration_readable(total_ms),
                "eventCount": row["eventCount"],
                "activeUsers": len(row["users"]),
            }
        )
    by_day_rows.sort(key=lambda item: item["date"])

    return {
        "range": {
            "from": start.isoformat(),
            "to": end.isoformat(),
        },
        "filters": {
            "username": username_filter or None,
            "userId": user_id,
        },
        "overview": {
            "totalOnlineMs": total_online_ms,
            "totalOnlineReadable": _duration_readable(total_online_ms),
            "totalSessions": total_sessions,
            "activeUsers": len(seen_users),
            "totalEvents": total_events,
        },
        "byUser": by_user_rows,
        "byDay": by_day_rows,
        "sessions": [],
    }
