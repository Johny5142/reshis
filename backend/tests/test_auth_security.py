import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException

from app.main import create_app
from app.database import connect

DATA = Path(__file__).resolve().parents[1] / "data"
ACCOUNT = {"email": "audit@example.com", "password": "audit-password-123"}


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(data_dir=DATA, db_path=tmp_path / "test.sqlite3", secure_cookie=False),
                    raise_server_exceptions=False, headers={"X-Requested-With": "reshis"}) as client:
        yield client


def test_registration_rolls_back_session_failure_and_can_retry(client):
    with patch("app.database._insert_session", side_effect=sqlite3.OperationalError("synthetic")):
        response = client.post("/api/auth/register", json=ACCOUNT)
    assert response.status_code == 500
    assert "set-cookie" not in response.headers
    with connect(client.app.state.db_path) as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0
    assert client.post("/api/auth/register", json=ACCOUNT).status_code == 201

def test_duplicate_email_and_other_integrity_errors(client):
    assert client.post("/api/auth/register", json=ACCOUNT).status_code == 201
    assert client.post("/api/auth/register", json={**ACCOUNT, "email": ACCOUNT["email"].upper()}).status_code == 409
    with patch("app.main.register_user", side_effect=sqlite3.IntegrityError("sensitive SQL")):
        response = client.post("/api/auth/register", json=ACCOUNT)
    assert response.status_code == 500
    assert "sensitive" not in response.text


@pytest.mark.parametrize("code", [sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED, sqlite3.SQLITE_CANTOPEN,
                                  sqlite3.SQLITE_IOERR, sqlite3.SQLITE_FULL, sqlite3.SQLITE_READONLY])
def test_database_unavailable_is_503(client, code, caplog):
    error = sqlite3.OperationalError("sensitive SQL password token")
    error.sqlite_errorcode = code
    with patch("app.main.register_user", side_effect=error):
        response = client.post("/api/auth/register", json=ACCOUNT)
    assert response.status_code == 503
    assert response.headers["retry-after"] == "5"
    assert "sensitive" not in response.text + caplog.text

@pytest.mark.parametrize("action", ["login", "register"])
def test_ip_limits_ignore_spoofed_forwarded_headers(client, action):
    client.app.state.auth_limiter.limits[(action, "ip")] = 2
    for i in range(2):
        client.post("/api/auth/" + action, json={"email": "invalid", "password": "bad"},
                    headers={"X-Forwarded-For": f"192.0.2.{i}"})
    response = client.post("/api/auth/" + action, json=ACCOUNT, headers={"X-Forwarded-For": "192.0.2.99"})
    assert response.status_code == 429
    assert int(response.headers["retry-after"]) > 0


@pytest.mark.parametrize("action", ["login", "register"])
def test_email_limits_normalize_case(client, action):
    client.app.state.auth_limiter.limits[(action, "email")] = 1
    client.post("/api/auth/" + action, json=ACCOUNT)
    response = client.post("/api/auth/" + action, json={**ACCOUNT, "email": ACCOUNT["email"].upper()})
    assert response.status_code == 429


def test_limit_expires_and_memory_is_bounded(client):
    limiter = client.app.state.auth_limiter
    limiter.max_keys = 1
    limiter.limits[("login", "email")] = 1
    with patch("app.rate_limit.time.monotonic", return_value=10):
        limiter.consume("login", "email", "first")
        with pytest.raises(HTTPException) as error:
            limiter.consume("login", "email", "second")
        assert error.value.status_code == 429
    with patch("app.rate_limit.time.monotonic", return_value=10 + limiter.window):
        limiter.consume("login", "email", "second")
    assert len(limiter.buckets) == 1

def test_unknown_and_wrong_password_both_run_verification(client):
    from app.security import DUMMY_PASSWORD_HASH, verify_password
    assert client.post("/api/auth/register", json=ACCOUNT).status_code == 201
    with patch("app.main.verify_password", wraps=verify_password) as verify:
        wrong = client.post("/api/auth/login", json={**ACCOUNT, "password": "wrong"})
        assert verify.call_count == 1
        verify.reset_mock()
        unknown = client.post("/api/auth/login", json={**ACCOUNT, "email": "unknown@example.com"})
        assert verify.call_count == 1
        assert verify.call_args.args[0] == DUMMY_PASSWORD_HASH
    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()


