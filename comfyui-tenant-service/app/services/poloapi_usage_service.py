import json
from typing import Any, Dict, List, Optional

from ..models.database import PoloAPIUsageRecord
from ..services.logger import get_main_logger


logger = get_main_logger()


def log_poloapi_usage(
    db: Any,
    *,
    user_id: str,
    endpoint: str,
    model: Optional[str],
    prompt: str,
    response_text: Optional[str] = None,
    image_paths: Optional[List[str]] = None,
) -> None:
    if not hasattr(db, "add"):
        return

    try:
        record = PoloAPIUsageRecord(
            user_id=user_id,
            endpoint=endpoint,
            model=model,
            prompt=prompt,
            response_text=response_text,
            image_paths=json.dumps(image_paths, ensure_ascii=False) if image_paths else None,
        )
        db.add(record)
        db.commit()
    except Exception as exc:  # pylint: disable=broad-except
        logger.warning("Failed to log PoloAPI usage: %s", exc)
        try:
            db.rollback()
        except Exception:  # pylint: disable=broad-except
            pass
