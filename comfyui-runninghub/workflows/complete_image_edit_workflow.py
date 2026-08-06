"""
完整的图片编辑工作流
整合文件上传和图片编辑功能
"""
from pathlib import Path
from typing import Dict, Any, List, Optional
import uuid
from pydantic import BaseModel
from fastapi import UploadFile
from .workflow_manager import Workflow
from app.services.runninghub_client import RunninghubClient
from app.services.config import get_settings
from app.services.logger import get_runninghub_logger

DEFAULT_IMAGE_PLACEHOLDER = "f23d534950c05bb974fbf23485108c17fa8446b66dd19b6b2f482d68441335b2.png"


class CompleteImageEditInput(BaseModel):
    """完整图片编辑工作流输入参数"""
    file: UploadFile
    fileType: str = "image"
    prompt: str = ""
    file_2: Optional[UploadFile] = None
    file_3: Optional[UploadFile] = None
    file_4: Optional[UploadFile] = None


class CompleteImageEditWorkflow(Workflow):
    """完整的图片编辑工作流 - 包含上传和编辑"""
    
    def __init__(self):
        # 延迟初始化，避免在导入时出错
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
                timeout_seconds=self.settings.request_timeout_seconds
            )
        return self._client
    
    @property
    def logger(self):
        if self._logger is None:
            self._logger = get_runninghub_logger()
        return self._logger
    
    @property
    def webapp_id(self) -> str:
        return "1970781747573125122"
    
    @property
    def name(self) -> str:
        return "complete_image_edit"
    
    @property
    def display_name(self) -> str:
        return "完整图片编辑"
    
    @property
    def description(self) -> str:
        return "上传图片并进行编辑，接受二进制图片文件和编辑提示词"
    
    @property
    def input_model(self):
        return CompleteImageEditInput

    async def _persist_upload_file(self, upload_file: UploadFile, description: str) -> bytes:
        """将上传的文件保存到本地 input/upload 目录并返回文件内容"""
        upload_dir = Path(__file__).resolve().parents[1] / "input" / "upload"
        upload_dir.mkdir(parents=True, exist_ok=True)

        await upload_file.seek(0)
        file_bytes = await upload_file.read()

        original_name = upload_file.filename
        safe_name = Path(original_name).name if original_name else f"{uuid.uuid4().hex}.bin"
        destination = upload_dir / safe_name

        with destination.open("wb") as f:
            f.write(file_bytes)

        await upload_file.seek(0)
        self.logger.info(f"{description} 已保存到本地: {destination}")
        return file_bytes
    
    async def execute_workflow(self, file: UploadFile, fileType: str = "image", prompt: str = "", file_2: Optional[UploadFile] = None, file_3: Optional[UploadFile] = None, file_4: Optional[UploadFile] = None, **kwargs) -> Dict[str, Any]:
        """
        执行完整的工作流：上传图片 -> 编辑图片
        
        Args:
            file: 上传的图片文件
            fileType: 文件类型
            prompt: 编辑提示词
            file_2: 第二张图片文件（可选）
            file_3: 第三张图片文件（可选）
            file_4: 第四张图片文件（可选）
            
        Returns:
            包含任务ID和状态的结果
        """
        try:
            # 第一步：上传所有图片
            image_names = {}
            
            # 上传第一张图片
            self.logger.info(f"开始上传第一张图片: {file.filename}")
            image_1_bytes = await self._persist_upload_file(file, "第一张图片")
            image_name = await self.client.upload_file(file=file, file_type=fileType, file_bytes=image_1_bytes)
            image_names['image_1'] = self._process_upload_result(image_name, "第一张图片")
            
            # 上传第二张图片（如果提供）
            if file_2:
                self.logger.info(f"开始上传第二张图片: {file_2.filename}")
                image_2_bytes = await self._persist_upload_file(file_2, "第二张图片")
                image_2_name = await self.client.upload_file(file=file_2, file_type=fileType, file_bytes=image_2_bytes)
                image_names['image_2'] = self._process_upload_result(image_2_name, "第二张图片")
            
            # 上传第三张图片（如果提供）
            if file_3:
                self.logger.info(f"开始上传第三张图片: {file_3.filename}")
                image_3_bytes = await self._persist_upload_file(file_3, "第三张图片")
                image_3_name = await self.client.upload_file(file=file_3, file_type=fileType, file_bytes=image_3_bytes)
                image_names['image_3'] = self._process_upload_result(image_3_name, "第三张图片")
            
            # 上传第四张图片（如果提供）
            if file_4:
                self.logger.info(f"开始上传第四张图片: {file_4.filename}")
                image_4_bytes = await self._persist_upload_file(file_4, "第四张图片")
                image_4_name = await self.client.upload_file(file=file_4, file_type=fileType, file_bytes=image_4_bytes)
                image_names['image_4'] = self._process_upload_result(image_4_name, "第四张图片")
            
            # 第二步：执行图片编辑
            self.logger.info(f"开始执行图片编辑，提示词: {prompt}")
            node_info_list = self.get_node_info_list(
                prompt=prompt, 
                image_name=image_names.get('image_1', ''),
                image_2=image_names.get('image_2', ''),
                image_3=image_names.get('image_3', ''),
                image_4=image_names.get('image_4', '')
            )
            
            task_id = await self.client.create_task(
                webapp_id=self.webapp_id,
                node_info_list=node_info_list
            )
            
            self.logger.info(f"create_task返回的原始数据: {task_id}")
            self.logger.info(f"返回数据类型: {type(task_id)}")
            
            if not task_id:
                raise ValueError("任务创建失败，未获取到任务ID")
            
            # 确保task_id是字符串格式
            if isinstance(task_id, dict):
                # 如果是字典，提取taskId字段
                task_id = task_id.get("taskId", str(task_id))
            elif not isinstance(task_id, str):
                task_id = str(task_id)
            
            self.logger.info(f"处理后的任务ID: {task_id}")
            
            return {
                "taskId": task_id,
                "imageNames": image_names,
                "status": "created",
                "message": "图片编辑任务已创建"
            }
            
        except Exception as e:
            self.logger.error(f"工作流执行失败: {str(e)}")
            raise e
    
    def _process_upload_result(self, upload_result: Any, image_description: str) -> str:
        """
        处理上传结果，确保返回字符串格式的图片名称
        
        Args:
            upload_result: 上传接口返回的结果
            image_description: 图片描述（用于日志）
            
        Returns:
            处理后的图片名称字符串
        """
        self.logger.info(f"{image_description}上传接口返回的原始数据: {upload_result}")
        self.logger.info(f"返回数据类型: {type(upload_result)}")
        
        if not upload_result:
            raise ValueError(f"{image_description}上传失败，未获取到图片名称")
        
        # 确保image_name是字符串格式的路径
        if isinstance(upload_result, dict):
            # 如果是字典，提取fileName
            image_name = upload_result.get("fileName", str(upload_result))
        elif not isinstance(upload_result, str):
            image_name = str(upload_result)
        else:
            image_name = upload_result
        
        self.logger.info(f"处理后的{image_description}名称: {image_name}")
        return image_name
    
    def get_node_info_list(self, prompt: str = "", image_name: str = "", image_2: str = "", image_3: str = "", image_4: str = "", **kwargs) -> List[Dict[str, Any]]:
        """
        生成图片编辑的节点信息列表
        
        Args:
            prompt: 编辑提示词
            image_name: 第一张图片名称
            image_2: 第二张图片名称
            image_3: 第三张图片名称
            image_4: 第四张图片名称
        """
        # 确保 prompt 是字符串
        if isinstance(prompt, dict):
            prompt = str(prompt)
        elif not isinstance(prompt, str):
            prompt = str(prompt)
        
        if not prompt.strip():
            raise ValueError("编辑提示词不能为空")
        
        def normalize_image_value(value: Any, allow_empty: bool = False) -> str:
            if isinstance(value, dict):
                value = str(value)
            elif not isinstance(value, str):
                value = str(value)
            normalized = value.strip()
            if not normalized:
                if allow_empty:
                    return DEFAULT_IMAGE_PLACEHOLDER
                raise ValueError("第一张图片名称不能为空")
            return normalized
        
        image_name = normalize_image_value(image_name, allow_empty=False)
        image_2 = normalize_image_value(image_2, allow_empty=True)
        image_3 = normalize_image_value(image_3, allow_empty=True)
        image_4 = normalize_image_value(image_4, allow_empty=True)
        
        node_info_list = [
            {
                "nodeId": "35",
                "fieldName": "image",
                "fieldValue": image_name,
                "description": "image"
            },
            {
                "nodeId": "53",
                "fieldName": "image",
                "fieldValue": image_2,
                "description": "image"
            },
            {
                "nodeId": "51",
                "fieldName": "image",
                "fieldValue": image_3,
                "description": "image"
            },
            {
                "nodeId": "52",
                "fieldName": "image",
                "fieldValue": image_4,
                "description": "image"
            },
            {
                "nodeId": "46",
                "fieldName": "text",
                "fieldValue": prompt,
                "description": "text"
            }
        ]
        
        return node_info_list


