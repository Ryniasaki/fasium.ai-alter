import asyncio
from datetime import datetime, timezone
from types import SimpleNamespace

import app.routers.feedback as feedback_router
import app.services.feedback_service as feedback_service_module
import app.services.json_storage as json_storage_module
from app.services.feedback_service import FEEDBACK_REWARD_POINTS, FEEDBACK_MONTHLY_REWARD_LIMIT, feedback_service
from app.services.json_storage import JSONStorage


class _FakeColumn:
    def __init__(self, name: str):
        self.name = name

    def _expr(self, operator: str, value):
        return (operator, self.name, value)

    def __eq__(self, other):
        return self._expr("eq", other)

    def __ge__(self, other):
        return self._expr("ge", other)

    def __gt__(self, other):
        return self._expr("gt", other)

    def __lt__(self, other):
        return self._expr("lt", other)

    def desc(self):
        return ("desc", self.name)


class _FakeFeedbackRecord:
    id = _FakeColumn("id")
    tenant_id = _FakeColumn("tenant_id")
    user_id = _FakeColumn("user_id")
    username = _FakeColumn("username")
    content = _FakeColumn("content")
    attachments = _FakeColumn("attachments")
    reward_points = _FakeColumn("reward_points")
    rewarded_at = _FakeColumn("rewarded_at")
    created_at = _FakeColumn("created_at")

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


class _FakeUser:
    id = _FakeColumn("id")

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


class _FakeQuery:
    def __init__(self, session, target):
        self.session = session
        self.target = target
        self.criteria = []
        self.orderings = []
        self.limit_value = None

    def filter(self, *criteria):
        self.criteria.extend(criteria)
        return self

    def order_by(self, *orderings):
        self.orderings.extend(orderings)
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def first(self):
        items = self._apply()
        return items[0] if items else None

    def all(self):
        return self._apply()

    def scalar(self):
        return len(self._apply())

    def _source_items(self):
        if self.target is _FakeUser:
            return self.session.users
        return self.session.feedback_records

    def _value_for(self, item, field_name):
        if isinstance(item, dict):
            return item.get(field_name)
        return getattr(item, field_name, None)

    def _matches(self, item):
        for criterion in self.criteria:
            if not isinstance(criterion, tuple) or len(criterion) != 3:
                continue
            operator, field_name, expected = criterion
            actual = self._value_for(item, field_name)
            if operator == "eq" and actual != expected:
                return False
            if operator == "gt" and not (actual is not None and actual > expected):
                return False
            if operator == "ge" and not (actual is not None and actual >= expected):
                return False
            if operator == "lt" and not (actual is not None and actual < expected):
                return False
            if operator == "le" and not (actual is not None and actual <= expected):
                return False
        return True

    def _apply(self):
        items = [item for item in self._source_items() if self._matches(item)]

        if self.target is _FakeFeedbackRecord:
            def sort_key(item):
                created_at = self._value_for(item, "created_at") or datetime.min
                record_id = self._value_for(item, "id") or 0
                return (created_at, record_id)

            items.sort(key=sort_key, reverse=True)

        if self.limit_value is not None:
            items = items[: self.limit_value]

        return items


class _FakeDatabaseSession:
    def __init__(self, users=None, feedback_records=None):
        self.users = list(users or [])
        self.feedback_records = list(feedback_records or [])
        self.added = []
        self.committed = False
        self.refreshed = []
        self.rolled_back = False

    def query(self, model):
        return _FakeQuery(self, model)

    def add(self, obj):
        self.added.append(obj)
        if isinstance(obj, _FakeFeedbackRecord):
            if getattr(obj, "id", None) is None:
                obj.id = len(self.feedback_records) + 1
            if getattr(obj, "created_at", None) is None:
                obj.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
            self.feedback_records.append(obj)
            return

        if isinstance(obj, SimpleNamespace) and all(existing is not obj for existing in self.users):
            self.users.append(obj)

    def commit(self):
        self.committed = True

    def refresh(self, obj):
        self.refreshed.append(obj)

    def rollback(self):
        self.rolled_back = True


def _make_json_storage(tmp_path, monkeypatch):
    settings = SimpleNamespace(
        json_storage_path=str(tmp_path),
        user_default_credit=0,
        user_default_group=1001,
        is_json_storage=lambda: True,
        is_database_storage=lambda: False,
    )
    monkeypatch.setattr(json_storage_module, "get_settings", lambda: settings)
    return JSONStorage()


