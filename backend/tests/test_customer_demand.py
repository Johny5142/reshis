import csv
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.database import connect

DATA = Path(__file__).resolve().parents[1] / "data"


@pytest.mark.parametrize("price", [0, 1000, 1001, 1010, 1020, 1040, 1050, 1060, 1090, 1100, 1_000_000])
def test_customer_demand_contract(tmp_path, price):
    data = tmp_path / "data"
    data.mkdir()
    (data / "routes.csv").write_text(
        "route,name,base_price,price_sensitivity,price_min,price_max\nMOW-TST,Test,1000,1,0,2000\n")
    with (data / "seasonal_forecast.csv").open("w", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["route", "date", "seats"] + [f"{q / 10:.1f}_base_demand" for q in range(1, 10)])
        writer.writerow(["MOW-TST", "2026-06-19", 50] + list(range(10, 100, 10)))
    app = create_app(data_dir=data, db_path=tmp_path / "test.sqlite3", secure_cookie=False)
    with TestClient(app, headers={"X-Requested-With": "reshis"}) as client:
        assert client.post("/api/auth/register", json={"email": "test@example.com", "password": "test-password"}).status_code == 201
        response = client.post("/api/forecast", json={"route": "MOW-TST", "date": "2026-06-19", "price": price})
        assert response.status_code == 200
        result = response.json()
        expected = 50 - (price - 1000)
        assert result["median_demand"] == expected
        assert result["median_customer_demand"] == max(0, expected)
        assert result["median_sales"] == min(50, max(0, expected))
        for q, item in enumerate(result["scenarios"], start=1):
            assert item["demand"] == q * 10 - (price - 1000)
            assert item["customer_demand"] == max(0, item["demand"])
            assert item["sales"] == min(50, item["customer_demand"])
        # Simulate a record saved before additive fields existed.
        legacy = {key: value for key, value in result.items() if key != "median_customer_demand"}
        legacy["scenarios"] = [{key: value for key, value in item.items() if key != "customer_demand"}
                               for item in result["scenarios"]]
        with connect(app.state.db_path) as db:
            db.execute("UPDATE forecast_history SET forecast_json = ?", (json.dumps(legacy),))
        restored = client.get("/api/forecast/history").json()[0]["forecast"]
        assert restored == result
        with connect(app.state.db_path) as db:
            assert json.loads(db.execute("SELECT forecast_json FROM forecast_history").fetchone()[0]) == legacy


def test_reported_kaliningrad_case_on_live_csv(tmp_path):
    app = create_app(data_dir=DATA, db_path=tmp_path / "real-csv.sqlite3", secure_cookie=False)
    with TestClient(app, headers={"X-Requested-With": "reshis"}) as client:
        client.post("/api/auth/register", json={"email": "test@example.com", "password": "test-password"})
        result = client.post("/api/forecast", json={"route": "MOW-KGD", "date": "2026-06-19", "price": 14000}).json()
        assert result["seats"] == 450
        assert result["median_demand"] == pytest.approx(-185.05)
        assert result["scenarios"][0]["demand"] == pytest.approx(-409.05)
        assert result["scenarios"][-1]["demand"] == pytest.approx(38.95)
        assert result["median_customer_demand"] == result["median_sales"] == 0
        assert result["scenarios"][0]["customer_demand"] == 0
        assert result["scenarios"][-1]["customer_demand"] == pytest.approx(38.95)
