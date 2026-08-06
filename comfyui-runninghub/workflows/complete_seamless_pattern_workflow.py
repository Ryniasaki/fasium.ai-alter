"""
完整无缝图案生成工作流
接受上传图片，上传至运行服务后触发无缝图案生成任务
"""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from fastapi import UploadFile
from .workflow_manager import Workflow
from app.services.runninghub_client import RunninghubClient
from app.services.config import get_settings
from app.services.logger import get_runninghub_logger


class CompleteSeamlessPatternInput(BaseModel):
    """完整无缝图案工作流输入参数"""
    file: UploadFile
    fileType: str = "image"


class CompleteSeamlessPatternWorkflow(Workflow):
    """完整无缝图案生成：上传图片并触发无缝输出"""

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
        # 来自业务方提供的无缝图案应用 ID
        return "1983059599802662914"

    @property
    def name(self) -> str:
        return "complete_seamless_pattern"

    @property
    def display_name(self) -> str:
        return "完整无缝图案生成"

    @property
    def description(self) -> str:
        return "上传图片并触发无缝图案生成任务，返回任务ID用于轮询与获取输出"

    @property
    def input_model(self):
        return CompleteSeamlessPatternInput

    def get_node_info_list(self, image_name: str = "", **kwargs) -> List[Dict[str, Any]]:
        """
        生成无缝图案工作流所需的节点信息列表

        Args:
            image_name: 已上传到运行服务后的图片文件名
        """
        if not image_name:
            raise ValueError("图片名称不能为空")

        return [
            {
                "nodeId": "40",
                "fieldName": "image",
                "fieldValue": image_name,
                "description": "image",
            }
        ]

    async def execute_workflow(self, file: UploadFile, fileType: str = "image", **kwargs) -> Dict[str, Any]:
        """
        上传图片 -> 组装节点 -> 创建任务
        """
        self.logger.info(f"开始上传无缝图案生成图片: {file.filename}")
        image_name = await self.client.upload_file(file=file, file_type=fileType)
        if isinstance(image_name, dict):
            image_name = image_name.get("fileName", str(image_name))
        else:
            image_name = str(image_name)

        if not image_name:
            raise ValueError("上传失败，未获取到图片名称")

        node_info_list: List[Dict[str, Any]] = self.get_node_info_list(image_name=image_name)

        task_id = await self.client.create_task(
            webapp_id=self.webapp_id,
            node_info_list=node_info_list,
        )

        if isinstance(task_id, dict):
            task_id = task_id.get("taskId", str(task_id))
        else:
            task_id = str(task_id)

        if not task_id:
            raise ValueError("任务创建失败，未获取到任务ID")

        self.logger.info(f"无缝图案生成任务已创建，taskId={task_id}")
        return {
            "taskId": task_id,
            "status": "created",
            "message": "无缝图案生成任务已创建",
        }
