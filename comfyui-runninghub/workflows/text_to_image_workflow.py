"""
文生图工作流
使用提示词生成图片，通过向节点 2 传入特定占位图名称来决定画幅
"""
from typing import Dict, Any, List, Literal
from pydantic import BaseModel, Field

from .workflow_manager import Workflow


ASPECT_RATIO_TO_IMAGE = {
    "16:9": "093272bf4e8424e808af5d1bdb66dc635ccac2064ee5b780e537599997d2c054.jpg",
    "9:16": "03aa6d845eca852773b84965739e96af090fb805859cae0c176d492f51c85acd.jpg",
    "1:1": "a512208439b802e1096113d191be6b4e7ab625d67aa3887b491e1ee269a2ea46.jpg",
}

IGNORED_NODE_PLACEHOLDER = "IGNORED_BY_RUNNINGHUB"


class TextToImageInput(BaseModel):
    """文生图工作流输入参数"""

    prompt: str = Field(..., description="文生图提示词")
    aspect_ratio: Literal["16:9", "9:16", "1:1"] = Field(
        default="16:9",
        description=(
            "画面比例。无需上传图片，节点 2 会根据该选项自动填入占位图："
            "16:9→0932...054.jpg，9:16→03aa...acd.jpg，1:1→a512...a46.jpg"
        ),
    )


class TextToImageWorkflow(Workflow):
    """无需上传图片的文生图工作流"""

    @property
    def webapp_id(self) -> str:
        return "1988069706118664194"

    @property
    def name(self) -> str:
        return "text_to_image"

    @property
    def display_name(self) -> str:
        return "文生图"

    @property
    def description(self) -> str:
        return (
            "通过提示词生成图片，不需要上传任何图片。"
            "节点 2 根据画幅占位图控制出图比例；节点 25/26 由 RunningHub 忽略，传入任意值即可。"
        )

    @property
    def input_model(self):
        return TextToImageInput

    def get_node_info_list(
        self,
        prompt: str,
        aspect_ratio: str = "16:9",
        **kwargs,
    ) -> List[Dict[str, Any]]:
        """
        构造文生图节点信息。

        - 节点 2：根据画幅选择占位图，决定 16:9 / 9:16 / 1:1
        - 节点 25 / 26：RunningHub 会忽略这些节点，传递任何占位值都不会产生影响
        - 节点 16：提示词
        """
        normalized_prompt = self._normalize_prompt(prompt)
        normalized_aspect_ratio = self._normalize_aspect_ratio(aspect_ratio)

        node_info_list: List[Dict[str, Any]] = [
            {
                "nodeId": "2",
                "fieldName": "image",
                "fieldValue": ASPECT_RATIO_TO_IMAGE[normalized_aspect_ratio],
                "description": f"image（选择 {normalized_aspect_ratio} 画幅，无需上传图片）",
            },
            {
                "nodeId": "25",
                "fieldName": "image",
                "fieldValue": IGNORED_NODE_PLACEHOLDER,
                "description": "image（节点 25 会被 RunningHub 忽略，填任意值即可）",
            },
            {
                "nodeId": "26",
                "fieldName": "image",
                "fieldValue": IGNORED_NODE_PLACEHOLDER,
                "description": "image（节点 26 会被 RunningHub 忽略，填任意值即可）",
            },
            {
                "nodeId": "16",
                "fieldName": "prompt",
                "fieldValue": normalized_prompt,
                "description": "prompt",
            },
        ]

        return node_info_list

    @staticmethod
    def _normalize_prompt(prompt: Any) -> str:
        if not isinstance(prompt, str):
            prompt = str(prompt)
        normalized = prompt.strip()
        if not normalized:
            raise ValueError("提示词不能为空")
        return normalized

    @staticmethod
    def _normalize_aspect_ratio(aspect_ratio: Any) -> str:
        if not isinstance(aspect_ratio, str):
            aspect_ratio = str(aspect_ratio)
        normalized = aspect_ratio.strip()
        if normalized not in ASPECT_RATIO_TO_IMAGE:
            raise ValueError(
                f"不支持的画幅 '{aspect_ratio}'，仅支持 {list(ASPECT_RATIO_TO_IMAGE.keys())}"
            )
        return normalized