def test_feedback_rewards_json_storage_caps_monthly_reward_and_updates_credit(tmp_path, monkeypatch):
    storage = _make_json_storage(tmp_path, monkeypatch)
    monkeypatch.setattr(feedback_service, "settings", SimpleNamespace(is_database_storage=lambda: False))

    user = storage.create_user("json_feedback_user", "hash", tenant_id=1)

    results = []
    statuses = []
    for index in range(4):
        result = feedback_service.create_feedback(
            db=storage,
            current_user=user,
            content=f"Feedback {index + 1}",
            attachments=[],
        )
        results.append(result)
        statuses.append(feedback_service.get_monthly_reward_status(storage, user))

    assert [item["reward_points"] for item in results[:3]] == [FEEDBACK_REWARD_POINTS] * 3
    assert results[3]["reward_points"] == 0
    assert [item["reward_granted"] for item in results[:3]] == [True, True, True]
    assert results[3]["reward_granted"] is False
    assert [item["rewarded_this_month"] for item in statuses] == [1, 2, 3, 3]
    assert statuses[3]["remaining_reward_slots"] == 0

    status = feedback_service.get_monthly_reward_status(storage, user)
    assert status["monthly_reward_limit"] == FEEDBACK_MONTHLY_REWARD_LIMIT
    assert status["reward_points_per_feedback"] == FEEDBACK_REWARD_POINTS
    assert status["rewarded_this_month"] == 3
    assert status["remaining_reward_slots"] == 0
    assert storage.get_user_by_id(user["id"])["credit"] == FEEDBACK_REWARD_POINTS * 3


def test_feedback_visibility_json_storage_splits_admin_and_user_views(tmp_path, monkeypatch):
    storage = _make_json_storage(tmp_path, monkeypatch)
    monkeypatch.setattr(feedback_service, "settings", SimpleNamespace(is_database_storage=lambda: False))

    alice = storage.create_user("alice_feedback_user", "hash", tenant_id=1)
    bob = storage.create_user("bob_feedback_user", "hash", tenant_id=1)

    reward_time = datetime(2026, 6, 18, 8, 0, tzinfo=timezone.utc)
    storage.create_feedback(
        tenant_id=1,
        user_id=alice["id"],
        username=alice["username"],
        content="Alice rewarded feedback",
        attachments=[],
        reward_points=FEEDBACK_REWARD_POINTS,
        rewarded_at=reward_time,
    )
    storage.create_feedback(
        tenant_id=1,
        user_id=bob["id"],
        username=bob["username"],
        content="Bob feedback",
        attachments=[],
        reward_points=0,
    )
    storage.create_feedback(
        tenant_id=1,
        user_id=alice["id"],
        username=alice["username"],
        content="Alice follow-up feedback",
        attachments=[],
        reward_points=0,
    )

    admin_user = SimpleNamespace(id=99, username="admin", tenant_id=1, group=1000)

    admin_view = feedback_service.list_visible_feedback(storage, admin_user, limit=None)
    alice_view = feedback_service.list_visible_feedback(storage, alice, limit=None)

    assert len(admin_view) == 3
    assert {item["user_id"] for item in admin_view} == {alice["id"], bob["id"]}
    assert len(alice_view) == 2
    assert all(item["user_id"] == alice["id"] for item in alice_view)
    assert any(item["reward_points"] == FEEDBACK_REWARD_POINTS for item in admin_view)


def test_feedback_route_get_returns_camel_case_payload_and_admin_view(tmp_path, monkeypatch):
    storage = _make_json_storage(tmp_path, monkeypatch)
    monkeypatch.setattr(feedback_service, "settings", SimpleNamespace(is_database_storage=lambda: False))

    alice = storage.create_user("alice_route_user", "hash", tenant_id=1)
    bob = storage.create_user("bob_route_user", "hash", tenant_id=1)

    storage.create_feedback(
        tenant_id=1,
        user_id=alice["id"],
        username=alice["username"],
        content="Alice route feedback",
        attachments=[],
        reward_points=FEEDBACK_REWARD_POINTS,
    )
    storage.create_feedback(
        tenant_id=1,
        user_id=bob["id"],
        username=bob["username"],
        content="Bob route feedback",
        attachments=[],
        reward_points=0,
    )

    user_response = asyncio.run(feedback_router.list_feedback(current_user=alice, db=storage))
    admin_response = asyncio.run(
        feedback_router.list_feedback(
            current_user=SimpleNamespace(id=99, username="admin", tenant_id=1, group=1000),
            db=storage,
        )
    )

    assert user_response["isAdminView"] is False
    assert user_response["rewardPointsPerFeedback"] == FEEDBACK_REWARD_POINTS
    assert user_response["rewardedThisMonth"] == 1
    assert user_response["remainingRewardSlots"] == FEEDBACK_MONTHLY_REWARD_LIMIT - 1
    assert len(user_response["items"]) == 1
    assert user_response["items"][0]["rewardPoints"] == FEEDBACK_REWARD_POINTS
    assert user_response["items"][0]["rewardGranted"] is True

    assert admin_response["isAdminView"] is True
    assert len(admin_response["items"]) == 2
    assert {item["userId"] for item in admin_response["items"]} == {alice["id"], bob["id"]}


