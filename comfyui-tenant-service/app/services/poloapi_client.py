from __future__ import annotations

import base64
from typing import Any, Dict, List, Optional, Sequence, Tuple, Literal

import httpx

from .config import get_settings
from .logger import get_main_logger


class PoloAPIError(RuntimeError):
    """Raised when PoloAPI call fails."""


def _format_httpx_error(exc: httpx.HTTPError) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        response_text = (exc.response.text or "").strip()
        if response_text:
            return f"{str(exc).strip()} | response={response_text[:500]}"
    message = str(exc).strip()
    if message:
        return message
    return exc.__class__.__name__


def _resolve_poloapi_api_key(*, settings: Any, mode: Literal["text", "image", "audit"]) -> Optional[str]:
    if mode == "text":
        return settings.poloapi_text_apikey or settings.poloapi_apikey
    if mode == "audit":
        return settings.poloapi_audit_apikey or settings.poloapi_text_apikey or settings.poloapi_apikey
    return settings.poloapi_image_apikey or settings.poloapi_apikey


def _resolve_poloapi_base_url(*, settings: Any, mode: Literal["text", "image", "audit"]) -> str:
    if mode == "text":
        raw = settings.poloapi_text_base_url or settings.poloapi_base_url
    elif mode == "audit":
        raw = settings.poloapi_audit_base_url or settings.poloapi_text_base_url or settings.poloapi_base_url
    else:
        raw = settings.poloapi_image_base_url or settings.poloapi_base_url
    return (raw or "https://work.poloapi.com/v1").rstrip("/")


def _build_authorization_header(*, api_key: str, base_url: str) -> str:
    key = (api_key or "").strip()
    if key.lower().startswith("bearer "):
        return key
    # Google AI Studio, DeepSeek, and CherryIN OpenAI-compatible endpoints require Bearer auth.
    host = (base_url or "").lower()
    if "generativelanguage.googleapis.com" in host or "api.deepseek.com" in host or "open.cherryin.net" in host:
        return f"Bearer {key}"
    return key


def _normalize_model_for_base_url(*, base_url: str, model: str) -> str:
    resolved_model = (model or "").strip()
    host = (base_url or "").lower()
    # Cherry gateway expects provider-qualified model names (e.g. google/gemini-3-flash-preview).
    if "open.cherryin.net" in host and "/" not in resolved_model and resolved_model:
        return f"google/{resolved_model}"
    return resolved_model


def _is_google_native_image_request(*, base_url: str, model: str) -> bool:
    normalized = (model or "").strip().removeprefix("models/")
    return "generativelanguage.googleapis.com" in (base_url or "").lower() and normalized == "gemini-3.1-flash-image-preview"


def _resolve_google_native_base_url(base_url: str) -> str:
    resolved = (base_url or "").rstrip("/")
    if resolved.lower().endswith("/openai"):
        resolved = resolved[: -len("/openai")]
    return resolved


