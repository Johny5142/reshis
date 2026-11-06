from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any


QUANTILES = tuple(round(index / 10, 1) for index in range(1, 10))


class DataValidationError(ValueError):
    """Raised when the supplied CSV files do not match the expected format."""


@dataclass(frozen=True)
class Route:
    code: str
    name: str
    origin: str
    destination: str
    base_price: float
    price_sensitivity: float
    price_min: float
    price_max: float

    def to_public_dict(self) -> dict[str, Any]:
        return {
            "route": self.code,
            "name": self.name,
            "origin": self.origin,
            "destination": self.destination,
            "base_price": self.base_price,
            "price_min": self.price_min,
            "price_max": self.price_max,
        }


@dataclass(frozen=True)
class ForecastRow:
    route: str
    flight_date: date
    seats: int
    base_demand: dict[float, float]


class ForecastCatalog:
    def __init__(self, routes: dict[str, Route], flights: dict[tuple[str, date], ForecastRow]):
        self.routes = routes
        self.flights = flights

    @classmethod
    def load(cls, data_dir: Path) -> ForecastCatalog:
        routes_path = data_dir / "routes.csv"
        forecasts_path = data_dir / "seasonal_forecast.csv"
        route_rows = _read_csv(routes_path, "routes.csv")
        forecast_rows = _read_csv(forecasts_path, "seasonal_forecast.csv")

        required_route_columns = {
            "route",
            "name",
            "base_price",
            "price_sensitivity",
            "price_min",
            "price_max",
        }
        _require_columns(route_rows[0].keys(), required_route_columns, "routes.csv")

        routes: dict[str, Route] = {}
        for line_number, row in enumerate(route_rows, start=2):
            code = row["route"].strip()
            if not code:
                raise DataValidationError(f"routes.csv:{line_number}: пустой код маршрута")
            if code in routes:
                raise DataValidationError(f"routes.csv:{line_number}: повтор маршрута {code}")

            name = row["name"].strip()
            if " — " in name:
                origin, destination = (part.strip() for part in name.split(" — ", 1))
            elif " - " in name:
                origin, destination = (part.strip() for part in name.split(" - ", 1))
            else:
                origin, destination = code.split("-", 1) if "-" in code else (code, code)

            base_price = _number(row["base_price"], "base_price", "routes.csv", line_number)
            sensitivity = _number(
                row["price_sensitivity"], "price_sensitivity", "routes.csv", line_number
            )
            price_min = _number(row["price_min"], "price_min", "routes.csv", line_number)
            price_max = _number(row["price_max"], "price_max", "routes.csv", line_number)
            if base_price < 0 or price_min < 0 or price_max < price_min:
                raise DataValidationError(
                    f"routes.csv:{line_number}: неверный диапазон цен для {code}"
                )
            if sensitivity < 0:
                raise DataValidationError(
                    f"routes.csv:{line_number}: price_sensitivity не может быть отрицательной"
                )
            routes[code] = Route(
                code=code,
                name=name or code,
                origin=origin,
                destination=destination,
                base_price=base_price,
                price_sensitivity=sensitivity,
                price_min=price_min,
                price_max=price_max,
            )

        required_forecast_columns = {"route", "date", "seats"} | {
            f"{quantile:.1f}_base_demand" for quantile in QUANTILES
        }
        _require_columns(forecast_rows[0].keys(), required_forecast_columns, "seasonal_forecast.csv")

        flights: dict[tuple[str, date], ForecastRow] = {}
        for line_number, row in enumerate(forecast_rows, start=2):
            code = row["route"].strip()
            if code not in routes:
                raise DataValidationError(
                    f"seasonal_forecast.csv:{line_number}: маршрут {code} отсутствует в routes.csv"
                )
            try:
                flight_date = date.fromisoformat(row["date"].strip())
            except ValueError as exc:
                raise DataValidationError(
                    f"seasonal_forecast.csv:{line_number}: дата должна быть в формате YYYY-MM-DD"
                ) from exc

            seats_value = _number(row["seats"], "seats", "seasonal_forecast.csv", line_number)
            if seats_value < 0 or not seats_value.is_integer():
                raise DataValidationError(
                    f"seasonal_forecast.csv:{line_number}: seats должно быть целым числом >= 0"
                )
            demand = {
                quantile: _number(
                    row[f"{quantile:.1f}_base_demand"],
                    f"{quantile:.1f}_base_demand",
                    "seasonal_forecast.csv",
                    line_number,
                )
                for quantile in QUANTILES
            }
            if any(value < 0 for value in demand.values()):
                raise DataValidationError(
                    f"seasonal_forecast.csv:{line_number}: базовый спрос не может быть отрицательным"
                )
            values = list(demand.values())
            if any(left > right for left, right in zip(values, values[1:])):
                raise DataValidationError(
                    f"seasonal_forecast.csv:{line_number}: квантили спроса должны не убывать"
                )

            key = (code, flight_date)
            if key in flights:
                raise DataValidationError(
                    f"seasonal_forecast.csv:{line_number}: повтор записи {code} {flight_date}"
                )
            flights[key] = ForecastRow(
                route=code,
                flight_date=flight_date,
                seats=int(seats_value),
                base_demand=demand,
            )

        if not flights:
            raise DataValidationError("seasonal_forecast.csv не содержит рейсов")
        return cls(routes=routes, flights=flights)

    def public_routes(self) -> list[dict[str, Any]]:
        used_routes = {route for route, _ in self.flights}
        return [
            self.routes[code].to_public_dict()
            for code in sorted(used_routes, key=lambda item: self.routes[item].name)
        ]

    def dates_for_route(self, route_code: str) -> list[dict[str, Any]]:
        rows = sorted(
            (row for (code, _), row in self.flights.items() if code == route_code),
            key=lambda row: row.flight_date,
        )
        return [{"date": row.flight_date.isoformat(), "seats": row.seats} for row in rows]

    def predict(self, route_code: str, flight_date: date, price: float) -> dict[str, Any] | None:
        route = self.routes[route_code]
        row = self.flights.get((route_code, flight_date))
        if row is None:
            return None

        scenarios = []
        for quantile in QUANTILES:
            demand = row.base_demand[quantile] - route.price_sensitivity * (
                price - route.base_price
            )
            sales = min(float(row.seats), max(0.0, demand))
            scenarios.append(
                {
                    "quantile": quantile,
                    "demand": demand,
                    "sales": sales,
                }
            )

        median = next(scenario for scenario in scenarios if scenario["quantile"] == 0.5)
        return {
            "route": route_code,
            "date": flight_date.isoformat(),
            "price": price,
            "seats": row.seats,
            "median_demand": median["demand"],
            "median_sales": median["sales"],
            "scenarios": scenarios,
        }


