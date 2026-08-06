"""
Variant overlay workflow

Automatically uploads the provided image file to RunningHub and then triggers
the AI-App with webappId 1976162186252959746 (nodeId 388).
"""
from typing import Dict, Any, List, Optional
from pydantic import BaseModel
from fastapi import UploadFile

from .workflow_manager import Workflow
from app.services.runninghub_client import RunninghubClient
from app.services.config import get_settings
from app.services.logger import get_runninghub_logger


class VariantOverlayInput(BaseModel):
    """Variant overlay workflow input parameters (for already uploaded images)."""

    image_name: str


class VariantOverlayWorkflow(Workflow):
    """Workflow that uploads an image (if necessary) and triggers variant overlay."""

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
        # Matches the provided curl example
        return "1976162186252959746"

    @property
    def name(self) -> str:
        return "variant_overlay"

    @property
    def display_name(self) -> str:
        return "Variant Overlay"

    @property
    def description(self) -> str:
        return "Upload an image and trigger the variant overlay AI-App on RunningHub."

    @property
    def input_model(self):
        return VariantOverlayInput

    def get_node_info_list(self, image_name: str, **kwargs) -> List[Dict[str, Any]]:
        if not image_name or not image_name.strip():
            raise ValueError("image_name is required")

        return [
            {
                "nodeId": "388",
                "fieldName": "image",
                "fieldValue": image_name,
                "description": "image",
            }
        ]

    async def execute_workflow(
        self,
        file: Optional[UploadFile] = None,
        fileType: str = "image",
        image_name: str = "",
        **kwargs,
    ) -> Dict[str, Any]:
        """
        Upload the provided image file (if given) and trigger the workflow.

        Args:
            file: Image file to upload.
            fileType: Type of the file (default "image").
            image_name: Existing image name on RunningHub (optional).
        """
        if file:
            self.logger.info(f"Uploading image for variant overlay: {file.filename}")
            uploaded = await self.client.upload_file(file=file, file_type=fileType)
            if isinstance(uploaded, dict):
                image_name = uploaded.get("fileName", str(uploaded))
            else:
                image_name = str(uploaded)

        if not image_name or not image_name.strip():
            raise ValueError("image_name is required (either upload a file or provide image_name)")

        node_info_list = self.get_node_info_list(image_name=image_name)
        self.logger.info(f"Triggering variant overlay workflow with image: {image_name}")

        task_id = await self.client.create_task(
            webapp_id=self.webapp_id,
            node_info_list=node_info_list,
        )

        if isinstance(task_id, dict):
            task_id = task_id.get("taskId", str(task_id))
        else:
            task_id = str(task_id)

        if not task_id:
            raise ValueError("Failed to create variant overlay task")

        response: Dict[str, Any] = {
            "taskId": task_id,
            "status": "created",
            "message": "Variant overlay task has been created",
        }

        if file and hasattr(file, "filename"):
            response["uploadedFileName"] = file.filename

        return response
