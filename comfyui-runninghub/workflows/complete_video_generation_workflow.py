"""
完整的视频生成工作流
接收图片和提示词，上传后触发视频生成任务
"""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from fastapi import UploadFile
from .workflow_manager import Workflow
from app.services.runninghub_client import RunninghubClient
from app.services.config import get_settings
from app.services.logger import get_runninghub_logger


class CompleteVideoGenerationInput(BaseModel):
    """完整视频生成工作流输入参数"""
    file: UploadFile
    prompt: str
    fileType: str = "image"


class CompleteVideoGenerationWorkflow(Workflow):
    """完整视频生成：上传图片并触发视频生成任务"""

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
        # 对应 curl 示例中的 webappId
        return "1980833864815919105"

    @property
    def name(self) -> str:
        return "complete_video_generation"

    @property
    def display_name(self) -> str:
        return "完整视频生成"

    @property
    def description(self) -> str:
        return "上传图片并结合提示词生成视频，返回任务ID用于轮询与获取输出"

    @property
    def input_model(self):
        return CompleteVideoGenerationInput

    def get_node_info_list(self, image_name: str = "", prompt: str = "", **kwargs) -> List[Dict[str, Any]]:
        """
        生成视频生成任务所需的节点信息列表

        Args:
            image_name: 已上传到运行服务后的图片文件名
            prompt: 视频生成提示词
        """
        if not isinstance(image_name, str):
            image_name = str(image_name)
        image_name = image_name.strip()
        if not image_name:
            raise ValueError("图片名称不能为空")

        if not isinstance(prompt, str):
            prompt = str(prompt)
        prompt = prompt.strip()
        if not prompt:
            raise ValueError("提示词不能为空")

        return [
            {
                "nodeId": "87",
                "fieldName": "image",
                "fieldValue": image_name,
                "description": "image",
            },
            {
                "nodeId": "86",
                "fieldName": "prompt",
                "fieldValue": prompt,
                "description": "prompt",
            },
        ]

    async def execute_workflow(
        self,
        file: UploadFile,
        prompt: str,
        fileType: str = "image",
        **kwargs,
    ) -> Dict[str, Any]:
        """
        上传图片 -> 组装节点 -> 创建视频生成任务
        """
        self.logger.info(f"开始上传视频生成图片: {file.filename}")
        image_name = await self.client.upload_file(file=file, file_type=fileType)

        if isinstance(image_name, dict):
            image_name = image_name.get("fileName", str(image_name))
        else:
            image_name = str(image_name)

        if not image_name:
            raise ValueError("上传失败，未获取到图片名称")

        node_info_list = self.get_node_info_list(image_name=image_name, prompt=prompt)

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

        self.logger.info(f"视频生成任务已创建，taskId={task_id}")
        return {
            "taskId": task_id,
            "status": "created",
            "message": "视频生成任务已创建",
        }
