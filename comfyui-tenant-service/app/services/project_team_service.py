from contextlib import contextmanager
from datetime import datetime
import uuid
from typing import Dict, List, Optional
from .json_storage import JSONStorage
from .logger import get_main_logger
from ..models.database import get_db, ProjectShareRecord, ProjectInviteRecord
from ..services.config import get_settings


def _to_iso(value: Optional[datetime]) -> Optional[str]:
    if not value:
        return None
    return value.isoformat()

def _parse_optional_datetime(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


class SQLProjectTeamStorage:
    def __init__(self, session):
        self.db = session

    def _share_to_dict(self, record: ProjectShareRecord) -> Dict:
        return {
            "access_id": record.access_id,
            "project_id": record.project_id,
            "user_id": record.user_id,
            "permission": record.permission,
            "granted_by_user_id": record.granted_by_user_id,
            "granted_at": _to_iso(record.granted_at),
            "updated_at": _to_iso(record.updated_at),
        }

    def _invite_to_dict(self, record: ProjectInviteRecord) -> Dict:
        return {
            "invite_id": record.invite_id,
            "project_id": record.project_id,
            "owner_user_id": record.owner_user_id,
            "target_user_id": record.target_user_id,
            "permission": record.permission,
            "status": record.status,
            "invite_token": record.invite_token,
            "expires_at": _to_iso(record.expires_at),
            "message": record.message,
            "created_at": _to_iso(record.created_at),
            "updated_at": _to_iso(record.updated_at),
        }

    def list_project_shares(self, project_id: Optional[str] = None, user_id: Optional[str] = None) -> List[Dict]:
        query = self.db.query(ProjectShareRecord)
        if project_id:
            query = query.filter(ProjectShareRecord.project_id == project_id)
        if user_id:
            query = query.filter(ProjectShareRecord.user_id == user_id)
        return [self._share_to_dict(record) for record in query.all()]

    def grant_project_access(
        self,
        project_id: str,
        user_id: str,
        granted_by_user_id: str,
        permission: str,
    ) -> Dict:
        record = (
            self.db.query(ProjectShareRecord)
            .filter(ProjectShareRecord.project_id == project_id, ProjectShareRecord.user_id == user_id)
            .first()
        )
        now = datetime.utcnow()
        try:
            if record:
                record.permission = permission
                record.granted_by_user_id = granted_by_user_id
                record.updated_at = now
            else:
                record = ProjectShareRecord(
                    access_id=f"access_{uuid.uuid4().hex[:16]}",
                    project_id=project_id,
                    user_id=user_id,
                    permission=permission,
                    granted_by_user_id=granted_by_user_id,
                    granted_at=now,
                    updated_at=now,
                )
                self.db.add(record)
            self.db.commit()
            self.db.refresh(record)
            return self._share_to_dict(record)
        except Exception:
            self.db.rollback()
            raise

    def revoke_project_access(
        self,
        access_id: Optional[str] = None,
        project_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ) -> bool:
        if not access_id and not (project_id and user_id):
            return False
        query = self.db.query(ProjectShareRecord)
        if access_id:
            query = query.filter(ProjectShareRecord.access_id == access_id)
        else:
            query = query.filter(
                ProjectShareRecord.project_id == project_id,
                ProjectShareRecord.user_id == user_id,
            )
        try:
            removed = query.delete(synchronize_session=False) > 0
            if removed:
                self.db.commit()
            else:
                self.db.rollback()
            return removed
        except Exception:
            self.db.rollback()
            raise

    def list_project_invites(
        self,
        project_id: Optional[str] = None,
        owner_user_id: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[Dict]:
        query = self.db.query(ProjectInviteRecord)
        if project_id:
            query = query.filter(ProjectInviteRecord.project_id == project_id)
        if owner_user_id:
            query = query.filter(ProjectInviteRecord.owner_user_id == owner_user_id)
        if status:
            query = query.filter(ProjectInviteRecord.status == status)
        return [self._invite_to_dict(record) for record in query.all()]

    def create_project_invite(
        self,
        project_id: str,
        owner_user_id: str,
        target_user_id: str,
        permission: str,
        expires_at: Optional[str],
        message: Optional[str] = None,
    ) -> Dict:
        now = datetime.utcnow()
        try:
            record = ProjectInviteRecord(
                invite_id=f"invite_{uuid.uuid4().hex[:16]}",
                project_id=project_id,
                owner_user_id=owner_user_id,
                target_user_id=target_user_id,
                permission=permission,
                status="pending",
                invite_token=uuid.uuid4().hex,
                expires_at=_parse_optional_datetime(expires_at),
                message=message,
                created_at=now,
                updated_at=now,
            )
            self.db.add(record)
            self.db.commit()
            self.db.refresh(record)
            return self._invite_to_dict(record)
        except Exception:
            self.db.rollback()
            raise

    def update_project_invite_status(self, invite_id: str, status: str) -> Optional[Dict]:
        record = (
            self.db.query(ProjectInviteRecord)
            .filter(ProjectInviteRecord.invite_id == invite_id)
            .first()
        )
        if not record:
            return None
        try:
            record.status = status
            record.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(record)
            return self._invite_to_dict(record)
        except Exception:
            self.db.rollback()
            raise

    def delete_project_invite(self, invite_id: str) -> bool:
        try:
            deleted = (
                self.db.query(ProjectInviteRecord)
                .filter(ProjectInviteRecord.invite_id == invite_id)
                .delete(synchronize_session=False)
            )
            if deleted:
                self.db.commit()
                return True
            self.db.rollback()
            return False
        except Exception:
            self.db.rollback()
            raise

    def list_user_invites(self, target_user_id: str, status: Optional[str] = None) -> List[Dict]:
        query = self.db.query(ProjectInviteRecord).filter(
            ProjectInviteRecord.target_user_id == target_user_id
        )
        if status:
            query = query.filter(ProjectInviteRecord.status == status)
        return [self._invite_to_dict(record) for record in query.all()]

    def get_project_invite(self, invite_id: str) -> Optional[Dict]:
        record = (
            self.db.query(ProjectInviteRecord)
            .filter(ProjectInviteRecord.invite_id == invite_id)
            .first()
        )
        if not record:
            return None
        return self._invite_to_dict(record)


class ProjectTeamService:
    """Service helpers for project share & invite data."""

    def __init__(self) -> None:
        self.storage = JSONStorage()
        self.logger = get_main_logger()
        self.settings = get_settings()

    def _using_sql(self) -> bool:
        return not self.settings.is_json_storage()

    @contextmanager
    def _sql_storage(self):
        db_gen = get_db()
        db = next(db_gen)
        try:
            yield SQLProjectTeamStorage(db)
        finally:
            try:
                next(db_gen)
            except StopIteration:
                pass

    # Share (member) operations -------------------------------------------------
    def list_members(self, project_id: str) -> List[Dict]:
        if self._using_sql():
            with self._sql_storage() as storage:
                return storage.list_project_shares(project_id=project_id)
        return self.storage.list_project_shares(project_id=project_id)

    def list_user_memberships(self, user_id: str) -> List[Dict]:
        if self._using_sql():
            with self._sql_storage() as storage:
                return storage.list_project_shares(user_id=user_id)
        return self.storage.list_user_project_shares(user_id=user_id)

    def get_member_entry(self, project_id: str, user_id: str) -> Optional[Dict]:
        entries = self.list_members(project_id)
        for share in entries:
            if share.get("user_id") == user_id:
                return share
        return None

    def grant_member(
        self,
        project_id: str,
        user_id: str,
        granted_by_user_id: str,
        permission: str,
    ) -> Dict:
        if self._using_sql():
            with self._sql_storage() as storage:
                member = storage.grant_project_access(
                    project_id=project_id,
                    user_id=user_id,
                    granted_by_user_id=granted_by_user_id,
                    permission=permission,
                )
        else:
            member = self.storage.grant_project_access(
                project_id=project_id,
                user_id=user_id,
                granted_by_user_id=granted_by_user_id,
                permission=permission,
            )
        self.logger.debug(f"Granted {user_id} access to {project_id} as {permission}")
        return member

    def revoke_member(self, access_id: Optional[str], project_id: str, user_id: Optional[str] = None) -> bool:
        if self._using_sql():
            with self._sql_storage() as storage:
                removed = storage.revoke_project_access(access_id, project_id, user_id)
        else:
            removed = self.storage.revoke_project_access(
                access_id=access_id,
                project_id=project_id,
                user_id=user_id,
            )
        if removed:
            self.logger.debug(f"Revoked access {access_id or user_id} from {project_id}")
        return removed

    # Invite operations ---------------------------------------------------------
    def list_invites(self, project_id: str) -> List[Dict]:
        if self._using_sql():
            with self._sql_storage() as storage:
                return storage.list_project_invites(project_id=project_id)
        return self.storage.list_project_invites(project_id=project_id)

    def create_invite(
        self,
        project_id: str,
        owner_user_id: str,
        target_user_id: str,
        permission: str,
        expires_at: Optional[str],
        message: Optional[str] = None,
    ) -> Dict:
        if self._using_sql():
            with self._sql_storage() as storage:
                invite = storage.create_project_invite(
                    project_id=project_id,
                    owner_user_id=owner_user_id,
                    target_user_id=target_user_id,
                    permission=permission,
                    expires_at=expires_at,
                    message=message,
                )
        else:
            invite = self.storage.create_project_invite(
                project_id=project_id,
                owner_user_id=owner_user_id,
                target_user_id=target_user_id,
                permission=permission,
                expires_at=expires_at,
                message=message,
            )
        self.logger.debug(f"Created invite {invite['invite_id']} for {target_user_id} on {project_id}")
        return invite

    def update_invite_status(self, invite_id: str, status: str) -> Optional[Dict]:
        if self._using_sql():
            with self._sql_storage() as storage:
                invite = storage.update_project_invite_status(invite_id, status)
        else:
            invite = self.storage.update_project_invite_status(invite_id, status)
        if invite:
            self.logger.debug(f"Invite {invite_id} status updated to {status}")
        return invite

    def delete_invite(self, invite_id: str) -> bool:
        if self._using_sql():
            with self._sql_storage() as storage:
                deleted = storage.delete_project_invite(invite_id)
        else:
            deleted = self.storage.delete_project_invite(invite_id)
        if deleted:
            self.logger.debug(f"Invite {invite_id} deleted")
        return deleted

    def list_user_invites(self, target_user_id: str, status: Optional[str] = None) -> List[Dict]:
        if self._using_sql():
            with self._sql_storage() as storage:
                return storage.list_user_invites(target_user_id, status)
        return self.storage.list_user_invites(target_user_id, status)

    def get_invite(self, invite_id: str) -> Optional[Dict]:
        if self._using_sql():
            with self._sql_storage() as storage:
                return storage.get_project_invite(invite_id)
        return self.storage.get_project_invite(invite_id)


project_team_service = ProjectTeamService()
