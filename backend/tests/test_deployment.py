"""Deployment contract checks; Compose rendering does not require Docker Engine."""
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest
from fastapi.testclient import TestClient
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from app.main import create_app
from app.rate_limit import AuthLimiter

ROOT = Path(__file__).resolve().parents[2]
LIMITS = {
    "AUTH_RATE_WINDOW_SECONDS": "900",
    "AUTH_RATE_MAX_KEYS": "10000",
    "AUTH_LOGIN_IP_LIMIT": "60",
    "AUTH_LOGIN_EMAIL_LIMIT": "20",
    "AUTH_REGISTER_IP_LIMIT": "20",
    "AUTH_REGISTER_EMAIL_LIMIT": "5",
}


def render_compose(tmp_path, overrides):
    docker = shutil.which("docker")
    if docker is None:
        pytest.skip("Docker CLI required for Compose deployment contract")
    env_file = tmp_path / "compose-test.env"
    env_file.write_text("AUTH_TRUSTED_ORIGINS=https://test.example\n"
                        "FORWARDED_ALLOW_IPS=192.0.2.10\n"
                        + "".join(f"{key}={value}\n" for key, value in overrides.items()),
                        encoding="utf-8")
    # Host environment must not override this isolated test env-file.
    env = {key: value for key, value in os.environ.items()
           if key not in {*LIMITS, "AUTH_TRUSTED_ORIGINS", "FORWARDED_ALLOW_IPS"}}
    result = subprocess.run(
        [docker, "compose", "--env-file", str(env_file), "-f", str(ROOT / "docker-compose.yml"),
         "config", "--format", "json"],
        capture_output=True, text=True, env=env, timeout=30,
    )
    return result


@pytest.mark.parametrize("custom", [False, True])
def test_compose_passes_all_limits_to_application(tmp_path, monkeypatch, custom):
    values = dict(LIMITS)
    if custom:
        values.update(AUTH_RATE_WINDOW_SECONDS="12", AUTH_RATE_MAX_KEYS="101",
                      AUTH_LOGIN_IP_LIMIT="2", AUTH_LOGIN_EMAIL_LIMIT="3",
                      AUTH_REGISTER_IP_LIMIT="4", AUTH_REGISTER_EMAIL_LIMIT="5")
    result = render_compose(tmp_path, values if custom else {})
    assert result.returncode == 0, result.stderr
    config = json.loads(result.stdout)
    environment = config["services"]["api"]["environment"]
    for name, value in values.items():
        assert str(environment[name]) == value
        monkeypatch.setenv(name, str(environment[name]))
    limiter = AuthLimiter()
    assert limiter.window == int(values["AUTH_RATE_WINDOW_SECONDS"])
    assert limiter.max_keys == int(values["AUTH_RATE_MAX_KEYS"])
    for action in ("login", "register"):
        for kind in ("ip", "email"):
            assert limiter.limits[(action, kind)] == int(values[f"AUTH_{action.upper()}_{kind.upper()}_LIMIT"])
    assert environment["FORWARDED_ALLOW_IPS"] == "192.0.2.10"
    if custom:
        app = create_app(data_dir=ROOT / "backend/data", db_path=tmp_path / "api.sqlite3",
                         secure_cookie=False)
        with TestClient(app, headers={"X-Requested-With": "reshis"}) as client:
            for _ in range(2):
                assert client.post("/api/auth/login", json={"email": "bad"}).status_code == 422
            response = client.post("/api/auth/login", json={"email": "bad"})
            assert response.status_code == 429
            assert 1 <= int(response.headers["retry-after"]) <= 12


def test_compose_requires_explicit_proxy(tmp_path):
    result = render_compose(tmp_path, {"FORWARDED_ALLOW_IPS": ""})
    assert result.returncode != 0
    assert "FORWARDED_ALLOW_IPS" in result.stderr


class ProxyPeer:
    """Supply a test TCP peer before Uvicorn processes forwarded headers."""
    def __init__(self, app, peer):
        self.app = app
        self.peer = peer

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            scope = {**scope, "client": (self.peer, 12345)}
        await self.app(scope, receive, send)


@pytest.mark.parametrize("trusted", [False, True])
def test_real_login_limits_use_only_trusted_forwarded_ip(tmp_path, monkeypatch, trusted):
    monkeypatch.setenv("AUTH_LOGIN_IP_LIMIT", "1")
    app = create_app(data_dir=ROOT / "backend/data", db_path=tmp_path / "proxy.sqlite3",
                     secure_cookie=False)
    proxy = ProxyHeadersMiddleware(app, trusted_hosts="192.0.2.10")
    peer = "192.0.2.10" if trusted else "203.0.113.9"
    with TestClient(ProxyPeer(proxy, peer), headers={"X-Requested-With": "reshis"}) as client:
        payload = {"email": "missing@example.com", "password": "test-password"}
        def attempt(ip):
            return client.post("/api/auth/login", json=payload, headers={"X-Forwarded-For": ip})
        assert attempt("198.51.100.1").status_code == 401
        assert attempt("198.51.100.2").status_code == (401 if trusted else 429)
        response = attempt("198.51.100.1")
        assert response.status_code == 429
        assert int(response.headers["retry-after"]) > 0


def test_edge_nginx_replaces_forwarding_chain_and_api_is_loopback_only(tmp_path):
    nginx = (ROOT / "deploy/nginx.conf.example").read_text()
    assert "proxy_set_header X-Forwarded-For $remote_addr;" in nginx
    assert "$proxy_add_x_forwarded_for" not in nginx
    config = json.loads(render_compose(tmp_path, {}).stdout)
    ports = config["services"]["api"]["ports"]
    assert all(port["host_ip"] == "127.0.0.1" for port in ports)
