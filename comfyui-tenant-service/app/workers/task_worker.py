from __future__ import annotations

import asyncio

from redis import Redis
from rq import Connection, Worker

from ..models.database import SessionLocal
from ..services.config import get_settings
from ..services.logger import get_main_logger
from ..services.task_completion_service import complete_task_with_storage_impl

logger = get_main_logger()


def process_task_completion_job(runninghub_task_id: str, username: str) -> None:
    session = SessionLocal()
    try:
        asyncio.run(complete_task_with_storage_impl(runninghub_task_id, username, session))
    finally:
        session.close()


def run_worker() -> None:
    settings = get_settings()
    connection = Redis.from_url(settings.redis_url)
    with Connection(connection):
        worker = Worker([settings.task_queue_name])
        logger.info(
            "RQ worker started. queue=%s redis=%s",
            settings.task_queue_name,
            settings.redis_url,
        )
        worker.work(with_scheduler=False)


if __name__ == "__main__":
    run_worker()

