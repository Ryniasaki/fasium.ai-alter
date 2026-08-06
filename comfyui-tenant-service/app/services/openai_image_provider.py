from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import mimetypes
import re
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

from .config import get_settings
from .image_storage import image_storage_service
from .logger import get_main_logger
from .poloapi_client import PoloAPIError, call_poloapi_image_chat, resolve_poloapi_model


class ImageProviderError(RuntimeError):
    """Raised when an image provider request fails."""


@dataclass
class GeneratedImageResult:
    image_url: Optional[str] = None
    b64_json: Optional[str] = None
    raw_result: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class VodImageTaskConfig:
    model_name: str
    model_version: str
    resolution: Optional[str] = None
    aspect_ratio: Optional[str] = None
    max_reference_images: int = 4
    billing_model_name: Optional[str] = None
    is_image2: bool = False


VOD_IMAGE2_REQUEST_MARKERS = {
    "gpt-image-2",
    "image2",
    "og:image2",
    "og-image2",
    "vod:image2",
    "vod-image2",
}

VOD_IMAGE2_ALLOWED_ASPECT_RATIOS = {
    "1:1",
    "3:2",
    "2:3",
    "3:4",
    "4:3",
    "16:9",
    "9:16",
    "21:9",
    "9:21",
}


def _normalize_vod_model_marker(model: Optional[str]) -> str:
    return (model or "").strip().lower()


def resolve_vod_image_task_config(
    *,
    settings: Any,
    requested_model: Optional[str] = None,
) -> VodImageTaskConfig:
    normalized_model = _normalize_vod_model_marker(requested_model)
    if normalized_model in VOD_IMAGE2_REQUEST_MARKERS:
        model_version = (settings.vod_image2_model_version or "image2_medium").strip() or "image2_medium"
        resolution = (settings.vod_image2_resolution or "1K").strip() or "1K"
        aspect_ratio = (settings.vod_image2_aspect_ratio or "").strip() or None
        if aspect_ratio and aspect_ratio not in VOD_IMAGE2_ALLOWED_ASPECT_RATIOS:
            raise ImageProviderError(f"Unsupported VOD OG image2 aspect ratio: {aspect_ratio}")
        return VodImageTaskConfig(
            model_name="OG",
            model_version=model_version,
            resolution=resolution,
            aspect_ratio=aspect_ratio,
            max_reference_images=3,
            billing_model_name=f"OG:{model_version}",
            is_image2=True,
        )

    model_name = (settings.vod_model_name or "GEM").strip() or "GEM"
    model_version = (settings.vod_model_version or "3.1").strip() or "3.1"
    return VodImageTaskConfig(
        model_name=model_name,
        model_version=model_version,
        billing_model_name=f"{model_name}:{model_version}",
    )


def _build_vod_output_config(config: VodImageTaskConfig) -> Dict[str, Any]:
    output_config: Dict[str, Any] = {"StorageMode": "Temporary"}
    if config.resolution:
        output_config["Resolution"] = config.resolution
    if config.aspect_ratio:
        output_config["AspectRatio"] = config.aspect_ratio
    return output_config


def _guess_mime_type(filename: str, fallback: str = "image/png") -> str:
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or fallback


def _decode_data_url(data_url: str) -> Tuple[bytes, str]:
    if not data_url.startswith("data:") or "," not in data_url:
        raise ImageProviderError("Unsupported image data returned by provider")
    header, payload = data_url.split(",", 1)
    mime_type = "image/png"
    if ";" in header:
        mime_type = header.split(";", 1)[0].removeprefix("data:") or mime_type
    try:
        return base64.b64decode(payload), mime_type
    except (ValueError, binascii.Error) as exc:
        raise ImageProviderError("Failed to decode returned image data") from exc