def _extract_google_inline_image(payload: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    candidates = payload.get("candidates") or []
    for candidate in candidates:
        content = (candidate or {}).get("content") or {}
        parts = content.get("parts") or []
        for part in parts:
            inline_data = (part or {}).get("inlineData") or {}
            mime_type = inline_data.get("mimeType")
            data = inline_data.get("data")
            if isinstance(mime_type, str) and isinstance(data, str) and mime_type and data:
                return mime_type, data
    return None


def resolve_poloapi_model(
    *,
    requested_model: str | None = None,
    fallback_model: str | None = None,
    mode: Literal["text", "image", "audit"] = "image",
) -> str:
    """Resolve the effective PoloAPI model from centralized settings."""
    settings = get_settings()
    if requested_model and requested_model.strip():
        return requested_model.strip()
    if mode == "audit":
        audit_model = (settings.poloapi_audit_model or "").strip()
        if audit_model:
            return audit_model
    if fallback_model and fallback_model.strip():
        return fallback_model.strip()
    singleton_model = (settings.poloapi_singleton_model or "").strip()
    if singleton_model:
        return singleton_model
    if mode == "text":
        text_model = (settings.poloapi_text_model or "").strip()
        if text_model:
            return text_model
    elif mode == "audit":
        text_model = (settings.poloapi_text_model or "").strip()
        if text_model:
            return text_model
    else:
        image_model = (settings.poloapi_image_model or "").strip()
        if image_model:
            return image_model
    return (settings.poloapi_default_model or "").strip()


async def call_poloapi_chat(
    messages: Sequence[Dict[str, Any]],
    *,
    model: str | None = None,
    response_format: Optional[Dict[str, Any]] = None,
    temperature: Optional[float] = None,
    mode: Literal["text", "audit"] = "text",
) -> Dict[str, Any]:
    """
    Invoke PoloAPI chat completion with OpenAI-style messages.

    Args:
        messages: List of OpenAI-compatible message dicts.
        model: Optional override for the target model name.
    """

    settings = get_settings()
    default_model = resolve_poloapi_model(
        requested_model=model,
        fallback_model=(
            settings.poloapi_audit_model
            if mode == "audit"
            else settings.poloapi_text_model
        )
        or settings.poloapi_default_model,
        mode=mode,
    )
    logger = get_main_logger()

    if not default_model:
        raise PoloAPIError("PoloAPI model is not configured")

    api_key = _resolve_poloapi_api_key(settings=settings, mode=mode)
    if not api_key:
        raise PoloAPIError("PoloAPI API key is not configured")
    base_url = _resolve_poloapi_base_url(settings=settings, mode=mode)
    default_model = _normalize_model_for_base_url(base_url=base_url, model=default_model)

    payload: Dict[str, Any] = {
        "model": default_model,
        "stream": False,
        "messages": list(messages),
    }
    if response_format is not None:
        payload["response_format"] = response_format
    if temperature is not None:
        payload["temperature"] = temperature

    headers = {
        "Accept": "application/json",
        "Authorization": _build_authorization_header(api_key=api_key, base_url=base_url),
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=600, trust_env=False) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        message = _format_httpx_error(exc)
        logger.error("PoloAPI request failed: %s", message)
        raise PoloAPIError(f"PoloAPI request failed: {message}") from exc


async def call_poloapi_image_chat(
    prompt: str,
    images: Optional[Sequence[Tuple[bytes, str]]] = None,
    *,
    model: str | None = None,
) -> Dict[str, Any]:
    """
    Invoke PoloAPI image-enabled chat completion.

    Args:
        prompt: User text prompt.
        images: Optional sequence of (image_bytes, mime_type).
        model: Optional override for the target model name.
    """

    settings = get_settings()
    default_model = resolve_poloapi_model(
        requested_model=model,
        fallback_model=settings.poloapi_image_model or settings.poloapi_default_model,
        mode="image",
    )
    logger = get_main_logger()

    if not default_model:
        raise PoloAPIError("PoloAPI model is not configured")

    api_key = _resolve_poloapi_api_key(settings=settings, mode="image")
    if not api_key:
        raise PoloAPIError("POLOAPI_IMAGE_APIKEY or POLOAPI_APIKEY is not configured")
    base_url = _resolve_poloapi_base_url(settings=settings, mode="image")
    default_model = _normalize_model_for_base_url(base_url=base_url, model=default_model)
    images_seq: Sequence[Tuple[bytes, str]] = images or []

    contents: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
    for image_bytes, mime in images_seq:
        encoded = base64.b64encode(image_bytes).decode("utf-8")
        mime_type = mime or "image/jpeg"
        contents.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
            }
        )

    payload: Dict[str, Any] = {
        "model": default_model,
        "stream": False,
        "messages": [
            {
                "role": "user",
                "content": contents,
            }
        ],
    }

    headers = {
        "Accept": "application/json",
        "Authorization": _build_authorization_header(api_key=api_key, base_url=base_url),
        "Content-Type": "application/json",
    }

    if _is_google_native_image_request(base_url=base_url, model=default_model):
        google_base_url = _resolve_google_native_base_url(base_url)
        google_model = default_model.removeprefix("models/")
        native_parts: List[Dict[str, Any]] = [{"text": prompt}]
        for image_bytes, mime in images_seq:
            native_parts.append(
                {
                    "inlineData": {
                        "mimeType": mime or "image/jpeg",
                        "data": base64.b64encode(image_bytes).decode("utf-8"),
                    }
                }
            )

        native_payload: Dict[str, Any] = {
            "contents": [{"role": "user", "parts": native_parts}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]},
        }
        native_headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        }

        try:
            async with httpx.AsyncClient(timeout=600, trust_env=False) as client:
                response = await client.post(
                    f"{google_base_url}/models/{google_model}:generateContent",
                    headers=native_headers,
                    json=native_payload,
                )
                response.raise_for_status()
                native_response = response.json()
        except httpx.HTTPError as exc:
            message = _format_httpx_error(exc)
            logger.error("PoloAPI request failed: %s", message)
            raise PoloAPIError(f"PoloAPI request failed: {message}") from exc

        image_payload = _extract_google_inline_image(native_response)
        if not image_payload:
            raise PoloAPIError("Google image model did not return inline image data")
        mime_type, image_b64 = image_payload
        data_url = f"data:{mime_type};base64,{image_b64}"
        return {
            "id": native_response.get("responseId") or "google-native-image",
            "object": "chat.completion",
            "model": default_model,
            "choices": [
                {
                    "index": 0,
                    "finish_reason": "stop",
                    "message": {
                        "role": "assistant",
                        "content": [{"type": "image_url", "image_url": {"url": data_url}}],
                    },
                }
            ],
        }

    try:
        async with httpx.AsyncClient(timeout=600, trust_env=False) as client:
            response = await client.post(
                f"{base_url}/chat/completions",
                headers=headers,
                json=payload,
            )
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        message = _format_httpx_error(exc)
        logger.error("PoloAPI request failed: %s", message)
        raise PoloAPIError(f"PoloAPI request failed: {message}") from exc
