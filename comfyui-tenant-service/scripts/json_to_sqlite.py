#!/usr/bin/env python
"""
Utility to migrate existing JSON storage data into the SQLite database.

Usage:
    python scripts/json_to_sqlite.py --json-path ./database --sqlite-path ./tenant_service.db --force
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Optional


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Migrate tenant JSON storage data into SQLite.")
    parser.add_argument(
        "--json-path",
        type=Path,
        help="Source JSON storage directory (defaults to JSON_STORAGE_PATH/.env value).",
    )
    parser.add_argument(
        "--sqlite-path",
        type=Path,
        help="Destination SQLite file path (defaults to SQLITE_PATH/.env value).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite the existing SQLite database file if it already exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not write anything; just report what would happen.",
    )
    return parser.parse_args()


def _parse_datetime(value: Optional[str], aware: bool = False) -> Optional[datetime]:
    if not value:
        return None

    cleaned = value.strip()
    if cleaned.endswith("Z"):
        cleaned = cleaned[:-1] + "+00:00"

    for candidate in (cleaned, value):
        try:
            dt = datetime.fromisoformat(candidate)
            break
        except ValueError:
            dt = None
    if dt is None:
        return None

    if aware:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    if dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def _dump_json(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(value)


def load_json_records(base_dir: Path, name: str) -> Iterable[Dict[str, Any]]:
    file_path = base_dir / f"{name}.json"
    if not file_path.exists():
        return []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return list(data.values())
        return []
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Failed to parse {file_path}: {exc}") from exc


def ensure_environment(json_path: Path | None, sqlite_path: Path | None) -> tuple[Path, Path]:
    if json_path:
        os.environ["JSON_STORAGE_PATH"] = str(json_path.resolve())
    if sqlite_path:
        os.environ["SQLITE_PATH"] = str(sqlite_path.resolve())
    os.environ["STORAGE_TYPE"] = "sqlite"

    from app.services.config import get_settings  # pylint: disable=import-outside-toplevel

    settings = get_settings()
    resolved_json = Path(settings.json_storage_path).resolve()
    resolved_sqlite = Path(settings.sqlite_path).resolve()
    return resolved_json, resolved_sqlite


def main() -> int:
    args = parse_args()
    json_dir, sqlite_path = ensure_environment(args.json_path, args.sqlite_path)

    if not json_dir.exists():
        print(f"[!] JSON storage directory not found: {json_dir}", file=sys.stderr)
        return 1

    if sqlite_path.exists():
        if not args.force:
            print(
                f"[!] SQLite database already exists at {sqlite_path}. Use --force to overwrite.",
                file=sys.stderr,
            )
            return 1
        if not args.dry_run:
            sqlite_path.unlink()

    if not args.dry_run:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)

    # Import SQLAlchemy primitives after env vars are set.
    from app.models.database import (  # pylint: disable=import-outside-toplevel
        APIUsage,
        BillingUsage,
        ModelBillingRate,
        SessionLocal,
        Tenant,
        TenantTaskRecord,
        User,
        Base,
        engine,
    )
    from app.services.config import get_settings  # pylint: disable=import-outside-toplevel

    if not args.dry_run:
        Base.metadata.create_all(bind=engine)
        if engine is not None:
            from app.models.database import _ensure_user_columns  # pylint: disable=import-outside-toplevel

            _ensure_user_columns(engine)

    settings = get_settings()

    tenants_raw = list(load_json_records(json_dir, "tenants"))
    users_raw = list(load_json_records(json_dir, "users"))
    usage_raw = list(load_json_records(json_dir, "api_usage"))
    billing_usage_raw = list(load_json_records(json_dir, "billing_usage"))
    billing_rates_raw = list(load_json_records(json_dir, "model_billing_rates"))
    tasks_raw = list(load_json_records(json_dir, "task_records"))

    print(f"[+] Loaded {len(tenants_raw)} tenants, {len(users_raw)} users, "
          f"{len(usage_raw)} usage records, {len(billing_usage_raw)} billing usage records, "
          f"{len(billing_rates_raw)} billing rates, {len(tasks_raw)} task records from {json_dir}")

    if args.dry_run:
        print("[✓] Dry-run complete. No changes were written.")
        return 0

    session = SessionLocal()
    try:
        for row in tenants_raw:
            tenant = Tenant(
                id=row.get("id"),
                name=row.get("name") or f"tenant_{row.get('id') or uuid.uuid4().hex[:8]}",
                api_key=row.get("api_key") or uuid.uuid4().hex,
                is_active=bool(row.get("is_active", True)),
                created_at=_parse_datetime(row.get("created_at"), aware=False) or datetime.utcnow(),
                updated_at=_parse_datetime(row.get("updated_at"), aware=False) or datetime.utcnow(),
                settings=row.get("settings") or "{}",
            )
            session.merge(tenant)
        session.commit()
        print(f"[✓] Migrated {len(tenants_raw)} tenant rows into {sqlite_path.name}")

        for row in users_raw:
            password_hash = row.get("hashed_password") or row.get("password_hash")
            if not password_hash:
                continue
            user = User(
                id=row.get("id"),
                username=row.get("username"),
                email=row.get("email"),
                hashed_password=password_hash,
                tenant_id=row.get("tenant_id") or 1,
                is_active=bool(row.get("is_active", True)),
                created_at=_parse_datetime(row.get("created_at"), aware=False) or datetime.utcnow(),
                last_login=_parse_datetime(row.get("last_login"), aware=False),
                credit=row.get("credit") if isinstance(row.get("credit"), int) else settings.user_default_credit,
                group=row.get("group") if isinstance(row.get("group"), int) else settings.user_default_group,
            )
            session.merge(user)
        session.commit()
        print(f"[✓] Migrated {len(users_raw)} user rows")

        for row in usage_raw:
            usage = APIUsage(
                id=row.get("id"),
                tenant_id=row.get("tenant_id"),
                user_id=row.get("user_id"),
                endpoint=row.get("endpoint"),
                request_count=row.get("request_count") or 1,
                created_at=_parse_datetime(row.get("created_at"), aware=False) or datetime.utcnow(),
            )
            session.merge(usage)
        session.commit()
        print(f"[✓] Migrated {len(usage_raw)} API usage rows")

        for row in billing_rates_raw:
            model = row.get("model")
            if not model:
                continue
            rate = ModelBillingRate(
                id=row.get("id"),
                model=model,
                credit=row.get("credit") if isinstance(row.get("credit"), int) else 1,
                created_at=_parse_datetime(row.get("created_at"), aware=True) or datetime.now(timezone.utc),
                updated_at=_parse_datetime(row.get("updated_at"), aware=True) or datetime.now(timezone.utc),
            )
            session.merge(rate)
        session.commit()
        print(f"[✓] Migrated {len(billing_rates_raw)} billing rates")

        for row in billing_usage_raw:
            usage = BillingUsage(
                id=row.get("id"),
                tenant_id=row.get("tenant_id"),
                user_id=row.get("user_id"),
                tenant_task_id=row.get("tenant_task_id"),
                endpoint=row.get("endpoint"),
                model=row.get("model"),
                credits=row.get("credits") if isinstance(row.get("credits"), int) else 1,
                status=row.get("status") or "success",
                balance_before=row.get("balance_before"),
                balance_after=row.get("balance_after"),
                created_at=_parse_datetime(row.get("created_at"), aware=True) or datetime.now(timezone.utc),
            )
            session.merge(usage)
        session.commit()
        print(f"[✓] Migrated {len(billing_usage_raw)} billing usage rows")

        for row in tasks_raw:
            record = TenantTaskRecord(
                id=row.get("id"),
                tenant_task_id=row.get("tenant_task_id") or f"tenant_{uuid.uuid4().hex[:16]}",
                user_id=row.get("user_id"),
                runninghub_task_id=row.get("runninghub_task_id"),
                task_type=row.get("task_type"),
                status=row.get("status") or "PENDING",
                created_at=_parse_datetime(row.get("created_at"), aware=True) or datetime.now(timezone.utc),
                completed_at=_parse_datetime(row.get("completed_at"), aware=True),
                result_data=_dump_json(row.get("result_data")),
                storage_paths=_dump_json(row.get("storage_paths")),
                error_message=row.get("error_message"),
            )
            session.merge(record)
        session.commit()
        print(f"[✓] Migrated {len(tasks_raw)} task records")
    finally:
        session.close()

    print(f"[✔] Migration complete. Update your .env to set STORAGE_TYPE=sqlite and restart the service.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