def _extract_poloapi_data_url(payload: Dict[str, Any]) -> Optional[str]:
    choices = payload.get("choices") or []
    if not choices:
        return None
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")

    if isinstance(content, dict):
        image_url = content.get("image_url")
        if isinstance(image_url, dict):
            url = image_url.get("url")
            if isinstance(url, str) and url:
                return url
        if content.get("type") == "image_url":
            url = content.get("url")
            if isinstance(url, str) and url:
                return url
        text_value = content.get("text")
        if isinstance(text_value, str):
            match = re.search(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)", text_value)
            if match:
                return match.group(1)

    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            image_url = part.get("image_url")
            if isinstance(image_url, dict):
                url = image_url.get("url")
                if isinstance(url, str) and url:
                    return url
            if part.get("type") == "image_url":
                url = part.get("url")
                if isinstance(url, str) and url:
                    return url
        text_parts: List[str] = []
        for part in content:
            if isinstance(part, dict):
                text_value = part.get("text")
                if isinstance(text_value, str):
                    text_parts.append(text_value)
            elif isinstance(part, str):
                text_parts.append(part)
        if text_parts:
            text_payload = "".join(text_parts)
            match = re.search(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)", text_payload)
            if match:
                return match.group(1)
    if isinstance(content, str):
        match = re.search(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)", content)
        if match:
            return match.group(1)
    return None


async def _load_provider_image_bytes(data_url_or_http_url: str) -> Tuple[bytes, str]:
    if data_url_or_http_url.startswith("data:"):
        return _decode_data_url(data_url_or_http_url)

    async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
        response = await client.get(data_url_or_http_url)
        response.raise_for_status()
    mime_type = (response.headers.get("content-type") or "image/png").split(";")[0] or "image/png"
    return response.content, mime_type


def _summarize_poloapi_content(payload: Dict[str, Any]) -> Dict[str, Any]:
    choices = payload.get("choices") or []
    if not choices:
        return {"choices": 0}
    message = (choices[0] or {}).get("message") or {}
    content = message.get("content")
    summary: Dict[str, Any] = {"choices": len(choices), "content_type": type(content).__name__}
    if isinstance(content, list):
        summary["parts"] = [
            {
                "type": part.get("type") if isinstance(part, dict) else type(part).__name__,
                "has_image_url": isinstance(part, dict) and isinstance(part.get("image_url"), dict),
            }
            for part in content
        ]
    elif isinstance(content, dict):
        summary["type"] = content.get("type")
        image_url = content.get("image_url")
        summary["has_image_url"] = isinstance(image_url, dict)
    elif isinstance(content, str):
        summary["preview"] = content[:200]
    return summary


def _extract_public_image_url(base_url: str, local_path: str) -> str:
    relative_path = Path(local_path).resolve().relative_to(image_storage_service.base_storage_path.resolve())
    return f"{base_url.rstrip('/')}/proxy/static/images/{relative_path.as_posix()}"


def _build_openai_images_response(
    *,
    response_format: str,
    result: GeneratedImageResult,
) -> Dict[str, Any]:
    item: Dict[str, Any]
    if response_format == "b64_json":
        if not result.b64_json:
            raise ImageProviderError("Provider did not return base64 image data")
        item = {"b64_json": result.b64_json}
    else:
        if not result.image_url:
            raise ImageProviderError("Provider did not return image url")
        item = {"url": result.image_url}

    response = {
        "created": int(time.time()),
        "data": [item],
    }
    if result.raw_result is not None:
        response["_meta"] = result.raw_result
    return response


