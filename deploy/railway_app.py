from pathlib import Path

from fastapi.staticfiles import StaticFiles

from app.main import app


FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend" / "dist"

# Mounted after the API routes so existing /api endpoints keep precedence.
# StaticFiles serves the frontend index and assets without shadowing API routes.
app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
