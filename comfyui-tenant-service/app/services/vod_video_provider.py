from __future__ import annotations

import hashlib
import hmac
import io
import json
import mimetypes
import time
from math import ceil
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import httpx

from .config import get_settings
from .image_storage import image_storage_service

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - optional dependency
    Image = None
    ImageOps = None


class VodVideoProviderError(RuntimeError):
    """Raised when Tencent VOD video generation fails."""


class VodVideoProvider:
    MIN_INPUT_IMAGE_SIDE = 300
    MAX_INPUT_IMAGE_SIDE = 8000
    MAX_INPUT_IMAGE_ASPECT = 2.5

    def __init__(self) -> None:
        self.settings = get_settings()
        try:
            from tencentcloud.common import credential
            from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
            from tencentcloud.common.profile.client_profile import ClientProfile
            from tencentcloud.common.profile.http_profile import HttpProfile
            from tencentcloud.vod.v20180717.vod_client import VodClient
        except ImportError as exc:
            raise VodVideoProviderError(
                "tencentcloud-sdk-python is not installed. Install it in the tenant service environment."
            ) from exc

        secret_id = (self.settings.vod_secret_id or "").strip()
        secret_key = (self.settings.vod_secret_key or "").strip()
        if not secret_id or not secret_key:
            raise VodVideoProviderError("VOD_SECRET_ID and VOD_SECRET_KEY must be configured")
        if self.settings.vod_sub_app_id is None:
            raise VodVideoProviderError("VOD_SUB_APP_ID must be configured")

        self._tencent_exception_cls = TencentCloudSDKException
        http_profile = HttpProfile(
            endpoint=self.settings.vod_endpoint,
            reqTimeout=self.settings.vod_http_timeout_ms / 1000.0,
        )
        client_profile = ClientProfile(httpProfile=http_profile)
        self.client = VodClient(credential.Credential(secret_id, secret_key), self.settings.vod_region, client_profile)

    def _call_action(self, action: str, params: Dict[str, Any]) -> Dict[str, Any]:
        try:
            body = self.client.call(action, params, headers={})
        except self._tencent_exception_cls as exc:
            raise VodVideoProviderError(f"VOD request failed: {exc}") from exc
        payload = json.loads(body)
        response = payload.get("Response", payload)
        error = response.get("Error")
        if isinstance(error, dict):
            message = error.get("Message") or "VOD request failed"
            code = error.get("Code")
            raise VodVideoProviderError(f"{code}: {message}" if code else str(message))
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

    def prepare_first_frame(
        self,
        *,
        file_bytes: bytes,
        mime_type: str,
        target_width: int = 720,
        target_height: int = 1280,
    ) -> Tuple[bytes, str]:
        if Image is None or ImageOps is None:
            return file_bytes, mime_type or "image/png"
        try:
            with Image.open(io.BytesIO(file_bytes)) as image:
                source = ImageOps.exif_transpose(image).convert("RGB")
                width, height = source.size
                if width == target_width and height == target_height:
                    return file_bytes, mime_type or "image/png"
                canvas = Image.new("RGB", (target_width, target_height), (245, 245, 245))
                source.thumbnail((target_width, target_height), getattr(Image, "Resampling", Image).LANCZOS)
                left = (target_width - source.width) // 2
                top = (target_height - source.height) // 2
                canvas.paste(source, (left, top))
                output = io.BytesIO()
                canvas.save(output, format="PNG", optimize=True)
                return output.getvalue(), "image/png"
        except Exception as exc:
            raise VodVideoProviderError(f"Invalid first frame image: {exc}") from exc

    def prepare_reference_image(
        self,
        *,
        file_bytes: bytes,
        mime_type: str,
    ) -> Tuple[bytes, str]:
        if Image is None or ImageOps is None:
            return file_bytes, mime_type or "image/png"
        try:
            with Image.open(io.BytesIO(file_bytes)) as image:
                source = ImageOps.exif_transpose(image).convert("RGB")
                width, height = source.size
                target_width = width
                target_height = height

                if width / height > self.MAX_INPUT_IMAGE_ASPECT:
                    target_height = ceil(width / self.MAX_INPUT_IMAGE_ASPECT)
                elif height / width > self.MAX_INPUT_IMAGE_ASPECT:
                    target_width = ceil(height / self.MAX_INPUT_IMAGE_ASPECT)

                if target_width != width or target_height != height:
                    canvas = Image.new("RGB", (target_width, target_height), (245, 245, 245))
                    left = (target_width - width) // 2
                    top = (target_height - height) // 2
                    canvas.paste(source, (left, top))
                    source = canvas
                    width, height = source.size

                min_side = min(width, height)
                max_side = max(width, height)
                scale = 1.0
                if min_side < self.MIN_INPUT_IMAGE_SIDE:
                    scale = max(scale, self.MIN_INPUT_IMAGE_SIDE / min_side)
                if max_side * scale > self.MAX_INPUT_IMAGE_SIDE:
                    scale = self.MAX_INPUT_IMAGE_SIDE / max_side

                if abs(scale - 1.0) > 0.001:
                    next_width = max(1, round(width * scale))
                    next_height = max(1, round(height * scale))
                    source = source.resize(
                        (next_width, next_height),
                        getattr(Image, "Resampling", Image).LANCZOS,
                    )

                output = io.BytesIO()
                source.save(output, format="PNG", optimize=True)
                return output.getvalue(), "image/png"
        except Exception as exc:
            raise VodVideoProviderError(f"Invalid reference image: {exc}") from exc

    async def _upload_input_image(
        self,
        *,
        filename: str,
        file_bytes: bytes,
        mime_type: str,
    ) -> Dict[str, str]:
        media_type = Path(filename).suffix.lstrip(".").lower() or mime_type.split("/")[-1].lower() or "png"
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
            raise VodVideoProviderError(f"VOD COS upload failed: {response.text or response.status_code}")

        commit_response = self._call_action(
            "CommitUpload",
            {
                "SubAppId": self.settings.vod_sub_app_id,
                "VodSessionKey": apply_response["VodSessionKey"],
            },
        )
        file_id = commit_response.get("FileId")
        media_url = commit_response.get("MediaUrl")
        if not file_id and not media_url:
            raise VodVideoProviderError("VOD CommitUpload returned no FileId or MediaUrl")
        return {
            "file_id": str(file_id or ""),
            "media_url": str(media_url or ""),
        }

    async def create_video_task(
        self,
        *,
        prompt: str,
        duration: Optional[float] = None,
        resolution: Optional[str] = None,
        input_images: Tuple[Tuple[str, bytes, str], ...],
        mode: Optional[str] = None,
        aspect_ratio: Optional[str] = None,
    ) -> Dict[str, Any]:
        mode_value = (mode or "reference").strip().lower().replace("_", "-")
        if mode_value in {"firstframe", "first-frame"}:
            mode_value = "first-frame"
        elif mode_value != "reference":
            mode_value = "reference"

        if not input_images:
            raise VodVideoProviderError("At least one input image is required")

        if mode_value != "first-frame" and len(input_images) > 3:
            raise VodVideoProviderError("Reference mode supports up to 3 images")

        def build_file_info(upload: Dict[str, str], usage: str) -> Dict[str, Any]:
            file_info: Dict[str, Any] = {
                "Category": "Image",
                "Usage": usage,
            }
            if upload.get("media_url"):
                file_info.update({"Type": "Url", "Url": upload["media_url"]})
            else:
                file_info.update({"Type": "FileId", "FileId": upload["file_id"]})
            return file_info

        file_infos = []
        primary_upload: Optional[Dict[str, str]] = None
        images_to_upload = input_images[:1] if mode_value == "first-frame" else input_images[:3]
        for index, (filename, file_bytes, mime_type) in enumerate(images_to_upload):
            if mode_value == "first-frame":
                prepared_bytes, prepared_mime = self.prepare_first_frame(file_bytes=file_bytes, mime_type=mime_type)
                upload_filename = f"{Path(filename or 'first-frame.png').stem}.png"
                usage = "FirstFrame"
            else:
                prepared_mime = mime_type or mimetypes.guess_type(filename or "")[0] or "image/png"
                prepared_bytes, prepared_mime = self.prepare_reference_image(file_bytes=file_bytes, mime_type=prepared_mime)
                suffix = Path(filename or "").suffix or f".{prepared_mime.split('/')[-1] or 'png'}"
                if prepared_mime == "image/png":
                    suffix = ".png"
                upload_filename = f"{Path(filename or f'reference-{index + 1}').stem}{suffix}"
                usage = "Reference"
            upload = await self._upload_input_image(
                filename=upload_filename,
                file_bytes=prepared_bytes,
                mime_type=prepared_mime,
            )
            if primary_upload is None:
                primary_upload = upload
            file_infos.append(build_file_info(upload, usage))

        model_name = (self.settings.vod_video_model_name or "Kling").strip() or "Kling"
        model_version = (self.settings.vod_video_model_version or "3.0-Omni").strip() or "3.0-Omni"
        output_config: Dict[str, Any] = {
            "StorageMode": "Temporary",
            "Duration": duration if duration is not None else self.settings.vod_video_duration_seconds,
            "Resolution": (resolution or self.settings.vod_video_resolution or "720P").strip() or "720P",
            "AudioGeneration": (self.settings.vod_video_audio_generation or "Disabled").strip() or "Disabled",
        }
        aspect_ratio_value = (aspect_ratio or "").strip()
        if aspect_ratio_value and aspect_ratio_value.lower() != "auto":
            allowed_aspect_ratios = {"9:16", "16:9", "1:1"}
            if aspect_ratio_value not in allowed_aspect_ratios:
                raise VodVideoProviderError(f"Unsupported video aspect ratio: {aspect_ratio_value}")
            output_config["AspectRatio"] = aspect_ratio_value
        response = self._call_action(
            "CreateAigcVideoTask",
            {
                "SubAppId": self.settings.vod_sub_app_id,
                "ModelName": model_name,
                "ModelVersion": model_version,
                "FileInfos": file_infos,
                "Prompt": prompt,
                "EnhancePrompt": (self.settings.vod_video_enhance_prompt or "Enabled").strip() or "Enabled",
                "OutputConfig": output_config,
                "InputRegion": (self.settings.vod_video_input_region or "Mainland").strip() or "Mainland",
            },
        )
        task_id = response.get("TaskId")
        if not task_id:
            raise VodVideoProviderError("VOD CreateAigcVideoTask returned no TaskId")
        return {
            "task_id": str(task_id),
            "model": f"{model_name} {model_version}",
            "model_name": model_name,
            "model_version": model_version,
            "billing_model": f"vod:{model_name}:{model_version}",
            "mode": mode_value,
            "aspect_ratio": aspect_ratio_value or "auto",
            "resolution": output_config["Resolution"],
            "first_frame_file_id": primary_upload.get("file_id") if primary_upload else None,
            "first_frame_url": primary_upload.get("media_url") if primary_upload else None,
            "input_image_count": len(file_infos),
            "create_response": response,
        }

    def describe_task(self, task_id: str) -> Dict[str, Any]:
        return self._call_action("DescribeTaskDetail", {"TaskId": task_id})

    def parse_task_detail(self, detail: Dict[str, Any]) -> Dict[str, Any]:
        task = detail.get("AigcVideoTask") or {}
        status = str(detail.get("Status") or task.get("Status") or "").strip().upper()
        err_code = int(task.get("ErrCode") or 0)
        message = str(task.get("Message") or detail.get("Message") or "")
        output = task.get("Output") or {}
        file_infos = output.get("FileInfos") or []
        video_url = None
        metadata = None
        for item in file_infos:
            if not isinstance(item, dict):
                continue
            candidate = item.get("FileUrl")
            if isinstance(candidate, str) and candidate:
                video_url = candidate
                metadata = item.get("MetaData")
                break
        return {
            "status": status,
            "progress": task.get("Progress"),
            "err_code": err_code,
            "message": message,
            "video_url": video_url,
            "metadata": metadata,
            "detail": detail,
        }

    async def store_video_output(
        self,
        *,
        user_id: str,
        video_url: str,
        task_id: str,
    ) -> Dict[str, Any]:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True, trust_env=False) as client:
            response = await client.get(video_url)
            response.raise_for_status()
        content_type = response.headers.get("content-type") or "video/mp4"
        extension = Path(video_url.split("?", 1)[0]).suffix.lstrip(".").lower()
        if not extension:
            extension = mimetypes.guess_extension(content_type.split(";", 1)[0].strip()) or ".mp4"
            extension = extension.lstrip(".")
        if extension == "quicktime":
            extension = "mov"
        return image_storage_service.store_uploaded_video(
            user_id=user_id,
            file_bytes=response.content,
            original_filename=f"{task_id}.{extension or 'mp4'}",
            content_type=content_type,
            subdir="board-videos",
        )