class VodOpenAIImageProvider:
    def __init__(self) -> None:
        self.settings = get_settings()
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.exception.tencent_cloud_sdk_exception import (
                TencentCloudSDKException,
            )
            from tencentcloud.common.profile.client_profile import ClientProfile
            from tencentcloud.common.profile.http_profile import HttpProfile
            from tencentcloud.vod.v20180717.vod_client import VodClient
        except ImportError as exc:
            raise ImageProviderError(
                "tencentcloud-sdk-python is not installed. Install it in the tenant service environment."
            ) from exc

        self._credential_cls = credential.Credential
        self._tencent_exception_cls = TencentCloudSDKException
        self._client_profile_cls = ClientProfile
        self._http_profile_cls = HttpProfile
        self._vod_client_cls = VodClient
        secret_id = (self.settings.vod_secret_id or "").strip()
        secret_key = (self.settings.vod_secret_key or "").strip()
        if not secret_id or not secret_key:
            raise ImageProviderError("VOD_SECRET_ID and VOD_SECRET_KEY must be configured")
        if self.settings.vod_sub_app_id is None:
            raise ImageProviderError("VOD_SUB_APP_ID must be configured")

        cred = self._credential_cls(secret_id, secret_key)
        http_profile = self._http_profile_cls(
            endpoint=self.settings.vod_endpoint,
            reqTimeout=self.settings.vod_http_timeout_ms / 1000.0,
        )
        client_profile = self._client_profile_cls(httpProfile=http_profile)
        self.client = self._vod_client_cls(cred, self.settings.vod_region, client_profile)
        self.logger = get_main_logger()

    def _call_action(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        try:
            body = self.client.call(action, params, headers={})
        except self._tencent_exception_cls as exc:
            raise ImageProviderError(f"VOD request failed: {exc}") from exc
        payload = json.loads(body)
        response = payload.get("Response", payload)
        error = response.get("Error")
        if isinstance(error, dict):
            message = error.get("Message") or "VOD request failed"
            code = error.get("Code")
            raise ImageProviderError(f"{code}: {message}" if code else str(message))
        return response

    @staticmethod
    def _sha1_hex(data: bytes) -> str:
        return hashlib.sha1(data).hexdigest()

    @staticmethod
    def _hmac_sha1_hex(key: str, msg: str) -> str:
        return hmac.new(key.encode("utf-8"), msg.encode("utf-8"), hashlib.sha1).hexdigest()

    def _build_cos_authorization(
        self,
        *,
        secret_id: str,
        secret_key: str,
        method: str,
        host: str,
        path: str,
        start_ts: int,
        end_ts: int,
    ) -> str:
        sign_time = f"{start_ts};{end_ts}"
        header_list = "host"
        http_string = f"{method.lower()}\n{path}\n\nhost={host}\n"
        http_string_sha1 = self._sha1_hex(http_string.encode("utf-8"))
        string_to_sign = f"sha1\n{sign_time}\n{http_string_sha1}\n"
        sign_key = self._hmac_sha1_hex(secret_key, sign_time)
        signature = self._hmac_sha1_hex(sign_key, string_to_sign)
        return (
            f"q-sign-algorithm=sha1&q-ak={secret_id}&q-sign-time={sign_time}"
            f"&q-key-time={sign_time}&q-header-list={header_list}"
            f"&q-url-param-list=&q-signature={signature}"
        )

    async def _upload_reference_image(
        self,
        *,
        filename: str,
        file_bytes: bytes,
        mime_type: str,
    ) -> Dict[str, str]:
        media_type = Path(filename).suffix.lstrip(".").lower() or mime_type.split("/")[-1].lower()
        apply_response = self._call_action(
            "ApplyUpload",
            {
                "SubAppId": self.settings.vod_sub_app_id,
                "MediaType": media_type,
                "MediaName": filename,
            },
        )

        bucket = apply_response["StorageBucket"]
        region = apply_response["StorageRegion"]
        storage_path = apply_response["MediaStoragePath"]
        temp_certificate = apply_response["TempCertificate"]
        host = f"{bucket}.cos.{region}.myqcloud.com"
        upload_url = f"https://{host}{storage_path}"
        authorization = self._build_cos_authorization(
            secret_id=temp_certificate["SecretId"],
            secret_key=temp_certificate["SecretKey"],
            method="PUT",
            host=host,
            path=storage_path,
            start_ts=int(time.time()) - 60,
            end_ts=temp_certificate["ExpiredTime"],
        )

        async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
            response = await client.put(
                upload_url,
                content=file_bytes,
                headers={
                    "Host": host,
                    "Authorization": authorization,
                    "x-cos-security-token": temp_certificate["Token"],
                    "Content-Type": mime_type,
                },
            )
        if response.status_code >= 400:
            raise ImageProviderError(f"VOD COS upload failed: {response.text or response.status_code}")

        commit_response = self._call_action(
            "CommitUpload",
            {
                "SubAppId": self.settings.vod_sub_app_id,
                "VodSessionKey": apply_response["VodSessionKey"],
            },
        )
        file_id = commit_response.get("FileId")
        if not file_id:
            raise ImageProviderError("VOD CommitUpload returned no FileId")
        return {
            "file_id": str(file_id),
            "media_url": str(commit_response.get("MediaUrl") or ""),
        }

    def _extract_output_url(self, detail: Dict[str, Any]) -> Optional[str]:
        aigc_task = detail.get("AigcImageTask") or {}
        output = aigc_task.get("Output") or {}
        file_infos = output.get("FileInfos") or []
        for item in file_infos:
            file_url = item.get("FileUrl")
            if isinstance(file_url, str) and file_url:
                return file_url
        return None

    async def _wait_for_task_result(self, task_id: str) -> Dict[str, Any]:
        deadline = time.time() + float(self.settings.vod_task_timeout_seconds)
        while time.time() < deadline:
            detail = self._call_action("DescribeTaskDetail", {"TaskId": task_id})
            status = str(detail.get("Status") or "").upper()
            aigc_task = detail.get("AigcImageTask") or {}
            if status == "FINISH":
                err_code = int(aigc_task.get("ErrCode") or 0)
                if err_code:
                    raise ImageProviderError(
                        aigc_task.get("Message") or f"VOD task finished with error {err_code}"
                    )
                return detail
            if status in {"FAIL", "FAILED", "ERROR", "CANCELED", "CANCELLED"}:
                raise ImageProviderError(
                    aigc_task.get("Message") or detail.get("Message") or "VOD task failed"
                )
            await asyncio.sleep(float(self.settings.vod_task_poll_interval_seconds))
        raise ImageProviderError(f"Timed out waiting for VOD task result: {task_id}")

    async def generate(
        self,
        *,
        prompt: str,
        response_format: str,
        model: Optional[str],
    ) -> GeneratedImageResult:
        config = resolve_vod_image_task_config(settings=self.settings, requested_model=model)
        response = self._call_action(
            "CreateAigcImageTask",
            {
                "SubAppId": self.settings.vod_sub_app_id,
                "ModelName": config.model_name,
                "ModelVersion": config.model_version,
                "Prompt": prompt,
                "OutputConfig": _build_vod_output_config(config),
            },
        )
        task_id = response.get("TaskId")
        if not task_id:
            raise ImageProviderError("VOD CreateAigcImageTask returned no TaskId")
        detail = await self._wait_for_task_result(str(task_id))
        image_url = self._extract_output_url(detail)
        if not image_url:
            raise ImageProviderError("VOD task finished without output image url")
        if response_format == "b64_json":
            async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
                resp = await client.get(image_url)
                resp.raise_for_status()
            return GeneratedImageResult(
                b64_json=base64.b64encode(resp.content).decode("ascii"),
                raw_result={"task_id": task_id, "provider": "vod"},
            )
        return GeneratedImageResult(
            image_url=image_url,
            raw_result={"task_id": task_id, "provider": "vod"},
        )

    async def edit(
        self,
        *,
        prompt: str,
        images: Sequence[Tuple[str, bytes, str]],
        response_format: str,
        model: Optional[str],
    ) -> GeneratedImageResult:
        config = resolve_vod_image_task_config(settings=self.settings, requested_model=model)
        if not images:
            # VOD can fall back to pure text-to-image when no reference image is supplied.
            return await self.generate(
                prompt=prompt,
                response_format=response_format,
                model=model,
            )
        if config.is_image2 and len(images) > config.max_reference_images:
            raise ImageProviderError("VOD OG image2 supports up to 3 reference images")
        uploads = []
        for filename, file_bytes, mime_type in images[: config.max_reference_images if config.is_image2 else len(images)]:
            uploads.append(
                await self._upload_reference_image(
                    filename=filename,
                    file_bytes=file_bytes,
                    mime_type=mime_type,
                )
            )

        response = self._call_action(
            "CreateAigcImageTask",
            {
                "SubAppId": self.settings.vod_sub_app_id,
                "ModelName": config.model_name,
                "ModelVersion": config.model_version,
                "FileInfos": [{"FileId": item["file_id"]} for item in uploads],
                "Prompt": prompt,
                "OutputConfig": _build_vod_output_config(config),
            },
        )
        task_id = response.get("TaskId")
        if not task_id:
            raise ImageProviderError("VOD CreateAigcImageTask returned no TaskId")
        detail = await self._wait_for_task_result(str(task_id))
        image_url = self._extract_output_url(detail)
        if not image_url:
            raise ImageProviderError("VOD task finished without output image url")
        if response_format == "b64_json":
            async with httpx.AsyncClient(timeout=120.0, trust_env=False) as client:
                resp = await client.get(image_url)
                resp.raise_for_status()
            return GeneratedImageResult(
                b64_json=base64.b64encode(resp.content).decode("ascii"),
                raw_result={"task_id": task_id, "provider": "vod"},
            )
        return GeneratedImageResult(
            image_url=image_url,
            raw_result={"task_id": task_id, "provider": "vod"},
        )


class PoloOpenAIImageProvider:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def _call(
        self,
        *,
        prompt: str,
        images: Sequence[Tuple[str, bytes, str]],
        response_format: str,
        model: Optional[str],
        user_id: str,
        base_url: str,
    ) -> GeneratedImageResult:
        resolved_model = resolve_poloapi_model(
            requested_model=model,
            fallback_model=self.settings.poloapi_image_model or self.settings.poloapi_default_model,
            mode="image",
        )
        try:
            polo_response = await call_poloapi_image_chat(
                prompt,
                [(file_bytes, mime_type) for _, file_bytes, mime_type in images] or None,
                model=resolved_model,
            )
        except PoloAPIError as exc:
            raise ImageProviderError(str(exc)) from exc

        data_url = _extract_poloapi_data_url(polo_response)
        if not data_url:
            self.logger.warning(
                "PoloAPI image output parse failed: %s",
                json.dumps(_summarize_poloapi_content(polo_response), ensure_ascii=False),
            )
            raise ImageProviderError("Failed to parse provider image output")

        image_bytes, mime_type = await _load_provider_image_bytes(data_url)
        if response_format == "b64_json":
            return GeneratedImageResult(
                b64_json=base64.b64encode(image_bytes).decode("ascii"),
                raw_result={"provider": "poloapi", "model": resolved_model},
            )

        extension = mimetypes.guess_extension(mime_type or "image/png") or ".png"
        storage_entry = image_storage_service.store_uploaded_image(
            user_id=user_id,
            file_bytes=image_bytes,
            original_filename=f"openai_image_{uuid.uuid4().hex[:8]}{extension}",
            content_type=mime_type,
            subdir="openai-images",
        )
        original_path = storage_entry.get("original")
        if not original_path:
            raise ImageProviderError("Failed to persist generated image")
        public_url = _extract_public_image_url(base_url, original_path)
        return GeneratedImageResult(
            image_url=public_url,
            raw_result={"provider": "poloapi", "model": resolved_model},
        )

    async def generate(
        self,
        *,
        prompt: str,
        response_format: str,
        model: Optional[str],
        user_id: str,
        base_url: str,
    ) -> GeneratedImageResult:
        return await self._call(
            prompt=prompt,
            images=[],
            response_format=response_format,
            model=model,
            user_id=user_id,
            base_url=base_url,
        )

    async def edit(
        self,
        *,
        prompt: str,
        images: Sequence[Tuple[str, bytes, str]],
        response_format: str,
        model: Optional[str],
        user_id: str,
        base_url: str,
    ) -> GeneratedImageResult:
        if not images:
            raise ImageProviderError("At least one image is required")
        return await self._call(
            prompt=prompt,
            images=images,
            response_format=response_format,
            model=model,
            user_id=user_id,
            base_url=base_url,
        )


class CherryInOpenAIImageProvider:
    """
    CherryIn API 图像编辑 Provider
    使用 OpenAI 兼容的 Chat Completions 格式调用 qwen-image-edit 等模型
    """

    def __init__(self) -> None:
        self.settings = get_settings()
        self.logger = get_main_logger()
        self.api_key = (self.settings.cherryin_api_key or "").strip()
        self.base_url = (self.settings.cherryin_base_url or "https://open.cherryin.net/v1").rstrip("/")
        self.default_model = (self.settings.cherryin_model or "qwen/qwen-image-edit-2509").strip()
        self._client = httpx.AsyncClient(timeout=120.0, trust_env=False)

    async def close(self) -> None:
        await self._client.aclose()

    def _resolve_model(self, requested_model: Optional[str]) -> str:
        """解析模型名，添加 CherryIN 要求的 google/ / openai/ 前缀。
        
        前端传递的是短名称（gemini-2.5-flash-image），CherryIN 要求完整前缀。
        例如：gemini-2.5-flash-image → google/gemini-2.5-flash-image
        
        Qwen 切换说明：当 CherryIN 配置好 qwen image-edit 通道后，
        取消下方 QWEN_MAP 注释并启用映射即可。
        """
        if requested_model:
            normalized = requested_model.strip().lower()
            
            # Qwen 通道就绪时取消注释以激活模型替换
            # QWEN_MAP = {
            #     "banana": "qwen/qwen-image-edit-2509",
            #     "image-edit-pro": "qwen/qwen-image-edit-2509",
            #     "gemini-3-pro-image-preview": "qwen/qwen-image-edit-2509",
            #     "gpt-image-2": "qwen/qwen-image-edit-2509",
            #     "gemini-2.5-flash-image": "qwen/qwen-image-edit-2509",
            # }
            # if normalized in QWEN_MAP:
            #     return QWEN_MAP[normalized]
            
            # 已带前缀，直接透传
            if normalized.startswith("qwen/") or normalized.startswith("google/") or normalized.startswith("openai/"):
                return requested_model.strip()
            
            # 添加 CherryIN 所需前缀
            if normalized.startswith("gemini"):
                return f"google/{requested_model.strip()}"
            if normalized.startswith("gpt"):
                return f"openai/{requested_model.strip()}"
            
            # 默认直接透传
            return requested_model.strip()
        return self.default_model

    @staticmethod
    def _encode_image_as_data_url(file_bytes: bytes, mime_type: str) -> str:
        """将图片字节数据编码为 data URL"""
        b64 = base64.b64encode(file_bytes).decode("ascii")
        return f"data:{mime_type};base64,{b64}"

    def _build_messages(
        self,
        *,
        prompt: str,
        images: Sequence[Tuple[str, bytes, str]],
    ) -> List[Dict[str, Any]]:
        """构建 OpenAI Vision 格式的 messages"""
        content: List[Dict[str, Any]] = []

        # 添加输入图片
        for filename, file_bytes, mime_type in images:
            data_url = self._encode_image_as_data_url(file_bytes, mime_type)
            content.append({
                "type": "image_url",
                "image_url": {"url": data_url},
            })

        # 添加文本指令
        content.append({
            "type": "text",
            "text": prompt,
        })

        return [{"role": "user", "content": content}]

    async def _call(
        self,
        *,
        prompt: str,
        images: Sequence[Tuple[str, bytes, str]],
        response_format: str,
        model: Optional[str],
        user_id: str,
        base_url: str,
    ) -> GeneratedImageResult:
        resolved_model = self._resolve_model(model)
        messages = self._build_messages(prompt=prompt, images=images)

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        body = {
            "model": resolved_model,
            "messages": messages,
            "max_tokens": 4096,
        }

        endpoint = f"{self.base_url}/chat/completions"

        self.logger.info(
            "CherryIn request: model=%s, images=%d, prompt_len=%d",
            resolved_model, len(images), len(prompt),
        )

        try:
            response = await self._client.post(
                endpoint,
                headers=headers,
                json=body,
            )
        except httpx.TimeoutException as exc:
            raise ImageProviderError("CherryIn API timeout") from exc
        except httpx.RequestError as exc:
            raise ImageProviderError(f"CherryIn API request error: {exc}") from exc

        if response.status_code != 200:
            error_text = response.text[:500]
            self.logger.error("CherryIn API error: status=%d, body=%s", response.status_code, error_text)
            raise ImageProviderError(f"CherryIn API returned {response.status_code}: {error_text}")

        try:
            payload = response.json()
        except Exception as exc:
            raise ImageProviderError("CherryIn API returned invalid JSON") from exc

        # 解析响应中的图片数据
        data_url = self._extract_image_from_response(payload)
        if not data_url:
            self.logger.error(
                "CherryIn response parse failed: %s",
                json.dumps(payload, ensure_ascii=False)[:500],
            )
            raise ImageProviderError("Failed to parse CherryIn image output")

        image_bytes, mime_type = await _load_provider_image_bytes(data_url)

        if response_format == "b64_json":
            return GeneratedImageResult(
                b64_json=base64.b64encode(image_bytes).decode("ascii"),
                raw_result={"provider": "cherryin", "model": resolved_model},
            )

        extension = mimetypes.guess_extension(mime_type or "image/png") or ".png"
        storage_entry = image_storage_service.store_uploaded_image(
            user_id=user_id,
            file_bytes=image_bytes,
            original_filename=f"cherryin_image_{uuid.uuid4().hex[:8]}{extension}",
            content_type=mime_type,
            subdir="openai-images",
        )
        original_path = storage_entry.get("original")
        if not original_path:
            raise ImageProviderError("Failed to persist generated image")
        public_url = _extract_public_image_url(base_url, original_path)
        return GeneratedImageResult(
            image_url=public_url,
            raw_result={"provider": "cherryin", "model": resolved_model},
        )

    def _extract_image_from_response(self, payload: Dict[str, Any]) -> Optional[str]:
        """从 CherryIn 响应中提取图片 data URL"""
        choices = payload.get("choices") or []
        if not choices:
            return None

        message = (choices[0] or {}).get("message") or {}
        content = message.get("content")

        # 情况1: content 是字符串（可能是 data URL 或包含 data URL 的文本）
        if isinstance(content, str):
            if content.startswith("data:image/"):
                return content
            if content.startswith("http"):
                return content
            # 尝试从文本中提取 data URL
            match = re.search(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)", content)
            if match:
                return match.group(1)
            return None

        # 情况2: content 是列表
        if isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                # 检查 image_url 类型
                if part.get("type") == "image_url":
                    url_data = part.get("image_url")
                    if isinstance(url_data, dict):
                        url = url_data.get("url", "")
                    else:
                        url = str(url_data) if url_data else ""
                    if url and (url.startswith("data:image/") or url.startswith("http")):
                        return url
                # 检查 text 类型中是否包含 data URL
                if part.get("type") == "text":
                    text = part.get("text", "")
                    if isinstance(text, str):
                        match = re.search(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)", text)
                        if match:
                            return match.group(1)

        # 情况3: content 是字典
        if isinstance(content, dict):
            image_url = content.get("image_url")
            if isinstance(image_url, dict):
                url = image_url.get("url")
                if isinstance(url, str) and url:
                    return url
            text_value = content.get("text")
            if isinstance(text_value, str):
                match = re.search(r"(data:image/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)", text_value)
                if match:
                    return match.group(1)

        return None

    async def generate(
        self,
        *,
        prompt: str,
        response_format: str,
        model: Optional[str],
        user_id: str,
        base_url: str,
    ) -> GeneratedImageResult:
        return await self._call(
            prompt=prompt,
            images=[],
            response_format=response_format,
            model=model,
            user_id=user_id,
            base_url=base_url,
        )

    async def edit(
        self,
        *,
        prompt: str,
        images: Sequence[Tuple[str, bytes, str]],
        response_format: str,
        model: Optional[str],
        user_id: str,
        base_url: str,
    ) -> GeneratedImageResult:
        if not images:
            raise ImageProviderError("At least one image is required")
        return await self._call(
            prompt=prompt,
            images=images,
            response_format=response_format,
            model=model,
            user_id=user_id,
            base_url=base_url,
        )


class OpenAIImageProviderService:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.logger = get_main_logger()

    @staticmethod
    def _username_from_user(current_user: Any) -> str:
        if hasattr(current_user, "username"):
            return str(current_user.username)
        if isinstance(current_user, dict):
            return str(current_user.get("username") or current_user.get("user_id") or "anonymous")
        return "anonymous"

    def _build_base_url(self, request: Any) -> str:
        base_url = str(request.base_url).rstrip("/")
        return base_url

    def _provider(self) -> Any:
        provider = (self.settings.image_provider or "poloapi").strip().lower()
        if provider == "vod":
            return VodOpenAIImageProvider()
        if provider == "cherryin":
            return CherryInOpenAIImageProvider()
        return PoloOpenAIImageProvider()

    def get_active_provider_name(self) -> str:
        provider = (self.settings.image_provider or "poloapi").strip().lower()
        if provider == "vod":
            return "vod"
        if provider == "cherryin":
            return "cherryin"
        return "poloapi"

    async def generate(
        self,
        *,
        request: Any,
        current_user: Any,
        prompt: str,
        response_format: str,
        model: Optional[str],
    ) -> Dict[str, Any]:
        provider = self._provider()
        if isinstance(provider, VodOpenAIImageProvider):
            result = await provider.generate(
                prompt=prompt,
                response_format=response_format,
                model=model,
            )
        else:
            result = await provider.generate(
                prompt=prompt,
                response_format=response_format,
                model=model,
                user_id=self._username_from_user(current_user),
                base_url=self._build_base_url(request),
            )
        return _build_openai_images_response(response_format=response_format, result=result)

    async def edit(
        self,
        *,
        request: Any,
        current_user: Any,
        prompt: str,
        response_format: str,
        model: Optional[str],
        images: Sequence[Tuple[str, bytes, str]],
    ) -> Dict[str, Any]:
        provider = self._provider()
        if isinstance(provider, VodOpenAIImageProvider):
            result = await provider.edit(
                prompt=prompt,
                images=images,
                response_format=response_format,
                model=model,
            )
        else:
            result = await provider.edit(
                prompt=prompt,
                images=images,
                response_format=response_format,
                model=model,
                user_id=self._username_from_user(current_user),
                base_url=self._build_base_url(request),
            )
        return _build_openai_images_response(response_format=response_format, result=result)


openai_image_provider_service = OpenAIImageProviderService()