# 为了向后兼容，保留原有的ImageEditWorkflow
class ImageEditInput(BaseModel):
    """图片编辑工作流输入参数（仅编辑，需要预先上传的图片名称）"""
    prompt: str = ""
    image_name: str = ""


class ImageEditWorkflow(Workflow):
    """图片编辑工作流（仅编辑功能）"""
    
    @property
    def webapp_id(self) -> str:
        return "1970781747573125122"
    
    @property
    def name(self) -> str:
        return "image_edit"
    
    @property
    def display_name(self) -> str:
        return "图片编辑"
    
    @property
    def description(self) -> str:
        return "基于图片和提示词进行编辑，需要提供图片名称和编辑提示词"
    
    @property
    def input_model(self):
        return ImageEditInput
    
    def get_node_info_list(self, prompt: str = "", image_name: str = "", **kwargs) -> List[Dict[str, Any]]:
        """
        生成图片编辑的节点信息列表
        
        Args:
            prompt: 编辑提示词
            image_name: 图片名称
        """
        # 确保 prompt 是字符串
        if isinstance(prompt, dict):
            prompt = str(prompt)
        elif not isinstance(prompt, str):
            prompt = str(prompt)
        
        if not prompt.strip():
            raise ValueError("编辑提示词不能为空")
        
        # 确保 image_name 是字符串
        if isinstance(image_name, dict):
            image_name = str(image_name)
        elif not isinstance(image_name, str):
            image_name = str(image_name)
        
        if not image_name.strip():
            raise ValueError("图片名称不能为空")
        
        return [
            {
                "nodeId": "35",
                "fieldName": "image",
                "fieldValue": image_name,
                "description": "image"
            },
            {
                "nodeId": "46",
                "fieldName": "text",
                "fieldValue": prompt,
                "description": "text"
            }
        ]
