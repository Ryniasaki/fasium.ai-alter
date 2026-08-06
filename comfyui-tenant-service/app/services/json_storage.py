import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from .config import get_settings
from .logger import get_main_logger

class JSONStorage:
    def __init__(self):
        self.settings = get_settings()
        self.logger = get_main_logger()
        self.db_path = Path(self.settings.json_storage_path)
        self.db_path.mkdir(parents=True, exist_ok=True)
    
    def _load_data(self, filename: str) -> List[Dict]:
        """Load data from JSON file"""
        file_path = self.db_path / f"{filename}.json"
        if not file_path.exists():
            return []
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            self.logger.error(f"Failed to load {filename}: {str(e)}")
            return []
    
    def _save_data(self, filename: str, data: List[Dict]):
        """Save data to JSON file"""
        file_path = self.db_path / f"{filename}.json"
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2, default=str)
        except Exception as e:
            self.logger.error(f"Failed to save {filename}: {str(e)}")

    def _next_id(self, filename: str) -> int:
        data = self._load_data(filename)
        max_id = 0
        for item in data:
            if not isinstance(item, dict):
                continue
            try:
                max_id = max(max_id, int(item.get("id") or 0))
            except (TypeError, ValueError):
                continue
        return max_id + 1
    
    # Tenant operations
    def create_tenant(self, name: str, settings: str = "{}") -> Dict:
        """Create a new tenant"""
        tenants = self._load_data("tenants")
        
        # Check if tenant exists
        if any(t.get("name") == name for t in tenants):
            raise ValueError("Tenant name already exists")
        
        tenant = {
            "id": len(tenants) + 1,
            "name": name,
            "api_key": str(uuid.uuid4()),
            "is_active": True,
            "created_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "settings": settings
        }
        
        tenants.append(tenant)
        self._save_data("tenants", tenants)
        self.logger.info(f"Created tenant: {name}")
        return tenant
    
    def get_tenant_by_id(self, tenant_id: int) -> Optional[Dict]:
        """Get tenant by ID"""
        tenants = self._load_data("tenants")
        return next((t for t in tenants if t.get("id") == tenant_id), None)
    
    def get_tenant_by_api_key(self, api_key: str) -> Optional[Dict]:
        """Get tenant by API key"""
        tenants = self._load_data("tenants")
        return next((t for t in tenants if t.get("api_key") == api_key and t.get("is_active")), None)

    def update_tenant_settings(self, tenant_id: int, settings_value: str | Dict) -> Optional[Dict]:
        """Update tenant settings payload."""
        tenants = self._load_data("tenants")
        settings_payload = settings_value
        if isinstance(settings_value, (dict, list)):
            settings_payload = json.dumps(settings_value, ensure_ascii=False)
        for tenant in tenants:
            if tenant.get("id") == tenant_id:
                tenant["settings"] = settings_payload
                tenant["updated_at"] = datetime.utcnow().isoformat()
                self._save_data("tenants", tenants)
                return tenant
        return None
    
    # User operations
    def create_user(
        self,
        username: str,
        password_hash: str,
        tenant_id: int,
        email: str = None,
        role: str = "user",
        manager_username: Optional[str] = None,
        referred_by_username: Optional[str] = None,
        max_active_employees: int = 5,
        is_active: bool = True,
    ) -> Dict:
        """Create a new user"""
        users = self._load_data("users")
        
        # Check if user exists
        if any(u.get("username") == username for u in users):
            raise ValueError("Username already exists")
        if email and any(u.get("email") == email for u in users):
            raise ValueError("Email already exists")
        
        user = {
            "id": len(users) + 1,
            "username": username,
            "email": email,
            "hashed_password": password_hash,
            "tenant_id": tenant_id,
            "is_active": bool(is_active),
            "created_at": datetime.utcnow().isoformat(),
            "last_login": None,
            "credit": self.settings.user_default_credit,
            "group": self.settings.user_default_group,
            "role": role or "user",
            "manager_username": manager_username,
            "referred_by_username": referred_by_username,
            "max_active_employees": int(max_active_employees) if max_active_employees is not None else 5,
        }
        
        users.append(user)
        self._save_data("users", users)
        self.logger.info(f"Created user: {username}")
        return user
    
    def get_user_by_username(self, username: str) -> Optional[Dict]:
        """Get user by username"""
        users = self._load_data("users")
        return next((u for u in users if u.get("username") == username), None)
    
    def get_user_by_email(self, email: str) -> Optional[Dict]:
        """Get user by email"""
        users = self._load_data("users")
        return next((u for u in users if u.get("email") == email), None)
    
    def get_user_by_id(self, user_id: int) -> Optional[Dict]:
        """Get user by ID"""
        users = self._load_data("users")
        return next((u for u in users if u.get("id") == user_id), None)

    def list_users(self, search: Optional[str] = None, page: int = 1, page_size: int = 20) -> Dict:
        """List users with optional search and pagination"""
        users = self._load_data("users")
        if search:
            keyword = search.lower()
            users = [
                u
                for u in users
                if keyword in str(u.get("username", "")).lower() or keyword in str(u.get("email", "")).lower()
            ]
        total = len(users)
        start = max(0, (page - 1) * page_size)
        end = start + page_size
        return {"total": total, "items": users[start:end]}

    def update_user_fields(self, username: str, updates: Dict) -> Optional[Dict]:
        """Patch user fields by username."""
        users = self._load_data("users")
        target = None
        for user in users:
            if user.get("username") == username:
                target = user
                break
        if not target:
            return None
        for key, value in (updates or {}).items():
            target[key] = value
        target["updated_at"] = datetime.utcnow().isoformat()
        self._save_data("users", users)
        return target

    def list_employees_for_manager(self, manager_username: str) -> List[Dict]:
        users = self._load_data("users")
        return [
            user
            for user in users
            if user.get("role") == "employee" and user.get("manager_username") == manager_username
        ]

    def count_active_employees_for_manager(self, manager_username: str) -> int:
        return sum(
            1
            for user in self.list_employees_for_manager(manager_username)
            if bool(user.get("is_active", True))
        )

    def add_credit_to_user(self, user_id: int, credit: int) -> Dict:
        """Add credit to a user and persist"""
        users = self._load_data("users")
        found = None
        for u in users:
            if u.get("id") == user_id:
                found = u
                break
        if not found:
            raise ValueError("User not found")
        current_credit = found.get("credit") or 0
        found["credit"] = current_credit + credit
        self._save_data("users", users)
        return found

    def adjust_credit_for_user(self, user_id: int, delta: int) -> Dict:
        """Adjust credit for a user by delta and persist (delta can be negative)."""
        users = self._load_data("users")
        found = None
        for u in users:
            if u.get("id") == user_id:
                found = u
                break
        if not found:
            raise ValueError("User not found")
        current_credit = int(found.get("credit") or 0)
        next_credit = max(0, current_credit + int(delta))
        found["credit"] = next_credit
        self._save_data("users", users)
        return found
    
    def update_user_last_login(self, user_id: int):
        """Update user's last login time"""
        users = self._load_data("users")
        for user in users:
            if user.get("id") == user_id:
                user["last_login"] = datetime.utcnow().isoformat()
                break
        self._save_data("users", users)

    def update_user_password(self, username: str, password_hash: str) -> bool:
        """Update a user's password hash by username."""
        users = self._load_data("users")
        updated = False
        for user in users:
            if user.get("username") == username:
                user["hashed_password"] = password_hash
                user["updated_at"] = datetime.utcnow().isoformat()
                updated = True
                break
        if updated:
            self._save_data("users", users)
        return updated
    
    # Usage tracking
    def log_api_usage(self, tenant_id: int, user_id: int, endpoint: str):
        """Log API usage"""
        usage = self._load_data("api_usage")
        
        usage_record = {
            "id": len(usage) + 1,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "endpoint": endpoint,
            "request_count": 1,
            "created_at": datetime.utcnow().isoformat()
        }
        
        usage.append(usage_record)
        self._save_data("api_usage", usage)

    def list_model_billing_rates(self) -> List[Dict]:
        """List model billing rates."""
        return self._load_data("model_billing_rates")

    def get_model_billing_rate(self, model: str) -> Optional[int]:
        """Get billing rate for a model."""
        if not model:
            return None
        rates = self._load_data("model_billing_rates")
        record = next((item for item in rates if item.get("model") == model), None)
        if record is None:
            return None
        try:
            return int(record.get("credit"))
        except (TypeError, ValueError):
            return None

    def upsert_model_billing_rate(self, model: str, credit: int) -> Dict:
        """Create or update a model billing rate."""
        rates = self._load_data("model_billing_rates")
        now = datetime.utcnow().isoformat()
        for item in rates:
            if item.get("model") == model:
                item["credit"] = credit
                item["updated_at"] = now
                self._save_data("model_billing_rates", rates)
                return item
        record = {
            "id": len(rates) + 1,
            "model": model,
            "credit": credit,
            "created_at": now,
            "updated_at": now,
        }
        rates.append(record)
        self._save_data("model_billing_rates", rates)
        return record

    def delete_model_billing_rate(self, model: str) -> bool:
        """Delete a model billing rate by name."""
        rates = self._load_data("model_billing_rates")
        before = len(rates)
        rates = [item for item in rates if item.get("model") != model]
        if len(rates) == before:
            return False
        self._save_data("model_billing_rates", rates)
        return True

    def create_feedback(
        self,
        tenant_id: int,
        user_id: int,
        username: str,
        content: str,
        attachments: List[Dict],
        reward_points: int = 0,
        rewarded_at: datetime | str | None = None,
    ) -> Dict:
        records = self._load_data("feedback_records")
        reward_points_value = max(0, int(reward_points or 0))
        reward_timestamp = rewarded_at or (datetime.now(timezone.utc) if reward_points_value > 0 else None)
        rewarded_at_value = reward_timestamp.isoformat() if isinstance(reward_timestamp, datetime) else reward_timestamp
        record = {
            "id": self._next_id("feedback_records"),
            "tenant_id": tenant_id,
            "user_id": user_id,
            "username": username,
            "content": content,
            "attachments": attachments,
            "reward_points": reward_points_value,
            "rewarded_at": rewarded_at_value,
            "created_at": datetime.utcnow().isoformat(),
        }
        users = None
        target_user = None
        if reward_points_value > 0:
            users = self._load_data("users")
            target_user = next((u for u in users if isinstance(u, dict) and int(u.get("id") or 0) == int(user_id)), None)
            if target_user is None:
                raise ValueError("User not found")
            current_credit = int(target_user.get("credit") or 0)
            target_user["credit"] = current_credit + reward_points_value
        records.append(record)
        self._save_data("feedback_records", records)
        if reward_points_value > 0 and users is not None and target_user is not None:
            try:
                self._save_data("users", users)
            except Exception as exc:  # pylint: disable=broad-except
                self.logger.error(f"Failed to persist feedback reward for user {user_id}: {str(exc)}")
                record["reward_points"] = 0
                record["rewarded_at"] = None
                self._save_data("feedback_records", records)
                return record
        return record

    def list_feedback_by_user(self, user_id: int, limit: Optional[int] = None) -> List[Dict]:
        records = self._load_data("feedback_records")
        filtered = [
            item
            for item in records
            if isinstance(item, dict) and int(item.get("user_id") or 0) == int(user_id)
        ]
        filtered.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        if limit is None:
            return filtered
        return filtered[:limit]

    def list_feedback_records(self, limit: Optional[int] = None) -> List[Dict]:
        records = [item for item in self._load_data("feedback_records") if isinstance(item, dict)]
        records.sort(key=lambda item: (str(item.get("created_at") or ""), int(item.get("id") or 0)), reverse=True)
        if limit is None:
            return records
        return records[:limit]

    def count_feedback_by_user_for_window(self, user_id: int, start_at: datetime, end_at: datetime) -> int:
        count = 0
        for item in self._load_data("feedback_records"):
            if not isinstance(item, dict):
                continue
            try:
                item_user_id = int(item.get("user_id") or 0)
            except (TypeError, ValueError):
                continue
            if item_user_id != int(user_id):
                continue
            raw_created_at = item.get("created_at")
            if not raw_created_at:
                continue
            try:
                created_at = datetime.fromisoformat(str(raw_created_at).replace("Z", "+00:00"))
                if created_at.tzinfo is not None:
                    created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
            except ValueError:
                continue
            if start_at <= created_at < end_at:
                count += 1
        return count

    def count_rewarded_feedback_by_user_for_window(self, user_id: int, start_at: datetime, end_at: datetime) -> int:
        count = 0
        for item in self._load_data("feedback_records"):
            if not isinstance(item, dict):
                continue
            try:
                item_user_id = int(item.get("user_id") or 0)
            except (TypeError, ValueError):
                continue
            if item_user_id != int(user_id):
                continue

            try:
                reward_points = int(item.get("reward_points") or 0)
            except (TypeError, ValueError):
                reward_points = 0
            if reward_points <= 0:
                continue

            raw_created_at = item.get("created_at") or item.get("rewarded_at")
            if not raw_created_at:
                continue
            try:
                created_at = datetime.fromisoformat(str(raw_created_at).replace("Z", "+00:00"))
                if created_at.tzinfo is not None:
                    created_at = created_at.astimezone(timezone.utc).replace(tzinfo=None)
            except ValueError:
                continue
            if start_at <= created_at < end_at:
                count += 1
        return count

    def log_billing_usage(
        self,
        tenant_id: int,
        user_id: int,
        actor_user_id: int | None,
        actor_username: str | None,
        endpoint: str,
        model: str,
        credits: int,
        status: str,
        tenant_task_id: str | None = None,
        balance_before: int | None = None,
        balance_after: int | None = None,
    ):
        """Log billing usage."""
        usage = self._load_data("billing_usage")
        usage_record = {
            "id": len(usage) + 1,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "actor_user_id": actor_user_id,
            "actor_username": actor_username,
            "tenant_task_id": tenant_task_id,
            "endpoint": endpoint,
            "model": model,
            "credits": credits,
            "status": status,
            "balance_before": balance_before,
            "balance_after": balance_after,
            "created_at": datetime.utcnow().isoformat(),
        }
        usage.append(usage_record)
        self._save_data("billing_usage", usage)
    
    # Task record operations
    def create_task_record(
        self,
        tenant_task_id: str,
        user_id: str,
        runninghub_task_id: str,
        task_type: str = None,
        result_data: Optional[Dict[str, Any]] = None,
    ) -> Dict:
        """Create a new task record"""
        task_records = self._load_data("task_records")
        
        task_record = {
            "id": len(task_records) + 1,
            "tenant_task_id": tenant_task_id,
            "user_id": user_id,
            "runninghub_task_id": runninghub_task_id,
            "task_type": task_type,
            "status": "PENDING",
            "created_at": datetime.utcnow().isoformat(),
            "completed_at": None,
            "result_data": json.dumps(result_data, ensure_ascii=False) if isinstance(result_data, dict) else None,
            "storage_paths": None,
            "error_message": None
        }
        
        task_records.append(task_record)
        self._save_data("task_records", task_records)
        self.logger.info(f"Created task record: {tenant_task_id}")
        return task_record
    
    def get_task_record_by_tenant_id(self, tenant_task_id: str) -> Optional[Dict]:
        """Get task record by tenant task ID"""
        task_records = self._load_data("task_records")
        return next((t for t in task_records if t.get("tenant_task_id") == tenant_task_id), None)
    
    def update_task_success(self, tenant_task_id: str, result_data: Dict, storage_paths: List) -> bool:
        """Update task record to success status"""
        task_records = self._load_data("task_records")
        
        for task_record in task_records:
            if task_record.get("tenant_task_id") == tenant_task_id:
                existing_billing = None
                existing_data = task_record.get("result_data")
                if isinstance(existing_data, dict) and "billing" in existing_data:
                    existing_billing = existing_data.get("billing")
                elif isinstance(existing_data, str):
                    try:
                        parsed = json.loads(existing_data)
                        if isinstance(parsed, dict) and "billing" in parsed:
                            existing_billing = parsed.get("billing")
                    except Exception:
                        existing_billing = None
                if isinstance(result_data, dict) and existing_billing is not None and "billing" not in result_data:
                    result_data["billing"] = existing_billing
                task_record["status"] = "SUCCESS"
                task_record["completed_at"] = datetime.utcnow().isoformat()
                task_record["result_data"] = result_data
                task_record["storage_paths"] = storage_paths
                break
        else:
            self.logger.error(f"Task record not found: {tenant_task_id}")
            return False
        
        self._save_data("task_records", task_records)
        self.logger.info(f"Updated task record to success: {tenant_task_id}")
        return True

    def update_task_billing(self, tenant_task_id: str, billing_info: Dict) -> bool:
        """Attach billing info into task result_data."""
        task_records = self._load_data("task_records")
        updated = False
        for task_record in task_records:
            if task_record.get("tenant_task_id") == tenant_task_id:
                result_data = task_record.get("result_data")
                if isinstance(result_data, str):
                    try:
                        result_data = json.loads(result_data)
                    except Exception:
                        result_data = {}
                if not isinstance(result_data, dict):
                    result_data = {}
                result_data["billing"] = billing_info
                task_record["result_data"] = result_data
                updated = True
                break
        if not updated:
            self.logger.error(f"Task record not found: {tenant_task_id}")
            return False
        self._save_data("task_records", task_records)
        return True
    
    def update_task_failed(self, tenant_task_id: str, error_message: str) -> bool:
        """Update task record to failed status"""
        task_records = self._load_data("task_records")
        
        for task_record in task_records:
            if task_record.get("tenant_task_id") == tenant_task_id:
                task_record["status"] = "FAILED"
                task_record["completed_at"] = datetime.utcnow().isoformat()
                task_record["error_message"] = error_message
                break
        else:
            self.logger.error(f"Task record not found: {tenant_task_id}")
            return False
        
        self._save_data("task_records", task_records)
        self.logger.info(f"Updated task record to failed: {tenant_task_id}")
        return True
    
    def update_task_status(self, tenant_task_id: str, status: str, error_message: Optional[str] = None) -> bool:
        """Update task record status without altering result data"""
        task_records = self._load_data("task_records")
        updated = False
        
        for task_record in task_records:
            if task_record.get("tenant_task_id") == tenant_task_id:
                task_record["status"] = status
                if error_message is not None:
                    task_record["error_message"] = error_message
                if status in {"FAILED", "ERROR"}:
                    task_record["completed_at"] = datetime.utcnow().isoformat()
                elif status in {"PENDING", "RUNNING", "PROCESSING", "COMPLETING"}:
                    task_record["completed_at"] = None
                updated = True
                break
        
        if not updated:
            self.logger.error(f"Task record not found: {tenant_task_id}")
            return False
        
        self._save_data("task_records", task_records)
        self.logger.info(f"Updated task {tenant_task_id} status to {status}")
        return True
    
    def get_user_tasks(self, user_id: str, limit: int = 50, offset: int = 0, task_type: Optional[str] = None) -> List[Dict]:
        """Get user's task records"""
        task_records = self._load_data("task_records")
        user_tasks = [
            t
            for t in task_records
            if t.get("user_id") == user_id
            and (task_type is None or t.get("task_type") == task_type)
        ]
        sorted_tasks = sorted(user_tasks, key=lambda x: x.get("created_at", ""), reverse=True)
        return sorted_tasks[offset:offset + limit]

    def get_user_task_types(self, user_id: str) -> List[str]:
        """Return distinct task types for a user"""
        task_records = self._load_data("task_records")
        types = sorted(
            {
                task.get("task_type")
                for task in task_records
                if task.get("user_id") == user_id and task.get("task_type")
            }
        )
        return types

    def get_user_task_count(self, user_id: str, task_type: Optional[str] = None) -> int:
        """Get total count of a user's task records"""
        task_records = self._load_data("task_records")
        return sum(
            1
            for task in task_records
            if task.get("user_id") == user_id
            and (task_type is None or task.get("task_type") == task_type)
        )

    def delete_user_tasks(self, user_id: str, task_ids: List[str]) -> int:
        """Delete specific tasks for a user by tenant_task_id"""
        task_records = self._load_data("task_records")
        original_count = len(task_records)
        task_ids_set = set(task_ids)

        filtered_tasks = [
            task
            for task in task_records
            if not (task.get("user_id") == user_id and task.get("tenant_task_id") in task_ids_set)
        ]

        deleted = original_count - len(filtered_tasks)
        if deleted > 0:
            self._save_data("task_records", filtered_tasks)
        return deleted

    def delete_all_user_tasks(self, user_id: str, task_type: Optional[str] = None) -> int:
        """Delete all tasks for a user, optionally filtered by task type"""
        task_records = self._load_data("task_records")
        original_count = len(task_records)

        filtered_tasks = [
            task
            for task in task_records
            if not (
                task.get("user_id") == user_id
                and (task_type is None or task.get("task_type") == task_type)
            )
        ]

        deleted = original_count - len(filtered_tasks)
        if deleted > 0:
            self._save_data("task_records", filtered_tasks)
        return deleted

    # Project operations
    def _load_projects(self) -> List[Dict]:
        """Internal helper to load project list"""
        return self._load_data("project")

    def _save_projects(self, projects: List[Dict]):
        """Internal helper to persist project list"""
        self._save_data("project", projects)

    def _normalize_project_content(self, project_content: Optional[Dict]) -> Dict:
        """Ensure project_content has a mutable task_ids list"""
        content = dict(project_content or {})
        task_ids = content.get("task_ids")
        if task_ids is None:
            task_ids = []
        elif not isinstance(task_ids, list):
            task_ids = [task_ids]
        content["task_ids"] = list(dict.fromkeys(task_ids))
        return content

    def create_project(
        self,
        user_id: str,
        project_content: Optional[Dict] = None,
        project_id: Optional[str] = None
    ) -> Dict:
        """Create a new project entry stored in project.json"""
        projects = self._load_projects()
        content = self._normalize_project_content(project_content)

        final_project_id = (
            project_id
            or (project_content or {}).get("project_id")
            or f"project_{uuid.uuid4().hex[:16]}"
        )

        if any(p.get("project_id") == final_project_id for p in projects):
            raise ValueError(f"Project ID already exists: {final_project_id}")

        now = datetime.utcnow().isoformat()
        project = {
            "project_id": final_project_id,
            "user_id": user_id,
            "project_content": content,
            "created_at": now,
            "updated_at": now
        }

        projects.append(project)
        self._save_projects(projects)
        self.logger.info(f"Created project: {final_project_id}")
        return project

    def get_project_by_id(self, project_id: str) -> Optional[Dict]:
        """Fetch a project by its identifier"""
        projects = self._load_projects()
        return next((p for p in projects if p.get("project_id") == project_id), None)

    def get_project_access_summary(self, project_id: str) -> Optional[Dict]:
        """Fetch the small subset of project fields needed by task-list requests"""
        project = self.get_project_by_id(project_id)
        if not project:
            return None

        content = project.get("project_content") or {}
        task_ids = content.get("task_ids") if isinstance(content, dict) else []
        if not isinstance(task_ids, list):
            task_ids = []

        return {
            "project_id": project.get("project_id"),
            "user_id": project.get("user_id"),
            "task_ids": [task_id for task_id in task_ids if isinstance(task_id, str)],
            "created_at": project.get("created_at"),
            "updated_at": project.get("updated_at"),
        }

    def list_projects(self, user_id: Optional[str] = None) -> List[Dict]:
        """Return all projects or filter by owner"""
        projects = self._load_projects()
        if user_id is None:
            return projects
        return [p for p in projects if p.get("user_id") == user_id]

    def _update_project_record(self, projects: List[Dict], project: Dict) -> None:
        """Persist updated project in list"""
        for idx, existing in enumerate(projects):
            if existing.get("project_id") == project.get("project_id"):
                projects[idx] = project
                break
        else:
            projects.append(project)
        self._save_projects(projects)

    def add_task_to_project(
        self,
        project_id: str,
        task_id: str,
        user_id: Optional[str] = None,
        project_content: Optional[Dict] = None
    ) -> Dict:
        """
        Attach a task to a project. Create the project if it does not exist and content is provided.
        """
        projects = self._load_projects()
        project = self.get_project_by_id(project_id)

        if project is None:
            if user_id is None:
                raise ValueError("user_id is required when creating a new project")
            content = self._normalize_project_content(project_content)
            content["task_ids"].append(task_id)
            project = {
                "project_id": project_id,
                "user_id": user_id,
                "project_content": content,
                "created_at": datetime.utcnow().isoformat(),
                "updated_at": datetime.utcnow().isoformat()
            }
            projects.append(project)
            self._save_projects(projects)
            return project

        if user_id and project.get("user_id") and project["user_id"] != user_id:
            raise ValueError("Project owner mismatch")

        content = self._normalize_project_content(project.get("project_content"))
        if task_id not in content["task_ids"]:
            content["task_ids"].append(task_id)
            project["project_content"] = content
            project["updated_at"] = datetime.utcnow().isoformat()
            self._update_project_record(projects, project)

        return project

    def remove_task_from_project(self, project_id: str, task_id: str, user_id: Optional[str] = None) -> bool:
        """Detach a task from a project if present"""
        projects = self._load_projects()
        project = self.get_project_by_id(project_id)

        if project is None:
            return False
        if user_id and project.get("user_id") and project["user_id"] != user_id:
            raise ValueError("Project owner mismatch")

        content = self._normalize_project_content(project.get("project_content"))
        if task_id not in content["task_ids"]:
            return False

        content["task_ids"].remove(task_id)
        project["project_content"] = content
        project["updated_at"] = datetime.utcnow().isoformat()
        self._update_project_record(projects, project)
        return True

    def update_project_content(self, project_id: str, updates: Dict, user_id: Optional[str] = None) -> Optional[Dict]:
        """Partial update to project_content metadata while keeping task list intact"""
        projects = self._load_projects()
        project = self.get_project_by_id(project_id)

        if project is None:
            return None
        if user_id and project.get("user_id") and project["user_id"] != user_id:
            raise ValueError("Project owner mismatch")

        content = self._normalize_project_content(project.get("project_content"))
        updates = dict(updates or {})

        task_ids_override = updates.pop("task_ids", None)
        if task_ids_override is not None:
            if not isinstance(task_ids_override, list):
                raise ValueError("task_ids must be a list when provided in updates")
            content["task_ids"] = list(dict.fromkeys(task_ids_override))

        content.update(updates)
        from ..services.sheet_markdown_storage import persist_sheet_markdown
        content = persist_sheet_markdown(content, user_id or project.get("user_id"), project_id)
        project["project_content"] = content
        project["updated_at"] = datetime.utcnow().isoformat()
        self._update_project_record(projects, project)
        return project

    def delete_project(
        self,
        project_id: str,
        user_id: Optional[str] = None,
        confirm_name: Optional[str] = None,
    ) -> bool:
        """Delete a project entry without touching task_records"""
        projects = self._load_projects()
        updated_projects = []
        deleted = False

        for project in projects:
            if project.get("project_id") == project_id:
                if user_id and project.get("user_id") and project["user_id"] != user_id:
                    raise ValueError("Project owner mismatch")
                content = self._normalize_project_content(project.get("project_content"))
                if content.get("protected"):
                    project_name = str(content.get("name") or project_id).strip()
                    if not confirm_name or confirm_name.strip() != project_name:
                        raise ValueError("Protected project deletion requires an exact project name confirmation")
                deleted = True
                continue
            updated_projects.append(project)

        if deleted:
            self._save_projects(updated_projects)
        return deleted

    # Project share (access) operations
    def _load_project_shares(self) -> List[Dict]:
        """Load project_share.json as a list"""
        return self._load_data("project_share")

    def _save_project_shares(self, shares: List[Dict]) -> None:
        """Persist project_share.json"""
        self._save_data("project_share", shares)

    def list_project_shares(
        self,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> List[Dict]:
        """List project access entries, optionally filtered"""
        shares = self._load_project_shares()
        if project_id:
            shares = [share for share in shares if share.get("project_id") == project_id]
        if user_id:
            shares = [share for share in shares if share.get("user_id") == user_id]
        return shares

    def grant_project_access(
        self,
        project_id: str,
        user_id: str,
        granted_by_user_id: str,
        permission: str = "viewer",
    ) -> Dict:
        """Create or update a project access entry"""
        shares = self._load_project_shares()
        now = datetime.utcnow().isoformat()
        existing = next(
            (share for share in shares if share.get("project_id") == project_id and share.get("user_id") == user_id),
            None,
        )

        if existing:
            existing["permission"] = permission
            existing["granted_by_user_id"] = granted_by_user_id
            existing["updated_at"] = now
            if not existing.get("granted_at"):
                existing["granted_at"] = now
            share = existing
        else:
            share = {
                "access_id": f"access_{uuid.uuid4().hex[:16]}",
                "project_id": project_id,
                "user_id": user_id,
                "permission": permission,
                "granted_by_user_id": granted_by_user_id,
                "granted_at": now,
                "updated_at": now,
            }
            shares.append(share)

        self._save_project_shares(shares)
        return share

    def revoke_project_access(
        self,
        access_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> bool:
        """Remove a project access entry"""
        shares = self._load_project_shares()

        if not any([access_id, project_id and user_id]):
            return False

        updated: List[Dict] = []
        removed = False
        for share in shares:
            matches_id = access_id and share.get("access_id") == access_id
            matches_pair = (
                project_id
                and user_id
                and share.get("project_id") == project_id
                and share.get("user_id") == user_id
            )

            if matches_id or matches_pair:
                removed = True
                continue
            updated.append(share)

        if removed:
            self._save_project_shares(updated)
        return removed

    def list_user_project_shares(self, user_id: str) -> List[Dict]:
        """Return all share entries that include the specified user"""
        return self.list_project_shares(user_id=user_id)

    # Project invite operations
    def _load_project_invites(self) -> List[Dict]:
        """Load project_invite.json"""
        return self._load_data("project_invite")

    def _save_project_invites(self, invites: List[Dict]) -> None:
        """Persist project_invite.json"""
        self._save_data("project_invite", invites)

    def list_project_invites(
        self,
        project_id: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict]:
        """Return invitation entries filtered by project/owner/status"""
        invites = self._load_project_invites()
        if project_id:
            invites = [invite for invite in invites if invite.get("project_id") == project_id]
        if owner_user_id:
            invites = [invite for invite in invites if invite.get("owner_user_id") == owner_user_id]
        if status:
            invites = [invite for invite in invites if invite.get("status") == status]
        return invites

    def create_project_invite(
        self,
        project_id: str,
        owner_user_id: str,
        target_user_id: str,
        permission: str = "viewer",
        expires_at: Optional[str] = None,
        message: Optional[str] = None,
    ) -> Dict:
        """Create and store a new invitation entry"""
        invites = self._load_project_invites()
        now = datetime.utcnow().isoformat()
        invite = {
            "invite_id": f"invite_{uuid.uuid4().hex[:16]}",
            "project_id": project_id,
            "owner_user_id": owner_user_id,
            "target_user_id": target_user_id,
            "permission": permission,
            "status": "pending",
            "invite_token": uuid.uuid4().hex,
            "expires_at": expires_at,
            "message": message,
            "created_at": now,
            "updated_at": now,
        }
        invites.append(invite)
        self._save_project_invites(invites)
        return invite

    def update_project_invite_status(
        self,
        invite_id: str,
        status: str,
    ) -> Optional[Dict]:
        """Update status on an existing invite"""
        invites = self._load_project_invites()
        now = datetime.utcnow().isoformat()
        for invite in invites:
            if invite.get("invite_id") == invite_id:
                invite["status"] = status
                invite["updated_at"] = now
                self._save_project_invites(invites)
                return invite
        return None

    def delete_project_invite(self, invite_id: str) -> bool:
        """Delete an invitation entry"""
        invites = self._load_project_invites()
        updated = [invite for invite in invites if invite.get("invite_id") != invite_id]
        if len(updated) == len(invites):
            return False
        self._save_project_invites(updated)
        return True

    def get_project_invite(self, invite_id: str) -> Optional[Dict]:
        """Fetch single invite by id"""
        invites = self._load_project_invites()
        for invite in invites:
            if invite.get("invite_id") == invite_id:
                return invite
        return None

    def list_user_invites(
        self,
        target_user_id: str,
        status: Optional[str] = None,
    ) -> List[Dict]:
        """Return invites for a specific target user with optional status filter"""
        invites = self._load_project_invites()
        filtered = [
            invite for invite in invites if invite.get("target_user_id") == target_user_id
        ]
        if status:
            filtered = [invite for invite in filtered if invite.get("status") == status]
        return filtered

    # Lora model operations
    def _load_lora_records(self) -> List[Dict]:
        return self._load_data("tenant_lora")

    def _save_lora_records(self, records: List[Dict]):
        self._save_data("tenant_lora", records)

    def list_lora_records(self, user_id: str) -> List[Dict]:
        records = self._load_lora_records()
        result: List[Dict] = []
        for record in records:
            owner_id = record.get("owner_user_id")
            access_list = record.get("access_user_ids") or []
            if not isinstance(access_list, list):
                access_list = [access_list]
            if owner_id == user_id or user_id in access_list:
                result.append(record)
        result.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return result

    def create_lora_record(
        self,
        owner_user_id: str,
        name: str,
        file_entries: List[Dict],
        directory: str,
        access_user_ids: Optional[List[str]] = None,
        description: Optional[str] = None,
    ) -> Dict:
        records = self._load_lora_records()
        lora_id = f"lora_{uuid.uuid4().hex[:16]}"
        now = datetime.utcnow().isoformat()
        record = {
            "lora_id": lora_id,
            "owner_user_id": owner_user_id,
            "name": name,
            "description": description,
            "access_user_ids": access_user_ids or [],
            "file_entries": file_entries,
            "directory": directory,
            "training_status": 1,
            "preview_entry": None,
            "created_at": now,
            "updated_at": now,
        }
        records.append(record)
        self._save_lora_records(records)
        return record

    def update_lora_record(
        self,
        lora_id: str,
        owner_user_id: str,
        updates: Dict,
    ) -> Optional[Dict]:
        records = self._load_lora_records()
        updated_record: Optional[Dict] = None
        for record in records:
            if record.get("lora_id") == lora_id and record.get("owner_user_id") == owner_user_id:
                record.update(updates)
                record["updated_at"] = datetime.utcnow().isoformat()
                updated_record = record
                break
        if updated_record:
            self._save_lora_records(records)
        return updated_record

    def delete_lora_record(self, lora_id: str, owner_user_id: str) -> bool:
        records = self._load_lora_records()
        remaining = [record for record in records if not (record.get("lora_id") == lora_id and record.get("owner_user_id") == owner_user_id)]
        if len(remaining) == len(records):
            return False
        self._save_lora_records(remaining)
        return True

    def get_lora_record(self, lora_id: str) -> Optional[Dict]:
        records = self._load_lora_records()
        return next((record for record in records if record.get("lora_id") == lora_id), None)
