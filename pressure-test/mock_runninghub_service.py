from __future__ import annotations

import base64
import io
import json
import os
import threading
import time
import uuid
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/"
    "x8AAwMCAO2l7l0AAAAASUVORK5CYII="
)
PNG_BYTES = base64.b64decode(PNG_1X1_BASE64)


@dataclass
class TaskRecord:
    task_id: str
    created_at: float
    kind: str
    prompt: str = ""
    file_names: List[str] = field(default_factory=list)
    status: str = "PENDING"
    output_urls: List[str] = field(default_factory=list)


class State:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._uploads: Dict[str, bytes] = {}
        self._tasks: Dict[str, TaskRecord] = {}

    def add_upload(self, name: str, data: bytes) -> str:
        file_name = name or f"upload_{uuid.uuid4().hex[:8]}.bin"
        with self._lock:
            self._uploads[file_name] = data
        return file_name

    def create_task(self, kind: str, prompt: str = "", file_names: Optional[List[str]] = None) -> TaskRecord:
        task_id = f"mock_{uuid.uuid4().hex[:12]}"
        output_url = self.build_output_url(task_id)
        record = TaskRecord(
            task_id=task_id,
            created_at=time.time(),
            kind=kind,
            prompt=prompt,
            file_names=file_names or [],
            output_urls=[output_url],
        )
        with self._lock:
            self._tasks[task_id] = record
        return record

    def get_task(self, task_id: str) -> Optional[TaskRecord]:
        with self._lock:
            record = self._tasks.get(task_id)
        if not record:
            return None
        elapsed = time.time() - record.created_at
        if elapsed < 0.3:
            record.status = "PENDING"
        elif elapsed < 0.9:
            record.status = "RUNNING"
        else:
            record.status = "SUCCESS"
        return record

    @staticmethod
    def build_output_url(task_id: str) -> str:
        host = os.environ.get("MOCK_RUNNINGHUB_PUBLIC_BASE_URL", "").strip()
        if not host:
            host = os.environ.get("MOCK_RUNNINGHUB_BASE_URL", "http://mock-runninghub:8080").rstrip("/")
        return f"{host}/artifacts/{task_id}/0.png"


STATE = State()


def _read_json(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    length = int(handler.headers.get("content-length") or "0")
    raw = handler.rfile.read(length) if length > 0 else b""
    if not raw:
        return {}
    try:
        decoded = raw.decode("utf-8")
        payload = json.loads(decoded)
        if isinstance(payload, dict):
            return payload
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    return {}


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _png_response(handler: BaseHTTPRequestHandler, data: bytes) -> None:
    handler.send_response(200)
    handler.send_header("Content-Type", "image/png")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _multipart_summary(content_type: str, body: bytes) -> Dict[str, Any]:
    summary: Dict[str, Any] = {"contentType": content_type, "bytes": len(body)}
    if "boundary=" not in content_type:
        return summary
    boundary = content_type.split("boundary=", 1)[1].strip().strip('"')
    if not boundary:
        return summary
    parts = body.split(f"--{boundary}".encode("utf-8"))
    names: List[str] = []
    for part in parts:
        if b"Content-Disposition:" not in part:
            continue
        header_blob, _, _ = part.partition(b"\r\n\r\n")
        if b'name="' in header_blob:
            try:
                header_text = header_blob.decode("utf-8", errors="ignore")
                marker = 'name="'
                start = header_text.index(marker) + len(marker)
                end = header_text.index('"', start)
                names.append(header_text[start:end])
            except ValueError:
                continue
    summary["fields"] = names
    return summary


class MockRunninghubHandler(BaseHTTPRequestHandler):
    server_version = "MockRunninghubService/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _task_response(self, task: TaskRecord) -> Dict[str, Any]:
        return {"taskId": task.task_id, "status": task.status}

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            _json_response(self, 200, {"status": "healthy", "service": "mock-runninghub-service"})
            return

        if parsed.path.startswith("/artifacts/") and parsed.path.endswith("/0.png"):
            _png_response(self, PNG_BYTES)
            return

        if parsed.path.startswith("/v1/tasks/"):
            task_id = parsed.path.removeprefix("/v1/tasks/").split("/", 1)[0]
            task = STATE.get_task(task_id)
            if not task:
                _json_response(self, 404, {"detail": "task not found"})
                return
            if parsed.path.endswith("/outputs"):
                _json_response(
                    self,
                    200,
                    {
                        "taskId": task.task_id,
                        "outputs": [
                            {
                                "fileUrl": url,
                                "fileType": "png",
                            }
                            for url in task.output_urls
                        ],
                    },
                )
                return
            _json_response(self, 200, self._task_response(task))
            return

        if parsed.path == "/v1/workflows":
            _json_response(self, 200, {"workflows": ["complete_image_edit", "complete_pattern_extract"]})
            return

        _json_response(self, 404, {"detail": "not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/task/openapi/upload":
            length = int(self.headers.get("content-length") or "0")
            body = self.rfile.read(length) if length > 0 else b""
            content_type = self.headers.get("content-type", "")
            summary = _multipart_summary(content_type, body)
            file_name = f"uploaded_{uuid.uuid4().hex[:10]}.bin"
            STATE.add_upload(file_name, body)
            _json_response(self, 200, {"fileName": file_name, "summary": summary})
            return

        if parsed.path == "/task/openapi/ai-app/run":
            payload = _read_json(self)
            webapp_id = str(payload.get("webappId") or "")
            node_info_list = payload.get("nodeInfoList") or []
            prompt = ""
            file_names: List[str] = []
            if isinstance(node_info_list, list):
                for node in node_info_list:
                    if not isinstance(node, dict):
                        continue
                    if isinstance(node.get("prompt"), str):
                        prompt = node["prompt"]
                    if isinstance(node.get("value"), str):
                        prompt = node["value"]
                    if isinstance(node.get("fileName"), str):
                        file_names.append(node["fileName"])
            task = STATE.create_task(kind=webapp_id or "workflow", prompt=prompt, file_names=file_names)
            _json_response(self, 200, {"taskId": task.task_id, "webappId": webapp_id})
            return

        if parsed.path == "/task/openapi/status":
            payload = _read_json(self)
            task_id = str(payload.get("taskId") or "")
            task = STATE.get_task(task_id)
            if not task:
                _json_response(self, 404, {"detail": "task not found"})
                return
            _json_response(self, 200, {"taskId": task.task_id, "status": task.status, "data": task.status})
            return

        if parsed.path == "/task/openapi/outputs":
            payload = _read_json(self)
            task_id = str(payload.get("taskId") or "")
            task = STATE.get_task(task_id)
            if not task:
                _json_response(self, 404, {"detail": "task not found"})
                return
            _json_response(self, 200, {"taskId": task.task_id, "outputs": task.output_urls, "data": task.output_urls})
            return

        if parsed.path.startswith("/v1/complete_"):
            payload = _read_json(self)
            task = STATE.create_task(kind=parsed.path.rsplit("/", 1)[-1], prompt=str(payload.get("prompt") or ""))
            _json_response(self, 200, {"taskId": task.task_id})
            return

        _json_response(self, 404, {"detail": "not found"})


def main() -> None:
    host = os.environ.get("MOCK_RUNNINGHUB_HOST", "0.0.0.0")
    port = int(os.environ.get("MOCK_RUNNINGHUB_PORT", "8080"))
    server = ThreadingHTTPServer((host, port), MockRunninghubHandler)
    print(f"mock-runninghub-service listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
