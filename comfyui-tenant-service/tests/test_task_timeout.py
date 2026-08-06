from datetime import datetime, timedelta, timezone

from app.services.config import Settings
from app.services.task_timeout import is_task_timed_out


def test_runninghub_task_timeout_default() -> None:
    assert Settings().runninghub_task_timeout_seconds == 2400


def test_is_task_timed_out_handles_naive_datetimes() -> None:
    now = datetime(2026, 6, 16, 12, 0, 0)

    assert not is_task_timed_out(now - timedelta(seconds=239), 240, now=now)
    assert is_task_timed_out(now - timedelta(seconds=240), 240, now=now)
    assert is_task_timed_out(now - timedelta(seconds=241), 240, now=now)


def test_is_task_timed_out_handles_iso_strings_with_timezone() -> None:
    now = datetime(2026, 6, 16, 12, 0, 0, tzinfo=timezone.utc)

    assert is_task_timed_out("2026-06-16T11:55:00Z", 240, now=now)
    assert not is_task_timed_out("2026-06-16T11:56:30+00:00", 240, now=now)
