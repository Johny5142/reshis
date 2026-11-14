from __future__ import annotations

import os
import logging
from contextlib import asynccontextmanager
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from .data import DataValidationError, ForecastCatalog
from .database import (
    SESSION_TTL,
    DuplicateEmailError,
    register_user,
    find_user_by_email,
    find_user_for_session,
    initialize_database,
    issue_session,
    list_forecast_history,
    record_forecast_history,
    revoke_session,
)
from .schemas import AccountRequest, ForecastRequest, LoginRequest, UserResponse
from .security import DUMMY_PASSWORD_HASH, hash_password, verify_password, trusted_origins
from .rate_limit import AuthLimiter


SESSION_COOKIE = "reshis_session"
BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = BACKEND_ROOT / "data"
DEFAULT_DB_PATH = BACKEND_ROOT / "app.sqlite3"
logger = logging.getLogger(__name__)


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

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.catalog = ForecastCatalog.load(resolved_data_dir)
        initialize_database(resolved_db_path)
        yield

    app = FastAPI(
        title="Решись Авиа — прогноз продаж",
        version="1.0.0",
        description="Прогноз спроса по сезонным квантилям из CSV.",
        lifespan=lifespan,
    )
    app.state.db_path = resolved_db_path
    app.state.secure_cookie = use_secure_cookie
    app.state.auth_limiter = AuthLimiter()
    allowed_origins = trusted_origins(use_secure_cookie)

    @app.middleware("http")
    async def limit_auth_requests(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            origin = request.headers.get("origin")
            site = request.headers.get("sec-fetch-site")
            valid_source = (
                origin in allowed_origins if origin is not None else
                request.headers.get("x-requested-with") == "reshis" and site in {None, "same-origin"}
            )
            if not valid_source:
                return JSONResponse(status_code=403, content={"detail": "Источник запроса не разрешён"})
        action = request.url.path.rsplit("/", 1)[-1]
        if request.method == "POST" and request.url.path in {"/api/auth/login", "/api/auth/register"}:
            try:
                app.state.auth_limiter.consume(action, "ip", request.client.host if request.client else "unknown")
            except HTTPException as exc:
                return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=exc.headers)
        return await call_next(request)

    @app.exception_handler(sqlite3.Error)
    async def database_error(_: Request, exc: sqlite3.Error) -> JSONResponse:
        code = getattr(exc, "sqlite_errorcode", 0) & 0xff
        unavailable = code in {
            sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED, sqlite3.SQLITE_CANTOPEN,
            sqlite3.SQLITE_IOERR, sqlite3.SQLITE_FULL, sqlite3.SQLITE_READONLY,
        }
        logger.error("SQLite operation failed: category=%s code=%s", type(exc).__name__, code)
        return JSONResponse(
            status_code=503 if unavailable else 500,
            content={"detail": "Сервис временно недоступен" if unavailable else "Внутренняя ошибка сервера"},
            headers={"Retry-After": "5"} if unavailable else None,
        )

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

    def set_session_cookie(response: Response, token: str) -> None:
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
        app.state.auth_limiter.consume("register", "email", email)
        try:
            user, token = register_user(
                app.state.db_path,
                email,
                hash_password(payload.password),
            )
        except DuplicateEmailError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Аккаунт с такой почтой уже существует",
            ) from exc
        set_session_cookie(response, token)
        return {"id": user["id"], "email": user["email"]}

    @app.post("/api/auth/login", response_model=UserResponse)
    def login(payload: LoginRequest, response: Response) -> dict[str, Any]:
        email = str(payload.email).strip().lower()
        app.state.auth_limiter.consume("login", "email", email)
        user = find_user_by_email(app.state.db_path, email)
        valid_password = verify_password(user["password_hash"] if user else DUMMY_PASSWORD_HASH, payload.password)
        if user is None or not valid_password:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверная почта или пароль",
            )
        token, _ = issue_session(app.state.db_path, user["id"])
        set_session_cookie(response, token)
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
