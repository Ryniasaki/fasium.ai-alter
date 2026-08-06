"""
Background job that keeps tenant_task_records in sync with RunningHub.
"""

from __future__ import annotations

import asyncio
from typing import List, Optional

import httpx
from sqlalchemy.orm import Session

from app.models.database import SessionLocal, TenantTaskRecord
from app.services.config import get_settings
from app.services.logger import get_main_logger
from app.services.task_completion_service import complete_task_with_storage_impl
from app.services.task_queue import enqueue_task_completion
from app.services.task_record_service import task_record_service
from app.services.task_timeout import is_task_timed_out
from app.routers.proxy import (
    RUNNING_STATUSES,
    FAILED_STATUSES,
    SUCCESS_STATUSES,
    _extract_status,
)

logger = get_main_logger()


class RunningTasksMonitor:
    def __init__(self, interval_seconds: int = 10):
        self.interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._settings = get_settings()

    def start(self) -> None:
        if not self._settings.is_database_storage():
            logger.info("RunningTasksMonitor: Skipping background sync (non-database storage).")
            return
        if self._task is None or self._task.done():
            logger.info("RunningTasksMonitor: starting background sync loop.")
            self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            logger.info("RunningTasksMonitor: stopping background sync loop.")
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run_loop(self) -> None:
        while True:
            try:
                await self._sync_once()
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("RunningTasksMonitor: sync iteration failed: %s", exc)
            await asyncio.sleep(self.interval_seconds)

    async def _sync_once(self) -> None:
        session: Session = SessionLocal()
        try:
            running_tasks: List[TenantTaskRecord] = (
                session.query(TenantTaskRecord)
                .filter(TenantTaskRecord.status.in_(list(RUNNING_STATUSES)))
                .all()
            )
            if not running_tasks:
                return

            async with httpx.AsyncClient(timeout=20.0) as client:
                for record in running_tasks:
                    await self._process_single_record(client, record, session)
        finally:
            session.close()

    async def _process_single_record(
        self,
        client: httpx.AsyncClient,
        record: TenantTaskRecord,
        session: Session,
    ) -> None:
        tenant_task_id = record.tenant_task_id
        username = record.user_id
        runninghub_task_id = record.runninghub_task_id
        task_type = str(getattr(record, "task_type", "") or "").strip().lower()

        if not runninghub_task_id or not tenant_task_id:
            return
        if task_type == "admaster_sora2_video":
            # Veo tasks are polled by dedicated endpoints, not RunningHub.
            return

        timeout_seconds = int(self._settings.runninghub_task_timeout_seconds)
        if is_task_timed_out(getattr(record, "created_at", None), timeout_seconds):
            logger.warning(
                "RunningTasksMonitor: 任务 %s 已超时（%s 秒），标记为失败",
                runninghub_task_id,
                timeout_seconds,
            )
            task_record_service.update_task_failed(
                tenant_task_id,
                f"RunningHub task timeout after {timeout_seconds} seconds",
                session,
            )
            return

        try:
            response = await client.get(
                f"{self._settings.runninghub_service_url}/v1/tasks/{runninghub_task_id}"
            )
            response.raise_for_status()
            payload = response.json()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                logger.info(
                    "RunningTasksMonitor: RunningHub task %s missing, marking tenant task %s as FAILED",
                    runninghub_task_id,
                    tenant_task_id,
                )
                task_record_service.update_task_failed(
                    tenant_task_id,
                    "Upstream task not found (404), record retained",
                    session,
                )
            else:
                logger.warning(
                    "RunningTasksMonitor: Failed to fetch %s (HTTP %s)",
                    runninghub_task_id,
                    exc.response.status_code,
                )
            return
        except Exception as exc:  # pylint: disable=broad-except
            logger.warning(
                "RunningTasksMonitor: error fetching %s status: %s", runninghub_task_id, exc
            )
            return

        status_value = _extract_status(payload)
        if not status_value:
            logger.debug(
                "RunningTasksMonitor: No status extracted for %s payload=%s",
                runninghub_task_id,
                payload,
            )
            return

        normalized = status_value.upper()
        existing = (record.status or "").upper()

        if normalized in SUCCESS_STATUSES:
            if not enqueue_task_completion(runninghub_task_id, username):
                await complete_task_with_storage_impl(runninghub_task_id, username, session)
            return

        if normalized in FAILED_STATUSES:
            message = (
                payload.get("message")
                or payload.get("error")
                or payload.get("detail")
                or payload.get("msg")
                or "任务失败"
            )
            task_record_service.update_task_failed(tenant_task_id, message, session)
            return

        if normalized in RUNNING_STATUSES and normalized != existing:
            task_record_service.update_task_status(tenant_task_id, normalized, session, None)


# Singleton helper used by app startup/shutdown hooks
running_tasks_monitor = RunningTasksMonitor()
