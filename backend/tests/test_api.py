from __future__ import annotations

import csv
import shutil
from datetime import date
from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.data import DataValidationError, ForecastCatalog
from app.main import create_app
from app.database import connect
from app.security import verify_password


DATA_DIR = Path(__file__).resolve().parents[1] / "data"


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    app = create_app(
        data_dir=DATA_DIR,
        db_path=tmp_path / "accounts.sqlite3",
        secure_cookie=False,
    )
    with TestClient(app) as test_client:
        yield test_client


def register(client: TestClient, email: str = "pilot@example.com") -> dict:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "test-password-123"},
    )
    assert response.status_code == 201
    return response.json()


def test_health_and_authentication_flow(client: TestClient) -> None:
    assert client.get("/api/health").json() == {"status": "ok"}
    assert client.get("/api/routes").status_code == 401

    account = register(client)
    assert account["email"] == "pilot@example.com"
    assert client.cookies.get("reshis_session")
    assert client.get("/api/auth/me").json()["email"] == "pilot@example.com"
    assert len(client.get("/api/routes").json()) == 5

    duplicate = client.post(
        "/api/auth/register",
        json={"email": "PILOT@example.com", "password": "test-password-123"},
    )
    assert duplicate.status_code == 409

    client.post("/api/auth/logout")
    assert client.get("/api/routes").status_code == 401


def test_login_rejects_wrong_password(client: TestClient) -> None:
    register(client)
    response = client.post(
        "/api/auth/login",
        json={"email": "pilot@example.com", "password": "wrong-password"},
    )
    assert response.status_code == 401


def test_median_forecast_matches_source_and_sales_respect_capacity(client: TestClient) -> None:
    register(client)
    response = client.post(
        "/api/forecast",
        json={"route": "MOW-AER", "date": "2026-06-01", "price": 9000},
    )
    assert response.status_code == 200
    result = response.json()
    assert result["seats"] == 900
    assert result["median_demand"] == 775
    assert result["median_sales"] == 775
    assert len(result["scenarios"]) == 9
    median = next(item for item in result["scenarios"] if item["quantile"] == 0.5)
    assert median["demand"] == result["median_demand"]

    expensive = client.post(
        "/api/forecast",
        json={"route": "MOW-AER", "date": "2026-06-01", "price": 10_000_000},
    ).json()
    assert expensive["median_demand"] < 0
    assert expensive["median_sales"] == 0

    cheap = client.post(
        "/api/forecast",
        json={"route": "MOW-AER", "date": "2026-06-01", "price": 0},
    ).json()
    assert cheap["median_demand"] > cheap["seats"]
    assert cheap["median_sales"] == cheap["seats"]
    assert all(0 <= scenario["sales"] <= cheap["seats"] for scenario in cheap["scenarios"])


def test_forecast_rejects_bad_price_and_missing_flight(client: TestClient) -> None:
    register(client)
    negative = client.post(
        "/api/forecast",
        json={"route": "MOW-AER", "date": "2026-06-01", "price": -1},
    )
    assert negative.status_code == 422

    missing_route = client.post(
        "/api/forecast",
        json={"route": "MOW-XXX", "date": "2026-06-01", "price": 9000},
    )
    assert missing_route.status_code == 404

    missing_date = client.post(
        "/api/forecast",
        json={"route": "MOW-AER", "date": "2026-07-02", "price": 9000},
    )
    assert missing_date.status_code == 404


def test_catalog_rejects_duplicate_route_date(tmp_path: Path) -> None:
    shutil.copy(DATA_DIR / "routes.csv", tmp_path / "routes.csv")
    source = DATA_DIR / "seasonal_forecast.csv"
    duplicate_path = tmp_path / "seasonal_forecast.csv"
    with source.open("r", newline="", encoding="utf-8") as stream:
        rows = list(csv.reader(stream))
    with duplicate_path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerows(rows + [rows[1]])

    with pytest.raises(DataValidationError, match="повтор записи"):
        ForecastCatalog.load(tmp_path)


def test_password_whitespace_is_preserved_and_login_survives_restart(client: TestClient) -> None:
    password = "  exact password  "
    credentials = {"email": "spaces@example.com", "password": password}
    assert client.post("/api/auth/register", json=credentials).status_code == 201
    db_path = client.app.state.db_path
    with connect(db_path) as connection:
        stored = connection.execute("SELECT password_hash FROM users").fetchone()[0]
    assert stored.startswith("$argon2")
    assert verify_password(stored, password)
    assert not verify_password(stored, password.strip())
    token = client.cookies.get("reshis_session")
    assert client.post("/api/auth/logout").status_code == 204
    with TestClient(create_app(data_dir=DATA_DIR, db_path=db_path, secure_cookie=False)) as restarted:
        assert restarted.get("/api/routes", headers={"Cookie": f"reshis_session={token}"}).status_code == 401
        assert restarted.post("/api/auth/login", json={**credentials, "password": password.strip()}).status_code == 401
        assert restarted.post("/api/auth/login", json={**credentials, "password": "short"}).status_code == 401
        assert restarted.post("/api/auth/login", json=credentials).status_code == 200
        assert restarted.get("/api/routes").status_code == 200


