import asyncio
from types import SimpleNamespace

from app.routers.auth import AuthenticatedUser, ChangePasswordPayload, change_password
from app.services.auth import get_password_hash, verify_password


class _FakeQuery:
    def __init__(self, user):
        self._user = user

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._user


class _FakeDb:
    def __init__(self, user):
        self._user = user
        self.added = []
        self.committed = False

    def query(self, model):
        return _FakeQuery(self._user)

    def add(self, obj):
        self.added.append(obj)

    def commit(self):
        self.committed = True


def test_change_password_updates_mapped_user_not_wrapper(monkeypatch):
    old_password = "OldPass123!"
    new_password = "NewPass456!"
    user = SimpleNamespace(
        username="codex_change_password@example.com",
        hashed_password=get_password_hash(old_password),
    )
    current_user = AuthenticatedUser(
        {
            "username": user.username,
            "tenant_id": 1,
            "hashed_password": user.hashed_password,
        }
    )
    settings = SimpleNamespace(is_database_storage=lambda: True)
    db = _FakeDb(user)

    monkeypatch.setattr("app.routers.auth._invalidate_auth_cache", lambda *args, **kwargs: None)

    result = asyncio.run(
        change_password(
            ChangePasswordPayload(current_password=old_password, new_password=new_password),
            current_user=current_user,
            settings=settings,
            db=db,
        )
    )

    assert result == {"status": "ok"}
    assert db.committed is True
    assert db.added == [user]
    assert verify_password(new_password, user.hashed_password)
    assert user.hashed_password != current_user.hashed_password
