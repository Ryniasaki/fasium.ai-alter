"""
Background job to back up the database files every 24 hours.
"""

from __future__ import annotations

import asyncio
import shutil
from datetime import datetime
from pathlib import Path
from typing import Optional

from app.services.config import get_settings
from app.services.logger import get_main_logger

logger = get_main_logger()


class DatabaseBackupScheduler:
    def __init__(self, interval_seconds: int = 24 * 60 * 60):
        self.interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._settings = get_settings()

    def start(self) -> None:
        if self._task is None or self._task.done():
            logger.info("DatabaseBackup: starting backup loop.")
            self._task = asyncio.create_task(self._run_loop())

    async def stop(self) -> None:
        if self._task and not self._task.done():
            logger.info("DatabaseBackup: stopping backup loop.")
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        self._task = None

    async def _run_loop(self) -> None:
        while True:
            try:
                await asyncio.to_thread(self._backup_once)
            except Exception as exc:  # pylint: disable=broad-except
                logger.error("DatabaseBackup: backup iteration failed: %s", exc)
            await asyncio.sleep(self.interval_seconds)

    def _backup_once(self) -> None:
        backup_dir = Path("database-backup")
        backup_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")

        if self._settings.storage_type == "sqlite":
            self._backup_sqlite(backup_dir, timestamp)
            return
        if self._settings.storage_type == "json":
            self._backup_json(backup_dir, timestamp)
            return

        logger.info("DatabaseBackup: storage type %s not supported for file backup.", self._settings.storage_type)

    def _backup_sqlite(self, backup_dir: Path, timestamp: str) -> None:
        source = Path(self._settings.sqlite_path)
        if not source.exists():
            logger.warning("DatabaseBackup: sqlite file %s not found.", source)
            return
        dest = backup_dir / f"{source.stem}-{timestamp}{source.suffix}"
        shutil.copy2(source, dest)
        logger.info("DatabaseBackup: sqlite backup created at %s", dest)

    def _backup_json(self, backup_dir: Path, timestamp: str) -> None:
        source = Path(self._settings.json_storage_path)
        if not source.exists():
            logger.warning("DatabaseBackup: json storage path %s not found.", source)
            return
        dest = backup_dir / f"{source.name}-{timestamp}"
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(source, dest)
        logger.info("DatabaseBackup: json backup created at %s", dest)


database_backup_scheduler = DatabaseBackupScheduler()
