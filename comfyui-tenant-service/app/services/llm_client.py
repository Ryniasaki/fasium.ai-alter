from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import httpx

from .config import get_settings
from .logger import get_main_logger


class LLMClientError(RuntimeError):
    """Raised when the LLM service cannot fulfill a request."""


class LLMClient:
    """Thin synchronous wrapper around the configured LLM endpoint."""

    def __init__(
        self,
        service_url: Optional[str] = None,
        api_key: Optional[str] = None,
        default_model: Optional[str] = None,
        timeout: float = 60.0,
    ) -> None:
        settings = get_settings()
        self._logger = get_main_logger()
        self._service_url = (service_url or settings.llm_service_url or "").rstrip("/")
        self._api_key = api_key or settings.llm_api_key
        self._default_model = default_model or settings.llm_default_model
        self._timeout = timeout

    def is_configured(self) -> bool:
        return bool(self._service_url and self._api_key)

    def chat_json(
        self,
        messages: List[Dict[str, Any]],
        response_format: Optional[Dict[str, Any]] = None,
        temperature: float = 0.2,
        max_output_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        if not self.is_configured():
            raise LLMClientError("LLM service URL or API key is not configured.")

        endpoint = f"{self._service_url}/chat/completions"
        payload: Dict[str, Any] = {
            "model": self._default_model,
            "messages": messages,
            "temperature": temperature,
        }
        if response_format:
            payload["response_format"] = response_format
        if max_output_tokens is not None:
            payload["max_output_tokens"] = max_output_tokens

        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

        try:
            with httpx.Client(timeout=self._timeout) as client:
                response = client.post(endpoint, headers=headers, json=payload)
                response.raise_for_status()
        except httpx.HTTPError as exc:
            message = f"LLM request failed: {exc}"
            self._logger.error(message)
            raise LLMClientError(message) from exc

        try:
            data = response.json()
            choice = data["choices"][0]
            content = choice["message"]["content"]
            if isinstance(content, str):
                return json.loads(content)
            if isinstance(content, list):
                # Some providers return a list of content blocks.
                joined = "".join(block.get("text", "") for block in content if isinstance(block, dict))
                return json.loads(joined)
            raise ValueError("Unsupported message content type from LLM response.")
        except (KeyError, ValueError, json.JSONDecodeError) as exc:
            message = f"Failed to parse LLM response: {exc}"
            self._logger.error(message)
            raise LLMClientError(message) from exc
