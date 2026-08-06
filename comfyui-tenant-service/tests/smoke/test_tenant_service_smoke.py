import os
import uuid

import httpx
import pytest
from sqlalchemy import create_engine, text


BASE_URL = os.getenv("SMOKE_BASE_URL", "http://localhost:8081").rstrip("/")
PGHOST = os.getenv("PGHOST", "127.0.0.1")
PGPORT = os.getenv("PGPORT", "5432")
PGUSER = os.getenv("PGUSER", "postgres")
PGPASSWORD = os.getenv("PGPASSWORD", "postgres")
PGDATABASE = os.getenv("PGDATABASE", "comfyui_tenant_service")


def _pg_url() -> str:
    return f"postgresql+psycopg2://{PGUSER}:{PGPASSWORD}@{PGHOST}:{PGPORT}/{PGDATABASE}"


@pytest.fixture(scope="session")
def account() -> dict:
    username = f"smoke_{uuid.uuid4().hex[:10]}"
    password = f"SmokePass_{uuid.uuid4().hex[:10]}"
    email = f"{username}@example.com"
    phone = f"138{uuid.uuid4().hex[:8]}"
    return {"username": username, "password": password, "email": email, "phone": phone}


@pytest.fixture(scope="session")
def client() -> httpx.Client:
    with httpx.Client(base_url=BASE_URL, timeout=30.0) as c:
        yield c


@pytest.fixture(scope="session")
def bearer_token(client: httpx.Client, account: dict) -> str:
    register_resp = client.post(
        "/auth/register",
            json={
                "username": account["username"],
                "password": account["password"],
                "email": account["email"],
                "phone": account["phone"],
                "tenant_id": 1,
            },
        )
    assert register_resp.status_code in (200, 400), register_resp.text

    login_resp = client.post(
        "/auth/token",
        data={"username": account["username"], "password": account["password"]},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json().get("access_token")
    assert token
    return token


@pytest.fixture(scope="session")
def auth_headers(bearer_token: str) -> dict:
    return {"Authorization": f"Bearer {bearer_token}"}


@pytest.fixture(scope="session")
def admin_auth_headers(client: httpx.Client, account: dict) -> dict:
    engine = create_engine(_pg_url())
    with engine.begin() as conn:
        conn.execute(
            text('UPDATE users SET "group" = 1000 WHERE username = :username'),
            {"username": account["username"]},
        )

    login_resp = client.post(
        "/auth/token",
        data={"username": account["username"], "password": account["password"]},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login_resp.status_code == 200, login_resp.text
    token = login_resp.json().get("access_token")
    assert token
    return {"Authorization": f"Bearer {token}"}


def test_metrics_ok(client: httpx.Client) -> None:
    resp = client.get("/metrics")
    assert resp.status_code == 200


def test_login_and_get_current_user(client: httpx.Client, account: dict, auth_headers: dict) -> None:
    me_resp = client.get("/auth/me", headers=auth_headers)
    assert me_resp.status_code == 200, me_resp.text
    payload = me_resp.json()
    assert payload["username"] == account["username"]
    assert payload["tenant_id"] == 1


def test_create_and_list_project(client: httpx.Client, auth_headers: dict) -> None:
    project_name = f"smoke-project-{uuid.uuid4().hex[:8]}"
    create_resp = client.post(
        "/proxy/projects",
        json={"name": project_name},
        headers=auth_headers,
    )
    assert create_resp.status_code == 201, create_resp.text
    project_id = create_resp.json()["project"]["project_id"]
    assert project_id

    list_resp = client.get("/proxy/projects", headers=auth_headers)
    assert list_resp.status_code == 200, list_resp.text
    projects = list_resp.json().get("projects", [])
    assert any(item.get("project_id") == project_id for item in projects)


def test_task_history_query(client: httpx.Client, auth_headers: dict) -> None:
    resp = client.get("/proxy/tasks/history?page=1&limit=5", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)


def test_billing_rate_write_and_query(client: httpx.Client, admin_auth_headers: dict) -> None:
    model_name = f"smoke-model-{uuid.uuid4().hex[:8]}"
    upsert_resp = client.post(
        "/admin/billing-rates",
        json={"model": model_name, "credit": 7},
        headers=admin_auth_headers,
    )
    assert upsert_resp.status_code == 200, upsert_resp.text
    item = upsert_resp.json().get("item", {})
    assert item.get("model") == model_name
    assert item.get("credit") == 7

    list_resp = client.get("/admin/billing-rates", headers=admin_auth_headers)
    assert list_resp.status_code == 200, list_resp.text
    items = list_resp.json().get("items", [])
    assert any(i.get("model") == model_name and i.get("credit") == 7 for i in items)

    delete_resp = client.delete(f"/admin/billing-rates/{model_name}", headers=admin_auth_headers)
    assert delete_resp.status_code == 200, delete_resp.text
