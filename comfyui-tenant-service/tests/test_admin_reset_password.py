import asyncio
from types import SimpleNamespace

from app.routers.admin import ADMIN_RESET_PASSWORD, reset_user_password
from app.routers.auth import AuthenticatedUser
from app.services.auth import get_password_hash, verify_password


class _FakeQuery:
    def __init__(self, user):
        self._user = user

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._user


class _FakeDatabaseSession:
    def __init__(self, user):
        self._user = user
        self.added = []
        self.committed = False
        self.refreshed = []

    def query(self, model):
        return _FakeQuery(self._user)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        self.refreshed.append(obj)


class _FakeJsonStorage:
    def __init__(self, user):
        self._user = user
        self.updated = []

    def get_user_by_id(self, user_id):
        if self._user and self._user.get("id") == user_id:
            return self._user
        return None

    def update_user_password(self, username, password_hash):
        self.updated.append((username, password_hash))
        if self._user and self._user.get("username") == username:
            self._user["hashed_password"] = password_hash
            return True
        return False


def test_reset_user_password_updates_database_user(monkeypatch):
    old_password = "OldPass123!"
    user = SimpleNamespace(
        id=42,
        username="codex_reset_password@example.com",
        email="codex_reset_password@example.com",
        tenant_id=1,
        is_active=True,
        credit=0,
        group=1001,
        role="user",
        manager_username=None,
        max_active_employees=5,
        hashed_password=get_password_hash(old_password),
    )
    current_user = AuthenticatedUser(
        {
            "username": "admin@example.com",
            "tenant_id": 1,
            "group": 1000,
        }
    )
    db = _FakeDatabaseSession(user)
    settings = SimpleNamespace(is_database_storage=lambda: True, user_default_group=1001)

    monkeypatch.setattr("app.routers.admin.get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.admin._invalidate_auth_cache", lambda *args, **kwargs: None)

    result = asyncio.run(reset_user_password(user.id, current_user=current_user, db=db))

    assert result["password"] == ADMIN_RESET_PASSWORD
    assert result["user"]["username"] == user.username
    assert db.committed is True
    assert db.added == [user]
    assert db.refreshed == [user]
    assert verify_password(ADMIN_RESET_PASSWORD, user.hashed_password)


def test_reset_user_password_updates_json_storage(monkeypatch):
    user = {
        "id": 77,
        "username": "codex_reset_password_json@example.com",
        "email": "codex_reset_password_json@example.com",
        "tenant_id": 1,
        "is_active": True,
        "credit": 0,
        "group": 1001,
        "role": "user",
        "manager_username": None,
        "max_active_employees": 5,
        "hashed_password": get_password_hash("OldPass123!"),
    }
    current_user = AuthenticatedUser(
        {
            "username": "admin@example.com",
            "tenant_id": 1,
            "group": 1000,
        }
    )
    db = _FakeJsonStorage(user)
    settings = SimpleNamespace(is_database_storage=lambda: False, user_default_group=1001)

    monkeypatch.setattr("app.routers.admin.get_settings", lambda: settings)
    monkeypatch.setattr("app.routers.admin._invalidate_auth_cache", lambda *args, **kwargs: None)

    result = asyncio.run(reset_user_password(user["id"], current_user=current_user, db=db))

    assert result["password"] == ADMIN_RESET_PASSWORD
    assert result["user"]["username"] == user["username"]
    assert len(db.updated) == 1
    updated_username, updated_hash = db.updated[0]
    assert updated_username == user["username"]
    assert verify_password(ADMIN_RESET_PASSWORD, updated_hash)
    assert verify_password(ADMIN_RESET_PASSWORD, user["hashed_password"])
