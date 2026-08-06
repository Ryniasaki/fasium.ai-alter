"""
完整的印花提取工作流
接收上传图片，上传至运行服务后触发印花提取任务
"""
from typing import Dict, Any, List
from pydantic import BaseModel
from fastapi import UploadFile
from .workflow_manager import Workflow
from app.services.runninghub_client import RunninghubClient
from app.services.config import get_settings
from app.services.logger import get_runninghub_logger


class CompletePatternExtractInput(BaseModel):
    """完整印花提取工作流输入参数"""
    file: UploadFile
    fileType: str = "image"


class CompletePatternExtractWorkflow(Workflow):
    """完整印花提取：上传图片并触发提取"""

    def __init__(self):
        self._settings = None
        self._client = None
        self._logger = None

    @property
    def settings(self):
        if self._settings is None:
            self._settings = get_settings()
        return self._settings

    @property
    def client(self):
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
        # 对应 curl 示例中的 webappId
        return "1972483134858129410"

    @property
    def name(self) -> str:
        return "complete_pattern_extract"

    @property
    def display_name(self) -> str:
        return "完整印花提取"

    @property
    def description(self) -> str:
        return "上传图片并进行印花提取，返回任务ID用于轮询与获取输出"

    @property
    def input_model(self):
        return CompletePatternExtractInput

    def get_node_info_list(self, image_name: str = "", **kwargs) -> List[Dict[str, Any]]:
        """
        生成印花提取所需的节点信息列表

        Args:
            image_name: 已上传到运行服务后的图片文件名
        """
        if not image_name:
            raise ValueError("图片名称不能为空")

        return [
            {
                "nodeId": "224",
                "fieldName": "image",
                "fieldValue": image_name,
                "description": "image",
            }
        ]

    async def execute_workflow(self, file: UploadFile, fileType: str = "image", **kwargs) -> Dict[str, Any]:
        """
        上传图片 -> 组装节点 -> 创建任务
        """
        # 上传图片，得到运行服务侧的文件名
        self.logger.info(f"开始上传印花提取图片: {file.filename}")
        image_name = await self.client.upload_file(file=file, file_type=fileType)
        if isinstance(image_name, dict):
            image_name = image_name.get("fileName", str(image_name))
        else:
            image_name = str(image_name)

        if not image_name:
            raise ValueError("上传失败，未获取到图片名称")

        # 组装节点信息：仅一个 image 节点（nodeId=224）
        node_info_list: List[Dict[str, Any]] = self.get_node_info_list(image_name=image_name)

        # 创建任务
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

        self.logger.info(f"印花提取任务已创建，taskId={task_id}")
        return {
            "taskId": task_id,
            "status": "created",
            "message": "印花提取任务已创建",
        }
