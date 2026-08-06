import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Tuple

from sqlalchemy import func

from ..models.database import FeedbackRecord, User
from ..services.config import get_settings

FEEDBACK_MONTHLY_REWARD_LIMIT = 3
FEEDBACK_REWARD_POINTS = 500
CHINA_TZ = timezone(timedelta(hours=8))


def _user_value(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _now_utc_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _china_month_window_utc(now_utc: datetime | None = None) -> Tuple[datetime, datetime]:
    current_utc = now_utc or _now_utc_naive()
    current_utc_aware = current_utc.replace(tzinfo=timezone.utc)
    current_china = current_utc_aware.astimezone(CHINA_TZ)
    month_start_china = current_china.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if month_start_china.month == 12:
        next_month_china = month_start_china.replace(year=month_start_china.year + 1, month=1)
    else:
        next_month_china = month_start_china.replace(month=month_start_china.month + 1)
    return (
        month_start_china.astimezone(timezone.utc).replace(tzinfo=None),
        next_month_china.astimezone(timezone.utc).replace(tzinfo=None),
    )


class FeedbackService:
    def __init__(self):
        self.settings = get_settings()

    def _is_admin_user(self, current_user: Any) -> bool:
        return int(_user_value(current_user, "group", 0) or 0) == 1000

    def _serialize_datetime(self, value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()
        return value

    def _serialize_record(self, record: Any) -> Dict[str, Any]:
        if isinstance(record, dict):
            attachments = record.get("attachments")
            if isinstance(attachments, str):
                try:
                    attachments = json.loads(attachments)
                except (TypeError, ValueError, json.JSONDecodeError):
                    attachments = []
            reward_points = 0
            try:
                reward_points = int(record.get("reward_points") or 0)
            except (TypeError, ValueError):
                reward_points = 0
            rewarded_at = record.get("rewarded_at")
            created_at = record.get("created_at")
            return {
                "id": record.get("id"),
                "tenant_id": record.get("tenant_id"),
                "user_id": record.get("user_id"),
                "username": record.get("username"),
                "content": record.get("content"),
                "attachments": attachments if isinstance(attachments, list) else [],
                "reward_points": reward_points,
                "rewarded_at": self._serialize_datetime(rewarded_at),
                "reward_granted": reward_points > 0,
                "created_at": self._serialize_datetime(created_at),
            }

        attachments_raw = getattr(record, "attachments", None)
        attachments: List[Dict[str, Any]] = []
        if isinstance(attachments_raw, str):
            try:
                parsed = json.loads(attachments_raw)
                if isinstance(parsed, list):
                    attachments = parsed
            except (TypeError, ValueError, json.JSONDecodeError):
                attachments = []
        elif isinstance(attachments_raw, list):
            attachments = attachments_raw

        reward_points = 0
        try:
            reward_points = int(getattr(record, "reward_points", 0) or 0)
        except (TypeError, ValueError):
            reward_points = 0

        rewarded_at = getattr(record, "rewarded_at", None)
        created_at = getattr(record, "created_at", None)
        return {
            "id": getattr(record, "id", None),
            "tenant_id": getattr(record, "tenant_id", None),
            "user_id": getattr(record, "user_id", None),
            "username": getattr(record, "username", None),
            "content": getattr(record, "content", None),
            "attachments": attachments,
            "reward_points": reward_points,
            "rewarded_at": self._serialize_datetime(rewarded_at),
            "reward_granted": reward_points > 0,
            "created_at": self._serialize_datetime(created_at),
        }

    def count_rewarded_feedback_this_month(self, db: Any, current_user: Any) -> int:
        user_id = int(_user_value(current_user, "id", 0) or 0)
        window_start, window_end = _china_month_window_utc()

        if self.settings.is_database_storage():
            count = (
                db.query(func.count(FeedbackRecord.id))
                .filter(
                    FeedbackRecord.user_id == user_id,
                    FeedbackRecord.reward_points > 0,
                    FeedbackRecord.created_at >= window_start,
                    FeedbackRecord.created_at < window_end,
                )
                .scalar()
            )
            return int(count or 0)

        return int(db.count_rewarded_feedback_by_user_for_window(user_id, window_start, window_end))

    def get_monthly_reward_status(self, db: Any, current_user: Any) -> Dict[str, int]:
        rewarded_this_month = self.count_rewarded_feedback_this_month(db, current_user)
        remaining_reward_slots = max(0, FEEDBACK_MONTHLY_REWARD_LIMIT - rewarded_this_month)
        return {
            "monthly_reward_limit": FEEDBACK_MONTHLY_REWARD_LIMIT,
            "reward_points_per_feedback": FEEDBACK_REWARD_POINTS,
            "rewarded_this_month": rewarded_this_month,
            "remaining_reward_slots": remaining_reward_slots,
        }

    def list_my_feedback(self, db: Any, current_user: Any, limit: int | None = None) -> List[Dict[str, Any]]:
        user_id = int(_user_value(current_user, "id", 0) or 0)

        if self.settings.is_database_storage():
            query = (
                db.query(FeedbackRecord)
                .filter(FeedbackRecord.user_id == user_id)
                .order_by(FeedbackRecord.created_at.desc(), FeedbackRecord.id.desc())
            )
            if limit is not None:
                query = query.limit(limit)
            records = query.all()
            return [self._serialize_record(record) for record in records]

        return [self._serialize_record(record) for record in db.list_feedback_by_user(user_id=user_id, limit=limit)]

    def list_all_feedback(self, db: Any, limit: int | None = None) -> List[Dict[str, Any]]:
        if self.settings.is_database_storage():
            query = db.query(FeedbackRecord).order_by(FeedbackRecord.created_at.desc(), FeedbackRecord.id.desc())
            if limit is not None:
                query = query.limit(limit)
            records = query.all()
            return [self._serialize_record(record) for record in records]

        return [self._serialize_record(record) for record in db.list_feedback_records(limit=limit)]

    def list_visible_feedback(self, db: Any, current_user: Any, limit: int | None = None) -> List[Dict[str, Any]]:
        if self._is_admin_user(current_user):
            return self.list_all_feedback(db, limit=limit)
        return self.list_my_feedback(db, current_user, limit=limit)

    def create_feedback(
        self,
        db: Any,
        current_user: Any,
        content: str,
        attachments: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        user_id = int(_user_value(current_user, "id", 0) or 0)
        tenant_id = int(_user_value(current_user, "tenant_id", 1) or 1)
        username = str(_user_value(current_user, "username", "") or "")

        normalized_content = str(content or "").strip()
        if not normalized_content:
            raise ValueError("反馈内容不能为空")

        reward_status = self.get_monthly_reward_status(db, current_user)
        reward_points = FEEDBACK_REWARD_POINTS if reward_status["rewarded_this_month"] < FEEDBACK_MONTHLY_REWARD_LIMIT else 0
        rewarded_at = datetime.now(timezone.utc) if reward_points > 0 else None

        if self.settings.is_database_storage():
            try:
                record = FeedbackRecord(
                    tenant_id=tenant_id,
                    user_id=user_id,
                    username=username,
                    content=normalized_content,
                    attachments=json.dumps(attachments or [], ensure_ascii=False),
                    reward_points=reward_points,
                    rewarded_at=rewarded_at,
                )
                db.add(record)

                if reward_points > 0:
                    user = db.query(User).filter(User.id == user_id).first()
                    if user is None:
                        raise ValueError("User not found")
                    user.credit = int(user.credit or 0) + reward_points
                    db.add(user)

                db.commit()
                db.refresh(record)
                return self._serialize_record(record)
            except Exception:
                rollback = getattr(db, "rollback", None)
                if callable(rollback):
                    rollback()
                raise

        record = db.create_feedback(
            tenant_id=tenant_id,
            user_id=user_id,
            username=username,
            content=normalized_content,
            attachments=attachments or [],
            reward_points=reward_points,
            rewarded_at=rewarded_at,
        )
        return self._serialize_record(record)


feedback_service = FeedbackService()