def _read_csv(path: Path, label: str) -> list[dict[str, str]]:
    if not path.exists():
        raise DataValidationError(f"Не найден файл данных: {path}")
    try:
        with path.open("r", newline="", encoding="utf-8-sig") as stream:
            reader = csv.DictReader(stream, strict=True)
            if not reader.fieldnames:
                raise DataValidationError(f"{label} пуст или не содержит заголовка")
            if len(reader.fieldnames) != len(set(reader.fieldnames)):
                raise DataValidationError(f"{label}: повтор названия столбца")
            if any(not name.strip() for name in reader.fieldnames):
                raise DataValidationError(f"{label}: пустое название столбца")
            rows = []
            for row in reader:
                if None in row or any(value is None for value in row.values()):
                    raise DataValidationError(
                        f"{label}:{reader.line_num}: число полей не совпадает с заголовком"
                    )
                rows.append(row)
            if not rows:
                raise DataValidationError(f"{label} не содержит строк с данными")
            return rows
    except UnicodeDecodeError as exc:
        raise DataValidationError(f"{label} должен быть в кодировке UTF-8") from exc
    except csv.Error as exc:
        raise DataValidationError(f"{label}: некорректный CSV: {exc}") from exc


def _require_columns(actual: Any, required: set[str], label: str) -> None:
    missing = sorted(required - set(actual))
    if missing:
        raise DataValidationError(f"{label}: отсутствуют столбцы: {', '.join(missing)}")


def _number(value: str, field: str, file_name: str, line_number: int) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise DataValidationError(
            f"{file_name}:{line_number}: {field} должен быть числом"
        ) from exc
    if not math.isfinite(number):
        raise DataValidationError(f"{file_name}:{line_number}: {field} должен быть конечным числом")
    return number
