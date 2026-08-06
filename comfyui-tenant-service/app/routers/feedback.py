import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from ..models.database import User, get_db
from ..routers.auth import get_current_user
from ..services.feedback_service import feedback_service
from ..services.image_storage import image_storage_service
from ..services.logger import get_main_logger
from ..services.ws_manager import credit_ws_manager

router = APIRouter()
logger = get_main_logger()

IMAGE_MIME_PREFIX = "image/"
VIDEO_MIME_PREFIX = "video/"
ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
ALLOWED_VIDEO_EXTENSIONS = {"mp4", "mov", "webm", "avi", "mkv", "mpeg", "mpg"}
MAX_ATTACHMENTS = 6


def _user_value(user: Any, key: str, default: Any = None) -> Any:
    if isinstance(user, dict):
        return user.get(key, default)
    return getattr(user, key, default)


def _is_admin_user(user: Any) -> bool:
    try:
        return int(_user_value(user, "group", 0) or 0) == 1000
    except (TypeError, ValueError):
        return False


def _normalize_storage_url(value: Optional[str]) -> Optional[str]:
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://", "/api/proxy/static/images/")):
        return raw
    relative_path = re.sub(r"^output[\\\/]", "", raw).replace("\\", "/").lstrip("/")
    if not relative_path:
        return None
    return f"/api/proxy/static/images/{relative_path}"


def _normalize_feedback_attachment(entry: Dict[str, Any]) -> Dict[str, Any]:
    original_url = _normalize_storage_url(entry.get("original"))
    thumbnail_url = _normalize_storage_url(entry.get("thumbnail")) or original_url
    content_type = str(entry.get("contentType") or "").strip()
    file_kind = "video" if content_type.startswith(VIDEO_MIME_PREFIX) else "image"
    return {
        "name": entry.get("name"),
        "contentType": content_type,
        "fileType": entry.get("fileType"),
        "kind": file_kind,
        "originalUrl": original_url,
        "thumbnailUrl": thumbnail_url,
        "storage": entry,
    }


def _normalize_feedback_record(record: Dict[str, Any]) -> Dict[str, Any]:
    attachments = record.get("attachments") if isinstance(record.get("attachments"), list) else []
    try:
        reward_points = int(record.get("reward_points") or 0)
    except (TypeError, ValueError):
        reward_points = 0
    return {
        "id": record.get("id"),
        "tenantId": record.get("tenant_id"),
        "userId": record.get("user_id"),
        "username": record.get("username"),
        "content": record.get("content"),
        "createdAt": record.get("created_at"),
        "rewardPoints": reward_points,
        "rewardedAt": record.get("rewarded_at"),
        "rewardGranted": bool(record.get("reward_granted")) or reward_points > 0,
        "attachments": [_normalize_feedback_attachment(item) for item in attachments if isinstance(item, dict)],
    }


def _current_credit_for_user(db: Any, current_user: Any) -> int | None:
    user_id = int(_user_value(current_user, "id", 0) or 0)
    if user_id <= 0:
        return None

    try:
        if feedback_service.settings.is_database_storage():
            user = db.query(User).filter(User.id == user_id).first()
            if user is None:
                return None
            return int(getattr(user, "credit", 0) or 0)

        user = db.get_user_by_id(user_id)
        if isinstance(user, dict):
            return int(user.get("credit") or 0)
    except Exception:
        return None

    return None


@router.get("/feedback")
async def list_feedback(
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    is_admin = _is_admin_user(current_user)
    records = feedback_service.list_visible_feedback(db, current_user)
    reward_status = feedback_service.get_monthly_reward_status(db, current_user)
    return {
        "monthlyRewardLimit": reward_status["monthly_reward_limit"],
        "rewardPointsPerFeedback": reward_status["reward_points_per_feedback"],
        "rewardedThisMonth": reward_status["rewarded_this_month"],
        "remainingRewardSlots": reward_status["remaining_reward_slots"],
        "isAdminView": is_admin,
        "items": [_normalize_feedback_record(record) for record in records],
    }


@router.post("/feedback", status_code=201)
async def create_feedback(
    content: str = Form(..., description="反馈内容"),
    files: Optional[List[UploadFile]] = File(default=None, description="图片或视频附件"),
    current_user=Depends(get_current_user),
    db=Depends(get_db),
):
    username = str(_user_value(current_user, "username", "") or "")
    user_id = str(_user_value(current_user, "id", "") or "")
    normalized_content = str(content or "").strip()
    uploads = list(files or [])

    if not normalized_content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="反馈内容不能为空")
    if len(uploads) > MAX_ATTACHMENTS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"最多上传 {MAX_ATTACHMENTS} 个附件")

    stored_attachments: List[Dict[str, Any]] = []
    for upload in uploads:
        try:
            payload = await upload.read()
        except Exception as exc:
            logger.error("读取反馈附件失败 user=%s error=%s", username, exc)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="读取附件失败")
        finally:
            await upload.close()

        if not payload:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{upload.filename or '附件'} 内容为空")

        filename = upload.filename or "attachment"
        extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        content_type = str(upload.content_type or "").strip().lower()

        try:
            if content_type.startswith(IMAGE_MIME_PREFIX) or extension in ALLOWED_IMAGE_EXTENSIONS:
                storage_entry = image_storage_service.store_uploaded_image(
                    user_id=username or user_id,
                    file_bytes=payload,
                    original_filename=filename,
                    content_type=content_type or None,
                    subdir="feedback",
                )
            elif content_type.startswith(VIDEO_MIME_PREFIX) or extension in ALLOWED_VIDEO_EXTENSIONS:
                storage_entry = image_storage_service.store_uploaded_video(
                    user_id=username or user_id,
                    file_bytes=payload,
                    original_filename=filename,
                    content_type=content_type or None,
                    subdir="feedback",
                )
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="仅支持上传图片或视频文件")
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
        except HTTPException:
            raise
        except Exception as exc:
            logger.error("保存反馈附件失败 user=%s file=%s error=%s", username, filename, exc)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="保存附件失败")

        stored_attachments.append(
            {
                **storage_entry,
                "name": filename,
                "contentType": content_type,
            }
        )

    try:
        record = feedback_service.create_feedback(
            db=db,
            current_user=current_user,
            content=normalized_content,
            attachments=stored_attachments,
        )
    except ValueError as exc:
        for entry in stored_attachments:
            image_storage_service.delete_entry(entry)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    except Exception:
        for entry in stored_attachments:
            image_storage_service.delete_entry(entry)
        raise

    reward_points = int(record.get("reward_points") or 0)
    if reward_points > 0:
        current_credit = _current_credit_for_user(db, current_user)
        if current_credit is not None:
            try:
                await credit_ws_manager.send_credit_update(int(user_id), current_credit)
            except Exception:
                pass

    reward_status = feedback_service.get_monthly_reward_status(db, current_user)
    reward_granted = bool(record.get("reward_points"))
    return {
        "monthlyRewardLimit": reward_status["monthly_reward_limit"],
        "rewardPointsPerFeedback": reward_status["reward_points_per_feedback"],
        "rewardedThisMonth": reward_status["rewarded_this_month"],
        "remainingRewardSlots": reward_status["remaining_reward_slots"],
        "rewardGranted": reward_granted,
        "item": _normalize_feedback_record(record),
    }