def test_feedback_route_post_returns_reward_status_and_item(tmp_path, monkeypatch):
    storage = _make_json_storage(tmp_path, monkeypatch)
    monkeypatch.setattr(feedback_service, "settings", SimpleNamespace(is_database_storage=lambda: False))

    user = storage.create_user("route_post_user", "hash", tenant_id=1)

    credit_updates = []

    async def _fake_send_credit_update(user_id, credit):
        credit_updates.append((user_id, credit))

    monkeypatch.setattr(feedback_router.credit_ws_manager, "send_credit_update", _fake_send_credit_update)

    response = asyncio.run(
        feedback_router.create_feedback(
            content="Route feedback submission",
            files=None,
            current_user=user,
            db=storage,
        )
    )

    assert response["monthlyRewardLimit"] == FEEDBACK_MONTHLY_REWARD_LIMIT
    assert response["rewardPointsPerFeedback"] == FEEDBACK_REWARD_POINTS
    assert response["rewardedThisMonth"] == 1
    assert response["remainingRewardSlots"] == FEEDBACK_MONTHLY_REWARD_LIMIT - 1
    assert response["rewardGranted"] is True
    assert response["item"]["rewardPoints"] == FEEDBACK_REWARD_POINTS
    assert response["item"]["rewardGranted"] is True
    assert credit_updates == [(user["id"], FEEDBACK_REWARD_POINTS)]


def test_feedback_service_database_mode_grants_rewards_and_filters_visibility(monkeypatch):
    monkeypatch.setattr(feedback_service_module, "FeedbackRecord", _FakeFeedbackRecord)
    monkeypatch.setattr(feedback_service_module, "User", _FakeUser)
    monkeypatch.setattr(feedback_service, "settings", SimpleNamespace(is_database_storage=lambda: True))

    current_user = SimpleNamespace(
        id=1,
        username="db_feedback_user",
        tenant_id=1,
        credit=0,
        group=1001,
    )
    other_user = SimpleNamespace(
        id=2,
        username="db_feedback_other",
        tenant_id=1,
        credit=0,
        group=1001,
    )
    admin_user = SimpleNamespace(
        id=9,
        username="db_feedback_admin",
        tenant_id=1,
        credit=0,
        group=1000,
    )
    db = _FakeDatabaseSession(users=[current_user, other_user])

    results = []
    for index in range(FEEDBACK_MONTHLY_REWARD_LIMIT):
        result = feedback_service.create_feedback(
            db=db,
            current_user=current_user,
            content=f"DB feedback {index + 1}",
            attachments=[],
        )
        results.append(result)

    fourth_result = feedback_service.create_feedback(
        db=db,
        current_user=current_user,
        content="DB feedback 4",
        attachments=[],
    )

    other_result = feedback_service.create_feedback(
        db=db,
        current_user=other_user,
        content="Other user feedback",
        attachments=[],
    )

    assert [item["reward_points"] for item in results] == [FEEDBACK_REWARD_POINTS] * FEEDBACK_MONTHLY_REWARD_LIMIT
    assert [item["reward_granted"] for item in results] == [True] * FEEDBACK_MONTHLY_REWARD_LIMIT
    assert fourth_result["reward_points"] == 0
    assert fourth_result["reward_granted"] is False
    assert other_result["reward_points"] == FEEDBACK_REWARD_POINTS
    assert other_result["reward_granted"] is True
    assert current_user.credit == FEEDBACK_REWARD_POINTS * FEEDBACK_MONTHLY_REWARD_LIMIT
    assert other_user.credit == FEEDBACK_REWARD_POINTS

    current_status = feedback_service.get_monthly_reward_status(db, current_user)
    assert current_status["rewarded_this_month"] == FEEDBACK_MONTHLY_REWARD_LIMIT
    assert current_status["remaining_reward_slots"] == 0

    user_view = feedback_service.list_visible_feedback(db, current_user, limit=None)
    admin_view = feedback_service.list_visible_feedback(db, admin_user, limit=None)

    assert len(user_view) == FEEDBACK_MONTHLY_REWARD_LIMIT + 1
    assert all(item["user_id"] == current_user.id for item in user_view)
    assert len(admin_view) == len(db.feedback_records)
    assert {item["user_id"] for item in admin_view} == {current_user.id, other_user.id}
