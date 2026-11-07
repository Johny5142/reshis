from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from .data import DataValidationError, ForecastCatalog
from .database import (
    SESSION_TTL,
    create_user,
    find_user_by_email,
    find_user_for_session,
    initialize_database,
    issue_session,
    list_forecast_history,
    record_forecast_history,
    revoke_session,
)
from .schemas import AccountRequest, ForecastRequest, LoginRequest, UserResponse
from .security import hash_password, verify_password


SESSION_COOKIE = "reshis_session"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = BACKEND_ROOT / "data"
DEFAULT_DB_PATH = BACKEND_ROOT / "app.sqlite3"


def create_app(
    data_dir: Path | None = None,
    db_path: Path | None = None,
    secure_cookie: bool | None = None,
) -> FastAPI:
    resolved_data_dir = data_dir or Path(os.environ.get("DATA_DIR", DEFAULT_DATA_DIR))
    resolved_db_path = db_path or Path(os.environ.get("DB_PATH", DEFAULT_DB_PATH))
    use_secure_cookie = (
        secure_cookie
        if secure_cookie is not None
        else os.environ.get("COOKIE_SECURE", "false").lower() in {"1", "true", "yes"}
    )

    catalog = ForecastCatalog.load(resolved_data_dir)
    initialize_database(resolved_db_path)

    app = FastAPI(
        title="Решись Авиа — прогноз продаж",
        version="1.0.0",
        description="Прогноз спроса по сезонным квантилям из CSV.",
    )
    app.state.catalog = catalog
    app.state.db_path = resolved_db_path
    app.state.secure_cookie = use_secure_cookie

    @app.exception_handler(RequestValidationError)
    async def invalid_request(_: Request, exc: RequestValidationError) -> JSONResponse:
        # Never echo passwords or non-JSON values (NaN/Infinity) from invalid input.
        errors = [
            {"loc": error["loc"], "type": error["type"], "msg": error["msg"]}
            for error in exc.errors()
        ]
        return JSONResponse(status_code=422, content={
            "detail": "Проверьте введённые данные: почту, пароль, маршрут, дату и цену.",
            "errors": errors,
        })

    def current_user(request: Request) -> dict[str, Any]:
        user = find_user_for_session(
            request.app.state.db_path,
            request.cookies.get(SESSION_COOKIE),
        )
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Войдите, чтобы продолжить",
            )
        return user

    def set_session_cookie(response: Response, user_id: int) -> None:
        token, _ = issue_session(app.state.db_path, user_id)
        response.set_cookie(
            key=SESSION_COOKIE,
            value=token,
            max_age=int(SESSION_TTL.total_seconds()),
            httponly=True,
            secure=app.state.secure_cookie,
            samesite="lax",
            path="/",
        )

    @app.exception_handler(DataValidationError)
    async def csv_validation_exception(_: Request, exc: DataValidationError) -> JSONResponse:
        return JSONResponse(status_code=500, content={"detail": str(exc)})

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post(
        "/api/auth/register",
        response_model=UserResponse,
        status_code=status.HTTP_201_CREATED,
    )
    def register(payload: AccountRequest, response: Response) -> dict[str, Any]:
        email = str(payload.email).strip().lower()
        try:
            user = create_user(
                app.state.db_path,
                email,
                hash_password(payload.password),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Аккаунт с такой почтой уже существует",
            ) from exc
        set_session_cookie(response, user["id"])
        return {"id": user["id"], "email": user["email"]}

    @app.post("/api/auth/login", response_model=UserResponse)
    def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
        email = str(payload.email).strip().lower()
        user = find_user_by_email(app.state.db_path, email)
        if user is None or not verify_password(user["password_hash"], payload.password):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверная почта или пароль",
            )
        set_session_cookie(response, user["id"])
        return {"id": user["id"], "email": user["email"]}

    @app.post("/api/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
    def logout(request: Request, response: Response) -> Response:
        revoke_session(
            app.state.db_path,
            request.cookies.get(SESSION_COOKIE),
        )
        response.delete_cookie(
            key=SESSION_COOKIE,
            path="/",
            httponly=True,
            secure=app.state.secure_cookie,
            samesite="lax",
        )
        response.status_code = status.HTTP_204_NO_CONTENT
        response.body = b""
        return response

    @app.get("/api/auth/me", response_model=UserResponse)
    def me(user: dict[str, Any] = Depends(current_user)) -> dict[str, Any]:
        return user

    @app.get("/api/routes")
    def routes(_: dict[str, Any] = Depends(current_user)) -> list[dict[str, Any]]:
        return app.state.catalog.public_routes()

    @app.get("/api/routes/{route_code}/dates")
    def route_dates(
        route_code: str,
        _: dict[str, Any] = Depends(current_user),
    ) -> list[dict[str, Any]]:
        if route_code not in app.state.catalog.routes:
            raise HTTPException(status_code=404, detail="Маршрут не найден")
        dates = app.state.catalog.dates_for_route(route_code)
        if not dates:
            raise HTTPException(status_code=404, detail="Для маршрута нет доступных дат")
        return dates

    @app.get("/api/forecast/history")
    def forecast_history(
        user: dict[str, Any] = Depends(current_user),
    ) -> list[dict[str, Any]]:
        return list_forecast_history(app.state.db_path, user["id"])

    @app.post("/api/forecast")
    def forecast(
        payload: ForecastRequest,
        user: dict[str, Any] = Depends(current_user),
    ) -> dict[str, Any]:
        if payload.route not in app.state.catalog.routes:
            raise HTTPException(status_code=404, detail="Маршрут не найден")
        result = app.state.catalog.predict(payload.route, payload.date, payload.price)
        if result is None:
            raise HTTPException(status_code=404, detail="На эту дату рейс не найден")
        record_forecast_history(app.state.db_path, user["id"], result)
        return result

    return app


app = create_app()
