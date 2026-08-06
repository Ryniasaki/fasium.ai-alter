from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional


class ErrorCode(str, Enum):
    UNAUTHORIZED = "UNAUTHORIZED"
    FORBIDDEN = "FORBIDDEN"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    CONFLICT = "CONFLICT"
    BAD_REQUEST = "BAD_REQUEST"
    TOO_MANY_REQUESTS = "TOO_MANY_REQUESTS"
    UPSTREAM_TIMEOUT = "UPSTREAM_TIMEOUT"
    UPSTREAM_ERROR = "UPSTREAM_ERROR"
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"
    REQUEST_FAILED = "REQUEST_FAILED"


@dataclass
class ErrorPayload:
    code: str
    message: str
    details: Optional[Any]
    request_id: str
    retryable: Optional[bool] = None

    def to_dict(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details,
                "request_id": self.request_id,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        }
        if self.retryable is not None:
            payload["error"]["retryable"] = self.retryable
        return payload


def status_to_error_code(status_code: int) -> ErrorCode:
    if status_code == 400:
        return ErrorCode.BAD_REQUEST
    if status_code == 401:
        return ErrorCode.UNAUTHORIZED
    if status_code == 403:
        return ErrorCode.FORBIDDEN
    if status_code == 404:
        return ErrorCode.NOT_FOUND
    if status_code == 409:
        return ErrorCode.CONFLICT
    if status_code == 422:
        return ErrorCode.VALIDATION_ERROR
    if status_code == 429:
        return ErrorCode.TOO_MANY_REQUESTS
    if status_code == 502:
        return ErrorCode.UPSTREAM_ERROR
    if status_code == 504:
        return ErrorCode.UPSTREAM_TIMEOUT
    if status_code >= 500:
        return ErrorCode.INTERNAL_SERVER_ERROR
    return ErrorCode.REQUEST_FAILED


def infer_error_code(status_code: int, detail: Any) -> ErrorCode:
    text = str(detail).lower() if detail is not None else ""
    if "timeout" in text:
        return ErrorCode.UPSTREAM_TIMEOUT
    if "backend service" in text or "llm service" in text or "poloapi" in text:
        return ErrorCode.UPSTREAM_ERROR
    return status_to_error_code(status_code)

