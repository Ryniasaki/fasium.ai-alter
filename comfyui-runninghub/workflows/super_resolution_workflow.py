"""
超级分辨率工作流
接收上传的图片并在 RunningHub 上触发超级分辨率任务
"""
from typing import Dict, Any, List, Optional
from fastapi import UploadFile
from pydantic import BaseModel
from .workflow_manager import Workflow
from app.services.runninghub_client import RunninghubClient
from app.services.config import get_settings
from app.services.logger import get_runninghub_logger


class SuperResolutionInput(BaseModel):
    """超级分辨率工作流输入参数"""
    file: UploadFile
    fileType: str = "image"


class SuperResolutionWorkflow(Workflow):
    """超级分辨率：上传图片并触发放大任务"""

    def __init__(self):
        self._settings = None
        self._client: Optional[RunninghubClient] = None
        self._logger = None

    @property
    def settings(self):
        if self._settings is None:
            self._settings = get_settings()
        return self._settings

    @property
    def client(self) -> RunninghubClient:
        if self._client is None:
            self._client = RunninghubClient(
                base_url=self.settings.runninghub_host,
                api_key=self.settings.runninghub_api_key,
                timeout_seconds=self.settings.request_timeout_seconds,
            )
        return self._client

    @property
    def logger(self):
        if self._logger is None:
            self._logger = get_runninghub_logger()
        return self._logger

    @property
    def webapp_id(self) -> str:
        # 来自需求中的 webappId
        return "1950040640522510338"

    @property
    def name(self) -> str:
        return "super_resolution"

    @property
    def display_name(self) -> str:
        return "超级分辨率"

    @property
    def description(self) -> str:
        return "上传图片并触发超级分辨率工作流，返回任务ID用于轮询查询"

    @property
    def input_model(self):
        return SuperResolutionInput

    def get_node_info_list(self, image_name: str = "", **kwargs) -> List[Dict[str, Any]]:
        """
        生成超级分辨率所需的节点信息列表

        Args:
            image_name: 上传到 RunningHub 后的图片名称
        """
        normalized = str(image_name or "").strip()
        if not normalized:
            raise ValueError("图片名称不能为空")

        return [
            {
                "nodeId": "54",
                "fieldName": "image",
                "fieldValue": normalized,
                "description": "image",
            }
        ]

    async def execute_workflow(self, file: UploadFile, fileType: str = "image", **kwargs) -> Dict[str, Any]:
        """上传图片 -> 组装节点 -> 创建超级分辨率任务"""
        self.logger.info(f"开始上传超级分辨率图片: {file.filename}")

        image_name = await self.client.upload_file(file=file, file_type=fileType)
        if isinstance(image_name, dict):
            image_name = image_name.get("fileName", str(image_name))
        else:
            image_name = str(image_name)

        image_name = image_name.strip()
        if not image_name:
            raise ValueError("上传失败，未获取到图片名称")

        node_info_list = self.get_node_info_list(image_name=image_name)

        task_id = await self.client.create_task(
            webapp_id=self.webapp_id,
            node_info_list=node_info_list,
        )

        if isinstance(task_id, dict):
            task_id = task_id.get("taskId", str(task_id))
        else:
            task_id = str(task_id)

        task_id = task_id.strip()
        if not task_id:
            raise ValueError("任务创建失败，未获取到任务ID")

        self.logger.info(f"超级分辨率任务已创建，taskId={task_id}")
        return {
            "taskId": task_id,
            "status": "created",
            "message": "超级分辨率任务已创建",
        }
