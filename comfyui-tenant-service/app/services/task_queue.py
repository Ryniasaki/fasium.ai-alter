from __future__ import annotations

from redis import Redis
from rq import Queue

from .config import get_settings
from .logger import get_main_logger

logger = get_main_logger()


def enqueue_task_completion(runninghub_task_id: str, username: str) -> bool:
    settings = get_settings()
    if not settings.task_queue_enabled:
        return False

    try:
        connection = Redis.from_url(settings.redis_url)
        queue = Queue(
            settings.task_queue_name,
            connection=connection,
            default_timeout=settings.task_queue_timeout_seconds,
        )
        job_id = f"task-completion:{runninghub_task_id}"
        try:
            queue.enqueue(
                "app.workers.task_worker.process_task_completion_job",
                runninghub_task_id,
                username,
                job_id=job_id,
                result_ttl=600,
                failure_ttl=86400,
            )
            logger.info(
                "已投递任务完成处理到队列: task=%s user=%s queue=%s",
                runninghub_task_id,
                username,
                settings.task_queue_name,
            )
        except ValueError as exc:
            # RQ raises ValueError when a job_id already exists.
            if "already exists" in str(exc):
                logger.info("任务已在队列中，跳过重复投递: %s", runninghub_task_id)
            else:
                raise
        return True
    except Exception as exc:  # pylint: disable=broad-except
        logger.error("投递 Redis 队列失败，降级为同步处理: %s", exc)
        return False
