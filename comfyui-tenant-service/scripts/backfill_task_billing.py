from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.models.database import SessionLocal, BillingUsage, TenantTaskRecord, User
from app.services.config import get_settings
from app.services.json_storage import JSONStorage
from app.services.task_record_service import task_record_service


def _parse_dt(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
        except ValueError:
            return None
    return None


def _has_billing(result_data: Any) -> bool:
    if isinstance(result_data, dict):
        return "billing" in result_data
    if isinstance(result_data, str):
        try:
            parsed = result_data.strip()
            if not parsed:
                return False
            import json

            payload = json.loads(parsed)
            return isinstance(payload, dict) and "billing" in payload
        except Exception:
            return False
    return False


def _build_billing_payload(entry: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "credits": entry.get("credits", 0),
        "endpoint": entry.get("endpoint"),
        "model": entry.get("model"),
        "status": entry.get("status") or "success",
        "charged_at": entry.get("created_at"),
        "balance_before": entry.get("balance_before"),
        "balance_after": entry.get("balance_after"),
    }


def _match_entries(
    tasks: List[Dict[str, Any]],
    billing_entries: List[Dict[str, Any]],
    window: timedelta,
) -> List[Tuple[str, Dict[str, Any]]]:
    # tasks sorted by created_at
    assignments: List[Tuple[str, Dict[str, Any]]] = []
    used = set()

    billing_entries = [entry for entry in billing_entries if entry.get("created_at_dt")]
    billing_entries.sort(key=lambda item: item["created_at_dt"])
    times = [entry["created_at_dt"] for entry in billing_entries]

    from bisect import bisect_left, bisect_right

    for task in tasks:
        task_id = task["tenant_task_id"]
        if _has_billing(task.get("result_data")):
            continue
        task_time = task.get("created_at_dt")
        if not task_time:
            continue
        left = bisect_left(times, task_time - window)
        right = bisect_right(times, task_time + window)
        best_idx = None
        best_delta = None
        for idx in range(left, right):
            if idx in used:
                continue
            delta = abs((times[idx] - task_time).total_seconds())
            if best_delta is None or delta < best_delta:
                best_delta = delta
                best_idx = idx
        if best_idx is None:
            continue
        used.add(best_idx)
        assignments.append((task_id, billing_entries[best_idx]))

    return assignments


def _load_json_users(storage: JSONStorage) -> Dict[int, str]:
    users = storage._load_data("users")
    mapping: Dict[int, str] = {}
    for user in users:
        try:
            user_id = int(user.get("id"))
        except Exception:
            continue
        username = user.get("username")
        if isinstance(username, str) and username:
            mapping[user_id] = username
    return mapping


def _backfill_json(window_minutes: int, dry_run: bool, limit: Optional[int]) -> int:
    storage = JSONStorage()
    task_records = storage._load_data("task_records")
    billing_usage = storage._load_data("billing_usage")
    user_map = _load_json_users(storage)

    billing_by_user: Dict[str, List[Dict[str, Any]]] = {}
    for entry in billing_usage:
        try:
            user_id = int(entry.get("user_id"))
        except Exception:
            continue
        username = user_map.get(user_id)
        if not username:
            continue
        created_at = _parse_dt(entry.get("created_at"))
        if not created_at:
            continue
        normalized = dict(entry)
        normalized["created_at_dt"] = created_at
        billing_by_user.setdefault(username, []).append(normalized)

    tasks_by_user: Dict[str, List[Dict[str, Any]]] = {}
    for task in task_records:
        username = task.get("user_id")
        if not isinstance(username, str) or not username:
            continue
        created_at = _parse_dt(task.get("created_at"))
        normalized = dict(task)
        normalized["created_at_dt"] = created_at
        tasks_by_user.setdefault(username, []).append(normalized)

    total_updated = 0
    window = timedelta(minutes=window_minutes)
    for username, tasks in tasks_by_user.items():
        billing_entries = billing_by_user.get(username, [])
        if not billing_entries:
            continue
        tasks.sort(key=lambda item: item.get("created_at_dt") or datetime.min.replace(tzinfo=timezone.utc))
        assignments = _match_entries(tasks, billing_entries, window)
        for tenant_task_id, billing_entry in assignments:
            if limit is not None and total_updated >= limit:
                return total_updated
            if not dry_run:
                storage.update_task_billing(tenant_task_id, _build_billing_payload(billing_entry))
            total_updated += 1
    return total_updated


def _backfill_db(window_minutes: int, dry_run: bool, limit: Optional[int]) -> int:
    if SessionLocal is None:
        return 0
    session = SessionLocal()
    try:
        user_rows = session.query(User.id, User.username).all()
        user_map = {int(row[0]): row[1] for row in user_rows if row and row[1]}

        billing_by_user: Dict[str, List[Dict[str, Any]]] = {}
        for entry in session.query(BillingUsage).all():
            username = user_map.get(int(entry.user_id)) if entry.user_id is not None else None
            if not username:
                continue
            created_at = _parse_dt(entry.created_at)
            if not created_at:
                continue
            billing_by_user.setdefault(username, []).append(
                {
                    "credits": entry.credits,
                    "endpoint": entry.endpoint,
                    "model": entry.model,
                    "status": entry.status,
                    "balance_before": entry.balance_before,
                    "balance_after": entry.balance_after,
                    "created_at": entry.created_at.isoformat() if entry.created_at else None,
                    "created_at_dt": created_at,
                }
            )

        tasks = session.query(TenantTaskRecord).all()
        tasks_by_user: Dict[str, List[Dict[str, Any]]] = {}
        for task in tasks:
            username = task.user_id
            if not username:
                continue
            created_at = _parse_dt(task.created_at)
            tasks_by_user.setdefault(username, []).append(
                {
                    "tenant_task_id": task.tenant_task_id,
                    "result_data": task.result_data,
                    "created_at_dt": created_at,
                }
            )

        total_updated = 0
        window = timedelta(minutes=window_minutes)
        for username, task_list in tasks_by_user.items():
            billing_entries = billing_by_user.get(username, [])
            if not billing_entries:
                continue
            task_list.sort(key=lambda item: item.get("created_at_dt") or datetime.min.replace(tzinfo=timezone.utc))
            assignments = _match_entries(task_list, billing_entries, window)
            for tenant_task_id, billing_entry in assignments:
                if limit is not None and total_updated >= limit:
                    return total_updated
                if not dry_run:
                    task_record_service.update_task_billing(
                        tenant_task_id,
                        _build_billing_payload(billing_entry),
                        session,
                    )
                total_updated += 1
        return total_updated
    finally:
        session.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill billing info into task records.")
    parser.add_argument("--window-minutes", type=int, default=10, help="Match window in minutes.")
    parser.add_argument("--dry-run", action="store_true", help="Do not write changes.")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of updates.")
    args = parser.parse_args()

    settings = get_settings()
    if settings.is_json_storage():
        updated = _backfill_json(args.window_minutes, args.dry_run, args.limit)
    else:
        updated = _backfill_db(args.window_minutes, args.dry_run, args.limit)

    print(f"Backfill complete. Updated {updated} task records.")


if __name__ == "__main__":
    main()