@pytest.mark.parametrize("origin", ["http://localhost:5173", "http://127.0.0.1:5173"])
def test_trusted_origin_and_logout(client, origin):
    client.headers.pop("X-Requested-With")
    assert client.post("/api/auth/register", json=ACCOUNT, headers={"Origin": origin}).status_code == 201
    assert client.post("/api/auth/logout", headers={"Origin": origin}).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


@pytest.mark.parametrize("headers", [
    {"Origin": "https://evil.example"}, {"Origin": "null"},
    {"Origin": "http://localhost:5173.evil.example"},
    {"Origin": "http://localhost:5174", "Sec-Fetch-Site": "same-origin"},
])
def test_untrusted_origin_cannot_be_overridden(client, headers):
    assert client.post("/api/auth/register", json=ACCOUNT, headers=headers).status_code == 403


def test_missing_origin_browser_form_and_explicit_client(client):
    client.headers.pop("X-Requested-With")
    assert client.post("/api/auth/register", json=ACCOUNT).status_code == 403
    client.headers["X-Requested-With"] = "reshis"
    assert client.post("/api/auth/register", json=ACCOUNT).status_code == 201
    assert client.post("/api/auth/logout", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout").status_code == 204


def test_https_origin_configuration(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTH_TRUSTED_ORIGINS", "https://avia.example")
    with TestClient(create_app(data_dir=DATA, db_path=tmp_path / "https.sqlite3", secure_cookie=True),
                    base_url="https://avia.example") as client:
        response = client.post("/api/auth/register", json=ACCOUNT, headers={"Origin": "https://avia.example"})
        assert response.status_code == 201
        assert "Secure" in response.headers["set-cookie"]
        assert client.post("/api/auth/logout", headers={"Origin": "https://other.example"}).status_code == 403
    monkeypatch.setenv("AUTH_TRUSTED_ORIGINS", "*")
    with pytest.raises(ValueError):
        create_app(data_dir=DATA, db_path=tmp_path / "invalid.sqlite3")

def test_import_and_factory_do_not_open_database(tmp_path):
    import os
    import subprocess
    import sys
    path = tmp_path / "must-not-exist.sqlite3"
    script = """
from unittest.mock import patch
with patch("sqlite3.connect", side_effect=AssertionError("database opened on import")):
    import app.main
    app.main.create_app()
"""
    result = subprocess.run([sys.executable, "-c", script],
                            env={**os.environ, "DB_PATH": str(path)}, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert not path.exists()


def test_lifespan_creates_new_database_and_preserves_existing_schema(tmp_path):
    path = tmp_path / "lifecycle.sqlite3"
    app = create_app(data_dir=DATA, db_path=path, secure_cookie=False)
    assert not path.exists()
    with TestClient(app, headers={"X-Requested-With": "reshis"}) as client:
        assert path.exists()
        account = client.post("/api/auth/register", json=ACCOUNT).json()
        token = client.cookies.get("reshis_session")
        forecast = client.post("/api/forecast", json={"route": "MOW-AER", "date": "2026-06-01", "price": 9000})
        assert forecast.status_code == 200
    with connect(path) as db:
        before = [tuple(row) for row in db.execute("SELECT name, sql FROM sqlite_master ORDER BY name")]
    with TestClient(create_app(data_dir=DATA, db_path=path, secure_cookie=False)) as client:
        response = client.get("/api/auth/me", headers={"Cookie": f"reshis_session={token}"})
        assert response.json() == account
        assert client.post("/api/auth/login", json=ACCOUNT, headers={"X-Requested-With": "reshis"}).status_code == 200
        assert len(client.get("/api/forecast/history").json()) == 1
    with connect(path) as db:
        after = [tuple(row) for row in db.execute("SELECT name, sql FROM sqlite_master ORDER BY name")]
    assert before == after


def test_concurrent_duplicate_registration_is_atomic(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from app.database import initialize_database, register_user, DuplicateEmailError
    path = tmp_path / "concurrent.sqlite3"
    initialize_database(path)
    def register():
        try:
            register_user(path, ACCOUNT["email"], "test-only-hash")
            return "created"
        except DuplicateEmailError:
            return "duplicate"
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(lambda _: register(), range(2))) == ["created", "duplicate"]
    with connect(path) as db:
        assert db.execute("SELECT count(*) FROM users").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == 1
