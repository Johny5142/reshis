from __future__ import annotations

import hashlib
import json
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator


SESSION_TTL = timedelta(hours=8)


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=10)
    try:
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(db_path: Path) -> None:
    with connect(db_path) as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS forecast_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                route TEXT NOT NULL,
                flight_date TEXT NOT NULL,
                price REAL NOT NULL,
                forecast_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_forecast_history_user_created
                ON forecast_history(user_id, created_at DESC, id DESC);
            """
        )


def record_forecast_history(
    db_path: Path,
    user_id: int,
    forecast: dict[str, Any],
    limit: int = 50,
) -> dict[str, Any]:
    created_at = _utc_now().isoformat()
    with connect(db_path) as connection:
        cursor = connection.execute(
            """
            INSERT INTO forecast_history
                (user_id, route, flight_date, price, forecast_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                forecast["route"],
                forecast["date"],
                forecast["price"],
                json.dumps(forecast, ensure_ascii=False, separators=(",", ":")),
                created_at,
            ),
        )
        connection.execute(
            """
            DELETE FROM forecast_history
            WHERE user_id = ? AND id NOT IN (
                SELECT id FROM forecast_history
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ?
            )
            """,
            (user_id, user_id, limit),
        )
    return {
        "id": cursor.lastrowid,
        "route": forecast["route"],
        "date": forecast["date"],
        "price": forecast["price"],
        "median_sales": forecast["median_sales"],
        "seats": forecast["seats"],
        "forecast": forecast,
        "created_at": created_at,
    }


def list_forecast_history(db_path: Path, user_id: int, limit: int = 50) -> list[dict[str, Any]]:
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT id, route, flight_date, price, forecast_json, created_at
            FROM forecast_history
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    return [
        {
            "id": row["id"],
            "route": row["route"],
            "date": row["flight_date"],
            "price": row["price"],
            "median_sales": json.loads(row["forecast_json"])["median_sales"],
            "seats": json.loads(row["forecast_json"])["seats"],
            "forecast": json.loads(row["forecast_json"]),
            "created_at": row["created_at"],
        }
        for row in rows
    ]


def create_user(db_path: Path, email: str, password_hash: str) -> dict[str, Any]:
    created_at = _utc_now().isoformat()
    with connect(db_path) as connection:
        cursor = connection.execute(
            "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)",
            (email, password_hash, created_at),
        )
        return {"id": cursor.lastrowid, "email": email, "created_at": created_at}


def find_user_by_email(db_path: Path, email: str) -> dict[str, Any] | None:
    with connect(db_path) as connection:
        row = connection.execute(
            "SELECT id, email, password_hash, created_at FROM users WHERE email = ? COLLATE NOCASE",
            (email,),
        ).fetchone()
    return dict(row) if row else None


def issue_session(db_path: Path, user_id: int) -> tuple[str, datetime]:
    token = secrets.token_urlsafe(32)
    now = _utc_now()
    expires_at = now + SESSION_TTL
    with connect(db_path) as connection:
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
            (
                _token_hash(token),
                user_id,
                expires_at.isoformat(),
                now.isoformat(),
            ),
        )
        connection.execute(
            "DELETE FROM sessions WHERE expires_at <= ?",
            (now.isoformat(),),
        )
    return token, expires_at


def find_user_for_session(db_path: Path, token: str | None) -> dict[str, Any] | None:
    if not token:
        return None
    now = _utc_now().isoformat()
    with connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT users.id, users.email
            FROM sessions
            JOIN users ON users.id = sessions.user_id
            WHERE sessions.token_hash = ? AND sessions.expires_at > ?
            """,
            (_token_hash(token), now),
        ).fetchone()
    return dict(row) if row else None


def revoke_session(db_path: Path, token: str | None) -> None:
    if not token:
        return
    with connect(db_path) as connection:
        connection.execute(
            "DELETE FROM sessions WHERE token_hash = ?",
            (_token_hash(token),),
        )


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)