def test_expired_sessions_are_rejected(client: TestClient) -> None:
    register(client)
    with connect(client.app.state.db_path) as connection:
        connection.execute("UPDATE sessions SET expires_at = '2000-01-01T00:00:00+00:00'")
    assert client.get("/api/auth/me").status_code == 401
    assert client.post("/api/forecast", json={"route": "MOW-AER", "date": "2026-06-01", "price": 9000}).status_code == 401


@pytest.mark.parametrize("price", ["NaN", "Infinity", "-Infinity", "1e309", "null", '"abc"', "-1"])
def test_invalid_price_is_json_error_not_server_failure(client: TestClient, price: str) -> None:
    register(client)
    response = client.post(
        "/api/forecast",
        content='{"route":"MOW-AER","date":"2026-06-01","price":' + price + '}',
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_dates_and_all_protected_endpoints(client: TestClient) -> None:
    assert client.get("/api/routes/MOW-AER/dates").status_code == 401
    assert client.post("/api/forecast", json={"route": "MOW-AER", "date": "2026-06-01", "price": 9000}).status_code == 401
    register(client)
    dates = client.get("/api/routes/MOW-AER/dates").json()
    assert len(dates) == 31
    assert dates[0] == {"date": "2026-06-01", "seats": 900}
    assert dates[-1]["date"] == "2026-07-01"
    assert client.get("/api/routes/MOW-XXX/dates").status_code == 404
    assert client.post("/api/forecast", json={"route": "MOW-AER", "date": "2026-02-30", "price": 9000}).status_code == 422


def test_cookie_security_and_validation_does_not_echo_password(tmp_path: Path) -> None:
    app = create_app(data_dir=DATA_DIR, db_path=tmp_path / "secure.sqlite3", secure_cookie=True)
    with TestClient(app, base_url="https://testserver") as client:
        response = client.post("/api/auth/register", json={"email": "cookie@example.com", "password": "secure-password"})
        cookie = response.headers["set-cookie"].lower()
        assert all(flag in cookie for flag in ["httponly", "secure", "samesite=lax"])
        assert client.get("/api/auth/me").status_code == 200
        response = client.post("/api/auth/register", json={"email": "cookie@example.com", "password": "secret"})
        assert response.status_code == 422
        assert "secret" not in response.text


def test_all_flights_follow_formula_and_quantiles_at_multiple_prices() -> None:
    catalog = ForecastCatalog.load(DATA_DIR)
    assert len(catalog.flights) == 155
    for (code, flight_date), row in catalog.flights.items():
        route = catalog.routes[code]
        previous = None
        for price in [0, route.base_price, route.price_max, 10_000_000]:
            result = catalog.predict(code, flight_date, price)
            for scenario in result["scenarios"]:
                expected = row.base_demand[scenario["quantile"]] - route.price_sensitivity * (price - route.base_price)
                assert scenario["demand"] == pytest.approx(expected)
                assert scenario["sales"] == pytest.approx(min(row.seats, max(0, expected)))
            assert result["median_demand"] == result["scenarios"][4]["demand"]
            assert result["median_sales"] == result["scenarios"][4]["sales"]
            if previous is not None:
                assert result["median_demand"] <= previous
            previous = result["median_demand"]


def write_catalog(tmp_path: Path, mutate) -> None:
    shutil.copy(DATA_DIR / "routes.csv", tmp_path / "routes.csv")
    with (DATA_DIR / "seasonal_forecast.csv").open(encoding="utf-8", newline="") as stream:
        rows = list(csv.reader(stream))
    mutate(rows)
    with (tmp_path / "seasonal_forecast.csv").open("w", encoding="utf-8", newline="") as stream:
        csv.writer(stream).writerows(rows)


def test_zero_capacity_keeps_demand_but_no_sales(tmp_path: Path) -> None:
    write_catalog(tmp_path, lambda rows: rows[1].__setitem__(2, "0"))
    catalog = ForecastCatalog.load(tmp_path)
    for price in [0, 9000, 10_000_000]:
        result = catalog.predict("MOW-AER", date(2026, 6, 1), price)
        assert result["seats"] == 0
        assert all(item["sales"] == 0 for item in result["scenarios"])


@pytest.mark.parametrize(("mutation", "message"), [
    (lambda rows: rows[1].pop(), "число полей"),
    (lambda rows: rows[1].append("extra"), "число полей"),
    (lambda rows: rows[0].__setitem__(4, rows[0][3]), "повтор названия"),
    (lambda rows: rows[0].__setitem__(3, "missing"), "отсутствуют столбцы"),
    (lambda rows: rows[1].__setitem__(3, "99999"), "квантили"),
    (lambda rows: rows[1].__setitem__(3, "NaN"), "конечным числом"),
    (lambda rows: rows[1].__setitem__(2, "-1"), "seats"),
    (lambda rows: rows[1].__setitem__(2, "1.5"), "seats"),
    (lambda rows: rows[1].__setitem__(1, "2026-02-30"), "дата"),
    (lambda rows: rows[1].__setitem__(0, "UNKNOWN"), "отсутствует в routes"),
])
def test_catalog_rejects_invalid_data(tmp_path: Path, mutation, message: str) -> None:
    write_catalog(tmp_path, mutation)
    with pytest.raises(DataValidationError, match=message):
        ForecastCatalog.load(tmp_path)
