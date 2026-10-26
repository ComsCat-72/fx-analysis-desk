"""Vercel entry point: exposes the FastAPI app as a Python serverless function.

The dashboard is served as static files from frontend/dist; /api/* is rewritten here (vercel.json).
"""
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

# Serverless filesystems are read-only except /tmp.
os.environ.setdefault("STORAGE_DIR", "/tmp/uploads")
if not os.environ.get("DATABASE_URL"):
    # Without a database URL nothing persists between requests; set DATABASE_URL (Neon) in Vercel.
    os.environ["DATABASE_URL"] = "sqlite:////tmp/fxdesk.db"
    logging.warning("DATABASE_URL not set: using ephemeral /tmp SQLite; data will not persist")

from app.cli import init_db  # noqa: E402

try:
    init_db()  # idempotent: Alembic upgrade + config sync, once per cold start
except Exception:  # noqa: BLE001 - keep serving so /api/health can report the problem
    logging.exception("database initialisation failed")

from app.api.main import app  # noqa: E402,F401
