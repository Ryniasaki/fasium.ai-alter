from __future__ import annotations

from typing import Any, Dict, List

import httpx
from sqlalchemy.orm import Session

from ..models.database import TenantTaskRecord
from ..services.config import get_settings
from ..services.image_storage import image_storage_service
from ..services.logger import get_proxy_logger
from ..services.task_record_service import task_record_service


async def complete_task_with_storage_impl(task_id: str, username: str, db: Session) -> Dict[str, Any]:
    """
    Finalize a completed RunningHub task:
    1) Fetch outputs from RunningHub
    2) Download/store images locally
    3) Update tenant task record as SUCCESS
    """
    logger = get_proxy_logger()
    settings = get_settings()

    logger.info("开始处理任务完成: %s, 用户: %s", task_id, username)

    async with httpx.AsyncClient(timeout=30.0) as client:
        outputs_response = await client.get(f"{settings.runninghub_service_url}/v1/tasks/{task_id}/outputs")
        outputs_response.raise_for_status()
        outputs_data = outputs_response.json()

    outputs = outputs_data.get("outputs")
    if not outputs:
        logger.warning("任务 %s 没有输出", task_id)
        return {
            "taskId": task_id,
            "status": "completed",
            "message": "任务完成，但没有输出文件",
            "outputCount": 0,
        }

    stored_outputs = await image_storage_service.download_and_store_images(username, outputs)

    storage_entries: List[Dict[str, Any]] = []
    for output in stored_outputs:
        original_ref = output.get("original") or output.get("localPath")
        thumbnail_ref = output.get("thumbnail") or output.get("thumbnailPath")
        if original_ref:
            storage_entries.append(
                {
                    "original": original_ref,
                    "thumbnail": thumbnail_ref,
                }
            )

    tenant_task_id = None
    if hasattr(db, "query"):
        record = (
            db.query(TenantTaskRecord)
            .filter(TenantTaskRecord.runninghub_task_id == task_id)
            .first()
        )
        if record:
            tenant_task_id = record.tenant_task_id
    elif hasattr(db, "get_user_tasks"):
        task_records = db.get_user_tasks(username, limit=100)
        for record in task_records:
            if record.get("runninghub_task_id") == task_id:
                tenant_task_id = record.get("tenant_task_id")
                break

    if tenant_task_id:
        success = task_record_service.update_task_success(
            tenant_task_id,
            outputs_data,
            storage_entries,
            db,
        )
        if success:
            logger.info("任务记录更新成功: %s", tenant_task_id)
        else:
            logger.error("任务记录更新失败: %s", tenant_task_id)

    return {
        "taskId": task_id,
        "status": "completed",
        "message": "文件已下载并完成存储",
        "storagePaths": storage_entries,
        "outputCount": len(stored_outputs),
    }
