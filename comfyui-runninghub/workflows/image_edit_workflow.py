"""
图片编辑工作流
基于图片和提示词进行编辑
"""
from typing import Dict, Any, List
from pydantic import BaseModel
from .workflow_manager import Workflow

class ImageEditInput(BaseModel):
    """图片编辑工作流输入参数"""
    prompt: str = ""
    image_name: str = ""
    image_2: str = ""
    image_3: str = ""
    image_4: str = ""

class ImageEditWorkflow(Workflow):
    """图片编辑工作流"""
    
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
        if not prompt.strip():
            raise ValueError("编辑提示词不能为空")
        
        if not image_name.strip():
            raise ValueError("第一张图片名称不能为空")
        
        node_info_list = [
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
        
        # 添加额外的图片节点（如果提供了图片名称）
        if image_2.strip():
            node_info_list.append({
                "nodeId": "53",
                "fieldName": "image",
                "fieldValue": image_2,
                "description": "image"
            })
        
        if image_3.strip():
            node_info_list.append({
                "nodeId": "51",
                "fieldName": "image",
                "fieldValue": image_3,
                "description": "image"
            })
        
        if image_4.strip():
            node_info_list.append({
                "nodeId": "52",
                "fieldName": "image",
                "fieldValue": image_4,
                "description": "image"
            })
        
        return node_info_list
