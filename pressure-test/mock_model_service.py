from __future__ import annotations

import base64
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List
from urllib.parse import urlparse


PNG_1X1_BASE64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/"
    "x8AAwMCAO2l7l0AAAAASUVORK5CYII="
)
PNG_BYTES = base64.b64decode(PNG_1X1_BASE64)


def _read_json(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
    length = int(handler.headers.get("content-length") or "0")
    raw = handler.rfile.read(length) if length > 0 else b""
    if not raw:
        return {}
    try:
        payload = json.loads(raw.decode("utf-8"))
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass
    return {}


def _json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _extract_prompt(messages: List[Dict[str, Any]]) -> str:
    if not messages:
        return ""
    first = messages[0] or {}
    content = first.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts: List[str] = []
        for item in content:
            if isinstance(item, dict):
                if isinstance(item.get("text"), str):
                    texts.append(item["text"])
        return " ".join(texts).strip()
    return ""


def _has_image_part(messages: List[Dict[str, Any]]) -> bool:
    for message in messages:
        content = (message or {}).get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                return True
    return False


class MockModelHandler(BaseHTTPRequestHandler):
    server_version = "MockModelService/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            _json_response(self, 200, {"status": "healthy", "service": "mock-model-service"})
            return
        if parsed.path == "/v1/models":
            _json_response(
                self,
                200,
                {
                    "object": "list",
                    "data": [
                        {"id": "mock-gpt-4.1", "object": "model"},
                        {"id": "mock-gemini-2.5-flash-image", "object": "model"},
                    ],
                },
            )
            return
        _json_response(self, 404, {"detail": "not found"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/v1/chat/completions":
            _json_response(self, 404, {"detail": "not found"})
            return

        payload = _read_json(self)
        messages = payload.get("messages") or []
        if not isinstance(messages, list):
            messages = []

        model = str(payload.get("model") or "mock-model")
        prompt = _extract_prompt(messages)
        if _has_image_part(messages):
            data_url = f"data:image/png;base64,{PNG_1X1_BASE64}"
            response = {
                "id": "mock-image-completion",
                "object": "chat.completion",
                "created": 1710000000,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {
                            "role": "assistant",
                            "content": [
                                {
                                    "type": "image_url",
                                    "image_url": {"url": data_url},
                                }
                            ],
                        },
                    }
                ],
            }
            _json_response(self, 200, response)
            return

        content = json.dumps(
            {
                "ok": True,
                "mock": True,
                "model": model,
                "prompt": prompt,
            },
            ensure_ascii=False,
        )
        response = {
            "id": "mock-text-completion",
            "object": "chat.completion",
            "created": 1710000000,
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {"role": "assistant", "content": content},
                }
            ],
        }
        _json_response(self, 200, response)


def main() -> None:
    host = os.environ.get("MOCK_MODEL_HOST", "0.0.0.0")
    port = int(os.environ.get("MOCK_MODEL_PORT", "9000"))
    server = ThreadingHTTPServer((host, port), MockModelHandler)
    print(f"mock-model-service listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
