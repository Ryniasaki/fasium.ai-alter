"""
SVG 矢量化工作流
上传图片后触发 RunningHub WebApp，将输出的矢量结果用于后续处理
"""
from typing import Dict, Any, List, Optional
from fastapi import UploadFile
from pydantic import BaseModel
from .workflow_manager import Workflow
from app.services.runninghub_client import RunninghubClient
from app.services.config import get_settings
from app.services.logger import get_runninghub_logger


class SvgVectorizationInput(BaseModel):
    """矢量化工作流输入参数"""
    file: UploadFile
    fileType: str = "image"


class SvgVectorizationWorkflow(Workflow):
    """负责上传图片并触发 WebApp 1988845782470103042"""

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
        return "1988845782470103042"

    @property
    def name(self) -> str:
        return "svg_vectorization"

    @property
    def display_name(self) -> str:
        return "矢量化提取"

    @property
    def description(self) -> str:
        return "上传图片后由运行服务输出矢量结果（默认 txt，后续转 svg）"

    @property
    def input_model(self):
        return SvgVectorizationInput

    def get_node_info_list(self, image_name: str = "", **kwargs) -> List[Dict[str, Any]]:
        normalized = str(image_name or "").strip()
        if not normalized:
            raise ValueError("图片名称不能为空")
        return [
            {
                "nodeId": "5",
                "fieldName": "image",
                "fieldValue": normalized,
                "description": "image",
            }
        ]

    async def execute_workflow(self, file: UploadFile, fileType: str = "image", **kwargs) -> Dict[str, Any]:
        self.logger.info(f"开始上传矢量化图片: {file.filename}")

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

        self.logger.info(f"矢量化任务已创建，taskId={task_id}")
        return {
            "taskId": task_id,
            "status": "created",
            "message": "矢量化任务已创建",
        }
