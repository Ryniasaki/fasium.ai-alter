import asyncio
from .config import get_settings
from .runninghub_client import get_runninghub_client
from .logger import get_task_manager_logger


class TaskManager:
    def __init__(self, client) -> None:
        self.client = client
        self.settings = get_settings()
        self.logger = get_task_manager_logger()

    async def poll_task_until_complete(self, task_id: str) -> str:
        interval = self.settings.poll_interval_seconds
        max_seconds = self.settings.max_poll_seconds
        elapsed = 0
        
        self.logger.info(f"开始轮询任务: {task_id}")

        while elapsed <= max_seconds:
            status = await self.client.get_status(task_id)
            self.logger.debug(f"任务 {task_id} 状态: {status}")
            
            if status in {"SUCCESS", "FAILED"}:
                self.logger.info(f"任务 {task_id} 完成，最终状态: {status}")
                return status
            await asyncio.sleep(interval)
            elapsed += interval
            
        self.logger.warning(f"任务 {task_id} 轮询超时")
        return "TIMEOUT"

    async def get_status(self, task_id: str) -> str:
        return await self.client.get_status(task_id)


def get_task_manager(client=None):
    if client is None:
        client = get_runninghub_client()
    return TaskManager(client)


