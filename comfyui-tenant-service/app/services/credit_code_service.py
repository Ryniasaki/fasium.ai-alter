import json
import random
import string
from datetime import datetime
from pathlib import Path
from typing import List, Dict

from .config import get_settings
from .logger import get_main_logger

class CreditCodeService:
    """Simple JSON-based credit code store."""

    def __init__(self):
        self.settings = get_settings()
        self.logger = get_main_logger()
        self.file_path = Path(self.settings.json_storage_path) / "credit-code.json"
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.file_path.exists():
            self._save([])

    def _load(self) -> List[Dict]:
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"Failed to load credit codes: {e}")
            return []

    def _save(self, data: List[Dict]) -> None:
        try:
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            self.logger.error(f"Failed to save credit codes: {e}")

    def _generate_code(self, length: int = 12) -> str:
        alphabet = string.ascii_uppercase + string.digits
        return "".join(random.choice(alphabet) for _ in range(length))

    def list_codes(self) -> List[Dict]:
        return self._load()

    def create_code(self, credit: int) -> Dict:
        codes = self._load()
        code = self._generate_code()
        record = {
            "code": code,
            "credit": credit,
            "used": False,
            "used_by": None,
            "created_at": datetime.utcnow().isoformat(),
            "used_at": None,
        }
        codes.append(record)
        self._save(codes)
        return record

    def delete_code(self, code: str) -> bool:
        codes = self._load()
        filtered = [c for c in codes if c.get("code") != code]
        if len(filtered) == len(codes):
            return False
        self._save(filtered)
        return True

    def redeem_code(self, code: str, used_by: str) -> Dict:
        """Mark code as used; return the code record with credit. Raise ValueError if not found/used."""
        codes = self._load()
        found = None
        for c in codes:
            if c.get("code") == code:
                found = c
                break
        if not found:
            raise ValueError("Code not found")
        if found.get("used"):
            raise ValueError("Code already used")
        found["used"] = True
        found["used_by"] = used_by
        found["used_at"] = datetime.utcnow().isoformat()
        self._save(codes)
        return found


credit_code_service = CreditCodeService()
