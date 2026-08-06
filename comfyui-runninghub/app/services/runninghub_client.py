from typing import Any, Optional
import json
import httpx
from fastapi import UploadFile
from .config import get_settings
from .logger import get_runninghub_logger


class RunninghubClient:
    def __init__(self, base_url: str, api_key: str, timeout_seconds: int = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.timeout = httpx.Timeout(timeout_seconds)
        # Avoid inheriting host proxy settings that can break direct access to RunningHub upstream.
        self._client = httpx.AsyncClient(timeout=self.timeout, trust_env=False)
        self.logger = get_runninghub_logger()

    async def upload_file(self, file: UploadFile, file_type: str, file_bytes: Optional[bytes] = None) -> str:
        url = f"{self.base_url}/task/openapi/upload"
        if file_bytes is None:
            file_bytes = await file.read()
        form = {
            "apiKey": (None, self.api_key),
            "fileType": (None, file_type),
            "file": (file.filename, file_bytes, file.content_type or "application/octet-stream"),
        }
        resp = await self._client.post(url, files=form)
        resp.raise_for_status()
        data = resp.json()
        
        # 处理不同的响应格式
        if isinstance(data, dict):
            # 如果返回的是字典，提取fileName
            if "fileName" in data:
                return data["fileName"]
            elif "data" in data and isinstance(data["data"], dict):
                return data["data"].get("fileName", "")
            elif "data" in data and isinstance(data["data"], str):
                return data["data"]
        
        # 如果返回的是字符串，直接返回
        if isinstance(data, str):
            return data
            
        return ""

    async def create_task(self, webapp_id: str, node_info_list: list[dict]) -> str:
        url = f"{self.base_url}/task/openapi/ai-app/run"
        payload: dict[str, Any] = {
            "apiKey": self.api_key,
            "webappId": webapp_id,
            "nodeInfoList": node_info_list,
        }
        
        self.logger.debug(f"发送请求到: {url}")
        self.logger.debug(f"请求数据: {payload}")
        try:
            request_body = json.dumps(payload, ensure_ascii=False)
        except (TypeError, ValueError):
            request_body = str(payload)
        self.logger.info(f"RunningHub create_task 请求体: {request_body}")
        
        resp = await self._client.post(url, json=payload)
        self.logger.debug(f"响应状态: {resp.status_code}")
        self.logger.debug(f"响应头: {dict(resp.headers)}")
        
        resp.raise_for_status()
        data = resp.json()
        self.logger.debug(f"响应数据: {data}")
        
        # 处理不同的响应格式
        task_id = ""
        
        if isinstance(data, dict):
            # 如果taskId是字典，提取其中的taskId字段
            task_id_obj = data.get("taskId")
            if isinstance(task_id_obj, dict):
                task_id = task_id_obj.get("taskId", "")
            elif isinstance(task_id_obj, str):
                task_id = task_id_obj
            else:
                task_id = data.get("data", "")
        elif isinstance(data, str):
            task_id = data
        
        if not task_id:
            self.logger.warning(f"未获取到任务ID，响应数据: {data}")
        
        self.logger.debug(f"提取的任务ID: {task_id}")
        return task_id

    async def get_status(self, task_id: str) -> str:
        url = f"{self.base_url}/task/openapi/status"
        payload = {"apiKey": self.api_key, "taskId": task_id}
        self.logger.debug(f"查询任务状态: {task_id}")
        
        resp = await self._client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        status = data.get("status") or data.get("data") or ""
        self.logger.debug(f"任务状态: {status}")
        return status

    async def get_outputs(self, task_id: str) -> list[str]:
        url = f"{self.base_url}/task/openapi/outputs"
        payload = {"apiKey": self.api_key, "taskId": task_id}
        self.logger.debug(f"获取任务结果: {task_id}")
        
        resp = await self._client.post(url, json=payload)
        resp.raise_for_status()
        data = resp.json()
        outputs = data.get("outputs") or data.get("data") or []
        self.logger.debug(f"任务结果: {outputs}")
        return outputs


def get_runninghub_client():
    s = get_settings()
    return RunninghubClient(base_url=s.runninghub_host, api_key=s.runninghub_api_key, timeout_seconds=s.request_timeout_seconds)
